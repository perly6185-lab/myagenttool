import { UNTRUSTED_INPUT_LABEL, UNTRUSTED_INPUT_TAG } from "@myagenttool/protocol/issue-prompt";
import { createOwnedAlertRuntime, enrichAlertOwnership } from "./alert-composition.mjs";
import { LOCAL_TEAM_ID, teamOf } from "./auth.mjs";
import { makeRunTx } from "./store/run-tx.mjs";
import { createEventLogRuntime } from "./event-log.mjs";
import { createRefusalRuntime } from "./refusal-log.mjs";
import { createBridgeCredentialRuntime } from "./bridge-auth.mjs";
import { currentDeviceTimeZone, findDevice, listDevices } from "./device.mjs";
import { captureSeededDefaults, createPersistenceRuntime, normalizeLoadedState, persistedArrayKeys, persistedObjectKeys } from "./persistence.mjs";
import { createReadModelRuntime } from "./read-models.mjs";
import { createInMemoryStore } from "./store/in-memory-store.mjs";
import { createIncrementalMirror, isStoreEmpty, mirrorState, seedOrHydrate } from "./store/sqlite-backing.mjs";
import {
  createAgentService,
  isAgentDisabled,
  normalizeStringArray,
} from "../services/agents.mjs";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { basename, dirname, resolve, sep } from "node:path";
import { mergeFileAccesses } from "../read-models/file-ledger.mjs";
import { sanitizeRequestContext } from "../read-models/request-context.mjs";
import { createAgentSkillService } from "../services/agent-skills.mjs";
import { createApplicationService, validateApplicationRoutineDraft } from "../services/applications.mjs";
import { createApplicationInstallService } from "../services/application-installs.mjs";
import { createApprovalGrantService } from "../services/approval-grants.mjs";
import { createRetentionArchive } from "../services/retention-archive.mjs";
import { createApplicationStatsRuntime } from "../services/application-stats.mjs";
import { createCapabilityService } from "../services/capabilities.mjs";
import { createMailIssueWriteService } from "../services/mail-issue-write.mjs";
import { createMailReplyDraftService } from "../services/mail-reply-draft.mjs";
import { createMailSendService, isMailSendEnabled } from "../services/mail-send.mjs";
import { createMailClassificationService } from "../services/mail-classification.mjs";
import { createMailFolderSuggestionService } from "../services/mail-folder-suggestions.mjs";
import { createMailFolderOrganizationService, isMailAutomaticOrganizationEnabled, isMailOrganizationEnabled } from "../services/mail-folder-organization.mjs";
import { createLocalMailSemanticAdapter, resolveMailSemanticConfig } from "../services/mail-semantic-classifier.mjs";
import { createMailboxService, isMailClassificationEnabled } from "../services/mailbox.mjs";
import { createLocalContentCatalogService } from "../services/local-content-catalog.mjs";
import {
  createLocalContentRetrievalAuthorizer,
  createLocalContentRetrievalService,
} from "../services/local-content-retrieval.mjs";
import { createChannelService, defaultReadinessProbes } from "../services/channels.mjs";
import { createCanvasSceneService } from "../services/canvas-scenes.mjs";
import { CANVAS_APPLICATION_ID, createCanvasCapabilityHandlers } from "../services/canvas-capabilities.mjs";
import { createChannelConversationService } from "../services/channel-conversation.mjs";
import { analyzeChannelOperationIntent } from "../services/channel-operation-intent.mjs";
import { executeChannelReadonlyLocalOperation } from "../services/channel-readonly-local-operation.mjs";
import { discoverChannelFileAsset } from "../services/channel-file-discovery.mjs";
import { createChannelIntentAdapter, resolveChannelIntentConfig } from "../services/channel-intent-adapter.mjs";
import { createChannelConsultationAdapter, resolveChannelConsultationConfig } from "../services/channel-consultation-adapter.mjs";
import { createChannelDeliveryService } from "../services/channel-delivery.mjs";
import { createChannelNotificationService } from "../services/channel-notifications.mjs";
import {
  channelObjectValidationMatches,
  channelObjectValidationSummary,
  resolveChannelObjectRequests,
} from "../services/channel-object-resolver.mjs";
import { createChannelObjectRegistryService } from "../services/channel-object-registry.mjs";
import { createChannelObjectImportService } from "../services/channel-object-imports.mjs";
import { createChannelObjectConnectorService } from "../services/channel-object-connectors.mjs";
import { createChannelMutationBindingService } from "../services/channel-mutation-bindings.mjs";
import {
  channelLedgerMutationFieldHint,
  parseLedgerMutationPlan,
  parseSingleRecordLedgerMutation,
} from "../services/channel-ledger-mutation.mjs";
import {
  buildRuntimeDataPlan,
  buildAttachmentDataPlan,
  dataPlanMatchesCurrent,
  dataPlanMissingLabels,
} from "../services/data-plan-contract.mjs";
import {
  buildDataRelationPreview,
  dataRelationPreviewMatchesCurrent,
} from "../services/data-relation-preview.mjs";
import {
  buildDataMutationPreview,
    dataMutationPreviewMatchesCurrent,
} from "../services/data-mutation-contract.mjs";
import { buildWorkModeSnapshot } from "../services/work-mode-runtime.mjs";
import { selectChannelExecutionStrategy } from "../services/channel-execution-strategy.mjs";
import { buildPaymentReconciliationPreview } from "../services/channel-payment-reconciliation.mjs";
import { buildChannelDataOperationPreview } from "../services/channel-data-operation-preview.mjs";
import { createIlinkRuntime } from "../gateway/ilink-runtime.mjs";
import { createReportScheduleRuntime } from "../services/report-schedule.mjs";
import { createApplicationResultImportService } from "../services/application-results.mjs";
import { createCcusageImportService } from "../services/ccusage-imports.mjs";
import { createClaudeReviewImportService } from "../services/claude-review-imports.mjs";
import { createClaudeApplyImportService } from "../services/claude-apply-imports.mjs";
import { isGovernedClaudeApplyAgent } from "../services/claude-apply-agent.mjs";
import { createCodexReviewImportService } from "../services/codex-review-imports.mjs";
import { createCodexExecImportService } from "../services/codex-exec-imports.mjs";
import {
  CODEX_REVIEW_TOOL_CONTRACT,
  createCodexReviewAgentRegistration,
  isGovernedCodexReviewAgent,
} from "../services/codex-agent.mjs";
import { createRoundTelemetryRuntime } from "../services/round-telemetry.mjs";
import {
  createLocalWorkflowEmbeddingAdapter,
  resolveWorkflowEmbeddingConfig,
} from "../services/workflow-embedding-adapter.mjs";
import {
  createLocalWorkflowOcrAdapter,
  resolveWorkflowOcrConfig,
} from "../services/workflow-ocr-adapter.mjs";
import {
  createCodexVisionOcrAdapter,
  createFallbackWorkflowOcrAdapter,
  resolveCodexVisionOcrConfig,
} from "../services/workflow-codex-vision-ocr-adapter.mjs";
import {
  createLocalWorkflowBusinessSemanticAdapter,
  resolveWorkflowBusinessSemanticConfig,
} from "../services/workflow-business-semantic-adapter.mjs";
import { createCodexService } from "../services/codex.mjs";
import { createCodexApprovalRecoveryService } from "../services/codex-approval-recovery.mjs";
import { createIntegrationService } from "../services/integrations.mjs";
import { createInvocationEventService } from "../services/invocation-events.mjs";
import { createInvocationRefusalService } from "../services/invocation-refusals.mjs";
import { createInvocationTraceService } from "../services/invocation-trace.mjs";
import { createInvocationService, selectDefaultAgent } from "../services/invocations.mjs";
import { createCancellationSignal } from "../services/cancellation-signal.mjs";
import { createM3Service } from "../services/m3.mjs";
import { createProjectService, sameProjectPath } from "../services/projects.mjs";
import { convergeAutoRunTerminalState, createAutoRunService } from "../services/auto-run.mjs";
import { createDecisionSoftClaimService } from "../services/decision-soft-claims.mjs";
import { createIssueClaimService } from "../services/issue-claims.mjs";
import { createWorkItemService } from "../services/work-items.mjs";
import { createTaskMaterialService } from "../services/task-materials.mjs";
import { createWorkItemAutoRunBatchService } from "../services/work-item-auto-run-batches.mjs";
import { createWorkItemAutoRunUnderstandingService, workItemTemplateInstructions } from "../services/work-item-auto-run-understanding.mjs";
import { createWorkItemAutoSchedulerService } from "../services/work-item-auto-scheduler.mjs";
import { createBusinessRoutineService } from "../services/business-routines.mjs";
import { createBusinessPilotEvidenceService } from "../services/business-pilot-evidence.mjs";
import { createWorkflowAdaptiveWorkService } from "../services/workflow-adaptive-work.mjs";
import { createLedgerUpsertService } from "../services/ledger-upserts.mjs";
import { createBusinessDocumentIntelligenceService } from "../services/business-document-intelligence.mjs";
import { createBusinessCaseDiscoveryService } from "../services/business-case-discovery.mjs";
import { createArticleImportService, resolveArticleImportConfig, importArticleToWorktree, inspectArticle } from "../services/article-imports.mjs";
import { createArticleExtractorPluginService } from "../services/article-extractor-plugins.mjs";
import { createChannelKnowledgeService } from "../services/channel-knowledge.mjs";
import { createSessionManager } from "../services/session-manager.mjs";
import { createWorkflowMemoryService } from "../services/workflow-memory.mjs";
import { createTemplateLearningService } from "../services/template-learning.mjs";
import { createWorkflowMemoryInsightsService } from "../services/workflow-memory-insights.mjs";
import { createInquiryIntakeTriggerService } from "../services/inquiry-intake-triggers.mjs";
import { createPlanningProjectService } from "../services/planning-projects.mjs";
import {
  autoRunVerificationTimeoutMs,
  resolveAutoRunVerificationPlan,
  runWorktreeVerificationPlan,
} from "../services/worktree-verify.mjs";
import { resolveStatusWritebackConfig, runIssueAssigneeEdit, runIssueBodyFetch, runIssueClose, runIssueComment, runIssueStatusTransition, runPrChecks, runPrMerge, runPrStateFetch, runIssueStateFetch, runIssueSnapshotFetch, runIssueSnapshotWrite } from "../services/issue-status.mjs";
import { deciderTimeoutMs, resolveDeciderCommand, runDeciderCommand } from "../services/decision-command.mjs";
import { childIssueBody, childIssueTitle, extractProjectFieldsBlock, runChildIssueCreate, spawnIssuesConfig } from "../services/auto-run-spawn.mjs";
import { ingestChannelAttachmentBytes, ingestChannelAttachmentCandidates } from "../services/channel-attachment-ingestion.mjs";
import { refreshPrDispositions } from "../services/auto-run-eval.mjs";
import { refreshEpicChildStates } from "../services/auto-run-epic.mjs";
import { judgeTimeoutMs, resolveJudgeCommand, runAcceptanceJudge } from "../services/auto-run-judge.mjs";
import { resolveReviewCommand, reviewTimeoutMs, runDiffReview, scanDiffForInjection } from "../services/auto-run-review.mjs";
import { resolveDesignRenderCommand, designRenderTimeoutMs, runDesignRender } from "../services/design-render.mjs";
import { resolveDeployCommand, deployTimeoutMs, runDeployCommand, resolveRollbackCommand, rollbackTimeoutMs } from "../services/auto-run-deploy.mjs";
import { decisionConfig } from "../services/auto-run-decision.mjs";
import { autoRunSettingsEnvOverlay } from "../services/auto-run-config.mjs";
import { createOtlpTraceExporter } from "../services/otlp-export.mjs";
import { canDeleteObservabilityData, deleteObservabilityData, deletionScopes } from "../services/observability-deletion.mjs";
import { DEFAULT_SLO_TARGETS, evaluateSloAlert, summarizeAutoRunSlos } from "../services/auto-run-slo.mjs";
import { summarizeAutoRuns } from "../services/auto-run-metrics.mjs";
import { createTerminalService } from "../services/terminal.mjs";
import { createToolService, failStrandedIssueFetches } from "../services/tools.mjs";
import { createExternalIssueProviderClient } from "../services/external-issue-provider.mjs";

export { enrichAlertOwnership };

export function createServerRuntimeServices({
  namespace,
  protocolVersion,
  state,
  defaultProject,
  defaultProjectPath,
  persistenceEnabled,
  stateStorePath,
  stateSchemaVersion,
  dispatchLeaseMs,
  now,
  // #1002 Phase B: an opened SQLite store makes SQLite the durable backing — the
  // in-memory `state` stays the live view, its commit MIRRORS to SQLite, and boot
  // hydrates `state` from SQLite. null (default) = today's JSON-snapshot backing.
  sqliteStore = null,
  mailQueryIndex = null,
  // Optional provider seams used by integration tests; production leaves these
  // unset and uses the real encrypted credential store and iLink client.
  ilinkCredentialStore = null,
  ilinkClientFactory = undefined,
  channelObjectConnectorAdapters = {},
}) {
  let idCounter = 1;
  let invocationService = null;
  let codexEventHandlers = {
    createCodexEvidenceRecord: () => null,
    updateCodexSessionFromEvent: () => null,
    updateClaudeSessionFromEvent: () => null,
  };

  // #1041: every durable flush (persistStateNow AND the debounced persistStateSoon,
  // from ANY of the ~40 write sites) mirrors the state into SQLite via this hook —
  // not only store.transaction commits — so SQLite never lags the JSON snapshot and
  // the last writes before shutdown are captured. A no-op until the mirror is primed
  // (and always, when there is no SQLite backing).
  let durableSync = () => {};
  const {
    persistStateSoon,
    persistStateNow,
    restorePersistentState,
    savePersistentState,
    exportJsonSnapshot,
  } = createPersistenceRuntime({
    state,
    enabled: persistenceEnabled,
    stateStorePath,
    schemaVersion: stateSchemaVersion,
    now,
    defaultProject,
    sameProjectPath,
    afterFlush: () => durableSync(),
    // #1042: on the SQLite backing, JSON is retired AS the backing — per-commit
    // flushes write SQLite only; JSON becomes an explicit export (exportJsonSnapshot).
    // JSON stays the backing on the memory / Node<22.13-degrade paths (no sqliteStore).
    jsonBacking: !sqliteStore,
  });
  // #966 (#124): the Store seam over today's snapshot — reads scan `state`, a
  // transaction stages writes and commits atomically through the synchronous
  // barrier. #1002 Phase B: when a SQLite store is wired, the commit ALSO mirrors
  // the whole `state` view into SQLite (the durable backing); the JSON snapshot is
  // kept current too during the soak so flipping the flag off loses nothing (Phase
  // C retires it). Default (no sqliteStore): today's JSON-only barrier, unchanged.
  // `projects` and `devices` are id-keyed arrays that persist through their OWN JSON
  // paths (not the persistedArrayKeys loop), so the SQLite backing mirrors them here
  // too — otherwise the project registry / device fleet would be lost once the JSON
  // snapshot is retired (Phase C). #1003 prep. (`currentProjectId` is a scalar the
  // hydrate reconciles via normalizeLoadedState; a dedicated durable slot for it is
  // a small follow-up before JSON is fully retired.)
  const mirroredArrayKeys = [...persistedArrayKeys, "projects", "devices"];
  // #1040: top-level scalars (the operator's selected project, the id counter) that
  // are neither arrays nor object singletons — mirrored as one reserved meta row so
  // they survive once the JSON snapshot is retired (else currentProjectId resets to
  // default each boot and idCounter falls back to the #832-risky records scan).
  const mirroredScalarKeys = ["currentProjectId", "idCounter"];
  // #1003: the commit sink mirrors only the DELTA (changed/new/deleted rows) into
  // SQLite rather than rewriting the whole record table each commit — see
  // createIncrementalMirror. Primed to match the store right after seed/hydrate.
  const incrementalMirror = sqliteStore
    ? createIncrementalMirror({ store: sqliteStore, arrayKeys: mirroredArrayKeys, objectKeys: persistedObjectKeys, scalarKeys: mirroredScalarKeys })
    : null;
  // The store's commit is just persistStateNow now — persistStateNow already mirrors
  // to SQLite via the afterFlush hook (durableSync), so a store.transaction commit
  // and any other durable flush stay on the same, unified path (#1041).
  const store = createInMemoryStore({ state, commit: persistStateNow });
  // #1003: capture the fresh seeded defaults BEFORE the restore overwrites them, so
  // a SQLite hydrate can run the SAME normalization the JSON restore does.
  const seededDefaults = sqliteStore ? captureSeededDefaults(state) : null;
  // #1042: JSON is no longer the backing. Restore it ONLY as a one-time migration
  // when SQLite is empty (a fresh deploy, or an existing deployment upgrading in
  // place); a populated SQLite hydrates directly and the JSON restore is skipped.
  // Without a SQLite backing (memory / degrade), JSON IS the backing — restore it.
  let restored;
  if (!sqliteStore) {
    restored = restorePersistentState();
  } else if (isStoreEmpty({ store: sqliteStore, arrayKeys: mirroredArrayKeys, objectKeys: persistedObjectKeys })) {
    restored = restorePersistentState();
  }
  // After the (conditional) restore, reconcile with the SQLite backing — SEED it from
  // the restored/fresh state when empty (one-time JSON→SQLite migration), or HYDRATE
  // `state` from SQLite when it already holds data (SQLite authoritative).
  if (sqliteStore) {
    const outcome = seedOrHydrate({ store: sqliteStore, state, arrayKeys: mirroredArrayKeys, objectKeys: persistedObjectKeys, scalarKeys: mirroredScalarKeys });
    if (outcome.mode === "seeded" && outcome.mirror?.skipped > 0) {
      console.warn(`[store:sqlite] initial seed dropped ${outcome.mirror.skipped} id-less row(s) in ${outcome.mirror.skippedCollections.join(", ")}.`);
    }
    if (outcome.mode === "hydrated") {
      // Raw hydration loads records verbatim; run the SHARED normalization so the
      // SQLite backing fails closed EXACTLY like the JSON restore — path-missing
      // project drop + default guarantee, new-default merge for agents/singletons/
      // devices, dup-id repair, every device offline, ownership diagnostics.
      normalizeLoadedState(state, { seededDefaults, defaultProject, sameProjectPath });
    }
    // A hydrate's normalization (dropped project, merged defaults, device offline)
    // makes `state` diverge from the raw SQLite rows, so fully re-mirror ONCE here
    // to reconcile SQLite (deletes propagate) before priming. On seed, SQLite
    // already equals `state`. Then prime the incremental mirror's shadow so every
    // subsequent commit writes only its delta.
    if (outcome.mode === "hydrated") {
      mirrorState({ store: sqliteStore, state, arrayKeys: mirroredArrayKeys, objectKeys: persistedObjectKeys, scalarKeys: mirroredScalarKeys });
    }
    incrementalMirror.prime(state);
    // From here every durable flush mirrors the delta into SQLite (#1041).
    durableSync = () => {
      const { skipped, skippedCollections } = incrementalMirror.sync(state);
      if (skipped > 0) {
        console.warn(`[store:sqlite] mirror dropped ${skipped} id-less row(s) in ${skippedCollections.join(", ")} — those records are not durable in the SQLite backing.`);
      }
    };
    console.log(`[store:sqlite] durable backing ${outcome.mode} (${mirroredArrayKeys.length} collections).`);
  }
  // Event archive ids can be newer than either the JSON snapshot or the SQLite
  // scalar mirror. Read their durable high-water before minting any new ids.
  // ADR 0019 B-2: when a SQLite store is present, over-cap eviction dual-writes to
  // its durable, indexed `history` table (alongside the JSONL). null on the memory
  // / Node<22.13 backing — the JSONL stays the only durable archive there.
  const historyAppend = sqliteStore && typeof sqliteStore.appendHistory === "function"
    ? (collection, rows) => sqliteStore.appendHistory(collection, rows)
    : null;
  const historyQuery = sqliteStore && typeof sqliteStore.queryHistory === "function"
    ? (collection, options) => sqliteStore.queryHistory(collection, options)
    : null;
  // ADR 0019 B-3: erasure of the durable history table (null on the memory backing).
  const historyDelete = sqliteStore && typeof sqliteStore.deleteHistory === "function"
    ? (collection, scopeId) => sqliteStore.deleteHistory(collection, scopeId)
    : null;
  const historyRedact = sqliteStore && typeof sqliteStore.redactHistory === "function"
    ? (collection, scopeId, redactRow) => sqliteStore.redactHistory(collection, scopeId, redactRow)
    : null;
  const retentionArchive = createRetentionArchive({ stateStorePath, enabled: persistenceEnabled, now, appendHistory: historyAppend });
  const { dispatcher: autoRunAlerts, outbox: alertOutbox } = createOwnedAlertRuntime({
    state,
    now,
    nextId,
    persistStateSoon,
    store,
  });
  const eventArchive = retentionArchive.prepareInvocationEventArchive();
  if (eventArchive.readError) {
    throw new Error(`Cannot establish invocation event id high-water: ${eventArchive.readError}`);
  }
  // The counter comes from the snapshot it minted ids for. The scan is kept ONLY
  // as a floor — for a snapshot written before the counter was persisted, and as a
  // backstop if a restored counter is somehow behind the records it must not
  // collide with. It can raise the counter; it can never lower it (#832).
  idCounter = Math.max(
    state.idCounter ?? 0,
    nextIdCounterAfterState(state),
    eventArchive.maxOrdinal > 0 ? eventArchive.maxOrdinal + 1 : 0,
  );
  state.idCounter = idCounter;
  // Every id the state already holds. `nextId` refuses to reissue one, so a
  // counter that is wrong — reset, restored from an older snapshot, whatever —
  // produces a gap, never a duplicate primary key.
  let issuedIds = collectRecordIds(state);
  // A snapshot that had to be repaired is written back now that the state is whole
  // (ids de-duplicated, counter settled). Without this the repair would live only
  // in memory: the next process would read the same corrupt file, raise the same
  // alarm, and nothing would ever get better.
  if (restored?.duplicateIdsRepaired > 0) {
    savePersistentState();
  }

  // Cap-evicted audit rows land in an on-disk JSONL archive instead of
  // vanishing. Compose it before the event writer so an event is archived and
  // fsynced before the 500-row hot tail drops it.
  const { listInvocationEvents } = createInvocationEventService({
    state,
    readInvocationEventArchive: retentionArchive.readInvocationEventArchive,
  });
  const { listInvocationRefusals } = createInvocationRefusalService({
    state,
    readArchiveWithMetadata: retentionArchive.readArchiveWithMetadata,
    queryHistory: historyQuery,
  });
  const { getInvocationTrace } = createInvocationTraceService({
    state,
    readArchiveWithMetadata: retentionArchive.readArchiveWithMetadata,
    queryHistory: historyQuery,
  });
  const { appendEvent } = createEventLogRuntime({
    state,
    now,
    nextId,
    persistStateSoon,
    getCodexEventHandlers: () => codexEventHandlers,
    archiveEvicted: (_collection, rows) => retentionArchive.archiveInvocationEvents(rows),
  });
  // Audit find (2026-07-16): an analyze.issue invocation restored mid-fetch has
  // a resolver that died with the previous process — fail it closed now, before
  // anything can claim it.
  failStrandedIssueFetches(state, { now, appendEvent });
  // Refusal model Phase 2 (#760): the single writer for the device's veto.
  const { refuse, firstRefusal } = createRefusalRuntime({
    state,
    now,
    nextId,
    appendEvent,
    persistStateSoon,
    // Over-cap refusals are archived (durable, readable) instead of dropped.
    capWithArchive: retentionArchive.capWithArchive,
  });
  const {
    deviceForToken,
    issueBridgeCredential,
    requireBridgeCredential,
  } = createBridgeCredentialRuntime({ state, now, persistStateSoon, appendEvent });

  const {
    addProject,
    cloneProject,
    createBlankProject,
    commitWorktreeChanges,
    createWorktree,
    currentProject,
    gitProjectSummary,
    projectBranches,
    publishWorktreeBranch,
    promoteWorktreeToBase,
    promoteWorktreeToPullRequest,
    ensureLocalOrigin,
    createWorktreePr,
    worktreeDiff,
    submitWorktreeReview,
    latestWorktreeReview,
    worktreeHeadCommit,
    projectGithubItems,
    projectForInvocation,
    readProjectDocuments,
    readProjectTree,
    removeProject,
    removeWorktree,
    destroyWorktree,
    searchProjectContent,
    selectProject,
    updateProject,
    worktreeForProject,
  } = createProjectService({ state, now, nextId, appendEvent, persistStateSoon, store, stateStorePath });

  const {
    createAgentSkill,
    updateAgentSkill,
    deleteAgentSkill,
  } = createAgentSkillService({ state, now, nextId, persistStateSoon, store });

  // Approval grants (docs/design/APPROVAL_GRANTS.md): the issuance flow behind
  // every approvalToken field. Composed before the application service so the
  // validator can be injected into its guards.
  const { recordApplicationExecutionStat } = createApplicationStatsRuntime({ state, now, persistStateSoon, store });

  // The read half of the audit loop: recovery actions the 200-row cap evicted are
  // recoverable per application, not just greppable on disk. Scoped by the route's
  // denyForeignApplication guard before it reaches here.
  function readApplicationRecoveryArchive(applicationId, limit = 50) {
    return retentionArchive.readArchive("applicationRecoveryActions", {
      filter: (row) => row?.applicationId === applicationId,
      limit,
    });
  }

  const { issueApprovalGrant, mintDecisionGrant, validateApprovalToken } = createApprovalGrantService({
    state,
    now,
    nextId,
    appendEvent,
    persistStateSoon,
    archiveEvicted: retentionArchive.archiveEvicted,
    store,
  });

  const {
    cancelApplicationInstall,
    completeApplicationInstall,
    findApplicationInstallRun,
    nextBridgeApplicationInstall,
    queueApplicationInstall,
    recordApplicationInstallProgress,
  } = createApplicationInstallService({ state, now, nextId, appendEvent, persistStateSoon, validateApprovalToken, store });

  // Durable, team-owned Canvas scenes (#1352) — created before the application
  // service so its element ops back the built-in Canvas capabilities (#1353).
  const canvasSceneService = createCanvasSceneService({
    state, now, nextId, appendEvent, persistStateSoon, store,
  });
  let resolveWorkItemProjectBudget = () => null;
  let resolveWorkItemTeamBudget = () => null;
  let resolveWorkItemApplicationCapability = () => ({ state: "refusal", reason: "resolver_unavailable", capability: null });
  let invokeWorkItemApplicationCapability = () => ({ status: 503, body: { error: "capability_gateway_unavailable" } });
  let syncAdaptiveWorkItemOutcome = () => {};
  let requestWorkItemAutoSchedulerSweep = () => {};
  let enqueueWorkItemReportDeliveryBatch = () => ({ ok: false, reason: "delivery_unavailable" });
  const localContentCatalogService = createLocalContentCatalogService({
    state, stateStorePath, now, autoIndex: true,
  });
  const localContentRetrievalService = createLocalContentRetrievalService({
    browseDirectories: localContentCatalogService.browseDirectories,
    searchLocalContent: localContentCatalogService.search,
    readLocalContentText: localContentCatalogService.readTextChunk,
    authorizeRetrieval: createLocalContentRetrievalAuthorizer({ state, teamOf }),
    appendEvent,
  });
  const persistIndexedContentStateSoon = (sources, reason) => (...args) => {
    const result = persistStateSoon(...args);
    void localContentCatalogService.requestAutomaticIncremental({ reason, sources }).catch(() => {});
    return result;
  };
  const persistTaskMaterialStateSoon = persistIndexedContentStateSoon(["work_items"], "task_material_changed");
  const persistWorkItemStateSoon = persistIndexedContentStateSoon(["work_items", "articles"], "work_item_changed");
  const persistArticleStateSoon = persistIndexedContentStateSoon(["articles", "work_items"], "article_changed");
  const persistMailboxStateSoon = persistIndexedContentStateSoon(["mail", "work_items"], "mail_changed");
  const taskMaterialService = createTaskMaterialService({
    state, stateStorePath, now, nextId, persistStateSoon: persistTaskMaterialStateSoon, appendEvent, store,
    resolveLocalContentReference: localContentCatalogService.resolveOriginal,
  });
  // Channel services compose later because they depend on Work Items and
  // Invocations. These narrow late-bound hooks preserve lifecycle projection.
  let channelAutoRunHook = null;
  let channelWorkItemHook = null;
  const workItemService = createWorkItemService({
    state, now, nextId, appendEvent, persistStateSoon: persistWorkItemStateSoon, store,
    sendAlert: alertOutbox.enqueue,
    retryAlert: alertOutbox.retry,
    budgetStatusFor: (projectId) => resolveWorkItemProjectBudget(projectId),
    teamBudgetStatusFor: (teamId) => resolveWorkItemTeamBudget(teamId),
    resolveApplicationCapability: (input, actor) => resolveWorkItemApplicationCapability(input, actor),
    invokeResolvedCapability: (name, input, actor) => invokeWorkItemApplicationCapability(name, input, actor),
    issueApplicationApprovalGrant: (input, actor) => issueApprovalGrant(input, actor),
    enqueueChannelDeliveryBatch: (input) => enqueueWorkItemReportDeliveryBatch(input),
    validateApprovalToken,
    onWorkItemChanged: (item, actor, reason) => {
      syncAdaptiveWorkItemOutcome(item, actor);
      requestWorkItemAutoSchedulerSweep();
      if (reason === "delivery_completed") {
        try { channelWorkItemHook?.(item, { notify: true, reason: "work_item_delivery_completed" }); } catch { /* best-effort Channel projection */ }
      }
    },
    claimTaskMaterialDraft: taskMaterialService.claimDraft,
    inspectTaskMaterialDraft: taskMaterialService.getDraft,
    resolveClaimedTaskMaterial: taskMaterialService.resolveClaimedAsset,
    resolveLocalContentReference: localContentCatalogService.resolveOriginal,
  });
  let releaseRoutineLedgerReservations = () => {};
  const businessRoutineService = createBusinessRoutineService({
    state,
    now,
    nextId,
    appendEvent,
    persistStateSoon,
    createWorkItem: workItemService.createWorkItem,
    recordWorkItemVerification: workItemService.recordVerification,
    releaseRoutineLedgerReservations: (input, actor) =>
      releaseRoutineLedgerReservations(input, actor),
    store,
  });
  let refreshChannelMutationSourceIdentity = null;
  const channelObjectRegistryService = createChannelObjectRegistryService({
    state,
    now,
    nextId,
    appendEvent,
    persistStateSoon,
    store,
  });
  const channelObjectImportService = createChannelObjectImportService({
    state,
    now,
    nextId,
    appendEvent,
    persistStateSoon,
    store,
    upsertChannelObject: channelObjectRegistryService.upsertChannelObject,
    setChannelObjectStatus: channelObjectRegistryService.setChannelObjectStatus,
    onFileSourceConfirmed: (identity, actor) => refreshChannelMutationSourceIdentity?.(identity, actor),
  });
  const channelObjectConnectorService = createChannelObjectConnectorService({
    state,
    now,
    nextId,
    appendEvent,
    persistStateSoon,
    store,
    upsertChannelObject: channelObjectRegistryService.upsertChannelObject,
    adapters: channelObjectConnectorAdapters,
  });
  const channelMutationBindingService = createChannelMutationBindingService({
    state,
    now,
    nextId,
    appendEvent,
    persistStateSoon,
    store,
  });
  refreshChannelMutationSourceIdentity = (identity, actor) =>
    channelMutationBindingService.refreshSourceIdentity(identity, actor);
  const ledgerUpsertService = createLedgerUpsertService({
    state,
    now,
    nextId,
    appendEvent,
    persistStateSoon,
    store,
    validateRoutineLedgerStep: businessRoutineService.validateRoutineLedgerStep,
    completeRoutineLedgerStep: businessRoutineService.completeRoutineLedgerStep,
  });
  const businessPilotEvidenceService = createBusinessPilotEvidenceService({
    state,
    now,
    nextId,
    persistStateSoon,
    store,
    createWorkItem: workItemService.createWorkItem,
  });
  releaseRoutineLedgerReservations = ledgerUpsertService.cancelRoutineReservations;
  const articleImportConfig = resolveArticleImportConfig();
  const articleExtractorPluginService = createArticleExtractorPluginService({
    state,
    now,
    nextId,
    appendEvent,
    persistStateSoon: persistArticleStateSoon,
    validateApprovalToken,
    store,
  });
  const resolveArticleExtractor = (url, ownerTeamId) =>
    articleExtractorPluginService.resolveForUrl(url, ownerTeamId);
  const articleImportService = createArticleImportService({
    state,
    now,
    nextId,
    workItemService,
    maxConcurrent: articleImportConfig.maxConcurrent,
    maxPending: articleImportConfig.maxPending,
    limits: articleImportConfig.limits,
    persistStateSoon: persistArticleStateSoon,
    createInvocation: (task, agent, options) => {
      if (!invocationService) throw new Error("article_derivative_agent_unavailable");
      return invocationService.createInvocation(task, agent, options);
    },
    startInvocationIfAllowed: (invocation, agent) =>
      invocationService?.startInvocationIfAllowed(invocation, agent),
    resolveExtractorPlugin: resolveArticleExtractor,
    store,
  });
  const channelKnowledgeService = createChannelKnowledgeService({
    state,
    stateStorePath,
    now,
    nextId,
    persistStateSoon: persistArticleStateSoon,
    maxConcurrent: articleImportConfig.maxConcurrent,
    maxPending: articleImportConfig.maxPending,
    importArticle: (input) => importArticleToWorktree({
      ...input,
      extractorPlugin: resolveArticleExtractor(input.url, input.ownerTeamId),
    }),
    store,
  });
  // Session manager: login-state observability + keep-alive for profile-backed
  // site plugins (zhihu today). Dormant by design — the sweep only runs when
  // index.mjs is gated on via MYAGENTTOOL_SESSION_MANAGER_ENABLED.
  const sessionManagerService = createSessionManager({
    state,
    now,
    appendEvent,
    persistStateSoon,
    sendAlert: alertOutbox.enqueue,
  });
  const workflowOcrAdapter = createFallbackWorkflowOcrAdapter({
    localAdapter: createLocalWorkflowOcrAdapter({
      config: resolveWorkflowOcrConfig(),
    }),
    codexAdapter: createCodexVisionOcrAdapter({
      config: resolveCodexVisionOcrConfig(),
    }),
  });
  const workflowMemoryService = createWorkflowMemoryService({
    state,
    now,
    nextId,
    appendEvent,
    persistStateSoon,
    embeddingAdapter: createLocalWorkflowEmbeddingAdapter({
      config: resolveWorkflowEmbeddingConfig(),
    }),
    ocrAdapter: workflowOcrAdapter,
    createWorkItem: workItemService.createWorkItem,
    recordWorkItemVerification: workItemService.recordVerification,
    // Lazy execution bridge: Auto-run is composed below, but this callback is
    // only invoked after service composition has completed.
    startWorkItemRun: async ({
      workItemId,
      agentId,
      baseBranch,
      executionAttempt = 1,
    }, actor) => {
      const detail = workItemService.getWorkItem({ workItemId }, actor);
      if (!detail.ok) {
        const error = new Error(detail.body?.message ?? detail.body?.error ?? "Work item not found.");
        error.code = detail.body?.error ?? "workflow_work_item_not_found";
        error.status = detail.status;
        throw error;
      }
      const item = detail.body.workItem;
      const slug = String(item.title ?? "work")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "work";
      const link = {
        type: "local_issue",
        number: item.localNumber,
        title: item.title,
        url: null,
        state: item.state,
      };
      const issueBody = [
        item.body,
        workItemTemplateInstructions(item),
        item.acceptanceCriteria?.length
          ? `Acceptance criteria:\n${item.acceptanceCriteria.map((value) => `- ${value}`).join("\n")}`
          : "",
      ].filter(Boolean).join("\n\n");
      const attemptSuffix = Number(executionAttempt) > 1
        ? `-attempt-${Math.trunc(Number(executionAttempt))}`
        : "";
      const result = await startAutoRun({
        projectId: item.projectId,
        link,
        localIssueId: item.id,
        name: `local-${item.localNumber}-${slug}-autorun-${Number(item.revision) || 0}${attemptSuffix}`,
        baseBranch,
        agentId,
        actor,
        issueBody,
        executionChainId: item.id,
        terminalId: item.terminalId,
        taskMaterialWorkItemId: item.id,
        operationIntent: item.channelTaskContract?.operationIntent ?? null,
        autonomyProfile: item.planningProjects?.some((project) => project.autonomyProfile === "cautious")
          ? "cautious"
          : item.planningProjects?.some((project) => project.autonomyProfile === "high")
            ? "high"
            : "standard",
      });
      const binding = workItemService.recordExecutionBinding({
        workItemId,
        kind: "auto_run",
        targetId: result.autoRun.id,
        worktreeId: result.worktree?.id ?? result.autoRun.worktreeId,
      }, actor);
      if (!binding.ok) {
        const error = new Error(binding.body?.message ?? binding.body?.error ?? "Execution binding failed.");
        error.code = binding.body?.error ?? "workflow_execution_binding_failed";
        error.status = binding.status;
        throw error;
      }
      return { ...result, workItem: binding.body.workItem };
    },
    cancelWorkItemRun: ({ autoRunId, terminalId }, actor) =>
      cancelAutoRun(autoRunId, { actor, terminalId }),
    retryWorkItemRun: ({ autoRunId, terminalId }, actor) =>
      retryAutoRun(autoRunId, { actor, terminalId }),
    cleanupWorkItemWorktree: ({ worktreeId }) =>
      destroyWorktree(worktreeId, { deleteBranch: true }),
    store,
  });
  const businessDocumentIntelligenceService = createBusinessDocumentIntelligenceService({
    state,
    now,
    nextId,
    appendEvent,
    persistStateSoon,
    semanticAdapter: createLocalWorkflowBusinessSemanticAdapter({
      config: resolveWorkflowBusinessSemanticConfig(),
    }),
    listSources: workflowMemoryService.listSources,
    listArtifacts: workflowMemoryService.listArtifacts,
    getArtifactAnalysisInput: workflowMemoryService.getArtifactAnalysisInput,
    recordClassification: businessRoutineService.recordDocumentClassification,
    createBusinessEntity: businessRoutineService.createBusinessEntity,
    store,
  });
  let inquiryIntakeTriggerService = null;
  const workflowAdaptiveWorkService = createWorkflowAdaptiveWorkService({
    state,
    now,
    nextId,
    appendEvent,
    persistStateSoon,
    store,
    createWorkItem: workItemService.createWorkItem,
    materializeRoutineSuggestion: async (suggestion, actor) => {
      const selected = businessRoutineService.selectPublishedRoutineForTrigger({
        projectId: suggestion.projectId,
        sourceId: suggestion.sourceId,
        documentType: suggestion.documentType,
      }, actor);
      if (selected.status >= 400) return selected;
      const selectedDefinition = selected.body.routineDefinition;
      if (suggestion.documentType !== "inquiry") {
        const materialized = businessRoutineService.materializeAdaptiveRoutineSuggestion({
          projectId: suggestion.projectId,
          sourceId: suggestion.sourceId,
          observationId: suggestion.observationId,
          artifactId: suggestion.artifact?.id,
          documentType: suggestion.documentType,
        }, actor);
        if (materialized.status >= 400) return materialized;
        const advanced = businessRoutineService.advanceRoutineWorkItem({
          workItemId: materialized.body.workItem.id,
        }, actor);
        if (advanced.status >= 400) return advanced;
        return {
          status: materialized.status,
          body: {
            ...materialized.body,
            executionStatus: advanced.body.execution.run.status,
            advancedStepKeys: advanced.body.advancedStepKeys,
            assistance: advanced.body.assistance,
            routineRunId: materialized.body.execution.run.id,
          },
        };
      }
      if (!inquiryIntakeTriggerService) {
        return { status: 503, body: { error: "workflow_intake_service_unavailable" } };
      }
      const inspected = await inquiryIntakeTriggerService.inspect({
        observationId: suggestion.observationId,
      }, actor);
      if (inspected.status >= 400) {
        return inspected;
      }
      const routines = inspected.body.routines ?? [];
      if (!routines.some((routine) => routine.id === selectedDefinition.id)) {
        return {
          status: 409,
          body: {
            error: "workflow_intake_routine_not_available",
            routineCount: 0,
            recovery: "请重新检查已发布流程与当前文件的触发类型，然后再试。",
            assistance: {
              kind: "workflow_setup",
              reason: "workflow_intake_routine_not_available",
              action: "review_workflow",
              title: "已发布流程目前不能处理这份文件",
              explanation: "流程虽然匹配工作类型，但当前文件检查没有通过。",
              instruction: "请检查文件识别结果和流程证据是否仍然有效。",
              continuation: "检查通过后，AI 会自动创建 Local Issue 并继续执行。",
            },
          },
        };
      }
      const accepted = await inquiryIntakeTriggerService.accept({
        observationId: suggestion.observationId,
        expectedRevision: inspected.body.observation.revision,
        idempotencyKey: `adaptive-execute:${suggestion.id}:${selectedDefinition.id}`,
        routineDefinitionId: selectedDefinition.id,
        confirmed: true,
        fieldCorrections: {},
        excludedFieldKeys: [],
        supportingObservationIds: [],
        supportingObservationRoles: {},
      }, actor);
      if (accepted.status >= 400) return accepted;
      const receipt = accepted.body.receipt;
      const workItem = state.workItems.find((row) =>
        row.id === receipt.workItemId && row.ownerTeamId === (actor?.teamId ?? "team_local"));
      if (!workItem) {
        return { status: 502, body: { error: "workflow_intake_materialized_issue_missing" } };
      }
      const advanced = businessRoutineService.advanceRoutineWorkItem({
        workItemId: workItem.id,
      }, actor);
      if (advanced.status >= 400) return advanced;
      return {
        status: accepted.status,
        body: {
          workItem,
          replayed: Boolean(accepted.body.replayed),
          receipt,
          routineRunId: receipt.routineRunId,
          executionStatus: advanced.body.execution.run.status,
          advancedStepKeys: advanced.body.advancedStepKeys,
          assistance: advanced.body.assistance,
        },
      };
    },
    runIntakeCycle: async ({ projectId, sourceId }, actor) => {
      const scan = await workflowMemoryService.scanIncrementalIntake({ sourceId }, actor);
      if (scan.status >= 400) return scan;
      const artifactIds = [...new Set((scan.body.observations ?? [])
        .filter((row) => row.state === "ready" && row.artifactId)
        .map((row) => row.artifactId))].slice(0, 10);
      const analysis = await Promise.all(artifactIds.map((artifactId) =>
        businessDocumentIntelligenceService.analyzeArtifact({ artifactId }, actor)));
      const adaptiveWork = await workflowAdaptiveWorkService.reconcile({ projectId, sourceId }, actor);
      return {
        status: 200,
        body: {
          scan: scan.body,
          analysis: {
            attempted: artifactIds.length,
            classified: analysis.filter((row) => [200, 201].includes(row.status)).length,
            failed: analysis.filter((row) => ![200, 201].includes(row.status)).length,
          },
          adaptiveWork: adaptiveWork.body,
        },
      };
    },
  });
  syncAdaptiveWorkItemOutcome = (item, actor) =>
    workflowAdaptiveWorkService.syncWorkItemOutcome({ workItemId: item.id }, actor);
  const businessCaseDiscoveryService = createBusinessCaseDiscoveryService({
    state,
    now,
    nextId,
    appendEvent,
    persistStateSoon,
    createBusinessCase: businessRoutineService.createBusinessCase,
    store,
  });
  inquiryIntakeTriggerService = createInquiryIntakeTriggerService({
    state,
    now,
    nextId,
    appendEvent,
    persistStateSoon,
    analyzeArtifact: businessDocumentIntelligenceService.analyzeArtifact,
    confirmClassification: businessDocumentIntelligenceService.confirmClassification,
    createBusinessCase: businessRoutineService.createBusinessCase,
    listRoutineDefinitions: businessRoutineService.listRoutineDefinitions,
    materializeRoutineIssue: businessRoutineService.materializeRoutineIssue,
    verifyEvidence: workflowMemoryService.verifyIntakeEvidence,
    store,
  });
  const templateLearningService = createTemplateLearningService({
    state,
    stateStorePath,
    now,
    nextId,
    appendEvent,
    persistStateSoon,
    createWorkflowSource: workflowMemoryService.createSource,
    scanWorkflowSource: workflowMemoryService.scanSource,
    ocrWorkflowArtifact: workflowMemoryService.ocrArtifact,
    analyzeBusinessDocuments: businessDocumentIntelligenceService.analyzeSource,
    confirmBusinessDocumentClassification: businessDocumentIntelligenceService.confirmClassification,
    discoverBusinessCases: businessCaseDiscoveryService.discoverBusinessCases,
    reviewBusinessCaseCandidate: businessCaseDiscoveryService.reviewBusinessCaseCandidate,
    discoverBusinessRoutine: businessCaseDiscoveryService.discoverRoutine,
    createRoutineDraft: businessRoutineService.createRoutineDraftFromDiscovery,
    createWorkItem: workItemService.createWorkItem,
    updateWorkItem: workItemService.updateWorkItem,
    store,
  });
  const workflowMemoryInsightsService = createWorkflowMemoryInsightsService({ state });
  const continueRoutineAfterAction = (action, input, actor) => {
    const result = action(input, actor);
    if (result?.status >= 400 || !input?.workItemId) return result;
    const workItem = state.workItems.find((row) => row.id === input.workItemId);
    const run = state.routineRuns.find((row) => row.workItemId === input.workItemId);
    const sourcePolicy = state.workflowAdaptivePolicies.find((row) =>
      row.projectId === workItem?.projectId
      && row.sourceId === run?.sourceId
      && row.ownerTeamId === workItem?.ownerTeamId);
    const projectPolicy = state.workflowAdaptivePolicies.find((row) =>
      row.projectId === workItem?.projectId
      && row.sourceId == null
      && row.ownerTeamId === workItem?.ownerTeamId);
    if ((sourcePolicy ?? projectPolicy)?.mode !== "execute") return result;
    const continued = businessRoutineService.advanceRoutineWorkItem({
      workItemId: input.workItemId,
    }, actor);
    if (continued.status >= 400) return result;
    return {
      ...result,
      body: {
        ...result.body,
        execution: continued.body.execution,
        automaticContinuation: {
          advancedStepKeys: continued.body.advancedStepKeys,
          assistance: continued.body.assistance,
          completed: continued.body.completed,
        },
      },
    };
  };
  const planningProjectService = createPlanningProjectService({
    state, now, nextId, appendEvent, persistStateSoon, store, validateApprovalToken,
  });

  const {
    applicationHealthSweep,
    findApplication,
    invokeApplicationCapability,
    listApplicationCapabilities,
    listApplications,
    planAgentFacadeInvocation,
    planApplicationWrapperInvocation,
    probeApplication,
    repairApplication,
    registerApplication,
    setApplicationAutoRecovery,
    setApplicationHealthProbe,
    transitionApplication,
  } = createApplicationService({
    state,
    now,
    nextId,
    appendEvent,
    persistStateSoon,
    addProject,
    cloneProject,
    defaultProjectPath,
    // Lazy: autoRunAlerts is composed further down; the thunk only runs at sweep
    // time (post-composition), so the late binding is safe.
    sendAlert: alertOutbox.enqueue,
    validateApprovalToken,
    store,
    // Built-in Canvas capabilities (#1353) run in-process against the scene service.
    managedCapabilityHandlers: { [CANVAS_APPLICATION_ID]: createCanvasCapabilityHandlers(canvasSceneService) },
  });

  const {
    completeHealthCheck,
    createAgentHealthCheck,
    disableAgent,
    enableAgent,
    findAgent,
    markHealthCheckStarted,
    nextBridgeHealthCheck,
    registerAgent,
  } = createAgentService({ state, now, nextId, appendEvent, persistStateSoon, store });
  // The delivery-review stage is product behavior, not an operator-only tool
  // setup step. Register its fixed read-only wrapper automatically whenever the
  // local installation contains it. The wrapper invokes the user's existing
  // local Codex CLI, so no second sign-in or separate credentials are needed.
  const codexReviewWrapperPath = resolve("tools/agents/codex-review-wrapper.mjs");
  if (
    persistenceEnabled
    && existsSync(codexReviewWrapperPath)
    && !(state.agents ?? []).some(isGovernedCodexReviewAgent)
  ) {
    const reviewDevice = listDevices(state)[0] ?? null;
    const reviewOwner = reviewDevice?.ownerUserId ?? "usr_local";
    registerAgent(createCodexReviewAgentRegistration({
      wrapperScriptPath: codexReviewWrapperPath,
      costOwner: reviewOwner,
    }), { userId: reviewOwner });
  }

  const {
    closeClaudeSession,
    closeCodexSession,
    codexApprovalQueue,
    codexSessionForInvocation,
    createCodexChangeReview,
    createCodexEvidenceRecord,
    createCodexImportedEvidenceRecord,
    createManagedCodexSession,
    createManagedClaudeSession,
    createManagedCodexWorkspace,
    expireCodexApprovalBrokerRequests: expireCodexApprovalBrokerRequestsBase,
    normalizeCodexApprovalMode,
    normalizeCodexSessionMode,
    normalizeCodexWorkspacePolicy,
    normalizeClaudeSessionMode,
    recordCodexHookEvent,
    repoPathForEvidence,
    resolveCodexApprovalBrokerRequest: resolveCodexApprovalBrokerRequestBase,
    resolveResumeCodexSessionId,
    resolveResumeClaudeSessionId,
    resumableClaudeSessions,
    resumableCodexSessions,
    setClaudeSessionName,
    setCodexSessionName,
    updateCodexSessionFromEvent,
    updateClaudeSessionFromEvent,
  } = createCodexService({
    state,
    now,
    nextId,
    appendEvent,
    refuse,
    currentProject,
    findInvocation,
    persistStateSoon,
    uniqueStrings,
    worktreeForProject,
    store,
  });
  codexEventHandlers = {
    createCodexEvidenceRecord,
    updateCodexSessionFromEvent,
    updateClaudeSessionFromEvent,
  };

  const {
    createManagedTerminalSession,
    createSshConnectionTest,
    createSshTarget,
    nextTerminalBridgeAction,
    queueTerminalBridgeAction,
    recordTerminalBridgeEvent,
    recordTerminalEvidence,
  } = createTerminalService({
    state,
    now,
    nextId,
    appendEvent,
    persistStateSoon,
    summarizeText,
    uniqueStrings,
    codexSessionForInvocation,
    store,
  });

  const {
    chargebackExport,
    completeLifecycleAction,
    createAuditExportRequest,
    createPrivateCatalogEntry,
    createSignedBundleManifest,
    createLifecycleRecipe,
    createQuotaPolicy,
    checkUsageQuota,
    decideLifecycleLocalApproval,
    evaluateLifecyclePolicy,
    enforcePlatformAiQuota,
    budgetStatusFor,
    budgetStatuses,
    budgetGateForProject,
    teamBudgetStatusFor,
    reserveBudget,
    releaseReservationsForAutoRun,
    releaseReservationsForInvocation,
    reconcileBudgetReservations,
    findLifecycleLocalApproval,
    findLifecycleRollbackRequest,
    findLifecycleRecipe,
    findPrivateCatalogEntry,
    ledgerSummary,
    markLifecycleActionStarted,
    nextBridgeLifecycleAction,
    queueLifecycleAction,
    queueRollbackAction,
    recordAiUsage,
    recordInvocationLedgerEntry,
    recordInvocationRoundUsage,
    requestLifecycleLocalApproval,
    transitionLifecycleRecipe,
    updatePrivateDeploymentConfig,
    upsertBudget,
  } = createM3Service({
    state,
    now,
    nextId,
    appendEvent,
    findAgent,
    persistStateSoon,
    // #968: commit lifecycle-action transitions through the Store's unit of work.
    store,
    // autoRunAlerts is created later in this factory; the closure is only invoked
    // at run-completion (well after init), so referencing it here is safe.
    dispatchAlert: alertOutbox.enqueue,
  });
  resolveWorkItemProjectBudget = budgetStatusFor;
  resolveWorkItemTeamBudget = teamBudgetStatusFor;
  // #1151 decision soft-claims: the Approvals queue's advisory "X is handling
  // this" markers. Independent of the decision paths themselves (which enforce
  // idempotency on their own records).
  const { claimDecision, releaseDecisionClaim } = createDecisionSoftClaimService({
    state,
    now,
    nextId,
    persistStateSoon,
    store,
  });

  // #1143 issue claims: the issue-level develop lease. Composed before the
  // auto-run service, which gates admission on it and releases it on settle.
  const {
    claimIssue,
    releaseIssueClaim,
    releaseClaimsForAutoRun: releaseIssueClaimsForAutoRun,
    listIssueClaims,
    sweepExpiredClaims,
  } = createIssueClaimService({
    state,
    now,
    nextId,
    appendEvent,
    persistStateSoon,
    store,
    // #1150: GitHub assignee mirror — opt-in (console knob or env), checked
    // LIVE per call so flipping it needs no restart. Resolves the project's
    // ready checkout the same way the gh issue listing does.
    mirrorAssignee: async ({ projectId, issueNumber, action }) => {
      const enabled = state.autoRunSettings?.issueAssigneeMirror === true
        || process.env.MYAGENTTOOL_ISSUE_ASSIGNEE_MIRROR === "1";
      if (!enabled) return null;
      const target = (state.projectTargets ?? []).find((t) => t.projectId === projectId && t.state === "ready");
      if (!target?.rootPath) return null;
      return runIssueAssigneeEdit({ cwd: target.rootPath, issueNumber, action });
    },
  });

  const { recordCcusageImportedEstimates } = createCcusageImportService({
    state,
    now,
    nextId,
    appendEvent,
    persistStateSoon,
    store,
  });
  const { recordApplicationResult } = createApplicationResultImportService({
    state,
    now,
    nextId,
    appendEvent,
    persistStateSoon,
    store,
  });
  const { recordCodexReviewFindings } = createCodexReviewImportService({
    state,
    now,
    nextId,
    appendEvent,
    persistStateSoon,
    store,
  });
  const { recordClaudeReviewFindings } = createClaudeReviewImportService({
    state,
    now,
    nextId,
    appendEvent,
    persistStateSoon,
    store,
  });
  const { recordClaudeApplyResult, reconcileClaudeApplyTermination } = createClaudeApplyImportService({
    state,
    now,
    appendEvent,
    persistStateSoon,
    store,
    // #1052: the deferred-verify dispatch. Late-bound lambdas — the invocation
    // service (which owns createInvocation/startInvocationIfAllowed) is composed
    // BELOW this service because completion needs recordClaudeApplyResult; these
    // close over the outer bindings and only run at completion time, long after
    // both exist.
    createInvocation: (task, agent, options) => createInvocation(task, agent, options),
    startInvocationIfAllowed: (invocation, agent) => startInvocationIfAllowed(invocation, agent),
    findApplyRunner: () => {
      const runner = (state.agents ?? []).find(isGovernedClaudeApplyAgent) ?? null;
      if (!runner || runner.status === "disabled" || runner.health?.status === "unhealthy") return null;
      if (runner.location?.type === "local_device" && state.device?.unlinkState === "unlinked") return null;
      return runner;
    },
  });
  const { recordCodexExecChanges, createCodexExecReview, isExecChangeApproved, execRunPromotionGate } = createCodexExecImportService({
    state,
    now,
    nextId,
    appendEvent,
    persistStateSoon,
    store,
  });

  // Late-bound so completion can trigger the auto-run reaction, which is created
  // below (it needs createInvocation from this very service). Set after the
  // auto-run service exists; until then completion has nothing to advance.
  let advanceAutoRunHook = null;
  // #1147: same late-binding for the mail send fold — the send service needs
  // createInvocation (composed below), completion needs the fold here.
  let mailSendHooks = null;
  let mailFolderOrganizationHooks = null;
  let mailBodyPrefetchHooks = null;
  // S5 (#1090): channel-originated invocations report their outcome back to the
  // originating conversation. Late-bound like the auto-run hook — the delivery
  // service composes after the invocation service.
  let channelDeliveryHook = null;
  let channelThreadHook = null;
  let channelConsultationHook = null;
  let approvalAutoRunHook = null;
  let denialAutoRunHook = null;
  // Same late-binding for orchestration auto-recovery: it reuses the recovery
  // action machinery defined further down. Exception-isolated at the call site —
  // completion never fails because auto-recovery did.
  let orchestrationAutoRecoveryHook = null;
  // Runtime-only lease: a succeeded invocation keeps its worktree fenced while
  // commit/verification/publication are in flight. It is intentionally not
  // persisted — a process crash cannot strand a durable worktree lock.
  const activeWorktreeReactionLeases = new Map();

  // #1302 long-poll: one per-device wakeup shared by the cancellation service
  // (notify when a run is asked to cancel) and the bridge cancellations route
  // (hold the poll open until notified or a max-wait timeout).
  const cancellationSignal = createCancellationSignal();
  invocationService = createInvocationService({
    state,
    now,
    nextId,
    appendEvent,
    refuse,
    notifyCancellation: (deviceId) => cancellationSignal.notify(deviceId),
    persistStateSoon,
    persistStateNow,
    dispatchLeaseMs,
    namespace,
    protocolVersion,
    findAgent,
    enforcePlatformAiQuota,
    recordInvocationLedgerEntry,
    recordInvocationRoundUsage,
    recordCcusageImportedEstimates,
    recordCodexReviewFindings,
    recordClaudeReviewFindings,
    recordClaudeApplyResult,
    recordMailSendResult: (args) => {
      mailSendHooks?.recordMailSendResult(args);
      return mailFolderOrganizationHooks?.recordResult(args) ?? null;
    },
    recordCodexExecChanges,
    recordApplicationResult: (args) => {
      const records = recordApplicationResult(args);
      for (const record of records) {
        if (record.source === "mail_headers" && record.data?.kind === "mailbox_sync") {
          queueMicrotask(() => mailFolderOrganizationHooks?.onMailImported?.({
            ownerTeamId: record.ownerTeamId,
            accountId: record.applicationId,
            triggerId: record.invocationId ?? record.id,
            messages: record.data.messages ?? [],
          }));
          queueMicrotask(() => mailBodyPrefetchHooks?.enqueueBodyPrefetch?.({
            ownerTeamId: record.ownerTeamId ?? "team_local",
            applicationId: record.applicationId,
            messages: record.data.messages ?? [],
          }));
          if (record.data.hasMore === true) {
            const continuation = setTimeout(() => mailboxService?.startSync?.({ actor: { teamId: record.ownerTeamId ?? "team_local", userId: "system_mail_sync" } }), 750);
            continuation.unref?.();
          }
        }
        if (record.source === "mail_headers" && record.data?.kind === "message") {
          queueMicrotask(() => mailBodyPrefetchHooks?.sweepBodyPrefetch?.());
        }
      }
      return records;
    },
    currentProject,
    worktreeForProject,
    createWorktree,
    createWorktreePr,
    latestWorktreeReview,
    worktreeHeadCommit,
    uniqueStrings,
    normalizeCodexApprovalMode,
    normalizeCodexSessionMode,
    normalizeCodexWorkspacePolicy,
    normalizeClaudeSessionMode,
    createManagedCodexWorkspace,
    createManagedCodexSession,
    createManagedClaudeSession,
    resolveResumeCodexSessionId,
    resolveResumeClaudeSessionId,
    closeCodexSession,
    closeClaudeSession,
    budgetGateForProject,
    // #890.1 tail: hold budget at manual/API accept, release on completion.
    reserveBudget,
    releaseReservationsForInvocation,
    // #968: the Store seam — dispatch claim/ack commit through its unit of work.
    store,
    checkUsageQuota,
    isWorktreeReactionBusy: (invocation) => {
      const worktreeId = invocation?.options?.metadata?.worktreeId ?? null;
      const owner = worktreeId ? activeWorktreeReactionLeases.get(worktreeId) : null;
      return Boolean(owner && owner !== invocation.id);
    },
    // #1084: transcript count-cap evictions spill to the retention archive.
    capWithArchive: retentionArchive.capWithArchive,
    onInvocationCompleted: (invocation) => {
      localContentRetrievalService.releaseInvocation(invocation.id);
      void localContentCatalogService.requestAutomaticIncremental({ reason: "invocation_completed" }).catch(() => {
        /* local search keeps the previous valid index when an incremental pass fails */
      });
      const autoRunAdvancement = advanceAutoRunHook?.(invocation);
      try {
        recordApplicationExecutionStat(invocation);
      } catch {
        /* stats are best-effort; completion must never fail because of them */
      }
      try {
        orchestrationAutoRecoveryHook?.(invocation);
      } catch {
        /* auto-recovery is best-effort; completion must never fail because of it */
      }
      try {
        channelConsultationHook?.(invocation);
      } catch {
        /* consultation delivery is best-effort; completion must never fail because of it */
      }
      const finishChannelTask = () => {
        try {
          channelThreadHook?.(invocation);
        } catch {
          /* task-thread state is best-effort; completion must never fail because of it */
        }
        try {
          channelDeliveryHook?.(invocation);
        } catch {
          /* channel notification is best-effort; completion must never fail because of it */
        }
      };
      if (invocation.options?.metadata?.autoRunId && autoRunAdvancement?.then) {
        // The Invocation result is not the user-visible AutoRun result yet:
        // verification, repair, and local delivery may still change the final
        // state. Wait for that durable reaction before claiming completion in
        // the originating Channel; otherwise the early dedupe key suppresses
        // the real terminal message.
        void Promise.resolve(autoRunAdvancement).then(finishChannelTask, finishChannelTask);
      } else {
        finishChannelTask();
      }
      void articleImportService.reconcileDerivative(invocation).catch(() => {
        /* derivative reconciliation is retried by its status endpoint */
      });
    },
    onInvocationApproved: (invocation) => {
      approvalAutoRunHook?.(invocation);
      try { channelThreadHook?.(invocation); } catch { /* best-effort Channel status sync */ }
    },
    onInvocationDenied: (invocation) => {
      // Deny skips the completion runtime, so an apply/rollback held at the local
      // gate and denied would strand its authorization at applying/rolling_back.
      reconcileClaudeApplyTermination(invocation);
      // #1147: same for a denied send — the draft must read send_unconfirmed.
      mailSendHooks?.reconcileMailSendTermination(invocation);
      mailFolderOrganizationHooks?.reconcileTermination(invocation);
      denialAutoRunHook?.(invocation);
      try { channelThreadHook?.(invocation); } catch { /* best-effort Channel status sync */ }
      try { channelDeliveryHook?.(invocation); } catch { /* best-effort Channel denial notification */ }
    },
  });

  const {
    acknowledgeInvocation,
    approveInvocation,
    cancelInvocation,
    cancelInvocationsForDeviceUnlink,
    completeInvocation,
    createCompareRun,
    setCompareRunPreferred,
    promoteCompareRun,
    createInvocation,
    createTroubleshootingReport,
    denyInvocation,
    getAgentUsageSummary,
    markDispatched,
    nextDispatchableInvocation,
    isInvocationDispatchable,
    redeliverExpiredDispatches,
    startInvocationIfAllowed,
  } = invocationService;

  // A bridge credential survives process restarts; a bridge session does not.
  // Registering a new process generation fences work owned by the previous
  // generation without waiting for the device-level liveness grace. Unacked
  // leases are safe to requeue immediately. Acked/running work keeps occupying
  // its worktree through a short executor-drain window, then converges through
  // dispatch.mjs to transport_closed (or cancelled when cancellation was active).
  function supersedeBridgeSession(device, bridgeSessionId) {
    if (!device || !bridgeSessionId || device.bridgeSessionId === bridgeSessionId) {
      return { changed: false, requeued: 0, reclaimed: 0 };
    }
    const previousSessionId = device.bridgeSessionId ?? null;
    device.bridgeSessionId = bridgeSessionId;
    device.bridgeSessionStartedAt = now();
    device.updatedAt = now();
    let requeued = 0;
    let reclaimed = 0;
    for (const invocation of state.invocations ?? []) {
      const delivery = invocation.delivery ?? {};
      if (delivery.deviceId !== device.id || delivery.bridgeSessionId === bridgeSessionId) continue;
      if (invocation.status === "dispatching") {
        invocation.status = "queued";
        delivery.state = "redelivering";
        delivery.leaseExpiresAt = null;
        invocation.updatedAt = now();
        requeued += 1;
        appendEvent({
          invocationId: invocation.id,
          type: "delivery_session_requeued",
          level: "warn",
          message: "Invocation lease returned to the queue after the Desktop Bridge process restarted.",
          data: { deviceId: device.id, previousSessionId, bridgeSessionId },
        });
        continue;
      }
      if (!["running", "cancelling"].includes(invocation.status)) continue;
      reclaimed += 1;
      const cancelling = invocation.status === "cancelling";
      const configuredGraceMs = Number(process.env.MYAGENTTOOL_BRIDGE_SESSION_HANDOFF_GRACE_MS ?? 5_000);
      const handoffGraceMs = Number.isFinite(configuredGraceMs)
        ? Math.max(0, Math.min(30_000, configuredGraceMs))
        : 5_000;
      delivery.sessionSupersession = {
        previousSessionId,
        bridgeSessionId,
        completeAfter: new Date(Date.now() + handoffGraceMs).toISOString(),
        terminalStatus: cancelling ? "cancelled" : "failed",
        errorCode: cancelling ? null : "transport_closed",
      };
      invocation.updatedAt = now();
      appendEvent({
        invocationId: invocation.id,
        type: "bridge_session_superseded",
        level: "warn",
        message: "Invocation fenced because its Desktop Bridge process was superseded; awaiting bounded executor-tree drain.",
        data: { deviceId: device.id, previousSessionId, bridgeSessionId, handoffGraceMs, cancelling },
      });
    }
    persistStateSoon();
    appendEvent({
      invocationId: null,
      type: "bridge_session_started",
      level: "info",
      message: "Desktop Bridge process session registered.",
      data: { deviceId: device.id, previousSessionId, bridgeSessionId, requeued, reclaimed },
    });
    return { changed: true, requeued, reclaimed };
  }

  // Persisted safe-knob overrides (state.autoRunSettings) overlaid on the env
  // defaults. Empty settings => the env values unchanged. Applied here at
  // composer time, so console edits take effect on the next server start.
  const autoRunEnv = autoRunSettingsEnvOverlay(state.autoRunSettings);

  // A1 real-time alerting: best-effort webhook, URL read live so a console edit
  // applies without a restart. No-op when unconfigured; never throws.
  // O5.2 follow-up: close the SLO → alert loop. Evaluate the loop's SLOs on a
  // slow tick (index.mjs) and dispatch when the below-target set CHANGES —
  // throttled so a persistently-below SLO isn't re-alerted every tick. Emits an
  // audit event alongside the (best-effort) webhook so the breach is provable
  // from the event log even when no webhook is configured.
  function sweepAutoRunSloAlerts() {
    const projectScopes = new Map();
    for (const run of state.autoRuns ?? []) {
      const projectId = run.projectId ?? "unscoped";
      const project = (state.projects ?? []).find((candidate) => candidate.id === run.projectId);
      const teamId = project ? teamOf(project) : (run.teamId ?? "unscoped");
      const key = `${teamId}:${projectId}`;
      if (!projectScopes.has(key)) projectScopes.set(key, { teamId, projectId, runs: [] });
      projectScopes.get(key).runs.push(run);
    }
    const previousRoutingSignatures = state.autoRunRoutingAlert?.signatures ?? {};
    const previousRoutingLevels = state.autoRunRoutingAlert?.levels ?? {};
    const nextRoutingSignatures = {};
    const nextRoutingLevels = {};
    let routingAlerted = false;
    for (const [scopeKey, scope] of projectScopes) {
      const routing = summarizeAutoRuns(scope.runs, {
        routingThresholds: state.autoRunSettings?.routingThresholds ?? null,
        routingNow: now(),
      }).routingHealth;
      const signature = routing.signals.map((signal) => signal.key).sort().join(",");
      nextRoutingSignatures[scopeKey] = signature;
      const levels = Object.fromEntries(routing.signals.map((signal) => {
        const step = signal.threshold > 0 ? signal.threshold * 0.1 : signal.key === "latency" ? 1000 : 0.05;
        return [signal.key, Math.floor(signal.value / step)];
      }));
      nextRoutingLevels[scopeKey] = levels;
      const previousSignature = previousRoutingSignatures[scopeKey] ?? "";
      const worsened = signature === previousSignature && Object.entries(levels)
        .some(([key, level]) => level > Number(previousRoutingLevels[scopeKey]?.[key] ?? level));
      if (signature === previousSignature && !worsened) continue;
      if (signature) {
        const alert = {
          kind: "auto_run_routing_health",
          severity: routing.signals.some((signal) => signal.severity === "danger") ? "high" : "warning",
          message: `Auto-run routing health needs attention for project ${scope.projectId}: ${signature}.`,
          data: {
            teamId: scope.teamId,
            projectId: scope.projectId,
            signals: routing.signals,
            total: routing.total,
            confidenceTotal: routing.confidenceTotal,
            worsened,
          },
        };
        alertOutbox.enqueue(alert);
        appendEvent({ invocationId: null, type: "auto_run_routing_alert", level: "warn", message: alert.message, data: alert.data });
        routingAlerted = true;
      } else if (previousSignature) {
        const alert = {
          kind: "auto_run_routing_health_recovered",
          severity: "info",
          message: `Auto-run routing health recovered for project ${scope.projectId}.`,
          data: {
            teamId: scope.teamId,
            projectId: scope.projectId,
            previousSignals: previousSignature.split(","),
          },
        };
        alertOutbox.enqueue(alert);
        appendEvent({ invocationId: null, type: "auto_run_routing_alert", level: "info", message: alert.message, data: alert.data });
        routingAlerted = true;
      }
    }
    for (const [scopeKey, previousSignature] of Object.entries(previousRoutingSignatures)) {
      if (projectScopes.has(scopeKey) || !previousSignature) continue;
      const separator = scopeKey.indexOf(":");
      const teamId = separator >= 0 ? scopeKey.slice(0, separator) : "unscoped";
      const projectId = separator >= 0 ? scopeKey.slice(separator + 1) : scopeKey;
      const alert = {
        kind: "auto_run_routing_health_recovered",
        severity: "info",
        message: `Auto-run routing health recovered for project ${projectId}.`,
        data: { teamId, projectId, previousSignals: previousSignature.split(",") },
      };
      alertOutbox.enqueue(alert);
      appendEvent({ invocationId: null, type: "auto_run_routing_alert", level: "info", message: alert.message, data: alert.data });
      routingAlerted = true;
    }
    if (
      JSON.stringify(nextRoutingSignatures) !== JSON.stringify(previousRoutingSignatures)
      || JSON.stringify(nextRoutingLevels) !== JSON.stringify(previousRoutingLevels)
    ) {
      state.autoRunRoutingAlert = { signatures: nextRoutingSignatures, levels: nextRoutingLevels, at: now() };
      persistStateSoon();
    }
    const targets = state.autoRunSettings?.sloTargets
      ? { ...DEFAULT_SLO_TARGETS, ...state.autoRunSettings.sloTargets }
      : DEFAULT_SLO_TARGETS;
    const previousSloSignatures = state.autoRunSloAlert?.signatures ?? {};
    const nextSloSignatures = {};
    let sloAlerted = false;
    let lastSloKind = null;
    const healthWindowDays = state.autoRunSettings?.routingThresholds?.windowDays ?? 30;
    const healthCutoff = Date.parse(now()) - healthWindowDays * 86_400_000;
    for (const [scopeKey, scope] of projectScopes) {
      const windowRuns = scope.runs.filter((run) => {
        // SLOs describe outcomes, so a recently completed long-running job
        // belongs to the current window even when it was created earlier.
        const at = Date.parse(run.updatedAt ?? run.createdAt ?? "");
        return !Number.isFinite(at) || at >= healthCutoff;
      });
      const summary = summarizeAutoRunSlos(windowRuns, targets);
      const result = evaluateSloAlert(summary, previousSloSignatures[scopeKey] ?? "");
      nextSloSignatures[scopeKey] = result.signature;
      if (!result.changed || !result.alert) continue;
      const alert = {
        ...result.alert,
        message: `${result.alert.message} Project: ${scope.projectId}.`,
        data: { ...(result.alert.data ?? {}), teamId: scope.teamId, projectId: scope.projectId },
      };
      alertOutbox.enqueue(alert);
      appendEvent({
        invocationId: null,
        type: "auto_run_slo_alert",
        level: alert.severity === "info" ? "info" : "warn",
        message: alert.message,
        data: alert.data,
      });
      sloAlerted = true;
      lastSloKind = alert.kind;
    }
    for (const [scopeKey, previousSignature] of Object.entries(previousSloSignatures)) {
      if (projectScopes.has(scopeKey) || !previousSignature) continue;
      const separator = scopeKey.indexOf(":");
      const teamId = separator >= 0 ? scopeKey.slice(0, separator) : "unscoped";
      const projectId = separator >= 0 ? scopeKey.slice(separator + 1) : scopeKey;
      const alert = {
        kind: "auto_run_slo_recovered",
        severity: "info",
        message: `Auto-run SLOs recovered for project ${projectId}.`,
        data: { teamId, projectId, previousSignals: previousSignature.split(",") },
      };
      alertOutbox.enqueue(alert);
      appendEvent({
        invocationId: null,
        type: "auto_run_slo_alert",
        level: "info",
        message: alert.message,
        data: alert.data,
      });
      sloAlerted = true;
      lastSloKind = alert.kind;
    }
    if (JSON.stringify(nextSloSignatures) !== JSON.stringify(previousSloSignatures)) {
      state.autoRunSloAlert = { signatures: nextSloSignatures, at: now() };
      persistStateSoon();
    }
    return {
      alerted: routingAlerted || sloAlerted,
      kind: lastSloKind ?? (routingAlerted ? "routing_health" : null),
    };
  }

  // ADR 0017: opt-in, best-effort OTLP/HTTP JSON trace export. Reads the endpoint
  // live so an operator edit applies without a restart; a fire-and-forget mirror
  // of the authoritative in-memory spans. On a slow tick (index.mjs) it exports
  // completed, not-yet-exported spans and marks them optimistically, rolling the
  // mark back if the POST fails so the batch retries next tick. No-op when
  // unconfigured; never throws into or slows an invocation.
  const otlpExporter = createOtlpTraceExporter({ now });
  function flushTraceExport() {
    if (!(process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "").trim()) return { exported: 0 };
    const pending = (state.spans ?? []).filter((span) => span.endedAt && !span.otlpExportedAt);
    if (pending.length === 0) return { exported: 0 };
    const at = now();
    for (const span of pending) span.otlpExportedAt = at;
    void otlpExporter.exportSpans(pending).then((result) => {
      // On failure, roll the optimistic mark back so the batch retries next tick.
      // Persist in BOTH branches: an unrelated persist between the mark and this
      // callback can flush the mark, so the rollback must be persisted too — else
      // a failed export leaves the span marked-exported-but-never-sent on restart.
      if (!result?.sent) {
        for (const span of pending) if (span.otlpExportedAt === at) span.otlpExportedAt = null;
      }
      persistStateSoon();
    });
    return { exported: pending.length };
  }

  // ADR 0018: owner-gated per-subject deletion of observability data. Erases the
  // subject's CONTENT (and, at tier `full`, its telemetry rows) through the same
  // reap primitives as retention; the shielded set (ledger/audit/refusals) is
  // never touched. A non-owner is refused through the single refusal writer.
  function requestObservabilityDeletion({ scope, subjectId, tier = "operational", actor } = {}) {
    if (!deletionScopes.includes(scope) || !subjectId) {
      return { ok: false, error: "invalid_request" };
    }
    if (!canDeleteObservabilityData(actor)) {
      refuse({
        category: "policy",
        code: "action_not_permitted",
        requester: { kind: "control_plane", id: actor?.userId ?? null },
        summary: `Observability data deletion is owner-gated; role "${actor?.role ?? "unknown"}" refused.`,
        remedy: "Retry as an owner or admin.",
      });
      return { ok: false, error: "not_permitted" };
    }
    const result = deleteObservabilityData(state, { scope, subjectId, tier, now, appendEvent, actor, deleteHistory: historyDelete, redactHistory: historyRedact, queryHistory: historyQuery });
    persistStateSoon();
    return { ok: true, ...result };
  }

  const { reserveAutoRun, decideReservedAutoRun, attachAutoRunExecutionPlan, failAutoRunUnderstanding, deferAutoRunUnderstanding, startAutoRun, advanceAutoRunForInvocation, syncAutoRunOnApproval, syncAutoRunOnDenial, retryAutoRun, reverifyAutoRun, attemptFailover, cancelAutoRun, stopAutoRunDelivery, mergeAutoRunPr, recordRoutingOverride, reapStuckAutoRuns, reconcileDeliveryReviews, autoMergeSweep, approveDesign, rejectDesign, answerClarify, approveDecomposition, rejectDecomposition } = createAutoRunService({
    state,
    now,
    nextId,
    refuse,
    // O0 cost brake: refuse to start a run when the project is over budget.
    budgetStatusFor,
    // #890 budget reservations: hold at admission, release on settle, reconcile
    // leaked holds on the boot + 60s stuck-run sweep.
    reserveBudget,
    releaseReservationsForAutoRun,
    reconcileBudgetReservations,
    // #1143 issue claims: hold the issue's develop lease at admission, release
    // it when the run settles.
    claimIssueForRun: claimIssue,
    releaseIssueClaimsForAutoRun,
    // Development execution is admitted only from a durable Local Issue.
    // External GitHub/GitLab issues remain intake/context records.
    requireLocalIssueForDevelopment: true,
    // A1 alerting: best-effort operational webhook (budget breach, stuck reap).
    sendAlert: alertOutbox.enqueue,
    // O1 reliability: find a run's invocation for stuck/crash reconcile.
    findInvocation,
    // Operator stop: cancel a run's in-flight agent invocation.
    cancelInvocation,
    // O2 graduated approval: apply a human-equivalent approval by policy (used
    // only for operator-opted-in non-code paths). Reuses the existing approve
    // path — no change to the security policy that decides who needs approval.
    autoApproveInvocation: ({ invocationId, actor }) => {
      const approval = (state.approvalRequests ?? []).find((item) => item.invocationId === invocationId && item.status === "pending");
      const invocation = findInvocation(invocationId);
      if (!approval || !invocation) return false;
      approveInvocation(approval, invocation, actor ?? null);
      return true;
    },
    appendEvent,
    persistStateSoon,
    createWorktree,
    // Destructive teardown for a denied/abandoned run's worktree+branch (so a
    // re-run on the same issue isn't blocked by a leftover branch).
    destroyWorktree,
    findAgent,
    defaultAgent,
    importArticleToWorktree,
    createInvocation,
    startInvocationIfAllowed,
    commitWorktreeChanges,
    publishWorktreeBranch,
    createWorktreePr,
    acquireWorktreeReactionLease: (worktreeId, invocationId) => {
      const owner = activeWorktreeReactionLeases.get(worktreeId);
      if (owner && owner !== invocationId) return false;
      activeWorktreeReactionLeases.set(worktreeId, invocationId);
      return true;
    },
    releaseWorktreeReactionLease: (worktreeId, invocationId) => {
      if (activeWorktreeReactionLeases.get(worktreeId) === invocationId) {
        activeWorktreeReactionLeases.delete(worktreeId);
      }
    },
    // Verification gate: run the project-configured command in the worktree.
    // No command configured -> unverified pass-through (PR labeled unverified);
    // a configured command that fails blocks the PR.
    verifyWorktree: async ({ worktree, signal = null }) => {
      // A4: resolve the project's chosen allowlisted verify command by NAME
      // (operator-set argv), falling back to the global command.
      const project = (state.projects ?? []).find(
        // The verify selection belongs to the source project. A derived
        // workspace project intentionally carries only worktree-local runtime
        // metadata and does not inherit verifyCommandName.
        (p) => p.id === (worktree?.sourceProjectId ?? worktree?.projectId ?? worktree?.workspaceProjectId),
      ) ?? null;
      let changedPaths = [];
      if (worktree?.path) {
        try {
          const diffArgs = worktree.baseCommit
            ? ["-C", worktree.path, "diff", "--name-only", worktree.baseCommit, "HEAD", "--"]
            // Legacy worktrees did not persist their fork SHA. Auto-run commits
            // are atomic, so the latest commit is the narrowest safe historical
            // fallback and avoids comparing against a moving local main branch.
            : ["-C", worktree.path, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD", "--"];
          changedPaths = execFileSync("git", diffArgs, {
            encoding: "utf8",
            timeout: 5_000,
            stdio: ["ignore", "pipe", "ignore"],
          }).split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
        } catch {
          changedPaths = [];
        }
      }
      const commands = resolveAutoRunVerificationPlan({
        verifyCommandName: project?.verifyCommandName ?? null,
        changedPaths,
        repositoryRoot: worktree?.path ?? null,
      });
      if (!commands.length || !worktree?.path) {
        return { passed: true, verified: false, summary: "No verification command configured — PR opened unverified." };
      }
      return runWorktreeVerificationPlan({
        cwd: worktree.path,
        commands,
        timeoutMs: autoRunVerificationTimeoutMs(),
        signal,
      });
    },
    // Issue status writeback (ready -> in-progress -> review). Undefined when
    // disabled so the orchestrator skips it entirely — no GitHub writes by default.
    writeIssueStatus: resolveStatusWritebackConfig(autoRunEnv).enabled
      ? async ({ issueNumber, repoPath, to }) => runIssueStatusTransition({ cwd: repoPath, issueNumber, to })
      : undefined,
    // Post an investigation auto-run's findings back to the issue. Gated by the
    // same GitHub-write opt-in; undefined (off) still sets report_posted locally.
    postIssueReport: resolveStatusWritebackConfig(autoRunEnv).enabled
      ? async ({ issueNumber, repoPath, body }) => runIssueComment({ cwd: repoPath, issueNumber, body })
      : undefined,
    // Decision step (ISSUE_DECISION_AGENT_PLAN.md slice 3): an operator-configured
    // one-shot command (any LLM CLI/script; issue context JSON on stdin, decision
    // JSON on stdout). Unconfigured -> undefined -> the heuristic floor decides,
    // byte-compatible with the previous intent routing.
    decideIssuePath: (() => {
      const command = resolveDeciderCommand(autoRunEnv);
      return command
        ? async ({ link, issueBody, projectContext }) => runDeciderCommand({
            command,
            input: { link, issueBody, projectContext },
            timeoutMs: deciderTimeoutMs(autoRunEnv),
          })
        : undefined;
    })(),
    // Decision confidence gate + fast-path (settings overlaid on env); passed so
    // startAutoRun's resolveDecision honors the console-saved thresholds.
    decisionSettings: decisionConfig(autoRunEnv),
    // Read-only issue body fetch: context for the decision and the role prompt.
    fetchIssueBody: async ({ issueNumber, repoPath }) => runIssueBodyFetch({ cwd: repoPath, issueNumber }),
    // Governed child-issue spawning (slice 4): a design deliverable becomes a
    // pending-decision child issue (parent fields inherited, never auto-labelled,
    // depth-1 marked). Off by default; undefined -> the orchestrator skips it.
    // D4: ungated spawn used ONLY by the explicit human Approve-design action —
    // the click is the authorization, independent of the automatic spawn config.
    spawnChildIssueDirect: async ({ parentLink, design, repoPath }) => {
      const parentBody = await runIssueBodyFetch({ cwd: repoPath, issueNumber: parentLink.number });
      return runChildIssueCreate({
        cwd: repoPath,
        title: childIssueTitle(parentLink),
        body: childIssueBody({ parentLink, design, projectFieldsBlock: extractProjectFieldsBlock(parentBody) }),
      });
    },
    spawnChildIssue: spawnIssuesConfig(autoRunEnv).enabled
      ? async ({ parentLink, design, repoPath }) => {
          const parentBody = await runIssueBodyFetch({ cwd: repoPath, issueNumber: parentLink.number });
          return runChildIssueCreate({
            cwd: repoPath,
            title: childIssueTitle(parentLink),
            body: childIssueBody({ parentLink, design, projectFieldsBlock: extractProjectFieldsBlock(parentBody) }),
          });
        }
      : undefined,
    // Acceptance judge (Phase B): operator-configured one-shot command judging
    // "does this diff solve this issue?". Unconfigured -> undefined -> skipped.
    judgeAcceptance: (() => {
      const command = resolveJudgeCommand(autoRunEnv);
      return command
        ? async ({ worktree, autoRun }) => {
            const diff = worktreeDiff(worktree)?.diff ?? "";
            const issueBody = autoRun.link?.type === "issue" && worktree?.repoPath
              ? await runIssueBodyFetch({ cwd: worktree.repoPath, issueNumber: autoRun.link.number })
              : null;
            return runAcceptanceJudge({ command, link: autoRun.link, issueBody, diff, timeoutMs: judgeTimeoutMs(autoRunEnv) });
          }
        : undefined;
    })(),
    // Risk-based merge: the AI diff-review step (slice 2). Computes the worktree
    // diff + line count and runs the operator's review command; the result feeds
    // the merge-risk model in the auto-merge sweep. Undefined when no command.
    reviewDiff: (() => {
      const command = resolveReviewCommand(autoRunEnv);
      if (!command) return undefined;
      return async ({ autoRun }) => {
        const worktree = state.worktrees.find((w) => w.id === autoRun.worktreeId) ?? null;
        if (!worktree) return { review: null, diffLines: 0, files: [] };
        const wd = worktreeDiff(worktree) ?? {};
        const diff = wd.diff ?? "";
        const diffLines = diff ? diff.split("\n").length : 0;
        // changedPaths, NOT wd.files: porcelain (working tree) goes empty once
        // the agent commits, which silently blinded the sensitive-path guard at
        // sweep time (the sweep runs post-commit/post-publish).
        const files = Array.isArray(wd.changedPaths) ? wd.changedPaths.filter(Boolean) : [];
        const issueBody = autoRun.link?.type === "issue" && worktree?.repoPath
          ? await runIssueBodyFetch({ cwd: worktree.repoPath, issueNumber: autoRun.link.number })
          : null;
        // Scan the diff itself for injection markers — an injection embedded in
        // the agent's OWN diff (not just the issue body) could coax the review
        // command into {"approve":true}. A hit forces fail (never trust an
        // LLM verdict on a poisoned diff). (audit finding)
        const injectionReview = scanDiffForInjection(diff);
        const review = injectionReview ?? await runDiffReview({ command, link: autoRun.link, issueBody, diff, timeoutMs: reviewTimeoutMs(autoRunEnv) });
        return { review, diffLines, files };
      };
    })(),
    // Every completed local code delivery gets a second, read-only Codex pass.
    // This is the same governed reviewer exposed by the tool registry, so it
    // inherits the Desktop Bridge's local Codex login and cannot modify files.
    startDeliveryReview: async ({ autoRun, worktree }) => {
      const reviewer = (state.agents ?? []).find(isGovernedCodexReviewAgent) ?? null;
      if (!reviewer || reviewer.status === "disabled" || reviewer.health?.status === "unhealthy") {
        throw new Error("The governed Codex reviewer is not available on this device.");
      }
      const reviewerDevice = reviewer.location?.type === "local_device"
        ? findDevice(state, reviewer.location.deviceId)
        : null;
      if (reviewer.location?.type === "local_device" && reviewerDevice?.unlinkState !== "linked") {
        throw new Error("The local device is not connected, so Codex review cannot start yet.");
      }
      const taskContext = [
        `Review the completed delivery for local task ${autoRun.link?.number ?? autoRun.id}: ${autoRun.link?.title ?? "Untitled task"}.`,
        "Judge whether the committed change solves the task, introduces regressions, and includes adequate tests.",
        autoRun.issueBody ? `Task and acceptance context:\n${String(autoRun.issueBody).slice(0, 850)}` : null,
      ].filter(Boolean).join("\n\n").slice(0, 1200);
      const invocation = createInvocation(`Review the completed local task delivery for ${autoRun.link?.title ?? autoRun.id}.`, reviewer, {
        actor: { userId: autoRun.requestedBy ?? "usr_local", teamId: autoRun.teamId ?? "team_local", role: "operator" },
        requestedBy: autoRun.requestedBy ?? "usr_local",
        metadata: {
          tool: CODEX_REVIEW_TOOL_CONTRACT.name,
          toolVersion: CODEX_REVIEW_TOOL_CONTRACT.version,
          projectId: autoRun.projectId,
          worktreeId: worktree.id,
          severityFloor: "medium",
          instruction: taskContext,
          ...(typeof worktree.baseCommit === "string" && /^[0-9a-f]{40}$/i.test(worktree.baseCommit)
            ? { reviewBaseRef: worktree.baseCommit.toLowerCase() }
            : {}),
          autoRunId: autoRun.id,
          role: "delivery_review",
          ...(autoRun.channelOrigin?.channelId && autoRun.channelOrigin?.conversationId ? {
            channel: {
              ...autoRun.channelOrigin,
              workItemId: autoRun.localIssueId ?? autoRun.executionChainId ?? null,
              autoRunId: autoRun.id,
              projectId: autoRun.projectId ?? null,
            },
            riskTags: [UNTRUSTED_INPUT_TAG],
          } : {}),
        },
        // Native Codex review can inspect call sites and tests beyond the patch.
        // Keep it asynchronous and allow the same turn budget as a coding run;
        // the UI polls progress and the retry policy prevents runaway attempts.
        timeoutSeconds: 900,
      });
      startInvocationIfAllowed(invocation, reviewer);
      return invocation;
    },
    submitDeliveryReview: submitWorktreeReview,
    // Read a small text file from a worktree (e.g. design/BRIEF.md) — used to
    // surface the FULL design/prototype brief in the report, not just the thin
    // terminal summary. Null if absent/oversized.
    readWorktreeTextFile: (worktreeId, relPath, maxBytes = 16_000) => {
      const worktree = state.worktrees.find((w) => w.id === worktreeId) ?? null;
      if (!worktree?.path || typeof relPath !== "string") return null;
      try {
        const resolved = resolve(worktree.path, relPath);
        if (!resolved.startsWith(resolve(worktree.path))) return null; // no escape
        if (!existsSync(resolved)) return null;
        // Default cap suits display briefs; a machine-parsed file (decomposition
        // PLAN.json) passes a larger cap so a big-but-valid plan isn't truncated
        // mid-JSON into a parse failure. (review: PLAN.json 16KB truncation)
        return readFileSync(resolved, "utf8").slice(0, Math.max(1, Number(maxBytes) || 16_000));
      } catch {
        return null;
      }
    },
    // Cheap current worktree HEAD sha — lets the auto-merge sweep invalidate a
    // cached review/diff when the PR head moved. (audit finding)
    worktreeHeadSha: (worktreeId) => {
      const worktree = state.worktrees.find((w) => w.id === worktreeId) ?? null;
      if (!worktree?.path) return null;
      try {
        return execFileSync("git", ["-C", worktree.path, "rev-parse", "HEAD"], { encoding: "utf8", timeout: 5000 }).trim() || null;
      } catch {
        return null;
      }
    },
    // D3 (issue→UI-design plan): what did this branch change vs its base —
    // committed work included. Drives design-artifact detection in the reaction.
    listWorktreeChangedFiles: (worktreeId) => {
      const worktree = state.worktrees.find((w) => w.id === worktreeId) ?? null;
      if (!worktree) return [];
      const wd = worktreeDiff(worktree) ?? {};
      return Array.isArray(wd.changedPaths) ? wd.changedPaths.filter(Boolean) : [];
    },
    // Human-triggered PR merge from the console (merge stays human — only fired
    // by a person clicking Merge on a pr_open run, never automatically).
    mergePr: ({ prNumber, repoPath }) => runPrMerge({ cwd: repoPath, prNumber }),
    // Fresh PR-checks fetch for the require-green-checks merge gate (no stale poll).
    fetchPrChecks: ({ prNumber, repoPath }) => runPrChecks({ cwd: repoPath, prNumber }),
    // Layer B: rasterize a design run's HTML mockups to design/*.png via the
    // operator's render command (argv from env, no shell — same trust boundary as
    // verify). Best-effort; unconfigured -> undefined -> no inline previews.
    // Epic S3: create ONE governed decomposition child issue (ungated — the human
    // approval of the plan is the authorization, like spawnChildIssueDirect). The
    // service loops this over the approved tree's specs.
    createDecompositionChild: async ({ repoPath, title, body }) => runChildIssueCreate({ cwd: repoPath, title, body }),
    renderDesignImages: (() => {
      const command = resolveDesignRenderCommand(autoRunEnv);
      if (!command) return undefined;
      return async (worktreeId) => {
        const worktree = state.worktrees.find((w) => w.id === worktreeId) ?? null;
        if (!worktree?.path) return { rendered: false, reason: "no worktree" };
        return runDesignRender({ worktreePath: worktree.path, command, timeoutMs: designRenderTimeoutMs(autoRunEnv) });
      };
    })(),
    // D1 deploy stage: the operator's post-merge deploy command (argv, no shell,
    // never agent-proposed — same trust boundary as verify/judge). Undefined when
    // unconfigured, so the deploy step is skipped entirely.
    runDeploy: (() => {
      const command = resolveDeployCommand(autoRunEnv);
      if (!command) return undefined;
      return async ({ link, prNumber, repoPath }) =>
        runDeployCommand({ command, input: { link, prNumber, repoPath }, timeoutMs: deployTimeoutMs(autoRunEnv) });
    })(),
    // Self-healing (H1): the operator's rollback command, run on a failed deploy.
    runRollback: (() => {
      const command = resolveRollbackCommand(autoRunEnv);
      if (!command) return undefined;
      return async ({ link, prNumber, repoPath }) =>
        runDeployCommand({ command, input: { link, prNumber, repoPath, action: "rollback" }, timeoutMs: rollbackTimeoutMs(autoRunEnv) });
    })(),
    // Self-healing (H2): file the auto-labeled remediation issue after a failed
    // deploy (gh issue create; gated at call-time on remediateOnDeployFailure).
    fileRemediationIssue: async ({ repoPath, title, body, labels }) => runChildIssueCreate({ cwd: repoPath, title, body, labels }),
    materializeTaskMaterials: taskMaterialService.materialize,
    store,
  });
  const workItemAutoRunUnderstandingService = createWorkItemAutoRunUnderstandingService({
    state,
    getWorkItem: workItemService.getWorkItem,
    prepareExecutionContract: workItemService.prepareExecutionContract,
    decideReservedAutoRun,
    attachAutoRunExecutionPlan,
    failAutoRunUnderstanding,
    deferAutoRunUnderstanding,
    startAutoRun,
    onInvocationStarted: (invocation) => channelThreadHook?.(invocation),
    onAutoRunUpdated: (autoRun, options) => channelAutoRunHook?.(autoRun, { notify: true, ...options }),
    searchProjectContent,
  });
  const workItemAutoRunBatchService = createWorkItemAutoRunBatchService({
    state,
    now,
    nextId,
    persistStateSoon,
    appendEvent,
    getWorkItem: workItemService.getWorkItem,
    beginExecution: workItemService.beginExecution,
    abortExecution: workItemService.abortExecution,
    recordExecutionBinding: workItemService.recordExecutionBinding,
    reserveAutoRun,
    enqueueAutoRunUnderstanding: workItemAutoRunUnderstandingService.enqueue,
    store,
  });
  const workItemAutoSchedulerService = createWorkItemAutoSchedulerService({
    state,
    now,
    appendEvent,
    getWorkItem: workItemService.getWorkItem,
    beginExecution: workItemService.beginExecution,
    abortExecution: workItemService.abortExecution,
    recordExecutionBinding: workItemService.recordExecutionBinding,
    reserveAutoRun,
    enqueueAutoRunUnderstanding: workItemAutoRunUnderstandingService.enqueue,
    failAutoRunUnderstanding,
    timeZone: () => currentDeviceTimeZone(state),
  });
  requestWorkItemAutoSchedulerSweep = () => {
    setImmediate(() => void workItemAutoSchedulerService.sweep().catch(() => {}));
  };
  const codexApprovalRecovery = createCodexApprovalRecoveryService({
    state,
    now,
    appendEvent,
    persistStateSoon,
    findInvocation,
    retryAutoRun,
  });
  const processPlanningRecommendedActions = () =>
    planningProjectService.processQueuedRecommendedActions({ retryAutoRun });
  // Now that the reaction exists, let completion drive it.
  advanceAutoRunHook = async (invocation) => {
    const result = await advanceAutoRunForInvocation(invocation);
    await codexApprovalRecovery.resumeForSettledInvocation(invocation);
    requestWorkItemAutoSchedulerSweep();
    return result;
  };
  approvalAutoRunHook = syncAutoRunOnApproval;
  denialAutoRunHook = syncAutoRunOnDenial;
  orchestrationAutoRecoveryHook = maybeAutoRecoverOrchestrationRun; // hoisted function declaration (defined with the recovery machinery below)
  // Explicit approvals survive a server restart. Reconcile any recovery that
  // was waiting for terminal propagation or whose short `starting` claim was
  // interrupted before the resumed invocation could be recorded.
  queueMicrotask(() => {
    void codexApprovalRecovery.reconcilePendingRecoveries().catch(() => {});
  });
  queueMicrotask(() => {
    void workItemAutoRunUnderstandingService.reconcile().catch(() => {});
  });
  // Let the HTTP listener bind before historical delivery review reconciliation;
  // this work may create and persist an invocation on a large local state file.
  setTimeout(() => {
    void reconcileDeliveryReviews({ ignoreRetryDelay: true }).catch(() => {});
  }, 1_000).unref?.();

  // Routing-evaluation disposition refresh (slice 5): bounded, throttled,
  // read-only gh; persists only when something changed.
  async function refreshAutoRunPrDispositions({ teamId = null } = {}) {
    const visibleProjectIds = teamId == null
      ? null
      : new Set((state.projects ?? []).filter((project) => teamOf(project) === teamId).map((project) => project.id));
    const scopedState = visibleProjectIds == null ? state : {
      ...state,
      autoRuns: (state.autoRuns ?? []).filter((run) =>
        (run.projectId && visibleProjectIds.has(run.projectId)) || (!run.projectId && run.teamId === teamId)),
    };
    const result = await refreshPrDispositions({
      state: scopedState,
      now,
      fetchPrState: ({ prNumber, repoPath }) => runPrStateFetch({ cwd: repoPath, prNumber }),
      onDispositionChanged: ({ run, prState }) => {
        convergeAutoRunTerminalState({ state, autoRun: run, disposition: prState, now, nextId, source: "github_refresh" });
      },
      // CI check posture for the merge decision (read-only gh; shown on the card).
      fetchPrChecks: ({ prNumber, repoPath }) => runPrChecks({ cwd: repoPath, prNumber }),
    });
    // A run's prChecks can change even when prState didn't, so persist whenever
    // any run was refreshed, not only on a state transition.
    if (result.checked > 0) persistStateSoon();
    // Epic S4 reconcile: mark a decomposed epic's children done when their ISSUE
    // closes (however it merged — incl. a human-override PR outside the loop).
    const epic = await refreshEpicChildStates({
      state: scopedState,
      now,
      fetchIssueState: ({ issueNumber, repoPath }) => runIssueStateFetch({ cwd: repoPath, issueNumber }),
      projectPathFor: (projectId) => (state.projects ?? []).find((p) => p.id === projectId)?.path ?? null,
    });
    // Persist on any checked epic (not only on a state change) so the per-epic
    // throttle stamp (childStatesRefreshedAt) survives a restart. (review F4)
    if (epic.changed || epic.checked > 0) persistStateSoon();
    return result;
  }

  const {
    completeDiscoveryRun,
    completeIntegrationProbeRun,
    createAgentDryProbeRun,
    createDiscoveryRun,
    createIntegrationArtifact,
    createIntegrationProbeRun,
    draftIntegrationWithPlatformAgent,
    findDiscoveryRun,
    findIntegrationArtifact,
    findIntegrationProbeRun,
    generateIntegrationArtifacts,
    markDiscoveryStarted,
    markIntegrationProbeStarted,
    nextBridgeDiscoveryRun,
    nextBridgeProbeRun,
    registerDiscoveredCandidate,
    registerIntegrationArtifact,
    transitionIntegrationArtifact,
    updateIntegrationRetentionSettings,
  } = createIntegrationService({
    state,
    now,
    nextId,
    appendEvent,
    completeInvocation,
    createInvocation,
    disableAgent,
    findAgent,
    registerAgent,
    persistStateSoon,
  });

  const {
    currentLoopRoutineProjectContext,
    evidenceCenterRecords,
    publicState,
  } = createReadModelRuntime({
    namespace,
    protocolVersion,
    state,
    defaultProjectPath,
    currentProject,
    defaultAgent,
    codexApprovalQueue,
    codexSessionForInvocation,
    findInvocation,
    repoPathForEvidence,
    ledgerSummary,
    budgetStatuses,
    expireCodexApprovalBrokerRequests,
    channelReadiness: (channel) => channelService.readiness(channel),
    channelRuntimeAccount: (channel) => ilinkRuntime?.publicAccount?.(channel?.id) ?? null,
  });

  const {
    createToolInvocation,
    getTool,
    listTools,
    rollbackClaudeApply,
  } = createToolService({
    state,
    now,
    nextId,
    appendEvent,
    createInvocation,
    startInvocationIfAllowed,
    findApplication,
    findAgent,
    planApplicationWrapperInvocation,
    validateApprovalToken,
    persistStateSoon,
    store,
    // #1050: claude.analyze.issue resolves the issue body server-side through the
    // same governed gh read auto-run uses; the caller can never inline issue text.
    fetchIssueBody: async ({ issueNumber, repoPath }) => runIssueBodyFetch({ cwd: repoPath, issueNumber }),
  });

  const {
    createCapabilityInvocation,
    getCapability,
    listCapabilities,
    resolveCapability,
  } = createCapabilityService({
    state,
    refuse,
    listTools,
    getTool,
    createToolInvocation,
    createInvocation,
    completeInvocation,
    findAgent,
    listApplications,
    listApplicationCapabilities,
    invokeApplicationCapability,
    planAgentFacadeInvocation,
    planApplicationWrapperInvocation,
  });
  resolveWorkItemApplicationCapability = resolveCapability;
  invokeWorkItemApplicationCapability = createCapabilityInvocation;

  // Phase 3 (#979): the first governed GitHub write. Approval-gated, idempotent
  // by Message-ID, and transcribed from the server's imported record — reusing
  // the existing gh-write primitives, not a new one.
  const { createMailIssueFromImport } = createMailIssueWriteService({
    state,
    now,
    nextId,
    appendEvent,
    persistStateSoon,
    store,
    validateApprovalToken,
    repoCwd: defaultProjectPath,
  });

  // Phase 4 (#979): the outbound reply goes ON the issue first (approval-gated
  // GitHub write), and only a reviewed+confirmed reply becomes an INERT outgoing
  // draft. No send — that boundary needs a separate credential (ADR 0010) and
  // stays human.
  const { replyOnIssue, confirmReplyDraft } = createMailReplyDraftService({
    state, now, nextId, appendEvent, persistStateSoon, store,
    validateApprovalToken, repoCwd: defaultProjectPath,
  });

  // #1147 (ADR 0014): the send gate — the exfiltration boundary, executable
  // only for a review-confirmed draft under flag + write-credential Application
  // + credential readiness + single-use grant. The completion fold and the deny
  // reconcile are late-bound into the invocation runtime above.
  const mailSendService = createMailSendService({
    state, now, nextId, appendEvent, persistStateSoon, store,
    validateApprovalToken,
    createInvocation: (task, agent, options) => createInvocation(task, agent, options),
    startInvocationIfAllowed: (invocation, agent) => startInvocationIfAllowed(invocation, agent),
    findAgent,
    findApplication,
  });
  mailSendHooks = mailSendService;
  const { sendConfirmedDraft } = mailSendService;

  // Ordinary-user mailbox surface. This is a read model over imported mail and
  // a bounded store for user-authored drafts; credentials remain device-local.
  const mailClassificationService = createMailClassificationService({
    state, now, nextId, appendEvent, persistStateSoon: persistMailboxStateSoon, store,
    semanticAdapter: createLocalMailSemanticAdapter({ config: resolveMailSemanticConfig() }),
  });
  const mailFolderSuggestionService = createMailFolderSuggestionService({
    state, now, nextId, persistStateSoon: persistMailboxStateSoon, store,
    classificationService: mailClassificationService,
  });
  const mailFolderOrganizationService = createMailFolderOrganizationService({
    state, now, nextId, appendEvent, persistStateSoon: persistMailboxStateSoon, store,
    folderSuggestionService: mailFolderSuggestionService,
    automaticEnabled: isMailAutomaticOrganizationEnabled,
    qualitySummary: (messages, actor) => mailClassificationService.qualitySummary(messages, actor),
    validateApprovalToken,
    createInvocation: (task, agent, options) => createInvocation(task, agent, options),
    startInvocationIfAllowed: (invocation, agent) => startInvocationIfAllowed(invocation, agent),
    findAgent,
    findApplication,
  });
  const mailboxService = createMailboxService({
    state, now, nextId, appendEvent, persistStateSoon: persistMailboxStateSoon, store,
    mailSendEnabled: isMailSendEnabled,
    mailOrganizeEnabled: isMailOrganizationEnabled,
    mailAutoOrganizeEnabled: isMailAutomaticOrganizationEnabled,
    mailClassificationEnabled: isMailClassificationEnabled,
    createCapabilityInvocation,
    createWorkItem: workItemService.createWorkItem,
    inspectTaskMaterialDraft: taskMaterialService.getDraft,
    classificationService: mailClassificationService,
    folderSuggestionService: mailFolderSuggestionService,
    folderOrganizationService: mailFolderOrganizationService,
    mailQueryIndex,
  });
  mailFolderOrganizationHooks = {
    ...mailFolderOrganizationService,
    onMailImported: ({ ownerTeamId, accountId, triggerId, messages }) => {
      const organization = mailboxService.runFolderAutomations({ teamId: ownerTeamId, accountId, triggerId });
      const taskPolicies = mailboxService.evaluateImportedTaskPolicies({ teamId: ownerTeamId, accountId, triggerId, messages });
      return { organization, taskPolicies };
    },
  };
  mailBodyPrefetchHooks = mailboxService;
  mailboxService.backfillBodyPrefetch();
  const mailBodyPrefetchTimer = setInterval(() => mailboxService.sweepBodyPrefetch(), 2_000);
  mailBodyPrefetchTimer.unref?.();

  // Channel Registry (S2, #1090/ADR 0012): owner-team-scoped channel lifecycle
  // + fail-closed identity mappings. Readiness is env-presence booleans; enable
  // is approval-gated like every other side-effecting action. Import denials
  // (S3) go through the refuse() chokepoint like every other veto.
  let ilinkRuntime = null;
  const channelService = createChannelService({
    state, now, nextId, appendEvent, persistStateSoon, store, validateApprovalToken, refuse,
    readinessProbes: {
      ...defaultReadinessProbes,
      wechat_ilink: (channel) => ilinkRuntime?.readiness(channel) ?? { account: false, session: false, worker: false },
    },
  });

  // Conversation execution (S4): imported events dispatch into GOVERNED
  // capability invocations — fail-closed identity, channel allowlist, taint,
  // correlation. The gateway gets the composed import→dispatch pipeline.
  // /task enters the SAME local Work Item service as the single-terminal Entry.
  // GitHub/GitLab/Gitea bindings remain optional synchronization edges; Channel
  // intake never needs an external tracker in order to become queued local work.
  const inferChannelTaskDomain = (text) => {
    const value = String(text ?? "").toLowerCase();
    if (/(代码|开发|修复|bug|接口|部署|测试|仓库|分支|编译|程序)/i.test(value)) return "development";
    if (/(界面设计|交互设计|产品设计|网页设计|应用设计|原型图|线框图|组件层级|页面流程|\b(?:ui|ux|product design|app design|web design|mockup|wireframe|prototype)\b)/i.test(value)) return "product_design";
    if (/(视觉设计|平面设计|品牌设计|海报|封面|配色|排版|设计稿|效果图|图标|插画|logo|宣传图|横幅|缩略图|\b(?:poster|visual design|graphic design|illustration|banner|thumbnail|logo)\b)/i.test(value)) return "creative";
    if (/(文章|图片|视频|音频|配图|短视频|公众号|小红书|素材|脚本|剪辑|创作)/i.test(value)) return "content";
    if (/(报价|客户|订单|发货|物流|汇款|付款|收款|采购|库存|合同|报销|邮件|表格|对账)/i.test(value)) return "office";
    return "general";
  };
  const inferChannelTaskRiskLevel = (text, operationIntent = null) => {
    const value = String(text ?? "").toLowerCase();
    if (operationIntent?.accessMode === "read_only") return "low";
    if (/(汇款|付款|支付|转账|收款账户|银行卡)/i.test(value)) return "financial";
    if (/(删除|清空|覆盖|批量修改|销毁)/i.test(value)) return "destructive";
    if (/(发送给|发给客户|对外发送|发布|发货|提交订单)/i.test(value)) return "external_communication";
    if (/(修改|编辑|生成|导出|部署|合并|提交代码|改写|剪辑)/i.test(value)) return "local_change";
    return "low";
  };
  const buildChannelExecutionPreview = ({
    title, description, riskLevel, operationIntent = null, inputAssets = [], projectId = null, ownerTeamId = null,
  }) => {
    const text = String(description ?? title ?? "").replace(/\s+/g, " ").trim();
    const targetMatch = text.match(/(?:发给|发送给|发布到|提交给|通知)\s*([^，,。；;！!？?]+)/i);
    const payeeMatch = text.match(/(?:给|转给|汇给|付款给)\s*([^，,。；;！!？?]+)/i);
    const amountMatch = text.match(/(?:金额|汇款|付款|支付)\s*(?:为|：|:)??\s*([¥￥]?\s*\d+(?:\.\d+)?\s*(?:元|人民币|美元|USD|CNY)?)/i);
    const scopeMatch = text.match(/(?:删除|清空|覆盖|批量修改|销毁)\s*([^，,。；;！!？?]+)/i);
    const target = targetMatch?.[1]?.trim() || payeeMatch?.[1]?.trim() || null;
    const amount = amountMatch?.[1]?.replace(/\s+/g, " ").trim() || null;
    const scope = scopeMatch?.[1]?.trim() || null;
    const action = operationIntent?.accessMode === "read_only"
      ? "只读查看或分析"
      : ({
      external_communication: "对外发送或发布",
      financial: "财务操作",
      destructive: "删除、覆盖或批量修改",
      local_change: "修改本地内容",
      low: "整理、分析或咨询",
      }[riskLevel] ?? "任务处理");
    const inputs = inputAssets.slice(0, 20).map((asset) => ({
      name: asset?.originalName ?? asset?.name ?? String(asset?.path ?? "").replaceAll("\\", "/").split("/").at(-1) ?? "附件",
      family: asset?.family ?? "file",
    }));
    const hasContent = inputs.length > 0
      || /(报价|报价单|报告|通知|邮件|合同|文件|图片|视频|文章|内容|附件)/i.test(text);
    const unknownFields = [];
    const requiredFields = [];
    const sourceDependentOfficeTask = /(?:整理|汇总|合并|转换|导入|提取|核对|清洗|统计|登记|更新|修改|补全|处理).{0,24}(?:资料|数据|反馈|台账|表格|工作簿|报价|订单|合同|发货|回款|售后|客户|名单|报表)|(?:资料|数据|反馈|台账|表格|工作簿|报价|订单|合同|发货|回款|售后|客户|名单|报表).{0,24}(?:整理|汇总|合并|转换|导入|提取|核对|清洗|统计|登记|更新|修改|补全|处理)/i.test(text);
    const explicitlyBlankTemplate = /(?:空白|新建|从零|模板|示例).{0,12}(?:台账|表格|工作簿|报表)|(?:台账|表格|工作簿|报表).{0,12}(?:空白|新建|从零|模板|示例)/i.test(text);
    if (sourceDependentOfficeTask && !explicitlyBlankTemplate && inputs.length === 0) {
      unknownFields.push("要处理的原始文件");
      requiredFields.push("请上传原始 CSV/Excel 文件，或说明文件在当前项目中的位置");
    }
    if (riskLevel === "external_communication") {
      if (!target) {
        unknownFields.push("收件人或发布位置");
        requiredFields.push("收件人或发布位置");
      }
      if (!hasContent) {
        unknownFields.push("最终发送内容或附件");
        requiredFields.push("最终发送内容或附件");
      } else {
        unknownFields.push("最终发送内容和附件");
      }
    } else if (riskLevel === "financial") {
      if (!amount) {
        unknownFields.push("金额");
        requiredFields.push("金额");
      }
      if (!target) {
        unknownFields.push("收款方");
        requiredFields.push("收款方");
      }
      unknownFields.push("付款账户");
      requiredFields.push("付款账户");
    } else if (riskLevel === "destructive") {
      if (!scope) {
        unknownFields.push("具体删除或覆盖范围");
        requiredFields.push("具体删除或覆盖范围");
      }
      unknownFields.push("是否需要保留备份");
    }
    const objectValidation = resolveChannelObjectRequests({
      state,
      projectId,
      ownerTeamId,
      text,
      riskLevel,
      inputAssets,
    });
    const objectRequiredFields = riskLevel === "external_communication" || riskLevel === "financial" || riskLevel === "destructive"
      ? objectValidation.requiredFields
      : [];
    for (const field of objectRequiredFields) {
      if (!requiredFields.includes(field)) requiredFields.push(field);
      if (!unknownFields.includes(field)) unknownFields.push(field);
    }
    const preview = {
      schemaVersion: 1,
      action,
      target: target || "尚未明确",
      targetStatus: target ? "inferred" : "unknown",
      amount,
      scope,
      inputs,
      impact: operationIntent?.accessMode === "read_only"
        ? "只读取现有内容，不创建、修改、删除、移动或重命名文件"
        : riskLevel === "financial"
        ? "可能产生资金或财务数据变更"
        : riskLevel === "destructive"
          ? "可能覆盖或删除已有数据"
          : riskLevel === "external_communication"
            ? "可能向外部对象发送或发布内容"
            : "主要影响本地任务产物",
      unknownFields,
      requiredFields,
      previewReady: requiredFields.length === 0,
      objectValidation: channelObjectValidationSummary(objectValidation),
    };
    const previewDigest = createHash("sha256").update(JSON.stringify({
      riskLevel,
      goal: text,
      preview,
    })).digest("hex");
    return { ...preview, digest: previewDigest };
  };
  const attachDataRelationConfirmation = ({ workItem, dataPlan, dataRelationPreview, channelId, requestId = null, threadId = null, mode }) => {
    if (!workItem || dataRelationPreview?.status !== "ready" || !(dataRelationPreview.relations ?? []).length) return null;
    state.channelDataRelationConfirmations ??= [];
    const existing = state.channelDataRelationConfirmations.find((record) =>
      record.workItemId === workItem.id && record.status === "verified");
    if (existing) return existing;
    const timestamp = now();
    const record = {
      id: nextId("drc"),
      schemaVersion: 1,
      ownerTeamId: workItem.ownerTeamId ?? workItem.teamId ?? LOCAL_TEAM_ID,
      projectId: workItem.projectId,
      channelId,
      channelTaskRequestId: requestId,
      threadId,
      workItemId: workItem.id,
      status: "verified",
      confirmationMode: mode === "user_confirmation" ? "user_confirmation" : "runtime_verified",
      planDigest: dataPlan?.digest ?? null,
      relationDigest: dataRelationPreview.digest ?? null,
      objectSnapshot: (dataRelationPreview.objectSnapshot ?? []).slice(0, 2_000),
      objectSnapshotCount: (dataRelationPreview.objectSnapshot ?? []).length,
      confirmedAt: timestamp,
      confirmedBy: typeof workItem.createdBy === "string"
        ? workItem.createdBy
        : workItem.createdBy?.userId ?? null,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    state.channelDataRelationConfirmations.push(record);
    workItem.channelTaskContract.dataRelationConfirmation = {
      schemaVersion: 1,
      id: record.id,
      status: record.status,
      confirmationMode: record.confirmationMode,
      planDigest: record.planDigest,
      relationDigest: record.relationDigest,
      objectSnapshotCount: record.objectSnapshotCount,
      confirmedAt: record.confirmedAt,
      confirmedBy: record.confirmedBy,
    };
    appendEvent?.({
      invocationId: null,
      type: "channel_data_relation_verified",
      level: "info",
      message: `Channel data relation verified for ${workItem.localRef ?? workItem.id}.`,
      data: {
        channelId,
        channelTaskRequestId: requestId,
        threadId,
        workItemId: workItem.id,
        confirmationId: record.id,
        confirmationMode: record.confirmationMode,
        objectSnapshotCount: record.objectSnapshotCount,
      },
    });
    return record;
  };
  function channelLedgerEvidence(definition, actor) {
    const artifact = (state.workflowArtifacts ?? [])
      .filter((candidate) => candidate.ownerTeamId === (actor?.teamId ?? LOCAL_TEAM_ID)
        && candidate.projectId === definition?.projectId
        && candidate.sourceId === definition?.sourceId
        && candidate.availability === "available"
        && candidate.exclusion !== true)
      .find((candidate) => basename(String(candidate.relativePath ?? "")).toLocaleLowerCase()
        === basename(String(definition?.relativePath ?? "")).toLocaleLowerCase());
    return artifact?.id ? [{ artifactId: artifact.id, field: null }] : [];
  }

  async function prepareChannelLedgerMutation({
    text, projectId, dataMutationPreview, dataMutationBinding, dataMutationBindings = [], actor,
  } = {}) {
    if (!dataMutationPreview || dataMutationPreview.status === "not_required") {
      return { ok: false, reason: "not_required" };
    }
    const requestedBindings = dataMutationBindings.length
      ? dataMutationBindings
      : dataMutationBinding ? [dataMutationBinding] : [];
    if (!requestedBindings.length) {
      return { ok: false, reason: "binding_required" };
    }
    const currentBindings = requestedBindings.map((binding) => {
      const current = channelMutationBindingService.resolveBinding({
        projectId,
        fileSourceId: binding.fileSourceId,
      }, actor);
      return current.ok && current.binding.id === binding.id ? current : null;
    });
    if (currentBindings.some((binding) => !binding)) {
      return { ok: false, reason: "binding_stale" };
    }
    const definitions = currentBindings.map((binding) => binding.definition);
    const isBatch = String(text ?? "").split(/[；;]/).filter((clause) => clause.trim()).length > 1;
    if (isBatch) {
      const policy = dataMutationPreview.templatePolicy;
      if (!policy || !policy.allowMultipleRows
        || (definitions.length > 1 && !policy.allowMultipleSources)) {
        return { ok: false, reason: "mutation_policy_batch_not_allowed" };
      }
      const parsedPlan = parseLedgerMutationPlan(text, definitions);
      if (!parsedPlan.ok) return { ok: false, reason: parsedPlan.reason };
      const operations = [];
      const identities = [];
      for (const parsed of parsedPlan.operations) {
        const currentBinding = currentBindings.find((binding) => binding.definition.id === parsed.definition.id);
        const source = currentBinding.source;
        const targetIdentity = await ledgerUpsertService.inspectTargetIdentity({
          ledgerDefinitionId: parsed.definition.id,
        }, actor);
        if (targetIdentity.status !== 200) {
          return { ok: false, reason: targetIdentity.body?.error ?? "ledger_target_identity_unavailable" };
        }
        if (!source?.contentHash || source.contentHash !== targetIdentity.body.identity.contentHash) {
          return {
            ok: false,
            reason: "channel_mutation_source_identity_mismatch",
            details: {
              fileSourceId: source?.id ?? null,
              expectedContentHash: source?.contentHash ?? null,
              actualContentHash: targetIdentity.body.identity.contentHash,
            },
          };
        }
        const sourceEvidence = channelLedgerEvidence(parsed.definition, actor);
        if (!sourceEvidence.length) return { ok: false, reason: "source_evidence_required" };
        operations.push({
          ledgerDefinitionId: parsed.definition.id,
          businessKey: parsed.businessKey,
          fields: parsed.fields,
          sourceEvidence,
          allowPartialUpdate: true,
        });
        identities.push(targetIdentity.body.identity);
      }
      const result = await ledgerUpsertService.previewBatchUpsert({ operations }, actor);
      if (![200, 201, 202].includes(result.status)) {
        return { ok: false, reason: result.body?.error ?? "ledger_batch_preview_failed", details: result.body ?? null };
      }
      return {
        ok: true,
        batch: true,
        parsedPlan,
        preview: result.body?.batchPreview ?? null,
        targetIdentities: identities,
        replayed: result.body?.replayed === true,
      };
    }
    const currentBinding = currentBindings[0];
    const definition = currentBinding.definition;
    const source = currentBinding.source;
    const targetIdentity = await ledgerUpsertService.inspectTargetIdentity({
      ledgerDefinitionId: definition.id,
    }, actor);
    if (targetIdentity.status !== 200) {
      return {
        ok: false,
        reason: targetIdentity.body?.error ?? "ledger_target_identity_unavailable",
        details: targetIdentity.body ?? null,
      };
    }
    if (!source?.contentHash || source.contentHash !== targetIdentity.body.identity.contentHash) {
      return {
        ok: false,
        reason: "channel_mutation_source_identity_mismatch",
        details: {
          fileSourceId: source?.id ?? dataMutationBinding.fileSourceId,
          expectedContentHash: source?.contentHash ?? null,
          actualContentHash: targetIdentity.body.identity.contentHash,
          targetRevision: targetIdentity.body.identity.targetRevision,
        },
      };
    }
    const parsed = parseSingleRecordLedgerMutation(text, definition);
    if (!parsed.ok) {
      return {
        ok: false,
        reason: parsed.reason,
        fieldHint: channelLedgerMutationFieldHint(definition),
      };
    }
    const sourceEvidence = channelLedgerEvidence(definition, actor);
    if (!sourceEvidence.length) return { ok: false, reason: "source_evidence_required" };
    const result = await ledgerUpsertService.previewUpsert({
      ledgerDefinitionId: definition.id,
      businessKey: parsed.businessKey,
      fields: parsed.fields,
      sourceEvidence,
      allowPartialUpdate: true,
    }, actor);
    if (![200, 201, 202].includes(result.status)) {
      return {
        ok: false,
        reason: result.body?.error ?? "ledger_preview_failed",
        details: result.body ?? null,
      };
    }
    return {
      ok: true,
      parsed,
      preview: result.body?.preview ?? null,
      targetIdentity: targetIdentity.body.identity,
      replayed: result.body?.replayed === true,
    };
  };

  async function refreshChannelMutationSourcesAfterCommit(bindings = [], actor = null) {
    const refreshed = [];
    const failures = [];
    for (const binding of bindings) {
      if (!binding?.fileSourceId || !binding?.ledgerDefinitionId) continue;
      const identity = await ledgerUpsertService.inspectTargetIdentity({
        ledgerDefinitionId: binding.ledgerDefinitionId,
      }, actor);
      if (identity.status !== 200 || !identity.body?.identity?.contentHash) {
        failures.push({
          fileSourceId: binding.fileSourceId,
          ledgerDefinitionId: binding.ledgerDefinitionId,
          reason: identity.body?.error ?? "channel_mutation_source_refresh_failed",
        });
        continue;
      }
      const synced = channelMutationBindingService.refreshSourceIdentity({
        fileSourceId: binding.fileSourceId,
        contentHash: identity.body.identity.contentHash,
      }, actor);
      if (!synced.ok) failures.push({ ...synced, fileSourceId: binding.fileSourceId });
      else refreshed.push(synced.source);
    }
    if (failures.length) {
      appendEvent?.({
        invocationId: null,
        type: "channel_mutation_source_refresh_failed",
        level: "warn",
        message: "Channel Ledger write committed, but the local source snapshot needs refresh.",
        data: { failures },
      });
    }
    return { refreshed, failures };
  }
  const createChannelTaskIssue = async ({
    projectId, channelOwnerTeamId, title, description, channelId, externalUserId,
    injectionSuspicious = false, autoRoute = false, inputAssets = [], terminalId,
    channelTaskContext, fileDiscoveries = [], threadId = null, idempotencyKey = null, dataMutationScope = null,
  }) => {
    const project = (state.projects ?? []).find((p) => p.id === projectId);
    if (!project) return { ok: false, reason: "project_not_resolvable" };
    // Use-time tenancy re-check: reject a binding that has since drifted to a
    // different team (a project's ownerTeamId is mutable on re-registration).
    if ((project.ownerTeamId ?? LOCAL_TEAM_ID) !== (channelOwnerTeamId ?? LOCAL_TEAM_ID)) {
      return { ok: false, reason: "project_team_drift" };
    }
    const principal = (state.users ?? []).find((user) => user.id === channelTaskContext?.principalId);
    if (!principal || (principal.teamId ?? LOCAL_TEAM_ID) !== (channelOwnerTeamId ?? LOCAL_TEAM_ID)) {
      return { ok: false, reason: "channel_principal_invalid" };
    }
    const workItemActor = { userId: principal.id, teamId: principal.teamId, role: "member", deviceId: terminalId };
    const assisted = typeof workItemService.suggestWorkItemDraft === "function"
      ? workItemService.suggestWorkItemDraft({ projectId, title, body: description, inputAssets }, workItemActor)
      : null;
    const assistedDraft = assisted?.ok ? assisted.body?.draft ?? null : null;
    const selectedTemplate = assistedDraft?.templateMatch?.selected ?? null;
    const selectedDefinition = selectedTemplate
      ? (state.routineDefinitions ?? []).find((definition) => definition.id === selectedTemplate.definitionId)
      : null;
    const operationIntent = analyzeChannelOperationIntent(`${title}\n${description}`);
    const templateMatch = selectedTemplate ? {
      state: assistedDraft.templateMatch.state,
      decision: assistedDraft.templateMatch.decision?.reason ?? assistedDraft.templateMatch.decision?.kind ?? null,
      definitionId: selectedTemplate.definitionId,
      familyId: selectedTemplate.templateId,
      version: selectedTemplate.version,
      reasons: selectedTemplate.reasons ?? [],
    } : {
      state: assistedDraft?.templateMatch?.state ?? "missing",
      decision: assistedDraft?.templateMatch?.decision?.reason ?? assistedDraft?.templateMatch?.decision?.kind ?? null,
      definitionId: null,
      familyId: null,
      version: null,
      reasons: [],
    };
    const templateDataPlan = buildRuntimeDataPlan({
      state,
      projectId,
      ownerTeamId: channelOwnerTeamId ?? LOCAL_TEAM_ID,
      dataRequirements: selectedDefinition?.dataRequirements ?? [],
      relations: selectedDefinition?.relations ?? [],
      mutationPolicy: selectedDefinition?.mutationPolicy ?? null,
    });
    const attachmentDataPlan = buildAttachmentDataPlan({
      discoveries: channelTaskContext?.fileDiscoveries ?? fileDiscoveries,
      attachments: inputAssets,
    });
    const dataPlan = selectedDefinition
      ? templateDataPlan
      : attachmentDataPlan.status !== "not_required"
        ? attachmentDataPlan
        : templateDataPlan;
    const dataOperationPreview = dataPlan.origin === "channel_attachment"
      ? await buildChannelDataOperationPreview({
        text: [title, description].join("\n"),
        plan: dataPlan,
        attachments: inputAssets,
        projectPath: project.path,
      })
      : null;
    const dataRelationPreview = buildDataRelationPreview({
      state,
      plan: dataPlan,
      projectId,
      ownerTeamId: channelOwnerTeamId ?? LOCAL_TEAM_ID,
    });
    const paymentRequirements = dataPlan.requirements?.filter((requirement) =>
      ["receivable", "bank_transaction"].includes(requirement.kind),
    ) ?? [];
    let paymentReconciliationPreview = null;
    if (dataPlan.status === "ready"
      && paymentRequirements.some((requirement) => requirement.kind === "receivable")
      && paymentRequirements.some((requirement) => requirement.kind === "bank_transaction")) {
      const sourceIds = new Set(paymentRequirements.map((requirement) => requirement.sourceId).filter(Boolean));
      const objects = (state.channelObjectRecords ?? []).filter((record) =>
        record.ownerTeamId === (channelOwnerTeamId ?? LOCAL_TEAM_ID)
        && record.projectId === projectId
        && sourceIds.has(record.sourceId)
        && ["receivable", "bank_transaction"].includes(record.kind),
      );
      const receivables = objects.filter((record) => record.kind === "receivable");
      const bankTransactions = objects.filter((record) => record.kind === "bank_transaction");
      paymentReconciliationPreview = buildPaymentReconciliationPreview({ receivables, bankTransactions });
      paymentReconciliationPreview.sources = paymentRequirements.map((requirement) => ({
        requirementId: requirement.id,
        kind: requirement.kind,
        sourceId: requirement.sourceId,
        fileName: dataPlan.sources?.find((source) => source.sourceId === requirement.sourceId)?.fileName ?? null,
      }));
      paymentReconciliationPreview.digest = createHash("sha256")
        .update(JSON.stringify(paymentReconciliationPreview))
        .digest("hex");
    }
    let dataMutationPreview = dataPlan.origin === "channel_attachment"
      ? null
      : buildDataMutationPreview({
      state,
      projectId,
      ownerTeamId: channelOwnerTeamId ?? LOCAL_TEAM_ID,
      text: `${title}\n${description}`,
      operationIntent,
      dataPlan,
      dataMutationScope,
      });
    const dataMutationBindings = (dataMutationPreview?.targetSourceIds ?? []).map((fileSourceId) =>
      channelMutationBindingService.resolveBinding({ projectId, fileSourceId }, workItemActor));
    const dataMutationBinding = dataMutationBindings.length === 1
      ? dataMutationBindings[0]
      : dataMutationBindings.length > 1 && dataMutationBindings.every((binding) => binding.ok)
        ? dataMutationBindings[0]
        : { ok: false, reason: "channel_mutation_binding_missing" };
    let ledgerMutationPreview = null;
    let ledgerMutationPreparation = { ok: false, reason: "not_required" };
    if (dataMutationPreview?.status && dataMutationPreview.status !== "not_required"
      && dataMutationBinding.ok
      && dataMutationBindings.length > 0
      && dataMutationBindings.every((binding) => binding.ok)) {
      ledgerMutationPreparation = await prepareChannelLedgerMutation({
        text: description,
        projectId,
        dataMutationPreview,
        dataMutationBinding: dataMutationBinding.binding,
        dataMutationBindings: dataMutationBindings.map((binding) => binding.binding),
        actor: workItemActor,
      });
      if (ledgerMutationPreparation.ok) {
        ledgerMutationPreview = ledgerMutationPreparation.preview;
        if (ledgerMutationPreparation.batch) {
          const operations = ledgerMutationPreparation.parsedPlan.operations;
          const sourceById = new Map((dataMutationPreview.targetSources ?? []).map((source) => [source.sourceId, source]));
          const targets = operations.map((operation) => {
            const binding = dataMutationBindings.find((candidate) =>
              candidate.binding?.ledgerDefinitionId === operation.definition.id)?.binding;
            const source = sourceById.get(binding?.fileSourceId);
            const criteriaDigest = createHash("sha256").update(JSON.stringify(operation.businessKey)).digest("hex");
            return {
              sourceId: binding?.fileSourceId ?? null,
              revision: source?.revision ?? null,
              contentHash: source?.contentHash ?? null,
              selector: {
                field: operation.definition.businessKeyField,
                operator: "equals",
                criteriaDigest,
                matchCount: 1,
                allMatching: false,
              },
              expectedRows: 1,
            };
          });
          const fields = [...new Set(operations.map((operation) => operation.field).filter(Boolean))];
          const batchPolicy = {
            ...(dataMutationPreview.templatePolicy ?? {}),
            requireUserConfirmation: true,
            writeMode: "safe_copy_replace",
          };
          const scoped = {
            ...dataMutationPreview,
            status: "ready",
            targetStatus: "explicit",
            templatePolicy: batchPolicy,
            rowSelector: targets.map((target) => ({ sourceId: target.sourceId, revision: target.revision, ...target.selector })),
            fieldChanges: fields.map((field) => ({ field, operation: "set", valueProvided: true })),
            dataMutationScope: {
              schemaVersion: 1,
              operation: "update",
              targets,
              changes: fields.map((field) => ({ field, operation: "set", valueDigest: null, valueProvided: true })),
              expectedAffectedRows: targets.length,
              allowAllMatching: false,
            },
            estimatedAffectedRows: targets.length,
            requiredFields: [],
            writeMode: "safe_copy_replace",
            executionMode: "ledger_batch",
          };
          scoped.digest = createHash("sha256").update(JSON.stringify({ ...scoped, digest: undefined })).digest("hex");
          dataMutationPreview = scoped;
        } else {
        const parsed = ledgerMutationPreparation.parsed;
        const targetSource = dataMutationPreview.targetSources?.find((source) =>
          source.sourceId === dataMutationPreview.targetSourceIds?.[0]);
        const keyField = dataMutationBinding.definition?.businessKeyField ?? null;
        const criteriaDigest = createHash("sha256").update(JSON.stringify(parsed.businessKey)).digest("hex");
        const valueDigest = createHash("sha256").update(JSON.stringify(parsed.fields[parsed.field])).digest("hex");
        const singleRecordPolicy = {
          operations: ["update"],
          targetRequirementIds: [],
          keyFields: keyField ? [keyField] : [],
          mutableFields: [parsed.field],
          allowMultipleSources: false,
          allowMultipleRows: false,
          maxRows: 1,
          requireUserConfirmation: true,
          writeMode: "safe_copy_replace",
        };
        const scoped = {
          ...dataMutationPreview,
          status: "ready",
          targetStatus: "explicit",
          templatePolicy: singleRecordPolicy,
          rowSelector: [{
            sourceId: targetSource?.sourceId ?? dataMutationPreview.targetSourceIds?.[0] ?? null,
            revision: targetSource?.revision ?? null,
            field: keyField,
            operator: "equals",
            criteriaDigest,
            matchCount: 1,
            allMatching: false,
          }],
          fieldChanges: [{
            field: parsed.field,
            operation: "set",
            valueDigest: createHash("sha256").update(JSON.stringify(parsed.fields[parsed.field])).digest("hex"),
            valueProvided: true,
          }],
          dataMutationScope: {
            schemaVersion: 1,
            operation: "update",
            targets: [{
              sourceId: targetSource?.sourceId ?? dataMutationPreview.targetSourceIds?.[0] ?? null,
              revision: targetSource?.revision ?? null,
              contentHash: targetSource?.contentHash ?? null,
              selector: {
                field: keyField,
                operator: "equals",
                criteriaDigest,
                matchCount: 1,
                allMatching: false,
              },
              expectedRows: 1,
            }],
            changes: [{
              field: parsed.field,
              operation: "set",
              valueDigest,
              valueProvided: true,
            }],
            expectedAffectedRows: 1,
            allowAllMatching: false,
          },
          estimatedAffectedRows: 1,
          requiredFields: [],
          writeMode: "safe_copy_replace",
          executionMode: "ledger_single_record",
        };
        scoped.digest = createHash("sha256").update(JSON.stringify({ ...scoped, digest: undefined })).digest("hex");
        dataMutationPreview = scoped;
        }
      }
    }
    // A matched receivable/bank-transaction template is a read-only
    // reconciliation, not a payment instruction. Keep “汇款/付款” wording
    // from accidentally routing it through the financial side-effect gate.
    const riskLevel = paymentReconciliationPreview
      ? "low"
      : inferChannelTaskRiskLevel(`${title}\n${description}`, operationIntent);
    const executionStrategy = selectChannelExecutionStrategy({
      goal: `${title}\n${description}`,
      selectedTemplate,
      selectedDefinition,
      dataPlan,
      dataMutationPreview,
      ledgerMutationPreview,
      paymentReconciliationPreview,
      operationIntent,
      riskLevel,
      generatedAt: now(),
    });
    const executionPreview = buildChannelExecutionPreview({
      title,
      description,
      riskLevel,
      operationIntent,
      inputAssets,
      projectId,
      ownerTeamId: channelOwnerTeamId ?? LOCAL_TEAM_ID,
    });
    if (executionStrategy.strategy === "blocked") {
      executionPreview.unknownFields = [...new Set([
        ...(executionPreview.unknownFields ?? []),
        "尚未匹配到可复用的安全文件操作",
      ])].slice(0, 10);
      executionPreview.requiredFields = [...new Set([
        ...(executionPreview.requiredFields ?? []),
        "请先确认文件字段、记录定位方式和允许的修改范围",
      ])].slice(0, 10);
      executionPreview.previewReady = false;
    }
    const dataLabels = dataPlanMissingLabels(dataPlan);
    if (dataLabels.length) {
      executionPreview.unknownFields = [...new Set([
        ...(executionPreview.unknownFields ?? []),
        `数据来源：${dataLabels.join("、")}`,
      ])].slice(0, 10);
      executionPreview.requiredFields = [...new Set([
        ...(executionPreview.requiredFields ?? []),
        ...dataLabels.map((label) => `数据来源：${label}`),
      ])].slice(0, 10);
      executionPreview.previewReady = false;
    }
    if (dataRelationPreview.status === "needs_review") {
      executionPreview.unknownFields = [...new Set([
        ...(executionPreview.unknownFields ?? []),
        "数据关联结果需要复核",
      ])].slice(0, 10);
      executionPreview.requiredFields = [...new Set([
        ...(executionPreview.requiredFields ?? []),
        "数据关联结果确认",
      ])].slice(0, 10);
      executionPreview.previewReady = false;
    }
    if (dataOperationPreview?.status && dataOperationPreview.status !== "ready") {
      executionPreview.unknownFields = [...new Set([
        ...(executionPreview.unknownFields ?? []),
        dataOperationPreview.status === "stale" ? "文件在执行前发生变化" : "只读数据预览尚未准备好",
      ])].slice(0, 10);
      executionPreview.requiredFields = [...new Set([
        ...(executionPreview.requiredFields ?? []),
        dataOperationPreview.status === "stale" ? "请重新上传最新文件" : "请补充可读取的数据文件",
      ])].slice(0, 10);
      executionPreview.previewReady = false;
    }
    if (dataMutationPreview?.status && dataMutationPreview.status !== "not_required") {
      if (ledgerMutationPreview) {
        executionPreview.unknownFields = [...new Set([
          ...(executionPreview.unknownFields ?? []),
          ledgerMutationPreparation.batch ? "批量文件变更等待确认" : "单条文件变更等待确认",
        ])].slice(0, 10);
      } else {
        executionPreview.unknownFields = [...new Set([
          ...(executionPreview.unknownFields ?? []),
          "文件变更范围需要复核",
        ])].slice(0, 10);
        executionPreview.requiredFields = [...new Set([
          ...(executionPreview.requiredFields ?? []),
          ...dataMutationPreview.requiredFields,
        ])].slice(0, 10);
        executionPreview.previewReady = false;
      }
      if (dataMutationPreview.status === "ready" && !dataMutationBinding.ok) {
        executionPreview.requiredFields = [...new Set([
          ...(executionPreview.requiredFields ?? []),
          "需要在桌面端为该文件配置安全写回规则",
        ])].slice(0, 10);
      }
      if (!ledgerMutationPreview && dataMutationBinding.ok) {
        const reason = ledgerMutationPreparation.reason;
        const reasonText = reason === "source_evidence_required"
          ? "需要先扫描并确认 Ledger 文件来源"
          : reason === "mutable_field_required"
            ? "需要明确要修改的字段"
            : reason === "business_key_required"
              ? "需要明确唯一记录编号"
          : reason === "new_value_required"
                ? "需要明确修改后的新值"
          : reason === "ledger_field_transition_not_allowed"
                ? "当前状态不允许直接跳转到这个状态，请按业务流程先完成前置步骤"
          : reason === "ledger_insert_not_allowed"
                ? "没有找到对应的现有记录；当前模板只允许修改已有记录，请先导入或建立这条业务记录"
          : reason === "single_record_only"
            ? "当前 Channel 只支持单条记录更新，暂不执行批量或删除操作"
            : reason === "mutation_policy_batch_not_allowed"
              ? "当前任务模板未允许多记录或多文件变更，请先调整模板边界"
              : reason === "batch_file_scope_required"
                ? "批量变更时请在每一段中写明文件名，例如：customers.csv …；orders.csv …"
            : "需要补充单条记录的修改表达，例如：把文件里的 1001 的客户改成 Acme";
        // Preserve the Ledger parser's concrete refusal on the user-facing
        // data preview as well. Otherwise an unknown business key falls back
        // to a generic "please specify the file" prompt and hides the fact
        // that the template deliberately refuses implicit inserts.
        dataMutationPreview = {
          ...dataMutationPreview,
          requiredFields: [...new Set([...(dataMutationPreview.requiredFields ?? []), reasonText])].slice(0, 10),
        };
        executionPreview.requiredFields = [...new Set([
          ...(executionPreview.requiredFields ?? []),
          reasonText,
        ])].slice(0, 10);
      }
    }
    executionPreview.digest = createHash("sha256").update(JSON.stringify({
      riskLevel,
      goal: description,
      operationIntent,
      preview: executionPreview,
      dataPlanDigest: dataPlan.digest,
    })).digest("hex");
    const workMode = buildWorkModeSnapshot({
      goal: description,
      outputExpectation: selectedTemplate?.expectedOutput ?? null,
      selectedTemplate,
      templateMatch: assistedDraft?.templateMatch ?? null,
      selectedDefinition,
      dataPlan,
      dataRelationPreview,
      dataMutationPreview,
      riskLevel,
      executionPreview,
      generatedAt: now(),
    });
    const channelTaskContract = {
      schemaVersion: 1,
      source: "channel",
      domain: inferChannelTaskDomain(`${title}\n${description}`),
      riskLevel,
      goal: description,
      operationIntent,
      outputExpectation: selectedTemplate?.expectedOutput ?? null,
      dataSources: inputAssets.slice(0, 100).map((asset) => ({
        kind: "channel_attachment",
        id: asset?.id ?? null,
        name: asset?.originalName ?? asset?.name ?? String(asset?.path ?? "").replaceAll("\\", "/").split("/").at(-1) ?? null,
        version: asset?.version ?? null,
        hash: asset?.hash ?? null,
      })),
      fileDiscoveries: (channelTaskContext?.fileDiscoveries ?? fileDiscoveries).slice(0, 20),
      templateMatch,
      workMode,
      dataPlan,
      dataOperationPreview,
      dataRelationPreview,
      paymentReconciliationPreview,
      dataMutationPreview,
      executionStrategy,
      dataMutationBinding: dataMutationBinding.ok ? dataMutationBinding.binding : null,
      dataMutationBindings: dataMutationBindings.filter((binding) => binding.ok).map((binding) => binding.binding),
      ledgerMutationPreview,
      ledgerMutationPreparation: {
        ok: ledgerMutationPreparation.ok === true,
        reason: ledgerMutationPreparation.reason ?? null,
      },
      executionPreview,
      // Keep the normalized object snapshot at the contract level as well as
      // inside the human-readable preview so route-time revalidation survives
      // contract normalization and old read models can inspect it directly.
      generatedAt: now(),
    };
    channelTaskContract.objectValidation = channelTaskContract.executionPreview.objectValidation;
    // Personal channels are self-operated, but external side effects still
    // need an explicit second confirmation. Team channels keep the existing
    // administrator route and therefore do not use this in-channel gate.
    const requiresChannelConfirmation = autoRoute
      && ["external_communication", "financial", "destructive"].includes(channelTaskContract.riskLevel);
    const requiresDataPlan = ["needs_sources", "ambiguous", "stale"].includes(dataPlan.status);
    const requiresDataReview = dataRelationPreview.status === "needs_review";
    const requiresDataOperationReview = ["stale", "needs_sources", "blocked"].includes(dataOperationPreview?.status);
    const requiresDataMutationReview = Boolean(dataMutationPreview?.status && dataMutationPreview.status !== "not_required");
    const requiresExecutionStrategyReview = executionStrategy.strategy === "blocked";
    const requiresExecutionInput = executionPreview.previewReady === false
      && !requiresDataPlan
      && !requiresDataReview
      && !requiresDataOperationReview
      && !requiresDataMutationReview
      && !requiresExecutionStrategyReview;
    const effectiveAutoRoute = autoRoute
      && executionPreview.previewReady === true
      && executionStrategy.safeToAutoRoute
      && !requiresChannelConfirmation
      && !requiresDataPlan
      && !requiresDataReview
      && !requiresDataOperationReview
      && !requiresDataMutationReview
      && !requiresExecutionStrategyReview;
    let directReadOnlyResult = null;
    if (effectiveAutoRoute) {
      try {
        directReadOnlyResult = executeChannelReadonlyLocalOperation({
          text: description,
          operationIntent,
          project,
          readProjectTree,
          completedAt: now(),
        });
      } catch {
        // A fast read is an optimization, never a weaker fallback. If the
        // confined tree reader cannot complete, retain the governed Agent path.
        directReadOnlyResult = null;
      }
    }
    const myTemplateBinding = selectedTemplate && assistedDraft?.templateMatch?.decision?.kind === "auto_apply"
      ? {
        definitionId: selectedTemplate.definitionId,
        familyId: selectedTemplate.templateId,
        version: selectedTemplate.version,
        matchReasons: selectedTemplate.reasons ?? [],
      }
      : undefined;
    const created = workItemService.createWorkItem({
      projectId,
      title,
      body: description,
      type: "task",
      status: directReadOnlyResult ? "done" : effectiveAutoRoute ? "ready" : "backlog",
      // The Channel thread and the work-item scheduler must agree about who
      // starts the task.  Leaving this as `inherit` made projects without the
      // optional project-wide auto-execution flag look queued in WeChat while
      // the scheduler correctly treated the work item as manual forever.
      executionPolicy: directReadOnlyResult || effectiveAutoRoute ? "auto" : "manual",
      waitingOn: directReadOnlyResult ? "none" : effectiveAutoRoute ? "ai" : "none",
      priority: "p3",
      labels: ["channel", UNTRUSTED_INPUT_LABEL, ...(injectionSuspicious ? ["needs-triage"] : [])],
      inputAssets,
      requiredCapabilities: [],
      ...(assistedDraft?.acceptanceCriteria?.length ? { acceptanceCriteria: assistedDraft.acceptanceCriteria } : {}),
      ...(assistedDraft?.verificationSop?.length ? { verificationSop: assistedDraft.verificationSop } : {}),
      ...(myTemplateBinding ? { myTemplateBinding } : {}),
      channelTaskContract,
      idempotencyKey: idempotencyKey ?? `channel:${channelId}:${channelTaskContext?.messageId ?? "unknown"}`,
    }, workItemActor);
    if (!created.ok) return { ok: false, reason: created.body?.error ?? "work_item_create_failed" };
    const workItem = created.body.workItem;
    const storedWorkItem = (state.workItems ?? []).find((candidate) => candidate.id === workItem.id);
    let attachedDataRelationConfirmation = null;
    if (storedWorkItem) {
      storedWorkItem.channelOrigin = {
        channelId,
        conversationId: channelTaskContext?.conversationId ?? null,
        messageId: channelTaskContext?.messageId ?? null,
        principalId: principal.id,
        traceId: workItem.id,
        threadId,
      };
      if (effectiveAutoRoute && dataRelationPreview.status === "ready") {
        attachDataRelationConfirmation({
          workItem: storedWorkItem,
          dataPlan,
          dataRelationPreview,
          channelId,
          threadId,
          mode: "runtime_verified",
        });
      }
      attachedDataRelationConfirmation = storedWorkItem.channelTaskContract?.dataRelationConfirmation ?? null;
      if (paymentReconciliationPreview) {
        const verification = workItemService.recordVerification({
          workItemId: storedWorkItem.id,
          expectedRevision: storedWorkItem.revision,
          kind: "manual",
          status: "passed",
          summary: "已按本地应收与银行流水文件完成只读对账，差异已列出，未修改原始文件。",
          acceptanceResults: (storedWorkItem.acceptanceCriteria ?? []).map((criterion) => ({
            criterion,
            status: "passed",
            note: "对账预览已生成并保留来源文件与结果摘要。",
          })),
          evidence: [{
            kind: "log",
            ref: `payment-reconciliation:${paymentReconciliationPreview.digest}`,
            summary: "Read-only payment reconciliation result",
          }],
        }, workItemActor);
        if (verification.ok) {
          workItemService.updateWorkItem({
            workItemId: storedWorkItem.id,
            expectedRevision: verification.body.workItem.revision,
            status: "done",
          }, workItemActor);
        }
      }
      if (directReadOnlyResult) {
        workItemService.recordVerification({
          workItemId: storedWorkItem.id,
          expectedRevision: storedWorkItem.revision,
          kind: "automatic",
          status: "passed",
          summary: directReadOnlyResult.summary,
          acceptanceResults: (storedWorkItem.acceptanceCriteria ?? []).map((criterion) => ({
            criterion,
            status: "passed",
            note: "已通过受控的本地项目文件读取能力完成，只读取文件名且未修改项目。",
          })),
          evidence: [{
            kind: "log",
            ref: `channel-readonly:${storedWorkItem.id}`,
            summary: `Local project tree returned ${directReadOnlyResult.resultCount} file(s).`,
          }],
        }, workItemActor);
      }
    }
    return {
      ok: true,
      number: workItem.localNumber,
      localRef: workItem.localRef,
      workItemId: workItem.id,
      url: `/?section=tasks&workItem=${encodeURIComponent(workItem.id)}`,
      replayed: Boolean(created.body.replayed),
      autoRoute: effectiveAutoRoute,
      directCompleted: Boolean(directReadOnlyResult),
      directReadOnlyResult,
      requiresChannelConfirmation,
      requiresDataPlan,
      requiresDataReview,
      requiresDataOperationReview,
      riskLevel: channelTaskContract.riskLevel,
      operationIntent: channelTaskContract.operationIntent,
      workMode: channelTaskContract.workMode,
      executionPreview: channelTaskContract.executionPreview,
      dataPlan: channelTaskContract.dataPlan,
      dataOperationPreview: channelTaskContract.dataOperationPreview,
      dataRelationPreview: channelTaskContract.dataRelationPreview,
      paymentReconciliationPreview: channelTaskContract.paymentReconciliationPreview,
      dataMutationPreview: channelTaskContract.dataMutationPreview,
      dataMutationBinding: channelTaskContract.dataMutationBinding,
      dataMutationBindings: channelTaskContract.dataMutationBindings,
      ledgerMutationPreview: channelTaskContract.ledgerMutationPreview,
      dataRelationConfirmation: attachedDataRelationConfirmation ?? channelTaskContract.dataRelationConfirmation ?? null,
      requiresDataMutationReview,
      requiresExecutionStrategyReview,
      requiresExecutionInput,
      executionStrategy: channelTaskContract.executionStrategy,
      previewDigest: channelTaskContract.executionPreview.digest,
      previewReady: channelTaskContract.executionPreview.previewReady,
      objectValidation: channelTaskContract.executionPreview.objectValidation,
    };
  };

  // Human promotion of a captured /task request (the capture-then-promote trust
  // model). Route → start a tracked auto-run now; Dismiss → close the issue.
  // Both are same-team gated on the request's channel and never throw.
  const channelTaskRunTx = makeRunTx({ store, persistStateSoon });
  const findPendingChannelTask = (id, actor) => {
    const req = (state.channelTaskRequests ?? []).find((r) => r.id === id && r.status === "pending");
    if (!req) return null;
    const channel = (state.channels ?? []).find((c) => c.id === req.channelId);
    if (!channel) return null;
    if (actor?.teamId != null && (channel?.ownerTeamId ?? LOCAL_TEAM_ID) !== actor.teamId) return null; // opaque 404
    return req;
  };
  const routeChannelTask = async (id, actor) => {
    const req = findPendingChannelTask(id, actor);
    if (!req) return { status: 404, body: { error: "channel_task_not_found" } };
    if (req.workItemId) {
      const item = (state.workItems ?? []).find((candidate) => candidate.id === req.workItemId);
      if (!item) return { status: 404, body: { error: "work_item_not_found" } };
      const requestChannel = (state.channels ?? []).find((candidate) => candidate.id === req.channelId);
      const storedDataMutationPreview = item.channelTaskContract?.dataMutationPreview ?? null;
      const storedLedgerMutationPreview = item.channelTaskContract?.ledgerMutationPreview ?? null;
      const storedExecutionStrategy = item.channelTaskContract?.executionStrategy ?? null;
      if (storedExecutionStrategy?.strategy === "blocked") {
        return {
          status: 409,
          body: {
            error: "channel_task_execution_strategy_required",
            executionStrategy: storedExecutionStrategy,
            requiredFields: item.channelTaskContract?.executionPreview?.requiredFields ?? [],
          },
        };
      }
      const isReadyLocalMutation = storedDataMutationPreview?.status === "ready"
        && Boolean(storedLedgerMutationPreview);
      const storedValidation = item.channelTaskContract?.executionPreview?.objectValidation ?? null;
      // Object validation is required for an external recipient/account/etc.
      // It is not a prerequisite for a local Ledger writeback: the file
      // source, row selector, fields, versions and batch digest are validated
      // by the data-mutation path below. This also prevents words like
      // “发货” from turning an explicitly scoped local file change into a
      // false “missing external order object” refusal.
      if (storedValidation && !isReadyLocalMutation) {
        const channel = (state.channels ?? []).find((candidate) => candidate.id === req.channelId);
        const currentValidation = resolveChannelObjectRequests({
          state,
          projectId: item.projectId ?? req.projectId,
          ownerTeamId: channel?.ownerTeamId ?? req.channelTaskContext?.ownerTeamId ?? actor?.teamId ?? LOCAL_TEAM_ID,
          text: item.channelTaskContract?.goal ?? item.body ?? item.title,
          riskLevel: item.channelTaskContract?.riskLevel ?? req.riskLevel ?? "low",
          inputAssets: item.inputAssets ?? req.inputAssets ?? [],
        });
        const currentSummary = channelObjectValidationSummary(currentValidation);
        if (currentValidation.state !== "verified") {
          return {
            status: 409,
            body: {
              error: "channel_task_object_validation_required",
              objectValidation: currentSummary,
              requiredFields: currentSummary.requiredFields,
            },
          };
        }
        if (!channelObjectValidationMatches(storedValidation, currentSummary)) {
          return {
            status: 409,
            body: {
              error: "channel_task_object_validation_changed",
              objectValidation: currentSummary,
            },
          };
        }
      }
      const storedDataPlan = item.channelTaskContract?.dataPlan ?? null;
      const storedDataOperationPreview = item.channelTaskContract?.dataOperationPreview ?? null;
      if (storedDataPlan) {
        const channel = (state.channels ?? []).find((candidate) => candidate.id === req.channelId);
        const currentPlan = dataPlanMatchesCurrent({
          state,
          plan: storedDataPlan,
          projectId: item.projectId ?? req.projectId,
          ownerTeamId: channel?.ownerTeamId ?? req.channelTaskContext?.ownerTeamId ?? actor?.teamId ?? LOCAL_TEAM_ID,
          inputAssets: item.inputAssets ?? req.inputAssets ?? [],
        });
        if (currentPlan.ok && storedDataPlan.origin === "channel_attachment") {
          const project = (state.projects ?? []).find((candidate) => candidate.id === (item.projectId ?? req.projectId));
          const assetsById = new Map((item.inputAssets ?? req.inputAssets ?? [])
            .filter((asset) => asset?.id)
            .map((asset) => [String(asset.id), asset]));
          const checks = await Promise.all((storedDataPlan.sources ?? []).map(async (source) => {
            const asset = assetsById.get(String(source.sourceId));
            if (!asset || !project?.path) return { ok: false, sourceId: source.sourceId, reason: "attachment_binding_missing" };
            const discovery = await discoverChannelFileAsset({
              asset,
              projectPath: project.path,
              projectId: project.id,
            });
            return {
              ok: discovery.status === "ready" && discovery.contentHash === source.fingerprint,
              sourceId: source.sourceId,
              reason: discovery.status === "ready" ? "attachment_hash_changed" : discovery.reason,
            };
          }));
          const changed = checks.filter((check) => !check.ok);
          if (changed.length) {
            return {
              status: 409,
              body: {
                error: "channel_task_data_plan_changed",
                dataPlan: { ...storedDataPlan, status: "stale" },
                changedSources: changed.slice(0, 10),
              },
            };
          }
        }
        if (!currentPlan.ok && ["needs_sources", "ambiguous", "stale"].includes(currentPlan.current?.status)) {
          return {
            status: 409,
            body: {
              error: "channel_task_data_plan_required",
              dataPlan: currentPlan.current,
            },
          };
        }
        if (!currentPlan.ok) {
          return {
            status: 409,
            body: {
              error: "channel_task_data_plan_changed",
              dataPlan: currentPlan.current,
            },
          };
        }
      }
      if (storedDataOperationPreview && storedDataOperationPreview.status !== "ready") {
        return {
          status: 409,
          body: {
            error: "channel_task_data_operation_preview_required",
            dataOperationPreview: storedDataOperationPreview,
          },
        };
      }
      const storedDataRelationPreview = item.channelTaskContract?.dataRelationPreview ?? null;
      if (storedDataRelationPreview && storedDataPlan) {
        const channel = (state.channels ?? []).find((candidate) => candidate.id === req.channelId);
        const currentPlan = dataPlanMatchesCurrent({
          state,
          plan: storedDataPlan,
          projectId: item.projectId ?? req.projectId,
          ownerTeamId: channel?.ownerTeamId ?? req.channelTaskContext?.ownerTeamId ?? actor?.teamId ?? LOCAL_TEAM_ID,
          inputAssets: item.inputAssets ?? req.inputAssets ?? [],
        });
        const currentRelationPreview = dataRelationPreviewMatchesCurrent({
          state,
          preview: storedDataRelationPreview,
          plan: currentPlan.current ?? storedDataPlan,
          projectId: item.projectId ?? req.projectId,
          ownerTeamId: channel?.ownerTeamId ?? req.channelTaskContext?.ownerTeamId ?? actor?.teamId ?? LOCAL_TEAM_ID,
        });
        if (!currentRelationPreview.ok && currentRelationPreview.current.status === "needs_review") {
          return {
            status: 409,
            body: {
              error: "channel_task_data_relation_required",
              dataRelationPreview: currentRelationPreview.current,
            },
          };
        }
        if (!currentRelationPreview.ok) {
          return {
            status: 409,
            body: {
              error: "channel_task_data_relation_changed",
              dataRelationPreview: currentRelationPreview.current,
            },
          };
        }
      }
      if (storedDataMutationPreview && storedDataMutationPreview.status !== "not_required") {
        const channel = (state.channels ?? []).find((candidate) => candidate.id === req.channelId);
        const currentMutationPreview = dataMutationPreviewMatchesCurrent({
          state,
          preview: storedDataMutationPreview,
          projectId: item.projectId ?? req.projectId,
          ownerTeamId: channel?.ownerTeamId ?? req.channelTaskContext?.ownerTeamId ?? actor?.teamId ?? LOCAL_TEAM_ID,
        });
        if (!currentMutationPreview.ok) {
          return {
            status: 409,
            body: {
              error: "channel_task_data_mutation_changed",
              dataMutationPreview: currentMutationPreview.current,
            },
          };
        }
        if (currentMutationPreview.current.status !== "ready") {
          return {
            status: 409,
            body: {
              error: "channel_task_data_mutation_required",
              dataMutationPreview: currentMutationPreview.current,
            },
          };
        }
        const storedMutationBinding = item.channelTaskContract?.dataMutationBinding ?? null;
        if (!storedMutationBinding) {
          return {
            status: 409,
            body: { error: "channel_task_data_mutation_binding_required" },
          };
        }
        const currentMutationBinding = channelMutationBindingService.resolveBinding({
          projectId: item.projectId ?? req.projectId,
          fileSourceId: storedMutationBinding.fileSourceId,
        }, actor);
        if (!currentMutationBinding.ok || currentMutationBinding.binding.id !== storedMutationBinding.id) {
          return {
            status: 409,
            body: {
              error: "channel_task_data_mutation_binding_changed",
              dataMutationBinding: currentMutationBinding.binding ?? null,
            },
          };
        }
        if (currentMutationPreview.current.writeMode !== "safe_copy_replace") {
          return {
            status: 409,
            body: {
              error: "channel_task_data_mutation_executor_unavailable",
              dataMutationPreview: currentMutationPreview.current,
            },
          };
        }
      }
      if (storedLedgerMutationPreview) {
        if (requestChannel?.operationMode !== "personal") {
          return {
            status: 409,
            body: { error: "channel_task_mutation_personal_confirmation_required" },
          };
        }
        const committed = storedLedgerMutationPreview.kind === "batch"
          ? await ledgerUpsertService.commitBatchPreview({
            batchPreviewId: storedLedgerMutationPreview.id,
            expectedRevision: storedLedgerMutationPreview.revision,
            approved: true,
          }, actor)
          : await ledgerUpsertService.commitPreview({
            previewId: storedLedgerMutationPreview.id,
            expectedRevision: storedLedgerMutationPreview.revision,
            approved: true,
          }, actor);
        if (committed.status !== 200) {
          return {
            status: committed.status,
            body: {
              ...(committed.body ?? { error: "ledger_mutation_commit_failed" }),
              dataMutationPreview: storedDataMutationPreview,
              ledgerMutationPreview: committed.body?.batchPreview ?? committed.body?.preview ?? storedLedgerMutationPreview,
            },
          };
        }
        const sourceRefresh = await refreshChannelMutationSourcesAfterCommit(
          item.channelTaskContract?.dataMutationBindings
            ?? (item.channelTaskContract?.dataMutationBinding ? [item.channelTaskContract.dataMutationBinding] : []),
          actor,
        );
        const verified = workItemService.recordVerification({
          workItemId: item.id,
          expectedRevision: item.revision,
          kind: "manual",
          status: "passed",
          summary: storedLedgerMutationPreview.kind === "batch"
            ? "Ledger 批量安全写回已完成，文件版本和批次审计记录已生成。"
            : "Ledger 安全写回已完成，文件版本和审计记录已生成。",
          acceptanceResults: (item.acceptanceCriteria ?? []).map((criterion) => ({
            criterion,
            status: "passed",
            note: "已由 Ledger 原子写回结果验证。",
          })),
          evidence: [{
            kind: "log",
            ref: `ledger-mutation:${committed.body?.mutation?.id ?? committed.body?.batchPreview?.id ?? storedLedgerMutationPreview.id}`,
            summary: "Ledger mutation audit record",
          }],
        }, actor);
        if (!verified.ok) return { status: verified.status, body: verified.body };
        const completed = workItemService.updateWorkItem({
          workItemId: item.id,
          expectedRevision: item.revision,
          status: "done",
        }, actor);
        if (!completed.ok) return { status: completed.status, body: completed.body };
        channelTaskRunTx(() => {
          req.status = "completed";
          req.decidedAt = now();
          req.decidedBy = actor?.userId ?? null;
          req.mutationId = committed.body?.mutation?.id ?? null;
          const thread = (state.channelTaskThreads ?? []).find((candidate) =>
            candidate.workItemId === req.workItemId || candidate.id === req.threadId);
          if (thread) {
            thread.waitingFor = null;
            thread.resultSummary = storedLedgerMutationPreview.kind === "batch"
              ? `已安全写回 ${committed.body?.batchPreview?.operationCount ?? storedLedgerMutationPreview.operationCount ?? "批量"} 条记录，相关文件版本已更新。`
              : `已安全写回 ${committed.body?.mutation?.changedFields?.join("、") || "指定字段"}，文件版本已更新。`;
            thread.statusHistory = [...(thread.statusHistory ?? []), {
              status: "succeeded",
              reason: "channel_mutation_committed",
              at: now(),
            }].slice(-30);
            thread.status = "succeeded";
            thread.lastActivityAt = now();
            thread.updatedAt = now();
          }
        });
        appendEvent({
          invocationId: null,
          type: "channel_task_mutation_committed",
          level: "info",
          message: `Channel task ${req.id} committed a Ledger mutation.`,
          data: {
            channelTaskRequestId: req.id,
            workItemId: req.workItemId,
            mutationId: committed.body?.mutation?.id ?? null,
            batchPreviewId: storedLedgerMutationPreview.kind === "batch" ? storedLedgerMutationPreview.id : null,
            previewId: storedLedgerMutationPreview.kind === "batch" ? null : storedLedgerMutationPreview.id,
          },
        });
        return {
          status: 200,
          body: {
            ok: true,
            workItemId: req.workItemId,
            localRef: req.localRef ?? null,
            dataMutationCommitted: true,
            mutation: committed.body?.mutation ?? null,
            mutations: committed.body?.results ?? null,
            ledgerMutationPreview: committed.body?.batchPreview ?? committed.body?.preview ?? null,
            sourceRefresh,
          },
        };
      }
      const updated = workItemService.updateWorkItem({
        workItemId: item.id,
        expectedRevision: item.revision,
        status: "ready",
      }, actor);
      if (!updated.ok) return { status: updated.status, body: updated.body };
      channelTaskRunTx(() => {
        attachDataRelationConfirmation({
          workItem: item,
          dataPlan: storedDataPlan,
          dataRelationPreview: storedDataRelationPreview,
          channelId: req.channelId,
          requestId: req.id,
          threadId: req.threadId ?? null,
          mode: "user_confirmation",
        });
        req.status = "routed";
        req.decidedAt = now();
        req.decidedBy = actor?.userId ?? null;
        const thread = (state.channelTaskThreads ?? []).find((candidate) => candidate.workItemId === req.workItemId || candidate.id === req.threadId);
        if (thread) {
          thread.statusHistory = [...(thread.statusHistory ?? []), { status: "queued", reason: "console_routed", at: now() }].slice(-30);
          thread.status = "queued";
          thread.waitingFor = null;
          thread.expiresAt = new Date(Date.parse(now()) + 24 * 60 * 60 * 1000).toISOString();
          thread.lastActivityAt = now();
          thread.updatedAt = now();
        }
      });
      appendEvent({
        invocationId: null,
        type: "channel_task_routed",
        level: "info",
        message: `Channel task ${req.id} routed → ${req.localRef ?? req.workItemId}.`,
        data: { channelTaskRequestId: req.id, workItemId: req.workItemId, localRef: req.localRef ?? null },
      });
      return {
        status: 200,
        body: {
          ok: true,
          workItemId: req.workItemId,
          localRef: req.localRef ?? null,
          dataMutationPreview: item.channelTaskContract?.dataMutationPreview ?? null,
          dataRelationConfirmation: item.channelTaskContract?.dataRelationConfirmation ?? null,
        },
      };
    }
    const origin = { channelId: req.channelId, conversationId: req.conversationId, channelTaskRequestId: req.id, threadId: req.threadId ?? null, externalUserId: req.externalUserId ?? null, issueNumber: req.issueNumber };
    let result;
    let error;
    try {
      result = await startAutoRun({
        projectId: req.projectId,
        link: { type: "issue", number: req.issueNumber, title: req.title, url: req.issueUrl, state: "open" },
        actor,
        channelOrigin: origin,
      });
    } catch (e) {
      error = String(e?.message ?? e);
    }
    const autoRun = result?.autoRun ?? null;
    const autoRunId = autoRun?.id ?? null;
    if (!autoRunId) {
      return { status: 409, body: { error: "route_failed", reason: error ?? result?.reason ?? "auto_run_not_started" } };
    }
    // Backlink both ways: the request points at its auto-run (autoRunId), and the
    // auto-run carries its channel ORIGIN — so evidence/audit and the console can
    // tie the run (and its actions) back to the originating channel, conversation,
    // and untrusted sender without a manual issue-number join.
    channelTaskRunTx(() => {
      req.status = "routed";
      req.autoRunId = autoRunId;
      req.decidedAt = now();
      req.decidedBy = actor?.userId ?? null;
      autoRun.channelOrigin = origin;
      // If the run already has an invocation, correlate it to the conversation so
      // in-channel /result /cancel /status reach it, and stamp the same untrusted
      // taint + channel metadata the /run path carries.
      const invocation = result?.invocation ?? null;
      if (invocation?.id) {
        invocation.options = invocation.options ?? {};
        invocation.options.metadata = {
          ...invocation.options.metadata,
          channel: { channelId: req.channelId, conversationId: req.conversationId, channelTaskRequestId: req.id, threadId: req.threadId ?? null },
          riskTags: [...new Set([...(invocation.options.metadata?.riskTags ?? []), UNTRUSTED_INPUT_TAG])],
        };
        const conv = (state.channelConversations ?? []).find((c) => c.id === req.conversationId);
        if (conv) conv.invocationIds = [...new Set([...(conv.invocationIds ?? []), invocation.id])];
      }
      const thread = (state.channelTaskThreads ?? []).find((candidate) => candidate.workItemId === req.workItemId || candidate.id === req.threadId);
      if (thread) {
        thread.autoRunId = autoRunId;
        thread.invocationId = invocation?.id ?? autoRun.invocationId ?? thread.invocationId ?? null;
        thread.statusHistory = [...(thread.statusHistory ?? []), { status: "queued", reason: "console_routed", at: now() }].slice(-30);
        thread.status = "queued";
        thread.waitingFor = null;
        thread.expiresAt = new Date(Date.parse(now()) + 24 * 60 * 60 * 1000).toISOString();
        thread.lastActivityAt = now();
        thread.updatedAt = now();
      }
    });
    if (result?.invocation) channelThreadHook?.(result.invocation);
    appendEvent({ invocationId: null, type: "channel_task_routed", level: "info", message: `Channel task ${req.id} routed → auto-run ${autoRunId}.`, data: { channelTaskRequestId: req.id, issueNumber: req.issueNumber, autoRunId } });
    return { status: 200, body: { ok: true, autoRunId, issueNumber: req.issueNumber } };
  };
  const syncDismissedChannelTask = (req, actor, { notifyUser = true } = {}) => {
    const thread = (state.channelTaskThreads ?? []).find((candidate) =>
      (req.workItemId && candidate.workItemId === req.workItemId)
      || (req.threadId && candidate.id === req.threadId));
    if (!thread) return;
    channelTaskRunTx(() => {
      thread.statusHistory = [...(thread.statusHistory ?? []), { status: "cancelled", reason: "console_dismissed", at: now() }].slice(-30);
      thread.status = "cancelled";
      thread.waitingFor = null;
      thread.resultSummary = "管理员已忽略此任务，未开始执行。";
      thread.expiresAt = null;
      thread.updatedAt = now();
      thread.lastActivityAt = now();
    });
    if (notifyUser) {
      channelDeliveryService.enqueueChannelDelivery({
        channelId: thread.channelId,
        conversationId: thread.conversationId,
        content: "任务已被管理员忽略，未开始执行。",
        taskContext: { channelId: thread.channelId, conversationId: thread.conversationId, threadId: thread.id, workItemId: thread.workItemId ?? null, traceId: thread.workItemId ?? thread.id },
      });
    }
    appendEvent({
      invocationId: null,
      type: "channel_task_dismissed_user_notified",
      level: "info",
      message: `Channel task ${thread.shortRef ?? thread.id} dismissal was sent to the user.`,
      data: { channelId: thread.channelId, conversationId: thread.conversationId, threadId: thread.id, channelTaskRequestId: req.id, actorId: actor?.userId ?? null },
    });
  };

  const dismissChannelTask = async (id, actor, { notifyUser = true } = {}) => {
    const req = findPendingChannelTask(id, actor);
    if (!req) return { status: 404, body: { error: "channel_task_not_found" } };
    if (req.workItemId) {
      const item = (state.workItems ?? []).find((candidate) => candidate.id === req.workItemId);
      if (!item) return { status: 404, body: { error: "work_item_not_found" } };
      const transitioned = workItemService.transitionWorkItem({
        workItemId: item.id,
        expectedRevision: item.revision,
        action: "archive",
      }, actor);
      if (!transitioned.ok) return { status: transitioned.status, body: transitioned.body };
      channelTaskRunTx(() => {
        req.status = "dismissed";
        req.decidedAt = now();
        req.decidedBy = actor?.userId ?? null;
      });
      syncDismissedChannelTask(req, actor, { notifyUser });
      appendEvent({
        invocationId: null,
        type: "channel_task_dismissed",
        level: "info",
        message: `Channel task ${req.id} dismissed (${req.localRef ?? req.workItemId} archived).`,
        data: { channelTaskRequestId: req.id, workItemId: req.workItemId, localRef: req.localRef ?? null },
      });
      return { status: 200, body: { ok: true, workItemId: req.workItemId } };
    }
    const project = (state.projects ?? []).find((p) => p.id === req.projectId);
    if (project?.path && Number.isFinite(req.issueNumber)) {
      await runIssueClose({ cwd: project.path, issueNumber: req.issueNumber, comment: "Dismissed from the console — not routed to work." }).catch(() => {});
    }
    channelTaskRunTx(() => {
      req.status = "dismissed";
      req.decidedAt = now();
      req.decidedBy = actor?.userId ?? null;
    });
    syncDismissedChannelTask(req, actor, { notifyUser });
    appendEvent({ invocationId: null, type: "channel_task_dismissed", level: "info", message: `Channel task ${req.id} dismissed (issue #${req.issueNumber} closed).`, data: { channelTaskRequestId: req.id, issueNumber: req.issueNumber } });
    return { status: 200, body: { ok: true } };
  };
  const findOwnChannelTask = (id, actor) => {
    const req = (state.channelTaskRequests ?? []).find((item) => item.id === id);
    if (!req) return null;
    const channel = (state.channels ?? []).find((item) => item.id === req.channelId);
    if (!channel) return null;
    if (actor?.teamId != null && (channel?.ownerTeamId ?? LOCAL_TEAM_ID) !== actor.teamId) return null;
    return req;
  };
  const retryChannelTask = async (id, actor) => {
    const req = findOwnChannelTask(id, actor);
    const autoRun = req?.autoRunId ? (state.autoRuns ?? []).find((item) => item.id === req.autoRunId) : null;
    if (!req || req.status !== "routed" || !autoRun) return { status: 404, body: { error: "channel_task_not_found" } };
    try {
      const result = await retryAutoRun(autoRun.id, { actor });
      channelTaskRunTx(() => { req.lastAction = "retry"; req.lastActionAt = now(); req.lastActionBy = actor?.userId ?? null; });
      return { status: 200, body: { ok: true, autoRunId: autoRun.id, invocationId: result.invocation.id } };
    } catch (error) {
      return { status: 409, body: { error: "channel_task_retry_failed", reason: String(error?.message ?? error) } };
    }
  };
  const rerouteChannelTask = async (id, actor) => {
    const req = findOwnChannelTask(id, actor);
    const autoRun = req?.autoRunId ? (state.autoRuns ?? []).find((item) => item.id === req.autoRunId) : null;
    if (!req || req.status !== "routed" || !autoRun) return { status: 404, body: { error: "channel_task_not_found" } };
    const previousInvocationId = autoRun.invocationId ?? null;
    const rerouted = await attemptFailover(autoRun);
    if (!rerouted) return { status: 409, body: { error: "channel_task_reroute_unavailable", reason: autoRun.failoverOutcome?.status ?? "no_eligible_agent" } };
    channelTaskRunTx(() => { req.lastAction = "reroute"; req.lastActionAt = now(); req.lastActionBy = actor?.userId ?? null; });
    return { status: 200, body: { ok: true, autoRunId: autoRun.id, previousInvocationId, invocationId: autoRun.invocationId } };
  };
  const takeoverChannelTask = async (id, actor) => {
    const req = findOwnChannelTask(id, actor);
    const autoRun = req?.autoRunId ? (state.autoRuns ?? []).find((item) => item.id === req.autoRunId) : null;
    if (!req || req.status !== "routed" || !autoRun) return { status: 404, body: { error: "channel_task_not_found" } };
    const activeStatuses = ["materializing", "running", "waiting_capacity", "verifying", "publishing", "awaiting_approval"];
    if (![...activeStatuses, "failed", "blocked"].includes(autoRun.status)) {
      return { status: 409, body: { error: "channel_task_takeover_unavailable", reason: `run_${autoRun.status}` } };
    }
    if (activeStatuses.includes(autoRun.status)) {
      try { cancelAutoRun(autoRun.id, { actor }); } catch (error) {
        return { status: 409, body: { error: "channel_task_takeover_failed", reason: String(error?.message ?? error) } };
      }
    }
    channelTaskRunTx(() => {
      req.status = "human_takeover";
      req.lastAction = "takeover";
      req.lastActionAt = now();
      req.lastActionBy = actor?.userId ?? null;
      const thread = (state.channelTaskThreads ?? []).find((candidate) =>
        (req.workItemId && candidate.workItemId === req.workItemId)
        || (req.threadId && candidate.id === req.threadId));
      if (thread && thread.status !== "human_takeover") {
        thread.statusHistory = [...(thread.statusHistory ?? []), { status: "human_takeover", reason: "console_takeover", at: now() }].slice(-30);
        thread.status = "human_takeover";
        thread.waitingFor = "human";
        thread.handoffRequestedAt = now();
        thread.handoffRequestedBy = actor?.userId ?? null;
        thread.resultSummary = "已转人工跟进。";
        thread.expiresAt = null;
        thread.lastActivityAt = now();
        thread.updatedAt = now();
      }
    });
    appendEvent({ invocationId: autoRun.invocationId ?? null, type: "channel_task_human_takeover", level: "warn", message: `Channel task ${req.id} moved to human takeover.`, data: { channelTaskRequestId: req.id, autoRunId: autoRun.id } });
    alertOutbox.enqueue({
      kind: "channel_human_takeover",
      severity: "warning",
      message: `Channel task ${req.id} requires human attention.`,
      data: {
        teamId: (state.channels ?? []).find((channel) => channel.id === req.channelId)?.ownerTeamId ?? LOCAL_TEAM_ID,
        channelId: req.channelId,
        conversationId: req.conversationId,
        threadId: req.threadId ?? null,
        workItemId: req.workItemId ?? null,
        channelTaskRequestId: req.id,
        autoRunId: autoRun.id,
        reason: "console_takeover",
      },
    });
    return { status: 200, body: { ok: true, autoRunId: autoRun.id, status: req.status } };
  };

  const replyChannelTask = (id, content, actor) => {
    const ref = String(id ?? "").trim();
    const text = String(content ?? "").trim().slice(0, 4_000);
    if (!text) return { status: 400, body: { error: "channel_task_reply_required" } };
    const request = (state.channelTaskRequests ?? []).find((candidate) => candidate.id === ref) ?? null;
    const thread = (state.channelTaskThreads ?? []).find((candidate) =>
      candidate.id === ref
      || String(candidate.shortRef ?? "").toUpperCase() === ref.toUpperCase()
      || (request?.threadId && candidate.id === request.threadId)
      || (request?.workItemId && candidate.workItemId === request.workItemId)) ?? null;
    if (!thread) return { status: 404, body: { error: "channel_task_not_found" } };
    const channel = (state.channels ?? []).find((candidate) => candidate.id === thread.channelId);
    if (!channel || (actor?.teamId != null && (channel.ownerTeamId ?? LOCAL_TEAM_ID) !== actor.teamId)) {
      return { status: 404, body: { error: "channel_task_not_found" } };
    }
    if (thread.status !== "human_takeover") {
      return { status: 409, body: { error: "channel_task_reply_unavailable", reason: `thread_${thread.status}` } };
    }
    const queued = channelDeliveryService.enqueueChannelDelivery({
      channelId: thread.channelId,
      conversationId: thread.conversationId,
      content: text,
      taskContext: {
        channelId: thread.channelId,
        conversationId: thread.conversationId,
        threadId: thread.id,
        workItemId: thread.workItemId ?? null,
        traceId: thread.workItemId ?? thread.id,
      },
    });
    if (!queued?.ok) return { status: 409, body: { error: "channel_task_reply_enqueue_failed", reason: queued?.reason ?? "delivery_unavailable" } };
    channelTaskRunTx(() => {
      thread.lastHumanReplyAt = now();
      thread.lastHumanReplyBy = actor?.userId ?? null;
      thread.resultSummary = "人工已回复用户，等待后续消息。";
      thread.statusHistory = [...(thread.statusHistory ?? []), { status: "human_takeover", reason: "human_reply", at: now() }].slice(-30);
      thread.updatedAt = now();
      if (request) {
        request.lastAction = "human_reply";
        request.lastActionAt = now();
        request.lastActionBy = actor?.userId ?? null;
      }
    });
    appendEvent({
      invocationId: null,
      type: "channel_task_human_reply",
      level: "info",
      message: `Channel task ${thread.shortRef ?? thread.id} received a human reply.`,
      data: { channelId: thread.channelId, conversationId: thread.conversationId, threadId: thread.id, channelTaskRequestId: request?.id ?? null, deliveryId: queued.deliveryId },
    });
    return { status: 200, body: { ok: true, deliveryId: queued.deliveryId, threadId: thread.id } };
  };

  let channelReplySender = null;
  let channelResendDelivery = null;
  let channelDeliveryService = null;
  let channelNotificationService = null;
  const recordChannelIntentBridgeMetric = ({ status, latencyMs, circuitOpen, circuitOpenUntil, failureStreak, circuitTrips } = {}) => {
    const current = state.channelIntentMetrics ?? {
      total: 0,
      byIntent: {},
      bySource: {},
      lowConfidence: 0,
      ambiguous: 0,
      updatedAt: null,
    };
    const bridge = current.bridge ?? {
      attempts: 0,
      succeeded: 0,
      failed: 0,
      busy: 0,
      timeouts: 0,
      lastLatencyMs: null,
      averageLatencyMs: null,
      circuitOpen: false,
      circuitOpenUntil: null,
      failureStreak: 0,
      circuitTrips: 0,
      updatedAt: null,
    };
    bridge.attempts = Number(bridge.attempts ?? 0) + 1;
    if (status === "succeeded") bridge.succeeded = Number(bridge.succeeded ?? 0) + 1;
    else if (status === "busy") bridge.busy = Number(bridge.busy ?? 0) + 1;
    else {
      bridge.failed = Number(bridge.failed ?? 0) + 1;
      if (status === "timeout") bridge.timeouts = Number(bridge.timeouts ?? 0) + 1;
    }
    bridge.circuitOpen = Boolean(circuitOpen);
    bridge.circuitOpenUntil = circuitOpenUntil ?? null;
    bridge.failureStreak = Number(failureStreak ?? bridge.failureStreak ?? 0);
    bridge.circuitTrips = Number(circuitTrips ?? bridge.circuitTrips ?? 0);
    if (Number.isFinite(Number(latencyMs))) {
      const previous = Number(bridge.averageLatencyMs);
      bridge.lastLatencyMs = Math.round(Number(latencyMs));
      bridge.averageLatencyMs = Number.isFinite(previous)
        ? Math.round((previous * (bridge.attempts - 1) + Number(latencyMs)) / bridge.attempts)
        : Math.round(Number(latencyMs));
    }
    bridge.updatedAt = now();
    state.channelIntentMetrics = { ...current, bridge, updatedAt: current.updatedAt ?? null };
    persistStateSoon();
  };
  const channelConsultationAdapter = createChannelConsultationAdapter({
    config: resolveChannelConsultationConfig(),
    state,
    findAgent,
    createInvocation: (...args) => invocationService?.createInvocation(...args),
    now,
  });
  const trackChannelKnowledgeCaptureTask = ({ thread, channel, conversation, event, urls = [], items = [] } = {}) => {
    if (!thread?.id || !channel?.id || !conversation?.id) {
      return { ok: false, reason: "channel_knowledge_task_context_required" };
    }
    const ownerTeamId = channel.ownerTeamId ?? LOCAL_TEAM_ID;
    const project = (state.projects ?? []).find((candidate) => candidate.id === channel.taskProjectId)
      ?? (state.projects ?? []).find((candidate) =>
        (candidate.ownerTeamId ?? LOCAL_TEAM_ID) === ownerTeamId && candidate.hiddenFromNavigation !== true)
      ?? null;
    if (!project || (project.ownerTeamId ?? LOCAL_TEAM_ID) !== (channel.ownerTeamId ?? LOCAL_TEAM_ID)) {
      return { ok: false, reason: "channel_knowledge_task_project_unavailable" };
    }
    const identity = (state.channelIdentities ?? []).find((candidate) =>
      candidate.channelId === channel.id && candidate.externalUserId === thread.externalUserId) ?? null;
    const principal = identity?.userId
      ? (state.users ?? []).find((candidate) => candidate.id === identity.userId) ?? null
      : null;
    if (!principal || (principal.teamId ?? LOCAL_TEAM_ID) !== (channel.ownerTeamId ?? LOCAL_TEAM_ID)) {
      return { ok: false, reason: "channel_knowledge_task_identity_unavailable" };
    }
    const actor = {
      userId: principal.id,
      teamId: principal.teamId ?? LOCAL_TEAM_ID,
      role: "member",
      deviceId: channel.taskTerminalId ?? null,
    };
    const uniqueUrls = [...new Set(urls.map(String).filter(Boolean))].slice(0, 3);
    const locations = [...new Map(items.map((item) => channelKnowledgeService.getItemLocation({
      itemId: item.knowledgeItemId,
      ownerTeamId: channel.ownerTeamId ?? LOCAL_TEAM_ID,
    })).filter(Boolean).map((location) => [location.itemId, location])).values()];
    const managedFileName = (location) => {
      const safeTitle = String(location?.title ?? "本地资料")
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
        .trim()
        .slice(0, 175) || "本地资料";
      return /\.md$/i.test(safeTitle) ? safeTitle : `${safeTitle}.md`;
    };
    const terminal = thread.status === "succeeded" || thread.status === "failed" || thread.status === "cancelled";
    const title = items.length
      ? `保存资料：${String(items.at(-1)?.title ?? "Channel 分享内容").slice(0, 100)}`
      : String(thread.summary ?? "保存 Channel 分享资料").slice(0, 120);
    const body = [
      "从 Channel 接收分享链接，并保存为可检索的本地资料。",
      uniqueUrls.length ? `\n来源链接：\n${uniqueUrls.map((url) => `- ${url}`).join("\n")}` : null,
      terminal ? `\n处理结果：${thread.resultSummary || (thread.status === "succeeded" ? "已保存到本地资料库。" : "本次保存未完成。")}` : "\n处理状态：正在下载、识别并保存正文。",
      locations.length
        ? `\n交付文件：\n${locations.map((location) => `- ${managedFileName(location)}（可在本任务的交付文件中打开）`).join("\n")}`
        : null,
    ].filter(Boolean).join("\n").slice(0, 10_000);
    const desiredStatus = thread.status === "succeeded"
      ? "done"
      : thread.status === "failed" || thread.status === "cancelled"
        ? "blocked"
        : "in_progress";
    const idempotencyKey = `channel-knowledge-thread:${thread.id}`;
    let stored = thread.workItemId
      ? (state.workItems ?? []).find((candidate) => candidate.id === thread.workItemId) ?? null
      : (state.workItems ?? []).find((candidate) =>
        candidate.ownerTeamId === actor.teamId && candidate.createIdempotencyKey === idempotencyKey) ?? null;
    if (!stored) {
      const created = workItemService.createWorkItem({
        projectId: project.id,
        title,
        body,
        type: "task",
        status: desiredStatus,
        executionPolicy: "manual",
        waitingOn: "none",
        priority: "p3",
        labels: ["channel", "knowledge-capture", "local-knowledge", UNTRUSTED_INPUT_LABEL],
        requiredCapabilities: [],
        idempotencyKey,
      }, actor);
      if (!created.ok) return { ok: false, reason: created.body?.error ?? "channel_knowledge_task_create_failed" };
      stored = (state.workItems ?? []).find((candidate) => candidate.id === created.body.workItem.id) ?? null;
    }
    if (!stored) return { ok: false, reason: "channel_knowledge_task_not_found" };
    const managedOutputs = locations.map((location) => {
      return {
        id: `asset_channel_knowledge_${location.itemId}`.slice(0, 100),
        contentId: location.contentId,
        originalName: managedFileName(location),
        path: location.relativePath,
        family: "markdown",
        mimeType: "text/markdown",
        terminalId: stored.terminalId ?? channel.taskTerminalId,
        size: null,
        resourceClass: "small",
        hash: null,
        version: null,
        capabilities: ["discover", "preview", "inspect", "open_external", "attach_evidence"],
        readiness: { state: "ready", reason: "managed_channel_knowledge" },
      };
    }).filter((asset) => asset.terminalId);
    const desiredOutputs = managedOutputs.length
      ? [
        ...(stored.outputAssets ?? []).filter((asset) => !String(asset.id ?? "").startsWith("asset_channel_knowledge_")),
        ...managedOutputs,
      ].slice(0, 100)
      : stored.outputAssets ?? [];
    const workItemNeedsUpdate = stored.title !== title
      || stored.body !== body
      || stored.status !== desiredStatus
      || JSON.stringify(stored.outputAssets ?? []) !== JSON.stringify(desiredOutputs);
    if (workItemNeedsUpdate) {
      const updated = workItemService.updateWorkItem({
        workItemId: stored.id,
        expectedRevision: stored.revision,
        title,
        body,
        status: desiredStatus,
        outputAssets: desiredOutputs,
      }, actor);
      if (!updated.ok) return { ok: false, reason: updated.body?.error ?? "channel_knowledge_task_update_failed" };
      stored = (state.workItems ?? []).find((candidate) => candidate.id === stored.id) ?? stored;
    }
    const originChanged = stored.channelOrigin?.threadId !== thread.id;
    const knowledgeLinksChanged = locations.some((location) => {
      const knowledge = (state.channelKnowledgeItems ?? []).find((item) => item.id === location.itemId);
      return knowledge && knowledge.workItemId !== stored.id;
    });
    if (originChanged || knowledgeLinksChanged) channelTaskRunTx(() => {
      if (originChanged) {
        stored.channelOrigin = {
          channelId: channel.id,
          conversationId: conversation.id,
          messageId: event?.id ?? thread.sourceEventIds?.[0] ?? null,
          principalId: principal.id,
          traceId: stored.id,
          threadId: thread.id,
        };
        stored.revision = Number(stored.revision ?? 0) + 1;
        stored.updatedAt = now();
      }
      for (const location of locations) {
        const knowledge = (state.channelKnowledgeItems ?? []).find((item) => item.id === location.itemId);
        if (knowledge) {
          knowledge.workItemId = stored.id;
          knowledge.updatedAt = now();
        }
      }
    });
    if (terminal && locations.length) {
      void localContentCatalogService.requestAutomaticIncremental({
        reason: "channel_knowledge_capture_completed",
        sources: ["articles", "work_items"],
      }).catch(() => {});
    }
    return { ok: true, workItemId: stored.id, localRef: stored.localRef ?? null };
  };
  const channelConversationService = createChannelConversationService({
    state, now, nextId, appendEvent, refuse, persistStateSoon, store,
    createCapabilityInvocation, cancelInvocation, createChannelTaskIssue, routeChannelTask, dismissChannelTask,
    answerClarify,
    retryAutoRun: async (autoRunId, options) => {
      const run = (state.autoRuns ?? []).find((item) => item.id === autoRunId) ?? null;
      if (run?.status === "failed" && !run.worktreeId && !run.invocationId && run.link?.type === "local_issue") {
        const deferred = deferAutoRunUnderstanding(autoRunId, new Error("Retry requested before execution started."));
        workItemAutoRunUnderstandingService.enqueue(autoRunId);
        try { channelAutoRunHook?.(deferred, { notify: false, reason: "understanding_retry_requested" }); } catch { /* best-effort Channel projection */ }
        return { autoRun: deferred, invocation: null, waitingUnderstanding: true };
      }
      return retryAutoRun(autoRunId, options);
    },
    cancelAutoRun,
    classifyIntent: createChannelIntentAdapter({
      config: resolveChannelIntentConfig(),
      state,
      findAgent,
      createInvocation: (...args) => invocationService?.createInvocation(...args),
      cancelInvocation: (...args) => invocationService?.cancelInvocation(...args),
      now,
      onMetric: recordChannelIntentBridgeMetric,
    })?.classify,
    createConsultation: channelConsultationAdapter?.enqueue,
    trackKnowledgeCaptureTask: trackChannelKnowledgeCaptureTask,
    resolveKnowledgeLocation: (input) => channelKnowledgeService.getItemLocation(input),
    inspectSharedLink: async (input) => {
      if (input.save === false) {
        const inspection = await inspectArticle({
          url: input.url,
          extractorPlugin: resolveArticleExtractor(input.url, input.ownerTeamId ?? LOCAL_TEAM_ID),
        });
        return { ...inspection, knowledge: { status: "preview" } };
      }
      try {
        return await channelKnowledgeService.capture(input);
      } catch (saveError) {
        const inspection = await inspectArticle({
          url: input.url,
          extractorPlugin: resolveArticleExtractor(input.url, input.ownerTeamId ?? LOCAL_TEAM_ID),
        });
        return {
          ...inspection,
          knowledge: {
            status: "not_saved",
            reason: String(saveError?.code ?? saveError?.message ?? saveError).slice(0, 120),
          },
        };
      }
    },
    resendDelivery: (args) => channelResendDelivery?.(args),
    replySender: (args) => channelReplySender?.(args),
    enqueueChannelDelivery: (args) => channelDeliveryService?.enqueueChannelDelivery(args),
    notifyTaskEvent: (args) => channelNotificationService?.notifyTaskEvent(args),
    setNotificationPolicy: (args) => channelNotificationService?.setPolicy(args),
    updateWorkItem: workItemService.updateWorkItem,
    resolveProjectPath: (projectId) => (state.projects ?? []).find((project) => project.id === projectId)?.path ?? null,
    notifyHumanTakeover: ({ thread, request, reason }) => {
      const channel = (state.channels ?? []).find((candidate) => candidate.id === thread?.channelId);
      return alertOutbox.enqueue({
        kind: "channel_human_takeover",
        severity: "warning",
        message: `Channel task ${thread?.shortRef ?? thread?.id ?? "unknown"} requires human attention.`,
        data: {
          teamId: channel?.ownerTeamId ?? LOCAL_TEAM_ID,
          channelId: thread?.channelId ?? null,
          conversationId: thread?.conversationId ?? null,
          threadId: thread?.id ?? null,
          workItemId: thread?.workItemId ?? null,
          channelTaskRequestId: request?.id ?? null,
          reason: reason ?? "human_takeover",
        },
      });
    },
    // S6: in-channel /approve mints + consumes a single-use grant, then flips
    // the SAME approval the console acts on.
    mintDecisionGrant, validateApprovalToken, approveInvocation, denyInvocation,
  });
  channelThreadHook = channelConversationService.syncTaskThreadFromInvocation;
  channelAutoRunHook = channelConversationService.syncTaskThreadFromAutoRun;
  channelWorkItemHook = channelConversationService.syncTaskThreadFromWorkItem;
  channelConsultationHook = channelConversationService.syncConsultationFromInvocation;
  // Outbound delivery (S5/#1110): provider senders are late-bound by index.mjs
  // when each gateway is configured — this service never sees any provider
  // secret. Keyed by provider so a WeCom and a Feishu delivery route to their
  // own client (delivery picks by channel.provider).
  const channelSenders = {};
  channelDeliveryService = createChannelDeliveryService({
    state, now, nextId, appendEvent, refuse, persistStateSoon, store,
    resolveSender: (provider) => channelSenders[provider] ?? null,
    validateApprovalToken,
    notifyTaskEvent: (args) => channelNotificationService?.notifyTaskEvent(args),
  });
  channelNotificationService = createChannelNotificationService({
    state, now, nextId, appendEvent, persistStateSoon, store,
    enqueueChannelDelivery: (args) => channelDeliveryService.enqueueChannelDelivery(args),
  });
  enqueueWorkItemReportDeliveryBatch = channelDeliveryService.enqueueChannelDeliveryBatch;
  channelReplySender = ({ channelId, conversationId, content, threadId = null, invocationId = null, dedupeKey = null }) => channelDeliveryService.enqueueChannelDelivery({
    channelId,
    conversationId,
    invocationId,
    dedupeKey,
    content,
    taskContext: threadId
      ? { channelId, conversationId, threadId }
      : null,
  });
  channelResendDelivery = channelDeliveryService.resendChannelDelivery;
  channelDeliveryService.recoverThreadDeliveryState?.();
  channelNotificationService.sweep?.();
  channelConversationService.recoverTaskThreads?.();
  channelDeliveryService.recoverCompletedNotifications?.();
  channelConversationService.recoverConsultations?.();
  channelConversationService.resumeIntake?.();
  channelDeliveryHook = channelDeliveryService.notifyInvocationCompleted;

  // Inbound events are durable before dispatch. A crash between those two
  // steps must be recoverable on the next process start, and a replay must not
  // create a second outbound row for the same event.
  async function deliverChannelEventReply(event) {
    if (!event) return { ok: false, reason: "channel_event_not_found" };
    // Legacy settled events predate the durable reply marker. They are kept for
    // history but must not be replayed automatically after an upgrade.
    if (event.replyRecoveryPending !== true) return { ok: true, skipped: true, reason: "legacy_or_settled_event" };
    let settled = null;
    if (event.status === "imported") {
      settled = await channelConversationService.dispatchImportedChannelEvent({ eventId: event.id });
    } else if (event.status === "dispatched" || event.status === "refused") {
      settled = { reply: event.replyText ?? null, invocationId: event.invocationId ?? null };
    }
    if (!settled?.reply) {
      event.replyRecoveryPending = false;
      persistStateSoon();
      return { ok: true, status: event.status, replyQueued: false };
    }
    const queued = channelDeliveryService.enqueueChannelDelivery({
      channelId: event.channelId,
      conversationId: event.conversationId,
      invocationId: settled.invocationId ?? event.invocationId ?? null,
      content: settled.reply,
      dedupeKey: `channel-event:${event.id}:reply`,
    });
    if (!queued?.ok) {
      throw Object.assign(new Error("channel_event_reply_enqueue_failed"), {
        code: queued?.reason ?? "channel_event_reply_enqueue_failed",
      });
    }
    event.replyDeliveryId = queued.deliveryId ?? event.replyDeliveryId ?? null;
    event.replyRecoveryPending = false;
    persistStateSoon();
    return { ok: true, status: event.status, replyQueued: true, deduplicated: Boolean(queued.deduplicated) };
  }

  async function recoverChannelEventReplies() {
    const pending = (state.channelEvents ?? [])
      .filter((event) => ["imported", "dispatched", "refused"].includes(event.status))
      .slice(-200);
    for (const event of pending) {
      try { await deliverChannelEventReply(event); } catch { /* retry on the next recovery/sweep */ }
    }
  }

  // Scheduled work-report → channel push. Closes over the delivery service's
  // enqueue so a due schedule lands in the same durable outbound pipeline as an
  // invocation reply. Its sweep is registered on a slow tick in index.mjs.
  const reportScheduleService = createReportScheduleRuntime({
    state,
    now,
    enqueueChannelDelivery: channelDeliveryService.enqueueChannelDelivery,
    persistStateSoon,
    store,
    appendEvent,
  });

  const receiveChannelEvent = async (payload) => {
    let normalizedPayload = payload;
    if (Array.isArray(payload?.attachmentCandidates) && payload.attachmentCandidates.length) {
      const channel = (state.channels ?? []).find((row) => row.id === payload.channelId);
      const project = (state.projects ?? []).find((row) => row.id === channel?.taskProjectId);
      const attachmentBindingAvailable = Boolean(channel?.taskProjectId && channel?.taskTerminalId && project?.path);
      // Media is optional enrichment. A channel with /task disabled must still
      // retain the inbound interaction and its bounded text/media description;
      // refusing the whole event here made ordinary image/voice/file messages
      // disappear before they reached the interaction center.
      if (!attachmentBindingAvailable) {
        normalizedPayload = { ...payload, attachmentCandidates: undefined, attachmentAssets: [] };
      } else {
        try {
          const byteCandidates = payload.attachmentCandidates.filter((candidate) => candidate && candidate.bytes != null);
          const remoteCandidates = payload.attachmentCandidates.filter((candidate) => !candidate || candidate.bytes == null);
          const attachmentAssets = [];
          if (remoteCandidates.length) {
            attachmentAssets.push(...await ingestChannelAttachmentCandidates({
              candidates: remoteCandidates,
              projectPath: project?.path,
              projectId: channel?.taskProjectId,
              terminalId: channel?.taskTerminalId,
            }));
          }
          for (const candidate of byteCandidates) {
            attachmentAssets.push(await ingestChannelAttachmentBytes({
              filename: candidate.filename,
              bytes: candidate.bytes,
              contentType: candidate.contentType,
              projectPath: project?.path,
              projectId: channel?.taskProjectId,
              terminalId: channel?.taskTerminalId,
            }));
          }
          normalizedPayload = { ...payload, attachmentCandidates: undefined, attachmentAssets };
        } catch (error) {
          const code = error?.code ?? "channel_attachment_ingestion_failed";
          normalizedPayload = {
            ...payload,
            attachmentCandidates: undefined,
            attachmentAssets: [],
            mediaFailure: {
              total: payload.attachmentCandidates.length,
              failed: payload.attachmentCandidates.slice(0, 20).map((candidate) => ({
                kind: candidate?.kind ?? "file",
                filename: candidate?.filename ?? "附件",
                code,
              })),
            },
          };
        }
      }
    }
    if (normalizedPayload.attachmentAssets?.length) {
      const channel = (state.channels ?? []).find((row) => row.id === normalizedPayload.channelId);
      const project = (state.projects ?? []).find((row) => row.id === channel?.taskProjectId);
      if (project?.path) {
        const discoveries = await Promise.all(normalizedPayload.attachmentAssets.map((asset) =>
          discoverChannelFileAsset({ asset, projectPath: project.path, projectId: project.id })));
        normalizedPayload = { ...normalizedPayload, attachmentDiscoveries: discoveries };
      }
    }
    const imported = channelService.importChannelEvent(normalizedPayload);
    if (imported?.ok) {
      const event = (state.channelEvents ?? []).find((candidate) => candidate.id === imported.eventId);
      await deliverChannelEventReply(event);
    }
    return imported;
  };

  ilinkRuntime = createIlinkRuntime({
    state,
    stateStorePath,
    now,
    nextId,
    persistStateSoon,
    appendEvent,
    importChannelEvent: receiveChannelEvent,
    mapChannelIdentity: channelService.mapChannelIdentity,
    enableChannel: channelService.enableChannel,
    disableChannel: channelService.disableChannel,
    credentialStore: ilinkCredentialStore ?? undefined,
    clientFactory: ilinkClientFactory,
  });
  void recoverChannelEventReplies();

  function runApplicationOrchestration(applicationId, routineId, body = {}, actor = null) {
    const application = findApplication(applicationId);
    if (!application) {
      return { status: 404, body: { error: "application_not_found" } };
    }
    const orchestration = (application.orchestrations ?? []).find((item) => item?.routineId === routineId);
    if (!orchestration) {
      return { status: 404, body: { error: "orchestration_not_found", applicationId, routineId } };
    }
    if (application.status === "archived") {
      return { status: 409, body: { error: "application_archived", applicationId } };
    }
    if (application.status !== "active") {
      return { status: 409, body: { error: "application_not_active", applicationId, status: application.status } };
    }
    if (orchestration.status === "invalid" || orchestration.validation?.ok === false) {
      return {
        status: 422,
        body: {
          error: "invalid_application_routine",
          applicationId,
          routineId,
          validation: orchestration.validation ?? null,
        },
      };
    }
    if (!orchestration.path || !isManagedApplicationRoutinePath(application, orchestration.path)) {
      return { status: 422, body: { error: "invalid_orchestration_path", applicationId, routineId } };
    }
    if (!existsSync(orchestration.path)) {
      return { status: 404, body: { error: "orchestration_file_not_found", applicationId, routineId } };
    }

    let routine = null;
    try {
      routine = JSON.parse(readFileSync(orchestration.path, "utf8"));
    } catch (error) {
      return {
        status: 422,
        body: {
          error: "invalid_application_routine",
          message: error instanceof Error ? error.message : String(error),
          applicationId,
          routineId,
        },
      };
    }
    const validation = validateApplicationRoutineDraft(routine, {
      root: dirname(orchestration.path),
      application,
    });
    if (!validation.ok) {
      return {
        status: 422,
        body: {
          error: "invalid_application_routine",
          applicationId,
          routineId,
          validation,
        },
      };
    }

    const agentId = typeof body?.agentId === "string" && body.agentId.trim()
      ? body.agentId.trim()
      : null;
    const agent = agentId ? findAgent(agentId) : defaultAgent();
    if (!agent) {
      return { status: 404, body: { error: "agent_not_found" } };
    }
    if (agent.status === "disabled") {
      return { status: 409, body: { error: "agent_disabled", agentId: agent.id } };
    }
    if (agent.health?.status === "unhealthy") {
      return {
        status: 409,
        body: { error: "agent_unhealthy", agentId: agent.id, message: agent.health.message },
      };
    }
    if (agent.location?.type === "local_device" && state.device.unlinkState !== "linked") {
      return { status: 409, body: { error: "device_unlinked", agentId: agent.id } };
    }
    const retryOfInvocationId = typeof body?.retryOfInvocationId === "string" && body.retryOfInvocationId.trim()
      ? body.retryOfInvocationId.trim()
      : null;
    if (retryOfInvocationId) {
      const retryOfInvocation = findInvocation(retryOfInvocationId);
      if (!retryOfInvocation || !isApplicationOrchestrationRun(retryOfInvocation, application.id, routineId)) {
        return { status: 404, body: { error: "orchestration_run_not_found", applicationId, routineId, invocationId: retryOfInvocationId } };
      }
    }
    const retryReason = retryOfInvocationId
      ? summarizeText(body?.retryReason ?? "Manual application orchestration retry.", 160)
      : null;
    const invocation = createInvocation(applicationRoutineTask({ application, orchestration, routine, validation }), agent, {
      actor,
      requestedBy: actor?.userId,
      metadata: {
        source: "application_orchestration",
        applicationId: application.id,
        applicationName: application.name,
        routineId,
        routineName: routine.metadata?.name ?? null,
        orchestrationPath: orchestration.path ?? null,
        orchestrationRelativePath: orchestration.relativePath ?? null,
        projectId: application.projectId ?? null,
        routineValidationOk: validation.ok,
        retryOfInvocationId,
        retryReason,
        recoveryActionType: typeof body?.recoveryActionType === "string" ? body.recoveryActionType : null,
        recoveryOfInvocationId: typeof body?.recoveryOfInvocationId === "string" ? body.recoveryOfInvocationId : null,
        recoveryReason: typeof body?.recoveryReason === "string" ? summarizeText(body.recoveryReason, 160) : null,
        recoveryCategory: typeof body?.recoveryCategory === "string" ? body.recoveryCategory : null,
      },
      timeoutSeconds: Number(body?.timeoutSeconds ?? 30),
    });
    startInvocationIfAllowed(invocation, agent);
    appendEvent({
      invocationId: invocation.id,
      type: "application_orchestration_run_requested",
      level: "info",
      message: retryOfInvocationId
        ? `${application.name} application orchestration ${routineId} retry requested.`
        : `${application.name} application orchestration ${routineId} run requested.`,
      data: { applicationId: application.id, routineId, retryOfInvocationId, retryReason },
    });
    return {
      status: 201,
      body: {
        applicationId: application.id,
        routineId,
        invocationId: invocation.id,
        agentId: agent.id,
        status: invocation.status,
        invocation,
      },
    };
  }

  function listApplicationOrchestrationRuns(applicationId, routineId, searchParams = new URLSearchParams()) {
    const scope = applicationOrchestrationScope(applicationId, routineId);
    if (scope.status !== 200) return scope;
    const limit = clampNumber(searchParams?.get?.("limit") ?? 10, 1, 50);
    const runs = state.invocations
      .filter((invocation) => isApplicationOrchestrationRun(invocation, applicationId, routineId))
      .sort((left, right) => Date.parse(right.createdAt ?? "") - Date.parse(left.createdAt ?? ""))
      .slice(0, limit)
      .map(applicationOrchestrationRunSummary);
    return {
      status: 200,
      body: {
        applicationId,
        routineId,
        runs,
      },
    };
  }

  function getApplicationOrchestrationRun(applicationId, routineId, invocationId) {
    const run = getScopedApplicationOrchestrationInvocation(applicationId, routineId, invocationId);
    if (run.status !== 200) return run;
    return {
      status: 200,
      body: {
        applicationId,
        routineId,
        run: applicationOrchestrationRunDetail(run.invocation),
      },
    };
  }

  function listApplicationOrchestrationRunEvents(applicationId, routineId, invocationId) {
    const run = getScopedApplicationOrchestrationInvocation(applicationId, routineId, invocationId);
    if (run.status !== 200) return run;
    const events = applicationOrchestrationRunEvents(invocationId)
      .map((event) => ({
        id: event.id,
        invocationId: event.invocationId,
        type: event.type,
        level: event.level,
        message: event.message,
        data: event.data ?? null,
        createdAt: event.createdAt,
      }));
    return {
      status: 200,
      body: {
        applicationId,
        routineId,
        invocationId,
        events,
      },
    };
  }

  function getApplicationOrchestrationRunRecovery(applicationId, routineId, invocationId) {
    const run = getScopedApplicationOrchestrationInvocation(applicationId, routineId, invocationId);
    if (run.status !== 200) return run;
    const events = applicationOrchestrationRunEvents(invocationId);
    const recoveryActions = applicationRecoveryActionsForRun(applicationId, routineId, invocationId);
    return {
      status: 200,
      body: {
        applicationId,
        routineId,
        invocationId,
        recovery: applicationOrchestrationRecovery(run.invocation, events, recoveryActions),
      },
    };
  }

  function listApplicationOrchestrationRecoveryAgentCandidates(applicationId, routineId, invocationId) {
    const run = getScopedApplicationOrchestrationInvocation(applicationId, routineId, invocationId);
    if (run.status !== 200) return run;
    const recoveryModel = applicationOrchestrationRecovery(
      run.invocation,
      applicationOrchestrationRunEvents(invocationId),
      applicationRecoveryActionsForRun(applicationId, routineId, invocationId),
    );
    const candidateViews = recoveryAgentCandidateViews(run.invocation);
    return {
      status: 200,
      body: {
        applicationId,
        routineId,
        invocationId,
        recoveryCategory: recoveryModel.category,
        sourceAgentId: run.invocation.agentId ?? null,
        preferredAgentId: candidateViews.find((candidate) => candidate.preferred)?.id ?? null,
        candidates: candidateViews,
      },
    };
  }

  // Orchestration auto-recovery (docs/design/ORCHESTRATION_AUTO_RECOVERY.md).
  // Approval policy: autonomy never crosses an approval gate — only the model's
  // RECOMMENDED action, only `rerun`, only on runtime_error/dispatch_timeout/
  // execution_timeout
  // (cancelled would override human intent), capped per stream, opt-in per app.
  // Skip decisions are evented only for opted-in applications (quiet by default).
  const AUTO_RECOVERY_ACTOR_ID = "system_auto_recovery";
  const AUTO_RECOVERY_CATEGORIES = new Set(["runtime_error", "dispatch_timeout", "execution_timeout"]);

  function consecutiveAutoRecoveryAttempts(applicationId, routineId) {
    // Auto attempts on the stream since its last successful run; a success (or a
    // manual recovery that leads to one) resets the count.
    const lastSuccessAt = (state.invocations ?? []).reduce((max, inv) => {
      const meta = inv?.options?.metadata;
      return meta?.source === "application_orchestration"
        && meta.applicationId === applicationId
        && meta.routineId === routineId
        && inv.status === "succeeded"
        && typeof inv.completedAt === "string"
        && inv.completedAt > max
        ? inv.completedAt
        : max;
    }, "");
    return (state.applicationRecoveryActions ?? []).filter((request) =>
      request?.applicationId === applicationId
      && request.routineId === routineId
      && request.requestedBy === AUTO_RECOVERY_ACTOR_ID
      && (!lastSuccessAt || (request.createdAt ?? "") > lastSuccessAt),
    ).length;
  }

  function appendAutoRecoverySkippedEvent(invocation, meta, reason, data = {}) {
    appendEvent({
      invocationId: invocation.id,
      type: "application_orchestration_auto_recovery_skipped",
      level: "warn",
      message: `Auto-recovery skipped for ${meta.routineId}: ${reason}.`,
      data: { applicationId: meta.applicationId, routineId: meta.routineId, reason, ...data },
    });
  }

  // Bridge liveness + invocation deadlines
  // (docs/design/BRIDGE_LIVENESS_AND_REFUSAL.md): the device's
  // lastSeenAt is refreshed on every authenticated bridge request but nothing
  // watched it — a dead bridge stayed "online" forever and runs it had
  // acknowledged stayed "running" forever. A live Bridge is not proof that its
  // child executor still exists, so this sweep also enforces a server-side hard
  // deadline. It requests interruption first, then terminalizes after a short
  // grace; completion normalizes that path to execution_timeout so auto-runs can
  // resume on their existing worktree.
  const BRIDGE_STALENESS_MS = Number(process.env.MYAGENTTOOL_BRIDGE_STALENESS_MS) || 90_000;
  const INVOCATION_DEADLINE_GRACE_MS =
    Number(process.env.MYAGENTTOOL_INVOCATION_DEADLINE_GRACE_MS) || 30_000;
  const INVOCATION_INTERRUPT_GRACE_MS =
    Number(process.env.MYAGENTTOOL_INVOCATION_INTERRUPT_GRACE_MS) || 30_000;
  function bridgeLivenessSweep() {
    const device = state.device;
    if (!device) return;
    const nowMs = Date.parse(now());
    if (device.status === "online" && device.unlinkState === "linked") {
      const lastSeenMs = Date.parse(device.lastSeenAt ?? "");
      if (Number.isFinite(lastSeenMs) && nowMs - lastSeenMs > BRIDGE_STALENESS_MS) {
        device.status = "offline";
        device.livenessLostAt = now();
        device.updatedAt = device.livenessLostAt;
        persistStateSoon();
        appendEvent({
          invocationId: null,
          type: "bridge_liveness_lost",
          level: "warn",
          message: `Desktop Bridge has not been seen for ${Math.round((nowMs - lastSeenMs) / 1000)}s; device marked offline.`,
          data: { deviceId: device.id, lastSeenAt: device.lastSeenAt },
        });
        void autoRunAlerts.dispatch({
          kind: "bridge_liveness_lost",
          severity: "warning",
          message: "Desktop Bridge stopped responding; the device is offline and queued runs will wait until it returns.",
          data: { deviceId: device.id, lastSeenAt: device.lastSeenAt },
        });
      }
    }
    if (device.status === "online") {
      for (const invocation of state.invocations) {
        if (!["running", "cancelling"].includes(invocation.status)) continue;
        if ((invocation.delivery?.deviceId ?? null) !== device.id) continue;

        const timeoutSeconds = Number(invocation.options?.timeoutSeconds);
        const acknowledgedAtMs = Date.parse(invocation.delivery?.acknowledgedAt ?? "");
        if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0 || !Number.isFinite(acknowledgedAtMs)) {
          continue;
        }
        const deadlineAtMs = acknowledgedAtMs + timeoutSeconds * 1000 + INVOCATION_DEADLINE_GRACE_MS;
        if (nowMs < deadlineAtMs) continue;

        if (!invocation.deadlineEnforcement && invocation.status === "running") {
          const requestedAt = now();
          invocation.deadlineEnforcement = {
            state: "interrupt_requested",
            requestedAt,
            deadlineAt: new Date(deadlineAtMs).toISOString(),
          };
          cancelInvocation(invocation, { userId: "usr_runtime_deadline" });
          invocation.cancellation.reason =
            "The server runtime deadline expired; executor interruption was requested.";
          appendEvent({
            invocationId: invocation.id,
            type: "invocation_deadline_exceeded",
            level: "warn",
            message: "Invocation exceeded its runtime deadline; the server requested executor interruption.",
            data: {
              timeoutSeconds,
              graceMs: INVOCATION_DEADLINE_GRACE_MS,
              deadlineAt: invocation.deadlineEnforcement.deadlineAt,
            },
          });
          persistStateSoon();
          continue;
        }

        const interruptRequestedAtMs = Date.parse(invocation.deadlineEnforcement?.requestedAt ?? "");
        if (
          invocation.deadlineEnforcement?.state === "interrupt_requested"
          && Number.isFinite(interruptRequestedAtMs)
          && nowMs - interruptRequestedAtMs >= INVOCATION_INTERRUPT_GRACE_MS
        ) {
          appendEvent({
            invocationId: invocation.id,
            type: "invocation_deadline_reclaimed",
            level: "warn",
            message: "Executor did not report a terminal result after deadline interruption; the server reclaimed the invocation.",
            data: {
              interruptGraceMs: INVOCATION_INTERRUPT_GRACE_MS,
              requestedAt: invocation.deadlineEnforcement.requestedAt,
            },
          });
          completeInvocation(invocation, {
            status: "timed_out",
            result: {
              summary: "The executor exceeded its configured runtime and stopped reporting progress.",
              errorCode: "execution_timeout",
              timeoutKind: "server_hard_deadline",
            },
          });
        }
      }
    }
    if (device.status !== "offline") return;
    const lostAtMs = Date.parse(device.livenessLostAt ?? device.lastSeenAt ?? "");
    if (!Number.isFinite(lostAtMs)) return;
    for (const invocation of state.invocations) {
      if (invocation.status !== "running") continue;
      if ((invocation.delivery?.deviceId ?? null) !== device.id) continue;
      // Grace: generous vs. the run's own timeout, so a bridge blip never eats a
      // run the bridge would have completed moments after reconnecting.
      const graceMs = Math.max(2 * 1000 * Number(invocation.options?.timeoutSeconds ?? 30), 300_000);
      if (nowMs - lostAtMs < graceMs) continue;
      appendEvent({
        invocationId: invocation.id,
        type: "delivery_reclaimed",
        level: "warn",
        message: "Run reclaimed: the bridge that acknowledged it went offline and did not return within the grace window.",
        data: { deviceId: device.id, livenessLostAt: device.livenessLostAt, graceMs },
      });
      completeInvocation(invocation, {
        status: "timed_out",
        result: {
          summary: "The Desktop Bridge went offline mid-run and did not return; the run was reclaimed by the server.",
          errorCode: "dispatch_timeout",
        },
      });
    }
  }

  function maybeAutoRecoverOrchestrationRun(invocation) {
    if (!["failed", "timed_out"].includes(invocation?.status)) return;
    const meta = invocation?.options?.metadata;
    if (meta?.source !== "application_orchestration" || !meta.applicationId || !meta.routineId) return;
    const application = findApplication(meta.applicationId);
    // Effective config: a per-routine override (局部管控) wins over the
    // application-level policy for both the switch and the cap.
    const autoRecoveryConfig = application?.autoRecovery ?? null;
    const routineOverride = autoRecoveryConfig?.routineOverrides?.[meta.routineId] ?? null;
    if (!(routineOverride?.enabled ?? autoRecoveryConfig?.enabled)) return;

    const recoveryModel = applicationOrchestrationRecovery(
      invocation,
      applicationOrchestrationRunEvents(invocation.id),
      applicationRecoveryActionsForRun(meta.applicationId, meta.routineId, invocation.id),
    );
    const recommended = recoveryModel.actions.find((item) => item.recommended) ?? null;
    // The crash-loop cap applies to EVERYTHING auto-initiated — executed reruns
    // and auto-filed approval requests alike — so a routine failing nightly
    // cannot flood the Approvals queue any more than it can rerun itself.
    const cap = routineOverride?.maxAttempts ?? autoRecoveryConfig?.maxAttempts ?? 2;
    const attempts = consecutiveAutoRecoveryAttempts(meta.applicationId, meta.routineId);
    if (attempts >= cap) {
      appendAutoRecoverySkippedEvent(invocation, meta, "attempt_cap", { attempts, maxAttempts: cap });
      // Crash-loop reached: the one auto-recovery outcome a human MUST hear about,
      // because from here every further failure just waits silently for them.
      void autoRunAlerts.dispatch({
        kind: "application_auto_recovery_capped",
        severity: "warning",
        message: `Auto-recovery for ${meta.routineName ?? meta.routineId} stopped after ${attempts} consecutive attempts; the routine is still failing.`,
        data: { applicationId: meta.applicationId, routineId: meta.routineId, invocationId: invocation.id, attempts, maxAttempts: cap },
      });
      return;
    }
    if (recommended?.requiresApproval) {
      // Auto-FILE, never auto-approve: park the recommended action as an
      // ordinary approval request (24h window since #701 — it no longer expires
      // before a human plausibly sees the queue). The human decides in the
      // Approvals Center; approval executes through the decision-grant chain.
      const filed = requestApplicationOrchestrationRecoveryAction(
        meta.applicationId,
        meta.routineId,
        invocation.id,
        { actionType: recommended.type, reason: `Auto-filed for approval after ${recoveryModel.category} (attempt ${attempts + 1}/${cap}).` },
        { userId: AUTO_RECOVERY_ACTOR_ID },
      );
      if (filed.status === 202) {
        appendEvent({
          invocationId: invocation.id,
          type: "application_orchestration_auto_recovery_approval_filed",
          level: "info",
          message: `Auto-recovery filed ${recommended.type} for human approval (${recoveryModel.category}).`,
          data: { applicationId: meta.applicationId, routineId: meta.routineId, actionType: recommended.type, category: recoveryModel.category },
        });
      } else {
        appendAutoRecoverySkippedEvent(invocation, meta, "approval_filing_blocked", {
          category: recoveryModel.category,
          recommendedAction: recommended.type,
          status: filed.status,
          error: filed.body?.error ?? null,
        });
      }
      return;
    }
    if (!recommended || !AUTO_RECOVERY_CATEGORIES.has(recoveryModel.category) || recommended.type !== "rerun") {
      appendAutoRecoverySkippedEvent(invocation, meta, "category_not_eligible", {
        category: recoveryModel.category,
        recommendedAction: recommended?.type ?? null,
      });
      return;
    }
    // Reuses every guard in the manual path (scoping, action-suggested check,
    // duplicate-action block); a non-2xx outcome is recorded by that path's own
    // rejection events, so no extra handling here.
    requestApplicationOrchestrationRecoveryAction(
      meta.applicationId,
      meta.routineId,
      invocation.id,
      { actionType: "rerun", reason: `Auto-recovery attempt ${attempts + 1}/${cap} after ${recoveryModel.category}.` },
      { userId: AUTO_RECOVERY_ACTOR_ID },
    );
  }

  function requestApplicationOrchestrationRecoveryAction(applicationId, routineId, invocationId, body = {}, actor = null) {
    const run = getScopedApplicationOrchestrationInvocation(applicationId, routineId, invocationId);
    if (run.status !== 200) return run;
    const actionType = typeof body?.actionType === "string" ? body.actionType.trim() : "";
    if (!actionType) {
      return { status: 400, body: { error: "invalid_recovery_action", message: "actionType is required." } };
    }
    const events = applicationOrchestrationRunEvents(invocationId);
    const recoveryModel = applicationOrchestrationRecovery(
      run.invocation,
      events,
      applicationRecoveryActionsForRun(applicationId, routineId, invocationId),
    );
    const selectedAction = recoveryModel.actions.find((item) => item.type === actionType);
    if (!selectedAction) {
      appendRecoveryActionEvent("rejected", invocationId, applicationId, routineId, actionType, recoveryModel.category, "action_not_suggested");
      return {
        status: 400,
        body: {
          error: "recovery_action_not_suggested",
          applicationId,
          routineId,
          invocationId,
          actionType,
          explanation: applicationRecoveryActionExplanation(null, {
            actionType,
            recoveryModel,
            status: "rejected",
            reason: "action_not_suggested",
          }),
        },
      };
    }
    if (selectedAction.availability?.state === "blocked") {
      const blockedReason = selectedAction.blockedReason ?? selectedAction.availability.blockedReason ?? "recovery_action_blocked";
      const latestRequestId = selectedAction.latestRequestId ?? selectedAction.availability.latestRequestId ?? null;
      appendRecoveryActionEvent("rejected", invocationId, applicationId, routineId, actionType, recoveryModel.category, blockedReason);
      return {
        status: 409,
        body: {
          error: "recovery_action_blocked",
          applicationId,
          routineId,
          invocationId,
          actionType,
          blockedReason,
          latestRequestId,
          action: selectedAction,
          explanation: applicationRecoveryActionExplanation(null, {
            action: selectedAction,
            recoveryModel,
            status: "blocked",
            blockedReason,
            latestRequestId,
          }),
        },
      };
    }
    const reason = summarizeText(body?.reason ?? selectedAction.description ?? recoveryModel.summary, 160);
    const actionRequest = createApplicationRecoveryActionRequest({
      applicationId,
      routineId,
      invocationId,
      action: selectedAction,
      recoveryCategory: recoveryModel.category,
      reason,
      actor,
    });
    if (selectedAction.requiresApproval && !isApplicationRecoveryActionApproved(body?.approvalToken, applicationId, actor)) {
      const approvalRequest = createApplicationRecoveryApprovalRequest(run.invocation, actionRequest, selectedAction, recoveryModel, actor);
      actionRequest.status = approvalRequest.status === "approved" ? "approval_approved" : approvalRequest.status === "denied" ? "approval_denied" : "approval_pending";
      actionRequest.approvalRequestId = approvalRequest.id;
      actionRequest.updatedAt = now();
      persistStateSoon();
      appendRecoveryActionEvent("approval_pending", invocationId, applicationId, routineId, actionType, recoveryModel.category, reason, actionRequest);
      return {
        status: 202,
        body: {
          applicationId,
          routineId,
          invocationId,
          action: selectedAction,
          recoveryActionRequest: actionRequest,
          approvalRequest,
          status: "approval_pending",
          explanation: applicationRecoveryActionExplanation(actionRequest, {
            action: selectedAction,
            recoveryModel,
            status: "approval_pending",
          }),
        },
      };
    }
    if (actionType === "view_invocation") {
      actionRequest.status = "noop";
      actionRequest.updatedAt = now();
      persistStateSoon();
      appendRecoveryActionEvent("requested", invocationId, applicationId, routineId, actionType, recoveryModel.category, reason, actionRequest);
      return {
        status: 200,
        body: {
          applicationId,
          routineId,
          invocationId,
          action: selectedAction,
          recoveryActionRequest: actionRequest,
          status: "noop",
          explanation: applicationRecoveryActionExplanation(actionRequest, {
            action: selectedAction,
            recoveryModel,
            status: "noop",
          }),
        },
      };
    }
    if (actionType === "regenerate_orchestration") {
      appendRecoveryActionEvent("requested", invocationId, applicationId, routineId, actionType, recoveryModel.category, reason, actionRequest);
      executeApprovedApplicationRecoveryAction(actionRequest, actor);
      if (actionRequest.status === "failed") {
        return {
          status: 500,
          body: {
            error: "recovery_action_execution_failed",
            applicationId,
            routineId,
            invocationId,
            actionType,
            recoveryActionRequest: actionRequest,
            explanation: applicationRecoveryActionExplanation(actionRequest, {
              action: selectedAction,
              recoveryModel,
              status: "failed",
            }),
          },
        };
      }
      return {
        status: 201,
        body: {
          applicationId,
          routineId,
          invocationId,
          action: selectedAction,
          recoveryActionRequest: actionRequest,
          status: actionRequest.status,
          explanation: applicationRecoveryActionExplanation(actionRequest, {
            action: selectedAction,
            recoveryModel,
          }),
        },
      };
    }
    if (actionType === "select_agent") {
      actionRequest.requestedAgentId = typeof body?.agentId === "string" && body.agentId.trim()
        ? body.agentId.trim()
        : null;
      actionRequest.agentCandidateSnapshot = recoveryAgentCandidateSnapshot(run.invocation, actionRequest.requestedAgentId);
      const selectedAgent = selectRecoveryAgent(run.invocation, body);
      if (!selectedAgent.ok) {
        actionRequest.status = "failed";
        actionRequest.error = selectedAgent.error;
        actionRequest.updatedAt = now();
        persistStateSoon();
        appendRecoveryActionEvent("rejected", invocationId, applicationId, routineId, actionType, recoveryModel.category, selectedAgent.error, actionRequest);
        return {
          status: selectedAgent.status,
          body: {
            error: selectedAgent.error,
            applicationId,
            routineId,
            invocationId,
            actionType,
            recoveryActionRequest: actionRequest,
            explanation: applicationRecoveryActionExplanation(actionRequest, {
              action: selectedAction,
              recoveryModel,
              status: "failed",
            }),
          },
        };
      }
      appendRecoveryActionEvent("requested", invocationId, applicationId, routineId, actionType, recoveryModel.category, reason, actionRequest);
      const result = runApplicationOrchestration(applicationId, routineId, {
        agentId: selectedAgent.agent.id,
        timeoutSeconds: body?.timeoutSeconds,
        retryOfInvocationId: invocationId,
        retryReason: reason,
        recoveryActionType: actionType,
        recoveryOfInvocationId: invocationId,
        recoveryReason: reason,
        recoveryCategory: recoveryModel.category,
      }, actor);
      if (result.status >= 400) {
        actionRequest.status = "failed";
        actionRequest.error = result.body?.error ?? "run_failed";
        actionRequest.updatedAt = now();
        persistStateSoon();
        appendRecoveryActionEvent("rejected", invocationId, applicationId, routineId, actionType, recoveryModel.category, actionRequest.error, actionRequest);
        return {
          ...result,
          body: {
            ...result.body,
            recoveryActionRequest: actionRequest,
            explanation: applicationRecoveryActionExplanation(actionRequest, {
              action: selectedAction,
              recoveryModel,
              status: "failed",
            }),
          },
        };
      }
      actionRequest.status = "executed";
      actionRequest.selectedAgentId = selectedAgent.agent.id;
      actionRequest.resultInvocationId = result.body?.invocationId ?? null;
      actionRequest.executedAt = now();
      actionRequest.updatedAt = actionRequest.executedAt;
      persistStateSoon();
      appendEvent({
        invocationId,
        type: "application_orchestration_recovery_action_executed",
        level: "info",
        message: `Application orchestration recovery action ${actionType} executed.`,
        data: {
          applicationId,
          routineId,
          actionType,
          recoveryActionRequestId: actionRequest.id,
          selectedAgentId: actionRequest.selectedAgentId,
          resultInvocationId: actionRequest.resultInvocationId,
        },
      });
      return {
        status: result.status,
        body: {
          ...result.body,
          recoveryActionRequest: actionRequest,
          recoveryAction: {
            actionType,
            selectedAgentId: selectedAgent.agent.id,
            recoveryCategory: recoveryModel.category,
            recoveryOfInvocationId: invocationId,
            recoveryReason: reason,
          },
          explanation: applicationRecoveryActionExplanation(actionRequest, {
            action: selectedAction,
            recoveryModel,
          }),
        },
      };
    }
    if (actionType !== "rerun") {
      actionRequest.status = "unsupported";
      actionRequest.updatedAt = now();
      persistStateSoon();
      appendRecoveryActionEvent("rejected", invocationId, applicationId, routineId, actionType, recoveryModel.category, "action_not_supported", actionRequest);
      return {
        status: 501,
        body: {
          error: "recovery_action_not_supported",
          applicationId,
          routineId,
          invocationId,
          actionType,
          recoveryActionRequest: actionRequest,
          explanation: applicationRecoveryActionExplanation(actionRequest, {
            action: selectedAction,
            recoveryModel,
            status: "unsupported",
          }),
        },
      };
    }
    appendRecoveryActionEvent("requested", invocationId, applicationId, routineId, actionType, recoveryModel.category, reason, actionRequest);
    const result = runApplicationOrchestration(applicationId, routineId, {
      agentId: typeof body?.agentId === "string" ? body.agentId : null,
      timeoutSeconds: body?.timeoutSeconds,
      retryOfInvocationId: invocationId,
      retryReason: reason,
      recoveryActionType: actionType,
      recoveryOfInvocationId: invocationId,
      recoveryReason: reason,
      recoveryCategory: recoveryModel.category,
    }, actor);
    if (result.status >= 400) {
      actionRequest.status = "failed";
      actionRequest.updatedAt = now();
      persistStateSoon();
      appendRecoveryActionEvent("rejected", invocationId, applicationId, routineId, actionType, recoveryModel.category, result.body?.error ?? "run_failed", actionRequest);
      return {
        ...result,
        body: {
          ...result.body,
          recoveryActionRequest: actionRequest,
          explanation: applicationRecoveryActionExplanation(actionRequest, {
            action: selectedAction,
            recoveryModel,
            status: "failed",
          }),
        },
      };
    }
    actionRequest.status = "executed";
    actionRequest.resultInvocationId = result.body?.invocationId ?? null;
    actionRequest.executedAt = now();
    actionRequest.updatedAt = actionRequest.executedAt;
    persistStateSoon();
    return {
      status: result.status,
      body: {
        ...result.body,
        recoveryActionRequest: actionRequest,
        recoveryAction: {
          actionType,
          recoveryCategory: recoveryModel.category,
          recoveryOfInvocationId: invocationId,
          recoveryReason: reason,
        },
        explanation: applicationRecoveryActionExplanation(actionRequest, {
          action: selectedAction,
          recoveryModel,
        }),
      },
    };
  }

  function applicationRecoveryActionExplanation(actionRequest = null, options = {}) {
    const actionType = actionRequest?.actionType ?? options.action?.type ?? options.actionType ?? null;
    const status = options.status ?? actionRequest?.status ?? "requested";
    const blockedReason = options.blockedReason ?? options.action?.blockedReason ?? options.action?.availability?.blockedReason ?? null;
    const latestRequestId = options.latestRequestId ?? options.action?.latestRequestId ?? options.action?.availability?.latestRequestId ?? null;
    const reason = options.reason ?? actionRequest?.error ?? blockedReason ?? actionRequest?.reason ?? null;
    const state = recoveryExplanationState(status, blockedReason);
    return {
      selectedAction: actionType,
      state,
      reason: recoveryExplanationReason(state, reason),
      summary: recoveryExplanationSummary(state, actionType, reason),
      nextStep: recoveryExplanationNextStep(state, blockedReason),
      recoveryCategory: actionRequest?.recoveryCategory ?? options.recoveryModel?.category ?? null,
      blockedReason,
      latestRequestId,
      recoveryActionRequestId: actionRequest?.id ?? null,
      approvalRequestId: actionRequest?.approvalRequestId ?? null,
      requestedAgentId: actionRequest?.requestedAgentId ?? null,
      selectedAgentId: actionRequest?.selectedAgentId ?? null,
      resultInvocationId: actionRequest?.resultInvocationId ?? null,
      resultOrchestrationId: actionRequest?.resultOrchestrationId ?? null,
      resultOrchestrationRelativePath: actionRequest?.resultOrchestrationRelativePath ?? null,
    };
  }

  function recoveryExplanationState(status, blockedReason) {
    if (blockedReason || status === "blocked") return "blocked";
    if (status === "noop") return "no_result_expected";
    if (status === "approval_pending") return "approval_pending";
    if (status === "approval_denied" || status === "approval_timed_out") return status;
    if (status === "unsupported") return "unsupported";
    if (status === "failed") return "failed";
    if (status === "executed") return "executed";
    if (status === "executing") return "executing";
    if (status === "rejected") return "rejected";
    return "requested";
  }

  function recoveryExplanationReason(state, reason) {
    if (state === "no_result_expected") return "no_result_expected";
    if (state === "executed") return "execution_completed";
    if (state === "executing") return "execution_in_progress";
    if (state === "requested") return "recovery_requested";
    return reason ?? state;
  }

  function recoveryExplanationSummary(state, actionType, reason) {
    const action = actionType ?? "recovery";
    if (state === "blocked") return `Recovery action ${action} is blocked: ${reason ?? "recovery_action_blocked"}.`;
    if (state === "approval_pending") return `Recovery action ${action} is waiting for approval.`;
    if (state === "no_result_expected") return `Recovery action ${action} records inspection only and does not create a result.`;
    if (state === "executed") return `Recovery action ${action} executed successfully.`;
    if (state === "failed") return `Recovery action ${action} failed: ${reason ?? "execution_failed"}.`;
    if (state === "unsupported") return `Recovery action ${action} is not supported.`;
    if (state === "rejected") return `Recovery action ${action} was rejected: ${reason ?? "rejected"}.`;
    if (state === "executing") return `Recovery action ${action} is executing.`;
    return `Recovery action ${action} was requested.`;
  }

  function recoveryExplanationNextStep(state, blockedReason) {
    if (state === "blocked") {
      return blockedReason === "same_action_approval_pending"
        ? "Resolve the latest approval request before requesting this action again."
        : "Wait for the in-progress recovery action to finish before requesting this action again.";
    }
    if (state === "approval_pending") return "Resolve the linked approval request before this recovery can execute.";
    if (state === "no_result_expected") return "Inspect the source invocation evidence.";
    if (state === "executed") return "Inspect the recovery result and continue with the recovered orchestration.";
    if (state === "failed") return "Review the failure details and choose another recovery action.";
    if (state === "unsupported" || state === "rejected") return "Choose one of the currently suggested recovery actions.";
    if (state === "executing" || state === "requested") return "Wait for the recovery action to finish, then inspect the result.";
    return "Review the recovery action audit trail.";
  }

  function createApplicationRecoveryActionRequest({ applicationId, routineId, invocationId, action, recoveryCategory, reason, actor }) {
    const createdAt = now();
    const request = {
      id: nextId("app_rec"),
      applicationId,
      routineId,
      invocationId,
      actionType: action.type,
      status: "requested",
      recoveryCategory,
      reason,
      requiresApproval: Boolean(action.requiresApproval),
      approvalRequestId: null,
      resultInvocationId: null,
      selectedAgentId: null,
      requestedAgentId: null,
      agentCandidateSnapshot: null,
      resultOrchestrationId: null,
      resultOrchestrationRelativePath: null,
      error: null,
      requestedBy: actor?.userId ?? "usr_local",
      decidedAt: null,
      executedAt: null,
      createdAt,
      updatedAt: createdAt,
    };
    state.applicationRecoveryActions.unshift(request);
    state.applicationRecoveryActions = retentionArchive.capWithArchive(state.applicationRecoveryActions, 200, "applicationRecoveryActions");
    persistStateSoon();
    return request;
  }

  function createApplicationRecoveryApprovalRequest(invocation, actionRequest, action, recoveryModel) {
    const createdAt = now();
    const request = {
      id: nextId("cdx_appr"),
      invocationId: invocation.id,
      codexSessionRegistryId: null,
      hookEventId: null,
      toolName: `application.recovery.${action.type}`,
      summary: summarizeText(actionRequest.reason || action.description || recoveryModel.summary, 240),
      riskLevel: "high",
      status: "pending",
      // 24h, not the broker's 5-minute Codex ask-mode default: this request waits
      // for a HUMAN in the Approvals queue, and a human-scale decision that expires
      // before anyone plausibly saw it trains operators to ignore the queue.
      timeoutAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      decision: null,
      decidedAt: null,
      notificationState: "queued",
      approvalMode: "ask",
      createdAt,
      updatedAt: createdAt,
      source: "application_recovery_action",
      applicationRecoveryActionRequestId: actionRequest.id,
    };
    state.codexApprovalBrokerRequests.unshift(request);
    state.codexApprovalBrokerRequests = retentionArchive.capWithArchive(state.codexApprovalBrokerRequests, 200, "codexApprovalBrokerRequests");
    persistStateSoon();
    appendEvent({
      invocationId: invocation.id,
      type: "application_orchestration_recovery_approval_requested",
      level: "warn",
      message: `Application orchestration recovery action ${action.type} is waiting for approval.`,
      data: {
        applicationId: actionRequest.applicationId,
        routineId: actionRequest.routineId,
        actionType: action.type,
        recoveryCategory: recoveryModel.category,
        recoveryActionRequestId: actionRequest.id,
        approvalBrokerRequestId: request.id,
      },
    });
    return request;
  }

  function resolveCodexApprovalBrokerRequest(request, action, actor = null) {
    const updated = resolveCodexApprovalBrokerRequestBase(request, action, actor);
    syncApplicationRecoveryActionApproval(updated, actor);
    return updated;
  }

  function expireCodexApprovalBrokerRequests() {
    expireCodexApprovalBrokerRequestsBase();
    for (const request of state.codexApprovalBrokerRequests) {
      if (request?.applicationRecoveryActionRequestId) {
        syncApplicationRecoveryActionApproval(request);
      }
    }
  }

  function syncApplicationRecoveryActionApproval(approvalRequest, actor = null) {
    const requestId = approvalRequest?.applicationRecoveryActionRequestId;
    if (!requestId) return;
    const actionRequest = state.applicationRecoveryActions.find((item) => item.id === requestId);
    if (!actionRequest) return;
    if (["executing", "executed", "failed"].includes(actionRequest.status)) return;
    const previousStatus = actionRequest.status;
    let nextStatus = "approval_pending";
    if (approvalRequest.status === "approved") {
      nextStatus = "approval_approved";
    } else if (approvalRequest.status === "denied") {
      nextStatus = "approval_denied";
    } else if (approvalRequest.status === "timed_out") {
      nextStatus = "approval_timed_out";
    }
    if (previousStatus === nextStatus) return;
    actionRequest.status = nextStatus;
    actionRequest.decidedAt = approvalRequest.decidedAt ?? actionRequest.decidedAt ?? null;
    // #1151: mirror who decided from the broker row (already stamped there).
    actionRequest.decidedBy = approvalRequest.decidedBy ?? actionRequest.decidedBy ?? null;
    actionRequest.updatedAt = now();
    persistStateSoon();
    if (approvalRequest.status === "pending") return;
    appendEvent({
      invocationId: actionRequest.invocationId,
      type: "application_orchestration_recovery_approval_resolved",
      level: approvalRequest.status === "approved" ? "info" : "warn",
      message: `Application orchestration recovery action ${actionRequest.actionType} approval ${approvalRequest.status}.`,
      data: {
        applicationId: actionRequest.applicationId,
        routineId: actionRequest.routineId,
        actionType: actionRequest.actionType,
        recoveryActionRequestId: actionRequest.id,
        approvalBrokerRequestId: approvalRequest.id,
        status: approvalRequest.status,
      },
    });
    if (approvalRequest.status === "approved") {
      executeApprovedApplicationRecoveryAction(actionRequest, actor);
    }
  }

  function executeApprovedApplicationRecoveryAction(actionRequest, actor = null) {
    if (actionRequest.actionType !== "regenerate_orchestration") return;
    if (actionRequest.status === "executed" || actionRequest.status === "executing") return;
    const application = findApplication(actionRequest.applicationId);
    if (!application) {
      markApplicationRecoveryActionFailed(actionRequest, "application_not_found");
      return;
    }
    const capability = (listApplicationCapabilities(actionRequest.applicationId) ?? [])
      .find((item) => item.name.endsWith(".generate_orchestration"));
    if (!capability) {
      markApplicationRecoveryActionFailed(actionRequest, "capability_not_found");
      return;
    }
    actionRequest.status = "executing";
    actionRequest.updatedAt = now();
    persistStateSoon();
    appendEvent({
      invocationId: actionRequest.invocationId,
      type: "application_orchestration_recovery_action_executing",
      level: "info",
      message: `Application orchestration recovery action ${actionRequest.actionType} is executing.`,
      data: {
        applicationId: actionRequest.applicationId,
        routineId: actionRequest.routineId,
        actionType: actionRequest.actionType,
        recoveryActionRequestId: actionRequest.id,
      },
    });
    // The recorded decision (broker approve, or the requester's own validated
    // token on the direct path) authorizes this execution: mint a grant bound to
    // it so the audit chain reads decision → grant → execution — the hard-coded
    // "operator-approved-application-recovery" magic string is gone.
    const executionToken = mintDecisionGrant({
      action: "generate_orchestration",
      targetId: application.id,
      sourceDecisionId: actionRequest.approvalRequestId ?? actionRequest.id,
      decidedBy: actor?.userId ?? null,
      teamId: actor?.teamId ?? null,
    });
    const result = createCapabilityInvocation(capability.name, {
      approvalToken: executionToken,
      recoveryActionRequestId: actionRequest.id,
      recoveryOfInvocationId: actionRequest.invocationId,
      recoveryReason: actionRequest.reason,
    }, actor);
    if (result.status >= 400) {
      markApplicationRecoveryActionFailed(actionRequest, result.body?.error ?? "execution_failed", result.body);
      return;
    }
    const orchestration = result.body?.invocation?.result?.output?.orchestration ?? null;
    actionRequest.status = "executed";
    actionRequest.resultInvocationId = result.body?.invocationId ?? null;
    actionRequest.resultOrchestrationId = orchestration?.id ?? null;
    actionRequest.resultOrchestrationRelativePath = orchestration?.relativePath ?? null;
    actionRequest.executedAt = now();
    actionRequest.updatedAt = actionRequest.executedAt;
    persistStateSoon();
    appendEvent({
      invocationId: actionRequest.invocationId,
      type: "application_orchestration_recovery_action_executed",
      level: "info",
      message: `Application orchestration recovery action ${actionRequest.actionType} executed.`,
      data: {
        applicationId: actionRequest.applicationId,
        routineId: actionRequest.routineId,
        actionType: actionRequest.actionType,
        recoveryActionRequestId: actionRequest.id,
        resultInvocationId: actionRequest.resultInvocationId,
        resultOrchestrationId: actionRequest.resultOrchestrationId,
        resultOrchestrationRelativePath: actionRequest.resultOrchestrationRelativePath,
      },
    });
  }

  function markApplicationRecoveryActionFailed(actionRequest, error, details = null) {
    actionRequest.status = "failed";
    actionRequest.error = summarizeText(error, 160);
    actionRequest.updatedAt = now();
    persistStateSoon();
    appendEvent({
      invocationId: actionRequest.invocationId,
      type: "application_orchestration_recovery_action_failed",
      level: "warn",
      message: `Application orchestration recovery action ${actionRequest.actionType} failed: ${actionRequest.error}.`,
      data: {
        applicationId: actionRequest.applicationId,
        routineId: actionRequest.routineId,
        actionType: actionRequest.actionType,
        recoveryActionRequestId: actionRequest.id,
        error: actionRequest.error,
        details,
      },
    });
  }

  function selectRecoveryAgent(sourceInvocation, body = {}) {
    const requestedAgentId = typeof body?.agentId === "string" && body.agentId.trim()
      ? body.agentId.trim()
      : null;
    const candidates = requestedAgentId
      ? [findAgent(requestedAgentId)].filter(Boolean)
      : orderedRecoveryAgentCandidates();
    if (!candidates.length) {
      return { ok: false, status: 404, error: requestedAgentId ? "agent_not_found" : "healthy_agent_not_found" };
    }
    const preferred = candidates.find((agent) => agent.id !== sourceInvocation.agentId && isAgentSelectableForRecovery(agent))
      ?? candidates.find((agent) => isAgentSelectableForRecovery(agent));
    if (!preferred) {
      const first = candidates[0];
      if (first?.status === "disabled") {
        return { ok: false, status: 409, error: "agent_disabled" };
      }
      if (first?.health?.status === "unhealthy") {
        return { ok: false, status: 409, error: "agent_unhealthy" };
      }
      if (first?.location?.type === "local_device" && state.device.unlinkState !== "linked") {
        return { ok: false, status: 409, error: "device_unlinked" };
      }
      return { ok: false, status: 409, error: "healthy_agent_not_found" };
    }
    return { ok: true, agent: preferred };
  }

  function isAgentSelectableForRecovery(agent) {
    return recoveryAgentSelectability(agent).selectable;
  }

  function recoveryAgentCandidateViews(sourceInvocation) {
    const candidates = orderedRecoveryAgentCandidates();
    const preferred = candidates.find((agent) => agent.id !== sourceInvocation.agentId && isAgentSelectableForRecovery(agent))
      ?? candidates.find((agent) => isAgentSelectableForRecovery(agent))
      ?? null;
    return candidates.map((agent) => recoveryAgentCandidateView(agent, sourceInvocation, preferred));
  }

  function recoveryAgentCandidateSnapshot(sourceInvocation, requestedAgentId = null) {
    const snapshot = recoveryAgentCandidateViews(sourceInvocation);
    const requestedAgent = requestedAgentId ? findAgent(requestedAgentId) : null;
    if (requestedAgent && !snapshot.some((candidate) => candidate.id === requestedAgent.id)) {
      snapshot.push(recoveryAgentCandidateView(requestedAgent, sourceInvocation, null));
    }
    return snapshot;
  }

  function recoveryAgentCandidateView(agent, sourceInvocation, preferred = null) {
    const selectability = recoveryAgentSelectability(agent);
    return {
      id: agent.id,
      name: agent.name ?? agent.id,
      status: agent.status ?? "unknown",
      healthStatus: agent.health?.status ?? null,
      locationType: agent.location?.type ?? null,
      adapterType: agent.adapter?.type ?? null,
      selectable: selectability.selectable,
      reasons: selectability.reasons,
      preferred: preferred?.id === agent.id,
      sourceAgent: agent.id === sourceInvocation.agentId,
    };
  }

  function recoveryAgentSelectability(agent) {
    const reasons = [];
    if (!agent) {
      return { selectable: false, reasons: ["agent_not_found"] };
    }
    if (!hasApplicationControlCapability(agent)) reasons.push("application_control_missing");
    if (agent.status === "disabled") reasons.push("agent_disabled");
    if (agent.status === "unavailable") reasons.push("agent_unavailable");
    if (agent.health?.status === "unhealthy") reasons.push("agent_unhealthy");
    if (agent.location?.type === "local_device" && state.device.unlinkState !== "linked") reasons.push("device_unlinked");
    return {
      selectable: reasons.length === 0,
      reasons,
    };
  }

  function orderedRecoveryAgentCandidates() {
    const applicationControl = state.agents.find((agent) => agent?.id === "agt_platform_application_control");
    return [
      applicationControl,
      ...state.agents.filter((agent) => agent && agent.id !== applicationControl?.id && hasApplicationControlCapability(agent)),
    ].filter(Boolean);
  }

  function hasApplicationControlCapability(agent) {
    return Array.isArray(agent?.capabilities)
      && agent.capabilities.some((capability) => capability?.name === "application_control");
  }

  /**
   * Mint an id that the state does not already hold (#832).
   *
   * The counter alone is not a guarantee: it lives in memory, it is restored from
   * a snapshot, and `resetIdCounter` exists. Any of those going wrong used to mint
   * an id that already existed — and nothing complained, because nothing checked.
   * The store then held two records under one key, `find` returned an arbitrary
   * one, and the other became a ghost: unreachable by its own id, invisible to
   * every read, still very much alive to the scheduler.
   *
   * So uniqueness is enforced HERE, at the only place ids are born, rather than
   * being an invariant the rest of the system hopes for. A wrong counter now costs
   * a gap in the numbering. It cannot cost a duplicate.
   */
  function nextId(prefix) {
    for (;;) {
      const id = `${prefix}_${String(idCounter).padStart(4, "0")}`;
      idCounter += 1;
      state.idCounter = idCounter;
      if (issuedIds.has(id)) continue;
      issuedIds.add(id);
      return id;
    }
  }

  function findInvocation(id) {
    return invocationService?.findInvocation(id) ?? state.invocations.find((item) => item.id === id);
  }

  function findApprovalRequest(id) {
    return invocationService?.findApprovalRequest(id) ?? state.approvalRequests.find((item) => item.id === id);
  }

  function defaultAgent() {
    return invocationService?.defaultAgent() ?? selectDefaultAgent(state.agents);
  }

  function uniqueStrings(values) {
    return [...new Set(values.map(String).map((item) => item.trim()).filter(Boolean))];
  }

  function clampNumber(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.max(min, Math.min(max, Math.floor(number)));
  }

  function summarizeText(value, maxLength = 160) {
    const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!normalized) {
      return "";
    }
    return normalized.length <= maxLength ? normalized : `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
  }

  function applicationRoutineTask({ application, orchestration, routine, validation }) {
    const location = orchestration.relativePath ?? orchestration.path ?? `routine ${orchestration.routineId}`;
    return [
      `Run application orchestration ${orchestration.routineId} for ${application.name}.`,
      `Use ${location} as the validated LoopRoutine draft.`,
      `Routine name: ${routine.metadata?.name ?? orchestration.routineId}.`,
      `Goal: ${routine.goal?.summary ?? "Inspect the registered application and report findings."}`,
      `Safety policy: remoteWrites=${validation.policy.remoteWrites}, githubWrites=${validation.policy.githubWrites}, fanout.apply=${validation.policy.fanoutApply}.`,
      "Execute only allowed steps, keep all side effects under the platform approval policy, and report audit-friendly evidence.",
    ].join("\n");
  }

  function applicationOrchestrationRunSummary(invocation) {
    const metadata = invocation.options?.metadata ?? {};
    const auditSummary = state.auditSummaries.find((item) => item.invocationId === invocation.id);
    return {
      invocationId: invocation.id,
      status: invocation.status,
      agentId: invocation.agentId,
      projectId: invocation.projectId ?? metadata.projectId ?? null,
      worktreeId: invocation.worktreeId ?? metadata.worktreeId ?? null,
      deliveryState: invocation.delivery?.state ?? null,
      cancellationState: invocation.cancellation?.state ?? null,
      resultSummary: invocation.result?.summary ?? null,
      errorSummary: auditSummary?.errorSummary ?? null,
      createdAt: invocation.createdAt ?? null,
      updatedAt: invocation.updatedAt ?? null,
      completedAt: invocation.completedAt ?? null,
      metadata: {
        source: metadata.source ?? null,
        applicationId: metadata.applicationId ?? null,
        applicationName: metadata.applicationName ?? null,
        routineId: metadata.routineId ?? null,
        routineName: metadata.routineName ?? null,
        orchestrationRelativePath: metadata.orchestrationRelativePath ?? null,
        retryOfInvocationId: metadata.retryOfInvocationId ?? null,
        retryReason: metadata.retryReason ?? null,
        recoveryActionType: metadata.recoveryActionType ?? null,
        recoveryOfInvocationId: metadata.recoveryOfInvocationId ?? null,
        recoveryReason: metadata.recoveryReason ?? null,
        recoveryCategory: metadata.recoveryCategory ?? null,
      },
    };
  }

  function applicationOrchestrationRunDetail(invocation) {
    const summary = applicationOrchestrationRunSummary(invocation);
    const auditSummary = state.auditSummaries.find((item) => item.invocationId === invocation.id);
    return {
      ...summary,
      traceId: invocation.traceId ?? auditSummary?.traceId ?? null,
      rootSpanId: invocation.rootSpanId ?? null,
      approvalRequestId: invocation.approvalRequestId ?? null,
      policyDecisionId: invocation.policyDecisionId ?? null,
      delivery: invocation.delivery ?? null,
      cancellation: invocation.cancellation ?? null,
      result: invocation.result ?? null,
      audit: auditSummary ? {
        permissionDecision: auditSummary.permissionDecision ?? null,
        errorSummary: auditSummary.errorSummary ?? null,
        traceId: auditSummary.traceId ?? null,
        costSummary: auditSummary.costSummary ?? null,
      } : null,
      metadata: invocation.options?.metadata ?? summary.metadata,
    };
  }

  function applicationOrchestrationRunEvents(invocationId) {
    return state.events
      .filter((event) => event.invocationId === invocationId)
      .sort((left, right) => Date.parse(left.createdAt ?? "") - Date.parse(right.createdAt ?? ""));
  }

  function applicationOrchestrationRecovery(invocation, events, recoveryActions = []) {
    const auditSummary = state.auditSummaries.find((item) => item.invocationId === invocation.id);
    const haystack = [
      invocation.status,
      invocation.delivery?.state,
      invocation.cancellation?.state,
      invocation.result?.summary,
      auditSummary?.errorSummary,
      ...events.flatMap((event) => [event.type, event.level, event.message]),
    ].filter(Boolean).join(" ").toLowerCase();
    const eventTypes = events.map((event) => String(event.type ?? "").toLowerCase());
    const deliveryState = String(invocation.delivery?.state ?? "").toLowerCase();
    const cancellationState = String(invocation.cancellation?.state ?? "").toLowerCase();

    // One recovery model per category, so the structured path and the haystack
    // fallback below can never drift apart on actions or approval requirements.
    const categorized = {
      cancelled: (confidence) => recovery("cancelled", confidence, true, "The run was cancelled before completion.", [
        action("rerun", "Re-run orchestration", "Start a new governed run if the cancellation was intentional or transient.", false, { invocationId: invocation.id }),
        action("view_invocation", "Review cancellation context", "Inspect the invocation timeline before retrying a user-cancelled run.", false, { invocationId: invocation.id }),
      ], recoveryActions),
      validation_failed: (confidence) => recovery("validation_failed", confidence, false, "The LoopRoutine draft or policy validation needs correction before retrying.", [
        action("regenerate_orchestration", "Regenerate orchestration", "Generate a fresh governed routine draft for the application.", true, { applicationId: invocation.options?.metadata?.applicationId ?? null }),
        action("view_invocation", "Inspect validation evidence", "Review the failing validation message and routine metadata.", false, { invocationId: invocation.id }),
      ], recoveryActions),
      agent_unavailable: (confidence) => recovery("agent_unavailable", confidence, true, "The selected agent was unavailable or unhealthy.", [
        action("select_agent", "Select a healthy agent", "Retry with an available governed agent.", false, { agentId: invocation.agentId ?? null }),
        action("view_invocation", "Inspect agent state", "Review the failed invocation and agent health context.", false, { invocationId: invocation.id }),
      ], recoveryActions),
      device_unlinked: (confidence) => recovery("device_unlinked", confidence, true, "The local device bridge is unlinked or unavailable.", [
        action("relink_device", "Relink device", "Restore Desktop Bridge credentials before retrying local-device work.", true, { agentId: invocation.agentId ?? null }),
        action("rerun", "Re-run after relink", "Start a new governed run once the bridge is linked.", false, { invocationId: invocation.id }),
      ], recoveryActions),
      dispatch_timeout: (confidence) => recovery("dispatch_timeout", confidence, true, "The run did not reach the bridge cleanly or needed redelivery.", [
        action("rerun", "Re-run orchestration", "Retry the governed run after confirming the bridge is online.", false, { invocationId: invocation.id }),
        action("view_invocation", "Inspect delivery attempts", "Check dispatch attempts and bridge cursor details.", false, { invocationId: invocation.id }),
      ], recoveryActions),
      approval_timeout: (confidence) => recovery("approval_timeout", confidence, false, "The approval window expired before the run was allowed to continue.", [
        action("view_invocation", "Review expired approval", "Open the invocation to approve and resume the linked task when recovery is available.", false, { invocationId: invocation.id }),
      ], recoveryActions),
      execution_timeout: (confidence) => recovery("execution_timeout", confidence, true, invocation.result?.summary ?? "The executor exceeded its configured runtime.", [
        action("rerun", "Continue the governed run", "Resume from the existing governed context after an execution timeout.", false, { invocationId: invocation.id }),
        action("view_invocation", "Inspect timeout evidence", "Review the execution timeline and partial result before retrying.", false, { invocationId: invocation.id }),
      ], recoveryActions),
      policy_blocked: (confidence) => recovery("policy_blocked", confidence, false, "The run appears blocked by policy or approval handling.", [
        action("view_invocation", "Review policy decision", "Inspect approval and policy events before retrying.", true, { invocationId: invocation.id }),
      ], recoveryActions),
      runtime_error: (confidence) => recovery("runtime_error", confidence, true, auditSummary?.errorSummary ?? invocation.result?.summary ?? "The run failed during execution.", [
        action("rerun", "Re-run orchestration", "Retry if the failure is transient or after applying the indicated fix.", false, { invocationId: invocation.id }),
        action("view_invocation", "Inspect runtime error", "Review result, audit summary, and timeline details.", false, { invocationId: invocation.id }),
      ], recoveryActions),
    };

    if (["succeeded", "completed"].includes(invocation.status)) {
      return recovery("none", 0.99, false, "No recovery needed.", [
        action("view_invocation", "Review audit trail", "Open the invocation if you need evidence for the successful run.", false, { invocationId: invocation.id }),
      ], recoveryActions);
    }
    if (invocation.status === "cancelled" || cancellationState === "cancelled" || eventTypes.some((type) => type.includes("cancel"))) {
      return categorized.cancelled(0.9);
    }
    // Structured signal first: a bridge that declares the failure class via
    // result.errorCode (one of the recovery categories) is authoritative — the
    // free-text haystack below is inference and stays as the fallback for
    // completions that don't carry a code. This is what keeps auto-recovery from
    // rerunning a failure that actually needs an approval-gated fix just because
    // the error text didn't contain the right keyword.
    const declaredCode = String(invocation.result?.errorCode ?? "").trim().toLowerCase();
    if (categorized[declaredCode]) {
      return categorized[declaredCode](0.95);
    }
    if (haystack.includes("invalid_application_routine") || haystack.includes("validation") || haystack.includes("invalid routine")) {
      return categorized.validation_failed(0.86);
    }
    if (haystack.includes("agent_disabled") || haystack.includes("agent_unhealthy") || haystack.includes("agent_not_found") || haystack.includes("unhealthy") || haystack.includes("disabled")) {
      return categorized.agent_unavailable(0.84);
    }
    if (haystack.includes("device_unlinked") || haystack.includes("device credentials") || haystack.includes("unlinked")) {
      return categorized.device_unlinked(0.88);
    }
    if (deliveryState === "dispatching" || deliveryState === "redelivering" || haystack.includes("dispatch lease expired") || eventTypes.includes("delivery_redelivered")) {
      return categorized.dispatch_timeout(0.78);
    }
    if (haystack.includes("policy_blocked") || haystack.includes("policy denied") || haystack.includes("approval denied") || haystack.includes("requires_local_approval") || eventTypes.includes("invocation_rejected")) {
      return categorized.policy_blocked(0.72);
    }
    if (auditSummary?.errorSummary || invocation.status === "failed" || eventTypes.some((type) => type.endsWith("_failed") || type.includes("failure"))) {
      return categorized.runtime_error(0.74);
    }
    return recovery("unknown_failure", 0.35, false, "No specific recovery path could be inferred from the recorded evidence.", [
      action("view_invocation", "Inspect invocation", "Review the full invocation before choosing a recovery action.", false, { invocationId: invocation.id }),
    ], recoveryActions);
  }

  function recovery(category, confidence, retryRecommended, summary, actions, recoveryActions = []) {
    const rankedActions = rankRecoveryActions(category, actions, recoveryActions);
    return {
      category,
      confidence,
      retryRecommended,
      humanApprovalRequired: rankedActions.some((item) => item.requiresApproval),
      summary,
      actions: rankedActions,
    };
  }

  function action(type, label, description, requiresApproval, target = {}) {
    return { type, label, description, requiresApproval, target };
  }

  function rankRecoveryActions(category, actions, recoveryActions = []) {
    const preferredActionType = preferredRecoveryActionType(category);
    return actions
      .map((item) => {
        const priority = recoveryActionPriority(category, item, preferredActionType);
        const availability = recoveryActionAvailability(item, recoveryActions);
        return {
          ...item,
          priority,
          recommended: item.type === preferredActionType,
          recommendationReason: recoveryActionRecommendationReason(category, item.type, item.type === preferredActionType),
          riskLevel: recoveryActionRiskLevel(item),
          availability,
          blockedReason: availability.blockedReason,
          warningReason: availability.warningReason,
          latestRequestId: availability.latestRequestId,
        };
      })
      .sort((left, right) => left.priority - right.priority || left.label.localeCompare(right.label));
  }

  function applicationRecoveryActionsForRun(applicationId, routineId, invocationId) {
    return (state.applicationRecoveryActions ?? [])
      .filter((request) => request.applicationId === applicationId
        && request.routineId === routineId
        && request.invocationId === invocationId)
      .sort((left, right) => Date.parse(right.updatedAt ?? right.createdAt ?? "") - Date.parse(left.updatedAt ?? left.createdAt ?? ""));
  }

  function recoveryActionAvailability(item, recoveryActions) {
    const latestSameType = recoveryActions.find((request) => request.actionType === item.type) ?? null;
    if (!latestSameType) {
      return {
        state: "available",
        blockedReason: null,
        warningReason: null,
        latestRequestId: null,
      };
    }
    if (["requested", "approval_pending", "approval_approved", "executing"].includes(latestSameType.status)) {
      return {
        state: "blocked",
        blockedReason: latestSameType.status === "approval_pending" ? "same_action_approval_pending" : "same_action_in_progress",
        warningReason: null,
        latestRequestId: latestSameType.id,
      };
    }
    if (latestSameType.status === "failed") {
      return {
        state: "warning",
        blockedReason: null,
        warningReason: "same_action_recently_failed",
        latestRequestId: latestSameType.id,
      };
    }
    return {
      state: "available",
      blockedReason: null,
      warningReason: null,
      latestRequestId: latestSameType.id,
    };
  }

  function preferredRecoveryActionType(category) {
    const preferred = {
      agent_unavailable: "select_agent",
      cancelled: "rerun",
      device_unlinked: "relink_device",
      dispatch_timeout: "rerun",
      approval_timeout: "view_invocation",
      execution_timeout: "rerun",
      none: "view_invocation",
      policy_blocked: "view_invocation",
      runtime_error: "rerun",
      unknown_failure: "view_invocation",
      validation_failed: "regenerate_orchestration",
    };
    return preferred[category] ?? "view_invocation";
  }

  function recoveryActionPriority(category, item, preferredActionType) {
    if (item.type === preferredActionType) return 10;
    if (item.type === "view_invocation") return 80;
    if (item.requiresApproval) return 60;
    if (category === "device_unlinked" && item.type === "rerun") return 40;
    return 50;
  }

  function recoveryActionRecommendationReason(category, actionType, recommended) {
    if (!recommended) {
      if (actionType === "view_invocation") return "Use this to inspect evidence before taking a side-effecting recovery action.";
      if (actionType === "rerun") return "Use after the blocking condition has been resolved.";
      return "Available as an alternate governed recovery path.";
    }
    const reasons = {
      agent_unavailable: "The source agent appears unavailable or unhealthy, so retrying on a healthy governed agent is the best next step.",
      cancelled: "The run was cancelled, so a fresh governed run is the safest recovery.",
      device_unlinked: "The local device bridge appears unlinked, so relinking must happen before local-device work can recover.",
      dispatch_timeout: "The run did not dispatch cleanly, so a fresh governed run is the most direct recovery.",
      approval_timeout: "The approval window expired, so the recorded decision should be reviewed before resuming.",
      execution_timeout: "The executor exceeded its runtime, so a bounded governed continuation is the most direct recovery.",
      none: "The run completed successfully; inspecting the audit trail is the only recovery action needed.",
      policy_blocked: "Policy or approval evidence should be reviewed before attempting another side-effecting action.",
      runtime_error: "The run failed during execution; a governed rerun is the lowest-risk automated recovery.",
      unknown_failure: "The failure evidence is not specific enough to choose an automated recovery safely.",
      validation_failed: "The routine failed validation, so regenerating the orchestration addresses the likely source of failure.",
    };
    return reasons[category] ?? "Recommended based on the recorded recovery category.";
  }

  function recoveryActionRiskLevel(item) {
    if (item.requiresApproval) return "high";
    if (["rerun", "select_agent"].includes(item.type)) return "medium";
    return "low";
  }

  function appendRecoveryActionEvent(kind, invocationId, applicationId, routineId, actionType, recoveryCategory, reason, actionRequest = null) {
    const requested = kind === "requested";
    const pending = kind === "approval_pending";
    const data = {
      applicationId,
      routineId,
      actionType,
      recoveryCategory,
      reason,
      recoveryActionRequestId: actionRequest?.id ?? null,
      status: actionRequest?.status ?? null,
      approvalRequestId: actionRequest?.approvalRequestId ?? null,
    };
    if (requested || pending) {
      appendEvent({
        invocationId,
        type: "application_orchestration_recovery_action_requested",
        level: "info",
        message: pending
          ? `Application orchestration recovery action ${actionType} is pending approval.`
          : `Application orchestration recovery action ${actionType} requested.`,
        data,
      });
      return;
    }
    // A rejected recovery action is a policy refusal: the requested action is not
    // permitted for this application in its current state.
    refuse({
      subject: { kind: "application_action", id: actionRequest?.id ?? applicationId },
      requester: { kind: "automation", id: routineId ?? applicationId },
      category: "policy",
      code: "action_not_permitted",
      decidedBy: { kind: "policy_engine", id: "recovery_arbiter" },
      summary: `Recovery action ${actionType} was not permitted.`,
      evidence: data,
      remedy: reason || "The recovery action is not suggested or is blocked for this application.",
      retryAfter: null,
      appealTo: "device_owner",
      event: {
        invocationId,
        type: "application_orchestration_recovery_action_rejected",
        level: "warn",
        message: `Application orchestration recovery action ${actionType} rejected.`,
        data,
      },
    });
  }

  // The recovery-action bypass gate. Historically this accepted only the
  // "operator-approved" free-text prefix — dual-accept must not WEAKEN it, so
  // legacy fallback stays restricted to that prefix while issued grants (action
  // "recovery_action" on the application) become the proper path.
  function isApplicationRecoveryActionApproved(token, applicationId, actor = null) {
    const raw = String(token ?? "").trim();
    if (!raw) return false;
    return validateApprovalToken(raw, {
      action: "recovery_action",
      targetId: applicationId,
      actor,
      allowLegacy: raw.startsWith("operator-approved"),
    }).approved;
  }

  function applicationOrchestrationScope(applicationId, routineId) {
    const application = findApplication(applicationId);
    if (!application) {
      return { status: 404, body: { error: "application_not_found" } };
    }
    const orchestration = (application.orchestrations ?? []).find((item) => item?.routineId === routineId);
    if (!orchestration) {
      return { status: 404, body: { error: "orchestration_not_found", applicationId, routineId } };
    }
    return { status: 200, application, orchestration };
  }

  function getScopedApplicationOrchestrationInvocation(applicationId, routineId, invocationId) {
    const scope = applicationOrchestrationScope(applicationId, routineId);
    if (scope.status !== 200) return scope;
    const invocation = findInvocation(invocationId);
    if (!invocation || !isApplicationOrchestrationRun(invocation, applicationId, routineId)) {
      return { status: 404, body: { error: "orchestration_run_not_found", applicationId, routineId, invocationId } };
    }
    return { status: 200, invocation };
  }

  function isApplicationOrchestrationRun(invocation, applicationId, routineId) {
    const metadata = invocation?.options?.metadata;
    return metadata?.source === "application_orchestration"
      && metadata.applicationId === applicationId
      && metadata.routineId === routineId;
  }

  function isManagedApplicationRoutinePath(application, path) {
    const applicationSegment = String(application.id ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72);
    if (!applicationSegment) return false;
    const routinesRoot = resolve(defaultProjectPath || process.cwd(), ".myagenttool", "applications", applicationSegment, "routines");
    const target = resolve(path);
    return target === routinesRoot || target.startsWith(routinesRoot + sep);
  }

  function unlinkDevice() {
    state.device.status = "offline";
    state.device.unlinkState = "unlinked";
    state.device.credentialRevokedAt = now();
    if (state.device.bridgeCredential) {
      state.device.bridgeCredential.revokedAt = state.device.credentialRevokedAt;
    }
    state.device.updatedAt = now();
    for (const agent of state.agents.filter((item) => item.location.type === "local_device")) {
      if (isAgentDisabled(agent)) {
        agent.updatedAt = now();
        continue;
      }
      agent.status = "unavailable";
      agent.updatedAt = now();
    }
    cancelInvocationsForDeviceUnlink();
    appendEvent({
      invocationId: null,
      type: "device_unlinked",
      level: "info",
      message: "Desktop Bridge device credentials were revoked for unlink."
    });
  }

  // Re-pair recovery (the counterpart to unlinkDevice): clear the stored credential so
  // the NEXT bridge register issues a fresh one (the hasCredential=false path) and
  // (re)link the device. This is the clean operator recovery for a credential that
  // idle-expired (server down past the TTL) or whose bridge token was lost — replacing
  // the manual "stop server + hand-edit state.device.bridgeCredential" surgery.
  function relinkDevice() {
    state.device.status = "offline"; // until the bridge re-registers with the fresh credential
    state.device.unlinkState = "linked";
    state.device.credentialRevokedAt = null;
    state.device.bridgeCredential = null;
    state.device.livenessLostAt = null;
    state.device.updatedAt = now();
    appendEvent({
      invocationId: null,
      type: "device_relinked",
      level: "info",
      message: "Device re-paired; the Desktop Bridge will re-register with a fresh credential.",
    });
  }

  const selfCheckDependencies = {
    acknowledgeInvocation,
    appendEvent,
    approveInvocation,
    cancelInvocation,
    codexSessionForInvocation,
    completeDiscoveryRun,
    completeHealthCheck,
    completeIntegrationProbeRun,
    completeInvocation,
    createAgentHealthCheck,
    createCapabilityInvocation,
    cancelApplicationInstall,
    completeApplicationInstall,
    findApplication,
    findApplicationInstallRun,
    getApplicationOrchestrationRunRecovery,
    listApplicationOrchestrationRecoveryAgentCandidates,
    getApplicationOrchestrationRun,
    invokeApplicationCapability,
    getCapability,
    listApplicationCapabilities,
    listCapabilities,
    resolveCapability,
    listApplications,
    listApplicationOrchestrationRunEvents,
    listApplicationOrchestrationRuns,
    probeApplication,
    repairApplication,
    queueApplicationInstall,
    recordApplicationInstallProgress,
    registerApplication,
    requestApplicationOrchestrationRecoveryAction,
    readApplicationRecoveryArchive,
    runApplicationOrchestration,
    setApplicationAutoRecovery,
    issueApprovalGrant,
    bridgeLivenessSweep,
    setApplicationHealthProbe,
    applicationHealthSweep,
    transitionApplication,
    createCodexChangeReview,
    createCodexExecReview,
    setCodexSessionName,
    setClaudeSessionName,
    resumableClaudeSessions,
    resumableCodexSessions,
    isExecChangeApproved,
    execRunPromotionGate,
    createCodexImportedEvidenceRecord,
    createCompareRun,
    setCompareRunPreferred,
    promoteCompareRun,
    createDiscoveryRun,
    createIntegrationArtifact,
    createIntegrationProbeRun,
    createInvocation,
    createManagedCodexSession,
    createManagedCodexWorkspace,
    createManagedTerminalSession,
    createSshConnectionTest,
    createSshTarget,
    createTroubleshootingReport,
    claimDecision,
    releaseDecisionClaim,
    createToolInvocation,
    defaultAgent,
    disableAgent,
    denyInvocation,
    enableAgent,
    evidenceCenterRecords,
    expireCodexApprovalBrokerRequests,
    findAgent,
    findApprovalRequest,
    findInvocation,
    generateIntegrationArtifacts,
    getAgentUsageSummary,
    getTool,
    chargebackExport,
    completeLifecycleAction,
    createAuditExportRequest,
    markDispatched,
    markDiscoveryStarted,
    markHealthCheckStarted,
    markIntegrationProbeStarted,
    nextBridgeDiscoveryRun,
    nextBridgeHealthCheck,
    nextDispatchableInvocation,
    isInvocationDispatchable,
    nextTerminalBridgeAction,
    queueTerminalBridgeAction,
    recordApplicationResult,
    recordCcusageImportedEstimates,
    recordCodexHookEvent,
    recordTerminalBridgeEvent,
    redeliverExpiredDispatches,
    registerAgent,
    registerDiscoveredCandidate,
    registerIntegrationArtifact,
    createLifecycleRecipe,
    createPrivateCatalogEntry,
    createSignedBundleManifest,
    createQuotaPolicy,
    decideLifecycleLocalApproval,
    evaluateLifecyclePolicy,
    enforcePlatformAiQuota,
    findLifecycleLocalApproval,
    findLifecycleRollbackRequest,
    findLifecycleRecipe,
    findPrivateCatalogEntry,
    markLifecycleActionStarted,
    nextBridgeLifecycleAction,
    queueLifecycleAction,
    queueRollbackAction,
    recordAiUsage,
    requestLifecycleLocalApproval,
    // The self-check resets the demo state, then resets the counter. Rebuild the
    // issued-id set from whatever the reset LEFT BEHIND (it keeps the default
    // agents, projects, …) — clearing it blindly would disarm the very guard that
    // makes a reset counter safe (#832).
    resetIdCounter: () => {
      idCounter = 1;
      state.idCounter = 1;
      issuedIds = collectRecordIds(state);
    },
    resolveCodexApprovalBrokerRequest,
    startInvocationIfAllowed,
    state,
    transitionIntegrationArtifact,
    transitionLifecycleRecipe,
    updatePrivateDeploymentConfig,
    unlinkDevice,
    relinkDevice,
    listTools,
    now,
  };

  // Per-round telemetry ingestion (#808): folds bridge round_* / tool events
  // into state.invocationRounds / state.toolInvocationRecords + child spans.
  const { recordRoundEvent } = createRoundTelemetryRuntime({
    state,
    now,
    nextId,
    appendEvent,
    persistStateSoon,
    capWithArchive: retentionArchive.capWithArchive,
    archiveEvicted: retentionArchive.archiveEvicted,
    store,
  });

  const httpDependencies = {
    state,
    now,
    // #1302 long-poll: the bridge cancellations route waits on this shared signal.
    cancellationSignal,
    recordRoundEvent,
    // Agent file ledger: accumulate a run's read/written files (deduped, capped)
    // from the bridge's tool_use stream. Stored on the invocation so it ships to
    // the client with state.invocations. See read-models/file-ledger.mjs.
    recordAgentFileAccess: (invocation, accesses) => {
      if (!invocation || !Array.isArray(accesses) || accesses.length === 0) return;
      invocation.fileLedger = mergeFileAccesses(invocation.fileLedger, accesses);
      persistStateSoon();
    },
    // Request context (wrapper-visible SUMMARY): model, permission mode, and the
    // tool/MCP/skill/agent inventory the run was dispatched with, from the CLI's
    // stream-json init event. First report wins — a run has one setup. Stored on
    // the invocation so it ships with state.invocations. See
    // read-models/request-context.mjs (NOT the raw provider envelope).
    recordRequestContext: (invocation, raw) => {
      if (!invocation || invocation.requestContext) return;
      const context = sanitizeRequestContext(raw);
      if (!context) return;
      invocation.requestContext = context;
      persistStateSoon();
    },
    publicState,
    currentLoopRoutineProjectContext,
    currentProject,
    addProject,
    cloneProject,
    createBlankProject,
    createTaskMaterialDraft: taskMaterialService.createDraft,
    getTaskMaterialDraft: taskMaterialService.getDraft,
    uploadTaskMaterialFile: taskMaterialService.uploadFile,
    removeTaskMaterialFile: taskMaterialService.removeFile,
    readTaskMaterialContent: taskMaterialService.readContent,
    previewTaskMaterialCleanup: taskMaterialService.cleanupPreview,
    executeTaskMaterialCleanup: taskMaterialService.executeCleanup,
    createWorktree,
    createWorktreePr,
    publishWorktreeBranch,
    promoteWorktreeToBase,
    promoteWorktreeToPullRequest,
    ensureLocalOrigin,
    enqueueWorkItemAutoRunUnderstanding: workItemAutoRunUnderstandingService.enqueue,
    reconcileWorkItemAutoRunUnderstanding: workItemAutoRunUnderstandingService.reconcile,
    reserveAutoRun,
    attachAutoRunExecutionPlan,
    failAutoRunUnderstanding,
    startAutoRun,
    retryAutoRun,
    reverifyAutoRun,
    recoverTimedOutCodexApproval: codexApprovalRecovery.recoverTimedOutApproval,
    processPlanningRecommendedActions,
    cancelAutoRun,
    stopAutoRunDelivery,
    reapStuckAutoRuns,
    sweepWorkItemAutoRunBatches: workItemAutoRunBatchService.sweepBatches,
    sweepWorkItemAutoScheduler: workItemAutoSchedulerService.sweep,
    sweepExpiredClaims,
    sweepAutoRunSloAlerts,
    sweepAlertOutbox: alertOutbox.sweep,
    sweepWorkItemOperationalAlerts: workItemService.sweepOperationalAlerts,
    sweepWorkItemFollowUpReminders: workItemService.sweepFollowUpReminders,
    sweepTaskMaterialDrafts: taskMaterialService.sweepExpired,
    flushTraceExport,
    requestObservabilityDeletion,
    autoMergeSweep,
    claimIssue,
    releaseIssueClaim,
    listIssueClaims,
    approveDesign,
    rejectDesign,
    answerClarify,
    approveDecomposition,
    rejectDecomposition,
    mergeAutoRunPr,
    recordRoutingOverride,
    refreshAutoRunPrDispositions,
    createMailIssueFromImport,
    replyOnIssue,
    confirmReplyDraft,
    sendConfirmedDraft,
    mailboxSnapshot: mailboxService.snapshot,
    startMailboxSync: mailboxService.startSync,
    prioritizeMailboxBodyPrefetch: mailboxService.prioritizeBodyPrefetch,
    setMailboxMessageRead: mailboxService.setMessageRead,
    createMailboxDraft: mailboxService.createDraft,
    updateMailboxDraft: mailboxService.updateDraft,
    deleteMailboxDraft: mailboxService.deleteDraft,
    createMailboxTask: mailboxService.createTaskFromMessage,
    listMailResponsePackages: mailboxService.listResponsePackages,
    createMailResponsePackage: mailboxService.createResponsePackage,
    materializeMailResponsePackage: mailboxService.materializeResponsePackage,
    reviewMailResponsePackage: mailboxService.reviewResponsePackage,
    attachMailResponsePackageFiles: mailboxService.attachResponsePackageFiles,
    createMailDraftFromResponsePackage: mailboxService.createDraftFromResponsePackage,
    listMailTaskPolicies: mailboxService.listTaskPolicies,
    upsertMailTaskPolicy: mailboxService.upsertTaskPolicy,
    evaluateMailTaskPolicies: mailboxService.evaluateTaskPolicies,
    getMailTaskOperations: mailboxService.taskOperations,
    startMailClassification: mailboxService.startClassification,
    previewMailSemanticClassification: mailboxService.previewSemanticClassification,
    getMailClassificationJob: mailboxService.getClassificationJob,
    cancelMailClassificationJob: mailboxService.cancelClassificationJob,
    correctMailClassification: mailboxService.correctClassification,
    listMailClassificationRules: mailboxService.listClassificationRules,
    getMailClassificationQuality: mailboxService.getClassificationQuality,
    createMailClassificationRule: mailboxService.createClassificationRule,
    updateMailClassificationRule: mailboxService.updateClassificationRule,
    listMailFolderSuggestions: mailboxService.listFolderSuggestions,
    createMailFolderMovePreview: mailboxService.createFolderMovePreview,
    startMailFolderMove: mailboxService.startFolderMove,
    getMailFolderMoveJob: mailboxService.getFolderMoveJob,
    listMailFolderMoveJobs: mailboxService.listFolderMoveJobs,
    reconcileMailFolderMoveJob: mailboxService.reconcileFolderMoveJob,
    createMailFolderRecoveryPreview: mailboxService.createFolderRecoveryPreview,
    createMailFolderAutomationPreview: mailboxService.createFolderAutomationPreview,
    enableMailFolderAutomation: mailboxService.enableFolderAutomation,
    updateMailFolderAutomation: mailboxService.updateFolderAutomation,
    listMailFolderAutomations: mailboxService.listFolderAutomations,
    dryRunMailFolderAutomation: mailboxService.dryRunFolderAutomation,
    rebuildLocalContentCatalog: localContentCatalogService.rebuild,
    searchLocalContent: localContentCatalogService.search,
    browseLocalContentDirectories: localContentCatalogService.browseDirectories,
    describeLocalContentRetrieval: localContentRetrievalService.describe,
    retrieveLocalContentDirectories: localContentRetrievalService.directory,
    retrieveLocalContentSummaries: localContentRetrievalService.summaries,
    readRetrievedLocalContent: localContentRetrievalService.read,
    getLocalContentCatalogStats: localContentCatalogService.stats,
    previewLocalContent: localContentCatalogService.preview,
    previewLocalContentAsset: localContentCatalogService.previewAsset,
    refreshLocalContent: localContentCatalogService.refresh,
    getLocalContentHealth: localContentCatalogService.health,
    resolveLocalContentOriginal: localContentCatalogService.resolveOriginal,
    resolveLocalContentContainer: localContentCatalogService.resolveContainer,
    registerChannel: channelService.registerChannel,
    listChannels: channelService.listChannels,
    listChannelInteractions: channelService.listChannelInteractions,
    enableChannel: channelService.enableChannel,
    disableChannel: channelService.disableChannel,
    channelHealth: channelService.channelHealth,
    channelDiagnostics: channelService.channelDiagnostics,
    mapChannelIdentity: channelService.mapChannelIdentity,
    removeChannelIdentity: channelService.removeChannelIdentity,
    listChannelIdentities: channelService.listChannelIdentities,
    setChannelAllowlist: channelService.setChannelAllowlist,
    setChannelTaskProject: channelService.setChannelTaskProject,
    setChannelApprovalPolicy: channelService.setChannelApprovalPolicy,
    listCanvasScenes: canvasSceneService.listScenes,
    getCanvasScene: canvasSceneService.getScene,
    createCanvasScene: canvasSceneService.createScene,
    updateCanvasScene: canvasSceneService.updateScene,
    deleteCanvasScene: canvasSceneService.deleteScene,
    listWorkItems: workItemService.listWorkItems,
    getHomeWorkbench: workItemService.getHomeWorkbench,
    listWorkItemAttention: workItemService.listAttention,
    getWorkItem: workItemService.getWorkItem,
    createWorkItem: workItemService.createWorkItem,
    createWorkItemFromExternal: workItemService.createWorkItemFromExternal,
    addWorkItemMaterials: workItemService.addMaterials,
    removeWorkItemMaterial: workItemService.removeMaterial,
    captureWorkItemDataContext: workItemService.captureDataContextSnapshot,
    restoreWorkItemMaterial: workItemService.restoreMaterial,
    addWorkItemContentReference: workItemService.addContentReference,
    removeWorkItemContentReference: workItemService.removeContentReference,
    updateWorkItem: workItemService.updateWorkItem,
    recordWorkItemProgress: workItemService.recordWorkItemProgress,
    bulkUpdateWorkItems: workItemService.bulkUpdateWorkItems,
    transitionWorkItem: workItemService.transitionWorkItem,
    beginWorkItemExecution: workItemService.beginExecution,
    abortWorkItemExecution: workItemService.abortExecution,
    beginWorkItemDelivery: workItemService.beginDelivery,
    failWorkItemDelivery: workItemService.failDelivery,
    completeWorkItemDelivery: workItemService.completeDelivery,
    listWorkItemActivity: workItemService.listActivity,
    listWorkItemComments: workItemService.listComments,
    createWorkItemComment: workItemService.createComment,
    updateWorkItemComment: workItemService.updateComment,
    deleteWorkItemComment: workItemService.deleteComment,
    recordWorkItemExecutionBinding: workItemService.recordExecutionBinding,
    createWorkItemAutoRunBatch: workItemAutoRunBatchService.createBatch,
    listWorkItemAutoRunBatches: workItemAutoRunBatchService.listBatches,
    previewWorkItemAutoScheduler: workItemAutoSchedulerService.preview,
    claimWorkItem: workItemService.claimWorkItem,
    releaseWorkItemClaim: workItemService.releaseWorkItemClaim,
    assignWorkItemToSelf: workItemService.assignWorkItemToSelf,
    bindGithubIssue: workItemService.bindGithubIssue,
    syncGithubIssue: workItemService.syncGithubIssue,
    bindExternalIssue: workItemService.bindExternalIssue,
    syncExternalIssue: workItemService.syncExternalIssue,
    listWorkItemExternalProviders: workItemService.listExternalProviders,
    getWorkItemExternalIssueFunnel: workItemService.getExternalIssueFunnel,
    recordWorkItemVerification: workItemService.recordVerification,
    recordWorkItemAssetOperation: workItemService.recordAssetOperation,
    startWorkItemApplicationExecution: workItemService.startApplicationExecution,
    requestWorkItemApplicationApproval: workItemService.requestApplicationExecutionApproval,
    ingestGithubWorkItemWebhook: workItemService.ingestGithubWebhook,
    replayGithubWorkItemWebhook: workItemService.replayGithubWebhook,
    recordGithubWorkItemWebhookFailure: workItemService.recordGithubWebhookFailure,
    ingestExternalWorkItemWebhook: workItemService.ingestExternalWebhook,
    replayExternalWorkItemWebhook: workItemService.replayExternalWebhook,
    recordExternalWorkItemWebhookFailure: workItemService.recordExternalWebhookFailure,
    updateWorkItemAttention: workItemService.updateAttention,
    getWorkItemGithubSyncDiagnostics: workItemService.githubSyncDiagnostics,
    suggestWorkItemDraft: workItemService.suggestWorkItemDraft,
    listMyTemplateRoutingFeedback: workItemService.listMyTemplateRoutingFeedback,
    removeMyTemplateRoutingFeedback: workItemService.removeMyTemplateRoutingFeedback,
    previewMyTemplateDraft: workItemService.previewMyTemplateDraft,
    listMyTemplateDrafts: workItemService.listMyTemplateDrafts,
    reviewMyTemplateDraft: workItemService.reviewMyTemplateDraft,
    listSimilarMyTemplateWorkItems: workItemService.listSimilarMyTemplateWorkItems,
    createMyTemplateDraft: workItemService.createMyTemplateDraft,
    addMyTemplateLearningCase: workItemService.addMyTemplateLearningCase,
    activateMyTemplateDraft: workItemService.activateMyTemplateDraft,
    listMyTemplateOutcomeFeedback: workItemService.listMyTemplateOutcomeFeedback,
    recordMyTemplateOutcomeFeedback: workItemService.recordMyTemplateOutcomeFeedback,
    resumeMyTemplateGovernanceObservation: workItemService.resumeMyTemplateGovernanceObservation,
    prepareWorkItemExecutionContract: workItemService.prepareExecutionContract,
    listWorkItemReportDrafts: workItemService.listReportDrafts,
    getWorkItemReportDraft: workItemService.getReportDraft,
    generateWorkItemReportDraft: workItemService.generateReportDraft,
    updateWorkItemReportDraft: workItemService.updateReportDraft,
    confirmWorkItemReportDraft: workItemService.confirmReportDraft,
    discardWorkItemReportDraft: workItemService.discardReportDraft,
    listWorkItemReportDeliveries: workItemService.listReportDeliveries,
    getWorkItemReportDelivery: workItemService.getReportDelivery,
    previewWorkItemReportDelivery: workItemService.previewReportDelivery,
    sendWorkItemReportDelivery: workItemService.sendReportDelivery,
    retryWorkItemAlert: workItemService.retryWorkItemAlert,
    applyLocalSchedulePlan: workItemService.applyLocalSchedulePlan,
    applyLocalScheduleRollover: workItemService.applyLocalScheduleRollover,
    applyLocalScheduleUrgent: workItemService.applyLocalScheduleUrgent,
    recordBusinessDocumentClassification: businessRoutineService.recordDocumentClassification,
    createBusinessEntity: businessRoutineService.createBusinessEntity,
    listChannelObjects: channelObjectRegistryService.listChannelObjects,
    upsertChannelObject: channelObjectRegistryService.upsertChannelObject,
    setChannelObjectStatus: channelObjectRegistryService.setChannelObjectStatus,
    previewChannelObjectImport: channelObjectImportService.previewChannelObjectImport,
    confirmChannelObjectImport: channelObjectImportService.confirmChannelObjectImport,
    listChannelObjectImports: channelObjectImportService.listChannelObjectImports,
    listChannelObjectFileSources: channelObjectImportService.listChannelObjectFileSources,
    listChannelMutationBindings: channelMutationBindingService.listBindings,
    upsertChannelMutationBinding: channelMutationBindingService.upsertBinding,
    setChannelMutationBindingStatus: channelMutationBindingService.setBindingStatus,
    listChannelObjectConnectors: channelObjectConnectorService.listChannelObjectConnectors,
    listChannelObjectConnectorConfigs: channelObjectConnectorService.listChannelObjectConnectorConfigs,
    upsertChannelObjectConnectorConfig: channelObjectConnectorService.upsertChannelObjectConnectorConfig,
    setChannelObjectConnectorConfigStatus: channelObjectConnectorService.setChannelObjectConnectorConfigStatus,
    testChannelObjectConnectorConfig: channelObjectConnectorService.testChannelObjectConnectorConfig,
    previewChannelObjectConnectorSync: channelObjectConnectorService.previewChannelObjectConnectorSync,
    confirmChannelObjectConnectorSync: channelObjectConnectorService.confirmChannelObjectConnectorSync,
    syncChannelObjectConnector: channelObjectConnectorService.syncChannelObjectConnector,
    retryChannelObjectConnectorSync: channelObjectConnectorService.retryChannelObjectConnectorSync,
    listChannelObjectSyncs: channelObjectConnectorService.listChannelObjectSyncs,
    createBusinessCase: businessRoutineService.createBusinessCase,
    createRoutineDefinition: businessRoutineService.createRoutineDefinition,
    createRoutineDraftFromDiscovery: businessRoutineService.createRoutineDraftFromDiscovery,
    listBusinessRoutineDefinitions: businessRoutineService.listRoutineDefinitions,
    updateBusinessRoutineDefinition: businessRoutineService.updateRoutineDefinition,
    createBusinessRoutineDefinitionVersion: businessRoutineService.createRoutineDefinitionVersion,
    publishBusinessRoutineDefinition: businessRoutineService.publishRoutineDefinition,
    transitionRoutineDefinition: businessRoutineService.transitionRoutineDefinition,
    createLedgerDefinition: businessRoutineService.createLedgerDefinition,
    listLedgerDefinitions: ledgerUpsertService.listDefinitions,
    activateLedgerDefinition: ledgerUpsertService.activateDefinition,
    disableLedgerDefinition: ledgerUpsertService.disableDefinition,
    previewLedgerUpsert: ledgerUpsertService.previewUpsert,
    inspectLedgerTargetIdentity: ledgerUpsertService.inspectTargetIdentity,
    commitLedgerUpsertPreview: ledgerUpsertService.commitPreview,
    previewLedgerBatchUpsert: ledgerUpsertService.previewBatchUpsert,
    commitLedgerBatchUpsertPreview: ledgerUpsertService.commitBatchPreview,
    retryLedgerBatchUpsertPreview: ledgerUpsertService.retryBatchPreview,
    listLedgerBatchUpsertPreviews: ledgerUpsertService.listBatchPreviews,
    listLedgerBatchMutationJournals: ledgerUpsertService.listBatchMutationJournals,
    listLedgerUpsertPreviews: ledgerUpsertService.listPreviews,
    listLedgerMutations: ledgerUpsertService.listMutations,
    collectBusinessPilotEvidence: businessPilotEvidenceService.collect,
    verifyBusinessPilotEvidence: businessPilotEvidenceService.verify,
    getBusinessPilotWorkbench: businessPilotEvidenceService.getWorkbench,
    saveBusinessPilotWorkbench: businessPilotEvidenceService.saveWorkbench,
    prepareBusinessPilotWorkbench: businessPilotEvidenceService.prepareWorkbench,
    createBusinessPilotGapIssues: businessPilotEvidenceService.createWorkbenchGapIssues,
    submitBusinessPilotReview: businessPilotEvidenceService.submitWorkbenchReview,
    updateBusinessPilotRollout: businessPilotEvidenceService.updateWorkbenchRollout,
    collectBusinessPilotWorkbench: businessPilotEvidenceService.collectWorkbench,
    getBusinessPilotCollection: businessPilotEvidenceService.getWorkbenchCollection,
    compareBusinessPilotCollections: businessPilotEvidenceService.compareWorkbenchCollections,
    exportBusinessPilotCollection: businessPilotEvidenceService.exportWorkbenchCollection,
    revokeBusinessPilotCollection: businessPilotEvidenceService.revokeWorkbenchCollection,
    getWorkflowAdaptiveWorkbench: workflowAdaptiveWorkService.getWorkbench,
    getWorkflowMemoryInsights: workflowMemoryInsightsService.getOverview,
    updateWorkflowAdaptivePolicy: workflowAdaptiveWorkService.updatePolicy,
    updateWorkflowAdaptiveMonitor: workflowAdaptiveWorkService.updateMonitor,
    updateWorkflowAdaptiveAutomation: workflowAdaptiveWorkService.updateAutomation,
    sweepWorkflowAdaptiveMonitors: workflowAdaptiveWorkService.sweepMonitors,
    runWorkflowAdaptiveMonitorNow: workflowAdaptiveWorkService.runMonitorNow,
    syncWorkflowAdaptiveOutcomes: workflowAdaptiveWorkService.syncOutcomes,
    listWorkflowAdaptiveLearning: workflowAdaptiveWorkService.listLearning,
    generateWorkflowAdaptiveLearningDraft: workflowAdaptiveWorkService.generateLearningDraft,
    evaluateWorkflowAdaptiveLearning: workflowAdaptiveWorkService.evaluateAndGovern,
    recordWorkflowAdaptiveShadowPreference: workflowAdaptiveWorkService.recordShadowPreference,
    previewWorkflowAdaptiveLearningPublication: workflowAdaptiveWorkService.previewLearningPublication,
    listWorkflowAdaptiveNotifications: workflowAdaptiveWorkService.listNotifications,
    readWorkflowAdaptiveNotification: workflowAdaptiveWorkService.readNotification,
    publishWorkflowAdaptiveLearningDraft: workflowAdaptiveWorkService.publishLearningDraft,
    rollbackWorkflowAdaptiveLearningRule: workflowAdaptiveWorkService.rollbackLearningRule,
    materializeWorkflowAdaptiveSuggestion: workflowAdaptiveWorkService.materialize,
    reconcileWorkflowAdaptiveWork: workflowAdaptiveWorkService.reconcile,
    recordWorkflowAdaptiveFeedback: workflowAdaptiveWorkService.recordFeedback,
    materializeRoutineIssue: businessRoutineService.materializeRoutineIssue,
    createRoutineRun: businessRoutineService.createRoutineRun,
    getRoutineWorkItemExecution: businessRoutineService.getRoutineWorkItemExecution,
    listRoutineWorkQueue: businessRoutineService.listRoutineWorkQueue,
    startRoutineWorkItem: (input, actor) =>
      continueRoutineAfterAction(businessRoutineService.startRoutineWorkItem, input, actor),
    executeRoutineStep: (input, actor) =>
      continueRoutineAfterAction(businessRoutineService.executeRoutineStep, input, actor),
    confirmQuotationInputs: (input, actor) =>
      continueRoutineAfterAction(businessRoutineService.confirmQuotationInputs, input, actor),
    bindRoutineLedger: businessRoutineService.bindRoutineLedger,
    requestRoutineStepReview: businessRoutineService.requestRoutineStepReview,
    resumeRoutineRecovery: (input, actor) =>
      continueRoutineAfterAction(businessRoutineService.resumeRoutineRecovery, input, actor),
    completeRoutineStep: (input, actor) =>
      continueRoutineAfterAction(businessRoutineService.completeRoutineStep, input, actor),
    retryRoutineStep: (input, actor) =>
      continueRoutineAfterAction(businessRoutineService.retryRoutineStep, input, actor),
    decideRoutineApproval: (input, actor) =>
      continueRoutineAfterAction(businessRoutineService.decideRoutineApproval, input, actor),
    decideRoutineCondition: (input, actor) =>
      continueRoutineAfterAction(businessRoutineService.decideRoutineCondition, input, actor),
    cancelRoutineWorkItem: businessRoutineService.cancelRoutineWorkItem,
    transitionRoutineStep: businessRoutineService.transitionRoutineStep,
    analyzeWorkflowBusinessDocuments: businessDocumentIntelligenceService.analyzeSource,
    cancelWorkflowBusinessDocumentAnalysis: businessDocumentIntelligenceService.cancelAnalysis,
    analyzeWorkflowBusinessDocument: businessDocumentIntelligenceService.analyzeArtifact,
    listWorkflowBusinessDocumentClassifications: businessDocumentIntelligenceService.listClassifications,
    listWorkflowBusinessDocumentAnalysisJobs: businessDocumentIntelligenceService.listAnalysisJobs,
    confirmWorkflowBusinessDocumentClassification: businessDocumentIntelligenceService.confirmClassification,
    discoverWorkflowBusinessCases: businessCaseDiscoveryService.discoverBusinessCases,
    listWorkflowBusinessCaseCandidates: businessCaseDiscoveryService.listBusinessCaseCandidates,
    reviewWorkflowBusinessCaseCandidate: businessCaseDiscoveryService.reviewBusinessCaseCandidate,
    discoverWorkflowBusinessRoutine: businessCaseDiscoveryService.discoverRoutine,
    listWorkflowBusinessRoutineCandidates: businessCaseDiscoveryService.listRoutineDiscoveryCandidates,
    inspectArticleImport: articleImportService.inspect,
    startArticleImport: articleImportService.start,
    listArticleImports: articleImportService.list,
    getArticleImport: articleImportService.get,
    cancelArticleImport: articleImportService.cancel,
    analyzeArticleImport: articleImportService.analyze,
    listSessions: sessionManagerService.listSessions,
    probeSessionSite: sessionManagerService.probeSite,
    reseedSessionSite: sessionManagerService.seedLogin,
    sessionHealthSweep: sessionManagerService.sessionHealthSweep,
    acquireSessionProfile: sessionManagerService.acquireProfile,
    findSimilarArticleImports: articleImportService.findSimilar,
    createArticleDerivative: articleImportService.createDerivative,
    listArticleDerivatives: articleImportService.listDerivatives,
    getArticleDerivative: articleImportService.getDerivative,
    listArticleExtractorPlugins: articleExtractorPluginService.list,
    planArticleExtractorPluginInstall: articleExtractorPluginService.planInstall,
    installArticleExtractorPlugin: (input, actor) => {
      const result = articleExtractorPluginService.install(input, actor);
      if (!result.ok) return result;
      const retryVersion = result.body.plugin.activeVersion;
      const retryKey = `${result.body.plugin.pluginId}:${retryVersion}`;
      queueMicrotask(() => {
        void channelKnowledgeService.retryFailedForHosts(
          input?.manifest?.hosts,
          actor?.teamId ?? LOCAL_TEAM_ID,
          retryKey,
        ).then((retries) => {
          for (const retry of retries) {
            if (!retry.item?.channelId || !retry.item?.conversationId) continue;
            channelDeliveryService.enqueueChannelDelivery({
              channelId: retry.item.channelId,
              conversationId: retry.item.conversationId,
              content: retry.ok
                ? `新的网页采集能力已启用，我已重新读取原链接并保存为本地资料：${retry.result?.title ?? "未命名资料"}。`
                : `新的网页采集能力已启用，但原链接重试后仍未读取成功（${retry.error}）。我会保留原链接，便于继续检查。`,
              dedupeKey: `article-extractor-retry:${retry.item.id}:${retryVersion}`,
              taskContext: { deliveryKind: "status_notification", notificationEvent: retry.ok ? "succeeded" : "failed" },
            });
          }
        }).catch((error) => appendEvent({
          invocationId: null,
          type: "article_extractor_plugin_retry_failed",
          level: "warn",
          message: "Article extractor original-link retry could not be scheduled.",
          data: { pluginId: result.body.plugin.pluginId, error: String(error?.code ?? error?.message ?? error).slice(0, 120) },
        }));
      });
      return {
        ...result,
        body: {
          ...result.body,
          retry: { scheduled: true },
        },
      };
    },
    disableArticleExtractorPlugin: articleExtractorPluginService.disable,
    activateArticleExtractorPlugin: articleExtractorPluginService.activate,
    listWorkflowSources: workflowMemoryService.listSources,
    createWorkflowSource: workflowMemoryService.createSource,
    listTemplateLearningTasks: templateLearningService.listTasks,
    createTemplateLearningTask: templateLearningService.createTask,
    stageTemplateLearningFile: templateLearningService.stageFile,
    startTemplateLearningTask: templateLearningService.startTask,
    completeTemplateLearningTask: templateLearningService.completeTask,
    scanWorkflowSource: workflowMemoryService.scanSource,
    scanWorkflowIncrementalIntake: workflowMemoryService.scanIncrementalIntake,
    listWorkflowIntakeObservations: workflowMemoryService.listIntakeObservations,
    inspectWorkflowInquiryIntake: inquiryIntakeTriggerService.inspect,
    acceptWorkflowInquiryIntake: inquiryIntakeTriggerService.accept,
    cancelWorkflowSourceScan: workflowMemoryService.cancelScan,
    revokeWorkflowSource: workflowMemoryService.revokeSource,
    deleteWorkflowSourceLearning: workflowMemoryService.deleteSourceLearning,
    listWorkflowArtifacts: workflowMemoryService.listArtifacts,
    confirmWorkflowArtifact: workflowMemoryService.confirmArtifact,
    retryWorkflowArtifactExtraction: workflowMemoryService.retryArtifactExtraction,
    getWorkflowOcrReadiness: workflowMemoryService.getOcrReadiness,
    ocrWorkflowArtifact: workflowMemoryService.ocrArtifact,
    getWorkflowOcrStatus: workflowMemoryService.getOcrStatus,
    cancelWorkflowOcrArtifact: workflowMemoryService.cancelOcrArtifact,
    setWorkflowArtifactExclusion: workflowMemoryService.setArtifactExclusion,
    indexWorkflowSourceEmbeddings: workflowMemoryService.indexSourceEmbeddings,
    proposeWorkflowPairs: workflowMemoryService.pairProposals,
    listDeliveryCases: workflowMemoryService.listCases,
    createDeliveryCase: workflowMemoryService.createCase,
    changeDeliveryCaseState: workflowMemoryService.changeCaseState,
    deriveWorkflowProfile: workflowMemoryService.deriveProfile,
    reviseWorkflowProfile: workflowMemoryService.reviseProfile,
    listWorkflowProfiles: workflowMemoryService.listProfiles,
    listWorkflowProfileDrafts: workflowMemoryService.listProfileDrafts,
    createWorkflowProfileDraft: workflowMemoryService.createProfileDraft,
    publishWorkflowProfileDraft: workflowMemoryService.publishProfileDraft,
    listWorkflowInbox: workflowMemoryService.listInbox,
    matchWorkflowProfiles: workflowMemoryService.matchProfiles,
    findSimilarWorkflowCases: workflowMemoryService.findSimilarCases,
    evaluateWorkflowRetrieval: workflowMemoryService.evaluateRetrieval,
    inspectWorkflowRequirement: workflowMemoryService.inspectRequirement,
    listWorkflowRuns: workflowMemoryService.listRuns,
    createWorkflowRun: workflowMemoryService.createRun,
    executeWorkflowRun: workflowMemoryService.executeRun,
    cancelWorkflowRunExecution: workflowMemoryService.cancelRunExecution,
    retryWorkflowRunExecution: workflowMemoryService.retryRunExecution,
    cleanupWorkflowRunAttemptWorktree: workflowMemoryService.cleanupRunAttemptWorktree,
    selectWorkflowRunAttempt: workflowMemoryService.selectRunAttempt,
    validateWorkflowRun: workflowMemoryService.validateRun,
    recordWorkflowRunFeedback: workflowMemoryService.recordRunFeedback,
    previewWorkflowRunPublication: workflowMemoryService.previewRunPublication,
    publishWorkflowRunOutputs: workflowMemoryService.publishRunOutputs,
    fetchWorkItemGithubIssue: ({ projectId, issueNumber }) => {
      const project = (state.projects ?? []).find((candidate) => candidate.id === projectId);
      const target = (state.projectTargets ?? []).find((candidate) => candidate.projectId === projectId && candidate.state === "ready");
      const cwd = target?.rootPath ?? project?.path;
      return cwd ? runIssueSnapshotFetch({ cwd, issueNumber }) : null;
    },
    pushWorkItemGithubIssue: ({ projectId, issueNumber, payload, remote }) => {
      const project = (state.projects ?? []).find((candidate) => candidate.id === projectId);
      const target = (state.projectTargets ?? []).find((candidate) => candidate.projectId === projectId && candidate.state === "ready");
      const cwd = target?.rootPath ?? project?.path;
      return cwd
        ? runIssueSnapshotWrite({ cwd, issueNumber, payload, remote })
        : { ok: false, error: "project_repository_not_ready" };
    },
    fetchWorkItemExternalIssue: async ({ provider, repository, issueNumber }) => {
      const result = await createExternalIssueProviderClient({ provider }).fetchIssue({ repository, issueNumber });
      return result.ok ? result.issue : result;
    },
    listWorkItemExternalIssues: ({ provider, repository, query, page, perPage }) =>
      createExternalIssueProviderClient({ provider }).listIssues({ repository, query, page, perPage }),
    pushWorkItemExternalIssue: ({ provider, repository, issueNumber, payload }) =>
      createExternalIssueProviderClient({ provider }).updateIssue({ repository, issueNumber, payload }),
    listPlanningProjects: planningProjectService.listProjects,
    getPlanningProject: planningProjectService.getProject,
    createPlanningProject: planningProjectService.createProject,
    updatePlanningProject: planningProjectService.updateProject,
    setPlanningProjectArchived: planningProjectService.setArchived,
    addPlanningProjectItem: planningProjectService.addItem,
    removePlanningProjectItem: planningProjectService.removeItem,
    reorderPlanningProjectItems: planningProjectService.reorderItems,
    updatePlanningProjectItems: planningProjectService.updateItems,
    suggestPlanningPlan: planningProjectService.suggestPlan,
    executePlanningRecommendedAction: planningProjectService.executeRecommendedAction,
    decidePlanningRecommendedAction: planningProjectService.decideRecommendedAction,
    createChannelTaskIssue,
    routeChannelTask,
    dismissChannelTask,
    retryChannelTask,
    rerouteChannelTask,
    takeoverChannelTask,
    replyChannelTask,
    // The gateway's handoff: import + dispatch + reply-enqueue as one pipeline (S3+S4+S5).
    importChannelEvent: receiveChannelEvent,
    sweepChannelDeliveries: channelDeliveryService.sweepChannelDeliveries,
    sweepChannelTaskThreads: channelConversationService.sweepTaskThreads,
    sweepChannelNotifications: channelNotificationService.sweep,
    getChannelNotificationPolicy: channelNotificationService.getPolicy,
    listChannelNotificationPolicies: channelNotificationService.listPolicies,
    setChannelNotificationPolicy: channelNotificationService.setPolicy,
    recoverChannelTaskThreads: channelConversationService.recoverTaskThreads,
    retryChannelDelivery: channelDeliveryService.retryChannelDelivery,
    beginIlinkLogin: ilinkRuntime.beginLogin,
    pollIlinkLogin: ilinkRuntime.pollLogin,
    activateIlinkChannel: ilinkRuntime.activate,
    disconnectIlinkChannel: ilinkRuntime.disconnect,
    sendIlinkApplicationMessage: ilinkRuntime.sendApplicationMessage,
    startIlink: ilinkRuntime.start,
    stopIlink: ilinkRuntime.stop,
    syncIlinkWorkers: ilinkRuntime.syncWorkers,
    onIlinkChannelStateChanged: ilinkRuntime.onChannelStateChanged,
    // Scheduled work-report post: the slow-tick sweep (index.mjs), the manual
    // "post now", and the config setter (routes).
    sweepReportSchedule: reportScheduleService.sweepReportSchedule,
    postReportNow: reportScheduleService.postReportNow,
    setReportSchedule: reportScheduleService.setReportSchedule,
    // Bind a provider's outbound sender (index.mjs calls this once per configured
    // gateway). Back-compat: a bare fn with no provider binds WeCom.
    setChannelDeliverySender: (providerOrFn, maybeFn) => {
      const provider = typeof providerOrFn === "string" ? providerOrFn : "wecom";
      const fn = typeof providerOrFn === "function" ? providerOrFn : maybeFn;
      channelSenders[provider] = typeof fn === "function" ? fn : null;
    },
    selectProject,
    removeProject,
    removeWorktree,
    updateProject,
    readProjectDocuments,
    readProjectTree,
    searchProjectContent,
    gitProjectSummary,
    projectBranches,
    worktreeDiff,
    submitWorktreeReview,
    projectGithubItems,
    createAgentSkill,
    updateAgentSkill,
    deleteAgentSkill,
    createCapabilityInvocation,
    cancelApplicationInstall,
    completeApplicationInstall,
    findApplication,
    findApplicationInstallRun,
    getApplicationOrchestrationRunRecovery,
    listApplicationOrchestrationRecoveryAgentCandidates,
    getApplicationOrchestrationRun,
    invokeApplicationCapability,
    getCapability,
    listApplicationCapabilities,
    listCapabilities,
    resolveCapability,
    listApplications,
    listApplicationOrchestrationRunEvents,
    listApplicationOrchestrationRuns,
    probeApplication,
    repairApplication,
    queueApplicationInstall,
    recordApplicationInstallProgress,
    registerApplication,
    requestApplicationOrchestrationRecoveryAction,
    readApplicationRecoveryArchive,
    runApplicationOrchestration,
    setApplicationAutoRecovery,
    issueApprovalGrant,
    bridgeLivenessSweep,
    setApplicationHealthProbe,
    applicationHealthSweep,
    transitionApplication,
    createSshTarget,
    createSshConnectionTest,
    createManagedTerminalSession,
    queueTerminalBridgeAction,
    nextTerminalBridgeAction,
    recordTerminalBridgeEvent,
    recordTerminalEvidence,
    summarizeText,
    appendEvent,
    refuse,
    firstRefusal,
    isAgentDisabled,
    redeliverExpiredDispatches,
    registerAgent,
    findAgent,
    disableAgent,
    enableAgent,
    createAgentHealthCheck,
    unlinkDevice,
    relinkDevice,
    recordCodexHookEvent,
    expireCodexApprovalBrokerRequests,
    resolveCodexApprovalBrokerRequest,
    createCodexImportedEvidenceRecord,
    createCodexChangeReview,
    createCodexExecReview,
    setCodexSessionName,
    resumableCodexSessions,
    isExecChangeApproved,
    execRunPromotionGate,
    createDiscoveryRun,
    createIntegrationArtifact,
    createLifecycleRecipe,
    createPrivateCatalogEntry,
    createSignedBundleManifest,
    createQuotaPolicy,
    findIntegrationArtifact,
    findLifecycleLocalApproval,
    findLifecycleRollbackRequest,
    findLifecycleRecipe,
    findPrivateCatalogEntry,
    generateIntegrationArtifacts,
    chargebackExport,
    completeLifecycleAction,
    createAuditExportRequest,
    decideLifecycleLocalApproval,
    evaluateLifecyclePolicy,
    enforcePlatformAiQuota,
    queueLifecycleAction,
    queueRollbackAction,
    recordAiUsage,
    requestLifecycleLocalApproval,
    transitionLifecycleRecipe,
    updatePrivateDeploymentConfig,
    createAgentDryProbeRun,
    deviceForToken,
    issueBridgeCredential,
    requireBridgeCredential,
    supersedeBridgeSession,
    createIntegrationProbeRun,
    registerIntegrationArtifact,
    transitionIntegrationArtifact,
    updateIntegrationRetentionSettings,
    draftIntegrationWithPlatformAgent,
    findDiscoveryRun,
    registerDiscoveredCandidate,
    nextDispatchableInvocation,
    markDispatched,
    projectForInvocation,
    nextBridgeHealthCheck,
    markHealthCheckStarted,
    completeHealthCheck,
    nextBridgeDiscoveryRun,
    markDiscoveryStarted,
    normalizeStringArray,
    completeDiscoveryRun,
    nextBridgeProbeRun,
    nextBridgeApplicationInstall,
    markLifecycleActionStarted,
    nextBridgeLifecycleAction,
    markIntegrationProbeStarted,
    findIntegrationProbeRun,
    completeIntegrationProbeRun,
    findInvocation,
    acknowledgeInvocation,
    completeInvocation,
    listInvocationEvents,
    listInvocationRefusals,
    getInvocationTrace,
    findApprovalRequest,
    claimDecision,
    releaseDecisionClaim,
    approveInvocation,
    denyInvocation,
    defaultAgent,
    createInvocation,
    startInvocationIfAllowed,
    createCompareRun,
    setCompareRunPreferred,
    promoteCompareRun,
    cancelInvocation,
    createTroubleshootingReport,
    createToolInvocation,
    getTool,
    listTools,
    rollbackClaudeApply,
    nextId,
    persistStateSoon,
    persistStateNow,
    budgetStatusFor,
    upsertBudget,
  };

  return {
    httpDependencies,
    startLocalContentIndexing: localContentCatalogService.start,
    flushLocalContentIndexing: localContentCatalogService.flushIncremental,
    closeRuntimeServices: async () => {
      clearInterval(mailBodyPrefetchTimer);
      try {
        await localContentCatalogService.close();
      } finally {
        mailQueryIndex?.close();
      }
    },
    savePersistentState,
    // #1084: the retention sweep (index.mjs) leaves an audit event per reap batch.
    appendEvent,
    // #1042: an explicit JSON export (rollback/backup), written at shutdown so an
    // operator always has a recent rollback artifact even on the SQLite backing.
    exportJsonSnapshot,
    selfCheckDependencies,
    // #966: the Store seam, exposed for incremental service migration (#968).
    store,
  };
}

/**
 * Every record id the state currently holds, across every collection (#832).
 *
 * Generic on purpose: it walks the arrays it finds rather than a list someone has
 * to remember to extend. A new collection is protected the day it is added, not
 * the day someone notices it was not.
 */
function collectRecordIds(state) {
  const ids = new Set();
  for (const value of Object.values(state ?? {})) {
    if (!Array.isArray(value)) continue;
    for (const record of value) {
      if (record && typeof record === "object" && typeof record.id === "string" && record.id) {
        ids.add(record.id);
      }
    }
  }
  return ids;
}

function nextIdCounterAfterState(state) {
  let max = 0;
  const seen = new Set();
  const visit = (value) => {
    if (!value || typeof value !== "object") {
      if (typeof value === "string") {
        const match = value.match(/_(\d{4,})$/);
        if (match) max = Math.max(max, Number(match[1]));
      }
      return;
    }
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    for (const item of Object.values(value)) visit(item);
  };
  visit(state);
  return max + 1;
}
