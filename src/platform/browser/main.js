import { brand } from "../../core/brand.js";
import { normalizeCarbVisionEstimate } from "../../core/carbVision.js";
import { calculatorOptions, calculateCorrectionDose } from "../../core/doseCalculator.js";
import { createLogEntry, logTypes } from "../../core/events.js";
import {
  loadDatabaseLogs,
  loadLibreStatus,
  loadLogs,
  loadSettings,
  prepareCalculatorLogStorage,
  saveDatabaseLogs,
  saveLibreSetup,
  saveLogs,
  saveSettings,
  syncLibreReading
} from "./storage.js";

const app = document.querySelector("#app");
prepareCalculatorLogStorage();
let activeTab = "calculator";
let logs = loadLogs().filter((log) => log.type === logTypes.dose);
let settings = loadSettings();
let doseInputs = {
  glucose: 100,
  sensorTrend: "Stable",
  carbs: 30,
  exerciseHours: "",
  exerciseIntensity: "",
  exerciseWhen: ""
};
let exerciseEnabled = Number(doseInputs.exerciseHours) > 0;
let annotationNote = "";
let doseResult = calculateCorrectionDose({ ...doseInputs, ratios: settings });
let manualDose = doseResult.recommendedDose;
let aiSuggestions = [];
let carbVision = {
  imageUrl: "",
  estimate: null,
  status: "idle",
  error: ""
};
let libreSync = {
  available: true,
  configured: false,
  email: "",
  patientId: "",
  latest: null,
  status: "idle",
  message: "Add your Libre Link Up account to sync glucose readings."
};
let logbookStorage = {
  mode: "device",
  message: "Saved on this device"
};

saveLogs(logs);
render();
hydrateLogsFromDatabase();
hydrateLibreStatus();

function render() {
  app.innerHTML = `
    <header class="navbar">
      <div class="brand-lockup">
        <img src="./src/assets/glucobot-icon.png" alt="" class="brand-icon" />
        <div>
          <strong>${brand.ui.navbarTitle}</strong>
        </div>
      </div>
    </header>

    <main>
      ${renderActiveTab()}
    </main>

    <nav class="app-tabs" role="tablist" aria-label="GlucoBot sections">
      ${renderTabButton("calculator", "Calculator", "./src/assets/tab-calculator.png")}
      ${renderTabButton("carbVision", "CarbScanner", "./src/assets/tab-camera.png")}
      ${renderTabButton("log", "Logbook", "./src/assets/tab-logbook.png")}
      ${renderTabButton("ratios", "Ratios", "./src/assets/tab-ratios.png")}
      ${renderTabButton("synchLibre", "SynchLibre", "./src/assets/tab-synch-libre.png")}
    </nav>
  `;

  bindEvents();
}

function renderTabButton(tab, label, icon) {
  const isActive = activeTab === tab;
  return `
    <button class="tab-button ${isActive ? "active" : ""}" data-tab="${tab}" role="tab" aria-selected="${isActive}" aria-label="${label}">
      <img src="${icon}" alt="" />
      <span>${label}</span>
    </button>
  `;
}

function renderActiveTab() {
  if (activeTab === "calculator") return renderCalculatorTab();
  if (activeTab === "ratios") return renderRatiosTab();
  if (activeTab === "carbVision") return renderCarbVisionTab();
  if (activeTab === "synchLibre") return renderSynchLibreTab();
  return renderLogTab();
}

function renderCalculatorTab() {
  return `
    <section class="calculator-shell" id="calculator-panel" role="tabpanel">
      ${renderDoseCalculator()}
    </section>
  `;
}

function renderDoseCalculator() {
  return `
    <article class="dose-calculator" aria-labelledby="dose-title">
      ${renderTabTitle("Calculator")}
      <form id="dose-form" class="calculator-form">
        <section class="calculator-section">
          <h2>Meal and glucose</h2>
          <div class="field-grid primary-fields">
            <label class="calc-field">
              <span>Glucose</span>
              <input name="glucose" type="number" min="0" value="${doseInputs.glucose}" />
              <small>mg/dL</small>
            </label>
            <label class="calc-field">
              <span>Carbs</span>
              <input name="carbs" type="number" min="0" value="${doseInputs.carbs}" />
              <small>grams</small>
            </label>
            <label class="calc-field">
              <span>Sensor trend</span>
              <select name="sensorTrend">
                ${renderOptions(calculatorOptions.sensorTrends, doseInputs.sensorTrend)}
              </select>
              <small>trend factor</small>
            </label>
          </div>
        </section>
        <section class="calculator-section exercise-section">
          <label class="exercise-toggle">
            <input name="exerciseEnabled" type="checkbox" ${exerciseEnabled ? "checked" : ""} />
            <span>Exercise</span>
          </label>
          ${
            exerciseEnabled
              ? `<div class="field-grid exercise-row">
                  <label class="calc-field">
                    <span>Exercise</span>
                    <input name="exerciseHours" type="number" min="0" step="0.25" value="${doseInputs.exerciseHours}" />
                    <small>hours</small>
                  </label>
                  <label class="calc-field">
                    <span>Exercise intensity</span>
                    <select name="exerciseIntensity">
                      ${renderOptions(calculatorOptions.exerciseIntensities, doseInputs.exerciseIntensity, { includeBlank: true })}
                    </select>
                    <small>reduction</small>
                  </label>
                  <label class="calc-field">
                    <span>Exercise when</span>
                    <select name="exerciseWhen">
                      ${renderOptions(calculatorOptions.exerciseTimings, doseInputs.exerciseWhen, { includeBlank: true })}
                    </select>
                    <small>timing impact</small>
                  </label>
                </div>`
              : ""
          }
        </section>
        <section class="calculator-section">
          <h2>Annotation</h2>
          <label class="annotation-field">
            <textarea name="annotation" rows="3" placeholder="Optional note">${annotationNote}</textarea>
          </label>
        </section>
        <div class="dose-summary" aria-label="Insulin dose">
          <div>
            <span>Insulin dose</span>
            <label class="dose-edit">
              <input form="dose-form" name="finalDose" type="number" min="0" step="0.01" value="${formatDose(manualDose)}" />
              <small>units</small>
            </label>
          </div>
          <strong>${doseResult.hasExercise ? "Exercise adjusted" : "Base formula"}</strong>
        </div>
        <div class="calculator-actions">
          <button type="submit">Calculate</button>
          <button type="button" id="annotate-button" class="secondary-action">Annotate</button>
        </div>
      </form>
    </article>
  `;
}

function renderRatiosTab() {
  return `
    <section class="ratios-shell" id="ratios-panel" role="tabpanel">
      ${renderTabTitle("Ratios")}
      <form id="ratios-form" class="ratios-form">
        <section class="ratio-section">
          <h2>Ratios</h2>
          ${renderRatioInput("Insulin/Carbs", "carbRatio", settings.carbRatio, "Carb g.")}
          ${renderRatioInput("Insulin/Correction", "correctionFactor", settings.correctionFactor, "mg/dL")}
          ${renderRatioInput("Target glucose", "targetGlucose", settings.targetGlucose, "mg/dL")}
          ${renderRatioInput("Tresiba", "tresiba", settings.tresiba, "units")}
        </section>

        <section class="ratio-section wide">
          <h2>Reductions</h2>
          <h3>Exercise intensity</h3>
          ${renderRatioInput("High: Reduce by 10% per hour", "reductionHighPerHour", settings.exerciseReductions.High.perHour, "", "0.01")}
          ${renderRatioInput("Medium: Reduce by 7% per hour", "reductionMediumPerHour", settings.exerciseReductions.Medium.perHour, "", "0.01")}
          ${renderRatioInput("Low: Reduce by 4% per hour", "reductionLowPerHour", settings.exerciseReductions.Low.perHour, "", "0.01")}
          <h3>Minimum reduction limit by intensity</h3>
          ${renderRatioInput("High: Never below 40%", "reductionHighMinimum", settings.exerciseReductions.High.minimum, "", "0.01")}
          ${renderRatioInput("Medium: Never below 60%", "reductionMediumMinimum", settings.exerciseReductions.Medium.minimum, "", "0.01")}
          ${renderRatioInput("Low: Never below 75%", "reductionLowMinimum", settings.exerciseReductions.Low.minimum, "", "0.01")}
          <h3>Exercise timing impact</h3>
          ${renderRatioInput("Just before", "timingJustBefore", settings.exerciseTimingFactors["Just before"], "", "0.01")}
          ${renderRatioInput("Same day", "timingSameDay", settings.exerciseTimingFactors["Same day"], "", "0.01")}
          ${renderRatioInput("Day before", "timingDayBefore", settings.exerciseTimingFactors["Day before"], "", "0.01")}
        </section>

        <section class="ratio-section">
          <h2>Sensor trend</h2>
          ${renderRatioInput("Rising fast", "trendRisingFast", settings.trendFactors["Rising fast"], "", "0.01")}
          ${renderRatioInput("Rising", "trendRising", settings.trendFactors.Rising, "", "0.01")}
          ${renderRatioInput("Stable", "trendStable", settings.trendFactors.Stable, "", "0.01")}
          ${renderRatioInput("Falling", "trendFalling", settings.trendFactors.Falling, "", "0.01")}
          ${renderRatioInput("Falling fast", "trendFallingFast", settings.trendFactors["Falling fast"], "", "0.01")}
        </section>

        <button type="submit">Save ratios</button>
      </form>
    </section>
  `;
}

function renderLogTab() {
  return `
    <section class="log-shell" id="log-panel" role="tabpanel">
      <div class="log-header">
        ${renderTabTitle("Logbook")}
        <div class="log-actions">
          <button type="button" id="ai-suggest-button">AI Suggest</button>
        </div>
      </div>
      <div class="storage-status ${logbookStorage.mode === "database" ? "synced" : ""}">
        ${logbookStorage.message}
      </div>
      ${renderAiSuggestions()}
      ${
        logs.length
          ? `<div class="log-list">${logs.map(renderLogEntry).join("")}</div>`
          : `<div class="empty-log">
              <strong>No annotations yet</strong>
              <span>Calculate a dose, then use Annotate to save it here with time and date.</span>
            </div>`
      }
      <div class="log-footer-actions">
        <button type="button" id="reset-log-button" class="danger-action">Reset data</button>
        <button type="button" id="export-csv-button" class="secondary-action">Export CSV</button>
      </div>
    </section>
  `;
}

function renderCarbVisionTab() {
  return `
    <section class="vision-shell" id="carb-vision-panel" role="tabpanel">
      ${renderTabTitle("CarbScanner")}
      <form id="carb-vision-form" class="vision-form">
        <div class="vision-preview-panel">
          ${
            carbVision.imageUrl
              ? `<img class="vision-preview" src="${carbVision.imageUrl}" alt="Meal preview" />`
              : `<div class="vision-placeholder">
                  <strong>Meal photo</strong>
                  <span>Upload a picture, then let GlucoBot estimate the visible carbs.</span>
                </div>`
          }
        </div>
        <div class="vision-controls">
          <label class="calc-field">
            <span>Picture</span>
            <div class="photo-actions">
              <label class="file-action">
                Upload photo
                <input id="carb-image-input" name="mealImage" type="file" accept="image/*" />
              </label>
              <label class="file-action camera-action">
                Take photo
                <input id="carb-camera-input" name="cameraImage" type="file" accept="image/*" capture="environment" />
              </label>
            </div>
            <small>meal photo</small>
          </label>
          <div class="vision-result" aria-live="polite">
            <span>Approx carbs</span>
            <strong>${carbVision.estimate == null ? "--" : `${carbVision.estimate.totalCarbs}g`}</strong>
            <small>${renderCarbVisionStatus()}</small>
          </div>
          ${renderCarbVisionBreakdown()}
          <div class="vision-actions">
            <button type="submit" ${!carbVision.imageUrl || carbVision.status === "analyzing" ? "disabled" : ""}>
              ${carbVision.status === "analyzing" ? "Analyzing..." : "Analyze photo"}
            </button>
            <button type="button" id="use-carb-estimate-button" class="secondary-action" ${carbVision.estimate == null ? "disabled" : ""}>
              Use in calculator
            </button>
          </div>
        </div>
      </form>
      <div class="calculator-safety">
        <p>Photo carb estimates are approximate.</p>
      </div>
    </section>
  `;
}

function renderSynchLibreTab() {
  const disabled = !libreSync.available || libreSync.status === "saving";
  return `
    <section class="synch-shell" id="synch-libre-panel" role="tabpanel">
      ${renderTabTitle("SynchLibre")}
      <div class="storage-status ${libreSync.configured ? "synced" : ""} ${!libreSync.available ? "warning-status" : ""}">
        ${escapeHtml(libreSync.message)}
      </div>
      <form id="synch-libre-form" class="synch-form">
        <section class="calculator-section">
          <h2>Libre Link Up account</h2>
          <div class="field-grid primary-fields">
            <label class="calc-field">
              <span>Email</span>
              <input name="libreEmail" type="email" autocomplete="username" value="${escapeHtml(libreSync.email)}" ${disabled ? "disabled" : ""} />
              <small>Libre Link Up</small>
            </label>
            <label class="calc-field">
              <span>Password</span>
              <input name="librePassword" type="password" autocomplete="current-password" ${disabled ? "disabled" : ""} />
              <small>${libreSync.configured ? "enter to update" : "required"}</small>
            </label>
            <label class="calc-field">
              <span>Patient ID</span>
              <input name="librePatientId" type="text" value="${escapeHtml(libreSync.patientId)}" ${disabled ? "disabled" : ""} />
              <small>optional</small>
            </label>
          </div>
        </section>
        <div class="synch-actions">
          <button type="submit" ${disabled ? "disabled" : ""}>
            ${libreSync.status === "saving" ? "Saving..." : "Save and test"}
          </button>
          <button type="button" id="sync-libre-button" class="secondary-action" ${!libreSync.available || !libreSync.configured || libreSync.status === "syncing" ? "disabled" : ""}>
            ${libreSync.status === "syncing" ? "Syncing..." : "Sync Libre now"}
          </button>
        </div>
      </form>
      ${renderLibreLatest()}
      <div class="calculator-safety">
        <p>SynchLibre uses an unofficial Libre Link Up API. Confirm readings in your official Libre app.</p>
      </div>
    </section>
  `;
}

function renderTabTitle(title) {
  return `
    <div class="section-heading tab-title">
      <h1>${title}</h1>
    </div>
  `;
}

function renderLibreLatest() {
  if (!libreSync.latest) {
    return `
      <div class="empty-log">
        <strong>No Libre reading synced yet</strong>
        <span>Save your account, then sync Libre to pull the latest glucose value.</span>
      </div>
    `;
  }

  return `
    <div class="libre-reading-card">
      <span>Latest Libre glucose</span>
      <strong>${libreSync.latest.value} mg/dL</strong>
      <small>${escapeHtml(libreSync.latest.sensorTrend)}${libreSync.latest.timestamp ? `, ${formatDateTime(new Date(libreSync.latest.timestamp))}` : ""}</small>
      <button type="button" id="use-libre-reading-button" class="secondary-action">Use in calculator</button>
    </div>
  `;
}

function renderCarbVisionStatus() {
  if (carbVision.status === "analyzing") return "GlucoBot is analyzing the meal photo";
  if (carbVision.error) return escapeHtml(carbVision.error);
  if (carbVision.estimate) return `${carbVision.estimate.confidence} confidence. Confirm before dosing.`;
  return "Upload a meal photo to estimate carbs";
}

function renderCarbVisionBreakdown() {
  if (carbVision.error) {
    return `<div class="vision-message danger-message">${escapeHtml(carbVision.error)}</div>`;
  }

  if (!carbVision.estimate) return "";

  return `
    <div class="vision-breakdown">
      <h2>Detected foods</h2>
      ${
        carbVision.estimate.foods.length
          ? `<ul>
              ${carbVision.estimate.foods
                .map(
                  (food, index) => `
                    <li class="vision-food-row">
                      <div class="vision-food-name">
                        <span>${escapeHtml(food.name)}${food.portion ? `, ${escapeHtml(food.portion)}` : ""}</span>
                      </div>
                      <label class="food-grams-field">
                        <input class="food-grams-input" data-food-index="${index}" type="number" min="0" step="1" value="${food.grams}" />
                        <small>g</small>
                      </label>
                      <strong>${food.carbs}g carbs</strong>
                    </li>
                  `
                )
                .join("")}
            </ul>`
          : `<p>No individual foods returned. Use the total as a rough estimate.</p>`
      }
      ${carbVision.estimate.notes ? `<p>${escapeHtml(carbVision.estimate.notes)}</p>` : ""}
    </div>
  `;
}

function renderAiSuggestions() {
  if (!aiSuggestions.length) return "";
  return `
    <aside class="ai-suggestions" aria-live="polite">
      <h2>AI suggestions</h2>
      <ul>
        ${aiSuggestions.map((suggestion) => `<li>${suggestion}</li>`).join("")}
      </ul>
    </aside>
  `;
}

function renderLogEntry(log) {
  const created = new Date(log.createdAt);
  const payload = log.payload;
  return `
    <article class="log-entry">
      <div class="log-entry-header">
        <time datetime="${log.createdAt}">${formatDateTime(created)}</time>
        <strong>${formatDose(payload.result.recommendedDose)}u</strong>
      </div>
      <div class="log-metrics">
        <span>Glucose: ${payload.inputs.glucose} mg/dL</span>
        <span>Trend: ${payload.inputs.sensorTrend}</span>
        <span>Carbs: ${payload.inputs.carbs}g</span>
        <span>Exercise: ${payload.inputs.exerciseHours}h ${payload.inputs.exerciseIntensity}</span>
        <span>Formula: ${payload.result.hasExercise ? "Exercise adjusted" : "Base"}</span>
      </div>
      ${payload.note ? `<p>${escapeHtml(payload.note)}</p>` : ""}
    </article>
  `;
}

function bindEvents() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activeTab = button.dataset.tab;
      render();
    });
  });

  document.querySelector("#dose-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    updateDoseFromForm(event.currentTarget, { resetManualDose: true });
    render();
  });

  document.querySelector('input[name="exerciseEnabled"]')?.addEventListener("change", (event) => {
    exerciseEnabled = event.currentTarget.checked;
    if (!exerciseEnabled) {
      doseInputs = {
        ...doseInputs,
        exerciseHours: "",
        exerciseIntensity: "",
        exerciseWhen: ""
      };
      doseResult = calculateCorrectionDose({ ...doseInputs, ratios: settings });
      manualDose = doseResult.recommendedDose;
    }
    render();
  });

  document.querySelector("#annotate-button")?.addEventListener("click", () => {
    const form = document.querySelector("#dose-form");
    updateDoseFromForm(form, { resetManualDose: false });
    if (shouldWarnToRoundDose(manualDose)) {
      window.alert("Please round the insulin dose.");
      return;
    }
    logs = [
      createLogEntry(logTypes.dose, {
        inputs: { ...doseInputs },
        result: {
          recommendedDose: manualDose,
          calculatedDose: doseResult.recommendedDose,
          hasExercise: doseResult.hasExercise
        },
        note: annotationNote.trim()
      }),
      ...logs
    ];
    persistLogs();
    annotationNote = "";
    activeTab = "log";
    render();
  });

  document.querySelector("#ratios-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    updateSettingsFromForm(event.currentTarget);
    doseResult = calculateCorrectionDose({ ...doseInputs, ratios: settings });
    manualDose = doseResult.recommendedDose;
    activeTab = "calculator";
    render();
  });

  document.querySelector("#reset-log-button")?.addEventListener("click", () => {
    logs = [];
    aiSuggestions = [];
    persistLogs();
    render();
  });

  document.querySelector("#export-csv-button")?.addEventListener("click", () => {
    exportLogsAsCsv();
  });

  document.querySelector("#ai-suggest-button")?.addEventListener("click", () => {
    aiSuggestions = generateAiSuggestions(logs);
    render();
  });

  document.querySelector("#carb-image-input")?.addEventListener("change", handleCarbVisionImageSelection);
  document.querySelector("#carb-camera-input")?.addEventListener("change", handleCarbVisionImageSelection);
  document.querySelectorAll(".food-grams-input").forEach((input) => {
    input.addEventListener("change", (event) => {
      updateCarbVisionFoodGrams(Number(event.currentTarget.dataset.foodIndex), event.currentTarget.value);
      render();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      event.currentTarget.blur();
    });
  });

  document.querySelector("#carb-vision-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    analyzeCarbVisionPhoto();
  });

  document.querySelector("#use-carb-estimate-button")?.addEventListener("click", () => {
    if (carbVision.estimate == null) return;
    doseInputs = {
      ...doseInputs,
      carbs: carbVision.estimate.totalCarbs
    };
    doseResult = calculateCorrectionDose({ ...doseInputs, ratios: settings });
    manualDose = doseResult.recommendedDose;
    activeTab = "calculator";
    render();
  });

  document.querySelector("#synch-libre-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveSynchLibreSetup(event.currentTarget);
  });

  document.querySelector("#sync-libre-button")?.addEventListener("click", () => {
    syncSynchLibreReading();
  });

  document.querySelector("#use-libre-reading-button")?.addEventListener("click", () => {
    if (!libreSync.latest) return;
    doseInputs = {
      ...doseInputs,
      glucose: libreSync.latest.value,
      sensorTrend: libreSync.latest.sensorTrend || "Stable"
    };
    doseResult = calculateCorrectionDose({ ...doseInputs, ratios: settings });
    manualDose = doseResult.recommendedDose;
    activeTab = "calculator";
    render();
  });
}

function handleCarbVisionImageSelection(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      carbVision = {
        ...carbVision,
        imageUrl: String(reader.result ?? ""),
        estimate: null,
        error: "",
        status: "idle"
      };
      render();
    });
    reader.readAsDataURL(file);
}

function updateCarbVisionFoodGrams(index, value) {
  if (!carbVision.estimate || !Number.isInteger(index)) return;
  const grams = Math.max(0, Math.round(Number(value) || 0));
  const foods = carbVision.estimate.foods.map((food, foodIndex) => {
    if (foodIndex !== index) return food;
    const carbsPerGram = food.carbsPerGram || (food.grams > 0 ? food.carbs / food.grams : 0);
    return {
      ...food,
      grams,
      carbs: Math.round(grams * carbsPerGram)
    };
  });

  carbVision = {
    ...carbVision,
    estimate: {
      ...carbVision.estimate,
      foods,
      totalCarbs: foods.reduce((sum, food) => sum + food.carbs, 0)
    }
  };
}

async function hydrateLogsFromDatabase() {
  try {
    const databaseLogs = (await loadDatabaseLogs()).filter((log) => log.type === logTypes.dose);
    if (databaseLogs.length) {
      logs = databaseLogs;
      saveLogs(logs);
    } else if (logs.length) {
      await saveDatabaseLogs(logs);
    }
    logbookStorage = {
      mode: "database",
      message: "Saved in GlucoBot database"
    };
    render();
  } catch {
    logbookStorage = {
      mode: "device",
      message: "Saved on this device"
    };
    render();
  }
}

async function hydrateLibreStatus() {
  try {
    const payload = await loadLibreStatus();
    libreSync = {
      ...libreSync,
      available: true,
      configured: Boolean(payload.configured),
      email: payload.email ?? "",
      patientId: payload.patientId ?? "",
      message: payload.configured ? "Libre account saved. Ready to sync." : libreSync.message
    };
    if (activeTab === "synchLibre") render();
  } catch (error) {
    libreSync = {
      ...libreSync,
      available: false,
      status: "unavailable",
      message:
        error.message ||
        "SynchLibre needs the GlucoBot database. In Render, sync the Blueprint and confirm DATABASE_URL is connected."
    };
    if (activeTab === "synchLibre") render();
  }
}

async function saveSynchLibreSetup(formElement) {
  if (!libreSync.available) return;
  const form = new FormData(formElement);
  libreSync = {
    ...libreSync,
    status: "saving",
    message: "Testing Libre Link Up account..."
  };
  render();

  try {
    const payload = await saveLibreSetup({
      email: form.get("libreEmail"),
      password: form.get("librePassword"),
      patientId: form.get("librePatientId")
    });
    libreSync = {
      ...libreSync,
      configured: true,
      email: form.get("libreEmail") ?? "",
      patientId: form.get("librePatientId") ?? "",
      latest: payload.reading ?? null,
      status: "ready",
      message: "Libre account saved and latest glucose synced."
    };
  } catch (error) {
    libreSync = {
      ...libreSync,
      status: "error",
      message: error.message || "Could not save Libre setup."
    };
  }

  render();
}

async function syncSynchLibreReading() {
  if (!libreSync.available) return;
  libreSync = {
    ...libreSync,
    status: "syncing",
    message: "Syncing latest Libre glucose..."
  };
  render();

  try {
    const payload = await syncLibreReading();
    libreSync = {
      ...libreSync,
      latest: payload.reading ?? null,
      status: "ready",
      message: "Latest Libre glucose synced."
    };
  } catch (error) {
    libreSync = {
      ...libreSync,
      status: "error",
      message: error.message || "Could not sync Libre glucose."
    };
  }

  render();
}

function persistLogs() {
  saveLogs(logs);
  saveDatabaseLogs(logs)
    .then(() => {
      logbookStorage = {
        mode: "database",
        message: "Saved in GlucoBot database"
      };
      if (activeTab === "log") render();
    })
    .catch(() => {
      logbookStorage = {
        mode: "device",
        message: "Saved on this device"
      };
      if (activeTab === "log") render();
    });
}

function updateDoseFromForm(formElement, { resetManualDose } = { resetManualDose: true }) {
  const form = new FormData(formElement);
  exerciseEnabled = form.get("exerciseEnabled") === "on";
  const rawExerciseHours = exerciseEnabled ? form.get("exerciseHours") : "";
  const exerciseHours = rawExerciseHours === "" || rawExerciseHours == null ? "" : Number(rawExerciseHours);
  const hasExercise = exerciseEnabled && Number.isFinite(Number(exerciseHours)) && Number(exerciseHours) > 0;
  const payload = {
    glucose: Number(form.get("glucose")),
    sensorTrend: form.get("sensorTrend"),
    carbs: Number(form.get("carbs")),
    exerciseHours,
    exerciseIntensity: hasExercise ? form.get("exerciseIntensity") : "",
    exerciseWhen: hasExercise ? form.get("exerciseWhen") : ""
  };
  doseInputs = payload;
  annotationNote = form.get("annotation") ?? "";
  doseResult = calculateCorrectionDose({ ...payload, ratios: settings });
  const rawDose = document.querySelector('input[name="finalDose"]')?.value ?? "";
  const enteredDose = Number(rawDose);
  manualDose =
    resetManualDose || rawDose === "" || !Number.isFinite(enteredDose) ? doseResult.recommendedDose : enteredDose;
}

function shouldWarnToRoundDose(value) {
  return Number.isFinite(value) && Math.abs(value - Math.round(value)) > 0.000001;
}

function updateSettingsFromForm(formElement) {
  const form = new FormData(formElement);
  settings = {
    carbRatio: Number(form.get("carbRatio")),
    correctionFactor: Number(form.get("correctionFactor")),
    targetGlucose: Number(form.get("targetGlucose")),
    tresiba: Number(form.get("tresiba")),
    exerciseReductions: {
      High: {
        perHour: Number(form.get("reductionHighPerHour")),
        minimum: Number(form.get("reductionHighMinimum"))
      },
      Medium: {
        perHour: Number(form.get("reductionMediumPerHour")),
        minimum: Number(form.get("reductionMediumMinimum"))
      },
      Low: {
        perHour: Number(form.get("reductionLowPerHour")),
        minimum: Number(form.get("reductionLowMinimum"))
      }
    },
    exerciseTimingFactors: {
      "Just before": Number(form.get("timingJustBefore")),
      "Same day": Number(form.get("timingSameDay")),
      "Day before": Number(form.get("timingDayBefore"))
    },
    trendFactors: {
      "Rising fast": Number(form.get("trendRisingFast")),
      Rising: Number(form.get("trendRising")),
      Stable: Number(form.get("trendStable")),
      Falling: Number(form.get("trendFalling")),
      "Falling fast": Number(form.get("trendFallingFast"))
    }
  };
  saveSettings(settings);
}

async function analyzeCarbVisionPhoto() {
  if (!carbVision.imageUrl) return;
  carbVision = {
    ...carbVision,
    status: "analyzing",
    error: ""
  };
  render();

  try {
    const response = await fetch("/api/carb-vision", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ imageDataUrl: carbVision.imageUrl })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.setup || payload.error || "Unable to analyze this meal photo.");
    }

    carbVision = {
      ...carbVision,
      estimate: normalizeCarbVisionEstimate(payload.estimate),
      status: "ready",
      error: ""
    };
  } catch (error) {
    carbVision = {
      ...carbVision,
      status: "error",
      error: error.message || "Unable to analyze this meal photo."
    };
  }

  render();
}

function renderOptions(options, selected, { includeBlank = false } = {}) {
  const optionMarkup = options
    .map((option) => `<option value="${option}"${option === selected ? " selected" : ""}>${option}</option>`)
    .join("");
  return `${includeBlank ? `<option value=""${selected === "" ? " selected" : ""}></option>` : ""}${optionMarkup}`;
}

function exportLogsAsCsv() {
  const csv = buildCsv(logs);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `glucobot-log-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function buildCsv(logEntries) {
  const headers = [
    "created_at",
    "dose_units",
    "calculated_dose_units",
    "formula",
    "glucose_mg_dl",
    "sensor_trend",
    "carbs_g",
    "exercise_hours",
    "exercise_intensity",
    "exercise_when",
    "annotation"
  ];
  const rows = logEntries.map((log) => {
    const payload = log.payload;
    return [
      log.createdAt,
      formatDose(payload.result.recommendedDose),
      payload.result.calculatedDose == null ? "" : formatDose(payload.result.calculatedDose),
      payload.result.hasExercise ? "Exercise adjusted" : "Base",
      payload.inputs.glucose,
      payload.inputs.sensorTrend,
      payload.inputs.carbs,
      payload.inputs.exerciseHours,
      payload.inputs.exerciseIntensity,
      payload.inputs.exerciseWhen,
      payload.note ?? ""
    ];
  });
  return [headers, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}

function generateAiSuggestions(logEntries) {
  if (!logEntries.length) {
    return ["No log data yet. Annotate a few calculations first, then run AI Suggest again."];
  }

  const suggestions = [];
  const entries = logEntries.map((log) => log.payload);
  const avgGlucose = average(entries.map((entry) => Number(entry.inputs.glucose)));
  const avgDose = average(entries.map((entry) => Number(entry.result.recommendedDose)));
  const exerciseEntries = entries.filter((entry) => Number(entry.inputs.exerciseHours) > 0);
  const manualOverrides = entries.filter(
    (entry) =>
      Number.isFinite(Number(entry.result.calculatedDose)) &&
      Math.abs(Number(entry.result.recommendedDose) - Number(entry.result.calculatedDose)) >= 0.25
  );

  suggestions.push(`Reviewed ${entries.length} logged calculation${entries.length === 1 ? "" : "s"}.`);

  if (manualOverrides.length >= 2) {
    const averageDelta = average(
      manualOverrides.map((entry) => Number(entry.result.recommendedDose) - Number(entry.result.calculatedDose))
    );
    suggestions.push(
      `You manually changed the dose by ${formatSignedDose(averageDelta)}u on average across ${manualOverrides.length} logs. If this pattern is intentional, consider reviewing Insulin/Carbs or Insulin/Correction in Ratios.`
    );
  } else {
    suggestions.push("Not enough repeated manual dose changes yet to suggest a ratio adjustment.");
  }

  if (exerciseEntries.length) {
    const exerciseShare = Math.round((exerciseEntries.length / entries.length) * 100);
    suggestions.push(
      `${exerciseShare}% of logged calculations include exercise. Compare post-exercise glucose before changing reduction limits.`
    );
  } else {
    suggestions.push("No exercise-adjusted logs yet. Keep exercise at 0 for base formula calculations.");
  }

  if (avgGlucose > settings.targetGlucose + 30) {
    suggestions.push(
      `Average logged glucose is ${Math.round(avgGlucose)} mg/dL, above the ${settings.targetGlucose} mg/dL target. If this persists, review your correction ratio with your care plan.`
    );
  } else if (avgGlucose < settings.targetGlucose - 20) {
    suggestions.push(
      `Average logged glucose is ${Math.round(avgGlucose)} mg/dL, below the ${settings.targetGlucose} mg/dL target. Be cautious with stronger correction settings.`
    );
  } else {
    suggestions.push(`Average logged glucose is ${Math.round(avgGlucose)} mg/dL, close to target.`);
  }

  suggestions.push(`Average annotated dose is ${formatDose(avgDose)}u.`);
  return suggestions;
}

function average(values) {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (!finiteValues.length) return 0;
  return finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length;
}

function formatSignedDose(value) {
  const formatted = formatDose(Math.abs(value));
  return value >= 0 ? `+${formatted}` : `-${formatted}`;
}

function escapeCsvCell(value) {
  const text = String(value ?? "");
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function renderRatioInput(label, name, value, unit = "", step = "1") {
  return `
    <label class="calc-field ratio-row">
      <span>${label}</span>
      <input name="${name}" type="number" step="${step}" value="${value}" />
      <small>${unit || "factor"}</small>
    </label>
  `;
}

function formatDose(value) {
  return Number(value).toFixed(2);
}

function formatDateTime(date) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
