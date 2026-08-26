import type { IsoDateTime, JsonValue } from "./common.js";

/** Version for the provider-neutral task resource and business ledger contract. */
export declare const taskResourceSchemaVersion: 2;

export declare const taskTemplateSourceKinds: readonly [
  "ledger_record",
  "ledger_record_set",
  "artifact",
  "local_content",
];
export type TaskTemplateSourceKind = (typeof taskTemplateSourceKinds)[number];

export declare const taskTemplateMethodKinds: readonly [
  "extract",
  "retrieve",
  "generate",
  "transform",
  "verify",
];
export type TaskTemplateMethodKind = (typeof taskTemplateMethodKinds)[number];

export declare const taskTemplateFreshnessPolicies: readonly ["current", "execution_snapshot", "either"];
export type TaskTemplateFreshnessPolicy = (typeof taskTemplateFreshnessPolicies)[number];

export declare const taskTemplateInputPurposes: readonly ["required", "reference"];
export type TaskTemplateInputPurpose = (typeof taskTemplateInputPurposes)[number];

export declare const taskTemplateStates: readonly ["draft", "published", "paused", "superseded"];
export type TaskTemplateState = (typeof taskTemplateStates)[number];

export declare const taskTemplateApprovalPolicies: readonly ["none", "before_effect", "before_sensitive_write"];
export type TaskTemplateApprovalPolicy = (typeof taskTemplateApprovalPolicies)[number];

export declare const taskRecordBindingDirections: readonly ["input", "output"];
export type TaskRecordBindingDirection = (typeof taskRecordBindingDirections)[number];

export declare const taskRecordBindingRoles: readonly ["required", "reference", "primary_ledger", "related_ledger"];
export type TaskRecordBindingRole = (typeof taskRecordBindingRoles)[number];

export declare const taskRecordResolutionSources: readonly [
  "explicit_user",
  "current_context",
  "intent_match",
  "template_default",
];
export type TaskRecordResolutionSource = (typeof taskRecordResolutionSources)[number];

export declare const taskRecordResolutionStates: readonly ["resolved", "needs_confirmation", "stale", "unavailable"];
export type TaskRecordResolutionState = (typeof taskRecordResolutionStates)[number];

export declare const ledgerPostingPlanStates: readonly [
  "proposed",
  "approved",
  "committed",
  "partially_committed",
  "invalidated",
  "cancelled",
];
export type LedgerPostingPlanState = (typeof ledgerPostingPlanStates)[number];

export declare const ledgerPostingActions: readonly ["create", "update", "append_activity", "link_only"];
export type LedgerPostingAction = (typeof ledgerPostingActions)[number];

export type BusinessLedgerRecordRef = {
  ledgerDefinitionId: string;
  recordId: string;
  recordType: string;
  businessKey: string | null;
  title: string;
  revision: string | number | null;
  fingerprint: string;
  observedAt: IsoDateTime;
};

export type TaskTemplateInputSlot = {
  key: string;
  label: string;
  sourceKinds: TaskTemplateSourceKind[];
  recordTypes: string[];
  artifactKinds: string[];
  required: boolean;
  cardinality: "one" | "many";
  freshness: TaskTemplateFreshnessPolicy;
  purpose: TaskTemplateInputPurpose;
};

export type TaskTemplateLedgerRouting = {
  primaryRecordType: string | null;
  relatedRecordTypes: string[];
};

export type TaskTemplateContractV2 = {
  schemaVersion: 2;
  id: string;
  familyId: string;
  version: number;
  taskKind: string;
  domain: string;
  name: string;
  outcome: {
    label: string;
    artifactKinds: string[];
    acceptanceCriteria: string[];
  };
  inputSlots: TaskTemplateInputSlot[];
  ledgerRouting: TaskTemplateLedgerRouting;
  method: Array<{
    key: string;
    kind: TaskTemplateMethodKind;
    label: string;
    required: boolean;
  }>;
  externalEffect: boolean;
  approvalPolicy: TaskTemplateApprovalPolicy;
  state: TaskTemplateState;
};

export type TaskRecordEvidenceRef = {
  artifactId: string;
  field: string | null;
};

export type TaskRecordBinding = {
  id: string;
  slotKey: string | null;
  direction: TaskRecordBindingDirection;
  role: TaskRecordBindingRole;
  record: BusinessLedgerRecordRef | null;
  ledgerDefinitionId: string;
  selection: {
    fieldKeys: string[];
    queryId: string | null;
    rowLimit: number | null;
  };
  snapshot: {
    revision: string | number | null;
    fingerprint: string;
    capturedAt: IsoDateTime;
    evidenceRefs: TaskRecordEvidenceRef[];
  } | null;
  resolution: {
    source: TaskRecordResolutionSource;
    confidence: number;
    state: TaskRecordResolutionState;
    reasons: string[];
  };
};

export type LedgerPostingOperation = {
  ledgerDefinitionId: string;
  recordId: string | null;
  action: LedgerPostingAction;
  fields: Record<string, JsonValue>;
  sourceEvidence: TaskRecordEvidenceRef[];
  approvalRequired: boolean;
};

export type LedgerPostingPlan = {
  schemaVersion: 2;
  workItemId: string;
  resultRevision: number;
  primary: LedgerPostingOperation | null;
  related: LedgerPostingOperation[];
  state: LedgerPostingPlanState;
};

export declare function normalizeBusinessLedgerRecordRef(input: unknown): BusinessLedgerRecordRef | null;
export declare function normalizeTaskRecordBinding(input: unknown): { ok: true; value: TaskRecordBinding } | { ok: false; error: string };
export declare function normalizeTaskTemplateContractV2(input: unknown): { ok: true; value: TaskTemplateContractV2 } | { ok: false; error: string };
export declare function normalizeLedgerPostingPlan(input: unknown): { ok: true; value: LedgerPostingPlan } | { ok: false; error: string };
