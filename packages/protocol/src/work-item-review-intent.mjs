import { workItemIntentOperations } from "./work-item-intent-contract.mjs";

export const workItemReviewIntentSchemaVersion = 1;

export const workItemReviewIntentEffectCodes = [
  "result_only",
  "apply_local_changes",
  "create_pull_request",
  "update_pull_request",
  "apply_office_result",
  "unavailable",
];

export const workItemReviewIntentRiskCodes = [
  "uncommitted_worktree_retained",
  "local_base_branch_write",
  "remote_branch_and_notifications",
  "project_material_write",
  "effect_unavailable",
];

function boundedText(value, max = 2_000) {
  if (value == null) return null;
  return String(value).trim().slice(0, max) || null;
}

function stringList(value, maxItems = 50, maxLength = 500) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => boundedText(entry, maxLength)).filter(Boolean))].slice(0, maxItems);
}

function unavailableProjection() {
  return {
    schemaVersion: workItemReviewIntentSchemaVersion,
    source: "unavailable",
    intentDigest: null,
    goal: null,
    expectedOutput: null,
    taskKind: null,
    action: null,
    materials: null,
    delivery: null,
    confirmation: {
      requestedOperation: null,
      operation: null,
      effectCode: "unavailable",
      riskCode: "effect_unavailable",
      riskLevel: "unknown",
      resultOnly: false,
    },
  };
}

function confirmationProjection(deliveryEvidence) {
  const preview = deliveryEvidence?.actionPreview ?? null;
  const requestedOperation = boundedText(preview?.operation, 80);
  if (!requestedOperation) return unavailableProjection().confirmation;
  const blockedReasons = stringList(preview?.blockedReasonCodes ?? deliveryEvidence?.blockingReasonCodes, 20, 120);
  const resultOnly = deliveryEvidence?.status === "ready"
    && deliveryEvidence?.risk === "low"
    && blockedReasons.length === 1
    && blockedReasons[0] === "delivery_action_forbidden_by_intent";
  const operation = resultOnly ? "review_result" : requestedOperation;
  if (operation === "review_result") {
    return {
      requestedOperation,
      operation,
      effectCode: "result_only",
      riskCode: "uncommitted_worktree_retained",
      riskLevel: "low",
      resultOnly: true,
    };
  }
  if (operation === "apply_local_changes") {
    return {
      requestedOperation,
      operation,
      effectCode: "apply_local_changes",
      riskCode: "local_base_branch_write",
      riskLevel: "medium",
      resultOnly: false,
    };
  }
  if (operation === "create_pull_request" || operation === "update_pull_request") {
    return {
      requestedOperation,
      operation,
      effectCode: operation,
      riskCode: "remote_branch_and_notifications",
      riskLevel: "low",
      resultOnly: false,
    };
  }
  if (operation === "apply_office_result") {
    return {
      requestedOperation,
      operation,
      effectCode: "apply_office_result",
      riskCode: "project_material_write",
      riskLevel: "medium",
      resultOnly: false,
    };
  }
  return unavailableProjection().confirmation;
}

// Projects review and confirmation facts from the immutable execution snapshot.
// Mutable task text is deliberately not accepted as a fallback authority.
export function projectWorkItemReviewIntent({ intentContract = null, deliveryEvidence = null } = {}) {
  if (intentContract?.snapshotKind !== "execution_snapshot"
    || intentContract?.readOnly !== true
    || !boundedText(intentContract?.digest, 200)) {
    return unavailableProjection();
  }
  const inputs = Array.isArray(intentContract.materials?.inputs) ? intentContract.materials.inputs : [];
  const changeTargets = Array.isArray(intentContract.materials?.changeTargets) ? intentContract.materials.changeTargets : [];
  return {
    schemaVersion: workItemReviewIntentSchemaVersion,
    source: "frozen_execution_contract",
    intentDigest: boundedText(intentContract.digest, 200),
    goal: boundedText(intentContract.goal),
    expectedOutput: boundedText(intentContract.expectedOutput),
    taskKind: boundedText(intentContract.taskKind, 200),
    action: {
      accessMode: ["read_only", "write", "unknown"].includes(intentContract.action?.accessMode)
        ? intentContract.action.accessMode
        : "unknown",
      operation: workItemIntentOperations.includes(intentContract.action?.operation)
        ? intentContract.action.operation
        : "unknown",
      forbiddenActions: stringList(intentContract.action?.forbiddenActions, 30, 120),
    },
    materials: {
      inputCount: Number.isInteger(intentContract.materials?.inputCount)
        ? Math.max(0, intentContract.materials.inputCount)
        : inputs.length,
      inputTitles: stringList(inputs.map((material) => material?.title), 50, 500),
      changeTargetCount: changeTargets.length,
      changeTargetTitles: stringList(changeTargets.map((material) => material?.title), 50, 500),
    },
    delivery: {
      destination: intentContract.delivery?.destination === "channel" ? "channel" : "task",
      platformId: boundedText(intentContract.delivery?.platformId, 200),
      platformLabel: boundedText(intentContract.delivery?.platformLabel, 300),
    },
    confirmation: confirmationProjection(deliveryEvidence),
  };
}
