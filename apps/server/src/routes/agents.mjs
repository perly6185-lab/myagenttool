import { normalizeMcpAdapterConfig } from "@myagenttool/adapters/mcp";

import { agentVisibleToActor } from "../runtime/auth.mjs";
import { isClaudeCliCommand, isCodexCliCommand } from "../services/agents.mjs";
import { publicDeviceView } from "../runtime/bridge-auth.mjs";

export async function handleAgentRoutes({
  req,
  res,
  url,
  sendJson,
  readJson,
  actor,
  state,
  now,
  appendEvent,
  reconcileApplicationWebEditorsOnBridgeRegister,
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
}) {
  if (req.method === "POST" && url.pathname === "/api/bridge/register") {
    const body = await readJson(req);
    if (state.device.unlinkState !== "linked") {
      sendJson(res, 403, { error: "device_credentials_revoked" });
      return true;
    }
    const hasCredential = Boolean(state.device.bridgeCredential?.tokenHash);
    let issuedCredential = null;
    if (hasCredential) {
      const credential = requireBridgeCredential({ req, res, sendJson });
      if (!credential) return true;
      if (body.rotateCredential === true) {
        issuedCredential = issueBridgeCredential({ rotate: true });
      }
    } else {
      issuedCredential = issueBridgeCredential({ rotate: true });
    }
    state.device.status = "online";
    state.device.lastSeenAt = now();
    state.device.bridgeVersion = String(body.bridgeVersion ?? "0.0.0");
    state.device.registeredCapabilities = Array.isArray(body.capabilities) ? body.capabilities.map(String) : [];
    state.device.updatedAt = now();
    reconcileApplicationWebEditorsOnBridgeRegister?.(actor);
    for (const agent of state.agents.filter((item) => item.location.type === "local_device")) {
      if (isAgentDisabled(agent)) {
        agent.updatedAt = now();
        continue;
      }
      agent.status = "available";
      agent.updatedAt = now();
      // Local CLI agents have no health endpoint; probe once the bridge is
      // online so a fresh/restarted agent doesn't sit unchecked. Re-probe when
      // health is unknown OR stuck at "checking" — the latter is a stale probe
      // from a prior bridge session that dropped before reporting; a live check
      // reaches a terminal healthy/unhealthy, so reconnects don't loop.
      // Re-probe unhealthy too: an "unhealthy" verdict recorded while the bridge
      // was offline is stale the moment the bridge registers — without this the
      // cached verdict blocks dispatch forever. (Found by the field pilot.)
      if (agent.adapter?.type === "cli" && (!agent.health || ["unknown", "checking", "unhealthy"].includes(agent.health.status))) {
        createAgentHealthCheck(agent, actor);
      }
    }
    redeliverExpiredDispatches();
    appendEvent({
      invocationId: null,
      type: "heartbeat",
      level: "info",
      message: "Desktop Bridge registered local demo device.",
    });
    sendJson(res, 200, {
      ok: true,
      device: publicDeviceView(state.device),
      agents: state.agents,
      bridgeCredential: issuedCredential?.credential ?? publicDeviceView(state.device).bridgeCredential,
      bridgeToken: issuedCredential?.token ?? null,
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/agents") {
    const body = await readJson(req);
    let agent;
    try {
      agent = registerAgent(body, actor);
    } catch (error) {
      sendJson(res, 400, {
        error: "invalid_agent_registration",
        message: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
    // Coding agents have no health endpoint, so auto-run the restricted CLI
    // probe (codex exec --help / claude --version) on manual registration — a
    // fresh agent reports Healthy/Needs-attention instead of "unknown".
    if (agent.adapter?.type === "cli" && (isCodexCliCommand(agent.adapter.command) || isClaudeCliCommand(agent.adapter.command))) {
      createAgentHealthCheck(agent, actor);
    }
    sendJson(res, 201, { agent });
    return true;
  }

  // Pre-flight dry-probe: validate an unregistered MCP config and hand it to the
  // bridge for a handshake + tools/list, so the Connect Agent flow can show the
  // operator what the config resolves to before any agent is registered (#137).
  if (req.method === "POST" && url.pathname === "/api/agents/probe") {
    const body = await readJson(req);
    let adapter;
    try {
      adapter = { type: "mcp", ...normalizeMcpAdapterConfig(body.adapter ?? body) };
    } catch (error) {
      sendJson(res, 400, {
        error: "invalid_agent_probe",
        message: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
    let probeRun;
    try {
      probeRun = createAgentDryProbeRun(adapter);
    } catch (error) {
      sendJson(res, 409, {
        error: "agent_probe_unavailable",
        message: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
    sendJson(res, 202, { probeRun });
    return true;
  }

  const probeStatusMatch = url.pathname.match(/^\/api\/agents\/probe\/([^/]+)$/);
  if (req.method === "GET" && probeStatusMatch) {
    const probeRun = findIntegrationProbeRun(decodeURIComponent(probeStatusMatch[1]));
    if (!probeRun || probeRun.kind !== "agent_dry_probe") {
      sendJson(res, 404, { error: "probe_run_not_found" });
      return true;
    }
    sendJson(res, 200, { probeRun });
    return true;
  }

  const actionMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/(enable|disable|health-check)$/);
  if (req.method === "POST" && actionMatch) {
    const agent = findAgent(decodeURIComponent(actionMatch[1]));
    if (!agent) {
      sendJson(res, 404, { error: "agent_not_found" });
      return true;
    }
    if (!agentVisibleToActor(state, agent, actor)) {
      sendJson(res, 404, { error: "agent_not_found" });
      return true;
    }

    if (actionMatch[2] === "disable") {
      const operation = disableAgent(agent, actor);
      sendJson(res, 200, { agent, operation });
      return true;
    }

    if (actionMatch[2] === "enable") {
      const operation = enableAgent(agent, actor);
      sendJson(res, 200, { agent, operation });
      return true;
    }

    const operation = createAgentHealthCheck(agent, actor);
    sendJson(res, 202, { agent, operation });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/device/unlink") {
    unlinkDevice();
    sendJson(res, 200, { device: publicDeviceView(state.device) });
    return true;
  }

  return false;
}
