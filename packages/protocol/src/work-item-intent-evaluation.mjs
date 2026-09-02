export const workItemIntentEvaluationSchemaVersion = 1;

export const workItemIntentEvaluationFields = [
  "goal",
  "action",
  "materials",
  "output",
  "delivery",
];

export const workItemIntentEvaluationDefaultThresholds = Object.freeze({
  minimumCaseCount: 10,
  exactCaseAccuracy: 0.9,
  macroFieldAccuracy: 0.95,
  goalAccuracy: 0.95,
  actionAccuracy: 0.95,
  materialsAccuracy: 0.95,
  outputAccuracy: 0.95,
  deliveryAccuracy: 0.95,
  unsafeActionExpansionRate: 0,
});

export function normalizeWorkItemIntentEvaluationField(value) {
  return workItemIntentEvaluationFields.includes(value) ? value : null;
}

export function normalizeWorkItemIntentEvaluationThresholds(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...workItemIntentEvaluationDefaultThresholds };
  }
  return Object.fromEntries(Object.entries(workItemIntentEvaluationDefaultThresholds).map(([key, fallback]) => {
    const candidate = Number(value[key]);
    if (!Number.isFinite(candidate)) return [key, fallback];
    return [key, key === "minimumCaseCount"
      ? Math.max(1, Math.min(10_000, Math.floor(candidate)))
      : Math.max(0, Math.min(1, candidate))];
  }));
}
