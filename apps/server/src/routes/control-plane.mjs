import { canProvision, denyForeignProject, hashPassword } from "../runtime/auth.mjs";
import { publicDeviceView } from "../runtime/bridge-auth.mjs";
import { computeNextRun, normalizeSchedule } from "../services/automation-schedule.mjs";
import {
  capabilityInvocationInput,
  capabilityTargetProblem,
  isCapabilityTarget,
  normalizeAutomationTarget,
} from "../services/automation-target.mjs";
import { normalizeExternalAlertWebhookUrl } from "../services/auto-run-alerts.mjs";
import { normalizeWebPerformanceMetric, summarizeWebPerformance } from "../services/web-performance.mjs";
import { ensureEventStreamMetrics, eventStreamSummary } from "../services/event-stream-metrics.mjs";
import { actOnOperationalAlert, reconcileOperationalHealth } from "../services/operational-health.mjs";
import { validateNewPassword } from "../services/password-recovery.mjs";

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
  requestObservabilityDeletion,
}) {
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
    const rawAlertWebhookUrl = body?.alertWebhookUrl;
    const normalizedTeamWebhookUrl = rawAlertWebhookUrl == null || rawAlertWebhookUrl === ""
      ? null
      : normalizeExternalAlertWebhookUrl(rawAlertWebhookUrl);
    if (rawAlertWebhookUrl && !normalizedTeamWebhookUrl) {
      sendJson(res, 400, { error: "invalid_alert_webhook_url" });
      return true;
    }
    const team = {
      id: nextId("team"),
      name,
      slug: String(body?.slug ?? name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")),
      alertWebhookUrl: normalizedTeamWebhookUrl,
      createdAt: now(),
    };
    state.teams.unshift(team);
    persistStateSoon();
    const { alertWebhookUrl, ...publicTeam } = team;
    sendJson(res, 201, { team: { ...publicTeam, alertWebhookConfigured: Boolean(alertWebhookUrl) } });
    return true;
  }
  const teamAlertMatch = url.pathname.match(/^\/api\/teams\/([^/]+)\/alert-webhook$/);
  if (req.method === "PATCH" && teamAlertMatch) {
    const teamId = decodeURIComponent(teamAlertMatch[1]);
    if (!canProvision(actor) || actor?.teamId !== teamId) {
      sendJson(res, 404, { error: "team_not_found" });
      return true;
    }
    const team = state.teams.find((item) => item.id === teamId);
    if (!team) {
      sendJson(res, 404, { error: "team_not_found" });
      return true;
    }
    const body = await readJson(req).catch(() => ({}));
    const raw = body?.alertWebhookUrl;
    const alertWebhookUrl = raw == null || raw === "" ? null : normalizeExternalAlertWebhookUrl(raw);
    if (raw && !alertWebhookUrl) {
      sendJson(res, 400, { error: "invalid_alert_webhook_url" });
      return true;
    }
    team.alertWebhookUrl = alertWebhookUrl;
    persistStateSoon();
    const { alertWebhookUrl: storedWebhookUrl, ...publicTeam } = team;
    sendJson(res, 200, { team: { ...publicTeam, alertWebhookConfigured: Boolean(storedWebhookUrl) } });
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
    if (body?.password && process.env.MYAGENT_LEGACY_LOCAL_LOGIN !== "1") {
      const passwordPolicy = validateNewPassword(String(body.password), {
        teamId,
        userId: String(body?.id ?? name),
      });
      if (!passwordPolicy.ok) {
        sendJson(res, 400, passwordPolicy);
        return true;
      }
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

  if (req.method === "POST" && url.pathname === "/api/observability/delete") {
    // ADR 0018: per-subject observability data deletion is irreversible, so it is
    // owner/admin-only. The composer re-gates and does the shielded-safe erase.
    if (!canProvision(actor)) {
      sendJson(res, 403, { error: "forbidden", message: "Only an owner or admin can delete observability data." });
      return true;
    }
    if (typeof requestObservabilityDeletion !== "function") {
      sendJson(res, 501, { error: "not_supported" });
      return true;
    }
    const body = await readJson(req).catch(() => ({}));
    const result = requestObservabilityDeletion({
      scope: body?.scope,
      subjectId: body?.subjectId,
      tier: body?.tier,
      actor,
    });
    if (!result?.ok) {
      sendJson(res, 400, { error: result?.error ?? "invalid_request" });
      return true;
    }
    sendJson(res, 200, {
      deleted: true,
      scope: body.scope,
      subjectId: body.subjectId,
      tier: result.tier,
      invocationCount: result.invocationCount,
      counts: result.counts,
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/observability/web-performance") {
    const body = await readJson(req).catch(() => ({}));
    const metric = normalizeWebPerformanceMetric(body, {
      id: nextId("wpm"),
      userId: actor?.userId,
      teamId: actor?.teamId,
      recordedAt: now(),
    });
    if (!metric) {
      sendJson(res, 400, { error: "invalid_web_performance_metric" });
      return true;
    }
    state.webPerformanceMetrics ??= [];
    state.webPerformanceMetrics.push(metric);
    state.webPerformanceMetrics = state.webPerformanceMetrics.slice(-5_000);
    persistStateSoon();
    sendJson(res, 202, { accepted: true });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/observability/web-performance") {
    const rows = (state.webPerformanceMetrics ?? []).filter((row) => row.teamId === actor?.teamId);
    const summary = summarizeWebPerformance(rows, {
      version: url.searchParams.get("version"),
      limit: Number(url.searchParams.get("limit") ?? 200),
    });
    sendJson(res, 200, { ...summary, recent: rows.slice(-50).reverse() });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/observability/event-stream/reconnect") {
    const metrics = ensureEventStreamMetrics(state, actor?.teamId);
    metrics.reconnects += 1;
    persistStateSoon();
    sendJson(res, 202, { accepted: true });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/observability/event-stream") {
    const metrics = ensureEventStreamMetrics(state, actor?.teamId);
    sendJson(res, 200, { metrics: eventStreamSummary(metrics) });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/observability/operations") {
    const health = reconcileOperationalHealth(state, { teamId: actor?.teamId, now });
    for (const alert of health.transitions.triggered) {
      appendEvent({ invocationId: null, type: "operational_alert_triggered", level: alert.severity, message: alert.message, data: { alertId: alert.id, source: alert.source } });
    }
    for (const alert of health.transitions.recovered) {
      appendEvent({ invocationId: null, type: "operational_alert_recovered", level: "info", message: `Recovered ${alert.key}.`, data: { alertId: alert.id, source: alert.source } });
    }
    persistStateSoon();
    const { transitions: _transitions, ...publicHealth } = health;
    sendJson(res, 200, publicHealth);
    return true;
  }

  const operationalAlertMatch = url.pathname.match(/^\/api\/observability\/operations\/alerts\/([^/]+)\/actions$/);
  if (req.method === "POST" && operationalAlertMatch) {
    const body = await readJson(req).catch(() => ({}));
    const alert = actOnOperationalAlert(state, {
      teamId: actor?.teamId,
      alertId: decodeURIComponent(operationalAlertMatch[1]),
      action: body.action,
      actorId: actor?.userId ?? "usr_local",
      silenceMinutes: body.silenceMinutes,
      now,
    });
    if (!alert) {
      sendJson(res, 404, { error: "operational_alert_not_found" });
      return true;
    }
    appendEvent({ invocationId: null, type: `operational_alert_${body.action}`, level: "info", message: `${body.action} ${alert.key}.`, data: { alertId: alert.id, source: alert.source } });
    persistStateSoon();
    sendJson(res, 200, { alert });
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
