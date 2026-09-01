export const VISUAL_QA_VIEWPORTS = Object.freeze([
  Object.freeze({ name: "desktop", width: 1366, height: 768 }),
  Object.freeze({ name: "mobile", width: 390, height: 844 }),
]);

export const REQUIRED_VISUAL_QA_SCENARIOS = Object.freeze([
  "empty",
  "ready",
  "running",
  "succeeded",
  "approval",
  "disconnected",
]);

export const SCRIPTED_VIOLATION_CODES = Object.freeze([
  "horizontal-overflow",
  "blank-page",
  "primary-controls-hidden",
  "raw-technical-content-dominates",
  "column-ownership-violation",
]);

export function validateVisualQaScenarioCatalog(names) {
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  const missing = REQUIRED_VISUAL_QA_SCENARIOS.filter((name) => !names.includes(name));
  if (duplicates.length || missing.length) {
    const details = [
      duplicates.length ? `duplicate scenarios: ${[...new Set(duplicates)].join(", ")}` : null,
      missing.length ? `missing required scenarios: ${missing.join(", ")}` : null,
    ].filter(Boolean);
    throw new Error(`Invalid Visual QA scenario catalog (${details.join("; ")})`);
  }
  return {
    available: [...names],
    required: [...REQUIRED_VISUAL_QA_SCENARIOS],
  };
}

export function expectedVisualQaScreenshotCount({ scenarioNames, viewportCount }) {
  const supplementalBoardScenarios = scenarioNames.filter((name) => ["ready", "home-workbench"].includes(name));
  return (scenarioNames.length + supplementalBoardScenarios.length) * viewportCount;
}

export function detectVisualQaViolations(metrics) {
  const violations = [];
  const renderedWidth = Math.max(metrics.documentWidth ?? 0, metrics.bodyWidth ?? 0);
  if (renderedWidth > (metrics.viewportWidth ?? 0) + 1) {
    violations.push({
      code: "horizontal-overflow",
      detail: `rendered width ${renderedWidth} exceeds viewport width ${metrics.viewportWidth}`,
    });
  }
  if ((metrics.textLength ?? 0) < 40) {
    violations.push({ code: "blank-page", detail: "rendered text is unexpectedly blank" });
  }
  if (metrics.requiresPrimaryControls && (metrics.visiblePrimaryControlCount ?? 0) < 1) {
    violations.push({ code: "primary-controls-hidden", detail: "no visible primary control is reachable" });
  }
  if (
    metrics.enforceTechnicalHierarchy
    && (metrics.resultTextLength ?? 0) > 0
    && (metrics.rawTechnicalTextLength ?? 0) / metrics.resultTextLength > 0.6
  ) {
    violations.push({
      code: "raw-technical-content-dominates",
      detail: "visible raw technical content dominates the result surface",
    });
  }
  if ((metrics.columnOwnershipViolations ?? 0) > 0) {
    violations.push({
      code: "column-ownership-violation",
      detail: `${metrics.columnOwnershipViolations} item(s) render in the wrong owner column`,
    });
  }
  return violations;
}

export function scriptedVisualQaViolationFixture() {
  return {
    viewportWidth: 390,
    documentWidth: 468,
    bodyWidth: 468,
    textLength: 12,
    requiresPrimaryControls: true,
    visiblePrimaryControlCount: 0,
    enforceTechnicalHierarchy: true,
    resultTextLength: 100,
    rawTechnicalTextLength: 85,
    columnOwnershipViolations: 1,
  };
}
