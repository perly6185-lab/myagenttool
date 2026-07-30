import {
  request,
  type BusinessDocumentAnalysisJob,
  type BusinessDocumentClassification,
  type BusinessDocumentType,
  type BusinessFieldProposal,
  type BusinessCaseCandidate,
  type BusinessRoutineDiscoveryCandidate,
  type BusinessRoutineDefinition,
  type BusinessRoutineStep,
  type DeliveryCase,
  type SimilarWorkflowCase,
  type WorkflowArtifact,
  type WorkflowArtifactRole,
  type WorkflowFeedbackReason,
  type WorkflowProfile,
  type WorkflowProfileDraft,
  type WorkflowRequirementInspection,
  type WorkflowRetrievalEvaluation,
  type WorkflowRun,
  type WorkflowSource,
} from "@/lib/api-client";

export interface WorkflowIntakeObservation {
  id: string;
  projectId: string;
  sourceId: string;
  relativePath: string;
  name: string;
  state: "observing" | "waiting_stable" | "needs_review" | "duplicate" | "ready" | "triggered" | "blocked";
  reason: string | null;
  artifactId: string | null;
  canonicalArtifactId: string | null;
  artifactRevision: number | null;
  extraction: {
    state: "ready" | "needs_ocr" | "failed" | "limited" | "skipped";
    pageCount: number | null;
    characterCount: number;
    providerId: string | null;
    localOnly: boolean | null;
  } | null;
  receiptId?: string | null;
  receipt?: Pick<
    InquiryIntakeReceipt,
    "id" | "businessKey" | "routineDefinitionId" | "routineVersion" | "businessCaseId"
    | "workItemId" | "workItemLocalRef" | "routineRunId" | "state" | "triggeredAt"
  > | null;
  triggeredAt?: string | null;
  revision: number;
  updatedAt: string;
}

export interface InquiryIntakeRoutine {
  id: string;
  name: string;
  description: string;
  version: number;
  triggerDocumentTypes: string[];
}

export interface InquiryIntakeReceipt {
  id: string;
  projectId: string;
  sourceId: string;
  observationId: string;
  artifactId: string;
  supportingArtifactIds: string[];
  supportingObservationIds: string[];
  supportingBindings: Array<{
    observationId: string;
    artifactId: string;
    role: "reference" | "historical_output";
    documentType: "other_reference" | "inquiry_ledger";
    pairingEvidence: Array<{ kind: string; value: string }>;
  }>;
  businessKey: string;
  routineDefinitionId: string;
  routineVersion: number;
  businessCaseId: string;
  workItemId: string;
  workItemLocalRef: string;
  routineRunId: string;
  state: "triggered";
  triggeredAt: string;
  revision: number;
}

export interface InquiryIntakeInspection {
  state: "needs_confirmation";
  observation: {
    id: string;
    sourceId: string;
    artifactId: string;
    relativePath: string;
    revision: number;
    ocrEvidence: Array<{
      page: number;
      kind: "page" | "image";
      width: number | null;
      height: number | null;
      confidence: number | null;
      lineCount: number;
      preview: string;
    }>;
    supportingObservations: Array<{
      id: string;
      artifactId: string;
      relativePath: string;
      name: string;
      family: string;
      extractionState: string;
      role: "reference" | "historical_output";
      documentType: "other_reference" | "inquiry_ledger";
      pairingEvidence: Array<{ kind: string; value: string }>;
      classification?: Pick<
        BusinessDocumentClassification,
        "id" | "artifactId" | "documentType" | "confidence" | "confirmationState"
        | "analysisState" | "riskSignals" | "fieldProposals" | "revision"
      >;
    }>;
  };
  classification: Pick<
    BusinessDocumentClassification,
    "id" | "artifactId" | "documentType" | "confidence" | "confirmationState"
    | "analysisState" | "riskSignals" | "fieldProposals" | "revision"
  >;
  routines: InquiryIntakeRoutine[];
}

export type CommercialPilotDocumentRole =
  | "inquiry"
  | "quotation"
  | "order"
  | "inquiry_ledger"
  | "quotation_ledger"
  | "order_ledger"
  | "unknown";

export interface CommercialPilotCaseDraft {
  id: string;
  workItemId: string;
  templateId: string;
  traits: string[];
  expectedDocumentRole: CommercialPilotDocumentRole;
  relationshipExpected: boolean;
  relationshipArtifactId?: string;
  expectedOutcome: "ordered" | "no_order" | "rejected";
}

export interface CommercialPilotSafetyDraft {
  id: string;
  evidenceKind: "event" | "refusal" | "classification";
  evidenceId: string;
}

export interface CommercialPilotReleaseReview {
  confirmed: boolean;
  recordedAt?: string | null;
  reviewerRole: string;
  performance: boolean;
  security: boolean;
  privacy: boolean;
  accessibility: boolean;
  localization: boolean;
  migration: boolean;
  rollback: boolean;
}

export interface CommercialPilotWorkbenchDraftInput {
  pilotId: string;
  description?: string;
  dataClassification: "deidentified" | "real";
  consent: {
    confirmed: boolean;
    recordedAt?: string | null;
    scope: string;
  };
  releaseReview: CommercialPilotReleaseReview;
  cases: CommercialPilotCaseDraft[];
  safetyScenarios: CommercialPilotSafetyDraft[];
}

export interface CommercialPilotWorkbench {
  draft: CommercialPilotWorkbenchDraftInput & {
    id: string | null;
    projectId: string;
    schemaVersion: 1;
    thresholds: {
      minimumFormalCases: number;
      documentRoleTop1: number;
      relationshipTop1: number;
    };
    revision: number;
    updatedAt: string | null;
    lastCollection: CommercialPilotCollection | null;
  };
  progress: {
    caseCount: number;
    requiredCaseCount: number;
    completeCaseCount: number;
    templateCount: number;
    requiredTemplateCount: number;
    outcomes: string[];
    traits: Array<{ id: string; complete: boolean }>;
    safety: Array<{ id: string; passed: boolean; reason?: string }>;
    releaseReview: Array<{ id: string; complete: boolean }>;
    cases: Array<{
      id: string;
      workItemId: string;
      state: "complete" | "incomplete" | "missing";
      missing: string[];
    }>;
    missing: string[];
    readyForCollection: boolean;
    validationErrors: string[];
  };
  eligible: {
    workItems: Array<{
      id: string;
      localRef: string | null;
      title: string | null;
      status: string;
      businessCaseId: string | null;
    }>;
    relationshipArtifacts: Array<{
      id: string;
      name: string | null;
      family: string;
    }>;
    safetyEvidence: CommercialPilotSafetyDraft[];
  };
  requiredSafetyScenarios: string[];
}

export interface CommercialPilotCollection {
  evidence: {
    state: "complete" | "incomplete";
    missing: string[];
  };
  manifest: Record<string, unknown>;
  report: {
    metrics: {
      formalCaseCount: number;
      documents: {
        top1: number | null;
        unknownCoverage: number | null;
        forcedGuessCount: number;
      };
      relationships: { top1: number | null; top5: number | null };
      correction: { rate: number | null };
      completion: { rate: number | null };
      evidence: { coverage: number | null };
      outcomes: { accuracy: number | null };
      duplicates: { total: number };
      approvals: { coverage: number | null; incompleteCaseCount: number };
      recovery: { passRate: number | null };
      safety: { passRate: number | null };
    };
    gate: {
      decision: "go" | "no_go";
      reasons?: string[];
    };
  };
  verification?: { verified: true };
}

/**
 * Workflow Memory is route-lazy, so keep its sizeable API surface in the same
 * lazy chunk instead of charging every user for it during application boot.
 */
export const workflowMemoryApi = {
  getBusinessPilotWorkbench: (projectId: string) =>
    request<CommercialPilotWorkbench>(
      "GET",
      `/api/workflow-memory/commercial-pilot/workbench?projectId=${encodeURIComponent(projectId)}`,
    ),
  saveBusinessPilotWorkbench: (body: {
    projectId: string;
    expectedRevision: number;
    draft: CommercialPilotWorkbenchDraftInput;
  }) => request<CommercialPilotWorkbench>(
    "PUT",
    "/api/workflow-memory/commercial-pilot/workbench",
    body,
  ),
  collectBusinessPilotWorkbench: (body: {
    projectId: string;
    expectedRevision: number;
  }) => request<CommercialPilotWorkbench & {
    collection: CommercialPilotCollection;
    replayed: boolean;
  }>(
    "POST",
    "/api/workflow-memory/commercial-pilot/workbench/collect",
    body,
  ),
  listWorkflowSources: () =>
    request<{ sources: WorkflowSource[] }>("GET", "/api/workflow-memory/sources"),
  createWorkflowSource: (body: {
    projectId: string;
    relativePath?: string;
    readMode?: WorkflowSource["readMode"];
    name?: string;
  }) => request<{ source: WorkflowSource }>("POST", "/api/workflow-memory/sources", body),
  scanWorkflowSource: (sourceId: string) =>
    request<{
      source: WorkflowSource;
      scan: {
        discovered: number;
        scannedEntries: number;
        skipped: number;
        parsed: number;
        parseFailed: number;
        reused: number;
        truncated: boolean;
        cancelled: boolean;
      };
    }>("POST", `/api/workflow-memory/sources/${encodeURIComponent(sourceId)}/scan`, {}),
  scanWorkflowIncrementalIntake: (sourceId: string) =>
    request<{
      source: WorkflowSource;
      intake: {
        scanRevision: number;
        scannedEntries: number;
        skipped: number;
        truncated: boolean;
        observed: number;
        waitingStable: number;
        ready: number;
        duplicate: number;
        blocked: number;
        unchanged: number;
      };
      observations: WorkflowIntakeObservation[];
    }>("POST", `/api/workflow-memory/sources/${encodeURIComponent(sourceId)}/scan-intake`, {}),
  listWorkflowIntakeObservations: (sourceId: string) =>
    request<{ observations: WorkflowIntakeObservation[]; count: number }>(
      "GET",
      `/api/workflow-memory/intake-observations?sourceId=${encodeURIComponent(sourceId)}`,
    ),
  getWorkflowOcrReadiness: () =>
    request<{
      state: "ready" | "unavailable";
      providerId: string | null;
      reason: string | null;
      localOnly: true;
      supportedExtensions: string[];
    }>("GET", "/api/workflow-memory/ocr-readiness"),
  ocrWorkflowArtifact: (
    artifactId: string,
    body: { expectedRevision: number; confirmed: true },
  ) => request<{ artifact: WorkflowArtifact; replayed: boolean }>(
    "POST",
    `/api/workflow-memory/artifacts/${encodeURIComponent(artifactId)}/ocr`,
    body,
    true,
    190_000,
  ),
  cancelWorkflowOcrArtifact: (artifactId: string) =>
    request<{ artifactId: string; cancellationRequested: true }>(
      "DELETE",
      `/api/workflow-memory/artifacts/${encodeURIComponent(artifactId)}/ocr`,
    ),
  getWorkflowOcrStatus: (artifactId: string) =>
    request<{
      state: "idle" | "running" | "completed";
      completedPages: number;
      totalPages: number | null;
    }>(
      "GET",
      `/api/workflow-memory/artifacts/${encodeURIComponent(artifactId)}/ocr`,
    ),
  inspectWorkflowInquiryIntake: (
    observationId: string,
    supportingObservationIds: string[] = [],
    supportingObservationRoles: Record<string, "reference" | "historical_output"> = {},
  ) =>
    request<InquiryIntakeInspection | {
      state: "triggered";
      receipt: InquiryIntakeReceipt;
      replayed: true;
    }>(
      "POST",
      `/api/workflow-memory/intake-observations/${encodeURIComponent(observationId)}/inspect`,
      { supportingObservationIds, supportingObservationRoles },
    ),
  acceptWorkflowInquiryIntake: (
    observationId: string,
    body: {
      expectedRevision: number;
      idempotencyKey: string;
      routineDefinitionId: string;
      confirmed: true;
      fieldCorrections?: Partial<Record<BusinessFieldProposal["key"], string>>;
      excludedFieldKeys?: BusinessFieldProposal["key"][];
      supportingObservationIds?: string[];
      supportingObservationRoles?: Record<string, "reference" | "historical_output">;
    },
  ) => request<{
    state: "triggered";
    receipt: InquiryIntakeReceipt;
    replayed: boolean;
  }>(
    "POST",
    `/api/workflow-memory/intake-observations/${encodeURIComponent(observationId)}/accept`,
    body,
  ),
  cancelWorkflowSourceScan: (sourceId: string) =>
    request<{ sourceId: string; cancellationRequested: true }>(
      "POST",
      `/api/workflow-memory/sources/${encodeURIComponent(sourceId)}/cancel-scan`,
      {},
    ),
  revokeWorkflowSource: (sourceId: string, expectedRevision: number) =>
    request<{ source: WorkflowSource }>(
      "POST",
      `/api/workflow-memory/sources/${encodeURIComponent(sourceId)}/revoke`,
      { expectedRevision },
    ),
  deleteWorkflowSourceLearning: (sourceId: string, expectedRevision: number) =>
    request<{
      deleted: true;
      sourceId: string;
      counts: {
        artifacts: number;
        cases: number;
        profiles: number;
        profileDrafts: number;
        runs: number;
        businessDocumentClassifications: number;
        businessDocumentAnalysisJobs: number;
        businessEntities: number;
        businessCaseCandidates: number;
        businessCases: number;
        routineDiscoveryCandidates: number;
        routineDefinitions: number;
        routineRuns: number;
        ledgerDefinitions: number;
      };
      originalFilesDeleted: false;
    }>(
      "POST",
      `/api/workflow-memory/sources/${encodeURIComponent(sourceId)}/delete-learning-data`,
      { expectedRevision, confirmed: true },
    ),
  listWorkflowArtifacts: (filters: {
    sourceId?: string;
    role?: WorkflowArtifactRole;
    availability?: "available" | "missing";
  } = {}) => {
    const query = new URLSearchParams();
    if (filters.sourceId) query.set("sourceId", filters.sourceId);
    if (filters.role) query.set("role", filters.role);
    if (filters.availability) query.set("availability", filters.availability);
    const suffix = query.toString() ? `?${query}` : "";
    return request<{ artifacts: WorkflowArtifact[]; count: number }>(
      "GET",
      `/api/workflow-memory/artifacts${suffix}`,
    );
  },
  confirmWorkflowArtifact: (
    artifactId: string,
    body: { role: WorkflowArtifactRole; expectedRevision: number },
  ) => request<{ artifact: WorkflowArtifact }>(
    "POST",
    `/api/workflow-memory/artifacts/${encodeURIComponent(artifactId)}/confirm`,
    body,
  ),
  retryWorkflowArtifactExtraction: (artifactId: string, expectedRevision: number) =>
    request<{ artifact: WorkflowArtifact }>(
      "POST",
      `/api/workflow-memory/artifacts/${encodeURIComponent(artifactId)}/retry-extraction`,
      { expectedRevision },
    ),
  setWorkflowArtifactExclusion: (
    artifactId: string,
    body: { expectedRevision: number; excluded: boolean; reason?: string },
  ) => request<{ artifact: WorkflowArtifact }>(
    "POST",
    `/api/workflow-memory/artifacts/${encodeURIComponent(artifactId)}/${body.excluded ? "exclude" : "include"}`,
    { expectedRevision: body.expectedRevision, reason: body.reason },
  ),
  analyzeBusinessDocuments: (sourceId: string) =>
    request<{ job: BusinessDocumentAnalysisJob }>(
      "POST",
      `/api/workflow-memory/sources/${encodeURIComponent(sourceId)}/analyze-business-documents`,
      {},
    ),
  cancelBusinessDocumentAnalysis: (sourceId: string) =>
    request<{ sourceId: string; jobId: string; cancellationRequested: true }>(
      "POST",
      `/api/workflow-memory/sources/${encodeURIComponent(sourceId)}/cancel-business-analysis`,
      {},
    ),
  analyzeBusinessDocument: (artifactId: string) =>
    request<{ classification: BusinessDocumentClassification; replayed: boolean }>(
      "POST",
      `/api/workflow-memory/artifacts/${encodeURIComponent(artifactId)}/analyze-business-document`,
      {},
    ),
  listBusinessDocumentClassifications: (filters: {
    sourceId?: string;
    confirmationState?: BusinessDocumentClassification["confirmationState"];
  } = {}) => {
    const query = new URLSearchParams();
    if (filters.sourceId) query.set("sourceId", filters.sourceId);
    if (filters.confirmationState) query.set("confirmationState", filters.confirmationState);
    const suffix = query.toString() ? `?${query}` : "";
    return request<{ classifications: BusinessDocumentClassification[]; count: number }>(
      "GET",
      `/api/workflow-memory/business-document-classifications${suffix}`,
    );
  },
  listBusinessDocumentAnalysisJobs: (sourceId?: string) =>
    request<{ jobs: BusinessDocumentAnalysisJob[]; count: number }>(
      "GET",
      `/api/workflow-memory/business-document-analysis-jobs${sourceId ? `?sourceId=${encodeURIComponent(sourceId)}` : ""}`,
    ),
  confirmBusinessDocumentClassification: (
    classificationId: string,
    body: {
      expectedRevision: number;
      documentType?: BusinessDocumentType;
      fieldCorrections?: Partial<Record<BusinessFieldProposal["key"], string>>;
      excludedFieldKeys?: BusinessFieldProposal["key"][];
    },
  ) => request<{
    classification: BusinessDocumentClassification;
    entity: Record<string, unknown> | null;
    entityReason: string | null;
  }>(
    "POST",
    `/api/workflow-memory/business-document-classifications/${encodeURIComponent(classificationId)}/confirm`,
    body,
  ),
  discoverBusinessCases: (sourceId: string) =>
    request<{
      sourceId: string;
      candidates: Array<BusinessCaseCandidate & { replayed: boolean }>;
      count: number;
      analyzedClassificationCount: number;
      truncated: boolean;
    }>(
      "POST",
      `/api/workflow-memory/sources/${encodeURIComponent(sourceId)}/discover-business-cases`,
      {},
    ),
  listBusinessCaseCandidates: (filters: {
    sourceId?: string;
    state?: BusinessCaseCandidate["state"];
  } = {}) => {
    const query = new URLSearchParams();
    if (filters.sourceId) query.set("sourceId", filters.sourceId);
    if (filters.state) query.set("state", filters.state);
    const suffix = query.toString() ? `?${query}` : "";
    return request<{ candidates: BusinessCaseCandidate[]; count: number }>(
      "GET",
      `/api/workflow-memory/business-case-candidates${suffix}`,
    );
  },
  reviewBusinessCaseCandidate: (
    candidateId: string,
    body: {
      expectedRevision: number;
      action: "confirm" | "reject" | "correct";
      artifactIds?: string[];
      correctionReason?: string;
    },
  ) => request<{ candidate: BusinessCaseCandidate; businessCase?: Record<string, unknown> }>(
    "POST",
    `/api/workflow-memory/business-case-candidates/${encodeURIComponent(candidateId)}/review`,
    body,
  ),
  discoverBusinessRoutine: (sourceId: string) =>
    request<{ candidate: BusinessRoutineDiscoveryCandidate; replayed: boolean }>(
      "POST",
      `/api/workflow-memory/sources/${encodeURIComponent(sourceId)}/discover-business-routine`,
      {},
    ),
  listBusinessRoutineCandidates: (sourceId?: string) =>
    request<{ candidates: BusinessRoutineDiscoveryCandidate[]; count: number }>(
      "GET",
      `/api/workflow-memory/business-routine-candidates${sourceId ? `?sourceId=${encodeURIComponent(sourceId)}` : ""}`,
    ),
  createBusinessRoutineDraft: (candidateId: string) =>
    request<{ routineDefinition: BusinessRoutineDefinition; replayed: boolean }>(
      "POST",
      `/api/workflow-memory/business-routine-candidates/${encodeURIComponent(candidateId)}/create-draft`,
      {},
    ),
  listBusinessRoutineDefinitions: (sourceId?: string) =>
    request<{ routineDefinitions: BusinessRoutineDefinition[]; count: number }>(
      "GET",
      `/api/workflow-memory/business-routine-definitions${sourceId ? `?sourceId=${encodeURIComponent(sourceId)}` : ""}`,
    ),
  updateBusinessRoutineDefinition: (
    routineDefinitionId: string,
    body: {
      expectedRevision: number;
      name?: string;
      description?: string;
      triggerDocumentTypes?: BusinessDocumentType[];
      steps?: BusinessRoutineStep[];
    },
  ) => request<{ routineDefinition: BusinessRoutineDefinition }>(
    "POST",
    `/api/workflow-memory/business-routine-definitions/${encodeURIComponent(routineDefinitionId)}/update`,
    body,
  ),
  publishBusinessRoutineDefinition: (
    routineDefinitionId: string,
    expectedRevision: number,
    confirmed: boolean,
  ) => request<{ routineDefinition: BusinessRoutineDefinition; superseded?: BusinessRoutineDefinition }>(
    "POST",
    `/api/workflow-memory/business-routine-definitions/${encodeURIComponent(routineDefinitionId)}/publish`,
    { expectedRevision, confirmed },
  ),
  createBusinessRoutineDefinitionVersion: (
    routineDefinitionId: string,
    expectedRevision: number,
  ) => request<{ routineDefinition: BusinessRoutineDefinition; replayed: boolean }>(
    "POST",
    `/api/workflow-memory/business-routine-definitions/${encodeURIComponent(routineDefinitionId)}/new-version`,
    { expectedRevision },
  ),
  disableBusinessRoutineDefinition: (
    routineDefinitionId: string,
    expectedRevision: number,
  ) => request<{ routineDefinition: BusinessRoutineDefinition }>(
    "POST",
    `/api/workflow-memory/business-routine-definitions/${encodeURIComponent(routineDefinitionId)}/disable`,
    { expectedRevision },
  ),
  workflowPairProposals: (sourceId: string) =>
    request<{ sourceId: string; proposals: import("@/lib/api-client").WorkflowPairProposal[] }>(
      "GET",
      `/api/workflow-memory/sources/${encodeURIComponent(sourceId)}/pair-proposals`,
    ),
  indexWorkflowSourceEmbeddings: (sourceId: string) =>
    request<{
      source: WorkflowSource;
      index: {
        providerId: string;
        model: string;
        modelVersion: string;
        eligible: number;
        indexed: number;
        reused: number;
        truncated: boolean;
      };
      evaluation: WorkflowRetrievalEvaluation;
    }>("POST", `/api/workflow-memory/sources/${encodeURIComponent(sourceId)}/index-embeddings`),
  listDeliveryCases: (sourceId?: string) =>
    request<{ cases: DeliveryCase[]; count: number }>(
      "GET",
      `/api/workflow-memory/cases${sourceId ? `?sourceId=${encodeURIComponent(sourceId)}` : ""}`,
    ),
  createDeliveryCase: (body: {
    sourceId: string;
    requirementArtifactIds: string[];
    deliveryArtifactIds: string[];
    referenceArtifactIds?: string[];
    draftArtifactIds?: string[];
    note?: string;
  }) => request<{ deliveryCase: DeliveryCase }>("POST", "/api/workflow-memory/cases", body),
  changeDeliveryCaseState: (
    caseId: string,
    action: "archive" | "restore",
    body: { expectedRevision: number; reason?: string },
  ) => request<{ deliveryCase: DeliveryCase; replayed: boolean }>(
    "POST",
    `/api/workflow-memory/cases/${encodeURIComponent(caseId)}/${action}`,
    body,
  ),
  listWorkflowProfiles: () =>
    request<{ profiles: WorkflowProfile[]; count: number }>("GET", "/api/workflow-memory/profiles"),
  deriveWorkflowProfile: (body: { name?: string; caseIds: string[] }) =>
    request<{ profile: WorkflowProfile }>("POST", "/api/workflow-memory/profiles", body),
  reviseWorkflowProfile: (
    profileId: string,
    body: {
      expectedRevision: number;
      name?: string;
      state?: "trial" | "established" | "disabled";
      requirementSpec?: WorkflowProfile["requirementSpec"];
      outcomeSpec?: WorkflowProfile["outcomeSpec"];
      transformationMap?: WorkflowProfile["transformationMap"];
      taskRecipe?: WorkflowProfile["taskRecipe"];
    },
  ) => request<{ profile: WorkflowProfile; previousProfile: WorkflowProfile }>(
    "POST",
    `/api/workflow-memory/profiles/${encodeURIComponent(profileId)}/revisions`,
    body,
  ),
  listWorkflowProfileDrafts: (profileId?: string) =>
    request<{ drafts: WorkflowProfileDraft[]; count: number }>(
      "GET",
      `/api/workflow-memory/profile-drafts${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ""}`,
    ),
  createWorkflowProfileDraft: (
    profileId: string,
    body: { expectedRevision: number; name?: string },
  ) => request<{ draft: WorkflowProfileDraft; replayed: boolean }>(
    "POST",
    `/api/workflow-memory/profiles/${encodeURIComponent(profileId)}/drafts`,
    body,
  ),
  publishWorkflowProfileDraft: (draftId: string, expectedRevision: number) =>
    request<{
      draft: WorkflowProfileDraft;
      profile: WorkflowProfile;
      previousProfile: WorkflowProfile;
      replayed: boolean;
    }>(
      "POST",
      `/api/workflow-memory/profile-drafts/${encodeURIComponent(draftId)}/publish`,
      { expectedRevision },
    ),
  listWorkflowInbox: (sourceId?: string) =>
    request<{ artifacts: WorkflowArtifact[]; count: number }>(
      "GET",
      `/api/workflow-memory/inbox${sourceId ? `?sourceId=${encodeURIComponent(sourceId)}` : ""}`,
    ),
  matchWorkflowProfiles: (artifactId: string) =>
    request<{
      artifact: WorkflowArtifact;
      matches: Array<{ profile: WorkflowProfile; score: number; reasons: string[] }>;
      similarCases: SimilarWorkflowCase[];
    }>("GET", `/api/workflow-memory/inbox/${encodeURIComponent(artifactId)}/matches`),
  findSimilarWorkflowCases: (artifactId: string, limit = 5) =>
    request<{
      artifact: WorkflowArtifact;
      cases: SimilarWorkflowCase[];
      count: number;
      retrieval: WorkflowRetrievalEvaluation["retrieval"];
    }>(
      "GET",
      `/api/workflow-memory/inbox/${encodeURIComponent(artifactId)}/similar-cases?limit=${limit}`,
    ),
  evaluateWorkflowRetrieval: (sourceId: string) =>
    request<WorkflowRetrievalEvaluation>(
      "GET",
      `/api/workflow-memory/retrieval-evaluation?sourceId=${encodeURIComponent(sourceId)}`,
    ),
  inspectWorkflowRequirement: (artifactId: string, profileId: string) =>
    request<WorkflowRequirementInspection>(
      "GET",
      `/api/workflow-memory/inbox/${encodeURIComponent(artifactId)}/inspect?profileId=${encodeURIComponent(profileId)}`,
    ),
  listWorkflowRuns: () =>
    request<{ runs: WorkflowRun[]; count: number }>("GET", "/api/workflow-memory/runs"),
  createWorkflowRun: (body: {
    artifactId: string;
    profileId: string;
    answers?: Record<string, string>;
  }) => request<{
    run: WorkflowRun;
    workItem: { id: string; localRef?: string };
    replayed: boolean;
  }>("POST", "/api/workflow-memory/runs", body),
  executeWorkflowRun: (
    runId: string,
    body: { expectedRevision: number; agentId?: string; baseBranch?: string },
  ) => request<{
    run: WorkflowRun;
    autoRun?: Record<string, unknown>;
    worktree?: Record<string, unknown> | null;
    replayed: boolean;
  }>("POST", `/api/workflow-memory/runs/${encodeURIComponent(runId)}/execute`, body),
  cancelWorkflowRunExecution: (runId: string, expectedRevision: number) =>
    request<{ run: WorkflowRun; autoRun: Record<string, unknown> }>(
      "POST",
      `/api/workflow-memory/runs/${encodeURIComponent(runId)}/cancel-execution`,
      { expectedRevision },
    ),
  retryWorkflowRunExecution: (runId: string, expectedRevision: number) =>
    request<{ run: WorkflowRun; autoRun: Record<string, unknown> }>(
      "POST",
      `/api/workflow-memory/runs/${encodeURIComponent(runId)}/retry-execution`,
      { expectedRevision },
    ),
  cleanupWorkflowRunAttemptWorktree: (
    runId: string,
    attemptNumber: number,
    expectedRevision: number,
  ) => request<{
    run: WorkflowRun;
    attempt: NonNullable<WorkflowRun["executionAttempts"]>[number];
    replayed: boolean;
  }>(
    "POST",
    `/api/workflow-memory/runs/${encodeURIComponent(runId)}/attempts/${attemptNumber}/cleanup`,
    { expectedRevision },
  ),
  selectWorkflowRunAttempt: (
    runId: string,
    attemptNumber: number,
    expectedRevision: number,
  ) => request<{
    run: WorkflowRun;
    attempt: NonNullable<WorkflowRun["executionAttempts"]>[number];
  }>(
    "POST",
    `/api/workflow-memory/runs/${encodeURIComponent(runId)}/attempts/${attemptNumber}/select`,
    { expectedRevision },
  ),
  validateWorkflowRun: (runId: string, expectedRevision: number) =>
    request<{ run: WorkflowRun; passed: boolean; results: WorkflowRun["validationResults"] }>(
      "POST",
      `/api/workflow-memory/runs/${encodeURIComponent(runId)}/validate`,
      { expectedRevision },
    ),
  recordWorkflowRunFeedback: (
    runId: string,
    body: {
      expectedRevision: number;
      feedback: "accepted" | "accepted_with_edits" | "rejected";
      note?: string;
      reasonCode?: WorkflowFeedbackReason;
    },
  ) => request<{
    run: WorkflowRun;
    deliveryCase: DeliveryCase | null;
    profileDraft: WorkflowProfileDraft | null;
    learning: NonNullable<WorkflowRun["feedback"]>["learning"];
  }>("POST", `/api/workflow-memory/runs/${encodeURIComponent(runId)}/feedback`, body),
  previewWorkflowRunPublication: (runId: string, expectedRevision: number) =>
    request<{
      run: WorkflowRun;
      publication: NonNullable<WorkflowRun["publication"]>;
      replayed: boolean;
    }>(
      "POST",
      `/api/workflow-memory/runs/${encodeURIComponent(runId)}/publication-preview`,
      { expectedRevision },
    ),
  publishWorkflowRunOutputs: (
    runId: string,
    body: { expectedRevision: number; publicationId: string; confirmed: true },
  ) => request<{
    run: WorkflowRun;
    publication: NonNullable<WorkflowRun["publication"]>;
    deliveryCase: DeliveryCase | null;
    profileDraft: WorkflowProfileDraft | null;
    replayed: boolean;
  }>("POST", `/api/workflow-memory/runs/${encodeURIComponent(runId)}/publish`, body),
};
