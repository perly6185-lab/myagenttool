import crypto from "node:crypto";
import { denyForeignProject } from "../runtime/auth.mjs";
import { computeNextRun, normalizeSchedule } from "../services/automation-schedule.mjs";

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function handleControlPlaneRoutes({
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
}) {
  if (req.method === "POST" && url.pathname === "/api/session") {
    const user = state.users.find((item) => item.id === "usr_local") ?? state.users[0];
    const createdAt = now();
    const token = `tok_${crypto.randomBytes(24).toString("base64url")}`;
    const record = {
      id: nextId("tok_demo"),
      token,
      userId: user?.id ?? "usr_local",
      teamId: user?.teamId ?? "team_local",
      createdAt,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
      revokedAt: null,
    };
    state.tokens.unshift(record);
    state.tokens = state.tokens.slice(0, 20);
    persistStateSoon();
    sendJson(res, 200, {
      token,
      expiresAt: record.expiresAt,
      user: user ?? { id: "usr_local", name: "Local User", teamId: "team_local" },
    });
    return true;
  }

  if (req.method === "DELETE" && url.pathname === "/api/session") {
    const token = String(req.headers?.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (token) {
      state.tokens = state.tokens.filter((item) => item.token !== token);
      persistStateSoon();
    }
    sendJson(res, 204, null);
    return true;
  }

  if (req.method === "PATCH" && url.pathname === "/api/device") {
    const body = await readJson(req);
    if (body.maxConcurrency !== undefined) {
      const value = Math.floor(Number(body.maxConcurrency));
      if (!Number.isFinite(value)) {
        sendJson(res, 400, { error: "invalid_device", message: "maxConcurrency must be numeric." });
        return true;
      }
      state.device.maxConcurrency = Math.max(1, Math.min(16, value));
    }
    state.device.updatedAt = now();
    persistStateSoon();
    sendJson(res, 200, { device: state.device });
    return true;
  }

  if ((req.method === "PUT" || req.method === "POST") && url.pathname === "/api/budgets") {
    const body = await readJson(req);
    if (denyForeignProject({ res, sendJson, state, actor, projectId: body.projectId })) {
      return true;
    }
    try {
      const budget = upsertBudget(body);
      sendJson(res, 200, { budget, status: budgetStatusFor(budget.projectId) });
    } catch (error) {
      sendJson(res, 400, { error: "invalid_budget", message: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/automations") {
    const body = await readJson(req);
    const projectId = String(body.projectId ?? "").trim();
    if (!state.projects.some((item) => item.id === projectId)) {
      sendJson(res, 400, { error: "invalid_automation", message: "A known projectId is required." });
      return true;
    }
    if (denyForeignProject({ res, sendJson, state, actor, projectId })) {
      return true;
    }
    const name = String(body.name ?? "").trim();
    if (!name) {
      sendJson(res, 400, { error: "invalid_automation", message: "Name is required." });
      return true;
    }
    const schedule = normalizeSchedule(body.schedule);
    const enabled = body.enabled !== false;
    const automation = {
      id: nextId("atm_demo"),
      name,
      enabled,
      projectId,
      branch: String(body.branch ?? "main"),
      schedule,
      nextRunAt: enabled ? computeNextRun(schedule) : null,
      sessionMode: body.sessionMode === "reuse" ? "reuse" : "fresh",
      graceHours: Number.isFinite(Number(body.graceHours)) ? Number(body.graceHours) : 12,
      precheck: typeof body.precheck === "string" && body.precheck.trim() ? body.precheck.trim() : "None",
      agentId: findAgent(body.agentId)?.id ?? defaultAgent()?.id ?? null,
      prompt: String(body.prompt ?? ""),
      lastRunAt: null,
      lastInvocationId: null,
      runCount: 0,
      tokens: 0,
      createdBy: "usr_local",
      createdAt: now(),
    };
    state.automations.unshift(automation);
    persistStateSoon();
    sendJson(res, 201, { automation });
    return true;
  }

  const automationRunMatch = url.pathname.match(/^\/api\/automations\/([^/]+)\/run$/);
  if (req.method === "POST" && automationRunMatch) {
    const automation = state.automations.find((item) => item.id === decodeURIComponent(automationRunMatch[1]));
    if (!automation) {
      sendJson(res, 404, { error: "automation_not_found" });
      return true;
    }
    if (denyForeignProject({ res, sendJson, state, actor, projectId: automation.projectId })) {
      return true;
    }
    const agent = findAgent(automation.agentId) ?? defaultAgent();
    if (!agent) {
      sendJson(res, 404, { error: "agent_not_found" });
      return true;
    }
    const invocation = createInvocation(automation.prompt, agent, {
      projectId: automation.projectId,
      metadata: { automationId: automation.id, automationName: automation.name },
    });
    startInvocationIfAllowed(invocation, agent);
    automation.lastInvocationId = invocation.id;
    automation.lastRunAt = now();
    automation.runCount = (automation.runCount ?? 0) + 1;
    persistStateSoon();
    sendJson(res, 201, { invocation, automation });
    return true;
  }

  const automationMatch = url.pathname.match(/^\/api\/automations\/([^/]+)$/);
  if (automationMatch && (req.method === "PATCH" || req.method === "DELETE")) {
    const automation = state.automations.find((item) => item.id === decodeURIComponent(automationMatch[1]));
    if (!automation) {
      sendJson(res, 404, { error: "automation_not_found" });
      return true;
    }
    if (req.method === "DELETE") {
      state.automations = state.automations.filter((item) => item.id !== automation.id);
      persistStateSoon();
      sendJson(res, 204, null);
      return true;
    }
    const patch = await readJson(req);
    if (patch.projectId !== undefined && state.projects.some((item) => item.id === patch.projectId)) automation.projectId = patch.projectId;
    if (patch.name !== undefined) automation.name = String(patch.name).trim() || automation.name;
    if (patch.prompt !== undefined) automation.prompt = String(patch.prompt);
    if (patch.schedule !== undefined) automation.schedule = normalizeSchedule(patch.schedule);
    if (patch.agentId !== undefined && findAgent(patch.agentId)) automation.agentId = patch.agentId;
    if (patch.branch !== undefined) automation.branch = String(patch.branch);
    if (patch.precheck !== undefined) automation.precheck = String(patch.precheck).trim() || "None";
    if (patch.sessionMode !== undefined) automation.sessionMode = patch.sessionMode === "reuse" ? "reuse" : "fresh";
    if (patch.graceHours !== undefined && Number.isFinite(Number(patch.graceHours))) automation.graceHours = Number(patch.graceHours);
    if (patch.enabled !== undefined) automation.enabled = Boolean(patch.enabled);
    if (patch.enabled !== undefined || patch.schedule !== undefined) {
      automation.nextRunAt = automation.enabled ? computeNextRun(automation.schedule) : null;
    }
    persistStateSoon();
    sendJson(res, 200, { automation });
    return true;
  }

  return false;
}
