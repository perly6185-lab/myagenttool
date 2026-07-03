import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { teamOf } from "../runtime/auth.mjs";

const APPLICATION_SOURCE_TYPES = new Set(["git", "local", "npm", "manual"]);
const APPLICATION_STATUSES = new Set(["draft", "probing", "registered", "active", "offline", "archived", "failed"]);

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
      existing.ownerTeamId = actor?.teamId ?? body.ownerTeamId ?? existing.ownerTeamId ?? "team_local";
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
    let project = null;
    if (source.type === "git") {
      project = cloneProject({
        gitUrl: source.url,
        parentPath: body.parentDir ?? body.parentPath,
        name: body.folderName ?? name,
        host: body.host ?? "local",
        color: body.color,
        ownerTeamId: actor?.teamId ?? body.ownerTeamId,
      });
    } else if (source.type === "local") {
      project = addProject({
        name,
        path: source.path,
        host: body.host ?? "local",
        color: body.color,
        ownerTeamId: actor?.teamId ?? body.ownerTeamId,
      });
    }

    const app = {
      id: applicationId,
      name,
      kind: normalizeApplicationKind(body.kind, source),
      source,
      status: normalizeApplicationStatus(body.status ?? (body.autoOnline === false ? "registered" : "active")),
      lifecycle: {
        state: "registered",
        lastOperation: "register",
        lastOperationAt: createdAt,
      },
      projectId: project?.id ?? body.projectId ?? null,
      path: project?.path ?? source.path ?? null,
      ownerTeamId: actor?.teamId ?? body.ownerTeamId ?? project?.ownerTeamId ?? "team_local",
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
    app.probe = {
      status: "completed",
      checkedAt: probedAt,
      summary: probeSummary(app),
      capabilities: projectApplicationCapabilities(app).map((capability) => capability.name),
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
      data: { applicationId: app.id, capabilityCount: app.probe.capabilities.length },
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
    if (application.status === "offline" && !["inspect"].includes(action)) {
      return { ok: false, status: 409, body: { error: "application_offline", applicationId: application.id } };
    }
    if (["archive", "offline", "refresh"].includes(action) && !hasApprovalToken(input)) {
      return {
        ok: false,
        status: 409,
        body: {
          error: "approval_required",
          reason: `${action} requires an approvalToken in this application-control slice.`,
          applicationId: application.id,
          action,
        },
      };
    }

    const result = executeApplicationAction({ application, action, input, actor, defaultProjectPath });
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

  return {
    findApplication,
    invokeApplicationCapability,
    listApplicationCapabilities,
    listApplications,
    probeApplication,
    registerApplication,
    transitionApplication,
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
    managedCapability(app, `${prefix}.offline`, "Take application offline", "lifecycle", "high", ["lifecycle", "write_control"], true, app.status === "archived", approvalInputSchema()),
    managedCapability(app, `${prefix}.archive`, "Archive application", "lifecycle", "high", ["lifecycle", "write_control"], true, app.status === "archived", approvalInputSchema()),
    managedCapability(app, `${prefix}.generate_orchestration`, "Generate application orchestration", "orchestration", "medium", ["generated_artifact", "orchestration"], true, disabled, emptyInputSchema()),
  ];
}

function managedCapability(app, name, displayName, kind, riskLevel, riskTags, requiresApproval, disabled, inputSchema) {
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
  };
}

function emptyInputSchema() {
  return { type: "object", additionalProperties: false, properties: {} };
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
  const suffix = String(capabilityName ?? "").split(".").at(-1);
  return ["inspect", "search", "refresh", "offline", "archive", "generate_orchestration"].includes(suffix) ? suffix : null;
}

function hasApprovalToken(input) {
  return Boolean(input && typeof input === "object" && !Array.isArray(input) && String(input.approvalToken ?? "").trim());
}

function executeApplicationAction({ application, action, input, actor, defaultProjectPath }) {
  const executedAt = new Date().toISOString();
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
    const draft = writeApplicationRoutineDraft(application, defaultProjectPath);
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
        },
      },
    };
  }
  return {
    summary: `${application.name} application action ${action} completed.`,
    output: { source: "application", action, applicationId: application.id },
  };
}

function writeApplicationRoutineDraft(application, defaultProjectPath) {
  const root = resolve(application.path || defaultProjectPath || process.cwd());
  const routineId = `app-${slugify(application.name || application.id)}-maintenance`;
  const relativePath = join(".myagenttool", "routines", `${routineId}.json`).replaceAll("\\", "/");
  const path = resolve(root, relativePath);
  const routine = buildApplicationRoutineSpec(application, routineId);
  mkdirSync(join(root, ".myagenttool", "routines"), { recursive: true });
  writeFileSync(path, `${JSON.stringify(routine, null, 2)}\n`, "utf8");
  return {
    routineId,
    path,
    relativePath,
    status: "draft",
    generatedAt: new Date().toISOString(),
  };
}

function buildApplicationRoutineSpec(application, routineId) {
  const sourceLabel = application.source?.type ?? "application";
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
    orchestrationIds: application.orchestrationIds ?? [],
  };
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
    return { type, package: packageName, version: stringOrNull(source.version) ?? "latest" };
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

function probeSummary(app) {
  if (app.source.type === "npm") return `NPM package ${app.source.package}@${app.source.version ?? "latest"} registered.`;
  if (app.source.type === "git") return `Git source ${app.source.url} registered.`;
  if (app.source.type === "local") return `Local application path ${app.source.path} registered.`;
  return "Manual application manifest registered.";
}
