import type { IsoDateTime } from "./common.js";

export declare const businessRoutineSchemaVersion: 1;

export declare const businessDocumentTypes: readonly [
  "inquiry",
  "quotation",
  "order",
  "inquiry_ledger",
  "quotation_ledger",
  "order_ledger",
  "price_list",
  "customer_reference",
  "other_reference",
  "unknown",
];
export type BusinessDocumentType = (typeof businessDocumentTypes)[number];

export declare const businessEntityTypes: readonly ["customer", "product", "inquiry", "quotation", "order"];
export type BusinessEntityType = (typeof businessEntityTypes)[number];

export declare const routineArtifactRoles: readonly ["trigger", "input", "output", "reference"];
export type RoutineArtifactRole = (typeof routineArtifactRoles)[number];

export declare const routineStepKinds: readonly [
  "extract",
  "retrieve",
  "generate",
  "ledger_upsert",
  "human_approval",
  "condition",
  "create_issue",
];
export type RoutineStepKind = (typeof routineStepKinds)[number];

export declare const routineDefinitionStates: readonly ["candidate", "draft", "published", "disabled", "superseded"];
export type RoutineDefinitionState = (typeof routineDefinitionStates)[number];
export declare const businessCaseStates: readonly ["proposed", "confirmed", "active", "completed", "archived"];
export type BusinessCaseState = (typeof businessCaseStates)[number];
export declare const businessCaseCandidateStates: readonly ["proposed", "confirmed", "rejected", "superseded"];
export type BusinessCaseCandidateState = (typeof businessCaseCandidateStates)[number];
export declare const businessCaseRelationshipKinds: readonly ["precedes", "uses_reference", "registers", "handoff"];
export type BusinessCaseRelationshipKind = (typeof businessCaseRelationshipKinds)[number];
export declare const routineDiscoveryCandidateStates: readonly ["candidate", "superseded"];
export type RoutineDiscoveryCandidateState = (typeof routineDiscoveryCandidateStates)[number];
export declare const routineStepRequirements: readonly ["mandatory", "conditional"];
export type RoutineStepRequirement = (typeof routineStepRequirements)[number];
export declare const ledgerDefinitionStates: readonly ["draft", "active", "disabled"];
export type LedgerDefinitionState = (typeof ledgerDefinitionStates)[number];
export declare const routineRunStates: readonly ["planned", "running", "awaiting_approval", "succeeded", "failed", "cancelled"];
export type RoutineRunState = (typeof routineRunStates)[number];
export declare const routineStepRunStates: readonly [
  "pending",
  "running",
  "awaiting_approval",
  "succeeded",
  "skipped",
  "failed",
  "cancelled",
];
export type RoutineStepRunState = (typeof routineStepRunStates)[number];
export declare const businessDocumentAnalysisStates: readonly ["deterministic", "hybrid", "degraded"];
export type BusinessDocumentAnalysisState = (typeof businessDocumentAnalysisStates)[number];
export declare const businessFieldKeys: readonly [
  "customer",
  "product",
  "quantity",
  "currency",
  "amount",
  "document_date",
  "inquiry_number",
  "quotation_number",
  "order_number",
];
export type BusinessFieldKey = (typeof businessFieldKeys)[number];
export declare const businessFieldConfirmationStates: readonly ["proposed", "confirmed", "corrected"];
export type BusinessFieldConfirmationState = (typeof businessFieldConfirmationStates)[number];

export type RoutineEvidenceRef = {
  artifactId: string;
  kind: string;
  field: string | null;
  /** Source-relative structural location, never an absolute local path or raw content. */
  location: string | null;
};

export type BusinessFieldProposal = {
  key: BusinessFieldKey;
  value: string;
  normalizedValue: string | null;
  confidence: number;
  evidenceRefs: RoutineEvidenceRef[];
  confirmationState: BusinessFieldConfirmationState;
};

export type BusinessDocumentClassification = {
  id: string;
  schemaVersion: 1;
  ownerTeamId: string;
  projectId: string;
  sourceId: string;
  artifactId: string;
  documentType: BusinessDocumentType;
  confidence: number;
  reasons: string[];
  evidenceRefs: RoutineEvidenceRef[];
  fieldProposals: BusinessFieldProposal[];
  riskSignals: string[];
  confirmationState: "proposed" | "confirmed" | "corrected";
  classifierVersion: number;
  extractorVersion: number;
  analysisState: BusinessDocumentAnalysisState;
  artifactFingerprint: string;
  analysisKey: string;
  degradedReason: string | null;
  provider: string | null;
  model: string | null;
  revision: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type BusinessEntity = {
  id: string;
  schemaVersion: 1;
  ownerTeamId: string;
  projectId: string;
  sourceId: string;
  entityType: BusinessEntityType;
  businessKey: string;
  fields: Record<string, string | number | boolean | null>;
  evidenceRefs: RoutineEvidenceRef[];
  confidence: number;
  revision: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type BusinessCaseArtifactBinding = {
  artifactId: string;
  documentType: BusinessDocumentType;
  roles: RoutineArtifactRole[];
};

export type BusinessCase = {
  id: string;
  schemaVersion: 1;
  ownerTeamId: string;
  projectId: string;
  sourceId: string;
  businessKey: string;
  state: BusinessCaseState;
  entityIds: string[];
  artifactBindings: BusinessCaseArtifactBinding[];
  /** Fingerprints captured when the case was confirmed; used to invalidate stale evidence. */
  artifactFingerprints: Record<string, string>;
  evidenceRefs: RoutineEvidenceRef[];
  confidence: number;
  revision: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type BusinessCaseLinkAlternative = {
  artifactId: string;
  score: number;
  reasons: string[];
};

export type BusinessCaseCandidateLink = {
  fromArtifactId: string;
  toArtifactId: string;
  relationship: BusinessCaseRelationshipKind;
  score: number;
  reasons: string[];
  evidenceRefs: RoutineEvidenceRef[];
  alternatives: BusinessCaseLinkAlternative[];
};

export type BusinessCaseCandidate = {
  id: string;
  familyId: string;
  schemaVersion: 1;
  ownerTeamId: string;
  projectId: string;
  sourceId: string;
  businessKey: string;
  version: number;
  state: BusinessCaseCandidateState;
  anchorArtifactId: string;
  artifactBindings: BusinessCaseArtifactBinding[];
  links: BusinessCaseCandidateLink[];
  evidenceRefs: RoutineEvidenceRef[];
  artifactFingerprints: Record<string, string>;
  confidence: number;
  correctionReason: string | null;
  supersedesId: string | null;
  supersededById: string | null;
  businessCaseId: string | null;
  revision: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type RoutineDiscoveryStep = RoutineStep & {
  requirement: RoutineStepRequirement;
  coverage: number;
  supportCaseIds: string[];
  exceptionCaseIds: string[];
  explanation: string;
};

export type RoutineDiscoveryCandidate = {
  id: string;
  familyId: string;
  schemaVersion: 1;
  ownerTeamId: string;
  projectId: string;
  sourceId: string;
  name: string;
  version: number;
  state: RoutineDiscoveryCandidateState;
  triggerDocumentTypes: BusinessDocumentType[];
  confirmedCaseIds: string[];
  minimumCaseCount: number;
  mandatoryCoverageThreshold: number;
  steps: RoutineDiscoveryStep[];
  evidenceRefs: RoutineEvidenceRef[];
  confidence: number;
  supersedesId: string | null;
  supersededById: string | null;
  revision: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type RoutineStep = {
  key: string;
  kind: RoutineStepKind;
  label: string;
  required: boolean;
  dependsOn: string[];
  evidenceRefs: RoutineEvidenceRef[];
  configuration: Record<string, unknown>;
};

export type RoutineDefinition = {
  id: string;
  familyId: string;
  schemaVersion: 1;
  ownerTeamId: string;
  projectId: string;
  sourceId: string;
  name: string;
  version: number;
  state: RoutineDefinitionState;
  triggerDocumentTypes: BusinessDocumentType[];
  steps: RoutineStep[];
  evidenceRefs: RoutineEvidenceRef[];
  confidence: number;
  supersedesId: string | null;
  supersededById: string | null;
  revision: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type RoutineStepRun = {
  stepKey: string;
  kind: RoutineStepKind;
  state: RoutineStepRunState;
  idempotencyKey: string;
  startedAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
  errorCode: string | null;
};

export type RoutineRun = {
  id: string;
  schemaVersion: 1;
  ownerTeamId: string;
  projectId: string;
  sourceId: string;
  routineDefinitionId: string;
  routineVersion: number;
  businessCaseId: string;
  businessKey: string;
  triggerArtifactIds: string[];
  workItemId: string | null;
  status: RoutineRunState;
  issueIdempotencyKey: string;
  outputPublicationIdempotencyKey: string;
  stepRuns: RoutineStepRun[];
  revision: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type LedgerDefinition = {
  id: string;
  schemaVersion: 1;
  ownerTeamId: string;
  projectId: string;
  sourceId: string;
  name: string;
  state: LedgerDefinitionState;
  format: "csv" | "xlsx";
  relativePath: string;
  sheet: string | null;
  businessKeyField: string;
  fieldMappings: Record<string, string>;
  revision: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

export type LocalIssueRoutineBinding = {
  schemaVersion: 1;
  routineDefinitionId: string;
  routineVersion: number;
  businessCaseId: string;
  businessKey: string;
  triggerArtifactIds: string[];
};

export declare function normalizeRoutineEvidenceRefs(values: unknown): RoutineEvidenceRef[] | null;
export declare function normalizeBusinessFieldProposals(values: unknown): BusinessFieldProposal[] | null;
export declare function normalizeBusinessDocumentClassification(input: unknown):
  | { ok: true; value: Omit<BusinessDocumentClassification, "id" | "ownerTeamId" | "projectId" | "sourceId" | "revision" | "createdAt" | "updatedAt"> }
  | { ok: false; error: string };
export declare function normalizeRoutineSteps(values: unknown):
  | { ok: true; value: RoutineStep[] }
  | { ok: false; error: string };
export declare function normalizeLocalIssueRoutineBinding(input: unknown):
  | { ok: true; value: LocalIssueRoutineBinding | null }
  | { ok: false; error: string };
