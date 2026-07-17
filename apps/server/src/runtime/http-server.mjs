import http from "node:http";
import { REQUIRE_AUTH, resolveActor } from "./auth.mjs";
import { handleAgentRoutes } from "../routes/agents.mjs";
import { handleAgentSkillRoutes } from "../routes/agent-skills.mjs";
import { handleApplicationRoutes } from "../routes/applications.mjs";
import { handleApprovalGrantRoutes } from "../routes/approval-grants.mjs";
import { handleBridgeRoutes } from "../routes/bridge.mjs";
import { handleCapabilityRoutes } from "../routes/capabilities.mjs";
import { handleMailRoutes } from "../routes/mail.mjs";
import { handleChannelRoutes } from "../routes/channels.mjs";
import { handleCodexRoutes } from "../routes/codex.mjs";
import { handleControlPlaneRoutes } from "../routes/control-plane.mjs";
import { handleIntegrationRoutes } from "../routes/integrations.mjs";
import { handleInvocationRoutes } from "../routes/invocations.mjs";
import { handleLoopRoutineRoutes } from "../routes/loop-routines.mjs";
import { handleM3Routes } from "../routes/m3.mjs";
import { handleProjectRoutes } from "../routes/projects.mjs";
import { handleReviewFindingRoutes } from "../routes/review-findings.mjs";
import { handleTerminalRoutes } from "../routes/terminal.mjs";
import { handleToolRoutes } from "../routes/tools.mjs";

export function createHttpServer({
  host,
  port,
  namespace,
  protocolVersion,
  state,
  now,
  publicState,
  currentLoopRoutineProjectContext,
  currentProject,
  addProject,
  cloneProject,
  createBlankProject,
  createWorktree,
  createWorktreePr,
  publishWorktreeBranch,
  ensureLocalOrigin,
  startAutoRun,
  retryAutoRun,
  mergeAutoRunPr,
  claimIssue,
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
  recordAgentFileAccess,
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
  recordCodexHookEvent,
  expireCodexApprovalBrokerRequests,
  resolveCodexApprovalBrokerRequest,
  createCodexImportedEvidenceRecord,
  createCodexChangeReview,
  createCodexExecReview,
  setCodexSessionName,
  resumableCodexSessions,
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
  createToolInvocation,
  getTool,
  listTools,
  rollbackClaudeApply,
  createCapabilityInvocation,
  getCapability,
  listCapabilities,
  createMailIssueFromImport,
  replyOnIssue,
  confirmReplyDraft,
  sendConfirmedDraft,
  registerChannel,
  listChannels,
  enableChannel,
  disableChannel,
  channelHealth,
  mapChannelIdentity,
  removeChannelIdentity,
  listChannelIdentities,
  setChannelAllowlist,
  retryChannelDelivery,
  nextId,
  persistStateSoon,
}) {
  return http.createServer(async (req, res) => {
    try {
      setCors(res);

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
      const actor = resolveActor(state, req);
      const bridgePath = url.pathname.startsWith("/api/bridge/");
      const publicPath = url.pathname === "/api/session" || bridgePath;
      if (REQUIRE_AUTH && !publicPath && !actor.authenticated) {
        sendJson(res, 401, { error: "unauthenticated", message: "Valid session token required." });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/state") {
        expireCodexApprovalBrokerRequests();
        sendJson(res, 200, publicState(actor));
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

      if (await handleMailRoutes({ req, res, url, sendJson, readJson, actor, createMailIssueFromImport, replyOnIssue, confirmReplyDraft, sendConfirmedDraft })) {
        return;
      }

      if (await handleChannelRoutes({
        req,
        res,
        url,
        sendJson,
        readJson,
        actor,
        registerChannel,
        listChannels,
        enableChannel,
        disableChannel,
        channelHealth,
        mapChannelIdentity,
        removeChannelIdentity,
        listChannelIdentities,
        setChannelAllowlist,
        retryChannelDelivery,
      })) {
        return;
      }

      if (handleLoopRoutineRoutes({ req, res, url, sendJson, currentLoopRoutineProjectContext })) {
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
        createBlankProject,
        createWorktree,
        createWorktreePr,
        publishWorktreeBranch,
        ensureLocalOrigin,
        startAutoRun,
        retryAutoRun,
        mergeAutoRunPr,
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
        createSshTarget,
        createSshConnectionTest,
        createManagedTerminalSession,
        queueTerminalBridgeAction,
        nextTerminalBridgeAction,
        recordTerminalBridgeEvent,
        recordTerminalEvidence,
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
        createCodexImportedEvidenceRecord,
        createCodexChangeReview,
        createCodexExecReview,
        execRunPromotionGate,
        createWorktreePr,
        findInvocation,
        appendEvent, setCodexSessionName, resumableCodexSessions,
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
        recordRoundEvent,
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

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
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
