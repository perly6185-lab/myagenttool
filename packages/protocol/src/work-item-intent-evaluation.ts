import type {
  WorkItemIntentAccessMode,
  WorkItemIntentMaterial,
  WorkItemIntentOperation,
  WorkItemIntentSource,
} from "./work-item-intent-contract.js";

export declare const workItemIntentEvaluationSchemaVersion: 1;
export declare const workItemIntentEvaluationFields: readonly ["goal", "action", "materials", "output", "delivery"];
export type WorkItemIntentEvaluationField = (typeof workItemIntentEvaluationFields)[number];

export type WorkItemIntentEvaluationThresholds = {
  minimumCaseCount: number;
  exactCaseAccuracy: number;
  macroFieldAccuracy: number;
  goalAccuracy: number;
  actionAccuracy: number;
  materialsAccuracy: number;
  outputAccuracy: number;
  deliveryAccuracy: number;
  unsafeActionExpansionRate: number;
};

export declare const workItemIntentEvaluationDefaultThresholds: Readonly<WorkItemIntentEvaluationThresholds>;

export type WorkItemIntentEvaluationExpectation = {
  goal: { value: string; source: WorkItemIntentSource };
  action: { accessMode: WorkItemIntentAccessMode; operation: WorkItemIntentOperation; forbiddenActions: string[]; source: WorkItemIntentSource };
  materials: { inputs: WorkItemIntentMaterial[]; changeTargets: Array<WorkItemIntentMaterial & { canCommit: boolean }>; source: WorkItemIntentSource };
  output: { value: string | null; source: WorkItemIntentSource };
  delivery: { destination: "channel" | "task"; platformId: string | null; platformLabel: string | null; source: WorkItemIntentSource };
};

export type WorkItemIntentFieldEvaluation = {
  field: WorkItemIntentEvaluationField;
  pass: boolean;
  expected: unknown;
  actual: unknown;
  mismatchPaths: string[];
};

export type WorkItemIntentEvaluationCaseResult = {
  id: string;
  pass: boolean;
  tags: string[];
  contractDigest: string;
  contractStatus: string;
  fields: Record<WorkItemIntentEvaluationField, WorkItemIntentFieldEvaluation>;
  failedFields: WorkItemIntentEvaluationField[];
  unsafeActionExpansion: boolean;
};

export type WorkItemIntentEvaluationReport = {
  schemaVersion: 1;
  datasetId: string;
  datasetVersion: number;
  datasetDigest: string | null;
  datasetValid: boolean;
  datasetErrors: string[];
  total: number;
  passed: number;
  failed: WorkItemIntentEvaluationCaseResult[];
  metrics: {
    exactCaseAccuracy: number;
    macroFieldAccuracy: number;
    fieldAccuracy: Record<WorkItemIntentEvaluationField, number>;
    unsafeActionExpansionRate: number;
  };
  thresholds: WorkItemIntentEvaluationThresholds;
  gateFailures: string[];
  releaseReady: boolean;
  results: WorkItemIntentEvaluationCaseResult[];
};

export declare function normalizeWorkItemIntentEvaluationField(value: unknown): WorkItemIntentEvaluationField | null;
export declare function normalizeWorkItemIntentEvaluationThresholds(value: unknown): WorkItemIntentEvaluationThresholds;
