import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { normalizeLoopRoutine, validateLoopRoutine } from "../../../../tools/ai/src/loop/routine.mjs";
import { teamOf } from "../runtime/auth.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";
import { codingAgentInterfaceForTool } from "./coding-agent-interface.mjs";

// Consecutive failed health checks before an active application is auto-offlined
// (docs/design/APPLICATION_HEALTH_PROBE.md) — fixed, to avoid flapping on
// transient filesystem states.
const HEALTH_FAILURE_THRESHOLD = 2;

const APPLICATION_SOURCE_TYPES = new Set(["git", "local", "npm", "binary", "manual"]);

// A binary source names a bare program (`git`), never a path on disk. The bridge
// allowlist decides what may actually run; the caller does not get to name a path.
const BINARY_SOURCE_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
// A declarable credential scope must be read-only on its face (ADR 0010). The
// suffix is what a provider calls read: `gmail.readonly`, `drive.read`, `*.ro`.
// Anything else — send, write, modify, full, admin — is refused at registration.
const READ_ONLY_CREDENTIAL_SCOPE = /^[a-z][a-z0-9_.-]{0,63}\.(readonly|read|ro)$/;
const APPLICATION_STATUSES = new Set(["draft", "probing", "registered", "active", "offline", "archived", "failed"]);
const NPM_WRAPPER_MODES = new Set(["metadata-only", "installed-wrapper"]);
const APPLICATION_ROUTINE_REQUIRED_APPROVALS = ["apply", "push", "pr-create", "pr-merge"];
const APPLICATION_ROUTINE_RISK_LEVELS = ["low", "medium", "high", "critical"];
const APPLICATION_DESCRIPTOR_SCHEMA_VERSION = 1;

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
  store,
}) {
  const runTx = makeRunTx({ store, persistStateSoon });
  // Approval check behind every `approvalToken` field (docs/design/
  // APPROVAL_GRANTS.md): issued grants are validated + consumed; in phase 1 a
  // legacy free-text token still passes (stamped + counted by the validator).
  // Presence stays a hard requirement either way. FAIL CLOSED: if no validator
  // is wired, deny — the whole point of grants is that a side-effecting action
  // proves a specific approval, so a missing validator must never degrade to
  // "any non-empty string approves". The composed server always injects it
  // (service-composer); a null validator only happens in direct-construction
  // unit tests, which must pass a stub to exercise an approval gate.
  function approvalCheck(input, action, targetId, actor = null) {
    const token = input && typeof input === "object" && !Array.isArray(input) ? input.approvalToken : null;
    if (!String(token ?? "").trim()) return { approved: false, reason: "missing_token" };
    if (typeof validateApprovalToken !== "function") return { approved: false, reason: "approval_validator_unavailable" };
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
    const capabilityFacades = normalizeApplicationCapabilityFacades(body.capabilityFacades);
    // ADR 0014: the write-credential exception class. Invariant 2 (every
    // capability approval-gated) and invariant 3 (a separate Application —
    // the credential pair may not already belong to another registration)
    // need both the facades and the registry, so they live here rather than
    // in the credential normalizer.
    if (source.credential?.write === true) {
      if (capabilityFacades.some((facade) => facade.requiresApproval !== true)) {
        throw applicationRegistrationError(
          "application_write_capability_unapproved",
          "A write-credential Application must approval-gate every capability facade (ADR 0014); approval is the floor for write authority.",
        );
      }
      const pairHolder = (state.applications ?? []).find(
        (item) => item.source?.credential?.provider === source.credential.provider
          && item.source?.credential?.scope === source.credential.scope
          && !item.successorApplicationId,
      );
      if (pairHolder && pairHolder.id !== body.replacesApplicationId) {
        throw applicationRegistrationError(
          "application_write_credential_conflict",
          `Credential ${source.credential.provider}/${source.credential.scope} is already held by ${pairHolder.id}; a write credential is never shared (ADR 0014).`,
        );
      }
    }
    const descriptorSchemaVersion = normalizeDescriptorSchemaVersion(body.descriptorSchemaVersion);
    const descriptorFingerprint = fingerprintApplicationDescriptor(
      applicationDescriptor({ ...body, name, source, capabilityFacades }, descriptorSchemaVersion),
    );
    const replacementTarget = body.replacesApplicationId ? findApplication(String(body.replacesApplicationId)) : null;
    if (body.replacesApplicationId && (!replacementTarget || !actorCanAccessApplication(state, actor, replacementTarget))) {
      throw applicationRegistrationError("application_replacement_target_not_found", "Replacement target was not found.");
    }
    if (replacementTarget && !sameApplicationSourceIdentity(replacementTarget.source, source)) {
      throw applicationRegistrationError("application_replacement_identity_mismatch", "Replacement must keep the same Application source identity.");
    }
    const existing = replacementTarget
      ?? (requestedId ? findApplication(requestedId) : null)
      ?? findExistingApplicationBySource(state.applications ?? [], source);
    if (existing) {
      if (!actorCanAccessApplication(state, actor, existing)) {
        throw new Error("Application source is already registered.");
      }
      if (requestedId && requestedId !== existing.id && body.replacesApplicationId !== existing.id) {
        throw new Error(`Application source is already registered as ${existing.id}.`);
      }
      const existingFingerprint = existing.descriptorFingerprint
        ?? fingerprintApplicationDescriptor(applicationDescriptor(existing, existing.descriptorSchemaVersion));
      if (existingFingerprint === descriptorFingerprint) {
        return body.autoOnline !== false && existing.status === "registered"
          ? transitionApplication(existing.id, "online", actor)
          : existing;
      }
      if (body.replacesApplicationId !== existing.id) {
        throw applicationRegistrationError(
          "application_descriptor_conflict",
          `Application source is registered as immutable revision ${existing.id}; re-register with replacesApplicationId to replace it.`,
        );
      }
      return createApplicationRevision({ body, actor, source, name, requestedId, capabilityFacades, descriptorSchemaVersion, descriptorFingerprint, existing });
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
      capabilityFacades,
      descriptorSchemaVersion,
      descriptorFingerprint,
      descriptorRevision: 1,
      predecessorApplicationId: null,
      successorApplicationId: null,
      orchestrationIds: [],
      createdAt,
      updatedAt: createdAt,
    };
    runTx(() => {
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
        runTx(() => {
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
        });
      }).catch((error) => {
        runTx(() => {
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
        });
      });
    }
    return app;
  }

  function createApplicationRevision({ body, actor, source, name, requestedId, capabilityFacades, descriptorSchemaVersion, descriptorFingerprint, existing }) {
    if (existing.successorApplicationId) {
      throw applicationRegistrationError("application_already_replaced", `Application revision ${existing.id} was already replaced by ${existing.successorApplicationId}.`);
    }
    const applicationId = requestedId ?? sanitizeApplicationId(nextId("app"));
    if (applicationId === existing.id || findApplication(applicationId)) {
      throw applicationRegistrationError("application_revision_id_conflict", `Application revision id already exists: ${applicationId}.`);
    }
    const createdAt = now();
    const app = {
      id: applicationId,
      name,
      kind: normalizeApplicationKind(body.kind, source),
      source,
      status: normalizeApplicationStatus(body.status ?? (body.autoOnline === false ? "registered" : "active")),
      lifecycle: { state: "registered", lastOperation: "replace", lastOperationAt: createdAt },
      projectId: existing.projectId ?? body.projectId ?? null,
      path: existing.path ?? source.path ?? null,
      ownerTeamId: existing.ownerTeamId ?? actor?.teamId ?? "team_local",
      capabilitiesVersion: 1,
      capabilityFacades,
      descriptorSchemaVersion,
      descriptorFingerprint,
      descriptorRevision: Number(existing.descriptorRevision ?? 1) + 1,
      predecessorApplicationId: existing.id,
      successorApplicationId: null,
      orchestrationIds: [],
      createdAt,
      updatedAt: createdAt,
    };
    runTx(() => {
      existing.successorApplicationId = app.id;
      existing.status = existing.status === "archived" ? "archived" : "offline";
      existing.updatedAt = createdAt;
      state.applications.unshift(app);
      appendEvent({ invocationId: null, type: "application_descriptor_replaced", level: "warning", message: `${existing.name} application descriptor replaced by immutable revision ${app.id}.`, data: { applicationId: app.id, predecessorApplicationId: existing.id, descriptorFingerprint } });
    });
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
    return runTx(() => {
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
      return app;
    });
  }

  function probeApplication(applicationId, actor = null) {
    const app = findApplication(applicationId);
    if (!app) return null;
    const probedAt = now();
    const probe = buildApplicationProbe(app);
    return runTx(() => {
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
      return app;
    });
  }

  function listApplicationCapabilities(applicationId) {
    const app = findApplication(applicationId);
    return app ? projectApplicationCapabilities(app, { credential: credentialStatusForApplication(app) }) : null;
  }

  // Authorization as READINESS (ADR 0010): the control plane observes the
  // credential's state; it never mints, transports, stores, or reads one.
  //
  // Two independently-sourced facts meet here and nowhere else: what the DEVICE
  // reports it holds (provider + scope, never the secret) and what the immutable
  // DESCRIPTOR requires. The device is never told what the server wants, so it
  // cannot claim a match it does not have.
  //
  // Refusals are precise, in the #802 shape — `not_authorized` and
  // `scope_mismatch` are different problems with different fixes, and the
  // operator is told which, on which device, and what to run.
  function credentialStatusForApplication(app) {
    const required = app?.source?.credential ?? null;
    if (!required) return null;
    const device = state.device ?? null;
    const held = (device?.applicationCredentialReadiness ?? []).find((row) => row.applicationId === app.id);
    const base = { provider: required.provider, requiredScope: required.scope, deviceId: device?.id ?? null };
    if (!held) {
      return {
        ...base,
        status: "not_authorized",
        reason: "no_credential_on_device",
        checkedAt: device?.updatedAt ?? null,
        nextAction: `Run the ${required.provider} login flow on device ${device?.id ?? "(none registered)"} to grant ${required.scope}.`,
      };
    }
    if (held.provider !== required.provider || held.scope !== required.scope) {
      return {
        ...base,
        status: "not_authorized",
        // A held-but-wrong credential is NOT the same failure as a missing one:
        // the operator must re-consent to a different scope, not simply log in.
        reason: "scope_mismatch",
        heldScope: held.scope,
        heldProvider: held.provider,
        checkedAt: held.checkedAt,
        nextAction: `Device ${device?.id ?? "?"} holds ${held.provider} scope "${held.scope}", but this application requires "${required.scope}". Re-run the login flow and consent to ${required.scope}.`,
      };
    }
    return { ...base, status: "authorized", reason: "credential_present", checkedAt: held.checkedAt, nextAction: null };
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

    return runTx(() => {
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
      return { ok: true, application, action, result };
    });
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

  // Plan an agent-facade capability invocation (#975). Same split as the wrapper
  // planner: every guard that belongs to the APPLICATION — tenancy, lifecycle
  // status, the facade's declared approval requirement — is applied here; the
  // capability service owns what belongs to the AGENT (existence, status, its
  // own allowedTools). Two independent layers on purpose, like every other
  // boundary in this registry: a mis-pointed descriptor still cannot reach a
  // tool the agent's own registration does not allow.
  function planAgentFacadeInvocation({ applicationId, facadeId, input = {}, actor = null } = {}) {
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
    const facade = (application.capabilityFacades ?? []).find((candidate) => candidate.id === facadeId && candidate.agentId);
    if (!facade) {
      return { ok: false, status: 404, body: { error: "agent_facade_not_found", applicationId, facadeId } };
    }
    // ADR 0014: a gate-only facade refuses direct invocation outright — its
    // server gate is the only path, because the gate (not the caller) resolves
    // the payload. Without this, a caller holding a grant could pass free-form
    // toolArguments straight to the agent.
    if (facade.directInvocation === false) {
      return { ok: false, status: 409, body: { error: "capability_gate_only", message: "This capability executes only through its dedicated server gate; direct invocation is disabled by the descriptor.", applicationId, facadeId } };
    }
    if (facade.requiresApproval) {
      const approval = approvalCheck(input, `agent:${facadeId}`, applicationId, actor);
      if (!approval.approved) {
        return { ok: false, status: 409, body: { error: "approval_required", reason: approval.reason === "missing_token" ? "This agent-facade capability requires an explicit approvalToken." : `approvalToken rejected: ${approval.reason}.`, applicationId } };
      }
    }
    return {
      ok: true,
      facade: {
        agentId: facade.agentId,
        toolName: facade.agentToolName ?? null,
        outputCollection: facade.outputCollection,
      },
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
      return runTx(() => {
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
        return app;
      });
    }
    if (typeof body.enabled !== "boolean") {
      throw new Error("auto-recovery configuration requires enabled: boolean.");
    }
    const maxAttempts = body.maxAttempts == null ? 2 : Number(body.maxAttempts);
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
      throw new Error("auto-recovery maxAttempts must be an integer between 1 and 5.");
    }
    return runTx(() => {
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
      return app;
    });
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
    return runTx(() => {
      app.healthProbe = { enabled: body.enabled, intervalMinutes, lastCheckedAt: app.healthProbe?.lastCheckedAt ?? null };
      app.updatedAt = now();
      appendEvent({
        invocationId: null,
        type: "application_health_probe_configured",
        level: "info",
        message: `Application ${app.name} health probe ${body.enabled ? `enabled (every ${intervalMinutes}m)` : "disabled"}.`,
        data: { applicationId: app.id, enabled: body.enabled, intervalMinutes, actorId: actor?.userId ?? null },
      });
      return app;
    });
  }

  // One health check: source availability. local/git check the materialized
  // path; npm and binary sources have no path, so derive a real signal from the
  // most recent run (#885, #906) — a missing/broken binary (e.g. the git app on a
  // device without git) shows as unhealthy on the next sweep, not only when the
  // next invocation fails. manual stays `unsupported`. Never a fabricated verdict.
  function checkApplicationHealth(app) {
    const supported = ["local", "git"].includes(app.source?.type) && typeof app.path === "string" && app.path;
    if (supported) {
      return existsSync(app.path)
        ? { status: "healthy", reason: null }
        : { status: "unhealthy", reason: `source path ${app.path} does not exist` };
    }
    if (["npm", "binary"].includes(app.source?.type)) {
      return checkApplicationHealthFromRuns(app);
    }
    // A credential-backed application HAS something to check, even with no local
    // materialization: is the device still authorized? A token revoked in the
    // provider's account is exactly the "the app should be offline" case this
    // probe exists for — so it is health, not `unsupported`. A revocation
    // auto-degrades to offline through the ordinary path; recovery still never
    // auto-onlines (re-enabling execution stays a human, approval-gated act).
    const credential = credentialStatusForApplication(app);
    if (credential) {
      return credential.status === "authorized"
        ? { status: "healthy", reason: null }
        : { status: "unhealthy", reason: `${credential.reason}: ${credential.nextAction}` };
    }
    return { status: "unsupported", reason: `source type ${app.source?.type ?? "unknown"} has no local materialization to check` };
  }

  // Derive an npm app's health from its newest terminal run: a failed run (e.g.
  // exit 127 = binary not installed) is unhealthy; a success is healthy; no runs
  // yet stays `unsupported` (never a guessed verdict).
  function checkApplicationHealthFromRuns(app) {
    const terminal = new Set(["succeeded", "failed", "cancelled", "timed_out", "expired", "rejected"]);
    const latest = (state.invocations ?? [])
      .filter((inv) => inv.options?.metadata?.applicationId === app.id && terminal.has(inv.status))
      .sort((a, b) => String(b.completedAt ?? b.createdAt ?? "").localeCompare(String(a.completedAt ?? a.createdAt ?? "")))[0];
    if (!latest) {
      return { status: "unsupported", reason: "npm source has no completed run yet to derive health from" };
    }
    if (latest.status === "succeeded") {
      return { status: "healthy", reason: null };
    }
    const detail = latest.result?.output?.error ?? latest.result?.summary ?? `run ${latest.status}`;
    return { status: "unhealthy", reason: `last run ${latest.status}: ${String(detail).slice(0, 200)}` };
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
    runTx(() => {
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
    });
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
    planAgentFacadeInvocation,
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
const WRAPPER_ARG_INPUT_TYPES = new Set(["date", "token", "enum", "string", "boolean-flag", "git-rev", "count", "props", "json_commands"]);
const RESERVED_WRAPPER_ARG_INPUT_KEYS = new Set([
  "approvalToken",
  "idempotencyKey",
  "permissionLevel",
  "permissionMode",
  "applicationWrapper",
  // Control-plane keys on the capability input, not application inputs (#847).
  // An application must not be able to declare an argInput that collides with the
  // fields the scheduler uses to attribute a run to its schedule.
  "automationId",
  "scheduled",
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
    return {
      key,
      flag,
      positional,
      type,
      values: type === "enum" ? normalizeStringList(entry.values) : [],
      // For a json_commands input, the closed set of item verbs (`command` field)
      // the batch may contain — the write-verb allowlist. Mirrors enum's `values`.
      verbs: type === "json_commands" ? normalizeStringList(entry.verbs) : [],
    };
  });
}

// Turn a caller's input into args, appending ONLY declared flags whose value
// passes its type validator. Undeclared keys are ignored; a value that looks like
// a flag (leading "-") is refused so it can never inject a new option.
//
// `positionalsFirst` flips the order to `positionals then flags` — some CLIs
// (e.g. `officecli set <file> <path> --prop k=v`) require the subject positionals
// before their options. Default is flags-then-positionals (git/ccusage contract).
function resolveWrapperInputArgs(argInputs, input, { positionalsFirst = false } = {}) {
  if (!Array.isArray(argInputs) || !input || typeof input !== "object" || Array.isArray(input)) return [];
  const flagArgs = [];
  const positionalArgs = [];
  for (const spec of argInputs) {
    const raw = input[spec.key];
    if (raw === undefined || raw === null) continue;
    if (spec.type === "props") {
      // A repeatable `--prop key=value` map (e.g. officecli set/add props). Each
      // pair is validated independently — an identifier key + a bounded, control-
      // char-free value — and emitted as a discrete `--prop key=value` argv token.
      // Never a scalar; a malformed or oversized pair is dropped, not injected.
      if (typeof raw !== "object" || Array.isArray(raw)) continue;
      let count = 0;
      for (const [propKey, propValue] of Object.entries(raw)) {
        if (count >= 30) break;
        if (!/^[a-zA-Z][a-zA-Z0-9._-]{0,39}$/.test(propKey)) continue;
        const propText = String(propValue ?? "");
        if (propText.length > 200 || /[\r\n]/.test(propText)) continue;
        flagArgs.push(spec.flag, `${propKey}=${propText}`);
        count += 1;
      }
      continue;
    }
    if (spec.type === "json_commands") {
      // A batch operation list (officecli batch --commands <json>). Accept a JS
      // array or a JSON string; it MUST parse to an array of ≤100 objects, each
      // with a `command` in the declared write-verb allowlist. The whole list is
      // re-serialized compactly and emitted as one --commands token. A malformed
      // list, an unlisted verb, or an oversized payload drops the input entirely
      // (never a partial or unvalidated batch).
      const list = normalizeJsonCommands(raw, spec.verbs);
      if (list) flagArgs.push(spec.flag, list);
      continue;
    }
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
  // Default: positionals AFTER all flags, in declaration order (#777). With
  // positionalsFirst, the subject positionals lead (officecli set/add).
  return positionalsFirst ? [...positionalArgs, ...flagArgs] : [...flagArgs, ...positionalArgs];
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

const JSON_COMMANDS_MAX_ITEMS = 100;
const JSON_COMMANDS_MAX_BYTES = 16 * 1024;

// Validate + compact a batch operation list. `raw` may be a JS array or a JSON
// string; `allowedVerbs` is the closed set the `command` field may take. Returns
// a compact JSON string, or null if anything is off — a batch is all-or-nothing,
// never a partial or unvalidated list. The verb allowlist is the governance
// boundary; per-item document fields (path/props/type) are officecli semantics.
function normalizeJsonCommands(raw, allowedVerbs) {
  const verbs = new Set(Array.isArray(allowedVerbs) ? allowedVerbs : []);
  let list = raw;
  if (typeof raw === "string") {
    try { list = JSON.parse(raw); } catch { return null; }
  }
  if (!Array.isArray(list) || list.length === 0 || list.length > JSON_COMMANDS_MAX_ITEMS) return null;
  for (const item of list) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    if (!verbs.has(String(item.command))) return null;
  }
  const compact = JSON.stringify(list);
  if (compact.length > JSON_COMMANDS_MAX_BYTES) return null;
  return compact;
}

// A wrapper command's capability segment. Read commands live under `.wrapper.`;
// a write-capable command opts into `.apply.` so the device classifies and gates
// it under a distinct WRITE policy kind (officecliApply), never the read-only
// wrapper bucket that git/ccusage/claude share. Defaults to "wrapper", so every
// existing app's capability names stay byte-identical.
function wrapperSegment(command) {
  return command?.segment === "apply" ? "apply" : "wrapper";
}

export function applicationWrapperExecutionPlan(application, commandId, input = {}) {
  const command = findNpmWrapperCommand(application, commandId);
  if (!command) return null;
  return {
    capability: `app.${slugify(application.id || application.name)}.${wrapperSegment(command)}.${command.id}`,
    commandId: command.id,
    commandType: command.commandType,
    command: command.command,
    // Base args + only the declared, validated per-invocation flag inputs.
    args: [...command.args, ...resolveWrapperInputArgs(command.argInputs, input, { positionalsFirst: command.argOrder === "positionals_first" })],
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

// `context.credential` is the device-vs-descriptor authorization verdict, when
// the service has state to compute it from. Projection itself stays pure: the
// verdict is passed in, never fetched here.
export function projectApplicationCapabilities(app, context = {}) {
  const prefix = `app.${slugify(app.id || app.name)}`;
  const disabled = app.status === "offline" || app.status === "archived";
  return withCredentialReadiness([
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
    ...projectCapabilityFacades(app, prefix, disabled),
    ...projectWrapperCapabilities(app, prefix, disabled),
  ], context.credential);
}

// Overlay the authorization verdict onto the capabilities that actually depend
// on it: an agent_facade whose Application declares a credential requirement.
// A capability the credential does not gate (inspect, search, lifecycle) is left
// alone — an unauthorized mailbox must not make "inspect this application" look
// broken.
//
// A `disabled` capability keeps its disabled readiness: the application being
// offline is the more fundamental fact, and overwriting it would hide it.
function withCredentialReadiness(capabilities, credential) {
  if (!credential) return capabilities;
  return capabilities.map((capability) => {
    if (capability.kind !== "agent_facade" || capability.metadata?.readiness?.state === "disabled") return capability;
    const authorized = credential.status === "authorized";
    return {
      ...capability,
      metadata: {
        ...capability.metadata,
        readiness: {
          ...capability.metadata.readiness,
          state: authorized ? capability.metadata.readiness.state : "needs_setup",
          reason: authorized ? capability.metadata.readiness.reason : credential.reason,
          // The verdict travels with the capability so the console can render
          // "why" and "what to do" without a second call. It carries provider,
          // scopes, device, and the next action — and, by construction, nothing
          // that could be a secret.
          credential,
        },
      },
    };
  });
}

function projectCapabilityFacades(app, prefix, disabled) {
  return (app.capabilityFacades ?? []).map((facade) => {
    // The mode name is load-bearing audit metadata: it records WHICH trust
    // regime execution was delegated to. A Tool is a platform-curated contract;
    // a registered Agent is user-registered code. Projecting agents as Tools
    // would launder that provenance, so each keeps its own mode (#975).
    const isAgentFacade = Boolean(facade.agentId);
    const interfaceContract = codingAgentInterfaceForTool(facade.toolName ?? facade.agentToolName, { outputCollection: facade.outputCollection });
    return managedCapability(
      app,
      `${prefix}.${facade.id}`,
      facade.displayName,
      isAgentFacade ? "agent_facade" : "tool_facade",
      facade.riskLevel,
      facade.riskTags,
      facade.requiresApproval,
      disabled,
      facade.inputSchema,
      isAgentFacade
        ? {
            compatibilityFacade: { type: "agent", name: facade.agentId },
            execution: { mode: "agent_facade", agentId: facade.agentId, toolName: facade.agentToolName ?? null },
            outputCollection: facade.outputCollection,
            resultImport: facade.resultImport ?? null,
            ...(interfaceContract ? { interface: interfaceContract } : {}),
          }
        : {
            compatibilityFacade: { type: "tool", name: facade.toolName },
            execution: { mode: "tool_facade", toolName: facade.toolName },
            outputCollection: facade.outputCollection,
            resultImport: facade.resultImport ?? null,
            ...(interfaceContract ? { interface: interfaceContract } : {}),
          },
    );
  });
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
      `${prefix}.${wrapperSegment(command)}.${command.id}`,
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
  if (kind === "agent_facade") {
    // Projection is pure — it cannot see the live agent. The capability service
    // overlays the agent's actual status (missing/disabled) where findAgent is
    // available; the invocation guard refuses precisely either way.
    return {
      state: "ready",
      reason: "delegates_to_registered_agent",
      applicationStatus: app.status,
      executionMode: "agent_facade",
      agentId: metadata?.execution?.agentId ?? null,
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
        type: wrapperArgInputJsonType(input.type),
        ...(input.values?.length ? { enum: input.values } : {}),
      },
    ])),
  };
}

// The capability input-schema type for an argInput. Only `props` needs a real
// JSON type (a key→value map is an object, and the input must validate as one);
// every pre-existing type keeps emitting its raw string verbatim, so existing
// apps' projected schemas stay byte-identical (a pinned-fixture invariant).
function wrapperArgInputJsonType(type) {
  if (type === "props") return "object";
  if (type === "json_commands") return "array";
  return type;
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
  // Both `.wrapper.` (read) and `.apply.` (write) wrapper commands map to the same
  // `wrapper:<id>` governance action — resolution is by command id, and the write
  // policy is enforced at the device, not in the action label.
  const match = String(capabilityName ?? "").match(/\.(?:wrapper|apply)\.([a-z0-9._-]+)$/);
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
    descriptorSchemaVersion: application.descriptorSchemaVersion ?? APPLICATION_DESCRIPTOR_SCHEMA_VERSION,
    descriptorFingerprint: application.descriptorFingerprint ?? null,
    descriptorRevision: application.descriptorRevision ?? 1,
    predecessorApplicationId: application.predecessorApplicationId ?? null,
    successorApplicationId: application.successorApplicationId ?? null,
  };
}

function normalizeDescriptorSchemaVersion(value) {
  const version = value == null ? APPLICATION_DESCRIPTOR_SCHEMA_VERSION : Number(value);
  if (!Number.isInteger(version) || version !== APPLICATION_DESCRIPTOR_SCHEMA_VERSION) {
    throw applicationRegistrationError("unsupported_application_descriptor_schema", `Unsupported Application descriptor schema version: ${value}.`);
  }
  return version;
}

function applicationDescriptor(body, descriptorSchemaVersion = APPLICATION_DESCRIPTOR_SCHEMA_VERSION) {
  return {
    schemaVersion: descriptorSchemaVersion ?? APPLICATION_DESCRIPTOR_SCHEMA_VERSION,
    name: normalizeApplicationName(body.name ?? nameFromSource(body.source)),
    kind: normalizeApplicationKind(body.kind, body.source),
    source: body.source,
    capabilityFacades: normalizeApplicationCapabilityFacades(body.capabilityFacades),
  };
}

function fingerprintApplicationDescriptor(descriptor) {
  return `sha256:${createHash("sha256").update(stableJson(descriptor)).digest("hex")}`;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function applicationRegistrationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeApplicationCapabilityFacades(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw applicationRegistrationError("invalid_application_capability_facades", "Application capabilityFacades must be an array.");
  const seen = new Set();
  return value.map((facade) => {
    if (!facade || typeof facade !== "object" || Array.isArray(facade)) {
      throw applicationRegistrationError("invalid_application_capability_facade", "Application capability facade must be an object.");
    }
    const id = slugify(facade.id);
    const toolName = stringOrNull(facade.toolName);
    const agentId = stringOrNull(facade.agentId);
    const agentToolName = stringOrNull(facade.agentToolName);
    if (!id || seen.has(id)) {
      throw applicationRegistrationError("invalid_application_capability_facade", "Application capability facade requires a unique id.");
    }
    // A facade delegates to exactly one kind of governed executor, and the
    // descriptor must say which: a Tool (platform-curated contract) or a
    // registered Agent (user-registered execution identity). The two trust
    // regimes are different, so the shape refuses to blur them — one of
    // toolName / agentId, never both, never neither (#975).
    if (Boolean(toolName) === Boolean(agentId)) {
      throw applicationRegistrationError("invalid_application_capability_facade", "Application capability facade requires exactly one of toolName (tool facade) or agentId (agent facade).");
    }
    if (agentToolName && !agentId) {
      throw applicationRegistrationError("invalid_application_capability_facade", "agentToolName is only valid on an agent facade (agentId).");
    }
    seen.add(id);
    return {
      id,
      toolName,
      agentId,
      // Which tool on the agent this capability calls (MCP servers can expose
      // several). Null lets the bridge's single-tool auto-resolution apply.
      agentToolName,
      // ADR 0014: a gate-only facade is discoverable but not directly invokable —
      // its execution goes through a dedicated server gate that resolves the
      // inputs itself (mail.send resolves everything from the confirmed draft).
      // Default true: ordinary facades are unaffected.
      directInvocation: facade.directInvocation !== false,
      displayName: stringOrNull(facade.displayName) ?? id,
      description: stringOrNull(facade.description),
      riskLevel: normalizeRiskLevel(facade.riskLevel, "medium"),
      riskTags: normalizeStringList(facade.riskTags),
      requiresApproval: facade.requiresApproval === true,
      inputSchema: facade.inputSchema && typeof facade.inputSchema === "object" && !Array.isArray(facade.inputSchema)
        ? publicJsonObject(facade.inputSchema)
        : emptyInputSchema(),
      outputCollection: stringOrNull(facade.outputCollection) ?? "invocations",
      // A facade may declare how to import its result, exactly like a wrapper
      // command. Same generic mechanism (application-results RESULT_PARSERS), so
      // a new importing application adds a parser, not a branch in completion.
      resultImport: normalizeFacadeResultImport(facade.resultImport),
    };
  });
}

function normalizeFacadeResultImport(resultImport) {
  if (resultImport == null) return null;
  if (typeof resultImport !== "object" || Array.isArray(resultImport)) {
    throw applicationRegistrationError("invalid_application_capability_facade", "Application capability facade resultImport must be an object.");
  }
  const source = stringOrNull(resultImport.source);
  if (!source) return null;
  return { source, kind: stringOrNull(resultImport.kind) };
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
    const wrapper = normalizeWrapperDescriptor(source.wrapper, { npm: false });
    // Defence in depth (#865): a binary source's wrapper command may ONLY invoke
    // the declared binary itself — not an arbitrary program. The bridge allowlist
    // is the primary gate, but without this the server would happily PLAN (and, if
    // the caller set status:"approved", dispatch) a command like `/bin/sh -c ...`
    // registered under `binary:"git"` — a latent RCE the moment any consumer trusts
    // the server's "approved" plan or the device allowlist is loosened. Whether a
    // user may register an executable binary Application at all is ADR #803; this
    // only stops one from masquerading as a different program than it declares.
    for (const command of wrapper.commands) {
      if (command.command !== binary) {
        throw new Error(`Binary application command "${command.id}" must invoke "${binary}", not "${command.command}".`);
      }
    }
    return { type, binary, wrapper };
  }
  return {
    type: "manual",
    uri: stringOrNull(source.uri),
    credential: normalizeCredentialRequirement(source.credential),
    manifest: source.manifest && typeof source.manifest === "object" && !Array.isArray(source.manifest)
      ? source.manifest
      : {},
  };
}

// A credential REQUIREMENT — never a credential (ADR 0010). The descriptor pins
// the authority the application's agent must hold (`provider` + `scope`); the
// secret itself lives with the process that uses it, in the device's credential
// store, and never enters the registry, persisted state, or an audit record.
//
// Because the descriptor is immutable (ADR 0009), widening `scope` is a
// re-registration — a reviewed event — while rotating the secret behind it is
// free. Permission change and key rotation are different things, and this is
// what keeps them apart.
function normalizeCredentialRequirement(credential) {
  if (credential == null) return null;
  if (typeof credential !== "object" || Array.isArray(credential)) {
    throw new Error("Application source credential must be an object.");
  }
  const provider = String(credential.provider ?? "").trim().toLowerCase();
  const scope = String(credential.scope ?? "").trim();
  if (!/^[a-z][a-z0-9_.-]{0,31}$/.test(provider)) {
    throw new Error("Application credential provider must be a bare provider name.");
  }
  if (!scope) {
    throw new Error("Application credential requires a scope.");
  }
  // ADR 0014: the write-credential exception class. Declaring it takes an
  // explicit `write: true` plus a non-empty justification; the class's other
  // invariants (every capability approval-gated; the credential pair unique)
  // are enforced in registerApplication where facades and registry are visible.
  if (credential.write === true) {
    const justification = String(credential.justification ?? "").trim();
    if (!justification) {
      throw applicationRegistrationError(
        "application_write_credential_invalid",
        "A write-credential Application requires credential.justification (ADR 0014).",
      );
    }
    return { provider, scope, write: true, justification: justification.slice(0, 500) };
  }
  // Read-only by construction. A registration may not declare a write-capable
  // scope: read and write authority never share a credential (ADR 0010); a
  // write-capable scope needs the ADR 0014 write-credential class — an explicit
  // `credential.write: true` with its own invariants — never a quiet widening
  // of a read registration.
  if (!READ_ONLY_CREDENTIAL_SCOPE.test(scope)) {
    throw new Error(`Application credential scope "${scope}" is not read-only; a write-capable scope needs the ADR 0014 write-credential class (credential.write: true), a separately consented credential — never a widening of this one.`);
  }
  return { provider, scope };
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
    // The capability segment: "apply" for a write command (routed to the device's
    // write policy), else "wrapper" (read). Preserved through registration so the
    // projected capability name and the device classification agree.
    segment: command.segment === "apply" ? "apply" : "wrapper",
    // Argv ordering: "positionals_first" emits subject positionals before flags
    // (officecli set/add). Default "flags_first" keeps git/ccusage byte-identical.
    argOrder: command.argOrder === "positionals_first" ? "positionals_first" : "flags_first",
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

function sameApplicationSourceIdentity(left, right) {
  if (left?.type !== right?.type) return false;
  if (left.type === "npm") return left.package === right.package;
  if (left.type === "binary") return left.binary === right.binary;
  if (left.type === "git") return left.url === right.url && (left.ref ?? null) === (right.ref ?? null);
  if (left.type === "local") return left.path === right.path;
  return left.uri === right.uri;
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

// Exported so the schedule-health read model derives an application's capability
// prefix with the SAME function that mints it (#848). A second copy of this rule
// would drift, and a schedule would then be attributed to no application at all —
// silently, since a schedule with no owner simply stops appearing anywhere.
export function slugify(value) {
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
