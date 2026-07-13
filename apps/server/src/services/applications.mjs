import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { normalizeLoopRoutine, validateLoopRoutine } from "../../../../tools/ai/src/loop/routine.mjs";
import { teamOf } from "../runtime/auth.mjs";

// Consecutive failed health checks before an active application is auto-offlined
// (docs/design/APPLICATION_HEALTH_PROBE.md) — fixed, to avoid flapping on
// transient filesystem states.
const HEALTH_FAILURE_THRESHOLD = 2;

const APPLICATION_SOURCE_TYPES = new Set(["git", "local", "npm", "binary", "manual"]);

// A binary source names a bare program (`git`), never a path on disk. The bridge
// allowlist decides what may actually run; the caller does not get to name a path.
const BINARY_SOURCE_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
const APPLICATION_STATUSES = new Set(["draft", "probing", "registered", "active", "offline", "archived", "failed"]);
const NPM_WRAPPER_MODES = new Set(["metadata-only", "installed-wrapper"]);
const APPLICATION_ROUTINE_REQUIRED_APPROVALS = ["apply", "push", "pr-create", "pr-merge"];
const APPLICATION_ROUTINE_RISK_LEVELS = ["low", "medium", "high", "critical"];

export function createApplicationService({
  state,
  now,
  nextId,
  appendEvent,
  persistStateSoon,
  addProject,
  cloneProject,
  defaultProjectPath = process.cwd(),
  sendAlert = null,
  validateApprovalToken = null,
}) {
  // Approval check behind every `approvalToken` field (docs/design/
  // APPROVAL_GRANTS.md): issued grants are validated + consumed; in phase 1 a
  // legacy free-text token still passes (stamped + counted by the validator).
  // Presence stays a hard requirement either way. A null validator (direct
  // service construction in unit tests) degrades to the presence check.
  function approvalCheck(input, action, targetId, actor = null) {
    const token = input && typeof input === "object" && !Array.isArray(input) ? input.approvalToken : null;
    if (!String(token ?? "").trim()) return { approved: false, reason: "missing_token" };
    if (typeof validateApprovalToken !== "function") return { approved: true, mode: "presence" };
    return validateApprovalToken(token, { action, targetId, actor });
  }

  function listApplications() {
    return state.applications ?? [];
  }

  function findApplication(applicationId) {
    return listApplications().find((app) => app.id === applicationId) ?? null;
  }

  function registerApplication(body = {}, actor = null) {
    const source = normalizeApplicationSource(body.source ?? sourceFromLegacyBody(body));
    const name = normalizeApplicationName(body.name ?? nameFromSource(source));
    const requestedId = body.id == null ? null : sanitizeApplicationId(body.id);
    const existing = findExistingApplicationBySource(state.applications ?? [], source);
    if (existing) {
      if (!actorCanAccessApplication(state, actor, existing)) {
        throw new Error("Application source is already registered.");
      }
      if (requestedId && requestedId !== existing.id) {
        throw new Error(`Application source is already registered as ${existing.id}.`);
      }
      existing.name = name || existing.name;
      // Never let re-registration reassign ownership to a caller-supplied team;
      // access was already checked above. Keep the established owner.
      existing.ownerTeamId = existing.ownerTeamId ?? actor?.teamId ?? "team_local";
      existing.updatedAt = now();
      if (body.autoOnline !== false && existing.status === "registered") {
        existing.status = "active";
      }
      persistStateSoon();
      return existing;
    }
    const applicationId = requestedId ?? sanitizeApplicationId(nextId("app"));
    if (findApplication(applicationId)) {
      throw new Error(`Application id already exists: ${applicationId}.`);
    }

    const createdAt = now();
    // Ownership is derived from the authenticated actor (or the local default),
    // never from a caller-supplied ownerTeamId (spoofing vector).
    const ownerTeamId = actor?.teamId ?? "team_local";
    let project = null;
    // Git source clones in the BACKGROUND (#305): a large/slow `git clone` must
    // never block the event loop. The app registers immediately in a "probing"
    // state and transitions to registered/failed when the clone settles (below).
    if (source.type === "local") {
      project = addProject({
        name,
        path: source.path,
        host: body.host ?? "local",
        color: body.color,
        ownerTeamId: actor?.teamId,
      });
    }

    const app = {
      id: applicationId,
      name,
      kind: normalizeApplicationKind(body.kind, source),
      source,
      // Git source starts in "probing" until the background clone finishes.
      status: source.type === "git"
        ? "probing"
        : normalizeApplicationStatus(body.status ?? (body.autoOnline === false ? "registered" : "active")),
      lifecycle: {
        state: "registered",
        lastOperation: "register",
        lastOperationAt: createdAt,
      },
      projectId: project?.id ?? body.projectId ?? null,
      path: project?.path ?? source.path ?? null,
      ownerTeamId: ownerTeamId ?? project?.ownerTeamId ?? "team_local",
      capabilitiesVersion: 1,
      orchestrationIds: [],
      createdAt,
      updatedAt: createdAt,
    };
    state.applications = state.applications ?? [];
    state.applications.unshift(app);
    appendEvent({
      invocationId: null,
      type: "application_registered",
      level: "info",
      message: `${app.name} application registered.`,
      data: {
        applicationId: app.id,
        sourceType: app.source.type,
        projectId: app.projectId,
      },
    });
    // Background git clone — off the event loop; settle the app when done (#305).
    if (source.type === "git") {
      Promise.resolve(cloneProject({
        gitUrl: source.url,
        parentPath: body.parentDir ?? body.parentPath,
        name: body.folderName ?? name,
        host: body.host ?? "local",
        color: body.color,
        ownerTeamId: actor?.teamId,
      })).then((cloned) => {
        app.projectId = cloned.id;
        app.path = cloned.path;
        app.status = "registered";
        app.lifecycle = { state: "registered", lastOperation: "clone", lastOperationAt: now() };
        app.updatedAt = now();
        appendEvent({
          invocationId: null,
          type: "application_clone_completed",
          level: "info",
          message: `${app.name} git source cloned.`,
          data: { applicationId: app.id, projectId: cloned.id },
        });
        persistStateSoon();
      }).catch((error) => {
        app.status = "failed";
        app.lifecycle = { state: "failed", lastOperation: "clone", lastOperationAt: now(), error: String(error?.message ?? error) };
        app.updatedAt = now();
        appendEvent({
          invocationId: null,
          type: "application_clone_failed",
          level: "warn",
          message: `${app.name} git clone failed: ${String(error?.message ?? error)}`,
          data: { applicationId: app.id },
        });
        persistStateSoon();
      });
    }
    persistStateSoon();
    return app;
  }

  function transitionApplication(applicationId, action, actor = null) {
    const app = findApplication(applicationId);
    if (!app) return null;
    const normalizedAction = String(action ?? "").trim();
    const nextStatus = statusForLifecycleAction(normalizedAction);
    if (!nextStatus) {
      throw new Error(`Unsupported application lifecycle action: ${normalizedAction}`);
    }
    app.status = nextStatus;
    app.lifecycle = {
      ...app.lifecycle,
      state: nextStatus,
      lastOperation: normalizedAction,
      lastOperationAt: now(),
      lastActorId: actor?.userId ?? null,
    };
    app.updatedAt = app.lifecycle.lastOperationAt;
    appendEvent({
      invocationId: null,
      type: `application_${normalizedAction}`,
      level: nextStatus === "offline" || nextStatus === "archived" ? "warn" : "info",
      message: `${app.name} application ${normalizedAction}.`,
      data: { applicationId: app.id, status: app.status },
    });
    persistStateSoon();
    return app;
  }

  function probeApplication(applicationId, actor = null) {
    const app = findApplication(applicationId);
    if (!app) return null;
    const probedAt = now();
    const probe = buildApplicationProbe(app);
    app.probe = {
      status: "completed",
      checkedAt: probedAt,
      summary: probe.summary,
      source: probe.source,
      package: probe.package,
      readme: probe.readme,
      capabilities: probe.capabilities,
      capabilityNames: probe.capabilities.map((capability) => capability.name),
      warnings: probe.warnings,
    };
    app.lifecycle = {
      ...app.lifecycle,
      lastOperation: "probe",
      lastOperationAt: probedAt,
      lastActorId: actor?.userId ?? null,
    };
    app.updatedAt = probedAt;
    appendEvent({
      invocationId: null,
      type: "application_probed",
      level: "info",
      message: `${app.name} application probe completed.`,
      data: {
        applicationId: app.id,
        capabilityCount: app.probe.capabilities.length,
        inferredCapabilityCount: app.probe.capabilities.filter((capability) => capability.source === "inferred").length,
        declaredCapabilityCount: app.probe.capabilities.filter((capability) => capability.source === "declared").length,
      },
    });
    persistStateSoon();
    return app;
  }

  function listApplicationCapabilities(applicationId) {
    const app = findApplication(applicationId);
    return app ? projectApplicationCapabilities(app) : null;
  }

  function invokeApplicationCapability(capabilityName, input = {}, actor = null, options = {}) {
    const application = applicationForCapability(capabilityName, listApplications(), options.applicationId);
    if (!application) {
      return { ok: false, status: 404, body: { error: "capability_not_found" } };
    }
    const action = actionFromCapabilityName(capabilityName);
    if (!action) {
      return { ok: false, status: 404, body: { error: "capability_not_found" } };
    }
    if (application.status === "archived") {
      return { ok: false, status: 409, body: { error: "application_archived", applicationId: application.id } };
    }
    if (application.status === "offline" && !["inspect", "online"].includes(action)) {
      return { ok: false, status: 409, body: { error: "application_offline", applicationId: application.id } };
    }
    // Every side-effecting action — status changes, the orchestration-draft
    // write, and wrapper commands — requires an approval: an issued grant for
    // (action, application), or in phase 1 a legacy token (stamped + counted).
    if (["archive", "offline", "online", "refresh", "generate_orchestration"].includes(action) || action.startsWith("wrapper:")) {
      const approval = approvalCheck(input, action, application.id, actor);
      if (!approval.approved) {
        return {
          ok: false,
          status: 409,
          body: {
            error: "approval_required",
            reason: approval.reason === "missing_token"
              ? `${action} requires an explicit approvalToken.`
              : `approvalToken rejected: ${approval.reason}.`,
            applicationId: application.id,
            action,
          },
        };
      }
    }

    const result = executeApplicationAction({ application, action, input, actor, defaultProjectPath, now });
    if (result?.ok === false) {
      return result;
    }
    appendEvent({
      invocationId: null,
      type: "application_capability_executed",
      level: ["offline", "archive"].includes(action) ? "warn" : "info",
      message: `${application.name} application capability ${action} executed.`,
      data: { applicationId: application.id, capability: capabilityName, action },
    });
    persistStateSoon();
    return { ok: true, application, action, result };
  }

  // Plan a wrapper-capability invocation for bridge execution (#359). Applies the
  // same guards as the synchronous path — tenancy, archived/offline status, and
  // the mandatory approvalToken — then resolves the approved execution plan. On
  // success returns the exact command the bridge runner must execute; the caller
  // (capability service) dispatches it as a queued invocation. Never returns an
  // unapproved command (applicationWrapperExecutionPlan is the allowlist).
  function planApplicationWrapperInvocation({ applicationId, commandId, input = {}, actor = null } = {}) {
    const application = findApplication(applicationId);
    if (!application || !actorCanAccessApplication(state, actor, application)) {
      return { ok: false, status: 404, body: { error: "capability_not_found" } };
    }
    if (application.status === "archived") {
      return { ok: false, status: 409, body: { error: "application_archived", applicationId } };
    }
    if (application.status === "offline") {
      return { ok: false, status: 409, body: { error: "application_offline", applicationId } };
    }
    const command = findNpmWrapperCommand(application, commandId);
    if (!command) {
      return { ok: false, status: 404, body: { error: "wrapper_command_not_found", applicationId, commandId } };
    }
    // Approval is required only for commands that declare it. A read-only report
    // command can set requiresApproval:false — preserving, e.g., the ccusage
    // tool's offline reports that never needed an approval token.
    if (command.requiresApproval) {
      const approval = approvalCheck(input, `wrapper:${commandId}`, applicationId, actor);
      if (!approval.approved) {
        return { ok: false, status: 409, body: { error: "approval_required", reason: approval.reason === "missing_token" ? "This wrapper command requires an explicit approvalToken." : `approvalToken rejected: ${approval.reason}.`, applicationId } };
      }
    }
    const plan = applicationWrapperExecutionPlan(application, commandId, input);
    if (!plan) {
      return { ok: false, status: 404, body: { error: "wrapper_command_not_found", applicationId, commandId } };
    }
    return {
      ok: true,
      wrapper: {
        execCommand: plan.command,
        execArgs: plan.args,
        cwd: plan.cwd,
        cwdPolicy: plan.cwdPolicy,
        capability: plan.capability,
        filePolicy: plan.filePolicy,
        networkPolicy: plan.networkPolicy,
        compatibilityFacade: plan.compatibilityFacade,
        outputCollection: plan.outputCollection,
        billing: plan.billing,
        resultImport: plan.resultImport,
      },
      outputCollection: plan.outputCollection,
      timeoutSeconds: plan.timeoutSeconds,
    };
  }

  // Opt-in switch for orchestration auto-recovery (docs/design/
  // ORCHESTRATION_AUTO_RECOVERY.md). A side-effecting, write-control config
  // change — it enables autonomous execution — so it demands the explicit
  // approvalToken like every other application mutation.
  function setApplicationAutoRecovery(applicationId, body = {}, actor = null) {
    const app = findApplication(applicationId);
    if (!app) return null;
    const approval = approvalCheck(body, "auto-recovery-config", app.id, actor);
    if (!approval.approved) {
      throw new Error(approval.reason === "missing_token"
        ? "auto-recovery configuration requires an explicit approvalToken."
        : `approvalToken rejected: ${approval.reason}.`);
    }
    const routineId = typeof body.routineId === "string" && body.routineId.trim() ? body.routineId.trim() : null;
    // Per-routine override management (capability review item ④, 局部管控): a
    // flaky routine can run a tighter (or zero) cap than its siblings without
    // touching the application-level policy. clearOverride returns the routine
    // to the app default.
    if (routineId && body.clearOverride === true) {
      const overrides = { ...(app.autoRecovery?.routineOverrides ?? {}) };
      delete overrides[routineId];
      app.autoRecovery = { ...(app.autoRecovery ?? { enabled: false, maxAttempts: 2 }), routineOverrides: overrides };
      app.updatedAt = now();
      appendEvent({
        invocationId: null,
        type: "application_auto_recovery_configured",
        level: "info",
        message: `Application ${app.name} auto-recovery override for ${routineId} cleared (back to app default).`,
        data: { applicationId: app.id, routineId, cleared: true, actorId: actor?.userId ?? null },
      });
      persistStateSoon();
      return app;
    }
    if (typeof body.enabled !== "boolean") {
      throw new Error("auto-recovery configuration requires enabled: boolean.");
    }
    const maxAttempts = body.maxAttempts == null ? 2 : Number(body.maxAttempts);
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
      throw new Error("auto-recovery maxAttempts must be an integer between 1 and 5.");
    }
    if (routineId) {
      app.autoRecovery = {
        ...(app.autoRecovery ?? { enabled: false, maxAttempts: 2 }),
        routineOverrides: {
          ...(app.autoRecovery?.routineOverrides ?? {}),
          [routineId]: { enabled: body.enabled, maxAttempts },
        },
      };
    } else {
      app.autoRecovery = { ...(app.autoRecovery ?? {}), enabled: body.enabled, maxAttempts };
    }
    app.updatedAt = now();
    appendEvent({
      invocationId: null,
      type: "application_auto_recovery_configured",
      level: body.enabled ? "warn" : "info",
      message: routineId
        ? `Application ${app.name} auto-recovery override for ${routineId}: ${body.enabled ? `enabled (max ${maxAttempts} attempts)` : "disabled"}.`
        : `Application ${app.name} auto-recovery ${body.enabled ? `enabled (max ${maxAttempts} attempts)` : "disabled"}.`,
      data: { applicationId: app.id, routineId, enabled: body.enabled, maxAttempts, actorId: actor?.userId ?? null },
    });
    persistStateSoon();
    return app;
  }

  // Opt-in periodic health probe (docs/design/APPLICATION_HEALTH_PROBE.md).
  // Same write-control convention as auto-recovery: it enables an autonomous
  // status transition (active→offline), so it demands the explicit approvalToken.
  function setApplicationHealthProbe(applicationId, body = {}, actor = null) {
    const app = findApplication(applicationId);
    if (!app) return null;
    const approval = approvalCheck(body, "health-probe-config", app.id, actor);
    if (!approval.approved) {
      throw new Error(approval.reason === "missing_token"
        ? "health-probe configuration requires an explicit approvalToken."
        : `approvalToken rejected: ${approval.reason}.`);
    }
    if (typeof body.enabled !== "boolean") {
      throw new Error("health-probe configuration requires enabled: boolean.");
    }
    const intervalMinutes = body.intervalMinutes == null ? 5 : Number(body.intervalMinutes);
    if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 60) {
      throw new Error("health-probe intervalMinutes must be an integer between 1 and 60.");
    }
    app.healthProbe = { enabled: body.enabled, intervalMinutes, lastCheckedAt: app.healthProbe?.lastCheckedAt ?? null };
    app.updatedAt = now();
    appendEvent({
      invocationId: null,
      type: "application_health_probe_configured",
      level: "info",
      message: `Application ${app.name} health probe ${body.enabled ? `enabled (every ${intervalMinutes}m)` : "disabled"}.`,
      data: { applicationId: app.id, enabled: body.enabled, intervalMinutes, actorId: actor?.userId ?? null },
    });
    persistStateSoon();
    return app;
  }

  // One health check: source availability. Only local/git sources have a
  // materialized path to check; npm/manual read `unsupported` — never a
  // fabricated verdict, never an auto-transition.
  function checkApplicationHealth(app) {
    const supported = ["local", "git"].includes(app.source?.type) && typeof app.path === "string" && app.path;
    if (!supported) {
      return { status: "unsupported", reason: `source type ${app.source?.type ?? "unknown"} has no local materialization to check` };
    }
    return existsSync(app.path)
      ? { status: "healthy", reason: null }
      : { status: "unhealthy", reason: `source path ${app.path} does not exist` };
  }

  // The periodic sweep (driven by index.mjs's slow tick; tests call it directly).
  // Policy: auto-DEGRADE only — after 2 consecutive failures an active app goes
  // offline via the ordinary transition path; recovery never auto-onlines.
  function applicationHealthSweep({ force = false } = {}) {
    const checkedAt = now();
    // Observability for the sweep ITSELF: the self-healing machinery needs its
    // own health signal, or a wedged sweep is indistinguishable from "all
    // sources healthy". index.mjs's tick swallows exceptions by design; this
    // records the last run + last error where /api/state can expose them.
    let checkedCount = 0;
    let lastError = null;
    for (const app of listApplications()) {
      try {
        if (!app.healthProbe?.enabled || app.status === "archived") continue;
        const intervalMs = (app.healthProbe.intervalMinutes ?? 5) * 60_000;
        const last = app.healthProbe.lastCheckedAt ? Date.parse(app.healthProbe.lastCheckedAt) : 0;
        if (!force && Date.parse(checkedAt) - last < intervalMs) continue;
        app.healthProbe.lastCheckedAt = checkedAt;
        checkedCount += 1;
        checkApplicationHealthAndReact(app, checkedAt);
      } catch (error) {
        // One application's failure must not starve the rest of the sweep.
        lastError = `${app?.id ?? "unknown"}: ${error?.message ?? error}`;
      }
    }
    state.applicationHealthSweepStatus = { lastSweepAt: checkedAt, checkedCount, lastError };
    persistStateSoon();
  }

  function checkApplicationHealthAndReact(app, checkedAt) {
    {
      const wasUnhealthy = app.health?.status === "unhealthy";
      const check = checkApplicationHealth(app);
      const consecutiveFailures = check.status === "unhealthy" ? (app.health?.consecutiveFailures ?? 0) + 1 : 0;
      app.health = { ...check, checkedAt, consecutiveFailures };
      app.updatedAt = checkedAt;

      if (check.status === "unhealthy") {
        appendEvent({
          invocationId: null,
          type: "application_health_probe_failed",
          level: "warn",
          message: `${app.name} health probe failed (${consecutiveFailures}/${HEALTH_FAILURE_THRESHOLD}): ${check.reason}.`,
          data: { applicationId: app.id, reason: check.reason, consecutiveFailures, threshold: HEALTH_FAILURE_THRESHOLD },
        });
        if (consecutiveFailures >= HEALTH_FAILURE_THRESHOLD && app.status === "active") {
          transitionApplication(app.id, "offline", { userId: "system_health_probe" });
          appendEvent({
            invocationId: null,
            type: "application_health_auto_offline",
            level: "warn",
            message: `${app.name} taken offline after ${consecutiveFailures} failed health checks. Bringing it back online requires a human.`,
            data: { applicationId: app.id, reason: check.reason, consecutiveFailures },
          });
          // An autonomous status change nobody was watching for — push it to the
          // operator's alert webhook, not just the event stream. Best-effort.
          if (typeof sendAlert === "function") {
            sendAlert({
              kind: "application_health_auto_offline",
              severity: "warning",
              message: `${app.name} taken offline after ${consecutiveFailures} failed health checks: ${check.reason}. Bringing it back online requires a human.`,
              data: { applicationId: app.id, applicationName: app.name, reason: check.reason, consecutiveFailures },
            });
          }
        }
      } else if (check.status === "healthy" && wasUnhealthy) {
        appendEvent({
          invocationId: null,
          type: "application_health_recovered",
          level: "info",
          message: `${app.name} source is reachable again. Review and bring it online when ready — health recovery never auto-onlines.`,
          data: { applicationId: app.id, status: app.status },
        });
      }
    }
  }

  return {
    applicationHealthSweep,
    findApplication,
    invokeApplicationCapability,
    listApplicationCapabilities,
    listApplications,
    planApplicationWrapperInvocation,
    probeApplication,
    registerApplication,
    setApplicationAutoRecovery,
    setApplicationHealthProbe,
    transitionApplication,
  };
}

// The platform-owned bridge agent that executes governed application npm-wrapper
// commands. A fixed cli agent (node application-wrapper.mjs) — the server injects
// the resolved, approved command via allowlisted metadata; the agent command
// itself is constant, so nothing arbitrary reaches the bridge's allowlist.
// Opt-in (registered like the ccusage agents), keeping the registry conservative.
export function createApplicationWrapperAgentRegistration({
  wrapperScriptPath = "tools/agents/application-wrapper.mjs",
  costOwner = "usr_local",
} = {}) {
  const scriptPath = String(wrapperScriptPath ?? "").trim();
  if (!scriptPath) throw new Error("application wrapper scriptPath is required.");
  return {
    id: "agt_platform_application_wrapper",
    type: "cli",
    name: "Application Wrapper Runner",
    description: "Platform bridge agent that runs governed, approved application npm-wrapper commands.",
    command: "node",
    args: [scriptPath],
    timeoutSeconds: 120,
    outputFormat: "plain_result",
    capabilityName: "application_wrapper_execution",
    capabilityDescription: "Executes an approved application npm-wrapper command resolved by the server.",
    riskLevel: "medium",
    riskTags: ["local_execution", "npm_wrapper", "application_asset"],
    economicModel: "free",
    pricingDimensions: [],
    costOwner,
    unknownCostPolicy: "warn",
    registrationNotes: {
      risk: "Runs only server-resolved, application-approved wrapper commands injected as discrete argv; no user text becomes a command.",
      data: "Reads the wrapper command's declared inputs and stores structured output in invocation events/results.",
      cost: "Free platform execution helper; wrapper cost semantics come from the application.",
      cancellation: "The Desktop Bridge attempts to terminate the wrapper process tree on cancellation.",
    },
  };
}

// Resolve the governed execution plan for an npm-wrapper capability (#359).
// Only a command registered on the application with status "approved" resolves;
// anything else returns null. This is the single source of truth for WHAT may
// execute — the bridge only ever runs a command that came through here, so an
// unapproved or unregistered command can never reach execution.
const WRAPPER_ARG_INPUT_TYPES = new Set(["date", "token", "enum", "string", "boolean-flag", "git-rev", "count"]);
const RESERVED_WRAPPER_ARG_INPUT_KEYS = new Set([
  "approvalToken",
  "idempotencyKey",
  "permissionLevel",
  "permissionMode",
  "applicationWrapper",
]);

// Normalize a wrapper command's declared per-invocation flag inputs. Each entry
// maps an input key to a `--flag` with a typed validator. Only these declared
// inputs can ever become args (see resolveWrapperInputArgs), keeping execution an
// allowlist even with per-invocation parameters.
function normalizeWrapperArgInputs(argInputs) {
  if (!Array.isArray(argInputs)) return [];
  return argInputs.slice(0, 20).map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`NPM wrapper argInput at index ${index} must be an object.`);
    }
    const key = String(entry.key ?? "").trim();
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key)) {
      throw new Error(`NPM wrapper argInput at index ${index} requires an alphanumeric key.`);
    }
    if (RESERVED_WRAPPER_ARG_INPUT_KEYS.has(key)) {
      throw new Error(`NPM wrapper argInput ${key} uses a reserved control-plane key.`);
    }
    // A positional input carries no --flag; it becomes an argv element on its own
    // (#777). Positional and flag are mutually exclusive.
    const positional = entry.positional === true;
    let flag = null;
    if (positional) {
      if (entry.flag) {
        throw new Error(`NPM wrapper argInput ${key} cannot be both positional and a --flag.`);
      }
    } else {
      flag = String(entry.flag ?? "").trim();
      if (!/^--[a-z0-9][a-z0-9-]*$/.test(flag)) {
        throw new Error(`NPM wrapper argInput ${key} requires a valid --flag.`);
      }
    }
    const type = WRAPPER_ARG_INPUT_TYPES.has(String(entry.type)) ? String(entry.type) : "token";
    return { key, flag, positional, type, values: type === "enum" ? normalizeStringList(entry.values) : [] };
  });
}

// Turn a caller's input into args, appending ONLY declared flags whose value
// passes its type validator. Undeclared keys are ignored; a value that looks like
// a flag (leading "-") is refused so it can never inject a new option.
function resolveWrapperInputArgs(argInputs, input) {
  if (!Array.isArray(argInputs) || !input || typeof input !== "object" || Array.isArray(input)) return [];
  const flagArgs = [];
  const positionalArgs = [];
  for (const spec of argInputs) {
    const raw = input[spec.key];
    if (raw === undefined || raw === null) continue;
    if (spec.type === "boolean-flag") {
      if (raw === true || raw === "true") flagArgs.push(spec.flag);
      continue;
    }
    const value = String(raw).trim();
    if (!value || value.startsWith("-")) continue;
    if (!isValidWrapperArgValue(spec, value)) continue;
    if (spec.positional) {
      positionalArgs.push(value);
    } else {
      flagArgs.push(spec.flag, value);
    }
  }
  // Positionals are appended AFTER all flags, in declaration order (#777).
  return [...flagArgs, ...positionalArgs];
}

function isValidWrapperArgValue(spec, value) {
  switch (spec.type) {
    case "date": return /^\d{4}-\d{2}-\d{2}$/.test(value);
    case "token": return /^[A-Za-z0-9_+/:.][A-Za-z0-9_+/:.-]{0,63}$/.test(value);
    case "enum": return spec.values.includes(value);
    case "string": return value.length <= 200 && !/[\r\n]/.test(value);
    // A git revision as a positional arg. Closed char class, no leading "-"
    // (already enforced above), and NO ".." until ranges are explicitly designed.
    case "git-rev": return /^[A-Za-z0-9._/-]{1,100}$/.test(value) && !value.includes("..");
    // A small positive integer (e.g. git --max-count). Bounded to 1–1000 to MIRROR
    // the device allowlist's isMaxCount (#867): a `token` value like "2000" the
    // server accepted was then hard-refused by the stricter device, so a value the
    // server itself approved failed the run. The two validators stay independent
    // copies — this narrows the server to the device's real bound, not the reverse.
    case "count": return /^\d{1,4}$/.test(value) && Number(value) >= 1 && Number(value) <= 1000;
    default: return false;
  }
}

export function applicationWrapperExecutionPlan(application, commandId, input = {}) {
  const command = findNpmWrapperCommand(application, commandId);
  if (!command) return null;
  return {
    capability: `app.${slugify(application.id || application.name)}.wrapper.${command.id}`,
    commandId: command.id,
    commandType: command.commandType,
    command: command.command,
    // Base args + only the declared, validated per-invocation flag inputs.
    args: [...command.args, ...resolveWrapperInputArgs(command.argInputs, input)],
    // "invocation_root" emits cwd:null so the bridge's worktreePath → projectPath
    // fallback resolves it to the invocation's repository (#773). "fixed" keeps
    // ccusage's behavior byte-for-byte.
    cwd: command.cwdPolicy === "invocation_root" ? null : (command.cwd ?? "."),
    cwdPolicy: command.cwdPolicy ?? "fixed",
    timeoutSeconds: command.timeoutSeconds,
    cancellation: command.cancellation,
    envPolicy: command.envPolicy,
    filePolicy: command.filePolicy,
    networkPolicy: command.networkPolicy,
    compatibilityFacade: command.compatibilityFacade,
    outputCollection: command.outputCollection,
    billing: command.billing,
    resultImport: command.resultImport,
  };
}

export function projectApplicationCapabilities(app) {
  const prefix = `app.${slugify(app.id || app.name)}`;
  const disabled = app.status === "offline" || app.status === "archived";
  return [
    managedCapability(app, `${prefix}.inspect`, "Inspect application", "read", "low", ["read_only", "application_asset"], false, disabled, emptyInputSchema()),
    managedCapability(app, `${prefix}.search`, "Search application", "read", "low", ["read_only", "application_asset"], false, disabled, {
      type: "object",
      additionalProperties: false,
      properties: { query: { type: "string", maxLength: 200 } },
    }),
    managedCapability(app, `${prefix}.refresh`, "Refresh application source", "lifecycle", "medium", ["network_access", "lifecycle"], true, disabled, approvalInputSchema()),
    managedCapability(app, `${prefix}.online`, "Bring application online", "lifecycle", "medium", ["lifecycle", "write_control"], true, app.status === "archived" || app.status === "active", approvalInputSchema()),
    managedCapability(app, `${prefix}.offline`, "Take application offline", "lifecycle", "high", ["lifecycle", "write_control"], true, app.status === "archived", approvalInputSchema()),
    managedCapability(app, `${prefix}.archive`, "Archive application", "lifecycle", "high", ["lifecycle", "write_control"], true, app.status === "archived", approvalInputSchema()),
    managedCapability(app, `${prefix}.generate_orchestration`, "Generate application orchestration", "orchestration", "medium", ["generated_artifact", "orchestration"], true, disabled, emptyInputSchema()),
    ...projectWrapperCapabilities(app, prefix, disabled),
  ];
}

function managedCapability(app, name, displayName, kind, riskLevel, riskTags, requiresApproval, disabled, inputSchema, metadata = {}) {
  const outputCollection = metadata.outputCollection ?? "invocations";
  return {
    name,
    version: "1",
    displayName,
    description: `${displayName} for ${app.name}.`,
    provider: {
      type: "application",
      id: app.id,
    },
    kind,
    source: "managed",
    riskLevel,
    riskTags,
    requiresApproval,
    invocationMode: "gateway",
    status: disabled ? "disabled" : "available",
    inputSchema,
    outputSchema: { structuredResult: true, provider: "application" },
    metadata: {
      readiness: capabilityReadiness(app, { disabled, kind, metadata }),
      resultPath: {
        outputCollection,
        resultImport: metadata.resultImport ?? null,
        evidenceCenter: outputCollection !== "invocations",
      },
      ...metadata,
    },
  };
}

function projectWrapperCapabilities(app, prefix, disabled) {
  // A wrapper descriptor is reachable from any source that installs one — not
  // only npm (#774). Binary sources (git) project kind `binary_wrapper`; npm
  // keeps kind `npm_wrapper` and its risk tag byte-identical.
  if (app.source?.wrapper?.mode !== "installed-wrapper") return [];
  const isBinary = app.source?.type === "binary";
  const wrapperKind = isBinary ? "binary_wrapper" : "npm_wrapper";
  return (app.source.wrapper.commands ?? [])
    .filter((command) => command.status === "approved")
    .map((command) => managedCapability(
      app,
      `${prefix}.wrapper.${command.id}`,
      command.displayName,
      wrapperKind,
      command.riskLevel,
      [...new Set(["local_execution", wrapperKind, ...command.riskTags])],
      command.requiresApproval,
      disabled,
      wrapperInputSchema(command),
      {
        wrapper: {
          mode: app.source.wrapper.mode,
          installState: app.source.wrapper.installState,
          commandId: command.id,
          commandType: command.commandType,
          timeoutSeconds: command.timeoutSeconds,
          cancellation: command.cancellation,
          envPolicy: command.envPolicy,
          filePolicy: command.filePolicy,
          networkPolicy: command.networkPolicy,
          // A caller cannot decide whether it must name a repository unless the
          // contract says so (#800). This is a property of the capability, not an
          // argv detail — the flag/argv the inputs become stays server-side.
          cwdPolicy: command.cwdPolicy,
        },
        compatibilityFacade: command.compatibilityFacade,
        execution: {
          mode: "bridge_wrapper",
          agentId: "agt_platform_application_wrapper",
        },
        outputCollection: command.outputCollection,
        billing: command.billing,
        resultImport: command.resultImport,
      },
    ));
}

function capabilityReadiness(app, { disabled, kind, metadata }) {
  if (disabled) {
    return {
      state: "disabled",
      reason: app.status === "archived" ? "application_archived" : "application_offline",
      applicationStatus: app.status,
    };
  }
  if (kind === "npm_wrapper") {
    const installState = metadata?.wrapper?.installState ?? app.source?.wrapper?.installState ?? "unknown";
    return {
      state: installState === "installed" ? "ready" : "needs_setup",
      reason: installState === "installed" ? "wrapper_installed" : "wrapper_not_confirmed_installed",
      applicationStatus: app.status,
      installState,
      executionMode: "bridge_wrapper",
    };
  }
  if (kind === "binary_wrapper") {
    // A system binary has no install step; the bridge allowlist is the real gate.
    return {
      state: "ready",
      reason: "system_binary",
      applicationStatus: app.status,
      executionMode: "bridge_wrapper",
    };
  }
  return {
    state: "ready",
    reason: "application_control_available",
    applicationStatus: app.status,
    executionMode: "application_control",
  };
}

function emptyInputSchema() {
  return { type: "object", additionalProperties: false, properties: {} };
}

// Project a wrapper command's declared inputs into its PUBLIC contract (#800).
//
// A caller has to know that `log` takes a `since` and what shape it must be —
// otherwise the only way to build a run form is to hardcode one screen per
// application, which is the thing this registry exists to avoid.
//
// What it publishes is the input KEY and its TYPE. What it withholds is the
// `--flag` each key becomes, and the argv it lands in: the descriptor rule is
// that discovery never exposes local commands, wrapper paths, or argv. A caller
// sends `{ since: "2026-01-01" }`; the server alone decides that this means
// `--since 2026-01-01`, and only if it validates.
//
// An explicitly declared inputSchema always wins — this only derives one for a
// command that declared inputs but no schema.
function wrapperInputSchema(command) {
  const declared = command.inputSchema;
  if (Object.keys(declared?.properties ?? {}).length > 0) return declared;
  if (!Array.isArray(command.argInputs) || command.argInputs.length === 0) return declared ?? emptyInputSchema();
  return {
    type: "object",
    additionalProperties: false,
    properties: Object.fromEntries(command.argInputs.map((input) => [
      input.key,
      {
        type: input.type,
        ...(input.values?.length ? { enum: input.values } : {}),
      },
    ])),
  };
}

function approvalInputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["approvalToken"],
    properties: {
      approvalToken: { type: "string", minLength: 1, maxLength: 200 },
    },
  };
}

function applicationForCapability(capabilityName, applications, applicationId = null) {
  const candidates = applicationId
    ? applications.filter((application) => application.id === applicationId)
    : applications;
  return candidates.find((application) =>
    projectApplicationCapabilities(application).some((capability) => capability.name === capabilityName),
  ) ?? null;
}

function actionFromCapabilityName(capabilityName) {
  const wrapperAction = wrapperActionFromCapabilityName(capabilityName);
  if (wrapperAction) return wrapperAction;
  const suffix = String(capabilityName ?? "").split(".").at(-1);
  return ["inspect", "search", "refresh", "online", "offline", "archive", "generate_orchestration"].includes(suffix) ? suffix : null;
}

function wrapperActionFromCapabilityName(capabilityName) {
  const match = String(capabilityName ?? "").match(/\.wrapper\.([a-z0-9._-]+)$/);
  return match ? `wrapper:${match[1]}` : null;
}

function executeApplicationAction({ application, action, input, actor, defaultProjectPath, now = () => new Date().toISOString() }) {
  const executedAt = now();
  if (action === "inspect") {
    return {
      summary: `${application.name} application inspected.`,
      output: {
        source: "application",
        action,
        application: publicApplicationSnapshot(application),
      },
    };
  }
  if (action === "search") {
    const query = String(input?.query ?? "").trim().toLowerCase();
    const haystack = JSON.stringify({
      id: application.id,
      name: application.name,
      kind: application.kind,
      source: application.source,
      status: application.status,
      path: application.path,
    }).toLowerCase();
    return {
      summary: query ? `${application.name} metadata search completed.` : `${application.name} metadata returned without query.`,
      output: {
        source: "application",
        action,
        query,
        matches: query && haystack.includes(query) ? [publicApplicationSnapshot(application)] : [],
      },
    };
  }
  if (action === "offline") {
    application.status = "offline";
    application.lifecycle = {
      ...application.lifecycle,
      state: "offline",
      lastOperation: "offline",
      lastOperationAt: executedAt,
      lastActorId: actor?.userId ?? null,
    };
    application.updatedAt = executedAt;
    return {
      summary: `${application.name} application is offline.`,
      output: { source: "application", action, applicationId: application.id, status: application.status },
    };
  }
  if (action === "online") {
    application.status = "active";
    application.lifecycle = {
      ...application.lifecycle,
      state: "active",
      lastOperation: "online",
      lastOperationAt: executedAt,
      lastActorId: actor?.userId ?? null,
    };
    application.updatedAt = executedAt;
    return {
      summary: `${application.name} application is online.`,
      output: { source: "application", action, applicationId: application.id, status: application.status },
    };
  }
  if (action === "archive") {
    application.status = "archived";
    application.lifecycle = {
      ...application.lifecycle,
      state: "archived",
      lastOperation: "archive",
      lastOperationAt: executedAt,
      lastActorId: actor?.userId ?? null,
    };
    application.updatedAt = executedAt;
    return {
      summary: `${application.name} application is archived.`,
      output: { source: "application", action, applicationId: application.id, status: application.status },
    };
  }
  if (action === "refresh") {
    application.lifecycle = {
      ...application.lifecycle,
      lastOperation: "refresh",
      lastOperationAt: executedAt,
      lastActorId: actor?.userId ?? null,
    };
    application.updatedAt = executedAt;
    return {
      summary: `${application.name} application refresh recorded.`,
      output: { source: "application", action, applicationId: application.id, status: application.status },
    };
  }
  if (action === "generate_orchestration") {
    const draft = writeApplicationRoutineDraft(application, defaultProjectPath, { now });
    if (!draft.ok) {
      return {
        ok: false,
        status: 422,
        body: {
          error: "invalid_application_routine",
          message: "Generated application routine draft failed validation and was not written.",
          applicationId: application.id,
          validation: draft.validation,
          orchestration: {
            id: draft.routineId,
            kind: "LoopRoutineDraft",
            status: "invalid",
            path: draft.path,
            relativePath: draft.relativePath,
          },
        },
      };
    }
    application.orchestrationIds = [...new Set([...(application.orchestrationIds ?? []), draft.routineId])];
    application.orchestrations = upsertOrchestration(application.orchestrations, draft);
    application.lifecycle = {
      ...application.lifecycle,
      lastOperation: "generate_orchestration",
      lastOperationAt: executedAt,
      lastActorId: actor?.userId ?? null,
    };
    application.updatedAt = executedAt;
    return {
      summary: `${application.name} application orchestration draft generated.`,
      output: {
        source: "application",
        action,
        applicationId: application.id,
        orchestration: {
          id: draft.routineId,
          kind: "LoopRoutineDraft",
          status: "draft",
          path: draft.path,
          relativePath: draft.relativePath,
          validation: draft.validation,
        },
      },
    };
  }
  if (action.startsWith("wrapper:")) {
    const commandId = action.slice("wrapper:".length);
    const wrapperCommand = findNpmWrapperCommand(application, commandId);
    if (!wrapperCommand) {
      return {
        summary: `${application.name} wrapper command ${commandId} is not registered.`,
        output: {
          source: "application",
          action,
          applicationId: application.id,
          error: "wrapper_command_not_found",
        },
      };
    }
    return {
      summary: `${application.name} wrapper command ${commandId} planned through governance.`,
      output: {
        source: "application",
        action,
        applicationId: application.id,
        wrapper: publicNpmWrapperSnapshot(application.source.wrapper),
        command: {
          id: wrapperCommand.id,
          commandType: wrapperCommand.commandType,
          command: wrapperCommand.command,
          args: wrapperCommand.args,
          cwd: wrapperCommand.cwd,
          timeoutSeconds: wrapperCommand.timeoutSeconds,
          cancellation: wrapperCommand.cancellation,
          envPolicy: wrapperCommand.envPolicy,
          filePolicy: wrapperCommand.filePolicy,
          networkPolicy: wrapperCommand.networkPolicy,
        },
        invocationPlan: {
          executable: false,
          reason: "Wrapper descriptor is registered and governed; execution adapter wiring is reserved for the next runtime slice.",
        },
      },
    };
  }
  return {
    summary: `${application.name} application action ${action} completed.`,
    output: { source: "application", action, applicationId: application.id },
  };
}

export function writeApplicationRoutineDraft(application, defaultProjectPath, options = {}) {
  const now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  // Write into a platform-managed, per-application directory keyed by the unique
  // application id — never the application's own (attacker-registrable) path and
  // never the server repo root. This confines the write and avoids same-name
  // collisions across applications.
  const applicationSegment = slugify(application.id);
  const managedRoot = resolve(defaultProjectPath || process.cwd(), ".myagenttool", "applications", applicationSegment);
  const routinesDir = resolve(managedRoot, "routines");
  const routineId = options.routineId ?? `app-${applicationSegment}-maintenance`;
  const path = resolve(routinesDir, `${routineId}.json`);
  // Defense-in-depth: the resolved target must stay inside the managed root.
  if (path !== managedRoot && !path.startsWith(managedRoot + sep)) {
    throw new Error("Refusing to write an application routine draft outside its managed directory.");
  }
  const relativePath = join(".myagenttool", "applications", applicationSegment, "routines", `${routineId}.json`).replaceAll("\\", "/");
  const routine = options.routine ?? buildApplicationRoutineSpec(application, routineId);
  const validation = validateApplicationRoutineDraft(routine, { root: managedRoot, application });
  const draft = {
    routineId,
    path,
    relativePath,
    status: validation.ok ? "draft" : "invalid",
    generatedAt: now(),
    validation,
    ok: validation.ok,
  };
  if (!validation.ok) {
    return draft;
  }
  mkdirSync(routinesDir, { recursive: true });
  writeFileSync(path, `${JSON.stringify(routine, null, 2)}\n`, "utf8");
  return draft;
}

export function buildApplicationRoutineSpec(application, routineId) {
  const sourceLabel = application.source?.type ?? "application";
  const sourceCapabilities = projectApplicationCapabilities(application);
  const inputs = [
    {
      id: "application-files",
      type: "filesystem.glob",
      pattern: "**/*.{md,json,yaml,yml,js,ts,tsx,jsx,css,html}",
      limit: 100,
    },
  ];
  if (application.source?.type === "git" || application.kind === "repository") {
    inputs.unshift({
      id: "recent-commits",
      type: "git.commits",
      ref: "HEAD",
      since: "24 hours ago",
      limit: 20,
    });
  }
  return {
    apiVersion: "myagenttool.dev/v1",
    kind: "LoopRoutine",
    metadata: {
      id: routineId,
      name: `${application.name} Maintenance`,
      description: `Generated maintenance routine for ${application.name} (${sourceLabel}).`,
      owner: application.ownerTeamId ?? "engineering",
      enabled: true,
      sourceApplicationId: application.id,
      sourceApplicationName: application.name,
      sourceApplicationKind: application.kind ?? null,
      sourceApplicationSourceType: sourceLabel,
      sourceCapabilityNames: sourceCapabilities.map((capability) => capability.name),
      riskLevel: highestCapabilityRiskLevel(sourceCapabilities),
      approvalRequirements: APPLICATION_ROUTINE_REQUIRED_APPROVALS,
    },
    schedule: {
      mode: "manual",
      timezone: "Asia/Shanghai",
      cron: null,
      maxConcurrency: 1,
      cooldownMs: 3600000,
      deadlineMs: 1800000,
    },
    inputs,
    skills: [],
    goal: {
      summary: `Inspect ${application.name}, identify actionable maintenance findings, and propose safe next steps.`,
      successCriteria: [
        "Routine writes an application maintenance summary.",
        "Findings include evidence and proposed next action.",
        "No remote state is changed without explicit approval.",
      ],
      fanout: {
        enabled: true,
        mode: "one-run-per-finding",
        priority: "normal",
        apply: false,
        verify: true,
        isolateWorktree: true,
      },
    },
    checks: [
      {
        id: "registry",
        type: "command",
        command: "ai:loop-registry-check",
        required: true,
      },
    ],
    outputs: {
      summary: `.myagenttool/state/${routineId}.md`,
      findings: `.myagenttool/state/${routineId}-findings.json`,
      enqueueFindings: false,
    },
    safety: {
      remoteWrites: "forbidden",
      githubWrites: "forbidden",
      requiresApprovalFor: ["apply", "push", "pr-create", "pr-merge"],
      commandAllowlist: ["ai:loop-registry-check", "ai:check", "docs:check", "typecheck", "test"],
    },
  };
}

export function validateApplicationRoutineDraft(routine, { root = process.cwd(), application = null } = {}) {
  const normalizedRoutine = normalizeLoopRoutine(routine, { sourceRoot: root });
  const baseValidation = validateLoopRoutine(normalizedRoutine, root);
  const errors = [...baseValidation.errors];
  const warnings = [...baseValidation.warnings];
  const metadata = routine && typeof routine === "object" && !Array.isArray(routine) ? routine.metadata ?? {} : {};
  const sourceCapabilityNames = Array.isArray(metadata.sourceCapabilityNames)
    ? metadata.sourceCapabilityNames.map(String).map((item) => item.trim()).filter(Boolean)
    : [];
  const approvalRequirements = Array.isArray(metadata.approvalRequirements)
    ? metadata.approvalRequirements.map(String).map((item) => item.trim()).filter(Boolean)
    : [];

  if (normalizedRoutine.safety.remoteWrites !== "forbidden") {
    errors.push("Application routine safety.remoteWrites must remain forbidden.");
  }
  if (normalizedRoutine.safety.githubWrites !== "forbidden") {
    errors.push("Application routine safety.githubWrites must remain forbidden.");
  }
  if (normalizedRoutine.goal.fanout.apply !== false) {
    errors.push("Application routine goal.fanout.apply must remain false.");
  }
  for (const required of APPLICATION_ROUTINE_REQUIRED_APPROVALS) {
    if (!normalizedRoutine.safety.requiresApprovalFor.includes(required)) {
      errors.push(`Application routine safety.requiresApprovalFor must include ${required}.`);
    }
    if (!approvalRequirements.includes(required)) {
      errors.push(`Application routine metadata.approvalRequirements must include ${required}.`);
    }
  }
  if (!metadata.sourceApplicationId) {
    errors.push("Application routine metadata.sourceApplicationId is required.");
  }
  if (application?.id && metadata.sourceApplicationId !== application.id) {
    errors.push(`Application routine metadata.sourceApplicationId must match ${application.id}.`);
  }
  if (sourceCapabilityNames.length === 0) {
    errors.push("Application routine metadata.sourceCapabilityNames must include at least one capability.");
  }
  if (!APPLICATION_ROUTINE_RISK_LEVELS.includes(metadata.riskLevel)) {
    errors.push(`Application routine metadata.riskLevel must be one of: ${APPLICATION_ROUTINE_RISK_LEVELS.join(", ")}.`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    routineId: normalizedRoutine.metadata.id,
    policy: {
      remoteWrites: "forbidden",
      githubWrites: "forbidden",
      fanoutApply: false,
      requiresApprovalFor: APPLICATION_ROUTINE_REQUIRED_APPROVALS,
    },
  };
}

function upsertOrchestration(orchestrations = [], draft) {
  const existing = Array.isArray(orchestrations) ? orchestrations.filter((item) => item?.routineId !== draft.routineId) : [];
  return [draft, ...existing];
}

function publicApplicationSnapshot(application) {
  return {
    id: application.id,
    name: application.name,
    kind: application.kind,
    source: application.source,
    status: application.status,
    projectId: application.projectId,
    path: application.path,
    wrapper: application.source?.wrapper ? publicNpmWrapperSnapshot(application.source.wrapper) : null,
    orchestrationIds: application.orchestrationIds ?? [],
  };
}

function highestCapabilityRiskLevel(capabilities) {
  const levels = new Map(APPLICATION_ROUTINE_RISK_LEVELS.map((level, index) => [level, index]));
  let highest = "low";
  for (const capability of capabilities ?? []) {
    const level = normalizeRiskLevel(capability?.riskLevel, "medium");
    if (levels.get(level) > levels.get(highest)) highest = level;
  }
  return highest;
}

function buildApplicationProbe(application) {
  const warnings = [];
  const managed = projectApplicationCapabilities(application).map(probeCapabilityFromManaged);
  const declared = declaredProbeCapabilities(application, warnings);
  const metadata = readApplicationMetadata(application, warnings);
  const inferred = inferProbeCapabilities(application, metadata, warnings);
  const capabilities = dedupeProbeCapabilities([...managed, ...declared, ...inferred]);
  return {
    summary: probeSummary(application, { declaredCount: declared.length, inferredCount: inferred.length }),
    source: {
      type: application.source?.type ?? "unknown",
      path: application.path ?? null,
      package: application.source?.package ?? metadata.package?.name ?? null,
      version: application.source?.version ?? metadata.package?.version ?? null,
      repository: metadata.package?.repository ?? application.source?.repository ?? null,
      wrapper: application.source?.wrapper ? publicNpmWrapperSnapshot(application.source.wrapper) : null,
    },
    package: metadata.package,
    readme: metadata.readme,
    capabilities,
    warnings,
  };
}

function probeCapabilityFromManaged(capability) {
  return {
    name: capability.name,
    displayName: capability.displayName,
    description: capability.description,
    source: "managed",
    kind: capability.kind,
    status: capability.status,
    riskLevel: capability.riskLevel,
    riskTags: capability.riskTags,
    requiresApproval: capability.requiresApproval,
    invocationMode: capability.invocationMode,
    inputSchema: capability.inputSchema,
    metadata: {
      provider: capability.provider,
      version: capability.version,
    },
  };
}

function findNpmWrapperCommand(application, commandId) {
  // Any source that installs a wrapper can resolve its approved commands — not
  // only npm (#774). The bridge allowlist remains the independent execution gate.
  if (!application.source?.wrapper) return null;
  return (application.source.wrapper.commands ?? []).find((command) => command.id === commandId && command.status === "approved") ?? null;
}

function publicNpmWrapperSnapshot(wrapper) {
  if (!wrapper) return null;
  return {
    mode: wrapper.mode,
    installState: wrapper.installState,
    packageManager: wrapper.packageManager,
    commands: (wrapper.commands ?? []).map((command) => ({
      id: command.id,
      displayName: command.displayName,
      commandType: command.commandType,
      status: command.status,
      riskLevel: command.riskLevel,
      riskTags: command.riskTags,
      requiresApproval: command.requiresApproval,
      timeoutSeconds: command.timeoutSeconds,
      cancellation: command.cancellation,
      envPolicy: command.envPolicy,
      filePolicy: command.filePolicy,
      networkPolicy: command.networkPolicy,
      compatibilityFacade: command.compatibilityFacade,
      outputCollection: command.outputCollection,
      billing: command.billing,
      resultImport: command.resultImport,
    })),
  };
}

function declaredProbeCapabilities(application, warnings) {
  const manifest = application.source?.manifest && typeof application.source.manifest === "object"
    ? application.source.manifest
    : null;
  const declared = Array.isArray(manifest?.capabilities) ? manifest.capabilities : [];
  const prefix = `app.${slugify(application.id || application.name)}.declared`;
  return declared
    .map((capability, index) => {
      if (!capability || typeof capability !== "object") {
        warnings.push(`Ignored declared capability at index ${index}: expected object.`);
        return null;
      }
      const id = slugify(capability.id ?? capability.name ?? `capability-${index + 1}`);
      if (!id) {
        warnings.push(`Ignored declared capability at index ${index}: missing id or name.`);
        return null;
      }
      return {
        name: `${prefix}.${id}`,
        displayName: stringOrNull(capability.displayName ?? capability.name) ?? `Declared ${id}`,
        description: stringOrNull(capability.description) ?? `Declared application capability ${id}.`,
        source: "declared",
        kind: stringOrNull(capability.kind) ?? "declared",
        status: "candidate",
        riskLevel: normalizeRiskLevel(capability.riskLevel, "medium"),
        riskTags: normalizeStringList(capability.riskTags ?? capability.tags),
        requiresApproval: Boolean(capability.requiresApproval),
        invocationMode: "not_invokable",
        inputSchema: capability.inputSchema && typeof capability.inputSchema === "object"
          ? capability.inputSchema
          : emptyInputSchema(),
        metadata: publicJsonObject(capability.metadata),
      };
    })
    .filter(Boolean);
}

function readApplicationMetadata(application, warnings) {
  if (application.source?.type === "npm") {
    const packageJson = packageJsonFromSourceManifest(application.source);
    return {
      package: summarizePackageJson(packageJson, application.source),
      readme: readmeFromSourceManifest(application.source),
    };
  }
  if (!["git", "local"].includes(application.source?.type) && application.kind !== "repository") {
    return { package: null, readme: null };
  }
  const root = application.path ? resolve(application.path) : null;
  if (!root || !existsSync(root)) {
    warnings.push("Registered application path is not readable; filesystem metadata probe skipped.");
    return { package: null, readme: null };
  }
  return {
    package: readPackageJson(root, warnings),
    readme: readReadmeSummary(root, warnings),
  };
}

function packageJsonFromSourceManifest(source) {
  const manifest = source?.manifest && typeof source.manifest === "object" ? source.manifest : null;
  const packageJson = source?.packageJson && typeof source.packageJson === "object"
    ? source.packageJson
    : manifest?.packageJson && typeof manifest.packageJson === "object"
      ? manifest.packageJson
      : manifest;
  if (!packageJson || typeof packageJson !== "object" || Array.isArray(packageJson)) {
    return {
      name: source?.package,
      version: source?.version,
    };
  }
  return {
    ...packageJson,
    name: packageJson.name ?? source?.package,
    version: packageJson.version ?? source?.version,
  };
}

function readmeFromSourceManifest(source) {
  const manifest = source?.manifest && typeof source.manifest === "object" ? source.manifest : null;
  const text = stringOrNull(source?.readme ?? manifest?.readme ?? manifest?.readmeText);
  return text ? summarizeReadmeText(text) : null;
}

function readPackageJson(root, warnings) {
  const path = resolve(root, "package.json");
  if (!isPathInside(root, path) || !existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return summarizePackageJson(parsed);
  } catch (error) {
    warnings.push(`Could not parse package.json: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function readReadmeSummary(root, warnings) {
  const candidates = ["README.md", "README.mdx", "README.txt", "readme.md", "readme.txt"];
  for (const name of candidates) {
    const path = resolve(root, name);
    if (!isPathInside(root, path) || !existsSync(path)) continue;
    try {
      return summarizeReadmeText(readFileSync(path, "utf8"), name);
    } catch (error) {
      warnings.push(`Could not read ${name}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
  return null;
}

function summarizePackageJson(packageJson, source = null) {
  if (!packageJson || typeof packageJson !== "object" || Array.isArray(packageJson)) return null;
  const scripts = objectWithStringValues(packageJson.scripts);
  const bin = normalizeBin(packageJson.bin, packageJson.name ?? source?.package);
  const exportsValue = summarizeExports(packageJson.exports);
  return {
    name: stringOrNull(packageJson.name) ?? stringOrNull(source?.package),
    version: stringOrNull(packageJson.version) ?? stringOrNull(source?.version),
    description: stringOrNull(packageJson.description),
    type: stringOrNull(packageJson.type),
    main: stringOrNull(packageJson.main),
    module: stringOrNull(packageJson.module),
    repository: normalizeRepository(packageJson.repository),
    bin,
    scripts,
    exports: exportsValue,
  };
}

function summarizeReadmeText(text, file = null) {
  const normalized = String(text ?? "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("<!--"))
    .slice(0, 12);
  const heading = normalized.find((line) => /^#\s+/.test(line))?.replace(/^#+\s*/, "") ?? null;
  const summary = normalized.find((line) => !/^#/.test(line)) ?? heading;
  return {
    file,
    heading,
    summary: summary ? summary.slice(0, 300) : null,
  };
}

function inferProbeCapabilities(application, metadata, warnings) {
  const packageJson = metadata.package;
  if (!packageJson) {
    if (application.source?.type === "npm") {
      warnings.push("NPM metadata probe had no package manifest fields to inspect.");
    }
    return [];
  }
  const prefix = `app.${slugify(application.id || application.name)}.inferred`;
  const capabilities = [];
  for (const [binName, target] of Object.entries(packageJson.bin ?? {})) {
    capabilities.push(candidateProbeCapability({
      name: `${prefix}.bin.${slugify(binName)}`,
      displayName: `CLI bin ${binName}`,
      description: `Inferred CLI entrypoint ${binName} from package metadata.`,
      kind: "cli_bin",
      riskLevel: "medium",
      riskTags: ["local_execution", "requires_wrapper"],
      metadata: { bin: binName, target },
    }));
  }
  for (const [scriptName, command] of Object.entries(packageJson.scripts ?? {})) {
    if (!isInterestingPackageScript(scriptName)) continue;
    capabilities.push(candidateProbeCapability({
      name: `${prefix}.script.${slugify(scriptName)}`,
      displayName: `NPM script ${scriptName}`,
      description: `Inferred npm script ${scriptName}; wrapper approval is required before invocation.`,
      kind: "npm_script",
      riskLevel: scriptRiskLevel(scriptName),
      riskTags: ["local_execution", "requires_wrapper"],
      metadata: { script: scriptName, command },
    }));
  }
  if (packageJson.exports && Object.keys(packageJson.exports).length > 0) {
    capabilities.push(candidateProbeCapability({
      name: `${prefix}.module.exports`,
      displayName: "Module exports",
      description: "Package exports were detected for module integration review.",
      kind: "module_exports",
      riskLevel: "low",
      riskTags: ["read_only", "requires_wrapper"],
      metadata: { exports: packageJson.exports },
    }));
  }
  if (metadata.readme?.summary) {
    capabilities.push(candidateProbeCapability({
      name: `${prefix}.docs.readme`,
      displayName: "README summary",
      description: "README documentation was detected for application inspection.",
      kind: "documentation",
      riskLevel: "low",
      riskTags: ["read_only"],
      metadata: { readme: metadata.readme },
    }));
  }
  return capabilities;
}

function candidateProbeCapability({ name, displayName, description, kind, riskLevel, riskTags, metadata }) {
  return {
    name,
    displayName,
    description,
    source: "inferred",
    kind,
    status: "candidate",
    riskLevel,
    riskTags,
    requiresApproval: true,
    invocationMode: "not_invokable",
    inputSchema: emptyInputSchema(),
    metadata,
  };
}

function dedupeProbeCapabilities(capabilities) {
  const seen = new Set();
  return capabilities.filter((capability) => {
    if (!capability?.name || seen.has(capability.name)) return false;
    seen.add(capability.name);
    return true;
  });
}

function normalizeBin(bin, packageName) {
  if (typeof bin === "string") {
    const name = String(packageName ?? "cli").split("/").at(-1) || "cli";
    return { [name]: bin };
  }
  return objectWithStringValues(bin);
}

function summarizeExports(exportsValue) {
  if (!exportsValue) return null;
  if (typeof exportsValue === "string") return { ".": exportsValue };
  if (typeof exportsValue !== "object" || Array.isArray(exportsValue)) return null;
  const summarized = {};
  for (const [key, value] of Object.entries(exportsValue).slice(0, 20)) {
    if (typeof value === "string") summarized[key] = value;
    else if (value && typeof value === "object") summarized[key] = Object.keys(value).slice(0, 10);
  }
  return summarized;
}

function normalizeRepository(repository) {
  if (!repository) return null;
  if (typeof repository === "string") return repository;
  if (typeof repository === "object" && !Array.isArray(repository)) {
    return stringOrNull(repository.url) ?? null;
  }
  return null;
}

function objectWithStringValues(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => typeof entry === "string")
      .slice(0, 50),
  );
}

function isInterestingPackageScript(name) {
  return /^(start|dev|serve|build|test|lint|check|typecheck|preview|docs?|smoke|validate)$/i.test(String(name ?? ""));
}

function scriptRiskLevel(name) {
  return /^(test|lint|check|typecheck|docs?|validate)$/i.test(String(name ?? "")) ? "low" : "medium";
}

function normalizeRiskLevel(value, fallback) {
  const text = String(value ?? "").trim().toLowerCase();
  return ["low", "medium", "high", "critical"].includes(text) ? text : fallback;
}

function normalizeStringList(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, 20)
    : [];
}

function publicJsonObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function sourceFromLegacyBody(body) {
  if (body.repoUrl || body.gitUrl || body.repo) {
    return { type: "git", url: body.repoUrl ?? body.gitUrl ?? body.repo };
  }
  if (body.path || body.localPath) {
    return { type: "local", path: body.path ?? body.localPath };
  }
  if (body.package || body.packageName) {
    return { type: "npm", package: body.package ?? body.packageName, version: body.version };
  }
  return body;
}

function normalizeApplicationSource(source = {}) {
  const type = String(source.type ?? "").trim().toLowerCase();
  if (!APPLICATION_SOURCE_TYPES.has(type)) {
    throw new Error("Application source type must be git, local, npm, binary, or manual.");
  }
  if (type === "git") {
    const url = normalizeGitUrl(source.url ?? source.repoUrl ?? source.gitUrl);
    return { type, url, ref: stringOrNull(source.ref) };
  }
  if (type === "local") {
    const rawPath = String(source.path ?? "").trim();
    if (!rawPath) {
      throw new Error("Local application path is required.");
    }
    const path = resolve(rawPath);
    if (!existsSync(path)) {
      throw new Error(`Local application path does not exist: ${path}`);
    }
    return { type, path };
  }
  if (type === "npm") {
    const packageName = String(source.package ?? source.packageName ?? "").trim();
    if (!packageName) throw new Error("NPM application package is required.");
    return {
      type,
      package: packageName,
      version: stringOrNull(source.version) ?? "latest",
      manifest: publicJsonObject(source.manifest),
      packageJson: publicJsonObject(source.packageJson),
      readme: stringOrNull(source.readme),
      wrapper: normalizeWrapperDescriptor(source.wrapper, { npm: true }),
    };
  }
  if (type === "binary") {
    // A system binary that operates on whichever repository the invocation is
    // scoped to (git). A bare program name only — no path separators, no absolute
    // paths; the bridge allowlist decides what may actually spawn.
    const binary = String(source.binary ?? source.command ?? "").trim();
    if (!BINARY_SOURCE_NAME.test(binary)) {
      throw new Error("Binary application source must be a bare program name (no path separators or absolute paths).");
    }
    return { type, binary, wrapper: normalizeWrapperDescriptor(source.wrapper, { npm: false }) };
  }
  return {
    type: "manual",
    uri: stringOrNull(source.uri),
    manifest: source.manifest && typeof source.manifest === "object" && !Array.isArray(source.manifest)
      ? source.manifest
      : {},
  };
}

function normalizeGitUrl(value) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error("Git application source url is required.");
  if (/^https?:\/\//i.test(text) || /^git@/i.test(text)) return text;
  const normalized = text.replace(/^github\.com\//i, "").replace(/^\/+/, "");
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(normalized)) {
    return `https://github.com/${normalized}`;
  }
  throw new Error("Git application source must be a full Git URL or owner/repo path.");
}

function normalizeApplicationName(value) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error("Application name is required.");
  return text;
}

function nameFromSource(source) {
  if (source.type === "git") {
    return basename(source.url.replace(/\.git$/i, ""));
  }
  if (source.type === "local") return basename(source.path);
  if (source.type === "npm") return source.package.split("/").at(-1);
  if (source.type === "binary") return source.binary;
  return "Application";
}

function normalizeApplicationKind(value, source) {
  const text = String(value ?? "").trim();
  if (text) return text;
  if (source.type === "npm") return "npm-package";
  if (source.type === "binary") return "binary";
  if (source.type === "git" || source.type === "local") return "repository";
  return "manual";
}

function normalizeApplicationStatus(value) {
  const text = String(value ?? "").trim();
  return APPLICATION_STATUSES.has(text) ? text : "registered";
}

function normalizeWrapperDescriptor(wrapper = {}, { npm = true } = {}) {
  const value = wrapper && typeof wrapper === "object" && !Array.isArray(wrapper) ? wrapper : {};
  const mode = NPM_WRAPPER_MODES.has(String(value.mode ?? "")) ? String(value.mode) : "metadata-only";
  const commands = normalizeWrapperCommands(value.commands);
  if (!npm) {
    // Binary sources carry no npm install/packageManager metadata — those fields
    // stay npm-only. The wrapper mode + commands are the shared, executable part.
    return { mode, commands };
  }
  const packageManager = ["npm", "pnpm", "yarn"].includes(String(value.packageManager ?? "")) ? String(value.packageManager) : "npm";
  return {
    mode,
    installState: mode === "installed-wrapper" ? normalizeWrapperInstallState(value.installState) : "not_installed",
    packageManager,
    installPath: stringOrNull(value.installPath),
    commands,
  };
}

function normalizeWrapperInstallState(value) {
  const text = String(value ?? "").trim();
  return ["not_installed", "installed", "failed", "unknown"].includes(text) ? text : "unknown";
}

function normalizeWrapperCommands(commands) {
  if (!Array.isArray(commands)) return [];
  return commands.slice(0, 30).map((command, index) => normalizeWrapperCommand(command, index));
}

function normalizeWrapperCommand(command, index) {
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    throw new Error(`NPM wrapper command at index ${index} must be an object.`);
  }
  const id = slugify(command.id ?? command.name ?? command.script ?? command.bin);
  if (!id) throw new Error(`NPM wrapper command at index ${index} requires id, name, script, or bin.`);
  const commandType = normalizeWrapperCommandType(command.commandType ?? (command.script ? "npm_script" : command.bin ? "bin" : "custom"));
  const commandText = stringOrNull(command.command ?? command.script ?? command.bin);
  if (!commandText) throw new Error(`NPM wrapper command ${id} requires command, script, or bin.`);
  return {
    id,
    displayName: stringOrNull(command.displayName ?? command.name) ?? `NPM wrapper ${id}`,
    description: stringOrNull(command.description) ?? `Governed NPM wrapper command ${id}.`,
    commandType,
    command: commandText,
    args: normalizeStringList(command.args),
    cwd: stringOrNull(command.cwd) ?? ".",
    // cwdPolicy governs where the command runs. "fixed" (default, ccusage's
    // behavior) uses `cwd`; "invocation_root" plans cwd:null so the bridge
    // resolves it to the invocation's worktree/project root (#773). An unknown
    // value degrades to "fixed" — the safe, cwd-insensitive default.
    cwdPolicy: normalizeWrapperCwdPolicy(command.cwdPolicy),
    status: normalizeWrapperCommandStatus(command.status),
    riskLevel: normalizeRiskLevel(command.riskLevel, commandType === "npm_script" ? "medium" : "high"),
    riskTags: normalizeStringList(command.riskTags ?? command.tags),
    requiresApproval: command.requiresApproval !== false,
    inputSchema: command.inputSchema && typeof command.inputSchema === "object" && !Array.isArray(command.inputSchema)
      ? command.inputSchema
      : emptyInputSchema(),
    // Declared, typed per-invocation flag mappings (#355 full unification): the
    // ONLY inputs that may become args. Anything not declared here is ignored, so
    // execution stays an allowlist even with per-invocation parameters.
    argInputs: normalizeWrapperArgInputs(command.argInputs),
    timeoutSeconds: normalizeTimeoutSeconds(command.timeoutSeconds),
    cancellation: normalizeCancellation(command.cancellation),
    envPolicy: normalizeEnvPolicy(command.envPolicy),
    filePolicy: normalizeAccessPolicy(command.filePolicy, "read_only"),
    networkPolicy: normalizeAccessPolicy(command.networkPolicy, "forbidden"),
    compatibilityFacade: normalizeWrapperCompatibilityFacade(command.compatibilityFacade),
    outputCollection: stringOrNull(command.outputCollection),
    billing: normalizeWrapperBilling(command.billing),
    resultImport: normalizeWrapperResultImport(command.resultImport),
  };
}

function normalizeWrapperCommandType(value) {
  const text = String(value ?? "").trim();
  return ["npm_script", "bin", "custom"].includes(text) ? text : "custom";
}

function normalizeWrapperCommandStatus(value) {
  const text = String(value ?? "").trim();
  return ["draft", "approved", "disabled"].includes(text) ? text : "draft";
}

function normalizeWrapperCwdPolicy(value) {
  return String(value ?? "").trim() === "invocation_root" ? "invocation_root" : "fixed";
}

function normalizeTimeoutSeconds(value) {
  const number = Number(value ?? 30);
  if (!Number.isFinite(number)) return 30;
  return Math.max(1, Math.min(600, Math.floor(number)));
}

function normalizeCancellation(value) {
  const text = String(value ?? "").trim();
  return ["supported", "best_effort", "unsupported"].includes(text) ? text : "best_effort";
}

function normalizeEnvPolicy(value) {
  const policy = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    allow: normalizeStringList(policy.allow),
    redact: normalizeStringList(policy.redact),
    inherit: policy.inherit === true,
  };
}

function normalizeWrapperCompatibilityFacade(value) {
  const facade = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  if (!facade) return null;
  const name = stringOrNull(facade.name);
  if (!name) return null;
  return {
    type: stringOrNull(facade.type) ?? "tool",
    name,
    invocationMode: stringOrNull(facade.invocationMode) ?? null,
  };
}

function normalizeWrapperBilling(value) {
  const billing = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  if (!billing) return null;
  return {
    authoritative: billing.authoritative === true,
    externalBilled: billing.externalBilled === true,
    amountSource: stringOrNull(billing.amountSource),
  };
}

function normalizeWrapperResultImport(value) {
  const resultImport = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  if (!resultImport) return null;
  const source = stringOrNull(resultImport.source);
  const kind = stringOrNull(resultImport.kind);
  if (!source && !kind) return null;
  return {
    source,
    kind,
    amountSource: stringOrNull(resultImport.amountSource),
  };
}

function normalizeAccessPolicy(value, fallback) {
  const text = String(value ?? "").trim();
  return ["forbidden", "read_only", "workspace_write", "network"].includes(text) ? text : fallback;
}

function statusForLifecycleAction(action) {
  return {
    online: "active",
    offline: "offline",
    archive: "archived",
    refresh: "active",
  }[action] ?? null;
}

function findExistingApplicationBySource(applications, source) {
  const key = sourceKey(source);
  return applications.find((app) => sourceKey(app.source) === key) ?? null;
}

function actorCanAccessApplication(state, actor, application) {
  if (!actor?.teamId) return true;
  if (application.projectId) {
    const project = (state.projects ?? []).find((item) => item.id === application.projectId);
    return project ? teamOf(project) === actor.teamId : false;
  }
  return (application.ownerTeamId ?? "team_local") === actor.teamId;
}

function sourceKey(source) {
  if (!source) return "";
  if (source.type === "git") return `git:${source.url}:${source.ref ?? ""}`;
  if (source.type === "local") return `local:${resolve(source.path)}`;
  if (source.type === "npm") return `npm:${source.package}:${source.version ?? "latest"}`;
  return `manual:${source.uri ?? JSON.stringify(source.manifest ?? {})}`;
}

function sanitizeApplicationId(value) {
  const text = slugify(value).replaceAll(".", "_").replaceAll("-", "_");
  return text.startsWith("app_") ? text : `app_${text || Date.now().toString(36)}`;
}

function slugify(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function stringOrNull(value) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function isPathInside(root, target) {
  const rel = relative(resolve(root), resolve(target));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function probeSummary(app, counts = {}) {
  const suffix = ` Managed ${projectApplicationCapabilities(app).length}; declared ${counts.declaredCount ?? 0}; inferred ${counts.inferredCount ?? 0}.`;
  if (app.source.type === "npm") return `NPM package ${app.source.package}@${app.source.version ?? "latest"} probed.${suffix}`;
  if (app.source.type === "git") return `Git source ${app.source.url} probed.${suffix}`;
  if (app.source.type === "local") return `Local application path ${app.source.path} probed.${suffix}`;
  return `Manual application manifest probed.${suffix}`;
}
