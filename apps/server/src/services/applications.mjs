import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { normalizeMcpAdapterConfig } from "@myagenttool/adapters/mcp";
import { normalizeLoopRoutine, validateLoopRoutine } from "../../../../tools/ai/src/loop/routine.mjs";
import { teamOf } from "../runtime/auth.mjs";
import { sanitizeAgentId } from "./agents.mjs";

const APPLICATION_SOURCE_TYPES = new Set(["git", "local", "npm", "manual"]);
const APPLICATION_STATUSES = new Set(["draft", "probing", "registered", "active", "offline", "archived", "failed"]);
const NPM_WRAPPER_MODES = new Set(["metadata-only", "installed-wrapper"]);
const APPLICATION_ROUTINE_REQUIRED_APPROVALS = ["apply", "push", "pr-create", "pr-merge"];
const APPLICATION_ROUTINE_RISK_LEVELS = ["low", "medium", "high", "critical"];
const MCP_CONFIG_FILES = [
  { relativePath: ".vscode/mcp.json", keys: ["servers", "mcpServers"] },
  { relativePath: ".cursor/mcp.json", keys: ["mcpServers", "servers"] },
  { relativePath: ".mcp.json", keys: ["mcpServers", "servers"] },
];

export function createApplicationService({
  state,
  now,
  nextId,
  appendEvent,
  persistStateSoon,
  addProject,
  cloneProject,
  defaultProjectPath = process.cwd(),
}) {
  function listApplications() {
    return state.applications ?? [];
  }

  function findApplication(applicationId) {
    return listApplications().find((app) => app.id === applicationId) ?? null;
  }

  function registerApplication(body = {}, actor = null) {
    const rawSource = body.source ?? sourceFromLegacyBody(body);
    assertValidApplicationRegistrationSource(rawSource);
    const source = normalizeApplicationSource(rawSource);
    const name = normalizeApplicationName(body.name ?? nameFromSource(source));
    const requestedId = body.id == null ? null : sanitizeApplicationId(body.id);
    const hasMcpAgentPatch =
      Object.hasOwn(body, "mcpAgent") ||
      Object.hasOwn(body, "mcp") ||
      (rawSource && typeof rawSource === "object" && !Array.isArray(rawSource) && (Object.hasOwn(rawSource, "mcpAgent") || Object.hasOwn(rawSource, "mcp")));
    const mcpAgentInput = body.mcpAgent ?? body.mcp ?? rawSource?.mcpAgent ?? rawSource?.mcp;
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
      if (hasMcpAgentPatch) {
        existing.mcpAgent = normalizeApplicationMcpAgent(mcpAgentInput, {
          applicationId: existing.id,
          applicationName: existing.name,
          applicationPath: existing.path ?? existing.source?.path ?? null,
        });
      }
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
      mcpAgent: normalizeApplicationMcpAgent(mcpAgentInput, {
        applicationId,
        applicationName: name,
        applicationPath: project?.path ?? source.path ?? null,
      }),
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

  function getApplicationDescriptors(applicationId, actor = null) {
    const app = findApplication(applicationId);
    if (!app || !actorCanAccessApplication(state, actor, app)) return null;
    return applicationEditableDescriptors(app);
  }

  function updateApplicationDescriptors(applicationId, body = {}, actor = null) {
    const app = findApplication(applicationId);
    if (!app || !actorCanAccessApplication(state, actor, app)) return null;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("Application descriptor update must be an object.");
    }
    let changed = false;
    if (Object.hasOwn(body, "name")) {
      app.name = normalizeApplicationName(body.name);
      changed = true;
    }
    if (Object.hasOwn(body, "mcpAgent")) {
      if (!body.mcpAgent || typeof body.mcpAgent !== "object" || Array.isArray(body.mcpAgent)) {
        throw new Error("Application mcpAgent descriptor must be a JSON object.");
      }
      app.mcpAgent = normalizeApplicationMcpAgent(body.mcpAgent, {
        applicationId: app.id,
        applicationName: app.name,
        applicationPath: app.path ?? app.source?.path ?? null,
      });
      changed = true;
    }
    if (Object.hasOwn(body, "npmWrapper")) {
      if (app.source?.type !== "npm") {
        throw new Error("NPM wrapper descriptor can only be edited on npm applications.");
      }
      assertValidNpmWrapperDescriptor(body.npmWrapper, app);
      app.source.wrapper = normalizeNpmWrapper(body.npmWrapper);
      changed = true;
    }
    if (Object.hasOwn(body, "manualManifest")) {
      if (app.source?.type !== "manual") {
        throw new Error("Manual manifest can only be edited on manual applications.");
      }
      if (!body.manualManifest || typeof body.manualManifest !== "object" || Array.isArray(body.manualManifest)) {
        throw new Error("Manual manifest must be a JSON object.");
      }
      app.source.manifest = body.manualManifest;
      changed = true;
    }
    if (changed) {
      app.capabilitiesVersion = Math.max(1, Number(app.capabilitiesVersion ?? 1) + 1);
      app.lifecycle = {
        ...(app.lifecycle ?? {}),
        state: app.lifecycle?.state ?? "registered",
        lastOperation: "update_descriptors",
        lastOperationAt: now(),
        lastActorId: actor?.userId ?? null,
      };
      app.updatedAt = now();
      appendEvent({
        invocationId: null,
        type: "application_descriptors_updated",
        level: "info",
        message: `${app.name} application descriptors updated.`,
        data: {
          applicationId: app.id,
          mcpAgent: Object.hasOwn(body, "mcpAgent"),
          npmWrapper: Object.hasOwn(body, "npmWrapper"),
          manualManifest: Object.hasOwn(body, "manualManifest"),
        },
      });
      persistStateSoon();
    }
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
    const autoRegisteredMcp = app.mcpAgent
      ? null
      : adoptProbeMcpAgent(app, probe.mcpServers, probedAt);
    app.probe = {
      status: "completed",
      checkedAt: probedAt,
      summary: probe.summary,
      source: probe.source,
      package: probe.package,
      readme: probe.readme,
      capabilities: probe.capabilities,
      capabilityNames: probe.capabilities.map((capability) => capability.name),
      mcpServers: probe.mcpServers.map(publicProbeMcpServer),
      autoRegisteredMcpAgentId: autoRegisteredMcp?.agentId ?? null,
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
        mcpServerCandidateCount: app.probe.mcpServers.length,
        autoRegisteredMcpAgentId: app.probe.autoRegisteredMcpAgentId,
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
    // Every side-effecting action requires a verified approvalRequestId that the
    // capability/composer layer has already checked against the matching
    // invocation metadata.
    if ((["archive", "offline", "online", "refresh", "generate_orchestration"].includes(action) || action.startsWith("wrapper:")) && !hasApplicationApproval(input)) {
      return {
        ok: false,
        status: 409,
        body: {
          error: "approval_required",
          reason: `${action} requires an approved approvalRequestId.`,
          applicationId: application.id,
          action,
        },
      };
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
  // verified approvalRequestId — then resolves the approved execution plan. On
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
    const policySupport = applicationWrapperPolicySupport(command);
    if (!policySupport.supported) {
      return {
        ok: false,
        status: 409,
        body: {
          error: "application_wrapper_policy_not_supported",
          reason: policySupport.reason,
          applicationId,
          commandId,
          filePolicy: command.filePolicy,
          networkPolicy: command.networkPolicy,
          supportedFilePolicy: "read_only",
          supportedNetworkPolicy: "forbidden",
        },
      };
    }
    // Approval is required only for commands that declare it. A read-only report
    // command can set requiresApproval:false — preserving, e.g., the ccusage
    // tool's offline reports that never needed an approval token.
    if (command.requiresApproval && !hasApplicationApproval(input)) {
      return { ok: false, status: 409, body: { error: "approval_required", reason: "This wrapper command requires an approved approvalRequestId.", applicationId } };
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
        applicationPath: plan.applicationPath,
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

  function confirmApplicationMcpCandidate(applicationId, candidateId, input = {}, actor = null) {
    const app = findApplication(applicationId);
    if (!app) {
      return { ok: false, status: 404, body: { error: "application_not_found" } };
    }
    if (app.status === "archived") {
      return { ok: false, status: 409, body: { error: "application_archived", applicationId } };
    }
    if (app.mcpAgent?.agentId) {
      return {
        ok: false,
        status: 409,
        body: { error: "application_mcp_agent_already_registered", applicationId, agentId: app.mcpAgent.agentId },
      };
    }
    if (!hasApplicationApproval(input)) {
      return {
        ok: false,
        status: 409,
        body: {
          error: "approval_required",
          reason: "Confirming an MCP candidate requires an approved approvalRequestId.",
          applicationId,
        },
      };
    }

    const confirmedAt = now();
    const warnings = [];
    const candidates = inferApplicationMcpServers(app, warnings);
    const candidate = candidates.find((item) => item.id === String(candidateId ?? "").trim());
    if (!candidate?.mcpAgent) {
      return { ok: false, status: 404, body: { error: "mcp_candidate_not_found", applicationId, candidateId } };
    }
    if (candidate.allowedTools.length === 0) {
      return { ok: false, status: 422, body: { error: "mcp_candidate_not_ready", applicationId, candidateId } };
    }

    const mcpAgent = normalizeApplicationMcpAgent(candidate.mcpAgent, {
      applicationId: app.id,
      applicationName: app.name,
      applicationPath: app.path ?? app.source?.path ?? null,
    });
    mcpAgent.discovery = {
      source: "application_probe",
      candidateId: candidate.id,
      sourcePath: candidate.sourcePath,
      detectedAt: confirmedAt,
      autoRegistered: false,
      manualConfirmed: true,
      confirmedBy: actor?.userId ?? null,
    };
    mcpAgent.recovery = {
      ...mcpAgent.recovery,
      reason: "mcp_agent_confirmed_from_application_probe",
      nextAction: "The confirmed MCP tools can be exposed after bridge-side execution policy checks.",
    };
    app.mcpAgent = mcpAgent;
    app.probe = {
      ...(app.probe ?? {}),
      status: "completed",
      checkedAt: confirmedAt,
      mcpServers: candidates.map(publicProbeMcpServer),
      confirmedMcpAgentId: mcpAgent.agentId,
      warnings: [...(app.probe?.warnings ?? []), ...warnings],
    };
    app.lifecycle = {
      ...app.lifecycle,
      lastOperation: "confirm_mcp_candidate",
      lastOperationAt: confirmedAt,
      lastActorId: actor?.userId ?? null,
    };
    app.updatedAt = confirmedAt;
    appendEvent({
      invocationId: null,
      type: "application_mcp_candidate_confirmed",
      level: "info",
      message: `${app.name} MCP candidate ${candidate.id} confirmed.`,
      data: {
        applicationId: app.id,
        candidateId: candidate.id,
        sharedToolNames: applicationMcpSharedToolNames(app),
      },
    });
    persistStateSoon();
    return { ok: true, status: 200, application: app, candidate: publicProbeMcpServer(candidate) };
  }

  return {
    findApplication,
    confirmApplicationMcpCandidate,
    getApplicationDescriptors,
    invokeApplicationCapability,
    listApplicationCapabilities,
    listApplications,
    planApplicationWrapperInvocation,
    probeApplication,
    registerApplication,
    transitionApplication,
    updateApplicationDescriptors,
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

export function applicationMcpAgentRegistration(application) {
  const mcp = application?.mcpAgent;
  if (!mcp?.adapter) return null;
  return {
    id: mcp.agentId,
    type: "mcp",
    name: mcp.name ?? `${application.name} MCP`,
    description: mcp.description ?? `MCP server for ${application.name}.`,
    adapter: mcp.adapter,
    capabilityName: mcp.capabilityName ?? `${mcp.toolNamespace ?? mcpToolSegment(application.name)}_mcp_tool_call`,
    capabilityDescription: mcp.capabilityDescription ?? `Calls tools exposed by ${application.name}'s MCP server.`,
    riskLevel: mcp.riskLevel ?? "medium",
    riskTags: mcp.riskTags ?? ["local_execution", "mcp", "application_asset"],
    toolNamespace: mcp.toolNamespace ?? mcpToolSegment(application.name),
    sourceApplicationId: application.id,
  };
}

export function applicationMcpSharedToolNames(application) {
  const mcp = application?.mcpAgent;
  if (!mcp) return [];
  const namespace = mcp.toolNamespace ?? mcpToolSegment(application.name);
  return normalizeStringList(mcp.allowedTools).map((toolName) => `${namespace}.${mcpToolSegment(toolName)}`);
}

// Resolve the governed execution plan for an npm-wrapper capability (#359).
// Only a command registered on the application with status "approved" resolves;
// anything else returns null. This is the single source of truth for WHAT may
// execute — the bridge only ever runs a command that came through here, so an
// unapproved or unregistered command can never reach execution.
const WRAPPER_ARG_INPUT_TYPES = new Set(["date", "token", "enum", "string", "boolean-flag"]);
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
    const flag = String(entry.flag ?? "").trim();
    if (!/^--[a-z0-9][a-z0-9-]*$/.test(flag)) {
      throw new Error(`NPM wrapper argInput ${key} requires a valid --flag.`);
    }
    const type = WRAPPER_ARG_INPUT_TYPES.has(String(entry.type)) ? String(entry.type) : "token";
    return { key, flag, type, values: type === "enum" ? normalizeStringList(entry.values) : [] };
  });
}

// Turn a caller's input into args, appending ONLY declared flags whose value
// passes its type validator. Undeclared keys are ignored; a value that looks like
// a flag (leading "-") is refused so it can never inject a new option.
function resolveWrapperInputArgs(argInputs, input) {
  if (!Array.isArray(argInputs) || !input || typeof input !== "object" || Array.isArray(input)) return [];
  const args = [];
  for (const spec of argInputs) {
    const raw = input[spec.key];
    if (raw === undefined || raw === null) continue;
    if (spec.type === "boolean-flag") {
      if (raw === true || raw === "true") args.push(spec.flag);
      continue;
    }
    const value = String(raw).trim();
    if (!value || value.startsWith("-")) continue;
    if (!isValidWrapperArgValue(spec, value)) continue;
    args.push(spec.flag, value);
  }
  return args;
}

function isValidWrapperArgValue(spec, value) {
  switch (spec.type) {
    case "date": return /^\d{4}-\d{2}-\d{2}$/.test(value);
    case "token": return /^[A-Za-z0-9_+/:.][A-Za-z0-9_+/:.-]{0,63}$/.test(value);
    case "enum": return spec.values.includes(value);
    case "string": return value.length <= 200 && !/[\r\n]/.test(value);
    default: return false;
  }
}

export function applicationWrapperExecutionPlan(application, commandId, input = {}) {
  const command = findNpmWrapperCommand(application, commandId);
  if (!command) return null;
  const commandArgs = [...command.args, ...resolveWrapperInputArgs(command.argInputs, input)];
  const execution = wrapperCommandExecution(application, command, commandArgs);
  return {
    capability: `app.${slugify(application.id || application.name)}.wrapper.${command.id}`,
    commandId: command.id,
    commandType: command.commandType,
    command: execution.command,
    // Base args + only the declared, validated per-invocation flag inputs.
    args: execution.args,
    cwd: resolveWrapperCwd(application, command.cwd),
    applicationPath: resolveWrapperApplicationPath(application),
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
    ...projectNpmWrapperCapabilities(app, prefix, disabled),
  ];
}

function managedCapability(app, name, displayName, kind, riskLevel, riskTags, requiresApproval, disabled, inputSchema, metadata = {}) {
  const outputCollection = metadata.outputCollection ?? "invocations";
  const { capabilityStatus, ...capabilityMetadata } = metadata;
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
    status: capabilityStatus ?? (disabled ? "disabled" : "available"),
    inputSchema,
    outputSchema: { structuredResult: true, provider: "application" },
    metadata: {
      readiness: capabilityReadiness(app, { disabled, kind, metadata: capabilityMetadata }),
      resultPath: {
        outputCollection,
        resultImport: capabilityMetadata.resultImport ?? null,
        evidenceCenter: outputCollection !== "invocations",
      },
      ...capabilityMetadata,
    },
  };
}

function projectNpmWrapperCapabilities(app, prefix, disabled) {
  if (app.source?.type !== "npm" || app.source.wrapper?.mode !== "installed-wrapper") return [];
  return (app.source.wrapper.commands ?? [])
    .filter((command) => command.status === "approved")
    .map((command) => {
      const policySupport = applicationWrapperPolicySupport(command);
      return managedCapability(
        app,
        `${prefix}.wrapper.${command.id}`,
        command.displayName,
        "npm_wrapper",
        command.riskLevel,
        [...new Set(["local_execution", "npm_wrapper", ...command.riskTags])],
        command.requiresApproval,
        disabled,
        command.inputSchema,
        {
          capabilityStatus: policySupport.supported ? undefined : "disabled",
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
            policySupported: policySupport.supported,
            policyUnsupportedReason: policySupport.reason,
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
      );
    });
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
    if (installState === "installed" && metadata?.wrapper?.policySupported === false) {
      return {
        state: "needs_consent",
        reason: "wrapper_policy_exceeds_current_consent_model",
        applicationStatus: app.status,
        installState,
        executionMode: "bridge_wrapper",
        filePolicy: metadata.wrapper.filePolicy ?? null,
        networkPolicy: metadata.wrapper.networkPolicy ?? null,
      };
    }
    return {
      state: installState === "installed" ? "ready" : "needs_setup",
      reason: installState === "installed" ? "wrapper_installed" : "wrapper_not_confirmed_installed",
      applicationStatus: app.status,
      installState,
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

function approvalInputSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      approvalRequestId: { type: "string", minLength: 1, maxLength: 200 },
    },
    required: ["approvalRequestId"],
  };
}

function wrapperCommandExecution(application, command, args) {
  if (command.commandType !== "npm_script") {
    return { command: command.command, args };
  }
  const packageManager = application.source?.wrapper?.packageManager ?? "npm";
  if (packageManager === "yarn") {
    return { command: "yarn", args: ["run", command.command, ...args] };
  }
  return {
    command: packageManager,
    args: args.length ? ["run", command.command, "--", ...args] : ["run", command.command],
  };
}

function resolveWrapperCwd(application, cwd) {
  const base = resolveWrapperApplicationPath(application);
  const text = String(cwd ?? ".").trim() || ".";
  if (isAbsolute(text)) return text;
  return base ? resolve(base, text) : text;
}

function resolveWrapperApplicationPath(application) {
  const installPath = stringOrNull(application.source?.wrapper?.installPath);
  if (installPath) return resolve(installPath);
  const path = stringOrNull(application.path);
  if (path) return resolve(path);
  return null;
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

function hasApplicationApproval(input) {
  return Boolean(input && typeof input === "object" && !Array.isArray(input) && input.__verifiedApplicationApproval === true);
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

export function publicApplicationSnapshot(application) {
  const source = publicApplicationSourceSnapshot(application.source);
  return {
    id: application.id,
    name: application.name,
    kind: application.kind,
    source,
    status: application.status,
    lifecycle: application.lifecycle,
    projectId: application.projectId,
    path: application.path,
    ownerTeamId: application.ownerTeamId ?? null,
    capabilitiesVersion: application.capabilitiesVersion,
    probe: application.probe ?? null,
    mcpAgent: publicApplicationMcpAgentSnapshot(application.mcpAgent),
    wrapper: application.source?.wrapper ? publicNpmWrapperSnapshot(application.source.wrapper) : null,
    orchestrationIds: application.orchestrationIds ?? [],
    orchestrations: application.orchestrations ?? [],
    latestResult: application.latestResult ?? null,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
  };
}

function applicationEditableDescriptors(application) {
  return {
    applicationId: application.id,
    descriptors: {
      mcpAgent: editableApplicationMcpAgentDescriptor(application.mcpAgent),
      npmWrapper: application.source?.type === "npm" ? cloneJson(application.source.wrapper ?? null) : null,
      manualManifest: application.source?.type === "manual" ? cloneJson(application.source.manifest ?? {}) : null,
    },
  };
}

function editableApplicationMcpAgentDescriptor(mcpAgent) {
  if (!mcpAgent) return null;
  const adapter = mcpAgent.adapter ?? {};
  const descriptor = {
    agentId: mcpAgent.agentId,
    name: mcpAgent.name,
    description: mcpAgent.description,
    toolNamespace: mcpAgent.toolNamespace,
    capabilityName: mcpAgent.capabilityName,
    capabilityDescription: mcpAgent.capabilityDescription,
    riskLevel: mcpAgent.riskLevel,
    riskTags: mcpAgent.riskTags ?? [],
    transport: adapter.transport,
    allowedTools: adapter.allowedTools ?? [],
    timeoutMs: adapter.timeoutMs,
    startupTimeoutMs: adapter.startupTimeoutMs,
    filePolicy: adapter.filePolicy,
    networkPolicy: adapter.networkPolicy,
  };
  if (adapter.transport === "stdio") {
    descriptor.command = adapter.command;
    descriptor.args = adapter.args ?? [];
    if (adapter.cwd) descriptor.cwd = adapter.cwd;
  } else if (adapter.transport === "http") {
    descriptor.url = adapter.url;
    descriptor.headers = adapter.headers ?? {};
  }
  return cloneJson(descriptor);
}

function publicApplicationSourceSnapshot(source = {}) {
  if (source?.type === "npm") {
    const { wrapper, ...rest } = source;
    return {
      ...rest,
      wrapper: wrapper ? publicNpmWrapperSnapshot(wrapper) : null,
    };
  }
  return source;
}

function publicApplicationMcpAgentSnapshot(mcpAgent) {
  if (!mcpAgent) return null;
  return {
    agentId: mcpAgent.agentId,
    name: mcpAgent.name,
    description: mcpAgent.description,
    allowedTools: mcpAgent.allowedTools ?? [],
    toolNamespace: mcpAgent.toolNamespace,
    sharedToolNames: mcpAgent.sharedToolNames ?? applicationMcpSharedToolNames({ name: mcpAgent.name, mcpAgent }),
    agentStatus: mcpAgent.agentStatus,
    lastRecoveredAt: mcpAgent.lastRecoveredAt ?? null,
    riskLevel: mcpAgent.riskLevel,
    riskTags: mcpAgent.riskTags ?? [],
    recovery: mcpAgent.recovery ?? null,
    discovery: mcpAgent.discovery ?? null,
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
  const mcpServers = inferApplicationMcpServers(application, warnings);
  const capabilities = dedupeProbeCapabilities([...managed, ...declared, ...inferred]);
  return {
    summary: probeSummary(application, {
      declaredCount: declared.length,
      inferredCount: inferred.length,
      mcpServerCount: mcpServers.length,
    }),
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
    mcpServers,
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
  if (application.source?.type !== "npm") return null;
  return (application.source.wrapper?.commands ?? []).find((command) => command.id === commandId && command.status === "approved") ?? null;
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

function cloneJson(value) {
  if (value === null || value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
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

function inferApplicationMcpServers(application, warnings) {
  if (!["git", "local"].includes(application.source?.type) && application.kind !== "repository") return [];
  const root = application.path ? resolve(application.path) : null;
  if (!root || !existsSync(root)) return [];
  const candidates = [];
  for (const config of MCP_CONFIG_FILES) {
    const path = resolve(root, config.relativePath);
    if (!isPathInside(root, path) || !existsSync(path)) continue;
    let parsed = null;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      warnings.push(`Could not parse MCP config ${config.relativePath}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    for (const key of config.keys) {
      const servers = parsed?.[key];
      if (!servers || typeof servers !== "object" || Array.isArray(servers)) continue;
      for (const [serverName, server] of Object.entries(servers)) {
        const candidate = mcpServerCandidateFromConfig({
          application,
          root,
          serverName,
          server,
          source: "mcp_config",
          relativePath: config.relativePath,
          warnings,
        });
        if (candidate) candidates.push(candidate);
      }
    }
  }
  const packageCandidate = mcpServerCandidateFromPackage(application, root, warnings);
  if (packageCandidate) candidates.push(packageCandidate);
  return dedupeMcpServerCandidates(candidates);
}

function mcpServerCandidateFromConfig({
  application,
  root,
  serverName,
  server,
  source,
  relativePath,
  warnings,
}) {
  if (!server || typeof server !== "object" || Array.isArray(server)) {
    warnings.push(`Ignored MCP server ${serverName} in ${relativePath}: expected object.`);
    return null;
  }
  const transport = String(server.type ?? server.transport ?? (server.url ? "http" : "stdio")).trim().toLowerCase();
  if (transport === "http") {
    const url = stringOrNull(server.url);
    if (!url) return null;
    const allowedTools = normalizeStringList(server.allowedTools ?? server.tools ?? server.toolNames);
    return buildProbeMcpServer({
      application,
      source,
      sourcePath: relativePath,
      serverName,
      adapter: {
        transport: "http",
        url,
        allowedTools,
        filePolicy: stringOrNull(server.filePolicy) ?? "read_only",
        networkPolicy: stringOrNull(server.networkPolicy) ?? "restricted",
        applicationPath: root,
      },
      allowedTools,
      warnings,
    });
  }
  if (transport !== "stdio") {
    warnings.push(`Ignored MCP server ${serverName} in ${relativePath}: unsupported transport ${transport}.`);
    return null;
  }
  const command = expandWorkspaceValue(server.command, root);
  if (!command) {
    warnings.push(`Ignored MCP server ${serverName} in ${relativePath}: missing command.`);
    return null;
  }
  const cwd = expandWorkspaceValue(server.cwd, root);
  const args = normalizeStringList(server.args).map((arg) => absolutizeMcpArg(expandWorkspaceValue(arg, root), { root, cwd }));
  const allowedTools = uniqueStringList([
    ...normalizeStringList(server.allowedTools ?? server.tools ?? server.toolNames),
    ...inferMcpAllowedTools(root, { args, cwd }, warnings),
  ]);
  return buildProbeMcpServer({
    application,
    source,
    sourcePath: relativePath,
    serverName,
    adapter: {
      transport: "stdio",
      command,
      args,
      cwd,
      allowedTools,
      filePolicy: stringOrNull(server.filePolicy) ?? "read_only",
      networkPolicy: stringOrNull(server.networkPolicy) ?? "forbidden",
      applicationPath: root,
    },
    allowedTools,
    cwd,
    warnings,
  });
}

function mcpServerCandidateFromPackage(application, root, warnings) {
  const mcpRoot = resolve(root, "packages", "mcp-server");
  const packagePath = resolve(mcpRoot, "package.json");
  if (!isPathInside(root, packagePath) || !existsSync(packagePath)) return null;
  let packageJson = null;
  try {
    packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  } catch (error) {
    warnings.push(`Could not parse MCP package manifest packages/mcp-server/package.json: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  const scripts = objectWithStringValues(packageJson.scripts);
  const start = stringOrNull(scripts.start ?? scripts.dev);
  if (!start) return null;
  const parts = splitPackageScript(start);
  if (parts.length === 0) return null;
  const [command, ...rawArgs] = parts;
  const args = rawArgs.map((arg) => absolutizeMcpArg(expandWorkspaceValue(arg, root), { root, cwd: mcpRoot }));
  const allowedTools = inferMcpAllowedTools(root, { args, cwd: mcpRoot }, warnings);
  return buildProbeMcpServer({
    application,
    source: "package_script",
    sourcePath: "packages/mcp-server/package.json",
    serverName: packageJson.name ?? "mcp-server",
    adapter: {
      transport: "stdio",
      command,
      args,
      cwd: mcpRoot,
      allowedTools,
      filePolicy: "read_only",
      networkPolicy: "forbidden",
      applicationPath: root,
    },
    allowedTools,
    cwd: mcpRoot,
    warnings,
  });
}

function buildProbeMcpServer({
  application,
  source,
  sourcePath,
  serverName,
  adapter,
  allowedTools,
  cwd = null,
  warnings,
}) {
  try {
    normalizeMcpAdapterConfig(adapter);
  } catch (error) {
    warnings.push(`Ignored MCP server ${serverName}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
  const toolNamespace = mcpToolSegment(application.name ?? application.id ?? serverName);
  const normalizedAllowedTools = normalizeStringList(allowedTools);
  const sharedToolNames = normalizedAllowedTools.map((toolName) => `${toolNamespace}.${mcpToolSegment(toolName)}`);
  const candidateId = `mcp.${slugify(serverName || sourcePath || "server")}`;
  const registration = mcpAutoRegistrationAssessment(adapter, application, normalizedAllowedTools);
  const filePolicy = adapter.filePolicy ?? "read_only";
  const networkPolicy = adapter.networkPolicy ?? (adapter.transport === "http" ? "restricted" : "forbidden");
  return {
    id: candidateId,
    serverName: String(serverName ?? "mcp-server"),
    source,
    sourcePath,
    transport: adapter.transport,
    cwd: cwd ? normalizePathForMetadata(cwd) : null,
    toolNamespace,
    allowedTools: normalizedAllowedTools,
    sharedToolNames,
    status: normalizedAllowedTools.length > 0 ? "ready" : "needs_probe",
    confidence: registration.confidence,
    autoRegister: registration.autoRegister,
    autoRegisterReason: registration.reason,
    adapterPreview: adapter.transport === "stdio"
      ? {
          command: basename(adapter.command),
          argCount: adapter.args?.length ?? 0,
        }
      : {
          url: redactUrl(adapter.url),
        },
    review: mcpCandidateReview({
      adapter,
      filePolicy,
      networkPolicy,
      normalizedAllowedTools,
      registration,
    }),
    mcpAgent: {
      name: `${application.name ?? "Application"} MCP`,
      description: `MCP server discovered from ${sourcePath}.`,
      toolNamespace,
      transport: adapter.transport,
      ...(adapter.transport === "stdio"
        ? { command: adapter.command, args: adapter.args ?? [], cwd: adapter.cwd ?? cwd ?? null }
        : { url: adapter.url }),
      allowedTools: normalizedAllowedTools,
      filePolicy,
      networkPolicy,
      applicationPath: adapter.applicationPath ?? application.path ?? null,
      riskTags: ["local_execution", "mcp", "application_asset"],
    },
  };
}

function mcpCandidateReview({ adapter, filePolicy, networkPolicy, normalizedAllowedTools, registration }) {
  const base = {
    dataBoundary: adapter.transport === "http" ? "bridge_to_http_endpoint" : "local_stdio_process",
    requiresManualConfirmation: !registration.autoRegister,
    manualConfirmationReason: registration.reason,
    filePolicy,
    networkPolicy,
    allowedToolCount: normalizedAllowedTools.length,
  };
  if (adapter.transport !== "http") return base;
  return {
    ...base,
    ...mcpHttpEndpointReview(adapter.url),
  };
}

function mcpHttpEndpointReview(url) {
  try {
    const parsed = new URL(url);
    return {
      endpointOrigin: parsed.origin,
      endpointHost: parsed.host,
      endpointProtocol: parsed.protocol.replace(/:$/, ""),
    };
  } catch {
    return {
      endpointOrigin: null,
      endpointHost: null,
      endpointProtocol: null,
    };
  }
}

function mcpAutoRegistrationAssessment(adapter, application, allowedTools) {
  if ((allowedTools ?? []).length === 0) {
    return { autoRegister: false, confidence: "low", reason: "allowed_tools_missing" };
  }
  if (adapter.transport !== "stdio") {
    return { autoRegister: false, confidence: "medium", reason: "http_transport_requires_manual_confirmation" };
  }
  const root = application.path ? resolve(application.path) : null;
  if (!root || !existsSync(root)) {
    return { autoRegister: false, confidence: "low", reason: "application_root_not_readable" };
  }
  const commandName = basename(adapter.command ?? "").toLowerCase();
  if (!["node", "node.exe"].includes(commandName)) {
    return { autoRegister: false, confidence: "medium", reason: "stdio_command_requires_manual_confirmation" };
  }
  const hasRootedScript = (adapter.args ?? []).some((arg) => {
    if (!/\.(?:mjs|cjs|js|ts|tsx)$/i.test(arg) || !isAbsolute(arg)) return false;
    const resolved = resolve(arg);
    return isPathInside(root, resolved) && existsSync(resolved);
  });
  if (!hasRootedScript) {
    return { autoRegister: false, confidence: "medium", reason: "stdio_entrypoint_not_rooted_in_application" };
  }
  if (adapter.cwd) {
    const cwd = resolve(adapter.cwd);
    if (!isPathInside(root, cwd) || !existsSync(cwd)) {
      return { autoRegister: false, confidence: "medium", reason: "stdio_cwd_not_rooted_in_application" };
    }
  }
  return { autoRegister: true, confidence: "high", reason: "node_entrypoint_inside_application_root" };
}

function adoptProbeMcpAgent(application, mcpServers, detectedAt) {
  const candidate = (mcpServers ?? []).find((item) => item.autoRegister && item.mcpAgent);
  if (!candidate) return null;
  const mcpAgent = normalizeApplicationMcpAgent(candidate.mcpAgent, {
    applicationId: application.id,
    applicationName: application.name,
    applicationPath: application.path ?? application.source?.path ?? null,
  });
  mcpAgent.discovery = {
    source: "application_probe",
    candidateId: candidate.id,
    sourcePath: candidate.sourcePath,
    detectedAt,
    autoRegistered: true,
  };
  mcpAgent.recovery = {
    ...mcpAgent.recovery,
    reason: "mcp_agent_autodetected_from_application_probe",
    nextAction: "The runtime can expose the discovered MCP tools after bridge-side execution policy checks.",
  };
  application.mcpAgent = mcpAgent;
  return { agentId: mcpAgent.agentId, candidateId: candidate.id };
}

function publicProbeMcpServer(candidate) {
  return {
    id: candidate.id,
    serverName: candidate.serverName,
    source: candidate.source,
    sourcePath: candidate.sourcePath,
    transport: candidate.transport,
    toolNamespace: candidate.toolNamespace,
    allowedTools: candidate.allowedTools,
    sharedToolNames: candidate.sharedToolNames,
    status: candidate.status,
    confidence: candidate.confidence,
    autoRegister: candidate.autoRegister,
    autoRegisterReason: candidate.autoRegisterReason,
    adapterPreview: candidate.adapterPreview,
    review: candidate.review,
  };
}

function inferMcpAllowedTools(root, { args = [], cwd = null } = {}, warnings = []) {
  const searchRoots = [];
  const addRoot = (path) => {
    if (!path) return;
    const resolved = resolve(path);
    if (isPathInside(root, resolved) && existsSync(resolved) && !searchRoots.includes(resolved)) {
      searchRoots.push(resolved);
    }
  };
  addRoot(cwd);
  for (const arg of args) {
    if (!/\.(?:mjs|cjs|js|ts|tsx)$/i.test(arg)) continue;
    const scriptPath = resolve(arg);
    if (isPathInside(root, scriptPath) && existsSync(scriptPath)) addRoot(dirname(scriptPath));
  }
  addRoot(resolve(root, "packages", "mcp-server"));
  const files = [];
  for (const searchRoot of searchRoots) {
    for (const relativePath of ["src/index.ts", "src/index.js", "src/index.mjs", "index.ts", "index.js", "server.ts", "server.js", "README.md"]) {
      const path = resolve(searchRoot, relativePath);
      if (isPathInside(root, path) && existsSync(path) && !files.includes(path)) files.push(path);
    }
  }
  const tools = [];
  for (const file of files) {
    try {
      const text = readFileSync(file, "utf8");
      tools.push(...toolNamesFromMcpSource(text), ...toolNamesFromMcpReadme(text));
    } catch (error) {
      warnings.push(`Could not inspect MCP tools in ${relative(root, file)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return uniqueStringList(tools).slice(0, 20);
}

function toolNamesFromMcpSource(text) {
  const tools = [];
  const pattern = /registerTool\(\s*([`'"])([^`'"]+)\1/g;
  let match;
  while ((match = pattern.exec(text))) {
    if (match[2]) tools.push(match[2]);
  }
  return tools;
}

function toolNamesFromMcpReadme(text) {
  const tools = [];
  const pattern = /^#{2,4}\s+`([^`]+)`/gm;
  let match;
  while ((match = pattern.exec(text))) {
    if (match[1] && /^[a-z0-9_:-]+$/i.test(match[1])) tools.push(match[1]);
  }
  return tools;
}

function expandWorkspaceValue(value, root) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text
    .replace(/\$\{workspaceFolder\}/g, root)
    .replace(/\$\{workspaceRoot\}/g, root);
}

function absolutizeMcpArg(arg, { root, cwd = null } = {}) {
  if (!arg) return arg;
  if (isAbsolute(arg)) {
    const resolved = resolve(arg);
    return isPathInside(root, resolved) ? resolved : arg;
  }
  if (!/\.(?:mjs|cjs|js|ts|tsx)$/i.test(arg)) return arg;
  const base = cwd ? resolve(cwd) : root;
  const resolved = resolve(base, arg);
  return isPathInside(root, resolved) ? resolved : arg;
}

function splitPackageScript(value) {
  const matches = String(value ?? "").match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return matches.map((part) => part.replace(/^["']|["']$/g, ""));
}

function dedupeMcpServerCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = [
      candidate.transport,
      candidate.mcpAgent?.command ?? candidate.mcpAgent?.url ?? "",
      ...(candidate.mcpAgent?.args ?? []),
    ].join("\0");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizePathForMetadata(path) {
  return String(path ?? "").replace(/\\/g, "/");
}

function redactUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "http";
  }
}

function uniqueStringList(values) {
  return [...new Set((values ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))];
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
    throw new Error("Application source type must be git, local, npm, or manual.");
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
      wrapper: normalizeNpmWrapper(source.wrapper),
    };
  }
  return {
    type: "manual",
    uri: stringOrNull(source.uri),
    manifest: source.manifest && typeof source.manifest === "object" && !Array.isArray(source.manifest)
      ? source.manifest
      : {},
  };
}

function assertValidApplicationRegistrationSource(source) {
  const value = source && typeof source === "object" && !Array.isArray(source) ? source : null;
  if (!value) return;
  const type = String(value.type ?? "").trim().toLowerCase();
  if (type !== "npm" || !Object.hasOwn(value, "wrapper")) return;
  assertValidNpmWrapperDescriptor(value.wrapper, {
    path: stringOrNull(value.path),
    source: {
      path: stringOrNull(value.path),
      package: stringOrNull(value.package ?? value.packageName),
    },
  });
}

function normalizeApplicationMcpAgent(value, { applicationId, applicationName, applicationPath = null } = {}) {
  if (value === undefined || value === null || value === false) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Application mcpAgent must be an object.");
  }
  const adapterInput = value.adapter && typeof value.adapter === "object" && !Array.isArray(value.adapter)
    ? value.adapter
    : value;
  const config = normalizeMcpAdapterConfig(normalizeApplicationMcpAdapterInput(adapterInput, applicationPath));
  const toolNamespace = mcpToolSegment(value.toolNamespace ?? value.capabilityPrefix ?? applicationName ?? applicationId ?? "mcp");
  const riskTags = normalizeStringList(value.riskTags ?? value.capabilityRiskTags);
  return {
    agentId: sanitizeAgentId(value.agentId ?? value.id ?? `${applicationId ?? toolNamespace}_mcp`),
    name: stringOrNull(value.name) ?? `${applicationName ?? "Application"} MCP`,
    description: stringOrNull(value.description) ?? `MCP server registered with ${applicationName ?? "this application"}.`,
    adapter: { type: "mcp", ...config },
    allowedTools: config.allowedTools,
    toolNamespace,
    capabilityName: stringOrNull(value.capabilityName) ?? `${toolNamespace}_mcp_tool_call`,
    capabilityDescription: stringOrNull(value.capabilityDescription) ?? "Calls a tool exposed by the application's MCP server.",
    riskLevel: normalizeRiskLevel(value.riskLevel, "medium"),
    riskTags: riskTags.length ? riskTags : ["local_execution", "mcp", "application_asset"],
    recovery: {
      state: "registered",
      reason: config.allowedTools.length ? "mcp_agent_descriptor_saved" : "mcp_agent_registered_without_allowed_tools",
      nextAction: config.allowedTools.length
        ? "The runtime can restore the MCP agent and shared tool projection on restart."
        : "Run an MCP probe and save allowedTools before expecting shared capability projection.",
    },
  };
}

function normalizeApplicationMcpAdapterInput(adapterInput, applicationPath = null) {
  const root = applicationPath ? resolve(applicationPath) : null;
  if (!root || !existsSync(root)) return adapterInput;
  const next = { ...adapterInput, applicationPath: adapterInput.applicationPath ?? root };
  if (String(next.transport ?? "").trim() !== "stdio") return next;
  const cwd = stringOrNull(next.cwd);
  if (cwd) {
    const resolvedCwd = isAbsolute(cwd) ? resolve(cwd) : resolve(root, cwd);
    if (isPathInside(root, resolvedCwd)) next.cwd = resolvedCwd;
  }
  next.args = normalizeStringList(next.args).map((arg) => absolutizeMcpArg(arg, {
    root,
    cwd: next.cwd ?? root,
  }));
  return next;
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
  return "Application";
}

function normalizeApplicationKind(value, source) {
  const text = String(value ?? "").trim();
  if (text) return text;
  if (source.type === "npm") return "npm-package";
  if (source.type === "git" || source.type === "local") return "repository";
  return "manual";
}

function normalizeApplicationStatus(value) {
  const text = String(value ?? "").trim();
  return APPLICATION_STATUSES.has(text) ? text : "registered";
}

class ApplicationDescriptorValidationError extends Error {
  constructor(errors) {
    super("Application descriptor validation failed.");
    this.name = "ApplicationDescriptorValidationError";
    this.validationErrors = errors;
  }
}

function applicationWrapperPolicySupport(command) {
  const filePolicy = command?.filePolicy ?? "read_only";
  const networkPolicy = command?.networkPolicy ?? "forbidden";
  if (filePolicy !== "read_only" || networkPolicy !== "forbidden") {
    return {
      supported: false,
      reason: "Current Application wrapper consent model only supports read_only files and forbidden network access.",
    };
  }
  return { supported: true, reason: null };
}

function normalizeNpmWrapper(wrapper = {}) {
  const value = wrapper && typeof wrapper === "object" && !Array.isArray(wrapper) ? wrapper : {};
  const mode = NPM_WRAPPER_MODES.has(String(value.mode ?? "")) ? String(value.mode) : "metadata-only";
  const packageManager = ["npm", "pnpm", "yarn"].includes(String(value.packageManager ?? "")) ? String(value.packageManager) : "npm";
  return {
    mode,
    installState: mode === "installed-wrapper" ? normalizeWrapperInstallState(value.installState) : "not_installed",
    packageManager,
    installPath: stringOrNull(value.installPath),
    commands: normalizeWrapperCommands(value.commands),
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

function assertValidNpmWrapperDescriptor(wrapper, application) {
  const errors = validateNpmWrapperDescriptor(wrapper, application);
  if (errors.length) throw new ApplicationDescriptorValidationError(errors);
}

function validateNpmWrapperDescriptor(wrapper, application) {
  const errors = [];
  const value = wrapper && typeof wrapper === "object" && !Array.isArray(wrapper) ? wrapper : null;
  if (!value) {
    return [descriptorError("npmWrapper", "invalid_descriptor", "NPM wrapper descriptor must be a JSON object.")];
  }
  const mode = String(value.mode ?? "").trim();
  if (mode && !NPM_WRAPPER_MODES.has(mode)) {
    errors.push(descriptorError("npmWrapper.mode", "invalid_mode", "mode must be metadata-only or installed-wrapper."));
  }
  const packageManager = String(value.packageManager ?? "").trim();
  if (packageManager && !["npm", "pnpm", "yarn"].includes(packageManager)) {
    errors.push(descriptorError("npmWrapper.packageManager", "invalid_package_manager", "packageManager must be npm, pnpm, or yarn."));
  }
  const installPath = stringOrNull(value.installPath);
  const basePath = installPath ?? stringOrNull(application?.path ?? application?.source?.path);
  if (installPath && !isAbsolute(installPath)) {
    errors.push(descriptorError("npmWrapper.installPath", "relative_install_path", "installPath must be an absolute path."));
  }
  if (value.commands !== undefined && !Array.isArray(value.commands)) {
    errors.push(descriptorError("npmWrapper.commands", "invalid_commands", "commands must be an array."));
    return errors;
  }
  const commands = Array.isArray(value.commands) ? value.commands : [];
  if (commands.length > 30) {
    errors.push(descriptorError("npmWrapper.commands", "too_many_commands", "At most 30 wrapper commands can be declared."));
  }
  const ids = new Map();
  commands.slice(0, 30).forEach((command, index) => {
    validateNpmWrapperCommandDescriptor(command, index, { errors, ids, basePath });
  });
  return errors;
}

function validateNpmWrapperCommandDescriptor(command, index, { errors, ids, basePath }) {
  const path = `npmWrapper.commands[${index}]`;
  if (!command || typeof command !== "object" || Array.isArray(command)) {
    errors.push(descriptorError(path, "invalid_command", "Command must be a JSON object."));
    return;
  }
  const id = slugify(command.id ?? command.name ?? command.script ?? command.bin);
  if (!id) {
    errors.push(descriptorError(`${path}.id`, "missing_id", "Command requires id, name, script, or bin."));
  } else if (ids.has(id)) {
    errors.push(descriptorError(`${path}.id`, "duplicate_id", `Command id duplicates ${ids.get(id)}.`));
  } else {
    ids.set(id, `${path}.id`);
  }
  const commandType = String(command.commandType ?? (command.script ? "npm_script" : command.bin ? "bin" : "custom")).trim();
  if (command.commandType !== undefined && !["npm_script", "bin", "custom"].includes(commandType)) {
    errors.push(descriptorError(`${path}.commandType`, "invalid_command_type", "commandType must be npm_script, bin, or custom."));
  }
  const commandText = stringOrNull(command.command ?? command.script ?? command.bin);
  if (!commandText) {
    errors.push(descriptorError(`${path}.command`, "missing_command", "Command requires command, script, or bin."));
  } else {
    validateWrapperCommandText(commandText, commandType, `${path}.command`, errors);
  }
  validateWrapperCwd(command.cwd, `${path}.cwd`, basePath, errors);
  validateWrapperArgs(command.args, `${path}.args`, errors);
  validateWrapperArgInputDescriptors(command.argInputs, `${path}.argInputs`, errors);
  if (command.status !== undefined && !["draft", "approved", "disabled"].includes(String(command.status).trim())) {
    errors.push(descriptorError(`${path}.status`, "invalid_status", "status must be draft, approved, or disabled."));
  }
  if (command.filePolicy !== undefined && !["forbidden", "read_only", "workspace_write", "network"].includes(String(command.filePolicy).trim())) {
    errors.push(descriptorError(`${path}.filePolicy`, "invalid_file_policy", "filePolicy must be forbidden, read_only, workspace_write, or network."));
  }
  if (command.networkPolicy !== undefined && !["forbidden", "read_only", "workspace_write", "network"].includes(String(command.networkPolicy).trim())) {
    errors.push(descriptorError(`${path}.networkPolicy`, "invalid_network_policy", "networkPolicy must be forbidden, read_only, workspace_write, or network."));
  }
}

function validateWrapperCommandText(commandText, commandType, path, errors) {
  if (/[\r\n]/.test(commandText)) {
    errors.push(descriptorError(path, "invalid_command", "Command must not contain newlines."));
  }
  if (/[&|;<>()`$]/.test(commandText)) {
    errors.push(descriptorError(path, "shell_syntax_forbidden", "Command must be a discrete binary or npm script name, not shell syntax."));
  }
  if (commandType === "npm_script") {
    if (/^(pre|post)?(install|publish|pack|prepare|prepublish|prepack|postpack)$/.test(commandText)) {
      errors.push(descriptorError(path, "unsafe_lifecycle_script", "Unsafe npm lifecycle scripts cannot be approved as wrapper commands."));
    }
    if (/\s/.test(commandText) || commandText.startsWith("-")) {
      errors.push(descriptorError(path, "invalid_script_name", "npm_script command must be a single script name."));
    }
  }
  if (commandType === "custom" && /\s/.test(commandText)) {
    errors.push(descriptorError(path, "invalid_custom_command", "custom command must be one executable, with arguments declared in args."));
  }
}

function validateWrapperCwd(cwd, path, basePath, errors) {
  const text = stringOrNull(cwd) ?? ".";
  if (/[\r\n]/.test(text)) {
    errors.push(descriptorError(path, "invalid_cwd", "cwd must not contain newlines."));
    return;
  }
  if (!basePath) {
    if (isAbsolute(text)) errors.push(descriptorError(path, "absolute_cwd_without_base", "Absolute cwd requires an installPath or application path."));
    return;
  }
  const resolvedBase = resolve(basePath);
  const resolvedCwd = isAbsolute(text) ? resolve(text) : resolve(resolvedBase, text);
  if (!pathWithin(resolvedBase, resolvedCwd)) {
    errors.push(descriptorError(path, "cwd_escapes_application", "cwd must stay inside the Application install path."));
  }
}

function validateWrapperArgs(args, path, errors) {
  if (args === undefined) return;
  if (!Array.isArray(args)) {
    errors.push(descriptorError(path, "invalid_args", "args must be an array."));
    return;
  }
  args.slice(0, 100).forEach((arg, index) => {
    const value = String(arg ?? "");
    if (value.length > 400 || /[\r\n]/.test(value)) {
      errors.push(descriptorError(`${path}[${index}]`, "invalid_arg", "args entries must be short single-line strings."));
    }
  });
}

function validateWrapperArgInputDescriptors(argInputs, path, errors) {
  if (argInputs === undefined) return;
  if (!Array.isArray(argInputs)) {
    errors.push(descriptorError(path, "invalid_arg_inputs", "argInputs must be an array."));
    return;
  }
  const keys = new Set();
  for (const [index, entry] of argInputs.slice(0, 20).entries()) {
    const itemPath = `${path}[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(descriptorError(itemPath, "invalid_arg_input", "argInput must be a JSON object."));
      continue;
    }
    const key = String(entry.key ?? "").trim();
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key)) {
      errors.push(descriptorError(`${itemPath}.key`, "invalid_arg_input_key", "argInput key must be alphanumeric and start with a letter."));
    } else if (keys.has(key)) {
      errors.push(descriptorError(`${itemPath}.key`, "duplicate_arg_input_key", "argInput keys must be unique."));
    }
    keys.add(key);
    if (RESERVED_WRAPPER_ARG_INPUT_KEYS.has(key)) {
      errors.push(descriptorError(`${itemPath}.key`, "reserved_arg_input_key", "argInput key is reserved for platform control fields."));
    }
    if (!/^--[a-z0-9][a-z0-9-]*$/.test(String(entry.flag ?? "").trim())) {
      errors.push(descriptorError(`${itemPath}.flag`, "invalid_arg_input_flag", "argInput flag must be a --kebab-case option."));
    }
    if (entry.type !== undefined && !WRAPPER_ARG_INPUT_TYPES.has(String(entry.type))) {
      errors.push(descriptorError(`${itemPath}.type`, "invalid_arg_input_type", "argInput type is not supported."));
    }
  }
  if (argInputs.length > 20) {
    errors.push(descriptorError(path, "too_many_arg_inputs", "At most 20 argInputs can be declared."));
  }
}

function descriptorError(path, code, message) {
  return { path, code, message };
}

function pathWithin(base, candidate) {
  const rel = relative(base, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
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

function mcpToolSegment(value) {
  const text = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return text || "mcp";
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
  const mcp = app.mcpAgent?.allowedTools?.length
    ? ` MCP shared tools ${app.mcpAgent.allowedTools.length}.`
    : app.mcpAgent
      ? " MCP descriptor saved without shared tools."
      : counts.mcpServerCount
        ? ` MCP server candidates ${counts.mcpServerCount}.`
      : "";
  const suffix = ` Managed ${projectApplicationCapabilities(app).length}; declared ${counts.declaredCount ?? 0}; inferred ${counts.inferredCount ?? 0}.${mcp}`;
  if (app.source.type === "npm") return `NPM package ${app.source.package}@${app.source.version ?? "latest"} probed.${suffix}`;
  if (app.source.type === "git") return `Git source ${app.source.url} probed.${suffix}`;
  if (app.source.type === "local") return `Local application path ${app.source.path} probed.${suffix}`;
  return `Manual application manifest probed.${suffix}`;
}
