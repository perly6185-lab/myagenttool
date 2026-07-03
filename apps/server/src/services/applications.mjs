import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
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
