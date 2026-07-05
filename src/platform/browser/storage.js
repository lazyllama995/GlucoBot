import { brand } from "../../core/brand.js";
import { defaultRatioSettings, mergeRatioSettings } from "../../core/doseCalculator.js";

const keys = {
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
