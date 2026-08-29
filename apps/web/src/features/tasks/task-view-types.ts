import type { WorkItemContentReference, WorkItemResourceReference } from "@/features/local-content/local-content-types";
import type { LedgerPostingPlan, TaskRecordBinding } from "@myagenttool/protocol/task-resources";

export type GithubItem = {
  type: "issue" | "pr";
  number: number;
  title: string;
  headRefName: string | null;
  author: string;
  url: string | null;
  state: string;
};
export type GithubResult = { available: boolean; message: string; items: GithubItem[] };
export type WorkItemExecutionState = "unclaimed" | "claimed" | "running" | "awaiting_approval" | "verifying" | "failed" | "completed";
export type WorkItemExecutionKind = "auto_run" | "application_invocation" | "article_import" | "article_derivative";
export type WorkItemRequesterRelation = "boss" | "manager" | "customer" | "child" | "colleague" | "self" | "unknown";
export type WorkItemIntakeChannel = "manual" | "meeting" | "email" | "chat" | "phone" | "github" | "import" | "other" | "unknown";
export type WorkItemWaitingOn = "me" | "requester" | "internal" | "ai" | "none";
export type WorkItemIntentContract = {
  schemaVersion: number;
  workItemId: string | null;
  goal: string;
  taskKind: string;
  action: { accessMode: string; operation: string };
  expectedOutput: string | null;
  method: { kind: "template" | "custom"; definitionId: string | null; familyId: string | null; version: number | null; name: string | null };
  materials: { inputCount: number; changeTargets: Array<{ id: string; title: string; canCommit: boolean }> };
  delivery: { destination: "channel" | "task"; platformId: string | null; platformLabel: string | null };
  acceptanceCriteria: string[];
  verificationSop: string[];
  conflicts: Array<{ code: string; severity: "blocking" | "warning"; subject: string; message: string; question: string; resolution: "task_context" | "task_definition" | "template" }>;
  missing: string[];
  clarification: { code: string; question: string; resolution: "task_context" | "task_definition" | "template" } | null;
  status: "ready" | "incomplete" | "needs_clarification";
  digest: string;
  confirmedAt?: string | null;
  confirmedBy?: string | null;
  readOnly?: true;
};
export type ExternalWorkItemBinding = {
  kind: "github_issue" | "gitlab_issue" | "gitea_issue";
  provider?: "github" | "gitlab" | "gitea";
  resourceType?: "issue";
  relation?: "source" | "related" | "duplicate" | "parent" | "blocks";
  isPrimary?: boolean;
  syncPolicy?: "manual" | "webhook_pull" | "bidirectional";
  linkedAt?: string | null;
  linkedBy?: string | null;
  externalId?: string;
  bindingId?: string;
  number: number; url: string | null; lastSyncedAt: string;
  conflict: null | { fields: string[]; local: Record<string, unknown>; remote: Record<string, unknown> };
};
export type LocalWorkItem = {
  id: string;
  localRef: string;
  projectId: string;
  title: string;
  body: string;
  type: "task" | "bug" | "feature" | "initiative";
  status: "backlog" | "ready" | "in_progress" | "review" | "blocked" | "done";
  priority: "p0" | "p1" | "p2" | "p3";
  intentId?: string | null;
  intentStatement?: string;
  taskKind?: string;
  workGoalId?: string | null;
  artifactContract?: { consumes: string[]; produces: string[]; requirements?: Array<Record<string, unknown>> };
  resultVerification?: {
    schemaVersion: number;
    status: "passed" | "failed" | "not_required";
    summary: string;
    checks: Array<{
      kind: string;
      status: "passed" | "failed";
      summary: string;
      expected?: Record<string, unknown>;
      actual?: Record<string, unknown>;
    }>;
    verificationChecks: Array<{
      kind: string;
      status: "passed" | "failed";
      summary: string;
    }>;
    repair: {
      required: true;
      mode: "independent_task";
      reasons: string[];
      suggestedRequest: string;
    } | null;
    digest: string;
  } | null;
  repairOfWorkItemId?: string | null;
  resultRepairReasons?: string[];
  platformTarget?: { id: string; label: string } | null;
  artifactHandoffs?: Array<{
    sourceWorkItemId: string;
    kinds: string[];
    assetIds: string[];
    status: "attached" | "awaiting_artifact";
    at: string;
  }>;
  creationBasis?: "explicit_user_intent" | "channel_ingest_rule" | "saved_automation" | "required_guard" | "imported";
  planningHorizon?: "committed";
  executionPolicy?: "inherit" | "auto" | "manual" | "paused";
  state: "open" | "closed";
  businessState?: "open" | "closed";
  planningStatus?: LocalWorkItem["status"];
  executionState?: WorkItemExecutionState;
  executionKind?: WorkItemExecutionKind | null;
  statusModel?: {
    business: "open" | "closed";
    planning: LocalWorkItem["status"];
    execution: WorkItemExecutionState;
  };
  labels: string[];
  assigneeIds: string[];
  followUpSchemaVersion: 1;
  requesterRelation: WorkItemRequesterRelation;
  requesterName: string | null;
  requesterOrganization: string | null;
  requesterUserId: string | null;
  intakeChannel: WorkItemIntakeChannel;
  externalReference: string | null;
  waitingOn: WorkItemWaitingOn;
  commitmentDate: string | null;
  nextFollowUpAt: string | null;
  lastProgressAt: string | null;
  lastProgressSummary: string | null;
  acceptanceCriteria: string[];
  acceptanceCriteriaSource?: "manual" | "body_extracted" | "assisted" | "structured" | "body_unstructured" | null;
  verificationSop?: string[];
  executionContractSource?: "manual" | "body_extracted" | "assisted" | null;
  executionContractConfirmedAt?: string | null;
  executionStartReceipt?: {
    schemaVersion: 1;
    id: string;
    status: "queued" | "starting" | "started" | "blocked" | "paused" | "cancelled";
    requestedAt: string | null;
    requestedBy: string | null;
    confirmedRevision: number | null;
    contractDigest: string | null;
    updatedAt: string | null;
    startedAt: string | null;
    executionKind: "auto_run" | "application_invocation" | null;
    targetId: string | null;
    agentId: string | null;
    phase: string | null;
    reasonCode: string | null;
    reasonDetail: string | null;
    cancelledAt: string | null;
    cancelledBy: string | null;
    canCancel: boolean;
  } | null;
  executionContractGate?: {
    ready: boolean;
    missing: ("acceptance_criteria" | "verification_sop" | "confirmation" | "confirmed_before_execution" | "intent_changed")[];
    source: string | null;
    confirmedAt: string | null;
    latestAttemptStartedAt?: string | null;
    intentReady?: boolean;
    clarification?: WorkItemIntentContract["clarification"];
    intentChanged?: boolean;
  };
  intentContract?: WorkItemIntentContract;
  reviewContract?: {
    schemaVersion: "legacy-v1" | "execution-contract-v2" | string;
    id: string;
    workItemId: string;
    workItemRevision: number | null;
    autoRunId: string | null;
    acceptanceCriteria: string[];
    verificationSop: string[];
    intentContract?: WorkItemIntentContract | null;
    confirmedBy: string | null;
    confirmedAt: string | null;
    digest: string | null;
    readOnly: true;
    supersededByGoalRevision?: boolean;
  } | null;
  reviewEvidence?: {
    criterion: string;
    status: "passed" | "failed" | "not_tested";
    note: string;
    verificationId: string | null;
    command: string | null;
    verificationSummary: string | null;
    evidence: { kind: string; ref: string; summary: string; assetId?: string | null; hash?: string | null; version?: string | null; terminalId?: string | null }[];
    sourceAutoRunId: string | null;
    reviewedBy: string | null;
    reviewedAt: string | null;
  }[];
  acceptanceResults?: { criterion: string; status: "passed" | "failed" | "not_tested"; note: string; verificationId: string }[];
  verificationRecords?: {
    id: string; kind: "test" | "build" | "lint" | "typecheck" | "manual" | "review";
    status: "passed" | "failed"; command: string | null; summary: string;
    evidence: { kind: string; ref: string; summary: string; assetId?: string | null; hash?: string | null; version?: string | null; terminalId?: string | null }[]; recordedAt: string; recordedBy: string; sourceAutoRunId?: string | null;
  }[];
  inputAssets?: WorkItemAssetRef[];
  recordBindings?: TaskRecordBinding[];
  ledgerPostingPlanId?: string | null;
  ledgerPostingPlan?: (LedgerPostingPlan & {
    id: string;
    revision: number;
    status: string;
    previewId: string | null;
    batchPreviewId: string | null;
    previewIds: string[];
    invalidatedAt?: string | null;
    invalidatedReason?: string | null;
  }) | null;
  localContentRefs?: WorkItemContentReference[];
  taskResourceRefs?: WorkItemResourceReference[];
  taskContextSummary?: {
    schemaVersion: 1;
    origin: {
      kind: "channel" | "issue" | "manual" | "meeting" | "email" | "chat" | "phone" | "import" | "other" | string;
      label: string;
      provider: string | null;
      channelId: string | null;
      conversationId: string | null;
      threadId: string | null;
      sourceMessageCount: number;
    };
    method: {
      kind: "template" | "custom";
      name: string;
      definitionId: string | null;
      familyId: string | null;
      version: number | null;
      expectedOutput: string | null;
      snapshotHash: string | null;
    };
    materials: Array<{
      id: string;
      title: string;
      role: "required_input" | "reference" | "query_source" | "change_target" | "output";
      allowedRoles: Array<"required_input" | "reference" | "query_source" | "change_target" | "output">;
      source: "channel_attachment" | "task_file" | "my_materials" | "local_resource" | "remote_resource" | "business_record";
      sources?: string[];
      locality: "local" | "remote" | "managed";
      availability: "ready" | "selected" | "pending" | "stale";
      versionPolicy: "pinned" | "latest_at_start";
    }>;
    delivery: {
      destination: "channel" | "task";
      label: string;
      channelId: string | null;
      conversationId: string | null;
      status: string | null;
    };
  };
  taskContextControl?: {
    schemaVersion: 1;
    deliveryDestination: "channel" | "task";
    updatedAt: string;
    updatedBy: string;
  } | null;
  materialChangesPending?: boolean;
  outputAssets?: WorkItemAssetRef[];
  executionArtifacts?: {
    id: string;
    kind: string;
    source: "auto_run" | string;
    autoRunId: string;
    worktreeId: string;
    changedFiles: string[];
    changedFileCount: number;
    baseCommit?: string | null;
    completedAt?: string | null;
  }[];
  channelTaskContract?: {
    schemaVersion: number;
    source: string;
    domain: string;
    riskLevel: string;
    goal: string;
    outputExpectation?: string | null;
    workMode?: {
      schemaVersion: number;
      state: "matched" | "needs_confirmation" | "generic" | string;
      source: "my_template" | "suggested" | "generic" | string;
      name: string;
      version: number | null;
      confidence: string;
      goal: string;
      expectedOutput: string | null;
      inputs: string | null;
      data: {
        status: string;
        requirements: Array<{
          id: string | null;
          label: string;
          kind: string | null;
          required: boolean;
          multiple: boolean;
          state: string;
          sourceId: string | null;
          fields: string[];
        }>;
        sources: Array<{ sourceId: string | null; fileName: string | null; revision: number | null; fingerprint: string | null }>;
        relations: Array<{ id: string | null; fromRequirementId: string | null; fromField: string | null; toRequirementId: string | null; toField: string | null; state: string }>;
        relationStatus: string;
      };
      mutation: { required: boolean; status: string; targetCount: number | null; digest: string | null };
      confirmationRequired: boolean;
      candidates: Array<{ name: string | null; expectedOutput: string | null; definitionId: string | null; version: number | null }>;
      trace: { templateDefinitionId: string | null; templateFamilyId: string | null; templateVersion: number | null; templateMatchReason: string | null; dataPlanDigest: string | null; relationDigest: string | null; executionDigest: string | null };
      digest: string;
      generatedAt: string | null;
    } | null;
    dataPlan?: {
      status: "not_required" | "needs_sources" | "ambiguous" | "ready" | "stale" | string;
      digest: string | null;
      requirements: Array<{
        id: string;
        label: string;
        kind: string;
        fields: string[];
        required: boolean;
        state: "missing" | "ready" | "ambiguous" | string;
        sourceId: string | null;
      }>;
      relations: Array<{
        id: string;
        fromRequirementId: string;
        fromField: string;
        toRequirementId: string;
        toField: string;
        state: string;
      }>;
      sources: Array<{
        sourceId: string;
        fileName: string | null;
        revision: number | null;
        rowCount: number | null;
        fingerprint: string | null;
      }>;
    } | null;
    dataRelationPreview?: {
      status: "not_required" | "waiting_for_data_plan" | "ready" | "needs_review" | "stale" | string;
      relations: Array<{
        id: string;
        state: string;
        fromRequirementId: string;
        fromField: string;
        toRequirementId: string;
        toField: string;
        matchedRows: number;
        unmatchedRows: number;
      }>;
      digest: string | null;
    } | null;
    dataMutationPreview?: {
      status: "needs_sources" | "needs_review" | "ready" | "stale" | "not_required" | string;
      operation: "update" | "insert" | "delete" | string;
      targetSourceIds: string[];
      targetSources: Array<{
        sourceId: string;
        fileName: string | null;
        revision: number | null;
        contentHash: string | null;
        rowCount: number | null;
      }>;
      targetStatus: "explicit" | "single_candidate" | "ambiguous" | string;
      dataMutationScope?: {
        schemaVersion: number;
        operation: "update" | "insert" | "delete" | string;
        targets: Array<{
          sourceId: string;
          revision: number | null;
          contentHash: string | null;
          selector: {
            field: string | null;
            operator: string;
            criteriaDigest: string | null;
            matchCount: number;
            allMatching: boolean;
          };
          expectedRows: number;
        }>;
        changes: Array<{
          field: string;
          operation: string;
          valueDigest: string | null;
          valueProvided: boolean;
        }>;
        expectedAffectedRows: number;
        allowAllMatching: boolean;
      } | null;
      rowSelector?: Array<{
        sourceId: string;
        revision: number | null;
        field: string | null;
        operator: string;
        criteriaDigest: string | null;
        matchCount: number;
        allMatching: boolean;
      }> | null;
      fieldChanges: Array<{
        field: string;
        operation: string;
        valueDigest: string | null;
        valueProvided: boolean;
      }>;
      requiredFields: string[];
      estimatedAffectedRows: number | null;
      maxAffectedRows: number | null;
      writeMode: string;
      digest: string | null;
    } | null;
    dataMutationBinding?: {
      id: string | null;
      projectId: string | null;
      fileSourceId: string | null;
      ledgerDefinitionId: string | null;
      fileName: string | null;
      format: string | null;
      fileSourceRevision: number | null;
      ledgerDefinitionRevision: number | null;
      stale: boolean;
    } | null;
    dataMutationBindings?: Array<{
      id: string | null;
      projectId: string | null;
      fileSourceId: string | null;
      ledgerDefinitionId: string | null;
      fileName: string | null;
      format: string | null;
      fileSourceRevision: number | null;
      ledgerDefinitionRevision: number | null;
      stale: boolean;
    }>;
    ledgerMutationPreview?: {
      kind?: "batch";
      id: string | null;
      ledgerDefinitionId: string | null;
      targetCount?: number;
      operationCount?: number;
      journal?: {
        id: string | null;
        status: string | null;
        appliedCount: number;
        snapshotCount: number;
        rollback: { restoredTargets: number; blockedTargets: number } | null;
      } | null;
      children?: Array<{
        id: string | null;
        ledgerDefinitionId: string | null;
        businessKey?: string | null;
        action: "insert" | "update" | "no_op" | string;
        rowNumber: number | null;
        changedCells: Array<{ field: string | null; column: string | null; before: string | null; after: string | null }>;
        state: string;
        revision: number | null;
        queue: { state: string | null; position: number | null } | null;
      }>;
      action: "insert" | "update" | "no_op" | string;
      rowNumber: number | null;
      changedCells: Array<{ field: string | null; column: string | null; before: string | null; after: string | null }>;
      targetRevision: string | null;
      targetContentHash?: string | null;
      proposedTargetRevision: string | null;
      sourceEvidence: Array<{ artifactId: string | null; field: string | null }>;
      approvalRequired: boolean;
      state: "pending" | "waiting" | "committed" | "invalidated" | string;
      queue: { state: string | null; position: number | null } | null;
      expiresAt: string | null;
      revision: number | null;
    } | null;
    dataRelationConfirmation?: {
      schemaVersion: number;
      id: string | null;
      status: "verified" | "pending" | "stale" | string;
      confirmationMode: "runtime_verified" | "user_confirmation" | string;
      planDigest: string | null;
      relationDigest: string | null;
      objectSnapshotCount: number;
      confirmedAt: string | null;
      confirmedBy: string | null;
    } | null;
  };
  requiredCapabilities?: string[];
  assetReadiness?: { state: "ready" | "waiting_capability" | "refused"; reason: string; terminalId: string };
  queueReadiness?: {
    state: "ready" | "waiting_capability" | "waiting_approval" | "waiting_capacity" | "refusal";
    reason: string; terminalId: string | null;
  };
  applicationResolutions?: {
    state: "ready" | "waiting_capability" | "waiting_approval" | "waiting_capacity" | "refusal";
    terminalId: string; applicationId: string | null; label: string | null;
    reason: string; durationMs: number | null;
  }[];
  assetOperations?: {
    id: string; capability: string; inputAssetId: string; outputAssetId: string | null;
    invocationId: string | null; approvalId: string | null; terminalId: string; traceId: string;
    summary: string; recordedAt: string;
  }[];
  completionGate?: { ready: boolean; missingCriteria: string[]; verificationRequired: boolean };
  dueDate: string | null;
  notBefore?: string | null;
  plannedDate?: string | null;
  carriedFromDate?: string | null;
  schedulePlanSource?: "manual" | "auto_plan" | "rollover" | "urgent_insert" | null;
  scheduleReason?: string | null;
  scheduleOrder?: number | null;
  completedAt?: string | null;
  milestone: string;
  estimatePoints: number;
  revision: number;
  archivedAt: string | null;
  executionBindings?: {
    kind: "worktree" | "auto_run" | "application_invocation" | "article_import" | "article_derivative";
    targetId?: string; id?: string; worktreeId?: string | null; createdAt: string;
    terminalId?: string; applicationId?: string; capabilityId?: string; traceId?: string;
  }[];
  externalBindings?: ExternalWorkItemBinding[];
  planningProjects?: { id: string; name: string; archivedAt: string | null }[];
  dependencyIds?: string[];
  routineDefinitionId?: string;
  routineVersion?: number;
  routineBindingSchemaVersion?: number;
  businessCaseId?: string;
  businessKey?: string;
  triggerArtifactIds?: string[];
  myTemplateBinding?: {
    schemaVersion: 1;
    definitionId: string;
    familyId: string;
    version: number;
    name: string;
    expectedOutput: string;
    matchReasons: string[];
    snapshot: {
      name: string;
      description: string;
      expectedOutput: string;
      steps: Array<{ key: string; kind: string; label: string; required: boolean }>;
    };
    snapshotHash: string;
    matchedAt: string;
  };
  myTemplateOutcomeFeedback?: {
    id: string;
    outcome: "met_expectations" | "wrong_result" | "needs_quality_adjustment";
    note: string;
    definitionId: string;
    familyId: string;
    version: number;
    revision: number;
    createdAt: string;
    updatedAt: string;
  } | null;
  myTemplateDraft?: {
    id: string;
    projectId: string;
    name: string;
    typicalInput: string;
    expectedOutput: string;
    applicability: string;
    steps: string[];
    state: "learning" | "needs_review" | "ready" | "rejected";
    caseCount: number;
    casesRequired: number;
    revision: number;
    origin: { kind: "work_item"; workItemId: string; localRef: string | null; title: string };
    createdAt: string;
    updatedAt: string;
  } | null;
  parentId?: string | null;
  parent?: { id: string; localRef: string; title: string; status: LocalWorkItem["status"]; state: "open" | "closed" } | null;
  subIssues?: { id: string; localRef: string; title: string; status: LocalWorkItem["status"]; state: "open" | "closed" }[];
  subIssuesSummary?: { total: number; completed: number; percentCompleted: number };
  intentPeers?: { id: string; localRef: string; title: string; taskKind: string; status: LocalWorkItem["status"]; state: "open" | "closed" }[];
  workGoal?: {
    id: string;
    title: string;
    statement: string;
    outcome: string;
    status: "active" | "completed" | string;
    planVersion: number;
    platforms: Array<{ id: string; label: string }>;
    progress?: { total: number; completed: number };
    userSummary?: {
      schemaVersion: 1;
      goalId: string;
      title: string;
      outcome: string;
      status: string;
      progress: { total: number; completed: number; cancelled: number; failed: number; running: number; waiting: number; needsUser: number; percent: number };
      quality: { passed: number; failed: number; unchecked: number };
      nextStep: string;
      nextAction?: {
        kind: "none" | "repair_result" | "open_task" | "view_progress" | "view_waiting" | string;
        workItemId: string | null;
        label: string;
      };
      latestChange: { id: string; status: string; summary: string; updatedAt: string | null } | null;
    } | null;
  } | null;
  publicationReadiness?: {
    state: "ready" | "needs_setup";
    reason: string;
    platformId: string | null;
    connection: {
      applicationId: string;
      applicationName: string;
      facadeId: string;
      displayName: string;
      requiresApproval: boolean;
    } | null;
  } | null;
  draftSyncReadiness?: {
    state: "ready" | "needs_setup";
    reason: string;
    platformId: string | null;
    connection: {
      applicationId: string;
      applicationName: string;
      facadeId: string;
      displayName: string;
      requiresApproval: boolean;
    } | null;
  } | null;
  goalTasks?: Array<{
    id: string;
    localRef: string;
    title: string;
    taskKind: string;
    status: LocalWorkItem["status"];
    state: "open" | "closed";
    dependencyIds: string[];
    platformTarget?: { id: string; label: string } | null;
  }>;
  blockedBy?: {
    id: string;
    localRef: string;
    title: string;
    status: LocalWorkItem["status"];
    state: "open" | "closed";
    resolved: boolean;
    taskResolved?: boolean;
    artifactResolved?: boolean;
    unresolvedArtifactKinds?: string[];
  }[];
  blocks?: { id: string; localRef: string; title: string; status: LocalWorkItem["status"]; state: "open" | "closed" }[];
  createdAt?: string;
  updatedAt: string;
};
export type WorkItemAssetRef = {
  id: string | null;
  contentId?: string | null;
  originalName?: string;
  path: string;
  family: string;
  mimeType?: string | null;
  terminalId: string;
  size?: number | null;
  resourceClass?: "small" | "medium" | "large" | "unknown";
  hash: string | null;
  version: string | null;
  worktreeId?: string | null;
  capabilities: string[];
  readiness: { state: "ready" | "waiting_capability"; reason: string };
};
export type LocalWorkItemResult = {
  workItems: LocalWorkItem[];
  count: number;
  nextCursor?: string | null;
  hasMore?: boolean;
};
export type PlanningAutoRun = { id: string; status: string };
export type WorkItemAutoRunBatch = {
  id: string;
  status: "queued" | "running" | "completed" | "completed_with_failures" | "cancelled";
  maxConcurrent: number;
  agentId: string | null;
  total: number;
  completed: number;
  active: number;
  counts: Record<string, number>;
  items: {
    workItemId: string;
    localRef: string;
    title: string;
    status: string;
    autoRunId: string | null;
    error: string | null;
  }[];
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
};
export type PlanningProject = {
  id: string;
  name: string;
  description: string;
  color?: string;
  revision: number;
  archivedAt: string | null;
  autonomyProfile?: "cautious" | "standard" | "high";
  aiHealth?: {
    active: number;
    failed: number;
    blocked: number;
    overdue: number;
    needsAttention: boolean;
    settled?: number;
    successRate?: number | null;
    routingCorrectionRate?: number | null;
    knownCostUsd?: number;
    alertBacklog?: number;
    traceCoverage?: number | null;
    sloStatus?: "insufficient_data" | "healthy" | "at_risk";
    signals?: string[];
    targets?: { successRate: number; maxRoutingCorrectionRate: number; maxAlertBacklog: number };
  };
  updatedAt?: string;
  pinned?: boolean;
  watching?: boolean;
  itemCount: number;
  openItemCount: number;
  completedItemCount: number;
  statusCounts: Record<LocalWorkItem["status"], number>;
  priorityCounts: Record<LocalWorkItem["priority"], number>;
  blockedItemCount?: number;
  overdueItemCount?: number;
  activeRunCount?: number;
  failedRunCount?: number;
  riskScore?: number;
  recommendedActions?: { code: string; count: number; risk: "low" | "medium" | "high"; approvalRequired: boolean }[];
  plannedPoints?: number;
  capacityPoints?: number;
  overCapacity?: boolean;
  capacityUtilization?: number | null;
  startDate?: string | null;
  targetDate?: string | null;
  projectOverdue?: boolean;
  daysRemaining?: number | null;
  ownerId?: string | null;
  unowned?: boolean;
  status?: "planned" | "active" | "on_hold" | "completed";
  tags?: string[];
  statusSummary?: string;
  statusUpdatedAt?: string | null;
  daysSinceStatusUpdate?: number | null;
  staleStatus?: boolean;
  checkIns?: { id: string; summary: string; authorId: string; createdAt: string }[];
  health?: "healthy" | "active" | "attention";
  savedViews?: {
    id: string;
    name: string;
    view: "list" | "board" | "roadmap" | "insights" | "executions";
    filters: { status: string; priority: string; milestone: string; due: "all" | "overdue" | "upcoming" | "month" | "quarter" | "unscheduled" };
  }[];
  automationRules?: { id: string; status: string; priority: string; type: string; label: string }[];
  activity?: { id: string; action: string; actorId: string; createdAt: string; details: Record<string, unknown> }[];
  items?: { membership: { position: number }; workItem: LocalWorkItem }[];
};
export type WorkItemComment = {
  id: string;
  body: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  deletedAt: string | null;
};
export type WorkItemActivity = {
  id: string;
  action: string;
  actorId: string;
  createdAt: string;
  details: Record<string, unknown>;
};
export type WorkItemAttention = {
  id: string;
  kind: "record_binding_stale" | "github_conflict" | "github_deleted" | "execution_approval" | "execution_input" | "verification_failed" | "acceptance_blocked" | "recommended_action_approval" | "governed_action";
  severity: "low" | "medium" | "high";
  workItemId: string | null;
  planningProjectId?: string | null;
  localRef: string | null;
  title: string;
  createdAt: string;
  updatedAt?: string;
  dueAt: string;
  slaStatus: "within_sla" | "breached";
  history: { action: string; actorId: string; createdAt: string }[];
  handling: { actorId: string; claimedAt: string; expiresAt?: string } | null;
  resolution: { actorId: string; resolvedAt: string; note: string } | null;
  details: Record<string, unknown>;
};
export type WorkItemAttentionMetrics = {
  backlog: number;
  breached: number;
  claimed: number;
  pendingApprovals: number;
  staleRecords: number;
  oldestAgeSeconds: number;
};
export type LocalWorkItemDeliveryEvidence = {
  schemaVersion: number;
  status: "ready" | "review_pending" | "changes_requested" | "verification_failed" | "verification_missing" | "review_inconsistent" | "evidence_incomplete" | string;
  risk: "low" | "medium" | "high" | "unknown" | string;
  domain: "development" | "office" | "other" | string;
  review: {
    status: "queued" | "running" | "completed" | "failed" | "unavailable" | string;
    source: string;
    verdict: "approved" | "changes_requested" | null;
    summary: string | null;
    structured: boolean;
    findings: { severity: "low" | "medium" | "high"; file: string | null; line: number | null; message: string; suggestion: string | null; confidence: "low" | "medium" | "high" | null }[];
    findingCounts: { low: number; medium: number; high: number; total: number };
    blockingCount: number;
    consistency: "consistent" | "inconsistent" | "unknown";
    reviewedCommit: string | null;
    reviewer: string | null;
    invocationId: string | null;
    completedAt: string | null;
  };
  verification: {
    status: "passed" | "failed" | "missing";
    passed: boolean | null;
    verified: boolean;
    command: string | null;
    commands: string[];
    exitCode: number | null;
    summary: string | null;
  };
  blockingReasonCodes: string[];
  actionPreview: {
    mode: "local_merge" | "pull_request" | null;
    operation: "apply_local_changes" | "create_pull_request" | "update_pull_request" | "apply_office_result";
    targetType: "local_project" | "pull_request" | "office_artifact";
    artifactKind?: "source_code" | "office_artifact";
    deliveryTransport?: "local_merge" | "pull_request" | null;
    worktreeId: string | null;
    branchName: string | null;
    remoteUrl: string | null;
    changedFileCount: number;
    changedFiles: string[];
    officeDetails?: {
      targetFiles: string[];
      targetResources?: Array<{ resourceId: string; displayName: string; locality: "local" | "remote" }>;
      estimatedAffectedRows: number | null;
      fields: string[];
      operation: string | null;
      writeMode: string | null;
      reversible: boolean | null;
      batch?: {
        state: string;
        targetCount: number;
        operationCount: number;
        successCount: number;
        failedCount: number;
        restoredCount?: number;
        pendingCount?: number;
        unknownCount?: number;
        rollback: {
          status: "prepared" | "partial" | "rolled_back" | "not_available" | string;
          restoredTargets: number;
          blockedTargets: number;
        };
        details: {
          id: string | null;
          businessKey: string | null;
          action: string | null;
          rowNumber: number | null;
          state: string;
          changedFields: string[];
        }[];
      } | null;
    } | null;
    reviewedCommit: string | null;
    requiresConfirmation: true;
    canProceed: boolean;
    blockedReasonCodes: string[];
  };
};
export type LocalWorkItemAutoRun = {
  id: string;
  status: string;
  phase?: "queued" | "understanding" | "waiting_for_input" | "planning" | "implementing" | "verifying" | "review_ready" | "failed" | "cancelled" | null;
  updatedAt: string;
  invocationId?: string | null;
  agentId?: string | null;
  understandingContext?: {
    version: string;
    digest: string;
    documentPaths: string[];
    relatedFiles: { path: string; line: number; term: string }[];
    similarTasks: { localRef: string | null; title: string; score: number }[];
    verificationCommand: string[];
    truncated: boolean;
    redactions?: number;
  } | null;
  decision?: {
    path: string; workKind?: string | null; decidedBy: string; confidence: number; rationale?: string | null;
    via?: string | null; latencyMs?: number | null; clarifyingQuestions?: string[] | null;
    suggestedActions?: Array<{ id: string; label: string; description?: string; payload?: { repoUrl?: string } | null }> | null;
    evidence?: { policyVersion: string; modelVersion: string | null; minConfidence: number; inputDigest: string } | null;
  } | null;
  terminalOutcome?: { disposition: "MERGED" | "CLOSED"; source: string; convergedAt: string } | null;
  report?: string | null;
  localDelivery?: {
    worktreeId: string; branchName: string | null; mode?: "local_merge" | "pull_request";
    baseBranch?: string | null; deliveredCommit?: string | null;
    deliveredAt?: string | null; promotedAt?: string | null; prNumber?: number | null; prUrl?: string | null;
    existingPullRequest?: { number: number | null; url: string | null; state: string | null } | null;
  } | null;
  clarifyAnswer?: { by?: string | null; at?: string | null; text?: string | null } | null;
  deliveryReport?: {
    summary: string | null;
    verification: { passed: boolean; verified: boolean; summary: string | null; command?: string | null; commands?: string[]; exitCode?: number | null } | null;
    changedFiles: string[];
    completedAt: string | null;
  } | null;
  deliveryReview?: {
    status: "queued" | "running" | "completed" | "failed" | "unavailable";
    invocationId: string | null;
    reviewer: string;
    startedAt: string | null;
    completedAt: string | null;
    verdict: "approved" | "changes_requested" | null;
    summary: string | null;
    findings: { severity: "low" | "medium" | "high"; file: string; line: number | null; message: string; suggestion: string | null; confidence: "low" | "medium" | "high" }[];
    reviewedCommit: string | null;
    errorCode: string | null;
    nextRetryAt?: string | null;
    structured?: boolean;
  } | null;
  deliveryStopped?: {
    stoppedAt: string;
    stoppedBy: string;
    reason: string | null;
    worktreeKept: boolean;
    pullRequestKept: boolean;
  } | null;
  routingOverride?: {
    recommendedPath: string | null; actualPath: string; reason: string;
    actorId: string; recordedAt: string; revision: number;
  } | null;
};
export type WorkItemPlanActual = {
  schemaVersion: 1;
  runId: string;
  status: "pending" | "matched" | "attention" | "unverified";
  summaryCode: string;
  planned: {
    goal: string | null;
    expectedOutput: string | null;
    method: { kind: string; name: string | null; definitionId: string | null; familyId: string | null; version: number | null } | null;
    materialCount: number;
    materialNames: string[];
    deliveryDestination: "task" | "channel" | string;
    actionAccessMode: string;
    verificationStepCount: number;
  };
  actual: {
    resultStatus: string;
    resultFiles: string[];
    materializedCount: number;
    skippedMaterialCount: number;
    deliveryStatus: string | null;
    verificationStatus: string;
    impactStatus: string;
  };
  checks: Array<{
    key: "method" | "materials" | "output" | "action" | "delivery" | "verification";
    status: "matched" | "mismatch" | "unknown" | "pending";
    reasonCode: string;
    severity?: "low" | "medium" | "high";
    correctionTarget?: string | null;
    expected: Record<string, unknown> | null;
    actual: Record<string, unknown> | null;
  }>;
  deviations: Array<{
    code: string;
    severity: "low" | "medium" | "high";
    scope: string;
    correctionTarget: string | null;
  }>;
  feedback?: {
    id: string;
    runId: string;
    planActualDigest: string;
    decisions: Array<{
      code: string;
      scope: string;
      correctionTarget: string | null;
      resolution: "keep_plan" | "prefer_actual";
      preferredValue: string;
      requiresConfirmation: boolean;
    }>;
    note: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
  } | null;
  digest: string;
};
export type WorkItemCompletionAssessment = {
  schemaVersion: 1;
  status: "pending" | "ready_to_complete" | "completed" | "needs_attention" | "unverified" | "stopped";
  declaredComplete: boolean;
  evidenceComplete: boolean;
  falseCompletion: boolean;
  requiresUserAction: boolean;
  humanInterventionRequired: boolean;
  reasonCodes: string[];
  stages: Record<string, { status: "matched" | "pending" | "unknown" | "mismatch"; reasonCodes: string[] }>;
};
export type WorkItemMetricCheck = {
  status: "passed" | "attention" | "insufficient_data";
  target: number;
};
export type WorkItemCompletionQualityMetrics = {
  generatedAt: string;
  scope: { projectId: string | null; trackedWorkItems: number; trackedAutoRuns: number };
  metrics: {
    schemaVersion: 1;
    completion: {
      tracked: number; settled: number; completed: number; falseCompletions: number;
      requiringUserAction: number; completionRate: number | null; falseCompletionRate: number | null;
      check: WorkItemMetricCheck;
    };
    recovery: {
      required: number; succeeded: number; pending: number; successRate: number | null;
      check: WorkItemMetricCheck;
    };
    humanIntervention: { count: number; rate: number | null; check: WorkItemMetricCheck };
    externalActions: {
      attempts: number; duplicateCount: number; unresolvedCount: number; check: WorkItemMetricCheck;
    };
    acceptance: {
      status: "passed" | "attention" | "insufficient_data";
      checks: Record<string, WorkItemMetricCheck>;
    };
    definitions: Record<string, string>;
  };
};
export type LocalWorkItemObservability = {
  executionChainId?: string;
  nextAction: "answer_ai" | "review_approval" | "review_delivery" | "resolve_sync_conflict" | "inspect_failure" | "none" | "monitor_execution" | "start_execution";
  executionReview?: WorkItemExecutionReview | null;
  planActual?: WorkItemPlanActual | null;
  completionAssessment?: WorkItemCompletionAssessment | null;
  attention: WorkItemAttention[];
  latestRun: LocalWorkItemAutoRun | null;
  outcome?: {
    status: "pending" | "available" | "missing";
    summary: string | null;
    fullReport: string | null;
    highlights: string[];
    warnings: string[];
    files: string[];
    fileEntries?: WorkItemOutcomeFile[];
    verification: { passed: boolean; verified: boolean; summary: string | null } | null;
    deliveredAt: string | null;
  } | null;
  outcomeHistory?: Array<{
    version: number;
    status: "pending" | "available" | "missing";
    summary: string | null;
    fullReport: string | null;
    highlights: string[];
    warnings: string[];
    files: string[];
    fileEntries?: WorkItemOutcomeFile[];
    verification: { passed: boolean; verified: boolean; summary: string | null } | null;
    deliveredAt: string | null;
    invocationId: string | null;
    supersededAt: string | null;
    supersededByFeedback: string | null;
  }>;
  runHistory?: {
    invocationId: string;
    autoRunId: string | null;
    attempt: number;
    status: string;
    createdAt: string | null;
    startedAt: string | null;
    completedAt: string | null;
    errorCode: string | null;
    summary: string | null;
    verification: {
      status: "passed" | "failed" | "not_run";
      command: string | null;
      summary: string | null;
    } | null;
    current: boolean;
  }[];
  delivery?: {
    state: "awaiting_review";
    mode: "local_merge" | "pull_request";
    worktreeId: string;
    branchName: string | null;
    remoteUrl: string | null;
    report: LocalWorkItemAutoRun["deliveryReport"];
    aiReview: LocalWorkItemAutoRun["deliveryReview"];
    evidence?: LocalWorkItemDeliveryEvidence | null;
    review: {
      verdict: "approved" | "changes_requested";
      summary: string | null;
      comments: { path: string | null; body: string; line?: number; severity?: "low" | "medium" | "high"; suggestion?: string }[];
      reviewedCommit: string | null;
      reviewedBy: string | null;
      source: "human" | "ai";
      reviewerName: string | null;
      reviewInvocationId: string | null;
      createdAt: string | null;
    } | null;
  } | null;
  deliveryEvidence?: LocalWorkItemDeliveryEvidence | null;
  activeClaim: { actorId: string | null; claimedAt: string | null; expiresAt: string | null } | null;
  cost: {
    knownUsd: number; unknownEntries: number; entryCount: number;
    byAutoRun?: { autoRunId: string; knownUsd: number; unknownEntries: number; entryCount: number }[];
    byModel?: { model: string; knownUsd: number; unknownEntries: number; entryCount: number }[];
    byBudgetPool?: { budgetPoolId: string; knownUsd: number; unknownEntries: number; entryCount: number }[];
    projectBudget?: { budgetId: string; limitUsd: number; spentUsd: number; reservedUsd: number; admissionUsd: number; remainingUsd: number; policy: string; over: boolean; admissionOver: boolean } | null;
    teamBudget?: { budgetId: string; limitUsd: number; spentUsd: number; reservedUsd: number; admissionUsd: number; remainingUsd: number; policy: string; over: boolean; admissionOver: boolean } | null;
  };
  alerts: {
    queued: number; failed: number; sent: number; skipped: number;
    items?: { id: string; kind: string; status: string; attempts: number; nextAttemptAt: string | null; sentAt: string | null; lastError: string | null }[];
  };
  timeline?: {
    id: string; at: string; source: "issue" | "execution" | "cost" | "alert"; type: string;
    stage?: "creation" | "routing" | "queue" | "execution" | "approval" | "tool" | "verification" | "retry" | "completion" | "other";
    actorId: string | null; message: string; data: Record<string, unknown>;
  }[];
  estimate?: {
    sampleCount: number; typicalDurationMs: number | null; p90DurationMs?: number | null; elapsedMs: number | null;
    remainingMs: number | null; confidence: "low" | "medium" | "high";
    calibrationSampleCount?: number; calibrationMaeMs?: number | null;
  } | null;
  routingExplanation?: {
    selectedPath: string | null; via: string; confidence: number | null; rationale: string | null;
    humanCorrection?: { actualPath: string; reason: string; actorId: string; recordedAt: string } | null;
    candidates: { path: string; selected: boolean; score?: number | null; reason: string }[];
  } | null;
};

export type WorkItemReviewAction = {
  kind: string;
  visible: true;
  enabled: boolean;
  requiresConfirmation: boolean;
  nextOwner: "ai" | "me" | "system" | "none";
  blockedReasonCodes: string[];
};

export type WorkItemExecutionReview = {
  schemaVersion: 1;
  state: "queued" | "preparing" | "working" | "waiting" | "verifying" | "review_ready" | "completed" | "failed" | "cancelled";
  stage: "accepted" | "preparing" | "working" | "verifying" | "review";
  stages: Array<{
    key: "accepted" | "preparing" | "working" | "verifying" | "review";
    status: "complete" | "current" | "pending" | "attention";
    at: string | null;
  }>;
  executionKind: WorkItemExecutionKind | null;
  targetId: string | null;
  targetStatus: string | null;
  agentId: string | null;
  agentName: string | null;
  acceptedAt: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  needsAttention: boolean;
  attentionCode: string | null;
  verification: {
    status: "pending" | "running" | "passed" | "failed" | "not_configured" | "unavailable";
    verified: boolean;
    passed: boolean | null;
    commands: string[];
    command: string | null;
    exitCode: number | null;
    summary: string | null;
    checkedAt: string | null;
    durationMs: number | null;
    evidenceCount: number;
    checks: Array<{
      id: string;
      kind: string;
      status: "passed" | "failed";
      command: string | null;
      summary: string | null;
      recordedAt: string | null;
      evidenceCount: number;
    }>;
  };
  impact: {
    status: "none" | "prepared" | "proposed" | "applied" | "partial" | "rolled_back" | "unknown";
    reasonCode: string;
  };
  riskReasons: Array<{
    code: "execution_failed" | "user_input_required" | "approval_required" | "verification_failed" | "verification_not_configured" | "verification_unavailable" | "external_impact_unknown" | "office_batch_partial" | "office_batch_rolled_back" | "pull_request_not_applied";
    severity: "medium" | "high";
    scope: "execution" | "approval" | "verification" | "external_impact";
  }>;
  recommendedAction: {
    kind: "open_details" | "answer_ai" | "review_approval" | "retry_execution" | "fix_with_ai" | "rerun_verification" | "review_result" | "view_result";
    reasonCode: string;
    requiresConfirmation: boolean;
    nextOwner: "ai" | "me" | "system" | "none";
  };
  actionAvailability?: {
    schemaVersion: 1;
    primaryActionKind: string | null;
    locked: boolean;
    actions: WorkItemReviewAction[];
  };
  actionReceipt?: null | {
    schemaVersion: 1;
    id: string;
    kind: "retry_execution" | "fix_with_ai" | "rerun_verification" | "answer_ai";
    status: "accepted" | "running" | "succeeded" | "failed" | "safe_to_retry" | "unknown";
    messageCode: string | null;
    impact: "none" | "proposed" | "applied" | "unknown";
    nextOwner: "ai" | "me" | "system" | "none";
    requestedAt: string | null;
    updatedAt: string | null;
    completedAt: string | null;
    targetId: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    replayed: boolean;
  };
};

export type WorkItemOutcomeFile = {
  name: string;
  path: string | null;
  contentId?: string | null;
  projectId: string | null;
  worktreeId: string | null;
  status: "available" | "unavailable";
  preview: "document" | "unsupported";
  unavailableReason?: string;
};
export type Row = GithubItem & { projectId: string; projectName: string };
export const TASK_TABS = ["local", "issue", "pr"] as const;
export type TaskTab = (typeof TASK_TABS)[number];

export function shouldShowWorkItemCost(
  observability: LocalWorkItemObservability | null,
): observability is LocalWorkItemObservability {
  return Boolean(observability && (
    observability.cost.entryCount > 0
    || observability.cost.projectBudget
    || observability.cost.teamBudget
  ));
}
