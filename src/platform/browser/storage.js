import { brand } from "../../core/brand.js";
import { defaultRatioSettings, mergeRatioSettings } from "../../core/doseCalculator.js";

const keys = {
  clientId: `${brand.databasePrefix}client_id`,
  logs: `${brand.databasePrefix}logs`,
  settings: `${brand.databasePrefix}settings`,
  dataMode: `${brand.databasePrefix}data_mode`
};

const calculatorLogMode = "calculator_log_v2";

export const defaultSettings = defaultRatioSettings;

export function loadLogs() {
  return readJson(keys.logs, []);
}

export function prepareCalculatorLogStorage() {
  if (localStorage.getItem(keys.dataMode) === calculatorLogMode) return;
  localStorage.setItem(keys.logs, JSON.stringify([]));
  localStorage.setItem(keys.dataMode, calculatorLogMode);
}

export function saveLogs(logs) {
  localStorage.setItem(keys.logs, JSON.stringify(logs));
}

export function getClientId() {
  const existing = localStorage.getItem(keys.clientId);
  if (existing) return existing;

  const clientId =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
  localStorage.setItem(keys.clientId, clientId);
  return clientId;
}

export async function loadDatabaseLogs() {
  const response = await fetch("/api/logs", {
    headers: {
      "x-glucobot-client-id": getClientId()
    }
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Database logs are unavailable.");
  }
  return Array.isArray(payload.logs) ? payload.logs : [];
}

export async function saveDatabaseLogs(logs) {
  const response = await fetch("/api/logs", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "x-glucobot-client-id": getClientId()
    },
    body: JSON.stringify({ logs })
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Database logs could not be saved.");
  }
  return payload;
}

export function loadSettings() {
  return mergeRatioSettings(readJson(keys.settings, {}));
}

export function saveSettings(settings) {
  localStorage.setItem(keys.settings, JSON.stringify(settings));
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
