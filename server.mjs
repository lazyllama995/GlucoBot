import { createServer } from "node:http";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { normalizeCarbVisionEstimate } from "./src/core/carbVision.js";

const { Pool } = pg;
const rootDir = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT ?? 4173);
const maxBodyBytes = 8 * 1024 * 1024;
let databasePool;
let schemaReady;
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "POST" && url.pathname === "/api/carb-vision") {
      await handleCarbVision(request, response);
      return;
    }

    if (url.pathname === "/api/logs") {
      await handleLogs(request, response);
      return;
    }

    if (url.pathname.startsWith("/api/libre")) {
      await handleLibre(request, response, url);
      return;
    }

    if (request.method === "GET" || request.method === "HEAD") {
      await serveStatic(request, response);
      return;
    }

    sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Unexpected server error" });
  }
});

server.listen(port, () => {
  console.log(`GlucoBot running at http://localhost:${port}/`);
});

async function handleCarbVision(request, response) {
  const body = await readJsonBody(request);
  const imageDataUrl = String(body.imageDataUrl ?? "");

  if (!isSupportedImageDataUrl(imageDataUrl)) {
    sendJson(response, 400, { error: "Upload a JPEG, PNG, or WebP meal image first." });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    sendJson(response, 501, {
      error: "Set OPENAI_API_KEY before using AI Carb Vision.",
      setup:
        "In Render, open glucobot > Environment, add OPENAI_API_KEY, save, then redeploy and upload the meal photo again."
    });
    return;
  }

  const estimate = await estimateCarbsWithOpenAI(imageDataUrl);
  sendJson(response, 200, { estimate });
}

async function handleLibre(request, response, url) {
  const pool = getDatabasePool();
  if (!pool) {
    sendJson(response, 503, {
      error: "SynchLibre needs the GlucoBot database.",
      setup:
        "In Render, sync the Blueprint or open glucobot > Environment and make sure DATABASE_URL is connected to glucobot-db."
    });
    return;
  }

  if (!process.env.GLUCOBOT_SECRET) {
    sendJson(response, 501, {
      error: "Set GLUCOBOT_SECRET before saving Libre credentials.",
      setup: "In Render, open glucobot > Environment, add GLUCOBOT_SECRET, save, then redeploy."
    });
    return;
  }

  await ensureLibreSchema(pool);
  const clientId = getClientId(request);

  if (request.method === "GET" && url.pathname === "/api/libre/status") {
    const setup = await loadLibreSetup(pool, clientId);
    sendJson(response, 200, {
      configured: Boolean(setup),
      email: setup?.email ?? "",
      patientId: setup?.patient_id ?? "",
      updatedAt: setup?.updated_at ? new Date(setup.updated_at).toISOString() : ""
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/libre/setup") {
    const body = await readJsonBody(request);
    const email = String(body.email ?? "").trim();
    const password = String(body.password ?? "");
    const patientId = String(body.patientId ?? "").trim();

    if (!email || !password) {
      sendJson(response, 400, { error: "Libre Link Up email and password are required." });
      return;
    }

    const reading = await fetchLibreReading({ email, password, patientId });
    await saveLibreSetup(pool, clientId, { email, password, patientId });
    await saveLibreReading(pool, clientId, reading);
    sendJson(response, 200, { configured: true, reading });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/libre/sync") {
    const setup = await loadLibreSetup(pool, clientId);
    if (!setup) {
      sendJson(response, 404, { error: "Add your Libre Link Up account first." });
      return;
    }

    const reading = await fetchLibreReading({
      email: setup.email,
      password: decryptSecret(setup.password_ciphertext),
      patientId: setup.patient_id
    });
    await saveLibreReading(pool, clientId, reading);
    sendJson(response, 200, { reading });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/libre/latest") {
    const latest = await loadLatestLibreReading(pool, clientId);
    sendJson(response, 200, { reading: latest });
    return;
  }

  sendJson(response, 405, { error: "Method not allowed" });
}

async function handleLogs(request, response) {
  const pool = getDatabasePool();
  if (!pool) {
    sendJson(response, 503, { error: "Database is not configured. Logbook is saved on this device." });
    return;
  }

  await ensureLogSchema(pool);
  const clientId = getClientId(request);

  if (request.method === "GET") {
    const result = await pool.query(
      `select id, type, payload, created_at
       from glucobot_logs
       where client_id = $1
       order by created_at desc`,
      [clientId]
    );
    sendJson(response, 200, {
      logs: result.rows.map((row) => ({
        id: row.id,
        type: row.type,
        payload: row.payload,
        createdAt: new Date(row.created_at).toISOString()
      }))
    });
    return;
  }

  if (request.method === "PUT") {
    const body = await readJsonBody(request);
    const logs = Array.isArray(body.logs) ? body.logs : [];
    await replaceLogs(pool, clientId, logs);
    sendJson(response, 200, { saved: logs.length });
    return;
  }

  sendJson(response, 405, { error: "Method not allowed" });
}

async function estimateCarbsWithOpenAI(imageDataUrl) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-5.5",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "Analyze this meal photo for diabetes carb counting. Estimate visible foods, approximate portion size, estimated quantity in grams for each food, and carbohydrates in grams for each food. Return JSON only with foods, totalCarbs, confidence, and notes. Do not recommend insulin or dosing."
            },
            {
              type: "input_image",
              image_url: imageDataUrl
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "carb_vision_estimate",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              foods: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    name: { type: "string" },
                    portion: { type: "string" },
                    grams: { type: "number" },
                    carbs: { type: "number" }
                  },
                  required: ["name", "portion", "grams", "carbs"]
                }
              },
              totalCarbs: { type: "number" },
              confidence: { type: "string", enum: ["low", "medium", "high"] },
              notes: { type: "string" }
            },
            required: ["foods", "totalCarbs", "confidence", "notes"]
          }
        }
      }
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error?.message ?? "AI carb vision request failed.");
  }

  return normalizeCarbVisionEstimate(JSON.parse(extractResponseText(payload)));
}

function extractResponseText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;

  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }

  throw new Error("AI response did not include a carb estimate.");
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = normalize(join(rootDir, requestedPath));

  if (!filePath.startsWith(rootDir)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  try {
    const data = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] ?? "application/octet-stream"
    });
    if (request.method !== "HEAD") response.end(data);
    else response.end();
  } catch {
    const index = await readFile(join(rootDir, "index.html"));
    response.writeHead(200, { "Content-Type": mimeTypes[".html"] });
    if (request.method !== "HEAD") response.end(index);
    else response.end();
  }
}

function getDatabasePool() {
  if (!process.env.DATABASE_URL) return null;
  if (databasePool) return databasePool;

  const isLocalDatabase = process.env.DATABASE_URL.includes("localhost");
  databasePool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isLocalDatabase ? false : { rejectUnauthorized: false }
  });
  return databasePool;
}

async function ensureLogSchema(pool) {
  if (!schemaReady) {
    schemaReady = pool.query(`
      create table if not exists glucobot_logs (
        id text primary key,
        client_id text not null,
        type text not null,
        payload jsonb not null,
        created_at timestamptz not null
      );
      create index if not exists glucobot_logs_client_created_idx
      on glucobot_logs (client_id, created_at desc);
    `);
  }

  await schemaReady;
}

async function ensureLibreSchema(pool) {
  await pool.query(`
    create table if not exists glucobot_libre_credentials (
      client_id text primary key,
      email text not null,
      password_ciphertext text not null,
      patient_id text,
      updated_at timestamptz not null default now()
    );

    create table if not exists glucobot_glucose_readings (
      id text primary key,
      client_id text not null,
      source text not null,
      value_mg_dl integer not null,
      trend_type text,
      sensor_trend text,
      reading_at timestamptz not null,
      raw_payload jsonb not null,
      created_at timestamptz not null default now()
    );

    create index if not exists glucobot_glucose_readings_client_time_idx
    on glucobot_glucose_readings (client_id, reading_at desc);
  `);
}

async function loadLibreSetup(pool, clientId) {
  const result = await pool.query(
    `select email, password_ciphertext, patient_id, updated_at
     from glucobot_libre_credentials
     where client_id = $1`,
    [clientId]
  );
  return result.rows[0] ?? null;
}

async function saveLibreSetup(pool, clientId, { email, password, patientId }) {
  await pool.query(
    `insert into glucobot_libre_credentials (client_id, email, password_ciphertext, patient_id, updated_at)
     values ($1, $2, $3, $4, now())
     on conflict (client_id)
     do update set email = excluded.email,
                   password_ciphertext = excluded.password_ciphertext,
                   patient_id = excluded.patient_id,
                   updated_at = now()`,
    [clientId, email, encryptSecret(password), patientId || null]
  );
}

async function saveLibreReading(pool, clientId, reading) {
  if (!reading) return;
  await pool.query(
    `insert into glucobot_glucose_readings
       (id, client_id, source, value_mg_dl, trend_type, sensor_trend, reading_at, raw_payload)
     values ($1, $2, 'libre_link_up', $3, $4, $5, $6, $7::jsonb)
     on conflict (id) do update set
       value_mg_dl = excluded.value_mg_dl,
       trend_type = excluded.trend_type,
       sensor_trend = excluded.sensor_trend,
       raw_payload = excluded.raw_payload`,
    [
      reading.id,
      clientId,
      reading.value,
      reading.trendType,
      reading.sensorTrend,
      reading.timestamp,
      JSON.stringify(reading.raw ?? {})
    ]
  );
}

async function loadLatestLibreReading(pool, clientId) {
  const result = await pool.query(
    `select value_mg_dl, trend_type, sensor_trend, reading_at, raw_payload
     from glucobot_glucose_readings
     where client_id = $1 and source = 'libre_link_up'
     order by reading_at desc
     limit 1`,
    [clientId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    value: row.value_mg_dl,
    trendType: row.trend_type,
    sensorTrend: row.sensor_trend,
    timestamp: new Date(row.reading_at).toISOString(),
    raw: row.raw_payload
  };
}

async function fetchLibreReading({ email, password, patientId }) {
  const { LibreLinkClient } = await import("libre-link-unofficial-api");
  const client = new LibreLinkClient({
    email,
    password,
    patientId: patientId || undefined,
    cache: false
  });
  await client.login();
  const reading = await client.read();
  return normalizeLibreReading(reading);
}

function normalizeLibreReading(reading) {
  const timestamp = normalizeLibreTimestamp(reading?.timestamp);
  const value = Math.round(Number(reading?.value));
  if (!Number.isFinite(value)) throw new Error("Libre did not return a glucose value.");
  const trendType = String(reading?.trendType ?? "");
  const id = `libre_${timestamp}_${value}_${trendType}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  return {
    id,
    value,
    trendType,
    sensorTrend: mapLibreTrendToSensorTrend(trendType),
    timestamp,
    raw: reading ?? {}
  };
}

function normalizeLibreTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function mapLibreTrendToSensorTrend(trendType) {
  const normalized = String(trendType).toLowerCase();
  if (normalized.includes("doubleup") || normalized.includes("singleup")) return "Rising fast";
  if (normalized.includes("fortyfiveup")) return "Rising";
  if (normalized.includes("doubledown") || normalized.includes("singledown")) return "Falling fast";
  if (normalized.includes("fortyfivedown")) return "Falling";
  return "Stable";
}

function encryptSecret(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getSecretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64")).join(".");
}

function decryptSecret(value) {
  const [ivRaw, tagRaw, encryptedRaw] = String(value).split(".");
  const decipher = createDecipheriv("aes-256-gcm", getSecretKey(), Buffer.from(ivRaw, "base64"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64")),
    decipher.final()
  ]);
  return decrypted.toString("utf8");
}

function getSecretKey() {
  return createHash("sha256").update(String(process.env.GLUCOBOT_SECRET)).digest();
}

async function replaceLogs(pool, clientId, logs) {
  const client = await pool.connect();

  try {
    await client.query("begin");
    await client.query("delete from glucobot_logs where client_id = $1", [clientId]);

    for (const log of logs) {
      if (!log?.id || !log?.type || !log?.createdAt) continue;
      await client.query(
        `insert into glucobot_logs (id, client_id, type, payload, created_at)
         values ($1, $2, $3, $4::jsonb, $5)`,
        [String(log.id), clientId, String(log.type), JSON.stringify(log.payload ?? {}), log.createdAt]
      );
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function getClientId(request) {
  const rawClientId = request.headers["x-glucobot-client-id"];
  const clientId = Array.isArray(rawClientId) ? rawClientId[0] : rawClientId;
  return String(clientId || "anonymous").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "anonymous";
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        reject(new Error("Image upload is too large."));
        request.destroy();
        return;
      }
      body += chunk;
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("Invalid JSON request."));
      }
    });
    request.on("error", reject);
  });
}

function isSupportedImageDataUrl(value) {
  return /^data:image\/(png|jpe?g|webp);base64,/i.test(value);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}
