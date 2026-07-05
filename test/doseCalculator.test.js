import assert from "node:assert/strict";
import test from "node:test";
import { calculateCorrectionDose, defaultRatioSettings } from "../src/core/doseCalculator.js";

test("calculates the Excel insulin dose example", () => {
  const result = calculateCorrectionDose({
    glucose: 178,
    sensorTrend: "Rising",
    carbs: 48,
    exerciseHours: 1,
    exerciseIntensity: "Low",
    exerciseWhen: "Same day",
    ratios: defaultRatioSettings
  });

  assert.ok(Math.abs(result.insulinDose - 12.276) < 0.000001);
  assert.ok(Math.abs(result.exerciseDose - 11.0189376) < 0.000001);
  assert.equal(result.hasExercise, true);
  assert.ok(Math.abs(result.recommendedDose - 11.0189376) < 0.000001);
  assert.match(result.safetyNotes.at(-1), /care plan/);
});

test("uses the base formula when exercise hours is zero", () => {
  const result = calculateCorrectionDose({
    glucose: 178,
    sensorTrend: "Rising",
    carbs: 48,
    exerciseHours: 0,
    exerciseIntensity: "Low",
    exerciseWhen: "Same day",
    ratios: defaultRatioSettings
  });

  assert.equal(result.hasExercise, false);
  assert.ok(Math.abs(result.recommendedDose - 12.276) < 0.000001);
});
