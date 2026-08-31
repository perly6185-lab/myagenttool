import { makeRunTx } from "../runtime/store/run-tx.mjs";
import { HostWebsiteHealthCheckError } from "./host-website-health.mjs";
import { normalizeSshFingerprint, SshHostConnectorError } from "./ssh-host-connector.mjs";

const PLAN_TTL_MS = 10 * 60_000;
const DIAGNOSTIC_TTL_MS = 10 * 60_000;
const MAX_REMEDIATION_PLANS_PER_USER = 50;
const POST_RELOAD_HEALTH_ATTEMPTS = 4;
const POST_RELOAD_HEALTH_DELAY_MS = 250;
const TERMINAL_STATUSES = new Set(["not_needed", "completed", "completed_unresolved", "failed", "outcome_unknown"]);
const ACTIVE_BINDING_STATUSES = new Set(["staging_deployed", "active"]);
const SHA256_HEX = /^[a-f0-9]{64}$/;

export class HostRemediationError extends SshHostConnectorError {
  constructor(code, message, status = 400) {
    super(code, message);
    this.name = "HostRemediationError";
    this.status = status;
  }
}

function failure(error) {
  if (error instanceof HostRemediationError) return { ok: false, status: error.status, error: error.code };
  if (error instanceof HostWebsiteHealthCheckError) return { ok: false, status: 409, error: error.code };
  if (error instanceof SshHostConnectorError) return { ok: false, status: 502, error: error.code };
  return { ok: false, status: 502, error: "host_remediation_failed" };
}

function revisionOf(record) {
  return Number.isInteger(record?.revision) && record.revision > 0 ? record.revision : 1;
}

function connectionReady(target) {
  return target?.connectionStatus === "ready"
    && target.trustStatus === "pinned"
    && Boolean(normalizeSshFingerprint(target.knownHostFingerprint))
    && !target.agentForwarding;
}

function healthSummary(value) {
  const status = value?.status === "healthy" ? "healthy" : "unhealthy";
  const reason = [
    "website_healthy",
    "website_timeout",
    "website_unreachable",
    "website_certificate_invalid",
    "website_certificate_mismatch",
    "website_http_error",
    "website_content_mismatch",
  ].includes(value?.reason) ? value.reason : "website_unreachable";
  return {
    status,
    reason,
    statusCodeClass: Number.isInteger(value?.statusCodeClass) ? value.statusCodeClass : null,
    contentMatched: value?.contentMatched === true,
    checkedAt: String(value?.checkedAt ?? ""),
  };
}

export function createHostRemediationService({
  state,
  now,
  nextId,
  appendEvent,
  persistStateSoon,
  resolveCredential,
  sshHostConnector,
  checkWebsiteHealth,
  store,
  wait = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
}) {
  const runTx = makeRunTx({ store, persistStateSoon });
  state.hostDiagnosticRuns ??= [];
  state.hostRemediationPlans ??= [];

  async function checkWebsiteAfterPossibleReload(healthTarget) {
    let health;
    for (let attempt = 0; attempt < POST_RELOAD_HEALTH_ATTEMPTS; attempt += 1) {
      health = healthSummary(await checkWebsiteHealth(healthTarget));
      if (health.reason !== "website_unreachable" || attempt === POST_RELOAD_HEALTH_ATTEMPTS - 1) break;
      await wait(POST_RELOAD_HEALTH_DELAY_MS);
    }
    return health;
  }

  function contextFor(target, profileId) {
    const profile = state.hostTlsActivationProfiles?.find((item) => item.id === profileId
      && item.sshTargetId === target.id
      && item.ownerTeamId === target.ownerTeamId);
    if (!profile || profile.status !== "ready" || profile.type !== "docker_nginx") {
      throw new HostRemediationError("host_remediation_profile_not_ready", "Choose a ready managed website service.", 409);
    }
    const scope = state.hostFileScopes?.find((item) => item.id === profile.certificateScopeId
      && item.sshTargetId === target.id
      && item.ownerTeamId === target.ownerTeamId);
    if (!scope || scope.status !== "ready" || scope.purpose !== "tls_certificate" || !scope.lastResolvedAddress) {
      throw new HostRemediationError("host_remediation_scope_not_ready", "The managed website service is no longer bound to a verified host range.", 409);
    }
    const bindings = state.siteDomainTlsBindings?.filter((item) => item.ownerTeamId === target.ownerTeamId
      && item.activationProfileId === profile.id
      && item.certificateScopeId === scope.id
      && ACTIVE_BINDING_STATUSES.has(item.status)) ?? [];
    if (bindings.length !== 1) {
      throw new HostRemediationError("host_remediation_website_binding_not_ready", "Bind this service to one active managed website before repairing it.", 409);
    }
    const binding = bindings[0];
    const deploymentTarget = state.siteDeploymentTargets?.find((item) => item.id === binding.deploymentTargetId
      && item.ownerTeamId === target.ownerTeamId
      && item.kind === "ssh_static"
      && item.customDomain === binding.hostname) ?? null;
    const publishScope = deploymentTarget ? state.hostFileScopes?.find((item) => item.id === deploymentTarget.remoteProjectRef
      && item.ownerTeamId === target.ownerTeamId
      && item.sshTargetId === target.id
      && item.purpose === "site_publish"
      && item.status === "ready") : null;
    const site = state.sites?.find((item) => item.id === binding.siteId && item.ownerTeamId === target.ownerTeamId) ?? null;
    const publication = site?.activePublicationId ? state.sitePublications?.find((item) => item.id === site.activePublicationId
      && item.siteId === site.id
      && item.ownerTeamId === target.ownerTeamId
      && item.status === "active") : null;
    const verification = publication?.remoteDeployment?.provider === "ssh_static" ? publication.remoteDeployment.verification : null;
    const contentHash = String(verification?.contentHash ?? "").toLowerCase();
    const contentBytes = Number(verification?.contentBytes);
    if (!deploymentTarget || !publishScope || publishScope.lastResolvedAddress !== scope.lastResolvedAddress || !site || !publication
      || !SHA256_HEX.test(String(binding.certificateFingerprint ?? "").toLowerCase())
      || !SHA256_HEX.test(contentHash) || !Number.isSafeInteger(contentBytes) || contentBytes < 1) {
      throw new HostRemediationError("host_remediation_website_binding_not_ready", "The managed website does not have a verified active release.", 409);
    }
    return {
      profile,
      scope,
      binding,
      site,
      publication,
      healthTarget: {
        address: scope.lastResolvedAddress,
        hostname: binding.hostname,
        certificateFingerprint: String(binding.certificateFingerprint).toLowerCase(),
        certificateEnvironment: binding.certificateEnvironment,
        expectedContentHash: contentHash,
        expectedContentBytes: contentBytes,
      },
    };
  }

  function diagnosticFor(target, diagnosticRunId, actor) {
    const run = state.hostDiagnosticRuns.find((item) => item.id === diagnosticRunId
      && item.sshTargetId === target.id
      && item.ownerTeamId === target.ownerTeamId
      && item.createdByUserId === (actor?.userId ?? "usr_local"));
    if (!run) throw new HostRemediationError("host_remediation_diagnostic_not_found", "Run a website check before preparing a repair.", 409);
    if (run.intent !== "website") throw new HostRemediationError("host_remediation_diagnostic_not_applicable", "This check does not support a website-service repair.", 409);
    if (Date.parse(run.createdAt) + DIAGNOSTIC_TTL_MS <= Date.parse(now()) || run.targetRevision !== revisionOf(target)) {
      throw new HostRemediationError("host_remediation_diagnostic_stale", "Run the website check again before preparing a repair.", 409);
    }
    return run;
  }

  function findPlan(target, planId, actor = null) {
    return state.hostRemediationPlans.find((item) => item.id === planId
      && item.sshTargetId === target.id
      && item.ownerTeamId === target.ownerTeamId
      && item.createdByUserId === (actor?.userId ?? "usr_local")) ?? null;
  }

  function listPlans(target, actor = null, { limit = 20 } = {}) {
    const plans = state.hostRemediationPlans.filter((item) => item.sshTargetId === target.id
      && item.ownerTeamId === target.ownerTeamId
      && item.createdByUserId === (actor?.userId ?? "usr_local"))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return (limit == null ? plans : plans.slice(0, limit));
  }

  async function createPlan(target, body = {}, actor = null) {
    try {
      if (!connectionReady(target)) throw new HostRemediationError("ssh_host_not_ready", "Verify the host before preparing a repair.", 409);
      if (typeof checkWebsiteHealth !== "function") throw new HostRemediationError("host_remediation_health_check_unavailable", "Website health checking is unavailable.", 501);
      const profileId = String(body.profileId ?? "").trim();
      const diagnosticRunId = String(body.diagnosticRunId ?? "").trim();
      const diagnostic = diagnosticFor(target, diagnosticRunId, actor);
      const context = contextFor(target, profileId);
      const timestamp = now();
      const requestedBy = actor?.userId ?? "usr_local";
      const current = state.hostRemediationPlans.find((item) => item.sshTargetId === target.id
        && item.profileId === context.profile.id
        && item.diagnosticRunId === diagnostic.id
        && item.createdByUserId === requestedBy
        && ["planned", "not_needed"].includes(item.status)
        && Date.parse(item.expiresAt) > Date.parse(timestamp)
        && item.targetRevision === revisionOf(target)
        && item.profileRevision === revisionOf(context.profile)
        && item.scopeRevision === revisionOf(context.scope)
        && item.websiteBindingRevision === revisionOf(context.binding));
      if (current) return { ok: true, plan: current, reused: true };

      const initialHealth = healthSummary(await checkWebsiteHealth(context.healthTarget));
      const healthy = initialHealth.status === "healthy";
      const plan = {
        id: nextId("hrp"),
        ownerTeamId: target.ownerTeamId,
        sshTargetId: target.id,
        diagnosticRunId: diagnostic.id,
        diagnosticFinding: diagnostic.summary.finding,
        profileId: context.profile.id,
        certificateScopeId: context.scope.id,
        websiteBindingId: context.binding.id,
        siteId: context.site.id,
        publicationId: context.publication.id,
        action: "reload_managed_website",
        finding: initialHealth.reason,
        risk: "low",
        status: healthy ? "not_needed" : "planned",
        phase: healthy ? "finished" : "awaiting_confirmation",
        targetRevision: revisionOf(target),
        profileRevision: revisionOf(context.profile),
        scopeRevision: revisionOf(context.scope),
        websiteBindingRevision: revisionOf(context.binding),
        checks: ["website_health", "container_running", "configuration_valid", "reload_service", "container_running", "configuration_valid", "website_health"],
        impact: "brief_connections_may_retry",
        filesChanged: false,
        initialHealth,
        revision: 1,
        createdByUserId: requestedBy,
        createdAt: timestamp,
        updatedAt: timestamp,
        expiresAt: new Date(Date.parse(timestamp) + PLAN_TTL_MS).toISOString(),
        confirmedAt: null,
        completedAt: healthy ? timestamp : null,
        result: healthy ? { outcome: "already_healthy", changeAttempted: false, verification: "passed", completedChecks: ["preflight_website_healthy"] } : null,
      };
      runTx(() => {
        state.hostRemediationPlans.push(plan);
        const owned = state.hostRemediationPlans.filter((item) => item.ownerTeamId === plan.ownerTeamId
          && item.sshTargetId === plan.sshTargetId
          && item.createdByUserId === plan.createdByUserId)
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
        const retired = new Set(owned.slice(MAX_REMEDIATION_PLANS_PER_USER).filter((item) => item.status !== "running" && item.status !== "planned").map((item) => item.id));
        for (let index = state.hostRemediationPlans.length - 1; index >= 0; index -= 1) {
          if (retired.has(state.hostRemediationPlans[index].id)) state.hostRemediationPlans.splice(index, 1);
        }
        appendEvent({
          invocationId: null,
          type: healthy ? "ssh.host_remediation.not_needed" : "ssh.host_remediation.planned",
          level: "info",
          message: healthy ? "The managed website was healthy and no repair was needed." : "A fixed low-risk host remediation plan was prepared.",
          data: { targetId: target.id, planId: plan.id, diagnosticRunId: diagnostic.id, profileId: context.profile.id, action: plan.action, finding: plan.finding, requestedBy: plan.createdByUserId },
        });
      });
      return { ok: true, plan, reused: false };
    } catch (error) {
      return failure(error);
    }
  }

  async function confirmPlan(target, plan, body = {}, actor = null) {
    if (plan.createdByUserId !== (actor?.userId ?? "usr_local")) return { ok: false, status: 404, error: "host_remediation_plan_not_found" };
    if (body.confirmed !== true) return { ok: false, status: 400, error: "host_remediation_confirmation_required" };
    if (TERMINAL_STATUSES.has(plan.status)) return { ok: true, plan, reused: true };
    if (!Number.isInteger(body.expectedRevision)) return { ok: false, status: 400, error: "expected_revision_required" };
    if (body.expectedRevision !== plan.revision) return { ok: false, status: 409, error: "host_remediation_plan_revision_conflict", currentRevision: plan.revision };
    if (plan.status !== "planned") return { ok: false, status: 409, error: "host_remediation_plan_not_executable" };
    if (Date.parse(plan.expiresAt) <= Date.parse(now())) {
      runTx(() => {
        plan.status = "expired";
        plan.phase = "finished";
        plan.revision += 1;
        plan.updatedAt = now();
      });
      return { ok: false, status: 409, error: "host_remediation_plan_expired" };
    }

    let context;
    try {
      if (!connectionReady(target)) throw new HostRemediationError("ssh_host_not_ready", "Verify the host before applying a repair.", 409);
      diagnosticFor(target, plan.diagnosticRunId, actor);
      context = contextFor(target, plan.profileId);
      if (revisionOf(target) !== plan.targetRevision
        || revisionOf(context.profile) !== plan.profileRevision
        || revisionOf(context.scope) !== plan.scopeRevision
        || revisionOf(context.binding) !== plan.websiteBindingRevision
        || context.site.id !== plan.siteId
        || context.publication.id !== plan.publicationId) {
        throw new HostRemediationError("host_remediation_plan_stale", "The host or managed service changed after this plan was prepared.", 409);
      }
    } catch (error) {
      return failure(error);
    }

    const credential = target.authMethod === "ssh_agent"
      ? { ok: true, credential: { agentSocket: process.env.SSH_AUTH_SOCK } }
      : await resolveCredential(target.credentialRef);
    if (!credential?.ok) return { ok: false, status: 409, error: "ssh_credential_unavailable" };
    if (!sshHostConnector?.runFixedCommand) return { ok: false, status: 501, error: "host_remediation_action_unavailable" };
    if (TERMINAL_STATUSES.has(plan.status)) return { ok: true, plan, reused: true };
    if (plan.status !== "planned" || plan.revision !== body.expectedRevision) {
      return { ok: false, status: 409, error: "host_remediation_plan_not_executable" };
    }

    const timestamp = now();
    runTx(() => {
      plan.status = "running";
      plan.phase = "preflight";
      plan.confirmedAt = timestamp;
      plan.updatedAt = timestamp;
      plan.revision += 1;
      appendEvent({
        invocationId: null,
        type: "ssh.host_remediation.started",
        level: "info",
        message: "A confirmed fixed host remediation started.",
        data: { targetId: target.id, planId: plan.id, diagnosticRunId: plan.diagnosticRunId, profileId: context.profile.id, action: plan.action, requestedBy: actor?.userId ?? "usr_local" },
      });
    });

    let changeAttempted = false;
    const completedChecks = [];
    const run = async (action, check) => {
      const result = await sshHostConnector.runFixedCommand(
        target,
        credential.credential,
        action,
        { containerName: context.profile.containerName },
        { operationTimeoutMs: 30_000 },
      );
      if (result.resolvedAddress !== context.scope.lastResolvedAddress) {
        throw new HostRemediationError("host_remediation_target_address_changed", "The host address changed during the repair.", 409);
      }
      completedChecks.push(check);
    };
    const finalize = (status, result, eventType, level, message) => {
      const completedAt = now();
      runTx(() => {
        plan.status = status;
        plan.phase = "finished";
        plan.result = result;
        plan.completedAt = completedAt;
        plan.updatedAt = completedAt;
        plan.revision += 1;
        appendEvent({
          invocationId: null,
          type: eventType,
          level,
          message,
          data: { targetId: target.id, planId: plan.id, diagnosticRunId: plan.diagnosticRunId, profileId: context.profile.id, action: plan.action, result: plan.result },
        });
      });
      return { ok: true, plan, reused: false };
    };

    try {
      const before = healthSummary(await checkWebsiteHealth(context.healthTarget));
      completedChecks.push("preflight_website_health");
      if (before.status === "healthy") {
        return finalize("not_needed", { outcome: "already_healthy", changeAttempted: false, verification: "passed", completedChecks }, "ssh.host_remediation.not_needed", "info", "The managed website recovered before the repair and was not changed.");
      }
      await run("docker_nginx_inspect", "preflight_container_running");
      await run("docker_nginx_config_test", "preflight_configuration_valid");
      runTx(() => {
        plan.phase = "change_pending";
        plan.updatedAt = now();
        plan.revision += 1;
      });
      changeAttempted = true;
      await run("docker_nginx_reload", "service_reloaded");
      runTx(() => {
        plan.phase = "verification";
        plan.updatedAt = now();
        plan.revision += 1;
      });
      await run("docker_nginx_inspect", "verification_container_running");
      await run("docker_nginx_config_test", "verification_configuration_valid");
      const after = await checkWebsiteAfterPossibleReload(context.healthTarget);
      completedChecks.push("verification_website_health");
      if (after.status !== "healthy") {
        return finalize("completed_unresolved", { outcome: "not_restored", changeAttempted: true, verification: "failed", completedChecks, websiteHealth: after }, "ssh.host_remediation.completed_unresolved", "warning", "The website service was reloaded, but the managed website was still unhealthy.");
      }
      return finalize("completed", { outcome: "restored", changeAttempted: true, verification: "passed", completedChecks, websiteHealth: after }, "ssh.host_remediation.completed", "info", "A fixed host remediation completed and the managed website passed verification.");
    } catch (error) {
      const errorCode = error instanceof SshHostConnectorError || error instanceof HostWebsiteHealthCheckError ? error.code : "host_remediation_failed";
      return finalize(
        changeAttempted ? "outcome_unknown" : "failed",
        {
          outcome: changeAttempted ? "verification_incomplete" : "not_changed",
          changeAttempted,
          verification: changeAttempted ? "incomplete" : "not_started",
          completedChecks,
          error: errorCode,
        },
        changeAttempted ? "ssh.host_remediation.outcome_unknown" : "ssh.host_remediation.failed",
        changeAttempted ? "error" : "warning",
        changeAttempted ? "A fixed host remediation could not confirm its final outcome." : "A fixed host remediation stopped before changing the host.",
      );
    }
  }

  async function recheckPlan(target, plan, actor = null) {
    if (plan.createdByUserId !== (actor?.userId ?? "usr_local")) return { ok: false, status: 404, error: "host_remediation_plan_not_found" };
    if (!TERMINAL_STATUSES.has(plan.status)) return { ok: false, status: 409, error: "host_remediation_recheck_not_ready" };
    try {
      const context = contextFor(target, plan.profileId);
      if (context.site.id !== plan.siteId || context.publication.id !== plan.publicationId || context.binding.id !== plan.websiteBindingId) {
        throw new HostRemediationError("host_remediation_plan_stale", "The managed website changed after this repair.", 409);
      }
      const health = await checkWebsiteAfterPossibleReload(context.healthTarget);
      const timestamp = now();
      runTx(() => {
        plan.lastRecheckedHealth = health;
        plan.lastRecheckedAt = timestamp;
        plan.updatedAt = timestamp;
        plan.revision += 1;
        appendEvent({
          invocationId: null,
          type: "ssh.host_remediation.rechecked",
          level: health.status === "healthy" ? "info" : "warning",
          message: health.status === "healthy" ? "The managed website passed a read-only reconciliation check." : "The managed website remained unhealthy during a read-only reconciliation check.",
          data: { targetId: target.id, planId: plan.id, diagnosticRunId: plan.diagnosticRunId, profileId: plan.profileId, action: plan.action, health },
        });
      });
      return { ok: true, plan };
    } catch (error) {
      return failure(error);
    }
  }

  const interrupted = state.hostRemediationPlans.filter((plan) => plan.status === "running");
  if (interrupted.length) {
    const timestamp = now();
    runTx(() => {
      for (const plan of interrupted) {
        const safelyBeforeChange = plan.phase === "preflight";
        plan.status = safelyBeforeChange ? "failed" : "outcome_unknown";
        plan.phase = "finished";
        plan.result = {
          outcome: safelyBeforeChange ? "not_changed" : "verification_incomplete",
          changeAttempted: !safelyBeforeChange,
          verification: safelyBeforeChange ? "not_started" : "incomplete",
          completedChecks: plan.result?.completedChecks ?? [],
          error: "host_remediation_interrupted",
        };
        plan.completedAt = timestamp;
        plan.updatedAt = timestamp;
        plan.revision = revisionOf(plan) + 1;
        appendEvent({
          invocationId: null,
          type: safelyBeforeChange ? "ssh.host_remediation.failed" : "ssh.host_remediation.outcome_unknown",
          level: safelyBeforeChange ? "warning" : "error",
          message: safelyBeforeChange ? "An interrupted remediation stopped before changing the host." : "An interrupted remediation requires a fresh website check.",
          data: { targetId: plan.sshTargetId, planId: plan.id, diagnosticRunId: plan.diagnosticRunId, profileId: plan.profileId, action: plan.action, result: plan.result },
        });
      }
    });
  }

  return { createPlan, confirmPlan, recheckPlan, findPlan, listPlans };
}
