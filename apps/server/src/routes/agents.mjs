import { isClaudeCliCommand, isCodexCliCommand } from "../services/agents.mjs";

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
  isAgentDisabled,
  redeliverExpiredDispatches,
  registerAgent,
  findAgent,
  disableAgent,
  enableAgent,
  createAgentHealthCheck,
  unlinkDevice,
}) {
  if (req.method === "POST" && url.pathname === "/api/bridge/register") {
    const body = await readJson(req);
    if (state.device.unlinkState !== "linked") {
      sendJson(res, 403, { error: "device_credentials_revoked" });
      return true;
    }
    state.device.status = "online";
    state.device.lastSeenAt = now();
    state.device.bridgeVersion = String(body.bridgeVersion ?? "0.0.0");
    state.device.registeredCapabilities = Array.isArray(body.capabilities) ? body.capabilities.map(String) : [];
    state.device.updatedAt = now();
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
      if (agent.adapter?.type === "cli" && (!agent.health || ["unknown", "checking"].includes(agent.health.status))) {
        createAgentHealthCheck(agent);
      }
    }
    redeliverExpiredDispatches();
    appendEvent({
      invocationId: null,
      type: "heartbeat",
      level: "info",
      message: "Desktop Bridge registered local demo device.",
    });
    sendJson(res, 200, { ok: true, device: state.device, agents: state.agents });
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
      createAgentHealthCheck(agent);
    }
    sendJson(res, 201, { agent });
    return true;
  }

  const actionMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/(enable|disable|health-check)$/);
  if (req.method === "POST" && actionMatch) {
    const agent = findAgent(decodeURIComponent(actionMatch[1]));
    if (!agent) {
      sendJson(res, 404, { error: "agent_not_found" });
      return true;
    }

    if (actionMatch[2] === "disable") {
      const operation = disableAgent(agent);
      sendJson(res, 200, { agent, operation });
      return true;
    }

    if (actionMatch[2] === "enable") {
      const operation = enableAgent(agent);
      sendJson(res, 200, { agent, operation });
      return true;
    }

    const operation = createAgentHealthCheck(agent);
    sendJson(res, 202, { agent, operation });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/device/unlink") {
    unlinkDevice();
    sendJson(res, 200, { device: state.device });
    return true;
  }

  return false;
}
