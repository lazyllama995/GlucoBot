import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeCarbVisionEstimate } from "../src/core/carbVision.js";

test("normalizes AI carb vision estimates", () => {
  const estimate = normalizeCarbVisionEstimate({
    foods: [
      { name: "Rice", portion: "1 cup", carbs: 44.6 },
      { name: "Chicken", portion: "120g", carbs: -2 }
    ],
    totalCarbs: 46.2,
    confidence: "medium",
    notes: "Approximate portion."
  });

  assert.deepEqual(estimate, {
    foods: [
      { name: "Rice", portion: "1 cup", carbs: 45 },
      { name: "Chicken", portion: "120g", carbs: 0 }
    ],
    totalCarbs: 46,
    confidence: "medium",
    notes: "Approximate portion."
  });
});

test("sums food carbs when total is missing", () => {
  const estimate = normalizeCarbVisionEstimate({
    foods: [
      { name: "Bread", portion: "2 slices", carbs: 30 },
      { name: "Apple", portion: "small", carbs: 15 }
    ],
    confidence: "unknown"
  });

  assert.equal(estimate.totalCarbs, 45);
  assert.equal(estimate.confidence, "low");
});
