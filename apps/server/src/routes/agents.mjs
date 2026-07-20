import { normalizeMcpAdapterConfig } from "@myagenttool/adapters/mcp";

import { isClaudeCliCommand, isCodexCliCommand } from "../services/agents.mjs";
import { bearerToken, publicDeviceView } from "../runtime/bridge-auth.mjs";
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
  deviceForToken,
  issueBridgeCredential,
  requireBridgeCredential,
}) {
  if (req.method === "POST" && url.pathname === "/api/bridge/readiness") {
    const device = requireBridgeCredential({ req, res, sendJson });
    if (!device) return true;
    const body = await readJson(req);
    device.applicationBinaryReadiness = normalizeApplicationBinaryReadiness(body?.applicationBinaryReadiness, now());
    device.applicationCredentialReadiness = normalizeApplicationCredentialReadiness(body?.applicationCredentialReadiness, now());
    device.updatedAt = now();
    sendJson(res, 200, { device: publicDeviceView(device) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/bridge/register") {
    const body = await readJson(req);
    // Which machine is registering?
    //
    // Pairing is PER DEVICE, not per fleet. A token that matches a credential
    // names its device — that bridge is re-registering and must prove it. A
    // request that matches nothing is *claiming* an unpaired device: the seeded
    // one on first boot, or one whose credential `relink` just cleared.
    //
    // Reading it per-fleet ("is anything paired?") is what the single-device
    // control plane made look right, and it breaks the moment there are two:
    // relinking device A would demand a credential A no longer has, because B is
    // still paired — and A could never re-pair. `relink` is the operator's only
    // recovery for a lost token, so that failure has no way out.
    //
    // A claim is unauthenticated by construction (a first-boot bridge has nothing
    // to present), so it may only ever land on a device with NO credential — a
    // paired machine can never be taken over this way. Two unpaired devices are
    // ambiguous: refuse rather than guess which machine is on the other end.
    const claimable = listDevices(state).filter((item) => !item.bridgeCredential?.tokenHash);
    const authenticated = deviceForToken(bearerToken(req));
    let device;
    let issuedCredential = null;
    if (authenticated) {
      // Re-run the full gate (revoked / idle-expired), which answers on its own.
      device = requireBridgeCredential({ req, res, sendJson });
      if (!device) return true;
      if (body.rotateCredential === true) {
        issuedCredential = issueBridgeCredential({ deviceId: device.id, rotate: true });
      }
    } else if (claimable.length === 1) {
      device = claimable[0];
      if (device.unlinkState !== "linked") {
        sendJson(res, 403, { error: "device_credentials_revoked" });
        return true;
      }
      issuedCredential = issueBridgeCredential({ deviceId: device.id, rotate: true });
    } else if (claimable.length === 0) {
      // Every device is paired: an unmatched token cannot name any of them.
      sendJson(res, 401, { error: "invalid_bridge_credentials" });
      return true;
    } else {
      sendJson(res, 409, { error: "ambiguous_device_claim", claimableDeviceCount: claimable.length });
      return true;
    }
    device.status = "online";
    // Clearing livenessLostAt on the REGISTERING device, not the primary alias:
    // on a fleet they differ, and clearing the primary's would declare a machine
    // healthy because a different one just checked in.
    device.livenessLostAt = null;
    device.lastSeenAt = now();
    device.bridgeVersion = String(body.bridgeVersion ?? "0.0.0");
    device.registeredCapabilities = Array.isArray(body.capabilities) ? body.capabilities.map(String) : [];
    device.applicationBinaryReadiness = normalizeApplicationBinaryReadiness(body.applicationBinaryReadiness, device.lastSeenAt);
    device.applicationCredentialReadiness = normalizeApplicationCredentialReadiness(body.applicationCredentialReadiness, device.lastSeenAt);
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

// Device-reported credential readiness (#977, ADR 0010). The device reports what
// it HOLDS — application, provider, scope — and never a credential. This
// normalizer is the server's independent guarantee of that: it constructs a
// fresh row from four validated scalars, so nothing else a bridge sends (a token
// smuggled in an extra field, a nested object) can enter server state. The scope
// comparison against the descriptor happens in the application service; the
// device is never told what scope the server wants, so it cannot claim a match.
function normalizeApplicationCredentialReadiness(rows, checkedAt) {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const applicationId = String(row?.applicationId ?? "").trim();
    const provider = String(row?.provider ?? "").trim().toLowerCase();
    const scope = String(row?.scope ?? "").trim();
    if (!/^app_[a-z0-9_]{1,48}$/.test(applicationId)) return [];
    if (!/^[a-z][a-z0-9_.-]{0,31}$/.test(provider) || !/^[a-z][a-z0-9_.-]{0,63}$/.test(scope)) return [];
    return [{ applicationId, provider, scope, status: "present", checkedAt }];
  });
}

function normalizeApplicationBinaryReadiness(rows, checkedAt) {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const command = String(row?.command ?? "").trim();
    const capabilityPrefix = String(row?.capabilityPrefix ?? "").trim();
    const status = row?.status === "available" ? "available" : row?.status === "absent" ? "absent" : null;
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(command) || !capabilityPrefix.startsWith("app.") || !status) return [];
    const authenticationStatus = status === "available" && ["authenticated", "unauthenticated", "unknown"].includes(row?.authenticationStatus)
      ? row.authenticationStatus
      : null;
    const authenticationMethod = authenticationStatus === "authenticated"
      ? String(row?.authenticationMethod ?? "").trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "_").slice(0, 32) || null
      : null;
    return [{
      command,
      capabilityPrefix,
      status,
      version: status === "available" ? String(row?.version ?? "").trim().slice(0, 120) || null : null,
      ...(authenticationStatus ? { authenticationStatus, authenticationMethod } : {}),
      checkedAt,
    }];
  });
}
