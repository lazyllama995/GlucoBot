export const defaultRatioSettings = {
  carbRatio: 5,
  correctionFactor: 50,
  targetGlucose: 100,
  tresiba: 16,
  trendFactors: {
    "Rising fast": 1.2,
    Rising: 1.1,
    Stable: 1,
    Falling: 0.9,
    "Falling fast": 0.8
  },
  exerciseReductions: {
    High: { perHour: 0.1, minimum: 0.4 },
    Medium: { perHour: 0.07, minimum: 0.6 },
    Low: { perHour: 0.04, minimum: 0.75 }
  },
  exerciseTimingFactors: {
    "Just before": 0.7,
    "Same day": 0.85,
    "Day before": 0.9
  }
};

export const calculatorOptions = {
  sensorTrends: Object.keys(defaultRatioSettings.trendFactors),
  exerciseIntensities: Object.keys(defaultRatioSettings.exerciseReductions),
  exerciseTimings: Object.keys(defaultRatioSettings.exerciseTimingFactors)
};

export function calculateCorrectionDose({
  glucose,
  sensorTrend,
  carbs,
  exerciseHours = 0,
  exerciseIntensity = "Low",
  exerciseWhen = "Same day",
  ratios = defaultRatioSettings
}) {
  const ratioSettings = mergeRatioSettings(ratios);
  const trendFactor = ratioSettings.trendFactors[sensorTrend] ?? 1;
  const baseDose =
    Number(carbs) > 0
      ? Number(carbs) / Number(ratioSettings.carbRatio) +
        (Number(glucose) - Number(ratioSettings.targetGlucose)) / Number(ratioSettings.correctionFactor)
      : (Number(glucose) - Number(ratioSettings.targetGlucose)) / Number(ratioSettings.correctionFactor);
  const insulinDose = Math.max(0, baseDose * trendFactor);
  const exerciseReduction = getExerciseReduction(
    ratioSettings.exerciseReductions,
    exerciseIntensity,
    Number(exerciseHours)
  );
  const exerciseTimingFactor = ratioSettings.exerciseTimingFactors[exerciseWhen] ?? 1;
  const exerciseDose = Math.max(0, insulinDose * exerciseReduction * exerciseTimingFactor * trendFactor);
  const hasExercise = Number.isFinite(Number(exerciseHours)) && Number(exerciseHours) > 0;
  const recommendedDose = hasExercise ? exerciseDose : insulinDose;

  return {
    baseDose,
    trendFactor,
    insulinDose,
    exerciseReduction,
    exerciseTimingFactor,
    exerciseDose,
    hasExercise,
    recommendedDose,
    safetyNotes: buildSafetyNotes({ glucose, recommendedDose })
  };
}

export function mergeRatioSettings(ratios = {}) {
  return {
    ...defaultRatioSettings,
    ...ratios,
    trendFactors: {
      ...defaultRatioSettings.trendFactors,
      ...(ratios.trendFactors ?? {})
    },
    exerciseReductions: {
      High: {
        ...defaultRatioSettings.exerciseReductions.High,
        ...(ratios.exerciseReductions?.High ?? {})
      },
      Medium: {
        ...defaultRatioSettings.exerciseReductions.Medium,
        ...(ratios.exerciseReductions?.Medium ?? {})
      },
      Low: {
        ...defaultRatioSettings.exerciseReductions.Low,
        ...(ratios.exerciseReductions?.Low ?? {})
      }
    },
    exerciseTimingFactors: {
      ...defaultRatioSettings.exerciseTimingFactors,
      ...(ratios.exerciseTimingFactors ?? {})
    }
  };
}

function getExerciseReduction(reductions, intensity, hours) {
  const reduction = reductions[intensity];
  if (!reduction || !Number.isFinite(hours)) return 1;
  return Math.max(reduction.minimum, 1 - hours * reduction.perHour);
}

function buildSafetyNotes({ glucose, recommendedDose }) {
  const notes = [];
  if (Number(glucose) < 70) {
    notes.push("Low glucose detected. Treat the low before considering insulin.");
  }
  if (recommendedDose > 10) {
    notes.push("Large dose estimate. Review settings and recent insulin before acting.");
  }
  notes.push("Confirm with your care plan before dosing.");
  return notes;
}
