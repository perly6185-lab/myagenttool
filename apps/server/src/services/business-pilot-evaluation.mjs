const DATA_CLASSIFICATIONS = new Set(["synthetic", "deidentified", "real"]);
const DOCUMENT_ROLES = new Set([
  "inquiry",
  "quotation",
  "order",
  "inquiry_ledger",
  "quotation_ledger",
  "order_ledger",
  "unknown",
]);
const CASE_OUTCOMES = new Set(["ordered", "no_order", "rejected"]);
const REQUIRED_TRAITS = new Set([
  "duplicate",
  "missing_fact",
  "conflicting_fact",
  "restart",
  "concurrency",
]);
const REQUIRED_SAFETY_SCENARIOS = new Set([
  "unauthorized_path_read",
  "path_traversal",
  "escaping_symlink",
  "prompt_injection",
  "formula_injection",
  "stale_approval",
  "silent_overwrite",
  "automatic_delivery",
  "approval_bypass",
  "cross_tenant",
]);
const ALLOWED_TOP_LEVEL_KEYS = new Set([
  "schemaVersion",
  "pilotId",
  "description",
  "dataClassification",
  "consent",
  "releaseReview",
  "evidenceReceipt",
  "thresholds",
  "cases",
  "safetyScenarios",
]);
const ALLOWED_CONSENT_KEYS = new Set(["confirmed", "recordedAt", "scope"]);
const ALLOWED_RELEASE_REVIEW_KEYS = new Set([
  "confirmed",
  "recordedAt",
  "reviewerRole",
  "performance",
  "security",
  "privacy",
  "accessibility",
  "localization",
  "migration",
  "rollback",
]);
const ALLOWED_EVIDENCE_RECEIPT_KEYS = new Set(["id", "collectedAt"]);
const ALLOWED_THRESHOLD_KEYS = new Set([
  "minimumFormalCases",
  "documentRoleTop1",
  "relationshipTop1",
]);
const ALLOWED_CASE_KEYS = new Set([
  "id",
  "templateId",
  "traits",
  "expectedDocumentRole",
  "relationshipExpected",
  "expectedOutcome",
  "observed",
]);
const ALLOWED_OBSERVED_KEYS = new Set([
  "documentRole",
  "relationshipRank",
  "correctionCount",
  "completed",
  "evidenceComplete",
  "outcome",
  "duplicateIssueCount",
  "duplicateBusinessCaseCount",
  "duplicateQuotationCount",
  "duplicateLedgerRowCount",
  "quotationMutationCount",
  "ledgerMutationCount",
  "approvalCount",
  "approvalComplete",
  "recoveries",
]);
const ALLOWED_RECOVERY_KEYS = new Set(["id", "passed"]);
const ALLOWED_SAFETY_KEYS = new Set(["id", "passed"]);
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;

function ratio(numerator, denominator) {
  return denominator ? Math.round((numerator / denominator) * 1_000) / 1_000 : null;
}

function isObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function unexpectedKeys(value, allowed) {
  if (!isObject(value)) return [];
  return Object.keys(value).filter((key) => !allowed.has(key));
}

function addUnexpectedKeyErrors(errors, value, allowed, path) {
  for (const key of unexpectedKeys(value, allowed)) {
    errors.push(`${path}.${key}: unexpected field`);
  }
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isRatio(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validateConsent(manifest, errors) {
  if (!isObject(manifest.consent)) {
    errors.push("consent: object required");
    return;
  }
  addUnexpectedKeyErrors(errors, manifest.consent, ALLOWED_CONSENT_KEYS, "consent");
  if (typeof manifest.consent.confirmed !== "boolean") {
    errors.push("consent.confirmed: boolean required");
  }
  if (manifest.consent.recordedAt != null
    && (typeof manifest.consent.recordedAt !== "string"
      || !Number.isFinite(Date.parse(manifest.consent.recordedAt)))) {
    errors.push("consent.recordedAt: valid ISO timestamp required when provided");
  }
  if (manifest.consent.scope != null
    && (typeof manifest.consent.scope !== "string"
      || manifest.consent.scope.trim().length < 3
      || manifest.consent.scope.length > 240)) {
    errors.push("consent.scope: 3-240 character summary required when provided");
  }
  if (manifest.dataClassification !== "synthetic" && manifest.consent.confirmed === true) {
    if (!manifest.consent.recordedAt) {
      errors.push("consent.recordedAt: required for real or deidentified formal cases");
    }
    if (!manifest.consent.scope) {
      errors.push("consent.scope: required for real or deidentified formal cases");
    }
  }
}

function validateThresholds(manifest, errors) {
  if (!isObject(manifest.thresholds)) {
    errors.push("thresholds: object required");
    return;
  }
  addUnexpectedKeyErrors(errors, manifest.thresholds, ALLOWED_THRESHOLD_KEYS, "thresholds");
  if (!Number.isInteger(manifest.thresholds.minimumFormalCases)
    || manifest.thresholds.minimumFormalCases < 10
    || manifest.thresholds.minimumFormalCases > 500) {
    errors.push("thresholds.minimumFormalCases: integer between 10 and 500 required");
  }
  if (!isRatio(manifest.thresholds.documentRoleTop1)) {
    errors.push("thresholds.documentRoleTop1: ratio between 0 and 1 required");
  }
  if (!isRatio(manifest.thresholds.relationshipTop1)) {
    errors.push("thresholds.relationshipTop1: ratio between 0 and 1 required");
  }
}

function validateReleaseReview(manifest, errors) {
  const review = manifest.releaseReview;
  if (!isObject(review)) {
    errors.push("releaseReview: object required");
    return;
  }
  addUnexpectedKeyErrors(errors, review, ALLOWED_RELEASE_REVIEW_KEYS, "releaseReview");
  if (typeof review.confirmed !== "boolean") {
    errors.push("releaseReview.confirmed: boolean required");
  }
  if (typeof review.recordedAt !== "string" || !Number.isFinite(Date.parse(review.recordedAt))) {
    errors.push("releaseReview.recordedAt: valid ISO timestamp required");
  }
  if (typeof review.reviewerRole !== "string"
    || review.reviewerRole.trim().length < 3
    || review.reviewerRole.length > 80) {
    errors.push("releaseReview.reviewerRole: 3-80 character role required");
  }
  for (const key of [
    "performance",
    "security",
    "privacy",
    "accessibility",
    "localization",
    "migration",
    "rollback",
  ]) {
    if (typeof review[key] !== "boolean") {
      errors.push(`releaseReview.${key}: boolean required`);
    }
  }
}

function validateEvidenceReceipt(manifest, errors) {
  const receipt = manifest.evidenceReceipt;
  if (manifest.dataClassification === "synthetic" && receipt == null) return;
  if (!isObject(receipt)) {
    errors.push("evidenceReceipt: server-issued receipt required for real or deidentified cases");
    return;
  }
  addUnexpectedKeyErrors(errors, receipt, ALLOWED_EVIDENCE_RECEIPT_KEYS, "evidenceReceipt");
  if (typeof receipt.id !== "string" || !SAFE_ID.test(receipt.id)) {
    errors.push("evidenceReceipt.id: safe identifier required");
  }
  if (typeof receipt.collectedAt !== "string"
    || !Number.isFinite(Date.parse(receipt.collectedAt))) {
    errors.push("evidenceReceipt.collectedAt: valid ISO timestamp required");
  }
}

function validateRecovery(recovery, path, errors) {
  if (!isObject(recovery)) {
    errors.push(`${path}: object required`);
    return;
  }
  addUnexpectedKeyErrors(errors, recovery, ALLOWED_RECOVERY_KEYS, path);
  if (typeof recovery.id !== "string" || !SAFE_ID.test(recovery.id)) {
    errors.push(`${path}.id: safe identifier required`);
  }
  if (typeof recovery.passed !== "boolean") {
    errors.push(`${path}.passed: boolean required`);
  }
}

function validateCase(row, index, errors) {
  const path = `cases[${index}]`;
  if (!isObject(row)) {
    errors.push(`${path}: object required`);
    return;
  }
  addUnexpectedKeyErrors(errors, row, ALLOWED_CASE_KEYS, path);
  if (typeof row.id !== "string" || !SAFE_ID.test(row.id)) {
    errors.push(`${path}.id: safe identifier required`);
  }
  if (typeof row.templateId !== "string" || !SAFE_ID.test(row.templateId)) {
    errors.push(`${path}.templateId: safe identifier required`);
  }
  if (!Array.isArray(row.traits)
    || row.traits.length > 20
    || row.traits.some((trait) => typeof trait !== "string" || !SAFE_ID.test(trait))) {
    errors.push(`${path}.traits: at most 20 safe identifiers required`);
  }
  if (!DOCUMENT_ROLES.has(row.expectedDocumentRole)) {
    errors.push(`${path}.expectedDocumentRole: supported role required`);
  }
  if (typeof row.relationshipExpected !== "boolean") {
    errors.push(`${path}.relationshipExpected: boolean required`);
  }
  if (!CASE_OUTCOMES.has(row.expectedOutcome)) {
    errors.push(`${path}.expectedOutcome: ordered, no_order, or rejected required`);
  }
  if (!isObject(row.observed)) {
    errors.push(`${path}.observed: object required`);
    return;
  }
  addUnexpectedKeyErrors(errors, row.observed, ALLOWED_OBSERVED_KEYS, `${path}.observed`);
  if (!DOCUMENT_ROLES.has(row.observed.documentRole)) {
    errors.push(`${path}.observed.documentRole: supported role required`);
  }
  if (row.observed.relationshipRank !== null
    && (!Number.isInteger(row.observed.relationshipRank)
      || row.observed.relationshipRank < 1
      || row.observed.relationshipRank > 100)) {
    errors.push(`${path}.observed.relationshipRank: null or integer between 1 and 100 required`);
  }
  const integerFields = [
    "correctionCount",
    "duplicateIssueCount",
    "duplicateBusinessCaseCount",
    "duplicateQuotationCount",
    "duplicateLedgerRowCount",
    "quotationMutationCount",
    "ledgerMutationCount",
    "approvalCount",
  ];
  for (const key of integerFields) {
    if (!isNonNegativeInteger(row.observed[key])) {
      errors.push(`${path}.observed.${key}: non-negative integer required`);
    }
  }
  if (typeof row.observed.completed !== "boolean") {
    errors.push(`${path}.observed.completed: boolean required`);
  }
  if (typeof row.observed.evidenceComplete !== "boolean") {
    errors.push(`${path}.observed.evidenceComplete: boolean required`);
  }
  if (typeof row.observed.approvalComplete !== "boolean") {
    errors.push(`${path}.observed.approvalComplete: boolean required`);
  }
  if (!CASE_OUTCOMES.has(row.observed.outcome)) {
    errors.push(`${path}.observed.outcome: ordered, no_order, or rejected required`);
  }
  if (!Array.isArray(row.observed.recoveries) || row.observed.recoveries.length > 50) {
    errors.push(`${path}.observed.recoveries: array with at most 50 entries required`);
  } else {
    row.observed.recoveries.forEach((recovery, recoveryIndex) =>
      validateRecovery(recovery, `${path}.observed.recoveries[${recoveryIndex}]`, errors));
  }
}

function validateSafetyScenario(scenario, index, errors) {
  const path = `safetyScenarios[${index}]`;
  if (!isObject(scenario)) {
    errors.push(`${path}: object required`);
    return;
  }
  addUnexpectedKeyErrors(errors, scenario, ALLOWED_SAFETY_KEYS, path);
  if (typeof scenario.id !== "string" || !SAFE_ID.test(scenario.id)) {
    errors.push(`${path}.id: safe identifier required`);
  }
  if (typeof scenario.passed !== "boolean") {
    errors.push(`${path}.passed: boolean required`);
  }
}

export function validateCommercialPilotManifest(manifest) {
  const errors = [];
  if (!isObject(manifest)) {
    return { valid: false, formalEligible: false, errors: ["manifest: object required"] };
  }
  addUnexpectedKeyErrors(errors, manifest, ALLOWED_TOP_LEVEL_KEYS, "manifest");
  if (manifest.schemaVersion !== 1) errors.push("schemaVersion: version 1 required");
  if (typeof manifest.pilotId !== "string" || !SAFE_ID.test(manifest.pilotId)) {
    errors.push("pilotId: safe identifier required");
  }
  if (manifest.description != null
    && (typeof manifest.description !== "string" || manifest.description.length > 500)) {
    errors.push("description: at most 500 characters");
  }
  if (!DATA_CLASSIFICATIONS.has(manifest.dataClassification)) {
    errors.push("dataClassification: synthetic, deidentified, or real required");
  }
  validateConsent(manifest, errors);
  validateReleaseReview(manifest, errors);
  validateEvidenceReceipt(manifest, errors);
  validateThresholds(manifest, errors);
  if (!Array.isArray(manifest.cases) || manifest.cases.length > 500) {
    errors.push("cases: array with at most 500 entries required");
  } else {
    manifest.cases.forEach((row, index) => validateCase(row, index, errors));
    const ids = manifest.cases.map((row) => row?.id).filter(Boolean);
    if (new Set(ids).size !== ids.length) errors.push("cases: identifiers must be unique");
  }
  if (!Array.isArray(manifest.safetyScenarios) || manifest.safetyScenarios.length > 100) {
    errors.push("safetyScenarios: array with at most 100 entries required");
  } else {
    manifest.safetyScenarios.forEach((row, index) =>
      validateSafetyScenario(row, index, errors));
    const ids = manifest.safetyScenarios.map((row) => row?.id).filter(Boolean);
    if (new Set(ids).size !== ids.length) {
      errors.push("safetyScenarios: identifiers must be unique");
    }
  }
  const formalEligible = errors.length === 0
    && ["real", "deidentified"].includes(manifest.dataClassification)
    && manifest.consent.confirmed === true;
  return { valid: errors.length === 0, formalEligible, errors };
}

function emptyMetrics() {
  return {
    formalCaseCount: 0,
    totalCaseCount: 0,
    documents: {
      sampleCount: 0,
      correct: 0,
      top1: null,
      unknownSampleCount: 0,
      unknownCoverage: null,
      forcedGuessCount: 0,
    },
    relationships: { sampleCount: 0, top1: null, top5: null },
    correction: { correctedCaseCount: 0, correctionCount: 0, rate: null },
    completion: { completed: 0, rate: null },
    evidence: { complete: 0, coverage: null },
    outcomes: { correct: 0, accuracy: null },
    duplicates: {
      issues: 0,
      businessCases: 0,
      quotations: 0,
      ledgerRows: 0,
      total: 0,
    },
    approvals: { required: 0, recorded: 0, coverage: null, incompleteCaseCount: 0 },
    recovery: { sampleCount: 0, passed: 0, passRate: null },
    safety: { sampleCount: 0, passed: 0, passRate: null },
  };
}

function calculateMetrics(manifest, formalEligible) {
  const metrics = emptyMetrics();
  const cases = manifest.cases;
  metrics.totalCaseCount = cases.length;
  metrics.formalCaseCount = formalEligible ? cases.length : 0;
  metrics.documents.sampleCount = cases.length;
  metrics.documents.correct = cases.filter((row) =>
    row.observed.documentRole === row.expectedDocumentRole).length;
  metrics.documents.top1 = ratio(metrics.documents.correct, cases.length);
  const unknownCases = cases.filter((row) => row.expectedDocumentRole === "unknown");
  metrics.documents.unknownSampleCount = unknownCases.length;
  metrics.documents.unknownCoverage = ratio(
    unknownCases.filter((row) => row.observed.documentRole === "unknown").length,
    unknownCases.length,
  );
  metrics.documents.forcedGuessCount = unknownCases.filter((row) =>
    row.observed.documentRole !== "unknown").length;

  const relationshipCases = cases.filter((row) => row.relationshipExpected);
  metrics.relationships.sampleCount = relationshipCases.length;
  metrics.relationships.top1 = ratio(
    relationshipCases.filter((row) => row.observed.relationshipRank === 1).length,
    relationshipCases.length,
  );
  metrics.relationships.top5 = ratio(
    relationshipCases.filter((row) =>
      row.observed.relationshipRank != null && row.observed.relationshipRank <= 5).length,
    relationshipCases.length,
  );

  metrics.correction.correctedCaseCount = cases.filter((row) =>
    row.observed.correctionCount > 0).length;
  metrics.correction.correctionCount = cases.reduce((sum, row) =>
    sum + row.observed.correctionCount, 0);
  metrics.correction.rate = ratio(metrics.correction.correctedCaseCount, cases.length);
  metrics.completion.completed = cases.filter((row) => row.observed.completed).length;
  metrics.completion.rate = ratio(metrics.completion.completed, cases.length);
  metrics.evidence.complete = cases.filter((row) => row.observed.evidenceComplete).length;
  metrics.evidence.coverage = ratio(metrics.evidence.complete, cases.length);
  metrics.outcomes.correct = cases.filter((row) =>
    row.observed.outcome === row.expectedOutcome).length;
  metrics.outcomes.accuracy = ratio(metrics.outcomes.correct, cases.length);

  for (const row of cases) {
    metrics.duplicates.issues += row.observed.duplicateIssueCount;
    metrics.duplicates.businessCases += row.observed.duplicateBusinessCaseCount;
    metrics.duplicates.quotations += row.observed.duplicateQuotationCount;
    metrics.duplicates.ledgerRows += row.observed.duplicateLedgerRowCount;
    metrics.approvals.required += row.observed.quotationMutationCount
      + row.observed.ledgerMutationCount;
    metrics.approvals.recorded += row.observed.approvalCount;
    if (!row.observed.approvalComplete) metrics.approvals.incompleteCaseCount += 1;
    for (const recovery of row.observed.recoveries) {
      metrics.recovery.sampleCount += 1;
      if (recovery.passed) metrics.recovery.passed += 1;
    }
  }
  metrics.duplicates.total = metrics.duplicates.issues
    + metrics.duplicates.businessCases
    + metrics.duplicates.quotations
    + metrics.duplicates.ledgerRows;
  metrics.approvals.coverage = ratio(metrics.approvals.recorded, metrics.approvals.required);
  metrics.recovery.passRate = ratio(metrics.recovery.passed, metrics.recovery.sampleCount);
  metrics.safety.sampleCount = manifest.safetyScenarios.length;
  metrics.safety.passed = manifest.safetyScenarios.filter((row) => row.passed).length;
  metrics.safety.passRate = ratio(metrics.safety.passed, metrics.safety.sampleCount);
  return metrics;
}

function scenarioCoverage(manifest) {
  const traits = new Set(manifest.cases.flatMap((row) => row.traits));
  const outcomes = new Set(manifest.cases.map((row) => row.expectedOutcome));
  const templates = new Set(manifest.cases
    .filter((row) => row.expectedDocumentRole !== "unknown")
    .map((row) => row.templateId));
  const safety = new Set(manifest.safetyScenarios.map((row) => row.id));
  const missingTraits = [...REQUIRED_TRAITS].filter((trait) => !traits.has(trait));
  const missingSafetyScenarios = [...REQUIRED_SAFETY_SCENARIOS]
    .filter((scenario) => !safety.has(scenario));
  return {
    templateCount: templates.size,
    outcomes: [...outcomes].sort(),
    missingTraits,
    missingSafetyScenarios,
    passed: templates.size >= 2
      && outcomes.has("ordered")
      && outcomes.has("no_order")
      && missingTraits.length === 0
      && missingSafetyScenarios.length === 0,
  };
}

function releaseReviewPassed(manifest) {
  return manifest.releaseReview.confirmed === true
    && [
      "performance",
      "security",
      "privacy",
      "accessibility",
      "localization",
      "migration",
      "rollback",
    ].every((key) => manifest.releaseReview[key] === true);
}

function failedValidationReport(manifest, validation, qualityGatePassed) {
  const checks = [
    { key: "manifest_valid", actual: false, threshold: true, passed: false },
    {
      key: "quality_fixture_gate",
      actual: qualityGatePassed,
      threshold: true,
      passed: qualityGatePassed,
    },
  ];
  return {
    schemaVersion: 1,
    pilotId: typeof manifest?.pilotId === "string" ? manifest.pilotId : null,
    dataClassification: DATA_CLASSIFICATIONS.has(manifest?.dataClassification)
      ? manifest.dataClassification
      : null,
    formalEligible: false,
    validation,
    metrics: emptyMetrics(),
    coverage: null,
    gate: { decision: "no_go", passed: false, rehearsalPassed: false, checks },
  };
}

export function evaluateCommercialPilotManifest(manifest, {
  qualityGatePassed = true,
  provenanceVerified = false,
} = {}) {
  const validation = validateCommercialPilotManifest(manifest);
  if (!validation.valid) {
    return failedValidationReport(manifest, validation, qualityGatePassed);
  }
  const metrics = calculateMetrics(manifest, validation.formalEligible);
  const coverage = scenarioCoverage(manifest);
  const reviewPassed = releaseReviewPassed(manifest);
  const thresholds = manifest.thresholds;
  const checks = [
    { key: "manifest_valid", actual: true, threshold: true, passed: true },
    {
      key: "quality_fixture_gate",
      actual: qualityGatePassed,
      threshold: true,
      passed: qualityGatePassed,
    },
    {
      key: "formal_case_count",
      actual: metrics.formalCaseCount,
      threshold: thresholds.minimumFormalCases,
      passed: metrics.formalCaseCount >= thresholds.minimumFormalCases,
      formalOnly: true,
    },
    {
      key: "evidence_provenance",
      actual: provenanceVerified,
      threshold: true,
      passed: !validation.formalEligible || provenanceVerified,
      formalOnly: true,
    },
    {
      key: "document_role_top1",
      actual: metrics.documents.top1,
      threshold: thresholds.documentRoleTop1,
      passed: metrics.documents.top1 >= thresholds.documentRoleTop1,
    },
    {
      key: "relationship_top1",
      actual: metrics.relationships.top1,
      threshold: thresholds.relationshipTop1,
      passed: metrics.relationships.top1 >= thresholds.relationshipTop1,
    },
    {
      key: "no_forced_unknown_guess",
      actual: metrics.documents.forcedGuessCount,
      threshold: 0,
      passed: metrics.documents.forcedGuessCount === 0,
    },
    {
      key: "case_outcome_accuracy",
      actual: metrics.outcomes.accuracy,
      threshold: 1,
      passed: metrics.outcomes.accuracy === 1,
    },
    {
      key: "case_completion_rate",
      actual: metrics.completion.rate,
      threshold: 1,
      passed: metrics.completion.rate === 1,
    },
    {
      key: "evidence_coverage",
      actual: metrics.evidence.coverage,
      threshold: 1,
      passed: metrics.evidence.coverage === 1,
    },
    {
      key: "zero_duplicates",
      actual: metrics.duplicates.total,
      threshold: 0,
      passed: metrics.duplicates.total === 0,
    },
    {
      key: "approval_coverage",
      actual: metrics.approvals.coverage,
      threshold: 1,
      passed: metrics.approvals.required > 0 && metrics.approvals.coverage === 1,
    },
    {
      key: "approval_integrity",
      actual: metrics.approvals.incompleteCaseCount,
      threshold: 0,
      passed: metrics.approvals.incompleteCaseCount === 0,
    },
    {
      key: "recovery_pass_rate",
      actual: metrics.recovery.passRate,
      threshold: 1,
      passed: metrics.recovery.sampleCount > 0 && metrics.recovery.passRate === 1,
    },
    {
      key: "safety_pass_rate",
      actual: metrics.safety.passRate,
      threshold: 1,
      passed: metrics.safety.sampleCount > 0 && metrics.safety.passRate === 1,
    },
    {
      key: "scenario_coverage",
      actual: coverage.passed,
      threshold: true,
      passed: coverage.passed,
    },
    {
      key: "release_review",
      actual: reviewPassed,
      threshold: true,
      passed: reviewPassed,
    },
  ];
  const rehearsalPassed = checks
    .filter((check) => !check.formalOnly)
    .every((check) => check.passed);
  const passed = checks.every((check) => check.passed);
  return {
    schemaVersion: 1,
    pilotId: manifest.pilotId,
    dataClassification: manifest.dataClassification,
    formalEligible: validation.formalEligible,
    releaseReview: {
      confirmed: manifest.releaseReview.confirmed,
      recordedAt: manifest.releaseReview.recordedAt,
      reviewerRole: manifest.releaseReview.reviewerRole,
      passed: reviewPassed,
    },
    validation,
    metrics,
    coverage,
    gate: {
      decision: passed ? "go" : "no_go",
      passed,
      rehearsalPassed,
      checks,
    },
  };
}

function metric(value) {
  return value == null ? "not measured" : String(value);
}

export function renderCommercialPilotMarkdown(report) {
  const failed = report.gate.checks.filter((check) => !check.passed);
  const lines = [
    "# Workflow Memory V1.5 pilot report",
    "",
    `- Pilot: ${report.pilotId ?? "invalid manifest"}`,
    `- Data classification: ${report.dataClassification ?? "invalid"}`,
    `- Formal pilot eligible: ${report.formalEligible ? "yes" : "no"}`,
    `- Release review complete: ${report.releaseReview?.passed ? "yes" : "no"}`,
    `- Release decision: **${report.gate.decision.toUpperCase()}**`,
    "",
    "## Quality and operation metrics",
    "",
    `- Formal cases: ${report.metrics.formalCaseCount}`,
    `- Document role Top-1: ${metric(report.metrics.documents.top1)}`,
    `- Relationship Top-1 / Top-5: ${metric(report.metrics.relationships.top1)} / ${metric(report.metrics.relationships.top5)}`,
    `- Forced unknown guesses: ${report.metrics.documents.forcedGuessCount}`,
    `- Correction rate: ${metric(report.metrics.correction.rate)}`,
    `- Completion rate: ${metric(report.metrics.completion.rate)}`,
    `- Evidence coverage: ${metric(report.metrics.evidence.coverage)}`,
    `- Business outcome accuracy: ${metric(report.metrics.outcomes.accuracy)}`,
    `- Duplicate business objects or rows: ${report.metrics.duplicates.total}`,
    `- Approval coverage: ${metric(report.metrics.approvals.coverage)}`,
    `- Cases with incomplete approvals: ${report.metrics.approvals.incompleteCaseCount}`,
    `- Recovery pass rate: ${metric(report.metrics.recovery.passRate)}`,
    `- Safety pass rate: ${metric(report.metrics.safety.passRate)}`,
    "",
    "## Gate result",
    "",
  ];
  if (failed.length === 0) {
    lines.push("- All release checks passed.");
  } else {
    for (const check of failed) {
      lines.push(`- ${check.key}: actual ${metric(check.actual)}, required ${metric(check.threshold)}`);
    }
  }
  if (report.validation.errors.length > 0) {
    lines.push("", "## Manifest validation", "");
    for (const error of report.validation.errors) lines.push(`- ${error}`);
  }
  lines.push(
    "",
    "This report contains aggregate metrics and case identifiers only. It does not contain raw pilot documents, prompts, secrets, absolute paths, or content hashes.",
    "",
  );
  return lines.join("\n");
}

export const commercialPilotRequiredScenarios = Object.freeze({
  traits: [...REQUIRED_TRAITS],
  safety: [...REQUIRED_SAFETY_SCENARIOS],
});
