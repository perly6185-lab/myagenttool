import http from "node:http";
import { REQUIRE_AUTH, resolveActor } from "./auth.mjs";
import { handleAgentRoutes } from "../routes/agents.mjs";
import { handleAgentSkillRoutes } from "../routes/agent-skills.mjs";
import { handleApplicationRoutes } from "../routes/applications.mjs";
import { handleBridgeRoutes } from "../routes/bridge.mjs";
import { handleCapabilityRoutes } from "../routes/capabilities.mjs";
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
  startAutoRun,
  retryAutoRun,
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
  projectGithubItems,
  createAgentSkill,
  updateAgentSkill,
  deleteAgentSkill,
  findApplication,
  getApplicationOrchestrationRunRecovery,
  listApplicationOrchestrationRecoveryAgentCandidates,
  getApplicationOrchestrationRun,
  listApplicationCapabilities,
  listApplications,
  listApplicationOrchestrationRunEvents,
  listApplicationOrchestrationRuns,
  probeApplication,
  registerApplication,
  requestApplicationOrchestrationRecoveryAction,
  runApplicationOrchestration,
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
  isAgentDisabled,
  redeliverExpiredDispatches,
  registerAgent,
  findAgent,
  disableAgent,
  enableAgent,
  createAgentHealthCheck,
  unlinkDevice,
  issueBridgeCredential,
  requireBridgeCredential,
  recordCodexHookEvent,
  expireCodexApprovalBrokerRequests,
  resolveCodexApprovalBrokerRequest,
  createCodexImportedEvidenceRecord,
  createCodexChangeReview,
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
  markLifecycleActionStarted,
  completeLifecycleAction,
  nextBridgeLifecycleAction,
  markIntegrationProbeStarted,
  findIntegrationProbeRun,
  completeIntegrationProbeRun,
  findInvocation,
  acknowledgeInvocation,
  completeInvocation,
  findApprovalRequest,
  approveInvocation,
  denyInvocation,
  defaultAgent,
  createInvocation,
  startInvocationIfAllowed,
  createCompareRun,
  cancelInvocation,
  createTroubleshootingReport,
  createToolInvocation,
  getTool,
  listTools,
  createCapabilityInvocation,
  getCapability,
  listCapabilities,
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
        currentProject,
        addProject,
        cloneProject,
        createBlankProject,
        createWorktree,
        createWorktreePr,
        publishWorktreeBranch,
        startAutoRun,
        retryAutoRun,
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

      if (await handleApplicationRoutes({
        req,
        res,
        url,
        sendJson,
        readJson,
        state,
        actor,
        findApplication,
        getApplicationOrchestrationRunRecovery,
        listApplicationOrchestrationRecoveryAgentCandidates,
        getApplicationOrchestrationRun,
        listApplicationCapabilities,
        listApplications,
        listApplicationOrchestrationRunEvents,
        listApplicationOrchestrationRuns,
        probeApplication,
        registerApplication,
        requestApplicationOrchestrationRecoveryAction,
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
        approveInvocation,
        denyInvocation,
        findAgent,
        defaultAgent,
        createInvocation,
        startInvocationIfAllowed,
        normalizeStringArray,
        createCompareRun,
        cancelInvocation,
        createTroubleshootingReport,
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
