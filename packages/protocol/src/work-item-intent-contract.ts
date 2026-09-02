export declare const workItemIntentContractSchemaVersion: 2;

export declare const workItemIntentStatuses: readonly ["ready", "incomplete", "needs_clarification"];
export type WorkItemIntentStatus = (typeof workItemIntentStatuses)[number];

export declare const workItemIntentAccessModes: readonly ["read_only", "write", "unknown"];
export type WorkItemIntentAccessMode = (typeof workItemIntentAccessModes)[number];

export declare const workItemIntentOperations: readonly [
  "list_directory",
  "list_files",
  "read_files",
  "query_data",
  "mutate_files",
  "create_output",
  "unknown",
];
export type WorkItemIntentOperation = (typeof workItemIntentOperations)[number];

export declare const workItemIntentSources: readonly [
  "current_user",
  "confirmed_task_context",
  "channel_contract",
  "task_definition",
  "template",
  "deterministic_inference",
  "safe_default",
];
export type WorkItemIntentSource = (typeof workItemIntentSources)[number];

export declare const workItemIntentResolutionTargets: readonly [
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
export type WorkItemIntentResolutionTarget = (typeof workItemIntentResolutionTargets)[number];

export type WorkItemIntentLocalizedText = { zh: string; en: string };

export type WorkItemIntentClarificationOption = {
  id: string;
  label: WorkItemIntentLocalizedText;
  description: WorkItemIntentLocalizedText;
  impact: WorkItemIntentLocalizedText;
  recommended: boolean;
  applyMode: "automatic" | "manual";
  targetFields: WorkItemIntentResolutionTarget[];
};

export declare const workItemIntentConflictCodes: readonly [
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
export type WorkItemIntentConflictCode = (typeof workItemIntentConflictCodes)[number];

export type WorkItemIntentMaterial = {
  id: string;
  title: string;
  purpose: "required_input" | "reference" | "query_source" | "change_target";
  locality: "local" | "remote" | "managed";
  version: string | number | null;
  fingerprint: string | null;
};

export type WorkItemIntentContract = {
  schemaVersion: 2;
  snapshotKind: "current" | "execution_snapshot";
  workItemId: string | null;
  goal: string;
  taskKind: string;
  action: {
    accessMode: WorkItemIntentAccessMode;
    operation: WorkItemIntentOperation;
    forbiddenActions: string[];
  };
  expectedOutput: string | null;
  method: {
    kind: "template" | "custom";
    definitionId: string | null;
    familyId: string | null;
    version: number | null;
    name: string | null;
  };
  materials: {
    inputCount: number;
    inputs: WorkItemIntentMaterial[];
    changeTargets: Array<WorkItemIntentMaterial & { canCommit: boolean }>;
  };
  delivery: {
    destination: "channel" | "task";
    platformId: string | null;
    platformLabel: string | null;
  };
  sources: {
    goal: WorkItemIntentSource;
    action: WorkItemIntentSource;
    expectedOutput: WorkItemIntentSource;
    method: WorkItemIntentSource;
    materials: WorkItemIntentSource;
    delivery: WorkItemIntentSource;
  };
  acceptanceCriteria: string[];
  verificationSop: string[];
  conflicts: Array<{
    code: WorkItemIntentConflictCode;
    severity: "blocking" | "warning";
    subject: string;
    message: string;
    question: string;
    resolution: "task_context" | "task_definition" | "template";
  }>;
  missing: string[];
  resolutions: Array<{
    code: WorkItemIntentConflictCode;
    choiceId: string;
    targetFields: WorkItemIntentResolutionTarget[];
  }>;
  clarification: {
    code: WorkItemIntentConflictCode;
    question: string;
    questionCopy: WorkItemIntentLocalizedText;
    reason: WorkItemIntentLocalizedText;
    recommendation: WorkItemIntentLocalizedText;
    options: WorkItemIntentClarificationOption[];
    targetFields: WorkItemIntentResolutionTarget[];
    resolution: "task_context" | "task_definition" | "template";
  } | null;
  status: WorkItemIntentStatus;
  digest: string;
  confirmedAt?: string | null;
  confirmedBy?: string | null;
  readOnly?: true;
  previousConfirmedDigest?: string;
  confirmationStale?: true;
};

export declare function normalizeWorkItemIntentStatus(value: unknown): WorkItemIntentStatus;
export declare function normalizeWorkItemIntentAccessMode(value: unknown): WorkItemIntentAccessMode;
export declare function normalizeWorkItemIntentOperation(value: unknown): WorkItemIntentOperation;
export declare function normalizeWorkItemIntentSource(value: unknown): WorkItemIntentSource;
export declare function normalizeWorkItemIntentConflictCode(value: unknown): WorkItemIntentConflictCode;
export declare function normalizeWorkItemIntentResolutionTargets(values: unknown): WorkItemIntentResolutionTarget[];
