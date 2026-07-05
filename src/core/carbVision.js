export const fallbackCarbVisionEstimate = {
  foods: [
    {
      name: "Mixed meal",
      portion: "medium visual portion",
      carbs: 40
    }
  ],
  totalCarbs: 40,
  confidence: "low",
  notes: "Fallback estimate. Use AI vision or edit the carbs before calculating insulin."
};

export function normalizeCarbVisionEstimate(value) {
  const estimate = value && typeof value === "object" ? value : {};
  const foods = Array.isArray(estimate.foods)
    ? estimate.foods.map(normalizeFoodEstimate).filter((food) => food.name || food.carbs > 0)
    : [];
  const totalCarbs = toNonNegativeNumber(estimate.totalCarbs);

  return {
    foods,
    totalCarbs: totalCarbs ?? sumFoodCarbs(foods),
    confidence: normalizeConfidence(estimate.confidence),
    notes: String(estimate.notes ?? "").trim()
  };
}

function normalizeFoodEstimate(food) {
  return {
    name: String(food?.name ?? "").trim(),
    portion: String(food?.portion ?? "").trim(),
    carbs: toNonNegativeNumber(food?.carbs) ?? 0
  };
}

function normalizeConfidence(value) {
  const confidence = String(value ?? "").toLowerCase();
  return ["low", "medium", "high"].includes(confidence) ? confidence : "low";
}

function sumFoodCarbs(foods) {
  return foods.reduce((sum, food) => sum + food.carbs, 0);
}

function toNonNegativeNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.round(number));
}
