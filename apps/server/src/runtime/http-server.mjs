import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { resolveActor } from "./auth.mjs";
import { identityPolicyFromEnv } from "./identity-policy.mjs";
import { configuredLoopbackToken, hostAllowed, loopbackTokenValid } from "./loopback-guard.mjs";
import { authorizeProfessionalRequest, professionalRoleForbiddenBody } from "./route-authority.mjs";
import { validSessionCsrf } from "../services/identity-security.mjs";
import { handleAgentRoutes } from "../routes/agents.mjs";
import { handleAgentSkillRoutes } from "../routes/agent-skills.mjs";
import { handleApplicationRoutes } from "../routes/applications.mjs";
import { handleArticleExtractorPluginRoutes } from "../routes/article-extractor-plugins.mjs";
import { handleApprovalGrantRoutes } from "../routes/approval-grants.mjs";
import { handleBridgeRoutes } from "../routes/bridge.mjs";
import { handleCapabilityRoutes } from "../routes/capabilities.mjs";
import { handleLocalContentRoutes } from "../routes/local-content.mjs";
import { handleMaterialWorkSessionRoutes } from "../routes/material-work-sessions.mjs";
import { handleMailRoutes } from "../routes/mail.mjs";
import { handleChannelRoutes } from "../routes/channels.mjs";
import { handleCanvasSceneRoutes } from "../routes/canvas-scenes.mjs";
import { handleCodexRoutes } from "../routes/codex.mjs";
import { handleControlPlaneRoutes } from "../routes/control-plane.mjs";
import { handleIntegrationRoutes } from "../routes/integrations.mjs";
import { handleIdentityRoutes } from "../routes/identity.mjs";
import { handleGuidedSetupRoutes } from "../routes/guided-setup.mjs";
import { handleInvocationRoutes } from "../routes/invocations.mjs";
import { handleLoopRoutineRoutes } from "../routes/loop-routines.mjs";
import { handleM3Routes } from "../routes/m3.mjs";
import { handleProjectRoutes } from "../routes/projects.mjs";
import { backfillProjectGitFacts } from "../services/projects.mjs";
import { backfillApplicationRuntimeMetadata } from "../services/applications.mjs";
import { handleReviewFindingRoutes } from "../routes/review-findings.mjs";
import { handleTerminalRoutes } from "../routes/terminal.mjs";
import { handleTaskMaterialRoutes } from "../routes/task-materials.mjs";
import { handleToolRoutes } from "../routes/tools.mjs";
import { handleWorkItemRoutes } from "../routes/work-items.mjs";
import { handleSessionRoutes } from "../routes/sessions.mjs";
import { handleWorkflowMemoryRoutes } from "../routes/workflow-memory.mjs";
import { handleChannelObjectRoutes } from "../routes/channel-objects.mjs";
import { handlePlanningProjectRoutes } from "../routes/planning-projects.mjs";
import { handleSiteRoutes } from "../routes/sites.mjs";
import { handleSitePilotRoutes } from "../routes/site-pilot.mjs";
import { handleSiteCredentialRoutes } from "../routes/site-credentials.mjs";
import { handleWorkProfileRoutes } from "../routes/work-profile.mjs";
import { handlePrivateTutorRoutes } from "../routes/private-tutor.mjs";
import { ensureEventStreamMetrics, eventsAfter } from "../services/event-stream-metrics.mjs";
import { terminalObservationReadModel } from "../read-models/terminal-observation.mjs";
import { buildConsoleState, CONSOLE_STATE_MEDIA_TYPE } from "../read-models/state.mjs";

export function createHttpServer({
  host,
  port,
  namespace,
  protocolVersion,
  state,
  now,
  cancellationSignal,
  publicState,
  currentLoopRoutineProjectContext,
  currentProject,
  addProject,
  cloneProject,
  createBlankProject,
  createTaskMaterialDraft,
  getTaskMaterialDraft,
  uploadTaskMaterialFile,
  removeTaskMaterialFile,
  readTaskMaterialContent,
  previewTaskMaterialCleanup,
  executeTaskMaterialCleanup,
  createWorktree,
  createWorktreePr,
  publishWorktreeBranch,
  promoteWorktreeToBase,
  promoteWorktreeToPullRequest,
  ensureLocalOrigin,
  enqueueWorkItemAutoRunUnderstanding,
  reserveAutoRun,
  attachAutoRunExecutionPlan,
  failAutoRunUnderstanding,
  startAutoRun,
  retryAutoRun,
  reverifyAutoRun,
  reconcileExecutionAction,
  cancelAutoRun,
  stopAutoRunDelivery,
  mergeAutoRunPr,
  recordRoutingOverride,
  setReportSchedule,
  postReportNow,
  getChannelNotificationPolicy,
  listChannelNotificationPolicies,
  setChannelNotificationPolicy,
  claimIssue,
  beginWorkItemExecution,
  abortWorkItemExecution,
  claimWorkItem,
  releaseWorkItemClaim,
  assignWorkItemToSelf,
  beginWorkItemDelivery,
  failWorkItemDelivery,
  bindGithubIssue,
  syncGithubIssue,
  bindExternalIssue,
  syncExternalIssue,
  listWorkItemExternalProviders,
  getWorkItemExternalIssueFunnel,
  fetchWorkItemExternalIssue,
  listWorkItemExternalIssues,
  pushWorkItemExternalIssue,
  fetchWorkItemGithubIssue,
  pushWorkItemGithubIssue,
  recordWorkItemVerification,
  recordWorkItemAssetOperation,
  startWorkItemApplicationExecution,
  requestWorkItemApplicationApproval,
  ingestGithubWorkItemWebhook,
  replayGithubWorkItemWebhook,
  recordGithubWorkItemWebhookFailure,
  ingestExternalWorkItemWebhook,
  replayExternalWorkItemWebhook,
  recordExternalWorkItemWebhookFailure,
  updateWorkItemAttention,
  getWorkItemGithubSyncDiagnostics,
  suggestWorkItemDraft,
  previewIntentTaskPlan,
  commitIntentTaskPlan,
  prepareLedgerPostingPlan,
  commitLedgerPostingPlan,
  getLedgerPostingPlan,
  createResultRepairTask,
  listMyTemplateRoutingFeedback,
  removeMyTemplateRoutingFeedback,
  previewMyTemplateDraft,
  listMyTemplateDrafts,
  reviewMyTemplateDraft,
  listSimilarMyTemplateWorkItems,
  createMyTemplateDraft,
  addMyTemplateLearningCase,
  activateMyTemplateDraft,
  listMyTemplateOutcomeFeedback,
  recordMyTemplateOutcomeFeedback,
  recordPlanActualFeedback,
  resumeMyTemplateGovernanceObservation,
  prepareWorkItemExecutionContract,
  confirmWorkItemExecutionContractAndSchedule,
  cancelWorkItemExecutionStart,
  recheckWorkItemExecutionStart,
  listWorkItemReportDrafts,
  getWorkItemReportDraft,
  generateWorkItemReportDraft,
  updateWorkItemReportDraft,
  confirmWorkItemReportDraft,
  discardWorkItemReportDraft,
  listWorkItemReportDeliveries,
  getWorkItemReportDelivery,
  previewWorkItemReportDelivery,
  sendWorkItemReportDelivery,
  retryWorkItemAlert,
  inspectArticleImport,
  startArticleImport,
  listArticleImports,
  getArticleImport,
  cancelArticleImport,
  analyzeArticleImport,
  listSessions,
  probeSessionSite,
  reseedSessionSite,
  findSimilarArticleImports,
  createArticleDerivative,
  listArticleDerivatives,
  getArticleDerivative,
  listArticleExtractorPlugins,
  planArticleExtractorPluginInstall,
  installArticleExtractorPlugin,
  disableArticleExtractorPlugin,
  activateArticleExtractorPlugin,
  addWorkItemMaterials,
  removeWorkItemMaterial,
  restoreWorkItemMaterial,
  addWorkItemContentReference,
  removeWorkItemContentReference,
  addWorkItemResourceReference,
  refreshWorkItemResourceReference,
  inspectWorkItemResourceReferences,
  removeWorkItemResourceReference,
  updateWorkItemTaskContext,
  listWorkflowSources,
  listChannelObjects,
  upsertChannelObject,
  setChannelObjectStatus,
  previewChannelObjectImport,
  confirmChannelObjectImport,
  listChannelObjectImports,
  listChannelObjectFileSources,
  listChannelMutationBindings,
  upsertChannelMutationBinding,
  setChannelMutationBindingStatus,
  listChannelObjectConnectors,
  listChannelObjectConnectorConfigs,
  upsertChannelObjectConnectorConfig,
  setChannelObjectConnectorConfigStatus,
  testChannelObjectConnectorConfig,
  previewChannelObjectConnectorSync,
  confirmChannelObjectConnectorSync,
  syncChannelObjectConnector,
  retryChannelObjectConnectorSync,
  listChannelObjectSyncs,
  createWorkflowSource,
  listTemplateLearningTasks,
  createTemplateLearningTask,
  stageTemplateLearningFile,
  startTemplateLearningTask,
  completeTemplateLearningTask,
  scanWorkflowSource,
  scanWorkflowIncrementalIntake,
  listWorkflowIntakeObservations,
  inspectWorkflowInquiryIntake,
  acceptWorkflowInquiryIntake,
  cancelWorkflowSourceScan,
  revokeWorkflowSource,
  deleteWorkflowSourceLearning,
  listWorkflowArtifacts,
  confirmWorkflowArtifact,
  retryWorkflowArtifactExtraction,
  getWorkflowOcrReadiness,
  ocrWorkflowArtifact,
  getWorkflowOcrStatus,
  cancelWorkflowOcrArtifact,
  setWorkflowArtifactExclusion,
  indexWorkflowSourceEmbeddings,
  analyzeWorkflowBusinessDocuments,
  cancelWorkflowBusinessDocumentAnalysis,
  analyzeWorkflowBusinessDocument,
  listWorkflowBusinessDocumentClassifications,
  listWorkflowBusinessDocumentAnalysisJobs,
  confirmWorkflowBusinessDocumentClassification,
  discoverWorkflowBusinessCases,
  listWorkflowBusinessCaseCandidates,
  reviewWorkflowBusinessCaseCandidate,
  discoverWorkflowBusinessRoutine,
  listWorkflowBusinessRoutineCandidates,
  createRoutineDraftFromDiscovery,
  listBusinessRoutineDefinitions,
  listTaskTemplates,
  updateBusinessRoutineDefinition,
  createBusinessRoutineDefinitionVersion,
  publishBusinessRoutineDefinition,
  transitionRoutineDefinition,
  createLedgerDefinition,
  listLedgerDefinitions,
  activateLedgerDefinition,
  disableLedgerDefinition,
  inspectLedgerTargetIdentity,
  readBusinessLedgerRecord,
  previewLedgerUpsert,
  previewLedgerBatchUpsert,
  commitLedgerUpsertPreview,
  commitLedgerBatchUpsertPreview,
  retryLedgerBatchUpsertPreview,
  listLedgerUpsertPreviews,
  listLedgerBatchUpsertPreviews,
  listLedgerBatchMutationJournals,
  listLedgerMutations,
  collectBusinessPilotEvidence,
  verifyBusinessPilotEvidence,
  getBusinessPilotWorkbench,
  saveBusinessPilotWorkbench,
  prepareBusinessPilotWorkbench,
  createBusinessPilotGapIssues,
  submitBusinessPilotReview,
  updateBusinessPilotRollout,
  collectBusinessPilotWorkbench,
  getBusinessPilotCollection,
  compareBusinessPilotCollections,
  exportBusinessPilotCollection,
  revokeBusinessPilotCollection,
  getWorkflowAdaptiveWorkbench,
  getWorkflowMemoryInsights,
  updateWorkflowAdaptivePolicy,
  updateWorkflowAdaptiveMonitor,
  updateWorkflowAdaptiveAutomation,
  runWorkflowAdaptiveMonitorNow,
  syncWorkflowAdaptiveOutcomes,
  listWorkflowAdaptiveLearning,
  generateWorkflowAdaptiveLearningDraft,
  evaluateWorkflowAdaptiveLearning,
  recordWorkflowAdaptiveShadowPreference,
  previewWorkflowAdaptiveLearningPublication,
  listWorkflowAdaptiveNotifications,
  readWorkflowAdaptiveNotification,
  publishWorkflowAdaptiveLearningDraft,
  rollbackWorkflowAdaptiveLearningRule,
  materializeWorkflowAdaptiveSuggestion,
  reconcileWorkflowAdaptiveWork,
  recordWorkflowAdaptiveFeedback,
  materializeRoutineIssue,
  getRoutineWorkItemExecution,
  listRoutineWorkQueue,
  startRoutineWorkItem,
  executeRoutineStep,
  confirmQuotationInputs,
  bindRoutineLedger,
  requestRoutineStepReview,
  resumeRoutineRecovery,
  completeRoutineStep,
  retryRoutineStep,
  decideRoutineApproval,
  decideRoutineCondition,
  cancelRoutineWorkItem,
  proposeWorkflowPairs,
  listDeliveryCases,
  createDeliveryCase,
  changeDeliveryCaseState,
  deriveWorkflowProfile,
  reviseWorkflowProfile,
  listWorkflowProfiles,
  listWorkflowProfileDrafts,
  createWorkflowProfileDraft,
  publishWorkflowProfileDraft,
  listWorkflowInbox,
  matchWorkflowProfiles,
  findSimilarWorkflowCases,
  evaluateWorkflowRetrieval,
  inspectWorkflowRequirement,
  listWorkflowRuns,
  createWorkflowRun,
  executeWorkflowRun,
  cancelWorkflowRunExecution,
  retryWorkflowRunExecution,
  cleanupWorkflowRunAttemptWorktree,
  selectWorkflowRunAttempt,
  validateWorkflowRun,
  recordWorkflowRunFeedback,
  previewWorkflowRunPublication,
  publishWorkflowRunOutputs,
  releaseIssueClaim,
  listIssueClaims,
  approveDesign,
  rejectDesign,
  answerClarify,
  approveDecomposition,
  rejectDecomposition,
  refreshAutoRunPrDispositions,
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
  cancelApplicationInstall,
  completeApplicationInstall,
  findApplication,
  findApplicationInstallRun,
  getApplicationOrchestrationRunRecovery,
  listApplicationOrchestrationRecoveryAgentCandidates,
  getApplicationOrchestrationRun,
  listApplicationCapabilities,
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
  issueApprovalGrant,
  setApplicationAutoRecovery,
  setApplicationHealthProbe,
  transitionApplication,
  confirmSshHostFingerprint,
  createSshTarget,
  updateSshTarget,
  createSshConnectionTest,
  observeSshHostFingerprint,
  verifySshHostConnection,
  listHostFileScopes,
  suggestHostFileScopes,
  createHostFileScope,
  updateHostFileScope,
  listHostFileEntries,
  listHostFileTransfers,
  uploadHostFile,
  downloadHostFile,
  listHostTlsActivationProfiles,
  createHostTlsActivationProfile,
  createManagedTerminalSession,
  queueTerminalBridgeAction,
  nextTerminalBridgeAction,
  recordTerminalBridgeEvent,
  recordTerminalEvidence,
  planSshHostDiagnostic,
  runSshHostDiagnostic,
  summarizeText,
  appendEvent,
  refuse,
  recordAgentFileAccess,
  recordRequestContext,
  recordRoundEvent,
  isAgentDisabled,
  redeliverExpiredDispatches,
  registerAgent,
  findAgent,
  requestObservabilityDeletion,
  disableAgent,
  enableAgent,
  createAgentHealthCheck,
  unlinkDevice,
  relinkDevice,
  deviceForToken,
  issueBridgeCredential,
  requireBridgeCredential,
  supersedeBridgeSession,
  recordCodexHookEvent,
  expireCodexApprovalBrokerRequests,
  resolveCodexApprovalBrokerRequest,
  recoverTimedOutCodexApproval,
  createCodexImportedEvidenceRecord,
  createCodexChangeReview,
  createCodexExecReview,
  setCodexSessionName,
  resumableCodexSessions,
  setClaudeSessionName,
  resumableClaudeSessions,
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
  createAuditExportRequest,
  budgetStatusFor,
  upsertBudget,
  decideLifecycleLocalApproval,
  evaluateLifecyclePolicy,
  queueLifecycleAction,
  queueRollbackAction,
  recordAiUsage,
  requestLifecycleLocalApproval,
  transitionLifecycleRecipe,
  updatePrivateDeploymentConfig,
  createAgentDryProbeRun,
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
  completeLifecycleAction,
  nextBridgeLifecycleAction,
  markIntegrationProbeStarted,
  findIntegrationProbeRun,
  completeIntegrationProbeRun,
  findInvocation,
  listInvocationEvents,
  listInvocationRefusals,
  getInvocationTrace,
  acknowledgeInvocation,
  completeInvocation,
  findApprovalRequest,
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
  claimDecision,
  releaseDecisionClaim,
  applyLocalSchedulePlan,
  applyLocalScheduleRollover,
  applyLocalScheduleUrgent,
  createToolInvocation,
  getTool,
  listTools,
  rollbackClaudeApply,
  createCapabilityInvocation,
  getCapability,
  listCapabilities,
  resolveCapability,
  createMailIssueFromImport,
  replyOnIssue,
  confirmReplyDraft,
  sendConfirmedDraft,
  mailboxSnapshot,
  startMailboxSync,
  prioritizeMailboxBodyPrefetch,
  setMailboxMessageRead,
  createMailboxDraft,
  updateMailboxDraft,
  deleteMailboxDraft,
  createMailboxTask,
  listMailResponsePackages,
  createMailResponsePackage,
  materializeMailResponsePackage,
  reviewMailResponsePackage,
  attachMailResponsePackageFiles,
  createMailDraftFromResponsePackage,
  listMailTaskPolicies,
  upsertMailTaskPolicy,
  evaluateMailTaskPolicies,
  getMailTaskOperations,
  startMailClassification,
  previewMailSemanticClassification,
  getMailClassificationJob,
  cancelMailClassificationJob,
  correctMailClassification,
  listMailClassificationRules,
  getMailClassificationQuality,
  createMailClassificationRule,
  updateMailClassificationRule,
  listMailFolderSuggestions,
  createMailFolderMovePreview,
  startMailFolderMove,
  getMailFolderMoveJob,
  listMailFolderMoveJobs,
  reconcileMailFolderMoveJob,
  createMailFolderRecoveryPreview,
  createMailFolderAutomationPreview,
  enableMailFolderAutomation,
  updateMailFolderAutomation,
  listMailFolderAutomations,
  dryRunMailFolderAutomation,
  rebuildLocalContentCatalog,
  searchLocalContent,
  browseLocalContentDirectories,
  describeLocalContentRetrieval,
  retrieveLocalContentDirectories,
  retrieveLocalContentSummaries,
  readRetrievedLocalContent,
  getLocalContentCatalogStats,
  previewLocalContent,
  previewLocalContentAsset,
  refreshLocalContent,
  archiveLocalContent,
  getLocalContentHealth,
  resolveLocalContentOriginal,
  resolveLocalContentContainer,
  listWorkResources,
  getWorkResource,
  previewWorkResource,
  refreshWorkResource,
  createMaterialWorkSession,
  getMaterialWorkSession,
  addMaterialWorkSessionMessage,
  cancelMaterialWorkSession,
  listCanvasScenes,
  getCanvasScene,
  createCanvasScene,
  updateCanvasScene,
  deleteCanvasScene,
  listWorkItems,
  getHomeWorkbench,
  listWorkItemAttention,
  getWorkItem,
  reconcileWorkItemRecordBindings,
  reconcileVisibleWorkItemRecordBindings,
  refreshWorkItemRecordBinding,
  refreshWorkItemRecordBindingsBatch,
  createWorkItem,
  createWorkItemFromExternal,
  captureWorkItemDataContext,
  updateWorkItem,
  recordWorkItemProgress,
  bulkUpdateWorkItems,
  transitionWorkItem,
  completeWorkItemDelivery,
  listWorkItemActivity,
  listWorkItemComments,
  createWorkItemComment,
  updateWorkItemComment,
  deleteWorkItemComment,
  recordWorkItemExecutionBinding,
  createWorkItemAutoRunBatch,
  listWorkItemAutoRunBatches,
  previewWorkItemAutoScheduler,
  listPlanningProjects,
  getPlanningProject,
  createPlanningProject,
  updatePlanningProject,
  setPlanningProjectArchived,
  addPlanningProjectItem,
  removePlanningProjectItem,
  reorderPlanningProjectItems,
  updatePlanningProjectItems,
  suggestPlanningPlan,
  executePlanningRecommendedAction,
  decidePlanningRecommendedAction,
  listSites,
  getSite,
  createSite,
  updateSite,
  listSiteEntries,
  getSiteEntry,
  createSiteEntry,
  updateSiteEntry,
  listSiteAssets,
  uploadSiteAsset,
  updateSiteAsset,
  deleteSiteAsset,
  getSiteAssetContent,
  previewSite,
  createSitePublicationPlan,
  getSitePublicationPlan,
  confirmSitePublicationPlan,
  listSitePublications,
  createSiteRollbackPlan,
  confirmSiteRollbackPlan,
  listSiteDeploymentProviders,
  configureSiteDeploymentTarget,
  verifySiteDeploymentTarget,
  configureSiteDomainTlsBinding,
  configureSiteDomainTlsDeployment,
  verifySiteDomainTlsDns,
  issueSiteDomainTlsStaging,
  deploySiteDomainTlsStaging,
  startSitePilotSession,
  getActiveSitePilotSession,
  updateSitePilotSession,
  deleteSitePilotSession,
  getSitePilotSummary,
  listSitePilotCampaigns,
  createSitePilotCampaign,
  updateSitePilotCampaign,
  deleteSitePilotCampaign,
  createSitePilotInvitation,
  resolveSitePilotWorkspace,
  registerChannel,
  listChannels,
  listChannelInteractions,
  enableChannel,
  disableChannel,
  channelHealth,
  channelDiagnostics,
  mapChannelIdentity,
  removeChannelIdentity,
  listChannelIdentities,
  setChannelAllowlist,
  setChannelTaskProject,
  setChannelApprovalPolicy,
  routeChannelTask,
  dismissChannelTask,
  retryChannelTask,
  reconcileWechatDraftChannelTask,
  rerouteChannelTask,
  takeoverChannelTask,
  replyChannelTask,
  retryChannelDelivery,
  beginIlinkLogin,
  pollIlinkLogin,
  activateIlinkChannel,
  disconnectIlinkChannel,
  onIlinkChannelStateChanged,
  nextId,
  persistStateSoon,
  persistStateNow,
  finalizePrivateTutorLearnerDeletion = null,
  privateTutorReleaseBuildId = "development-unversioned",
  identityProviderCore = null,
  provisionSiteCredential,
  revokeSiteCredential,
}) {
  const identityPolicy = identityPolicyFromEnv();
  const loopbackToken = configuredLoopbackToken();
  return http.createServer(async (req, res) => {
    try {
      // #1616 outer perimeter, before anything else: a Host header that names
      // a non-loopback hostname is a DNS-rebinding probe (or a misconfigured
      // proxy), never the desktop shell, the bridge, or the local console.
      if (!hostAllowed(req.headers?.host)) {
        sendJson(res, 403, { error: "host_not_allowed", message: "Requests must address the control plane by a loopback hostname." });
        return;
      }

      setCors(req, res);

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url ?? "/", `http://${host}:${port}`);

      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, {
          namespace,
          protocolVersion,
          status: "ok",
          service: "myagenttool-local-demo-server",
          time: now()
        });
        return;
      }

      // --- Identity: resolve the actor, then gate. `/api/session` (login) is
      // public and handled downstream in control-plane; everything else needs a
      // live token when MYAGENT_REQUIRE_AUTH is on. ---
      const actor = resolveActor(state, req, { now, persistStateSoon });
      const observationPath = url.pathname === "/api/terminal-observation/v1";
      if (observationPath) {
        if (req.method !== "GET") {
          sendJson(res, 405, { error: "observer_read_only" });
          return;
        }
        if (!validObserverToken(req.headers.authorization)) {
          sendJson(res, 401, { error: "invalid_observer_token" });
          return;
        }
        const snapshot = publicState(actor);
        const workItemsResult = listWorkItems({ limit: 100 }, actor);
        sendJson(res, 200, terminalObservationReadModel(snapshot, workItemsResult.body?.workItems ?? [], { now }));
        return;
      }
      // #1616 launch-token gate: when the desktop shell configured a loopback
      // token, every /api request must carry it — or ride a cookie session
      // that could only have been established through it. This is what stops
      // an arbitrary local process from driving the control plane. The
      // observation endpoint keeps its own >=24-char read-only token (above);
      // bridge and webhook paths are NOT exempt — the bridge is spawned with
      // the token, and external webhooks cannot reach loopback in this mode.
      if (loopbackToken && url.pathname.startsWith("/api/")) {
        const authorized = loopbackTokenValid(req, loopbackToken)
          || (actor.authenticated && actor.authMethod === "cookie");
        if (!authorized) {
          sendJson(res, 401, { error: "loopback_token_required", message: "This control plane only accepts requests from the desktop shell that launched it." });
          return;
        }
      }

      // #1616 content-type gate: a cross-site "simple request" can execute a
      // blind write with text/plain or urlencoded bodies even when CORS hides
      // the response. Every JSON route parses via readJson, so a declared
      // non-JSON body on a write is never legitimate. Absent Content-Type is
      // allowed: browsers always declare one when they attach a body.
      const binaryTaskMaterialUpload = req.method === "PUT"
        && /^\/api\/projects\/[^/]+\/task-material-drafts\/[^/]+\/files\/[^/]+$/.test(url.pathname);
      const binaryTemplateLearningUpload = req.method === "POST"
        && /^\/api\/workflow-memory\/template-learning\/[^/]+\/files$/.test(url.pathname);
      const binarySiteAssetUpload = req.method === "PUT"
        && /^\/api\/sites\/[^/]+\/assets$/.test(url.pathname);
      const binaryHostFileUpload = req.method === "POST"
        && /^\/api\/host-file-scopes\/[^/]+\/transfers\/upload$/.test(url.pathname);
      if (["POST", "PUT", "PATCH"].includes(req.method) && url.pathname.startsWith("/api/")
        && !binaryTaskMaterialUpload && !binaryTemplateLearningUpload && !binarySiteAssetUpload && !binaryHostFileUpload) {
        const contentType = String(req.headers["content-type"] ?? "").trim().toLowerCase();
        if (contentType && !contentType.startsWith("application/json")) {
          sendJson(res, 415, { error: "unsupported_content_type", message: "API writes must declare application/json." });
          return;
        }
      }

      if (await handleSiteCredentialRoutes({
        req,
        res,
        url,
        sendJson,
        readJson,
        desktopToken: process.env.MYAGENT_DESKTOP_CREDENTIAL_TOKEN ?? "",
        provision: provisionSiteCredential,
        revoke: revokeSiteCredential,
      })) return;

      const bridgePath = url.pathname.startsWith("/api/bridge/");
      // External providers authenticate webhook deliveries with endpoint-specific
      // signatures, so a user bearer token must not block those callbacks first.
      const issueWebhookPath = /^\/api\/webhooks\/(github|gitlab|gitea)\/work-items$/.test(url.pathname);
      const publicIdentityPath =
        (req.method === "POST" && url.pathname === "/api/session") ||
        (req.method === "POST" && url.pathname === "/api/identity/recovery/complete") ||
        url.pathname === "/api/identity/options" ||
        url.pathname.startsWith("/api/identity/challenges");
      const publicPath = publicIdentityPath || bridgePath || issueWebhookPath;
      if (identityPolicy.requireAuth && !publicPath && !actor.authenticated) {
        sendJson(res, 401, { error: "unauthenticated", message: "Valid session token required." });
        return;
      }
      const mutating = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
      if (mutating && !publicPath && actor.authMethod === "cookie" && !validSessionCsrf(req, actor)) {
        sendJson(res, 403, { error: "csrf_invalid", message: "A valid CSRF token is required." });
        return;
      }

      // A parent commonly hands an already signed-in computer to a child. Once
      // that browser session enters child mode, the server — not just the UI —
      // confines it to My Private Tutor until parent re-verification succeeds.
      const childModeSessionRead = req.method === "GET" && url.pathname === "/api/session";
      if (actor.privateTutorLearnerId
        && url.pathname.startsWith("/api/")
        && !url.pathname.startsWith("/api/private-tutor/")
        && !childModeSessionRead) {
        sendJson(res, 403, {
          error: "private_tutor_child_mode_restricted",
          learnerId: actor.privateTutorLearnerId,
        });
        return;
      }

      const professionalAuthority = authorizeProfessionalRequest(actor, req.method, url.pathname);
      if (!publicPath && !professionalAuthority.allowed) {
        sendJson(res, 403, professionalRoleForbiddenBody(professionalAuthority.capability));
        return;
      }

      if (await handleIdentityRoutes({
        req,
        res,
        url,
        sendJson,
        readJson,
        state,
        actor,
        now,
        persistStateSoon,
        policy: identityPolicy,
        providerCore: identityProviderCore,
      })) {
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/state") {
        expireCodexApprovalBrokerRequests();
        // One-time per project: turn the seeded `git` placeholder into real facts,
        // so the Projects list can say where a project pushes (#1213).
        backfillProjectGitFacts(state.projects);
        // Stage 2 (#1342): backfill executionScope + runtimeRequirements onto legacy
        // Application descriptors persisted before the dual-layer model (idempotent).
        backfillApplicationRuntimeMetadata(state.applications);
        const snapshot = publicState(actor);
        const acceptsConsoleState = String(req.headers.accept ?? "")
          .split(",")
          .some((value) => value.trim().split(";")[0] === CONSOLE_STATE_MEDIA_TYPE);
        sendJson(res, 200, acceptsConsoleState ? buildConsoleState(snapshot) : snapshot);
        return;
      }

      if (await handleGuidedSetupRoutes({
        req,
        res,
        url,
        sendJson,
        readJson,
        state,
        actor,
        now,
        nextId,
        persistStateSoon,
        persistStateNow,
        publicState,
      })) {
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/events/stream") {
        const streamMetrics = ensureEventStreamMetrics(state, actor?.teamId);
        streamMetrics.activeConnections += 1;
        streamMetrics.connections += 1;
        persistStateSoon();
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        let lastEventId = state.events?.[0]?.id ?? null;
        res.write(`event: ready\ndata: ${JSON.stringify({ lastEventId })}\n\n`);
        const requestedCursor = String(req.headers["last-event-id"] ?? "");
        for (const event of eventsAfter(state.events ?? [], requestedCursor)) {
          res.write(`id: ${event.id}\nevent: state\ndata: ${JSON.stringify({ eventId: event.id, type: event.type, replayed: true })}\n\n`);
        }
        const changes = setInterval(() => {
          const nextEvent = state.events?.[0] ?? null;
          if (nextEvent?.id && nextEvent.id !== lastEventId) {
            lastEventId = nextEvent.id;
            const latencyMs = Math.max(0, Date.now() - Date.parse(nextEvent.createdAt));
            streamMetrics.eventsSent += 1;
            streamMetrics.eventLatencyTotalMs += Number.isFinite(latencyMs) ? latencyMs : 0;
            streamMetrics.eventLatencyMaxMs = Math.max(streamMetrics.eventLatencyMaxMs, Number.isFinite(latencyMs) ? latencyMs : 0);
            res.write(`id: ${nextEvent.id}\nevent: state\ndata: ${JSON.stringify({ eventId: nextEvent.id, type: nextEvent.type })}\n\n`);
          }
        }, 500);
        const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15_000);
        const close = () => {
          clearInterval(changes);
          clearInterval(heartbeat);
          if (streamMetrics.activeConnections > 0) {
            streamMetrics.activeConnections -= 1;
            streamMetrics.disconnects += 1;
            persistStateSoon();
          }
        };
        req.once("close", close);
        res.once("close", close);
        return;
      }

      if (await handleControlPlaneRoutes({
        req,
        res,
        url,
        sendJson,
        readJson,
        state,
        actor,
        now,
        nextId,
        appendEvent,
        findAgent,
        defaultAgent,
        createInvocation,
        startInvocationIfAllowed,
        persistStateSoon,
        budgetStatusFor,
        upsertBudget,
        // A capability-target automation validates against the live contract and
        // fires through the same dispatch the Run panel uses (#847).
        getCapability,
        createCapabilityInvocation,
        // ADR 0018: owner-gated per-subject observability data deletion.
        requestObservabilityDeletion,
      })) {
        return;
      }

      if (await handleWorkProfileRoutes({
        req,
        res,
        url,
        sendJson,
        readJson,
        state,
        actor,
        now,
        nextId,
        persistStateSoon,
      })) {
        return;
      }

      if (await handlePrivateTutorRoutes({
        req,
        res,
        url,
        sendJson,
        readJson,
        state,
        actor,
        now,
        nextId,
        persistStateSoon,
        persistStateNow,
        finalizePrivateTutorLearnerDeletion,
        privateTutorReleaseBuildId,
      })) {
        return;
      }

      if (await handleMailRoutes({
        req, res, url, sendJson, readJson, actor,
        createMailIssueFromImport, replyOnIssue, confirmReplyDraft, sendConfirmedDraft,
        mailboxSnapshot, startMailboxSync, prioritizeMailboxBodyPrefetch, setMailboxMessageRead, createMailboxDraft, updateMailboxDraft, deleteMailboxDraft, createMailboxTask,
        listMailResponsePackages, createMailResponsePackage, materializeMailResponsePackage, reviewMailResponsePackage, attachMailResponsePackageFiles, createMailDraftFromResponsePackage,
        listMailTaskPolicies, upsertMailTaskPolicy, evaluateMailTaskPolicies, getMailTaskOperations,
        startMailClassification, previewMailSemanticClassification, getMailClassificationJob, cancelMailClassificationJob, correctMailClassification,
        listMailClassificationRules, getMailClassificationQuality, createMailClassificationRule, updateMailClassificationRule,
        listMailFolderSuggestions, createMailFolderMovePreview, startMailFolderMove, getMailFolderMoveJob, listMailFolderMoveJobs,
        reconcileMailFolderMoveJob, createMailFolderRecoveryPreview,
        createMailFolderAutomationPreview, enableMailFolderAutomation, updateMailFolderAutomation, listMailFolderAutomations, dryRunMailFolderAutomation,
      })) {
        return;
      }

      if (await handleLocalContentRoutes({
        req, res, url, sendJson, readJson, actor,
        rebuildLocalContentCatalog, searchLocalContent, browseLocalContentDirectories, describeLocalContentRetrieval,
        retrieveLocalContentDirectories, retrieveLocalContentSummaries, readRetrievedLocalContent,
        getLocalContentCatalogStats, previewLocalContent, previewLocalContentAsset,
        refreshLocalContent, archiveLocalContent, getLocalContentHealth, resolveLocalContentOriginal, resolveLocalContentContainer,
        listWorkResources, getWorkResource, previewWorkResource, refreshWorkResource,
      })) {
        return;
      }

      if (await handleMaterialWorkSessionRoutes({
        req, res, url, sendJson, readJson, actor,
        createMaterialWorkSession,
        getMaterialWorkSession,
        addMaterialWorkSessionMessage,
        cancelMaterialWorkSession,
      })) {
        return;
      }

      if (await handleChannelRoutes({
        setChannelTaskProject,
        setChannelApprovalPolicy,
        routeChannelTask,
        dismissChannelTask,
        retryChannelTask,
        reconcileWechatDraftChannelTask,
        rerouteChannelTask,
        takeoverChannelTask,
        replyChannelTask,
        req,
        res,
        url,
        sendJson,
        readJson,
        actor,
        registerChannel,
        listChannels,
        listChannelInteractions,
        enableChannel,
        disableChannel,
        channelHealth,
        channelDiagnostics,
        mapChannelIdentity,
        removeChannelIdentity,
        listChannelIdentities,
        setChannelAllowlist,
        retryChannelDelivery,
        beginIlinkLogin,
        pollIlinkLogin,
        activateIlinkChannel,
        disconnectIlinkChannel,
        onIlinkChannelStateChanged,
        getChannelNotificationPolicy,
        listChannelNotificationPolicies,
        setChannelNotificationPolicy,
      })) {
        return;
      }

      if (await handleCanvasSceneRoutes({
        req, res, url, sendJson, readJson, actor,
        listScenes: listCanvasScenes,
        getScene: getCanvasScene,
        createScene: createCanvasScene,
        updateScene: updateCanvasScene,
        deleteScene: deleteCanvasScene,
      })) {
        return;
      }

      if (await handleChannelObjectRoutes({
        req, res, url, sendJson, readJson, actor,
        listChannelObjects,
        upsertChannelObject,
        setChannelObjectStatus,
        previewChannelObjectImport,
        confirmChannelObjectImport,
        listChannelObjectImports,
        listChannelObjectFileSources,
        listChannelMutationBindings,
        upsertChannelMutationBinding,
        setChannelMutationBindingStatus,
        listChannelObjectConnectors,
        listChannelObjectConnectorConfigs,
        upsertChannelObjectConnectorConfig,
        setChannelObjectConnectorConfigStatus,
        testChannelObjectConnectorConfig,
        previewChannelObjectConnectorSync,
        confirmChannelObjectConnectorSync,
        syncChannelObjectConnector,
        retryChannelObjectConnectorSync,
        listChannelObjectSyncs,
      })) {
        return;
      }

      if (await handleWorkflowMemoryRoutes({
        req,
        res,
        url,
        sendJson,
        readJson,
        actor,
        listSources: listWorkflowSources,
        createSource: createWorkflowSource,
        listTemplateLearningTasks,
        createTemplateLearningTask,
        stageTemplateLearningFile,
        startTemplateLearningTask,
        completeTemplateLearningTask,
        scanSource: scanWorkflowSource,
        scanIncrementalIntake: scanWorkflowIncrementalIntake,
        listIntakeObservations: listWorkflowIntakeObservations,
        inspectInquiryIntake: inspectWorkflowInquiryIntake,
        acceptInquiryIntake: acceptWorkflowInquiryIntake,
        cancelScan: cancelWorkflowSourceScan,
        revokeSource: revokeWorkflowSource,
        deleteSourceLearning: deleteWorkflowSourceLearning,
        listArtifacts: listWorkflowArtifacts,
        confirmArtifact: confirmWorkflowArtifact,
        retryArtifactExtraction: retryWorkflowArtifactExtraction,
        getOcrReadiness: getWorkflowOcrReadiness,
        ocrArtifact: ocrWorkflowArtifact,
        getOcrStatus: getWorkflowOcrStatus,
        cancelOcrArtifact: cancelWorkflowOcrArtifact,
        setArtifactExclusion: setWorkflowArtifactExclusion,
        indexSourceEmbeddings: indexWorkflowSourceEmbeddings,
        analyzeBusinessDocuments: analyzeWorkflowBusinessDocuments,
        cancelBusinessAnalysis: cancelWorkflowBusinessDocumentAnalysis,
        analyzeBusinessDocument: analyzeWorkflowBusinessDocument,
        listBusinessDocumentClassifications: listWorkflowBusinessDocumentClassifications,
        listBusinessDocumentAnalysisJobs: listWorkflowBusinessDocumentAnalysisJobs,
        confirmBusinessDocumentClassification: confirmWorkflowBusinessDocumentClassification,
        discoverBusinessCases: discoverWorkflowBusinessCases,
        listBusinessCaseCandidates: listWorkflowBusinessCaseCandidates,
        reviewBusinessCaseCandidate: reviewWorkflowBusinessCaseCandidate,
        discoverBusinessRoutine: discoverWorkflowBusinessRoutine,
        listBusinessRoutineCandidates: listWorkflowBusinessRoutineCandidates,
        createRoutineDraft: createRoutineDraftFromDiscovery,
        listBusinessRoutineDefinitions,
        listTaskTemplates,
        updateBusinessRoutineDefinition,
        createBusinessRoutineDefinitionVersion,
        publishBusinessRoutineDefinition,
        transitionBusinessRoutineDefinition: transitionRoutineDefinition,
        createLedgerDefinition,
        listLedgerDefinitions,
        activateLedgerDefinition,
        disableLedgerDefinition,
        inspectLedgerTargetIdentity,
        readBusinessLedgerRecord,
        previewLedgerUpsert,
        previewLedgerBatchUpsert,
        commitLedgerUpsertPreview,
        commitLedgerBatchUpsertPreview,
        retryLedgerBatchUpsertPreview,
        listLedgerUpsertPreviews,
        listLedgerBatchUpsertPreviews,
        listLedgerBatchMutationJournals,
        listLedgerMutations,
        collectBusinessPilotEvidence,
        verifyBusinessPilotEvidence,
        getBusinessPilotWorkbench,
        saveBusinessPilotWorkbench,
        prepareBusinessPilotWorkbench,
        createBusinessPilotGapIssues,
        submitBusinessPilotReview,
        updateBusinessPilotRollout,
        collectBusinessPilotWorkbench,
        getBusinessPilotCollection,
        compareBusinessPilotCollections,
        exportBusinessPilotCollection,
        revokeBusinessPilotCollection,
        getWorkflowAdaptiveWorkbench,
        getWorkflowMemoryInsights,
        updateWorkflowAdaptivePolicy,
        updateWorkflowAdaptiveMonitor,
        updateWorkflowAdaptiveAutomation,
        runWorkflowAdaptiveMonitorNow,
        syncWorkflowAdaptiveOutcomes,
        listWorkflowAdaptiveLearning,
        generateWorkflowAdaptiveLearningDraft,
        evaluateWorkflowAdaptiveLearning,
        recordWorkflowAdaptiveShadowPreference,
        previewWorkflowAdaptiveLearningPublication,
        listWorkflowAdaptiveNotifications,
        readWorkflowAdaptiveNotification,
        publishWorkflowAdaptiveLearningDraft,
        rollbackWorkflowAdaptiveLearningRule,
        materializeWorkflowAdaptiveSuggestion,
        reconcileWorkflowAdaptiveWork,
        recordWorkflowAdaptiveFeedback,
        materializeRoutineIssue,
        getRoutineWorkItemExecution,
        listRoutineWorkQueue,
        startRoutineWorkItem,
        executeRoutineStep,
        confirmQuotationInputs,
        bindRoutineLedger,
        requestRoutineStepReview,
        resumeRoutineRecovery,
        completeRoutineStep,
        retryRoutineStep,
        decideRoutineApproval,
        decideRoutineCondition,
        cancelRoutineWorkItem,
        pairProposals: proposeWorkflowPairs,
        listCases: listDeliveryCases,
        createCase: createDeliveryCase,
        changeCaseState: changeDeliveryCaseState,
        deriveProfile: deriveWorkflowProfile,
        reviseProfile: reviseWorkflowProfile,
        listProfiles: listWorkflowProfiles,
        listProfileDrafts: listWorkflowProfileDrafts,
        createProfileDraft: createWorkflowProfileDraft,
        publishProfileDraft: publishWorkflowProfileDraft,
        listInbox: listWorkflowInbox,
        matchProfiles: matchWorkflowProfiles,
        findSimilarCases: findSimilarWorkflowCases,
        evaluateRetrieval: evaluateWorkflowRetrieval,
        inspectRequirement: inspectWorkflowRequirement,
        listRuns: listWorkflowRuns,
        createRun: createWorkflowRun,
        executeRun: executeWorkflowRun,
        cancelRunExecution: cancelWorkflowRunExecution,
        retryRunExecution: retryWorkflowRunExecution,
        cleanupRunAttemptWorktree: cleanupWorkflowRunAttemptWorktree,
        selectRunAttempt: selectWorkflowRunAttempt,
        validateRun: validateWorkflowRun,
        recordRunFeedback: recordWorkflowRunFeedback,
        previewRunPublication: previewWorkflowRunPublication,
        publishRunOutputs: publishWorkflowRunOutputs,
      })) {
        return;
      }

      if (await handleWorkItemRoutes({
        req, res, url, sendJson, readJson, actor, state,
        listWorkItems, getHomeWorkbench, listAttention: listWorkItemAttention, getWorkItem, createWorkItem, createWorkItemFromExternal, updateWorkItem, updateTaskContext: updateWorkItemTaskContext, recordWorkItemProgress, bulkUpdateWorkItems, transitionWorkItem,
        reconcileWorkItemRecordBindings, reconcileVisibleWorkItemRecordBindings,
        refreshWorkItemRecordBinding, refreshWorkItemRecordBindingsBatch,
        listReportDrafts: listWorkItemReportDrafts,
        getReportDraft: getWorkItemReportDraft,
        generateReportDraft: generateWorkItemReportDraft,
        updateReportDraft: updateWorkItemReportDraft,
        confirmReportDraft: confirmWorkItemReportDraft,
        discardReportDraft: discardWorkItemReportDraft,
        listReportDeliveries: listWorkItemReportDeliveries,
        getReportDelivery: getWorkItemReportDelivery,
        previewReportDelivery: previewWorkItemReportDelivery,
        sendReportDelivery: sendWorkItemReportDelivery,
        listActivity: listWorkItemActivity,
        listComments: listWorkItemComments,
        createComment: createWorkItemComment,
        updateComment: updateWorkItemComment,
        deleteComment: deleteWorkItemComment,
        createWorktree,
        enqueueAutoRunUnderstanding: enqueueWorkItemAutoRunUnderstanding,
        reserveAutoRun,
        attachAutoRunExecutionPlan,
        failAutoRunUnderstanding,
        startAutoRun,
        beginExecution: beginWorkItemExecution,
        abortExecution: abortWorkItemExecution,
        recordExecutionBinding: recordWorkItemExecutionBinding,
        createAutoRunBatch: createWorkItemAutoRunBatch,
        listAutoRunBatches: listWorkItemAutoRunBatches,
        previewAutoScheduler: previewWorkItemAutoScheduler,
        promoteWorktreeToBase,
        promoteWorktreeToPullRequest,
        beginDelivery: beginWorkItemDelivery,
        failDelivery: failWorkItemDelivery,
        completeDelivery: completeWorkItemDelivery,
        claimWorkItem,
        releaseWorkItemClaim,
        assignWorkItemToSelf,
        bindGithubIssue,
        syncGithubIssue,
        bindExternalIssue,
        syncExternalIssue,
        listExternalProviders: listWorkItemExternalProviders,
        getExternalIssueFunnel: getWorkItemExternalIssueFunnel,
        fetchExternalIssue: fetchWorkItemExternalIssue,
        listExternalIssues: listWorkItemExternalIssues,
        pushExternalIssue: pushWorkItemExternalIssue,
        fetchGithubIssue: fetchWorkItemGithubIssue,
        pushGithubIssue: pushWorkItemGithubIssue,
        recordVerification: recordWorkItemVerification,
        recordAssetOperation: recordWorkItemAssetOperation,
        startApplicationExecution: startWorkItemApplicationExecution,
        requestApplicationExecutionApproval: requestWorkItemApplicationApproval,
        ingestGithubWebhook: ingestGithubWorkItemWebhook,
        replayGithubWebhook: replayGithubWorkItemWebhook,
        recordGithubWebhookFailure: recordGithubWorkItemWebhookFailure,
        ingestExternalWebhook: ingestExternalWorkItemWebhook,
        replayExternalWebhook: replayExternalWorkItemWebhook,
        recordExternalWebhookFailure: recordExternalWorkItemWebhookFailure,
        updateAttention: updateWorkItemAttention,
        githubSyncDiagnostics: getWorkItemGithubSyncDiagnostics,
        suggestWorkItemDraft,
        previewIntentTaskPlan,
        commitIntentTaskPlan,
        prepareLedgerPostingPlan,
        commitLedgerPostingPlan,
        getLedgerPostingPlan,
        createResultRepairTask,
        listMyTemplateRoutingFeedback,
        removeMyTemplateRoutingFeedback,
        previewMyTemplateDraft,
        listMyTemplateDrafts,
        reviewMyTemplateDraft,
        listSimilarMyTemplateWorkItems,
        createMyTemplateDraft,
        addMyTemplateLearningCase,
        activateMyTemplateDraft,
        listMyTemplateOutcomeFeedback,
        recordMyTemplateOutcomeFeedback,
        recordPlanActualFeedback,
        resumeMyTemplateGovernanceObservation,
        prepareExecutionContract: prepareWorkItemExecutionContract,
        confirmExecutionContractAndSchedule: confirmWorkItemExecutionContractAndSchedule,
        cancelExecutionStart: cancelWorkItemExecutionStart,
        recheckExecutionStart: recheckWorkItemExecutionStart,
        budgetStatusFor,
        retryWorkItemAlert,
        inspectArticleImport,
        startArticleImport,
        listArticleImports,
        getArticleImport,
        cancelArticleImport,
        analyzeArticleImport,
        findSimilarArticleImports,
        createArticleDerivative,
        listArticleDerivatives,
        getArticleDerivative,
        addMaterials: addWorkItemMaterials,
        removeMaterial: removeWorkItemMaterial,
        captureDataContextSnapshot: captureWorkItemDataContext,
        restoreMaterial: restoreWorkItemMaterial,
        addContentReference: addWorkItemContentReference,
        removeContentReference: removeWorkItemContentReference,
        addResourceReference: addWorkItemResourceReference,
        refreshResourceReference: refreshWorkItemResourceReference,
        inspectResourceReferences: inspectWorkItemResourceReferences,
        removeResourceReference: removeWorkItemResourceReference,
      })) {
        return;
      }

      if (await handlePlanningProjectRoutes({
        req, res, url, sendJson, readJson, actor,
        listProjects: listPlanningProjects,
        getProject: getPlanningProject,
        createProject: createPlanningProject,
        updateProject: updatePlanningProject,
        setArchived: setPlanningProjectArchived,
        addItem: addPlanningProjectItem,
        removeItem: removePlanningProjectItem,
        reorderItems: reorderPlanningProjectItems,
        updateItems: updatePlanningProjectItems,
        suggestPlan: suggestPlanningPlan,
        executeRecommendedAction: executePlanningRecommendedAction,
        decideRecommendedAction: decidePlanningRecommendedAction,
      })) {
        return;
      }

      if (await handleSitePilotRoutes({
        req, res, url, sendJson, readJson, actor,
        startSitePilotSession,
        getActiveSitePilotSession,
        updateSitePilotSession,
        deleteSitePilotSession,
        getSitePilotSummary,
        listSitePilotCampaigns,
        createSitePilotCampaign,
        updateSitePilotCampaign,
        deleteSitePilotCampaign,
        createSitePilotInvitation,
      })) {
        return;
      }

      if (await handleSiteRoutes({
        req, res, url, sendJson, readJson, actor,
        resolveSitePilotWorkspace,
        listSites,
        getSite,
        createSite,
        updateSite,
        listEntries: listSiteEntries,
        getEntry: getSiteEntry,
        createEntry: createSiteEntry,
        updateEntry: updateSiteEntry,
        listAssets: listSiteAssets,
        uploadAsset: uploadSiteAsset,
        updateAsset: updateSiteAsset,
        deleteAsset: deleteSiteAsset,
        getAssetContent: getSiteAssetContent,
        previewSite,
        createPublicationPlan: createSitePublicationPlan,
        getPublicationPlan: getSitePublicationPlan,
        confirmPublicationPlan: confirmSitePublicationPlan,
        listPublications: listSitePublications,
        createRollbackPlan: createSiteRollbackPlan,
        confirmRollbackPlan: confirmSiteRollbackPlan,
        listDeploymentProviders: listSiteDeploymentProviders,
        configureDeploymentTarget: configureSiteDeploymentTarget,
        verifyDeploymentTarget: verifySiteDeploymentTarget,
        configureDomainTlsBinding: configureSiteDomainTlsBinding,
        configureDomainTlsDeployment: configureSiteDomainTlsDeployment,
        verifyDomainTlsDns: verifySiteDomainTlsDns,
        issueDomainTlsStaging: issueSiteDomainTlsStaging,
        deployDomainTlsStaging: deploySiteDomainTlsStaging,
      })) {
        return;
      }

      if (handleLoopRoutineRoutes({ req, res, url, sendJson, currentLoopRoutineProjectContext })) {
        return;
      }

      if (await handleSessionRoutes({
        req, res, url, sendJson,
        listSessions,
        probeSessionSite,
        reseedSessionSite,
        actor,
      })) {
        return;
      }

      if (await handleTaskMaterialRoutes({
        req, res, url, sendJson, readJson, state, actor,
        createTaskMaterialDraft,
        getTaskMaterialDraft,
        uploadTaskMaterialFile,
        removeTaskMaterialFile,
        readTaskMaterialContent,
        previewTaskMaterialCleanup,
        executeTaskMaterialCleanup,
      })) {
        return;
      }

      if (await handleProjectRoutes({
        req,
        res,
        url,
        sendJson,
        readJson,
        state,
        actor,
        refuse,
        persistStateSoon,
        currentProject,
        addProject,
        cloneProject,
        createWorkItem,
        createBlankProject,
        createWorktree,
        createWorktreePr,
        publishWorktreeBranch,
        ensureLocalOrigin,
        startAutoRun,
        retryAutoRun,
        reverifyAutoRun,
        reconcileExecutionAction,
        cancelAutoRun,
        stopAutoRunDelivery,
        mergeAutoRunPr,
        recordRoutingOverride,
        setReportSchedule,
        postReportNow,
        claimIssue,
        releaseIssueClaim,
        listIssueClaims,
        approveDesign,
        rejectDesign,
        answerClarify,
        approveDecomposition,
        rejectDecomposition,
        budgetStatusFor,
        refreshAutoRunPrDispositions,
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
      })) {
        return;
      }

      if (await handleAgentSkillRoutes({
        req,
        res,
        url,
        sendJson,
        readJson,
        state,
        createAgentSkill,
        updateAgentSkill,
        deleteAgentSkill,
      })) {
        return;
      }

      if (await handleApprovalGrantRoutes({ req, res, url, sendJson, readJson, actor, issueApprovalGrant })) {
        return;
      }

      if (await handleArticleExtractorPluginRoutes({
        req,
        res,
        url,
        sendJson,
        readJson,
        actor,
        listPlugins: listArticleExtractorPlugins,
        planInstall: planArticleExtractorPluginInstall,
        installPlugin: installArticleExtractorPlugin,
        disablePlugin: disableArticleExtractorPlugin,
        activatePlugin: activateArticleExtractorPlugin,
      })) {
        return;
      }

      if (await handleApplicationRoutes({
        req,
        res,
        url,
        sendJson,
        readJson,
        state,
        actor,
        now,
        cancelApplicationInstall,
        findApplication,
        findApplicationInstallRun,
        getApplicationOrchestrationRunRecovery,
        listApplicationOrchestrationRecoveryAgentCandidates,
        getApplicationOrchestrationRun,
        listApplicationCapabilities,
        listApplications,
        listApplicationOrchestrationRunEvents,
        listApplicationOrchestrationRuns,
        probeApplication,
        repairApplication,
        queueApplicationInstall,
        registerApplication,
        requestApplicationOrchestrationRecoveryAction,
        readApplicationRecoveryArchive,
        setApplicationAutoRecovery,
        setApplicationHealthProbe,
        transitionApplication,
        createCapabilityInvocation,
        runApplicationOrchestration,
      })) {
        return;
      }

      if (await handleTerminalRoutes({
        req,
        res,
        url,
        sendJson,
        readJson,
        actor,
        state,
        confirmSshHostFingerprint,
        createSshTarget,
        updateSshTarget,
        createSshConnectionTest,
        observeSshHostFingerprint,
        verifySshHostConnection,
        listHostFileScopes,
        suggestHostFileScopes,
        createHostFileScope,
        updateHostFileScope,
        listHostFileEntries,
        listHostFileTransfers,
        uploadHostFile,
        downloadHostFile,
        listHostTlsActivationProfiles,
        createHostTlsActivationProfile,
        createManagedTerminalSession,
        queueTerminalBridgeAction,
        nextTerminalBridgeAction,
        recordTerminalBridgeEvent,
        recordTerminalEvidence,
        planSshHostDiagnostic,
        runSshHostDiagnostic,
        requireBridgeCredential,
        summarizeText,
      })) {
        return;
      }

      if (await handleAgentRoutes({
        req,
        res,
        url,
        sendJson,
        readJson,
        state,
        actor,
        now,
        appendEvent,
        isAgentDisabled,
        redeliverExpiredDispatches,
        registerAgent,
        findAgent,
        disableAgent,
        enableAgent,
        createAgentHealthCheck,
        createAgentDryProbeRun,
        findIntegrationProbeRun,
        unlinkDevice,
        relinkDevice,
        deviceForToken,
        issueBridgeCredential,
        requireBridgeCredential,
        supersedeBridgeSession,
        persistStateSoon,
      })) {
        return;
      }

      if (await handleCodexRoutes({
        req,
        res,
        url,
        sendJson,
        readJson,
        state,
        actor,
        recordCodexHookEvent,
        expireCodexApprovalBrokerRequests,
        resolveCodexApprovalBrokerRequest,
        recoverTimedOutCodexApproval,
        createCodexImportedEvidenceRecord,
        createCodexChangeReview,
        createCodexExecReview,
        execRunPromotionGate,
        createWorktreePr,
        findInvocation,
        appendEvent, setCodexSessionName, resumableCodexSessions,
        setClaudeSessionName, resumableClaudeSessions,
      })) {
        return;
      }

      if (await handleIntegrationRoutes({
        req,
        res,
        url,
        sendJson,
        readJson,
        createDiscoveryRun,
        createIntegrationArtifact,
        findIntegrationArtifact,
        generateIntegrationArtifacts,
        createIntegrationProbeRun,
        registerIntegrationArtifact,
        transitionIntegrationArtifact,
        updateIntegrationRetentionSettings,
        draftIntegrationWithPlatformAgent,
        findDiscoveryRun,
        registerDiscoveredCandidate,
      })) {
        return;
      }

      if (await handleM3Routes({
        req,
        res,
        url,
        sendJson,
        readJson,
        state,
        actor,
        refuse,
        chargebackExport,
        createAuditExportRequest,
        createLifecycleRecipe,
        createPrivateCatalogEntry,
        createSignedBundleManifest,
        createQuotaPolicy,
        decideLifecycleLocalApproval,
        evaluateLifecyclePolicy,
        findLifecycleLocalApproval,
        findLifecycleRollbackRequest,
        findLifecycleRecipe,
        findPrivateCatalogEntry,
        queueLifecycleAction,
        queueRollbackAction,
        recordAiUsage,
        requestLifecycleLocalApproval,
        transitionLifecycleRecipe,
        updatePrivateDeploymentConfig,
      })) {
        return;
      }

      if (await handleCapabilityRoutes({
        req,
        res,
        url,
        sendJson,
        readJson,
        state,
        actor,
        listCapabilities,
        getCapability,
        createCapabilityInvocation,
        resolveCapability,
      })) {
        return;
      }

      if (await handleToolRoutes({
        req,
        res,
        url,
        sendJson,
        readJson,
        state,
        actor,
        listTools,
        getTool,
        createToolInvocation,
        rollbackClaudeApply,
      })) {
        return;
      }

      if (handleReviewFindingRoutes({
        req,
        res,
        url,
        sendJson,
        state,
        actor,
        publicState,
      })) {
        return;
      }

      if (await handleBridgeRoutes({
        req,
        res,
        url,
        sendJson,
        readJson,
        state,
        namespace,
        protocolVersion,
        now,
        cancellationSignal,
        redeliverExpiredDispatches,
        nextDispatchableInvocation,
        markDispatched,
        findAgent,
        projectForInvocation,
        nextBridgeHealthCheck,
        markHealthCheckStarted,
        completeHealthCheck,
        nextBridgeDiscoveryRun,
        markDiscoveryStarted,
        normalizeStringArray,
        findDiscoveryRun,
        completeDiscoveryRun,
        nextBridgeProbeRun,
        nextBridgeApplicationInstall,
        findApplicationInstallRun,
        recordApplicationInstallProgress,
        completeApplicationInstall,
        markLifecycleActionStarted,
        completeLifecycleAction,
        nextBridgeLifecycleAction,
        markIntegrationProbeStarted,
        findIntegrationProbeRun,
        completeIntegrationProbeRun,
        findIntegrationArtifact,
        findInvocation,
        acknowledgeInvocation,
        appendEvent,
        refuse,
        recordAgentFileAccess,
        recordRequestContext,
        recordRoundEvent,
        recordCodexHookEvent,
        expireCodexApprovalBrokerRequests,
        completeInvocation,
        requireBridgeCredential,
      })) {
        return;
      }

      if (await handleInvocationRoutes({
        req,
        res,
        url,
        sendJson,
        readJson,
        state,
        actor,
        findApprovalRequest,
        findInvocation,
        listInvocationEvents,
        listInvocationRefusals,
        getInvocationTrace,
        approveInvocation,
        denyInvocation,
        findAgent,
        defaultAgent,
        createInvocation,
        startInvocationIfAllowed,
        normalizeStringArray,
        createCompareRun,
        setCompareRunPreferred,
        promoteCompareRun,
        cancelInvocation,
        createTroubleshootingReport,
        claimDecision,
        releaseDecisionClaim,
        applyLocalSchedulePlan,
        applyLocalScheduleRollover,
        applyLocalScheduleUrgent,
      })) {
        return;
      }

      sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      sendJson(res, 500, {
        error: "internal_error",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });
}

function validObserverToken(authorization) {
  const expected = String(process.env.MYAGENTTOOL_OBSERVER_TOKEN ?? "");
  const supplied = String(authorization ?? "").match(/^Observer\s+(.+)$/i)?.[1] ?? "";
  if (expected.length < 24 || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

function setCors(req, res) {
  const origin = String(req.headers?.origin ?? "");
  const configured = new Set(String(process.env.MYAGENT_CORS_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean));
  let allowed = configured.has(origin);
  if (origin && !allowed) {
    try {
      const originUrl = new URL(origin);
      const requestHost = new URL(`http://${req.headers?.host ?? "invalid"}`);
      allowed =
        ["localhost", "127.0.0.1", "::1"].includes(originUrl.hostname) ||
        originUrl.hostname === requestHost.hostname;
    } catch {
      allowed = false;
    }
  }
  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type,Range,X-CSRF-Token,X-Loopback-Token,X-Transfer-Confirmed,X-Overwrite-Confirmed");
  res.setHeader("Access-Control-Expose-Headers", "Accept-Ranges,Content-Length,Content-Range,X-Host-Transfer-Id");
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function sendJson(res, status, body) {
  if (status === 204) {
    res.writeHead(204);
    res.end();
    return;
  }
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}
