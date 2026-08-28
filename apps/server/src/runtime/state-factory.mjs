import { basename } from "node:path";
import {
  claudeCliArgs,
  claudeRegistrationNotes,
  claudeRiskTags,
  codexCliArgs,
  codexRegistrationNotes,
  codexRiskTags,
} from "../services/agents.mjs";
import { createProjectRecord } from "../services/projects.mjs";
import { createTerminalRuntimeCapability } from "../services/terminal.mjs";
import { createDefaultReportSchedule } from "../services/report-schedule.mjs";
import { privateTutorSeedQuestionRevisions } from "../services/private-tutor-assessment.mjs";
import { seedPrivateTutorQuestionContent } from "../services/private-tutor-content.mjs";
import { privateTutorPackageRegistryFromState, seedPrivateTutorContentPackages } from "../services/private-tutor-package-registry.mjs";
import { DEFAULT_DEVICE_ID, defineDeviceAlias } from "./device.mjs";

const defaultAgentIds = [
  "agt_demo_cli",
  "agt_codex_cli",
  "agt_claude_acceptEdits",
  "agt_platform_troubleshooter",
  "agt_platform_integration_builder",
  "agt_platform_application_control",
];
const envMaxConcurrency = Math.floor(Number(process.env.BRIDGE_MAX_CONCURRENT));
const defaultMaxConcurrency = Number.isFinite(envMaxConcurrency) && envMaxConcurrency > 0
  ? Math.min(16, envMaxConcurrency)
  : 3;

export function createServerState({ defaultProjectPath, now }) {
  const defaultProject = createProjectRecord({
    id: "prj_myagenttool",
    name: basename(defaultProjectPath) || "myagenttool",
    path: defaultProjectPath,
    source: "default"
  });
  const state = {
    // Authoritative device store. `state.device` is installed below as a live
    // alias for devices[0] so the existing singleton reads keep working.
    devices: [createDefaultDevice(now)],
    users: createDefaultUsers(now),
    teams: createDefaultTeams(now),
    tokens: [],
    // ADR 0021 I2-I4. Only hashes and bounded metadata are durable; raw
    // session, CSRF, challenge binding, and authorization URI values are not.
    identitySessions: [],
    identityChallenges: [],
    identityProviderCodeUses: [],
    identityAuditEvents: [],
    // ADR 0021 I6. Login attempt keys and recovery credentials are hashes;
    // raw passwords and one-time recovery grants never enter durable state.
    identityLoginAttempts: [],
    identityRecoveryAttempts: [],
    identityRecoveryGrants: [],
    identitySecurityAlerts: [],
    projects: [defaultProject],
    // User-reviewable system understanding. Evidence paths are only drawn from
    // directories the user explicitly registered as projects.
    workProfileInferences: [createInitialWorkProfileInference(defaultProject, now)],
    workProfileAuditEvents: [],
    // My Private Tutor keeps every learning object learner-scoped. Guardian
    // links are the authorization boundary; platform owner/admin is not an
    // implicit grant to a child's learning data.
    privateTutorLearners: [],
    privateTutorGuardianLinks: [],
    privateTutorSnapshots: [],
    privateTutorAttempts: [],
    privateTutorEvaluationReviews: [],
    privateTutorGoldenCandidates: [],
    privateTutorGoldenCandidateReviews: [],
    privateTutorGoldenCandidateEvents: [],
    privateTutorAssessments: [],
    privateTutorLearnerModels: [],
    privateTutorStrategyDecisions: [],
    privateTutorLearningPlans: [],
    privateTutorPackageActivations: [],
    privateTutorContentMigrationPreviews: [],
    privateTutorContentMigrationApplications: [],
    privateTutorRuntimeValidations: [],
    privateTutorSessions: [],
    privateTutorSessionEvents: [],
    privateTutorVoiceTurns: [],
    privateTutorVoiceEvents: [],
    privateTutorIdempotencyRecords: [],
    privateTutorAuditEvents: [],
    privateTutorErrorCases: [],
    privateTutorErrorThemes: [],
    privateTutorReviewSchedules: [],
    privateTutorGuardianPreferences: [],
    privateTutorReleaseEvaluations: [],
    privateTutorPilotCohorts: [],
    privateTutorPilotParticipations: [],
    privateTutorPilotConsents: [],
    privateTutorPilotIncidents: [],
    privateTutorPilotCheckIns: [],
    privateTutorPilotDeletionRequests: [],
    privateTutorQuestionRevisions: [],
    privateTutorQuestionReviews: [],
    privateTutorContentEvents: [],
    privateTutorGuardianInvitations: [],
    privateTutorDataPolicies: [],
    privateTutorDeletionReports: [],
    privateTutorDeletionJobs: [],
    privateTutorContentPackages: [],
    privateTutorModules: [],
    privateTutorTopics: [],
    privateTutorKnowledgeComponents: [],
    privateTutorSubjectPlugins: [],
    privateTutorMaterialDocuments: [],
    privateTutorKnowledgeMapDrafts: [],
    privateTutorLearningPreferences: [],
    privateTutorLearningTrials: [],
    applications: [],
    applicationInstallRuns: [],
    applicationRecoveryActions: [],
    guidedSetupRuns: [],
    approvalGrants: [],
    approvalTokenLegacyUses: { count: 0, lastAt: null },
    applicationDailyStats: [],
    refusalDailyStats: [],
    // Channel /task requests awaiting a human "route or dismiss" decision (the
    // capture-then-promote trust model). A routed request becomes an auto-run.
    channelTaskRequests: [],
    // Privacy-bounded, reviewable examples of Channel expressions that needed
    // clarification. Raw inbound text is never retained in this collection.
    channelIntentLearningSamples: [],
    // Bounded natural-language routing counters. Raw classifier output is never
    // stored; the conversation service records only this normalized aggregate.
    channelIntentMetrics: {
      policyVersion: "ilink-intent-v2",
      total: 0,
      byIntent: {},
      bySource: {},
      lowConfidence: 0,
      ambiguous: 0,
      adapterCalls: 0,
      adapterTimeouts: 0,
      adapterErrors: 0,
      experience: {
        targetedClarifications: 0,
        directReadOnlyTasks: 0,
        directLocalReadOnlyResults: 0,
        duplicateTasksReused: 0,
        staleDuplicatesReconciled: 0,
        activeFollowUpsQueued: 0,
        retryStartDuplicatesSuppressed: 0,
        mediaReceipts: 0,
        consultationAnswers: 0,
        consultationAnswerMissing: 0,
        consultationTimeouts: 0,
        consultationAutoRetries: 0,
        consultationAutoRetryRecovered: 0,
        consultationAutoRetryExhausted: 0,
        difficultSamples: 0,
        pendingReviewSamples: 0,
        resolvedCorrections: 0,
        replayReadySamples: 0,
        deduplicatedOccurrences: 0,
        updatedAt: null,
      },
      updatedAt: null,
    },
    articleImportJobs: [],
    // Runtime-loadable, declarative article extractors. Manifests contain only
    // exact HTTPS hosts and a bounded selector subset — never executable code.
    articleExtractorPlugins: [],
    // Links shared without instructions are saved as managed local knowledge,
    // independently of the formal task/worktree lifecycle.
    channelKnowledgeItems: [],
    channelAttachmentKnowledgeItems: [],
    // Read-only, user-owned conversations over an immutable set of local
    // content identities. Generation is composed separately; these records
    // keep scope, messages, and citations durable across restart.
    materialWorkSessions: [],
    materialWorkMessages: [],
    materialWorkCitations: [],
    // Login-managed site sessions (session-manager.mjs): one durable row per
    // registered site — last probe / reseed observations only, never cookie
    // material. Empty until the first probe/reseed records a row.
    sessions: [],
    // Bounded, credential-free receipts for governed site operations. Browser
    // profiles and cookies stay on the device; only task/account ids, operation
    // outcomes, remote object references, and evidence refs are durable here.
    siteOperationReceipts: [],
    // When this deployment began recording refusals — the honesty anchor so a
    // genuinely-zero window after this date reads as a trustworthy 0, not "unknown".
    refusalStatsMeta: { since: now().slice(0, 10) },
    reportSchedule: createDefaultReportSchedule(),
    currentProjectId: defaultProject.id,
    projectTargets: [createProjectTargetRecord(defaultProject, now)],
    worktrees: [],
    autoRuns: [],
    // O5.2 follow-up: the last-emitted set of below-target SLO keys, so the
    // breach→alert sweep only fires when the breach set changes (not every tick).
    autoRunSloAlert: null,
    autoRunRoutingAlert: null,
    // D1 deploy stage: one record per post-merge deploy attempt (feeds deploy
    // frequency + change-failure/recovery). Empty until deployOnMerge is used.
    deployments: [],
    // A3 circuit breaker: consecutive auto-run failures open it (pause starts).
    autoRunBreaker: { consecutiveFailures: 0, openUntil: null },
    agents: createDefaultAgents(now),
    invocations: [],
    compareRuns: [],
    worktreeReviews: [],
    events: [],
    // Known gaps in the durable invocation-event archive. The hot event ring is
    // still bounded when archival fails; this marker lets the detail endpoint say
    // that history is incomplete instead of silently presenting a partial run.
    eventHistoryRetention: createEventHistoryRetention(),
    // Refusal model Phase 2 (#760): the device's veto as first-class records.
    refusals: [],
    traces: [],
    spans: [],
    auditSummaries: [],
    healthChecks: [],
    // Browser-side Core Web Vitals. Bounded in the route and team-scoped.
    webPerformanceMetrics: [],
    eventStreamMetrics: { byTeam: {} },
    operationalAlerts: [],
    lifecycleAuditRecords: [],
    lifecycleRecipes: [],
    lifecyclePolicyDecisions: [],
    lifecycleLocalApprovals: [],
    lifecycleQueuedActions: [],
    lifecycleRollbackRequests: [],
    privateCatalogEntries: [],
    signedBundleManifests: [],
    discoveryRuns: [],
    integrationArtifacts: [],
    integrationProbeRuns: [],
    quotaDecisionRecords: [],
    quotaPolicies: [],
    aiUsageRecords: [],
    // Per-round (per model turn) telemetry — Epic #805, Phase 3 (#808).
    invocationRounds: [],
    toolInvocationRecords: [],
    // Per-run stream transcripts (#1072, Epic #1070): the wrapper-captured
    // thinking / tool IN-OUT / assistant-text timeline, one record per invocation.
    runTranscripts: [],
    ledgerEntries: [],
    importedUsageEstimates: [],
    codexReviewFindings: [],
    claudeReviewFindings: [],
    codexExecChanges: [],
    codexExecChangeReviews: [],
    // Claude governance Phase 4a (#914): approval-bound apply authorizations. Each
    // row is a single-use, grant-consumed authorization bound to a Phase 3 proposal
    // — the write itself (4b) is separate.
    claudeApplyAuthorizations: [],
    applicationResults: [],
    mailMessages: [],
    mailFolders: [],
    mailCursors: [],
    mailFactImportIds: [],
    mailDrafts: [],
    mailMessageStates: [],
    // Durable body-prefetch queue. Message bodies are retrieved asynchronously
    // after header sync; attachment bytes and RFC822 archives remain on-demand.
    mailBodyPrefetchJobs: [],
    mailTaskLinks: [],
    mailResponsePackages: [],
    mailTaskPolicies: [],
    mailTaskPolicyDecisions: [],
    mailClassifications: [],
    mailClassificationJobs: [],
    mailClassificationCorrections: [],
    mailClassificationRules: [],
    mailFolderMovePreviews: [],
    mailFolderMoveJobs: [],
    mailFolderMoveDeduplication: [],
    mailFolderAutomations: [],
    mailReplies: [],
    budgets: [],
    // #890: in-flight budget holds placed at admission and released on settle so
    // concurrent spend-bearing runs cannot jointly exceed a hard block budget.
    budgetReservations: [],
    // #1151: advisory "X is handling this" markers on pending-decision rows.
    decisionSoftClaims: [],
    // #1143: issue develop leases — one active develop claim per issue, so
    // concurrent humans/agents sharing a backlog never start duplicate work.
    issueClaims: [],
    // #1152: durable claim lifecycle history (claimed/released/expired), kept
    // outside the 500-row event ring buffer so it survives churn + restart.
    issueClaimEvents: [],
    // Local-first planning records. These are independent of GitHub Issues and
    // may later carry one or more external bindings.
    workItems: [],
    // User-facing "one thing" containers. A goal may carry several explicit
    // professional intents while each WorkItem remains independently runnable.
    workGoals: [],
    // Explicit ordinary-user preferences learned from Channel instructions.
    // They are scoped to one conversation and only written by an explicit
    // “记住” request; task execution may consume them as bounded context.
    channelUserPreferences: [],
    myTemplateRoutingFeedback: [],
    myTemplateOutcomeFeedback: [],
    workItemPlanActualFeedback: [],
    myTemplateGovernanceInterventions: [],
    // A completed ordinary task can seed a new personal template. These rows
    // remain outside routineDefinitions until enough cases are reviewed and
    // the user explicitly enables the template.
    myTemplateDrafts: [],
    myTemplateLearningCases: [],
    templateLearningTasks: [],
    // Private task-level reference material metadata. Raw bytes live beside the
    // state store under task-materials; only bounded metadata is durable here.
    taskMaterialDrafts: [],
    // Personal current-terminal placements for runtime Issue work that has no
    // durable local Work Item binding. Preview is pure; explicit apply writes
    // these revisioned rows so the three-day board survives restart.
    runtimeWorkSchedules: [],
    // Durable manual batches for "run these local tasks with concurrency N".
    // Pending rows survive a server restart and are resumed by the batch sweep.
    workItemAutoRunBatches: [],
    workItemComments: [],
    workItemAttentionOperations: [],
    githubWorkItemWebhookDeliveries: [],
    githubWorkItemWebhookFailures: [],
    workItemOperationalAlerts: [],
    workItemActivities: [],
    workItemReportDrafts: [],
    workItemFollowUpReminders: [],
    workItemReportDeliveries: [],
    planningProjects: [],
    planningProjectItems: [],
    // "My Site": team-owned drafts, immutable revisions, governed publication
    // plans/releases, and non-secret deployment target metadata.
    sites: [],
    siteEntries: [],
    siteEntryRevisions: [],
    siteAssets: [],
    sitePublicationPlans: [],
    sitePublications: [],
    siteDeploymentTargets: [],
    siteDomainTlsBindings: [],
    sitePilotSessions: [],
    sitePilotCampaigns: [],
    sitePilotInvitations: [],
    sitePilotSandboxes: [],
    // Verified SSH directory roots. These contain metadata and opaque host
    // references only; remote file contents and credentials are never durable.
    hostFileScopes: [],
    // Fixed, non-shell TLS activation profiles. Container names and scope
    // references are durable; commands and credentials are never persisted.
    hostTlsActivationProfiles: [],
    // Transfer metadata and audit status only. Uploaded/downloaded bytes are
    // intentionally never stored in the control-plane snapshot.
    hostFileTransfers: [],
    // Epic #1547: local-first, evidence-backed requirement-to-delivery memory.
    // These records store derived metadata, relationships, and versioned
    // profiles; raw local file contents remain outside durable state by default.
    workflowSources: [],
    workflowScanJobs: [],
    workflowIntakeObservations: [],
    workflowIntakeReceipts: [],
    workflowEmbeddingIndex: [],
    workflowArtifacts: [],
    deliveryCases: [],
    workflowProfiles: [],
    workflowProfileDrafts: [],
    workflowRuns: [],
    // Epic #1548 / Issue #1549: business semantics and reusable local-Issue
    // routine contracts layered above V1.3 requirement/delivery memory.
    businessDocumentClassifications: [],
    businessDocumentAnalysisJobs: [],
    businessEntities: [],
    // Connector-normalized, non-secret business object metadata used by
    // Channel execution previews (accounts and publication targets currently
    // have no legacy business-entity type, so they live here).
    channelObjectRecords: [],
    channelObjectImports: [],
    channelObjectFileSources: [],
    channelMutationBindings: [],
    channelObjectSyncs: [],
    channelObjectConnectorConfigs: [],
    channelObjectSyncPreviews: [],
    channelDataRelationConfirmations: [],
    businessCaseCandidates: [],
    businessCases: [],
    routineDiscoveryCandidates: [],
    routineDefinitions: [],
    routineRuns: [],
    ledgerDefinitions: [],
    ledgerUpsertPreviews: [],
    ledgerBatchUpsertPreviews: [],
    ledgerBatchMutationJournals: [],
    ledgerMutationAudits: [],
    taskLedgerPostingPlans: [],
    businessPilotEvidenceReceipts: [],
    businessPilotDrafts: [],
    businessPilotCollections: [],
    businessPilotRollouts: [],
    // V1.9: per-project assistance boundaries and explicit user feedback for
    // explainable, local-only job recommendations.
    workflowAdaptivePolicies: [],
    workflowAdaptiveFeedback: [],
    workflowAdaptiveMonitors: [],
    workflowAdaptiveOutcomes: [],
    workflowAdaptiveLearningDrafts: [],
    workflowAdaptiveRules: [],
    workflowAdaptiveNotifications: [],
    // #1165: dispatcher-mode bookkeeping — one row per issue assignment written
    // by THIS server acting as the dispatcher (single writer; the staleness clock).
    dispatchAssignments: [],
    automations: createDefaultAutomations(defaultProject.id, now),
    agentSkills: createDefaultAgentSkills(now),
    // Auto-run config overrides (services/auto-run-config.mjs). Empty = every
    // knob inherits its env default (today's behavior). Operators edit the safe
    // knobs via the console; applied at server start.
    autoRunSettings: {},
    alertOutbox: [],
    privateDeploymentConfig: createDefaultPrivateDeploymentConfig(now),
    auditExportRequests: [],
    retentionSettings: createDefaultRetentionSettings(now),
    approvalRequests: [],
    policyDecisionRecords: [],
    troubleshootingReports: [],
    agentUsageSummaries: [],
    codexSessions: [],
    claudeSessions: [],
    codexWorkspaces: [],
    codexEvidenceRecords: [],
    codexChangeReviews: [],
    codexHookEvents: [],
    codexApprovalBrokerRequests: [],
    codexImportedEvidenceRecords: [],
    terminalRuntimeCapability: createTerminalRuntimeCapability(),
    terminalSessions: [],
    terminalEvidenceRecords: [],
    terminalBridgeActions: [],
    sshTargets: [],
    sshConnectionTests: [],
    // Channel subsystem (ADR 0012, initiative #1090): owner-team-scoped
    // conversation boundaries. Credentials never live here — a channel record
    // carries readiness booleans only.
    channels: [],
    channelIdentities: [],
    canvasScenes: [],
    channelEvents: [],
    channelConversations: [],
    channelDeliveries: [],
    channelNotificationPolicies: [],
    channelNotificationBatches: [],
    channelNotificationLog: [],
    channelIntakeGroups: [],
    channelTaskThreads: [],
    channelTaskRevisions: [],
    workGoalChanges: [],
    // iLink account metadata only. Bot tokens live in the credential store, not
    // in the durable public state snapshot.
    ilinkAccounts: [],
  };
  const privateTutorContentCreatedAt = now();
  seedPrivateTutorContentPackages(state, privateTutorContentCreatedAt);
  seedPrivateTutorQuestionContent(state, privateTutorSeedQuestionRevisions(privateTutorContentCreatedAt), privateTutorContentCreatedAt);
  defineDeviceAlias(state);
  return { defaultProject, state };
}

export function resetStateForSelfCheck({ state, now }) {
  state.device.status = "offline";
  state.device.unlinkState = "linked";
  state.device.credentialRevokedAt = null;
  state.device.bridgeCredential = null;
  state.device.maxConcurrency = defaultMaxConcurrency;
  state.tokens = [];
  state.agents = state.agents.filter((agent) => defaultAgentIds.includes(agent.id));
  const demoAgent = state.agents.find((agent) => agent.id === "agt_demo_cli") ?? null;
  if (demoAgent) {
    demoAgent.status = "unavailable";
    demoAgent.updatedAt = now();
  }
  const codexAgent = state.agents.find((agent) => agent.id === "agt_codex_cli") ?? null;
  if (codexAgent) {
    codexAgent.lifecycle = { ...codexAgent.lifecycle, state: "enabled" };
    codexAgent.status = "unavailable";
    codexAgent.health = {
      status: "unknown",
      checkedAt: null,
      message: "Codex CLI setup has not been checked yet.",
      nextAction: "Run a health check before the first Codex task."
    };
    codexAgent.updatedAt = now();
  }
  const claudeAgent = state.agents.find((agent) => agent.id === "agt_claude_acceptEdits") ?? null;
  if (claudeAgent) {
    claudeAgent.lifecycle = { ...claudeAgent.lifecycle, state: "enabled" };
    claudeAgent.status = "unavailable";
    claudeAgent.health = {
      status: "unknown",
      checkedAt: null,
      message: "Claude Code setup has not been checked yet.",
      nextAction: "Run a health check before the first Claude task."
    };
    claudeAgent.updatedAt = now();
  }
  state.invocations = [];
  state.sessions = [];
  state.workProfileInferences = [createInitialWorkProfileInference(state.projects[0], now)];
  state.workProfileAuditEvents = [];
  state.worktreeReviews = [];
  state.deployments = [];
  state.applications = [];
  state.applicationInstallRuns = [];
  state.applicationRecoveryActions = [];
  state.guidedSetupRuns = [];
  state.events = [];
  state.eventHistoryRetention = createEventHistoryRetention();
  state.refusals = [];
  state.traces = [];
  state.spans = [];
  state.auditSummaries = [];
  state.healthChecks = [];
  state.lifecycleAuditRecords = [];
  state.lifecycleRecipes = [];
  state.lifecyclePolicyDecisions = [];
  state.lifecycleLocalApprovals = [];
  state.lifecycleQueuedActions = [];
  state.lifecycleRollbackRequests = [];
  state.privateCatalogEntries = [];
  state.signedBundleManifests = [];
  state.discoveryRuns = [];
  state.integrationArtifacts = [];
  state.integrationProbeRuns = [];
  state.quotaDecisionRecords = [];
  state.quotaPolicies = [];
  state.aiUsageRecords = [];
  state.invocationRounds = [];
  state.toolInvocationRecords = [];
  state.runTranscripts = [];
  state.ledgerEntries = [];
  state.importedUsageEstimates = [];
  state.codexReviewFindings = [];
  state.claudeReviewFindings = [];
  state.codexExecChanges = [];
  state.codexExecChangeReviews = [];
  state.claudeApplyAuthorizations = [];
  state.applicationResults = [];
  state.mailMessages = [];
  state.mailFolders = [];
  state.mailCursors = [];
  state.mailFactImportIds = [];
  state.mailDrafts = [];
  state.mailMessageStates = [];
  state.mailTaskLinks = [];
  state.mailResponsePackages = [];
  state.mailTaskPolicies = [];
  state.mailTaskPolicyDecisions = [];
  state.mailClassifications = [];
  state.mailClassificationJobs = [];
  state.mailClassificationCorrections = [];
  state.mailClassificationRules = [];
  state.mailFolderMovePreviews = [];
  state.mailFolderMoveJobs = [];
  state.mailFolderMoveDeduplication = [];
  state.mailFolderAutomations = [];
  state.mailReplies = [];
  state.budgets = [];
  state.decisionSoftClaims = [];
  state.issueClaims = [];
  state.issueClaimEvents = [];
  state.dispatchAssignments = [];
  state.automations = createDefaultAutomations(state.currentProjectId ?? state.projects[0]?.id ?? "prj_myagenttool", now);
  state.privateDeploymentConfig = createDefaultPrivateDeploymentConfig(now);
  state.auditExportRequests = [];
  state.retentionSettings = {
    ...state.retentionSettings,
    logsDays: 14,
    promptsDays: 30,
    responsesDays: 30,
    artifactsDays: 90,
    refusalsDays: 30,
    updatedAt: now()
  };
  state.approvalRequests = [];
  state.policyDecisionRecords = [];
  state.troubleshootingReports = [];
  state.agentUsageSummaries = [];
  state.codexSessions = [];
  state.claudeSessions = [];
  state.codexWorkspaces = [];
  state.codexEvidenceRecords = [];
  state.codexChangeReviews = [];
  state.codexHookEvents = [];
  state.codexApprovalBrokerRequests = [];
  state.codexImportedEvidenceRecords = [];
  state.terminalSessions = [];
  state.terminalEvidenceRecords = [];
  state.terminalBridgeActions = [];
  state.sshTargets = [];
  state.sshConnectionTests = [];
  state.channels = [];
  state.channelIdentities = [];
  state.channelEvents = [];
  state.channelConversations = [];
  state.channelDeliveries = [];
  state.channelNotificationPolicies = [];
  state.channelNotificationBatches = [];
  state.channelNotificationLog = [];
  state.channelIntakeGroups = [];
  state.channelTaskThreads = [];
  state.channelTaskRevisions = [];
  state.workGoalChanges = [];
  state.channelTaskRequests = [];
  state.channelIntentLearningSamples = [];
  state.siteOperationReceipts = [];
  state.channelObjectRecords = [];
  state.channelObjectImports = [];
  state.channelObjectFileSources = [];
  state.channelObjectSyncs = [];
  state.channelObjectConnectorConfigs = [];
  state.channelObjectSyncPreviews = [];
  state.channelDataRelationConfirmations = [];
  state.channelIntentMetrics = {
    policyVersion: "ilink-intent-v2",
    total: 0,
    byIntent: {},
    bySource: {},
    lowConfidence: 0,
    ambiguous: 0,
    adapterCalls: 0,
    adapterTimeouts: 0,
    adapterErrors: 0,
    experience: {
      targetedClarifications: 0,
      directReadOnlyTasks: 0,
      directLocalReadOnlyResults: 0,
      duplicateTasksReused: 0,
      staleDuplicatesReconciled: 0,
      activeFollowUpsQueued: 0,
      retryStartDuplicatesSuppressed: 0,
      mediaReceipts: 0,
      consultationAnswers: 0,
      consultationAnswerMissing: 0,
      consultationTimeouts: 0,
      consultationAutoRetries: 0,
      consultationAutoRetryRecovered: 0,
      consultationAutoRetryExhausted: 0,
      difficultSamples: 0,
      pendingReviewSamples: 0,
      resolvedCorrections: 0,
      replayReadySamples: 0,
      deduplicatedOccurrences: 0,
      updatedAt: null,
    },
    updatedAt: null,
  };
  state.ilinkAccounts = [];
  state.terminalRuntimeCapability = createTerminalRuntimeCapability();
}

function createDefaultDevice(now) {
  return {
    id: DEFAULT_DEVICE_ID,
    ownerUserId: "usr_local",
    name: "Local Demo Device",
    platform: process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux",
    architecture: process.arch === "arm64" ? "arm64" : "x64",
    defaultShell: process.platform === "win32" ? "powershell" : "bash",
    pathFormat: process.platform === "win32" ? "windows" : "posix",
    bridgeVersion: "0.0.0",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    status: "offline",
    unlinkState: "linked",
    lastSeenAt: null,
    registeredCapabilities: [],
    runtimeReadiness: [],
    applicationBinaryReadiness: [],
    // What the device HOLDS (application, provider, scope) — never a credential
    // (ADR 0010). The server compares it against the immutable descriptor.
    applicationCredentialReadiness: [],
    credentialRevokedAt: null,
    bridgeCredential: null,
    maxConcurrency: defaultMaxConcurrency,
    createdAt: now()
  };
}

function createEventHistoryRetention() {
  return {
    truncatedInvocationIds: [],
    globalTruncated: false,
    lastArchiveErrorAt: null,
    lastArchiveError: null,
  };
}

function createDefaultUsers(now) {
  const createdAt = now();
  return [
    {
      id: "usr_local",
      name: "Local User",
      email: null,
      teamId: "team_local",
      role: "owner",
      createdAt,
    },
  ];
}

function createDefaultTeams(now) {
  const createdAt = now();
  return [
    {
      id: "team_local",
      name: "Local Team",
      slug: "local",
      createdAt,
    },
  ];
}

function createProjectTargetRecord(project, now) {
  const createdAt = now();
  return {
    id: `tgt_${project.id}`,
    projectId: project.id,
    deviceId: DEFAULT_DEVICE_ID,
    kind: project.source === "clone" ? "clone" : "local",
    remoteUrl: project.git?.remoteUrl ?? null,
    rootPath: project.path,
    defaultBranch: project.git?.defaultBranch ?? project.git?.currentBranch ?? null,
    state: "ready",
    progress: 100,
    message: "Local checkout is ready.",
    createdAt,
    updatedAt: createdAt,
  };
}

function createInitialWorkProfileInference(project, now) {
  const createdAt = now();
  return {
    id: "wpi_primary_work",
    userId: "usr_local",
    ownerTeamId: "team_local",
    category: "work_type",
    value: "software_development",
    confidence: 0.86,
    status: "pending",
    summary: "Inferred from repeated work in a registered software project.",
    evidence: project ? [{
      projectId: project.id,
      projectName: project.name,
      authorizedDirectory: project.path,
      signal: "registered_project",
    }] : [],
    createdAt,
    updatedAt: createdAt,
  };
}

function createDefaultAutomations(projectId, now) {
  const createdAt = now();
  return [
    {
      id: "atm_demo_audit",
      name: "Weekday repo audit",
      enabled: false,
      projectId,
      branch: "main",
      schedule: { kind: "weekdays", time: "09:00", label: "Weekdays at 09:00" },
      nextRunAt: null,
      sessionMode: "fresh",
      graceHours: 12,
      precheck: "None",
      agentId: "agt_codex_cli",
      prompt: "Summarize repository health and identify risky open work.",
      lastRunAt: null,
      lastInvocationId: null,
      runCount: 0,
      tokens: 0,
      createdBy: "usr_local",
      createdAt,
    },
  ];
}

// Seed agent-skill: the image-edit capability, rendered into each matching
// agent's worktree (claude via MCP, codex via CLI). See services/agent-skills.mjs.
function createDefaultAgentSkills(now) {
  const createdAt = now();
  return [
    {
      id: "skl_image_edit",
      name: "Image Edit",
      slug: "image-edit",
      description: "Edit or generate images from a reference image and a text prompt.",
      body: [
        "Use this when the task asks to edit, retouch, restyle, or generate an image",
        "(改图 / 编辑图片 / 抠图 / 换背景 / 生成图片).",
        "",
        "- codex: prefer your built-in image_generation tool — it needs no extra setup.",
        "  Only fall back to the CLI below if the built-in tool is unavailable.",
        "- claude: call the `edit_image` tool exposed by the `image-tool` MCP server.",
        "  If MCP is unavailable, run the CLI:",
        "  `node packages/image-tool/cli.mjs --input <path> --prompt <text> --output <path>`.",
        "",
        "Always write to an explicit output path and report it back when done.",
      ].join("\n"),
      targets: ["claude", "codex"],
      tool: {
        cli: "node packages/image-tool/cli.mjs",
        mcp: { name: "image-tool", command: "node", args: ["packages/image-tool/mcp-server.mjs"] },
      },
      enabled: true,
      createdAt,
      updatedAt: createdAt,
    },
    {
      // A role-scoped skill (paths: ["design"]) — a working example of per-run
      // role selection. Only renders on a design-decided auto-run, so it never
      // touches develop/prototype/clarify runs or manual invocations.
      id: "skl_design_brief",
      name: "Design Brief",
      slug: "design-brief",
      description: "On a design-decided run, produce a design brief — do not change product code.",
      body: [
        "This run was routed to the DESIGN role. Your deliverable is a written",
        "design brief, not an implementation.",
        "",
        "- Restate the problem and the acceptance criteria from the issue.",
        "- Lay out 1-3 approaches with trade-offs; recommend one.",
        "- List the files/areas a follow-up develop run would touch.",
        "- Call out open questions that need a human decision.",
        "",
        "Do NOT edit product code. The summary you return is the artifact.",
      ].join("\n"),
      targets: ["claude", "codex"],
      paths: ["design"],
      enabled: true,
      createdAt,
      updatedAt: createdAt,
    },
    {
      // D2 (issue→UI-design plan): when a design run concerns a user interface,
      // the brief must be VISUAL — ASCII wireframes the console renders in
      // monospace (D1), plus component structure and interaction notes. Pure
      // prompt: no engine change, composes with skl_design_brief.
      id: "skl_ui_design",
      name: "UI Design Wireframes",
      slug: "ui-design-wireframes",
      description: "On a design run that touches UI, include ASCII wireframes, component hierarchy, and interaction notes in the brief.",
      body: [
        "If this issue involves a user interface (screens, pages, components,",
        "layout, navigation, forms, visual output), your design brief MUST be",
        "visual, not prose-only. Include:",
        "",
        "1. ASCII wireframes — one per affected screen/state, inside fenced",
        "   ``` code blocks (they render as aligned monospace in the console).",
        "   Box the layout regions; label every interactive element.",
        "2. A component hierarchy (tree) naming each new/changed component.",
        "3. Interaction notes — what each control does, empty/loading/error",
        "   states, and where data comes from.",
        "4. If several layouts are viable, wireframe the top two and recommend.",
        "",
        "Keep each wireframe under ~40 columns x 25 rows so it stays readable.",
        "If the issue involves NO user interface, say so in one line and skip",
        "the wireframes. Do NOT edit product code.",
      ].join("\n"),
      targets: ["claude", "codex"],
      paths: ["design"],
      enabled: true,
      createdAt,
      updatedAt: createdAt,
    },
  ];
}

function createDefaultAgents(now) {
  return [
    {
      id: "agt_demo_cli",
      name: "Demo CLI Agent",
      description: "Safe local demo agent for M0 smoke tests.",
      ownerUserId: "usr_local",
      location: { type: "local_device", deviceId: DEFAULT_DEVICE_ID },
      adapter: {
        type: "cli",
        command: "demo-agent",
        args: ["{{payloadJson}}"],
        workingDirectoryPolicy: "bridge_default",
        environmentPolicy: "inherit_safe",
        timeoutSeconds: 30,
        cancellation: "supported"
      },
      lifecycle: {
        state: "enabled",
        installState: "installed",
        version: "0.0.0",
        managedBy: "bridge"
      },
      economics: {
        model: "unknown",
        pricingDimensions: [],
        currency: "USD",
        costOwner: "usr_local",
        budgetPoolId: null,
        unknownCostPolicy: "warn"
      },
      capabilities: [
        {
          name: "demo_task",
          description: "Runs a harmless local demonstration task.",
          riskLevel: "low",
          riskTags: ["read_only"]
        }
      ],
      status: "unavailable",
      health: {
        status: "unknown",
        checkedAt: null,
        message: "Health has not been checked yet.",
        nextAction: "Run a health check before relying on this agent."
      },
      registrationNotes: {
        risk: "Low risk demo command. It does not read or write user files.",
        data: "Task text, logs, trace, and final result are stored in the local demo server.",
        cost: "Cost is unknown and no billing is performed.",
        cancellation: "The bridge forwards cancellation to the local demo process."
      },
      createdAt: now()
    },
    {
      id: "agt_codex_cli",
      name: "Codex CLI",
      description: "Runs Codex CLI non-interactively through a reviewed local adapter config.",
      ownerUserId: "usr_local",
      location: { type: "local_device", deviceId: DEFAULT_DEVICE_ID },
      adapter: {
        type: "cli",
        command: "codex",
        args: codexCliArgs(),
        workingDirectoryPolicy: "bridge_default",
        environmentPolicy: "inherit_safe",
        timeoutSeconds: 600,
        cancellation: "supported",
        outputFormat: "codex_jsonl",
        sandbox: "workspace-write",
        permissionMode: "ask"
      },
      lifecycle: {
        state: "enabled",
        installState: "installed",
        version: "0.0.0",
        managedBy: "bridge"
      },
      economics: {
        model: "unknown",
        pricingDimensions: [],
        currency: "USD",
        costOwner: "usr_local",
        budgetPoolId: null,
        unknownCostPolicy: "warn"
      },
      capabilities: [
        {
          name: "codex_repo_task",
          description: "Runs Codex CLI repository tasks using Codex CLI native permissions.",
          riskLevel: "high",
          riskTags: codexRiskTags()
        }
      ],
      status: "unavailable",
      health: {
        status: "unknown",
        checkedAt: null,
        message: "Codex CLI setup has not been checked yet.",
        nextAction: "Run a health check before the first Codex task."
      },
      registrationNotes: codexRegistrationNotes(),
      discovery: {
        source: "default_registered",
        confidence: "high"
      },
      createdAt: now()
    },
    {
      id: "agt_claude_acceptEdits",
      name: "Claude Code CLI",
      description: "Runs Claude through the Agent SDK by default, with governed local tools and a CLI rollback path.",
      ownerUserId: "usr_local",
      location: { type: "local_device", deviceId: DEFAULT_DEVICE_ID },
      adapter: {
        type: "cli",
        command: "claude",
        args: claudeCliArgs("acceptEdits"),
        workingDirectoryPolicy: "bridge_default",
        environmentPolicy: "inherit_safe",
        timeoutSeconds: 600,
        cancellation: "supported",
        outputFormat: "claude_jsonl",
        sandbox: null,
        permissionMode: "acceptEdits"
      },
      lifecycle: {
        state: "enabled",
        installState: "installed",
        version: "0.0.0",
        managedBy: "bridge"
      },
      economics: {
        model: "unknown",
        pricingDimensions: [],
        currency: "USD",
        costOwner: "usr_local",
        budgetPoolId: null,
        unknownCostPolicy: "warn"
      },
      capabilities: [
        {
          name: "claude_repo_task",
          description: "Runs Claude Code repository tasks using Claude Code native permission modes.",
          riskLevel: "high",
          riskTags: claudeRiskTags()
        }
      ],
      status: "unavailable",
      health: {
        status: "unknown",
        checkedAt: null,
        message: "Claude Code setup has not been checked yet.",
        nextAction: "Run a health check before the first Claude task."
      },
      registrationNotes: claudeRegistrationNotes(),
      discovery: {
        source: "default_registered",
        confidence: "high"
      },
      createdAt: now()
    },
    {
      id: "agt_platform_troubleshooter",
      name: "Invocation Troubleshooter",
      description: "Platform-owned agent that explains failed invocations and suggested fixes.",
      ownerUserId: "system",
      location: { type: "platform_agent" },
      adapter: { type: "platform", name: "invocation_troubleshooter_agent" },
      lifecycle: {
        state: "enabled",
        installState: "installed",
        version: "0.0.0",
        managedBy: "platform"
      },
      economics: {
        model: "free",
        pricingDimensions: ["per_invocation"],
        currency: "USD",
        costOwner: "usr_local",
        budgetPoolId: null,
        unknownCostPolicy: "warn"
      },
      capabilities: [
        {
          name: "troubleshoot_invocation",
          description: "Summarizes failed invocation state, logs, bridge status, adapter errors, and suggested fixes.",
          riskLevel: "low",
          riskTags: ["read_only"]
        }
      ],
      status: "available",
      health: {
        status: "healthy",
        checkedAt: now(),
        message: "Platform troubleshooting agent is available.",
        nextAction: null
      },
      registrationNotes: {
        risk: "Read-only platform agent. It explains recorded state and cannot remediate without approval.",
        data: "Reads invocation status, related events, bridge state, adapter metadata, trace, and audit records from the local demo server.",
        cost: "Free platform demo helper. No billing automation is performed.",
        cancellation: "Runs synchronously in the local demo server."
      },
      createdAt: now(),
      updatedAt: now()
    },
    {
      id: "agt_platform_integration_builder",
      name: "Integration Builder",
      description: "Platform-owned agent that drafts unsupported-agent integration plans for review.",
      ownerUserId: "system",
      location: { type: "platform_agent" },
      adapter: { type: "platform", name: "integration_builder_agent" },
      lifecycle: {
        state: "enabled",
        installState: "installed",
        version: "0.0.0",
        managedBy: "platform"
      },
      economics: {
        model: "free",
        pricingDimensions: ["per_artifact"],
        currency: "USD",
        costOwner: "usr_local",
        budgetPoolId: null,
        unknownCostPolicy: "warn"
      },
      capabilities: [
        {
          name: "draft_integration_plan",
          description: "Drafts reviewable integration plans without enabling adapters.",
          riskLevel: "low",
          riskTags: ["read_only", "generated_code"]
        }
      ],
      status: "available",
      health: {
        status: "healthy",
        checkedAt: now(),
        message: "Platform integration builder is available for advisory drafts.",
        nextAction: null
      },
      registrationNotes: {
        risk: "Advisory platform agent. It can draft plans and artifact suggestions but cannot approve, test, register, or enable integrations.",
        data: "Reads user-provided integration intent and writes reviewable draft artifacts.",
        cost: "Free platform demo helper. No billing automation is performed.",
        cancellation: "Runs synchronously in the local demo server."
      },
      createdAt: now(),
      updatedAt: now()
    },
    {
      id: "agt_platform_application_control",
      name: "Application Control",
      description: "Platform-owned agent that executes governed application asset capabilities.",
      ownerUserId: "system",
      location: { type: "platform_agent" },
      adapter: { type: "platform", name: "application_control_agent" },
      lifecycle: {
        state: "enabled",
        installState: "installed",
        version: "0.0.0",
        managedBy: "platform"
      },
      economics: {
        model: "free",
        pricingDimensions: ["per_invocation"],
        currency: "USD",
        costOwner: "usr_local",
        budgetPoolId: null,
        unknownCostPolicy: "warn"
      },
      capabilities: [
        {
          name: "application_control",
          description: "Runs allowlisted application inspect, search, lifecycle, and orchestration-control actions.",
          riskLevel: "medium",
          riskTags: ["application_asset", "lifecycle", "generated_artifact"]
        }
      ],
      status: "available",
      health: {
        status: "healthy",
        checkedAt: now(),
        message: "Platform application control agent is available.",
        nextAction: null
      },
      registrationNotes: {
        risk: "Platform agent with an allowlisted application-control action set. High-risk lifecycle actions require explicit approval tokens.",
        data: "Reads application registry records and may update application lifecycle state or probe metadata.",
        cost: "Free platform demo helper. No billing automation is performed.",
        cancellation: "Runs synchronously in the local demo server."
      },
      createdAt: now(),
      updatedAt: now()
    }
  ];
}

function createDefaultRetentionSettings(now) {
  return {
    id: "ret_demo_integration_data",
    subjectType: "integration_data",
    logsDays: 14,
    promptsDays: 30,
    responsesDays: 30,
    artifactsDays: 90,
    refusalsDays: 30,
    updatedAt: now()
  };
}

function createDefaultPrivateDeploymentConfig(now) {
  const createdAt = now();
  return {
    id: "dep_demo_private",
    mode: "local_developer",
    ownerTeamId: null,
    auditExportEnabled: false,
    immutableAuditOption: "disabled",
    capabilities: {
      privateCatalog: false,
      signedBundles: false,
      auditExport: true,
      siemExport: false,
      immutableAudit: false,
      platformManagedAi: false,
    },
    auditSinks: [
      {
        id: "sink_local_file",
        type: "local_file",
        enabled: true,
        displayName: "Local audit export file",
        destinationRef: ".myagenttool/audit/export.jsonl",
        immutable: false,
        externalDeliveryEnabled: false,
        retentionDays: 365,
        metadata: {},
      },
    ],
    alertSinks: [
      {
        id: "alert_local_log",
        type: "local_log",
        enabled: true,
        destinationRef: ".myagenttool/audit/alerts.log",
        severityThreshold: "warn",
        externalDeliveryEnabled: false,
      },
    ],
    entitlementPolicy: {
      canBlockPaidFeatures: true,
      canBlockNewPlatformManagedAi: true,
      canBlockDataExport: false,
      canDeleteUserData: false,
      canRemoveLocalSoftware: false,
      canPreventDeviceUnlink: false,
    },
    createdAt,
    updatedAt: createdAt,
  };
}
