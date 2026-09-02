import type { WorkItemIntentAccessMode, WorkItemIntentContract, WorkItemIntentOperation } from "./work-item-intent-contract.js";

export declare const workItemReviewIntentSchemaVersion: 1;
export declare const workItemReviewIntentEffectCodes: readonly [
  "result_only",
  "apply_local_changes",
  "create_pull_request",
  "update_pull_request",
  "apply_office_result",
  "unavailable",
];
export type WorkItemReviewIntentEffectCode = (typeof workItemReviewIntentEffectCodes)[number];

export declare const workItemReviewIntentRiskCodes: readonly [
  "uncommitted_worktree_retained",
  "local_base_branch_write",
  "remote_branch_and_notifications",
  "project_material_write",
  "effect_unavailable",
];
export type WorkItemReviewIntentRiskCode = (typeof workItemReviewIntentRiskCodes)[number];

export type WorkItemReviewIntent = {
  schemaVersion: 1;
  source: "frozen_execution_contract" | "unavailable";
  intentDigest: string | null;
  goal: string | null;
  expectedOutput: string | null;
  taskKind: string | null;
  action: null | {
    accessMode: WorkItemIntentAccessMode;
    operation: WorkItemIntentOperation;
    forbiddenActions: string[];
  };
  materials: null | {
    inputCount: number;
    inputTitles: string[];
    changeTargetCount: number;
    changeTargetTitles: string[];
  };
  delivery: null | {
    destination: "channel" | "task";
    platformId: string | null;
    platformLabel: string | null;
  };
  confirmation: {
    requestedOperation: string | null;
    operation: string | null;
    effectCode: WorkItemReviewIntentEffectCode;
    riskCode: WorkItemReviewIntentRiskCode;
    riskLevel: "low" | "medium" | "unknown";
    resultOnly: boolean;
  };
};

export declare function projectWorkItemReviewIntent(input?: {
  intentContract?: WorkItemIntentContract | null;
  deliveryEvidence?: unknown;
}): WorkItemReviewIntent;
