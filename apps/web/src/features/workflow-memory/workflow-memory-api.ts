import {
  request,
  type BusinessDocumentAnalysisJob,
  type BusinessDocumentClassification,
  type BusinessDocumentType,
  type BusinessFieldProposal,
  type BusinessCaseCandidate,
  type BusinessRoutineDiscoveryCandidate,
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

/**
 * Workflow Memory is route-lazy, so keep its sizeable API surface in the same
 * lazy chunk instead of charging every user for it during application boot.
 */
export const workflowMemoryApi = {
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
