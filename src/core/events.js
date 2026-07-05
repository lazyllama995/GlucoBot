export const logTypes = {
  meal: "meal",
  glucose: "glucose",
  exercise: "exercise",
  illness: "illness",
  alcohol: "alcohol",
  dose: "dose"
};

export function createLogEntry(type, payload, date = new Date()) {
  return {
    id: `${type}_${date.getTime()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    payload,
    createdAt: date.toISOString()
  };
}
