import { createHash } from "node:crypto";

const TERMINAL_RUN_STATUSES = new Set([
  "done", "pr_open", "report_posted", "failed", "blocked", "cancelled", "timed_out", "rejected", "expired",
]);

function bounded(value, max = 500) {
  const text = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function extension(value) {
  return bounded(value, 500)?.toLowerCase().match(/\.[a-z0-9]{1,10}\b/)?.[0] ?? null;
}

function methodIdentity(method) {
  if (!method) return null;
  return [
    bounded(method.kind, 40),
    bounded(method.definitionId, 200),
    bounded(method.familyId, 200),
    Number(method.version) || null,
  ];
}

function sameMethod(expected, actual) {
  return JSON.stringify(methodIdentity(expected)) === JSON.stringify(methodIdentity(actual));
}

function methodView(method) {
  if (!method) return null;
  return {
    kind: bounded(method.kind, 40) ?? "custom",
    name: bounded(method.name, 300),
    definitionId: bounded(method.definitionId, 200),
    familyId: bounded(method.familyId, 200),
    version: Number(method.version) || null,
  };
}

function addCheck(checks, deviations, check) {
  checks.push(check);
  if (check.status !== "mismatch") return;
  deviations.push({
    code: check.reasonCode,
    severity: check.severity ?? "medium",
    scope: check.key,
    correctionTarget: check.correctionTarget ?? null,
  });
}

function materialCheck({ run, plannedContext, terminal }) {
  const sourceCount = Number(plannedContext?.sourceCount ?? plannedContext?.sources?.length ?? 0);
  if (!sourceCount) {
    return {
      key: "materials", status: "matched", reasonCode: "no_materials_planned",
      expected: { count: 0, names: [] }, actual: { count: 0, skippedCount: 0 },
    };
  }
  const materialization = run?.inputMaterialization ?? null;
  const receipts = Array.isArray(materialization?.receipts) ? materialization.receipts : [];
  const skipped = Array.isArray(materialization?.skippedReferences) ? materialization.skippedReferences : [];
  const failedReceipts = receipts.filter((receipt) => !["ready", "materialized", "available"].includes(receipt?.status ?? "ready"));
  const declarationDigest = materialization?.executionContextSnapshot?.declarationDigest ?? null;
  const contextChanged = Boolean(declarationDigest && plannedContext?.digest && declarationDigest !== plannedContext.digest);
  const names = (plannedContext?.sources ?? []).map((source) => bounded(source?.name ?? source?.displayName, 300)).filter(Boolean).slice(0, 20);
  const expected = { count: sourceCount, names };
  const actual = { count: receipts.length, skippedCount: skipped.length, failedCount: failedReceipts.length };
  if (contextChanged) {
    return {
      key: "materials", status: "mismatch", reasonCode: "material_snapshot_changed", severity: "high",
      correctionTarget: "materials", expected, actual,
    };
  }
  if (skipped.length || failedReceipts.length) {
    return {
      key: "materials", status: "mismatch", reasonCode: "planned_material_not_available", severity: "high",
      correctionTarget: "materials", expected, actual,
    };
  }
  if (receipts.length >= sourceCount && declarationDigest === plannedContext?.digest) {
    return { key: "materials", status: "matched", reasonCode: "planned_materials_materialized", expected, actual };
  }
  return {
    key: "materials", status: terminal ? "unknown" : "pending",
    reasonCode: terminal ? "material_use_not_proven" : "materials_not_materialized_yet", expected, actual,
  };
}

function outputCheck({ intent, outcome, terminal }) {
  const expectedOutput = bounded(intent?.expectedOutput, 500);
  const expectedExtension = extension(expectedOutput);
  const entries = Array.isArray(outcome?.fileEntries) ? outcome.fileEntries : [];
  const fileNames = entries.map((entry) => bounded(entry?.name ?? entry?.path, 500)).filter(Boolean).slice(0, 50);
  const actual = { status: outcome?.status ?? "pending", files: fileNames };
  const expected = { label: expectedOutput, extension: expectedExtension };
  if (!terminal && outcome?.status !== "available") {
    return { key: "output", status: "pending", reasonCode: "result_not_ready", expected, actual };
  }
  if (outcome?.status !== "available") {
    return {
      key: "output", status: terminal ? "mismatch" : "pending", reasonCode: "reviewable_result_missing", severity: "high",
      correctionTarget: "result", expected, actual,
    };
  }
  if (expectedExtension && !fileNames.some((file) => extension(file) === expectedExtension)) {
    return {
      key: "output", status: "mismatch", reasonCode: "output_format_mismatch", severity: "high",
      correctionTarget: "template", expected, actual,
    };
  }
  return { key: "output", status: "matched", reasonCode: "reviewable_result_available", expected, actual };
}

function actionCheck({ intent, run, deliveryEvidence, executionReview, terminal }) {
  const accessMode = bounded(intent?.action?.accessMode, 40) ?? "unknown";
  const batch = deliveryEvidence?.actionPreview?.officeDetails?.batch ?? null;
  const externallyApplied = Boolean(
    run?.localDelivery?.deliveredAt
    || run?.localDelivery?.deliveredCommit
    || run?.localDelivery?.promotedAt
    || run?.localDelivery?.prNumber
    || run?.localDelivery?.prUrl
    || ["committed", "partial", "rolled_back"].includes(batch?.state),
  );
  const impactStatus = executionReview?.impact?.status ?? (externallyApplied ? "applied" : "unknown");
  const expected = { accessMode };
  const actual = { impactStatus, externallyApplied };
  if (accessMode === "read_only" && externallyApplied) {
    return {
      key: "action", status: "mismatch", reasonCode: "read_only_scope_was_written", severity: "high",
      correctionTarget: "scope", expected, actual,
    };
  }
  if (accessMode === "read_only") {
    return { key: "action", status: "matched", reasonCode: "read_only_boundary_preserved", expected, actual };
  }
  if (accessMode === "write") {
    if (impactStatus === "partial") {
      return {
        key: "action", status: "mismatch", reasonCode: "planned_write_partially_applied", severity: "high",
        correctionTarget: "scope", expected, actual,
      };
    }
    if (impactStatus === "rolled_back") {
      return {
        key: "action", status: "mismatch", reasonCode: "planned_write_rolled_back", severity: "medium",
        correctionTarget: "scope", expected, actual,
      };
    }
    if (["prepared", "proposed", "applied"].includes(impactStatus)) {
      return { key: "action", status: "matched", reasonCode: "planned_write_has_receipt", expected, actual };
    }
    return {
      key: "action", status: terminal ? "unknown" : "pending",
      reasonCode: terminal ? "write_impact_not_proven" : "write_not_prepared_yet", expected, actual,
    };
  }
  return {
    key: "action", status: terminal ? "unknown" : "pending",
    reasonCode: terminal ? "action_scope_not_proven" : "action_scope_pending", expected, actual,
  };
}

function deliveryCheck({ intent, contextSummary, outcome, terminal }) {
  const destination = intent?.delivery?.destination ?? contextSummary?.delivery?.destination ?? "task";
  const deliveryStatus = bounded(contextSummary?.delivery?.status, 60);
  const expected = { destination };
  const actual = { destination, status: deliveryStatus };
  if (destination === "task") {
    if (outcome?.status === "available") return { key: "delivery", status: "matched", reasonCode: "result_available_in_task", expected, actual };
    return {
      key: "delivery", status: terminal ? "unknown" : "pending",
      reasonCode: terminal ? "task_delivery_not_proven" : "task_delivery_pending", expected, actual,
    };
  }
  if (deliveryStatus === "delivered") return { key: "delivery", status: "matched", reasonCode: "channel_delivery_confirmed", expected, actual };
  if (["failed", "failed_terminal"].includes(deliveryStatus ?? "")) {
    return {
      key: "delivery", status: "mismatch", reasonCode: "channel_delivery_failed", severity: "high",
      correctionTarget: "delivery", expected, actual,
    };
  }
  if (["queued", "sending", "retrying", "sent_unconfirmed"].includes(deliveryStatus ?? "")) {
    return { key: "delivery", status: "pending", reasonCode: "channel_delivery_pending", expected, actual };
  }
  return {
    key: "delivery", status: terminal ? "unknown" : "pending",
    reasonCode: terminal ? "channel_delivery_not_proven" : "channel_delivery_pending", expected, actual,
  };
}

function verificationCheck({ intent, executionReview, terminal }) {
  const expectedCount = Array.isArray(intent?.verificationSop) ? intent.verificationSop.length : 0;
  const verification = executionReview?.verification ?? null;
  const expected = { stepCount: expectedCount };
  const actual = {
    status: verification?.status ?? "pending",
    command: bounded(verification?.command, 500),
    exitCode: Number.isInteger(verification?.exitCode) ? verification.exitCode : null,
    evidenceCount: Number(verification?.evidenceCount ?? 0),
  };
  if (verification?.status === "passed") return { key: "verification", status: "matched", reasonCode: "verification_passed", expected, actual };
  if (verification?.status === "failed") {
    return {
      key: "verification", status: "mismatch", reasonCode: "verification_failed", severity: "high",
      correctionTarget: "verification", expected, actual,
    };
  }
  if (["pending", "running"].includes(verification?.status ?? "pending") && !terminal) {
    return { key: "verification", status: "pending", reasonCode: "verification_pending", expected, actual };
  }
  return {
    key: "verification", status: "unknown", reasonCode: "verification_not_proven",
    correctionTarget: "verification", expected, actual,
  };
}

/**
 * Reconciles the immutable pre-run contract with post-run receipts. A missing
 * receipt is kept as unknown; it is never promoted to a match or a failure.
 */
export function projectWorkItemPlanActual({
  item,
  latestRun,
  outcome = null,
  deliveryEvidence = null,
  executionReview = null,
  contextSummary = null,
} = {}) {
  if (!item || !latestRun) return null;
  const terminal = TERMINAL_RUN_STATUSES.has(latestRun.status);
  const currentIntent = item.executionIntentContractSnapshot ?? item.intentContract ?? null;
  const actualIntent = latestRun.executionContract?.intentContract ?? currentIntent;
  const plannedContext = latestRun.executionContract?.dataContextSnapshot ?? item.dataContextSnapshot ?? null;
  const checks = [];
  const deviations = [];

  const methodExpected = methodView(currentIntent?.method);
  const methodActual = methodView(actualIntent?.method);
  addCheck(checks, deviations, {
    key: "method",
    status: currentIntent?.method && actualIntent?.method
      ? (sameMethod(currentIntent.method, actualIntent.method) ? "matched" : "mismatch")
      : terminal ? "unknown" : "pending",
    reasonCode: currentIntent?.method && actualIntent?.method && !sameMethod(currentIntent.method, actualIntent.method)
      ? "execution_method_changed"
      : currentIntent?.method && actualIntent?.method ? "execution_method_frozen" : terminal ? "execution_method_not_proven" : "execution_method_pending",
    severity: "high",
    correctionTarget: "template",
    expected: methodExpected,
    actual: methodActual,
  });
  addCheck(checks, deviations, materialCheck({ run: latestRun, plannedContext, terminal }));
  addCheck(checks, deviations, outputCheck({ intent: actualIntent, outcome, terminal }));
  addCheck(checks, deviations, actionCheck({ intent: actualIntent, run: latestRun, deliveryEvidence, executionReview, terminal }));
  addCheck(checks, deviations, deliveryCheck({ intent: actualIntent, contextSummary, outcome, terminal }));
  addCheck(checks, deviations, verificationCheck({ intent: actualIntent, executionReview, terminal }));

  const hasMismatch = checks.some((check) => check.status === "mismatch");
  const hasPending = checks.some((check) => check.status === "pending");
  const hasUnknown = checks.some((check) => check.status === "unknown");
  const status = hasMismatch ? "attention"
    : !terminal || hasPending ? "pending"
      : hasUnknown ? "unverified" : "matched";
  const canonical = {
    schemaVersion: 1,
    runId: latestRun.id,
    status,
    summaryCode: status === "attention" ? "plan_actual_deviations_found"
      : status === "pending" ? "plan_actual_still_collecting"
        : status === "unverified" ? "plan_actual_evidence_incomplete" : "plan_actual_matched",
    planned: {
      goal: bounded(actualIntent?.goal ?? item.intentStatement ?? item.title, 1_000),
      expectedOutput: bounded(actualIntent?.expectedOutput, 500),
      method: methodExpected,
      materialCount: Number(plannedContext?.sourceCount ?? plannedContext?.sources?.length ?? 0),
      materialNames: (plannedContext?.sources ?? []).map((source) => bounded(source?.name ?? source?.displayName, 300)).filter(Boolean).slice(0, 20),
      deliveryDestination: actualIntent?.delivery?.destination ?? contextSummary?.delivery?.destination ?? "task",
      actionAccessMode: bounded(actualIntent?.action?.accessMode, 40) ?? "unknown",
      verificationStepCount: Array.isArray(actualIntent?.verificationSop) ? actualIntent.verificationSop.length : 0,
    },
    actual: {
      resultStatus: outcome?.status ?? "pending",
      resultFiles: (outcome?.fileEntries ?? []).map((entry) => bounded(entry?.name ?? entry?.path, 500)).filter(Boolean).slice(0, 50),
      materializedCount: Array.isArray(latestRun.inputMaterialization?.receipts) ? latestRun.inputMaterialization.receipts.length : 0,
      skippedMaterialCount: Array.isArray(latestRun.inputMaterialization?.skippedReferences) ? latestRun.inputMaterialization.skippedReferences.length : 0,
      deliveryStatus: bounded(contextSummary?.delivery?.status, 60),
      verificationStatus: executionReview?.verification?.status ?? "pending",
      impactStatus: executionReview?.impact?.status ?? "unknown",
    },
    checks,
    deviations,
  };
  return { ...canonical, digest: digest(canonical) };
}
