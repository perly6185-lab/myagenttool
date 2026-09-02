export const workItemIntentContractSchemaVersion = 2;
export const workItemIntentStatuses = ["ready", "incomplete", "needs_clarification"];
export const workItemIntentAccessModes = ["read_only", "write", "unknown"];
export const workItemIntentOperations = [
  "list_directory",
  "list_files",
  "read_files",
  "query_data",
  "mutate_files",
  "create_output",
  "unknown",
];
export const workItemIntentSources = [
  "current_user",
  "confirmed_task_context",
  "channel_contract",
  "task_definition",
  "template",
  "deterministic_inference",
  "safe_default",
];
export const workItemIntentResolutionTargets = [
  "action.accessMode",
  "action.operation",
  "action.forbiddenActions",
  "materials.roles",
  "delivery.destination",
  "delivery.platform",
  "method.selection",
  "expectedOutput",
  "task.definition",
];
export const workItemIntentConflictCodes = [
  "operation_intent_restricted_by_user",
  "write_request_exceeds_confirmed_boundary",
  "read_only_with_change_targets",
  "read_only_with_external_write",
  "platform_target_missing",
  "template_selection_changed",
  "output_format_changed",
  "change_target_not_writable",
  "intent_contract_unknown",
];

function normalize(values, value, fallback) {
  return values.includes(value) ? value : fallback;
}

export function normalizeWorkItemIntentStatus(value) {
  return normalize(workItemIntentStatuses, value, "needs_clarification");
}

export function normalizeWorkItemIntentAccessMode(value) {
  return normalize(workItemIntentAccessModes, value, "unknown");
}

export function normalizeWorkItemIntentOperation(value) {
  return normalize(workItemIntentOperations, value, "unknown");
}

export function normalizeWorkItemIntentSource(value) {
  return normalize(workItemIntentSources, value, "safe_default");
}

export function normalizeWorkItemIntentConflictCode(value) {
  return normalize(workItemIntentConflictCodes, value, "intent_contract_unknown");
}

export function normalizeWorkItemIntentResolutionTargets(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value) => workItemIntentResolutionTargets.includes(value)))];
}
