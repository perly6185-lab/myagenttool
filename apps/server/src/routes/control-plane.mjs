import crypto from "node:crypto";
import { canProvision, denyForeignProject, hashPassword, verifyPassword } from "../runtime/auth.mjs";
import { publicDeviceView } from "../runtime/bridge-auth.mjs";
import { computeNextRun, normalizeSchedule } from "../services/automation-schedule.mjs";
import {
  capabilityInvocationInput,
  capabilityTargetProblem,
  isCapabilityTarget,
  normalizeAutomationTarget,
} from "../services/automation-target.mjs";

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
  // A capability-target automation validates against the live contract and fires
  // through the same dispatch the Run panel uses (#847).
  getCapability,
  createCapabilityInvocation,
}) {
  if (req.method === "POST" && url.pathname === "/api/session") {
    // Multi-user login: a body.userId logs in as that seeded user; with none we
    // fall back to the local user so existing single-user dev is unchanged.
    const body = await readJson(req).catch(() => ({}));
    const requestedUserId = body?.userId ? String(body.userId) : null;
    if (requestedUserId && !state.users.some((item) => item.id === requestedUserId)) {
      sendJson(res, 404, { error: "user_not_found" });
      return true;
    }
    const user =
      (requestedUserId && state.users.find((item) => item.id === requestedUserId)) ||
      state.users.find((item) => item.id === "usr_local") ||
      state.users[0];
    // Credential check: a user with a password must supply the correct one
    // (closes login-as-anyone for credentialed users). A passwordless user —
    // e.g. the seeded local dev user — still logs in without one.
    if (user?.passwordHash && !verifyPassword(body?.password, user.passwordHash)) {
      sendJson(res, 401, { error: "invalid_credentials" });
      return true;
    }
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
    const { passwordHash: _pw, ...safeUser } = user ?? { id: "usr_local", name: "Local User", teamId: "team_local" };
    sendJson(res, 200, {
      token,
      expiresAt: record.expiresAt,
      user: safeUser,
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

  // Team + user provisioning. The seed ships one local team/user; these let a
  // second tenant exist so the ownership guards actually engage. Only an
  // owner/admin may provision (9C); the seeded local user is an owner, so
  // single-user dev is unaffected.
  if (req.method === "POST" && url.pathname === "/api/teams") {
    if (!canProvision(actor)) {
      sendJson(res, 403, { error: "forbidden", message: "Only an owner or admin can create teams." });
      return true;
    }
    const body = await readJson(req).catch(() => ({}));
    const name = String(body?.name ?? "").trim();
    if (!name) {
      sendJson(res, 400, { error: "invalid_team", message: "A team name is required." });
      return true;
    }
    const team = {
      id: nextId("team"),
      name,
      slug: String(body?.slug ?? name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")),
      createdAt: now(),
    };
    state.teams.unshift(team);
    persistStateSoon();
    sendJson(res, 201, { team });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/users") {
    if (!canProvision(actor)) {
      sendJson(res, 403, { error: "forbidden", message: "Only an owner or admin can create users." });
      return true;
    }
    const body = await readJson(req).catch(() => ({}));
    const name = String(body?.name ?? "").trim();
    const teamId = String(body?.teamId ?? "").trim();
    if (!name) {
      sendJson(res, 400, { error: "invalid_user", message: "A user name is required." });
      return true;
    }
    if (!state.teams.some((item) => item.id === teamId)) {
      sendJson(res, 400, { error: "invalid_user", message: "A known teamId is required." });
      return true;
    }
    const user = {
      id: nextId("usr"),
      name,
      email: body?.email ? String(body.email) : null,
      teamId,
      role: ["owner", "admin", "operator", "viewer"].includes(body?.role) ? body.role : "operator",
      // A password makes the user login-protected; omit for a passwordless
      // (dev/service) account. Never echo the hash back.
      passwordHash: body?.password ? hashPassword(String(body.password)) : null,
      createdAt: now(),
    };
    state.users.unshift(user);
    persistStateSoon();
    const { passwordHash: _omit, ...safeUser } = user;
    sendJson(res, 201, { user: safeUser });
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
    sendJson(res, 200, { device: publicDeviceView(state.device) });
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
    // What this schedule fires (#847). Absent → the agent prompt it has always
    // been; every existing automation relies on that.
    const target = normalizeAutomationTarget(body.target);
    if (target.kind === "capability") {
      const problem = capabilityTargetProblem({
        target,
        capability: getCapability(target.capability, actor),
        projectId,
      });
      if (problem) {
        sendJson(res, 400, { error: "invalid_automation", message: problem });
        return true;
      }
    }
    const automation = {
      id: nextId("atm_demo"),
      name,
      enabled,
      projectId,
      target,
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
      createdBy: actor?.userId ?? "usr_local",
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
    if (denyForeignProject({ res, sendJson, state, actor, projectId: automation.projectId, notFound: { error: "automation_not_found" } })) {
      return true;
    }
    // "Run now" and the scheduler tick must fire the SAME thing (#847). If they
    // diverge, an operator tests a schedule by hand, sees it work, and the timer
    // then does something else — the worst possible way to learn about a bug.
    if (isCapabilityTarget(automation)) {
      // A refusal is RECORDED on the automation, exactly as the tick records it
      // (#847/#848). Returning the error only to the caller left the schedule
      // reading "never run" — so an operator tried it by hand, saw a toast, walked
      // away, and the schedule went on looking idle. That is the silent-nothing
      // failure this whole slice exists to end; it must not be reintroduced by the
      // button next to it.
      const refuse = (reason) => {
        automation.lastRunAt = now();
        automation.lastRunError = reason;
        persistStateSoon();
      };
      const problem = capabilityTargetProblem({
        target: automation.target,
        capability: getCapability(automation.target.capability, actor),
        projectId: automation.projectId,
      });
      if (problem) {
        refuse(problem);
        sendJson(res, 409, { error: "automation_target_unavailable", message: problem, automation });
        return true;
      }
      const result = createCapabilityInvocation(
        automation.target.capability,
        { ...capabilityInvocationInput(automation), automationId: automation.id },
        actor,
      );
      if (result.status >= 400) {
        refuse(result.body?.message ?? result.body?.error ?? `Dispatch refused with ${result.status}.`);
        sendJson(res, result.status, { ...result.body, automation });
        return true;
      }
      automation.lastInvocationId = result.body?.invocationId ?? null;
      automation.lastRunAt = now();
      automation.lastRunError = null;
      automation.runCount = (automation.runCount ?? 0) + 1;
      persistStateSoon();
      sendJson(res, 201, { ...result.body, automation });
      return true;
    }
    const agent = findAgent(automation.agentId) ?? defaultAgent();
    if (!agent) {
      sendJson(res, 404, { error: "agent_not_found" });
      return true;
    }
    const invocation = createInvocation(automation.prompt, agent, {
      actor,
      metadata: { automationId: automation.id, automationName: automation.name, projectId: automation.projectId },
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
    // Same ownership guard as POST /api/automations/:id/run — without it a
    // foreign team could enumerate the id and delete or repoint (prompt/agent/
    // schedule/enabled) another team's scheduled automation. (GAP-1)
    if (denyForeignProject({ res, sendJson, state, actor, projectId: automation.projectId, notFound: { error: "automation_not_found" } })) {
      return true;
    }
    if (req.method === "DELETE") {
      state.automations = state.automations.filter((item) => item.id !== automation.id);
      persistStateSoon();
      sendJson(res, 204, null);
      return true;
    }
    const patch = await readJson(req);
    if (patch.projectId !== undefined) {
      const nextProjectId = String(patch.projectId ?? "").trim();
      if (!state.projects.some((item) => item.id === nextProjectId)) {
        sendJson(res, 400, { error: "invalid_automation", message: "A known projectId is required." });
        return true;
      }
      if (denyForeignProject({ res, sendJson, state, actor, projectId: nextProjectId, notFound: { error: "project_not_found" } })) {
        return true;
      }
      automation.projectId = nextProjectId;
    }
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
