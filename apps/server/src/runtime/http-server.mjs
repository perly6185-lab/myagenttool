import http from "node:http";
import {
  LOCAL_USER_ID,
  REQUIRE_AUTH,
  findUser,
  issueToken,
  resolveActor,
  revokeToken,
} from "./auth.mjs";
import { handleAgentRoutes } from "../routes/agents.mjs";
import { handleBridgeRoutes } from "../routes/bridge.mjs";
import { handleCodexRoutes } from "../routes/codex.mjs";
import { handleControlPlaneRoutes } from "../routes/control-plane.mjs";
import { handleIntegrationRoutes } from "../routes/integrations.mjs";
import { handleInvocationRoutes } from "../routes/invocations.mjs";
import { handleLoopRoutineRoutes } from "../routes/loop-routines.mjs";
import { handleM3Routes } from "../routes/m3.mjs";
import { handleProjectRoutes } from "../routes/projects.mjs";
import { handleTerminalRoutes } from "../routes/terminal.mjs";

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
  selectProject,
  removeProject,
  removeWorktree,
  updateProject,
  readProjectTree,
  searchProjectContent,
  gitProjectSummary,
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

      // --- Identity: session login/logout, then the auth gate. ---
      if (url.pathname === "/api/session") {
        if (req.method === "POST") {
          const body = await readJson(req).catch(() => ({}));
          const requestedId = typeof body?.userId === "string" ? body.userId : LOCAL_USER_ID;
          const user = findUser(state, requestedId) || findUser(state, LOCAL_USER_ID);
          if (!user) {
            sendJson(res, 401, { error: "unknown_user" });
            return;
          }
          const record = issueToken(state, user.id);
          persistStateSoon();
          sendJson(res, 200, {
            token: record.token,
            expiresAt: record.expiresAt,
            user: { id: user.id, name: user.name, teamId: user.teamId },
          });
          return;
        }
        if (req.method === "DELETE") {
          const token = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? ""))?.[1]?.trim();
          if (token && revokeToken(state, token)) persistStateSoon();
          res.writeHead(204);
          res.end();
          return;
        }
      }

      const actor = resolveActor(state, req);
      if (REQUIRE_AUTH && !actor.authenticated) {
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
        currentProject,
        addProject,
        cloneProject,
        createBlankProject,
        createWorktree,
        selectProject,
        removeProject,
        removeWorktree,
        updateProject,
        readProjectTree,
        searchProjectContent,
        gitProjectSummary,
      })) {
        return;
      }

      if (await handleTerminalRoutes({
        req,
        res,
        url,
        sendJson,
        readJson,
        state,
        createSshTarget,
        createSshConnectionTest,
        createManagedTerminalSession,
        queueTerminalBridgeAction,
        nextTerminalBridgeAction,
        recordTerminalBridgeEvent,
        recordTerminalEvidence,
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
        unlinkDevice,
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
