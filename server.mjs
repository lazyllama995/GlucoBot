import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCarbVisionEstimate } from "./src/core/carbVision.js";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT ?? 4173);
const maxBodyBytes = 8 * 1024 * 1024;
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

const server = createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/api/carb-vision") {
      await handleCarbVision(request, response);
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
                "Analyze this meal photo for diabetes carb counting. Estimate visible foods, portions, and total carbohydrates in grams. Return JSON only with foods, totalCarbs, confidence, and notes. Do not recommend insulin or dosing."
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
                    carbs: { type: "number" }
                  },
                  required: ["name", "portion", "carbs"]
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
