import { normalizeMcpAdapterConfig } from "@myagenttool/adapters/mcp";

import { isClaudeCliCommand, isCodexCliCommand } from "../services/agents.mjs";
import { publicDeviceView } from "../runtime/bridge-auth.mjs";
import { listDevices, primaryDevice } from "../runtime/device.mjs";

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
  createAgentDryProbeRun,
  findIntegrationProbeRun,
  unlinkDevice,
  relinkDevice,
  issueBridgeCredential,
  requireBridgeCredential,
}) {
  if (req.method === "POST" && url.pathname === "/api/bridge/register") {
    const body = await readJson(req);
    // Which machine is registering? Once anything is paired, the credential is
    // the answer — a re-registering bridge must prove which device it is before
    // it can stamp that device online. Only a control plane with nothing paired
    // yet is a first boot, and there the seeded primary device is the one being
    // claimed.
    const paired = listDevices(state).some((item) => item.bridgeCredential?.tokenHash);
    let device;
    if (paired) {
      device = requireBridgeCredential({ req, res, sendJson });
      if (!device) return true; // 401/403 already sent.
    } else {
      device = primaryDevice(state);
      if (!device || device.unlinkState !== "linked") {
        sendJson(res, 403, { error: "device_credentials_revoked" });
        return true;
      }
    }
    // Mint on first pairing, or when the bridge explicitly asks to rotate.
    let issuedCredential = null;
    if (!device.bridgeCredential?.tokenHash || body.rotateCredential === true) {
      issuedCredential = issueBridgeCredential({ deviceId: device.id, rotate: true });
    }
    device.status = "online";
    // Clearing livenessLostAt on the REGISTERING device, not the primary alias:
    // on a fleet they differ, and clearing the primary's would declare a machine
    // healthy because a different one just checked in.
    device.livenessLostAt = null;
    device.lastSeenAt = now();
    device.bridgeVersion = String(body.bridgeVersion ?? "0.0.0");
    device.registeredCapabilities = Array.isArray(body.capabilities) ? body.capabilities.map(String) : [];
    device.updatedAt = now();
    // NOTE: this marks every local agent available, not just the ones located on
    // the registering device. Correct while one device exists; scoping it to
    // `agent.location.deviceId === device.id` belongs with the routing work that
    // makes the dispatch queue per-device.
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
      device: publicDeviceView(device),
      agents: state.agents,
      bridgeCredential: issuedCredential?.credential ?? publicDeviceView(device).bridgeCredential,
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

  // Re-pair recovery: clear the paired credential so the bridge re-registers with a
  // fresh one. The operator recovery for an idle-expired credential (register can't
  // rotate an expired token by design), replacing the manual state-file edit.
  if (req.method === "POST" && url.pathname === "/api/device/relink") {
    relinkDevice();
    sendJson(res, 200, { device: publicDeviceView(state.device) });
    return true;
  }

  return false;
}
