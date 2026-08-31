import { makeRunTx } from "../runtime/store/run-tx.mjs";
import { normalizeSshFingerprint, SshHostConnectorError } from "./ssh-host-connector.mjs";

const PLAN_TTL_MS = 10 * 60_000;
const TERMINAL_STATUSES = new Set(["completed", "failed", "outcome_unknown"]);

export class HostRemediationError extends SshHostConnectorError {
  constructor(code, message, status = 400) {
    super(code, message);
    this.name = "HostRemediationError";
    this.status = status;
  }
}

function failure(error) {
  if (error instanceof HostRemediationError) return { ok: false, status: error.status, error: error.code };
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

export function createHostRemediationService({ state, now, nextId, appendEvent, persistStateSoon, resolveCredential, sshHostConnector, store }) {
  const runTx = makeRunTx({ store, persistStateSoon });
  state.hostRemediationPlans ??= [];

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
    return { profile, scope };
  }

  function findPlan(target, planId, actor = null) {
    return state.hostRemediationPlans.find((item) => item.id === planId
      && item.sshTargetId === target.id
      && item.ownerTeamId === target.ownerTeamId
      && item.createdByUserId === (actor?.userId ?? "usr_local")) ?? null;
  }

  function createPlan(target, body = {}, actor = null) {
    try {
      if (!connectionReady(target)) throw new HostRemediationError("ssh_host_not_ready", "Verify the host before preparing a repair.", 409);
      const profileId = String(body.profileId ?? "").trim();
      const { profile, scope } = contextFor(target, profileId);
      const timestamp = now();
      const requestedBy = actor?.userId ?? "usr_local";
      const current = state.hostRemediationPlans.find((item) => item.sshTargetId === target.id
        && item.profileId === profile.id
        && item.createdByUserId === requestedBy
        && item.status === "planned"
        && Date.parse(item.expiresAt) > Date.parse(timestamp)
        && item.targetRevision === revisionOf(target)
        && item.profileRevision === revisionOf(profile)
        && item.scopeRevision === revisionOf(scope));
      if (current) return { ok: true, plan: current, reused: true };

      const plan = {
        id: nextId("hrp"),
        ownerTeamId: target.ownerTeamId,
        sshTargetId: target.id,
        profileId: profile.id,
        certificateScopeId: scope.id,
        action: "reload_managed_website",
        risk: "low",
        status: "planned",
        targetRevision: revisionOf(target),
        profileRevision: revisionOf(profile),
        scopeRevision: revisionOf(scope),
        checks: ["container_running", "configuration_valid", "reload_service", "container_running", "configuration_valid"],
        impact: "brief_connections_may_retry",
        filesChanged: false,
        revision: 1,
        createdByUserId: requestedBy,
        createdAt: timestamp,
        updatedAt: timestamp,
        expiresAt: new Date(Date.parse(timestamp) + PLAN_TTL_MS).toISOString(),
        confirmedAt: null,
        completedAt: null,
        result: null,
      };
      runTx(() => {
        state.hostRemediationPlans.push(plan);
        appendEvent({
          invocationId: null,
          type: "ssh.host_remediation.planned",
          level: "info",
          message: "A fixed low-risk host remediation plan was prepared.",
          data: { targetId: target.id, planId: plan.id, profileId: profile.id, action: plan.action, requestedBy: plan.createdByUserId },
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
        plan.revision += 1;
        plan.updatedAt = now();
      });
      return { ok: false, status: 409, error: "host_remediation_plan_expired" };
    }

    let context;
    try {
      if (!connectionReady(target)) throw new HostRemediationError("ssh_host_not_ready", "Verify the host before applying a repair.", 409);
      context = contextFor(target, plan.profileId);
      if (revisionOf(target) !== plan.targetRevision
        || revisionOf(context.profile) !== plan.profileRevision
        || revisionOf(context.scope) !== plan.scopeRevision) {
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
    // Credential resolution may yield to another confirmation request. Recheck
    // the durable one-shot state before reserving the remote mutation.
    if (TERMINAL_STATUSES.has(plan.status)) return { ok: true, plan, reused: true };
    if (plan.status !== "planned" || plan.revision !== body.expectedRevision) {
      return { ok: false, status: 409, error: "host_remediation_plan_not_executable" };
    }

    const timestamp = now();
    runTx(() => {
      plan.status = "running";
      plan.confirmedAt = timestamp;
      plan.updatedAt = timestamp;
      plan.revision += 1;
      appendEvent({
        invocationId: null,
        type: "ssh.host_remediation.started",
        level: "info",
        message: "A confirmed fixed host remediation started.",
        data: { targetId: target.id, planId: plan.id, profileId: context.profile.id, action: plan.action, requestedBy: actor?.userId ?? "usr_local" },
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

    try {
      await run("docker_nginx_inspect", "preflight_container_running");
      await run("docker_nginx_config_test", "preflight_configuration_valid");
      changeAttempted = true;
      await run("docker_nginx_reload", "service_reloaded");
      await run("docker_nginx_inspect", "verification_container_running");
      await run("docker_nginx_config_test", "verification_configuration_valid");
      const completedAt = now();
      runTx(() => {
        plan.status = "completed";
        plan.result = { outcome: "restored", changeAttempted: true, verification: "passed", completedChecks };
        plan.completedAt = completedAt;
        plan.updatedAt = completedAt;
        plan.revision += 1;
        appendEvent({
          invocationId: null,
          type: "ssh.host_remediation.completed",
          level: "info",
          message: "A fixed host remediation completed and passed verification.",
          data: { targetId: target.id, planId: plan.id, profileId: context.profile.id, action: plan.action, result: plan.result },
        });
      });
      return { ok: true, plan, reused: false };
    } catch (error) {
      const errorCode = error instanceof SshHostConnectorError ? error.code : "host_remediation_failed";
      const completedAt = now();
      runTx(() => {
        plan.status = changeAttempted ? "outcome_unknown" : "failed";
        plan.result = {
          outcome: changeAttempted ? "verification_incomplete" : "not_changed",
          changeAttempted,
          verification: changeAttempted ? "incomplete" : "not_started",
          completedChecks,
          error: errorCode,
        };
        plan.completedAt = completedAt;
        plan.updatedAt = completedAt;
        plan.revision += 1;
        appendEvent({
          invocationId: null,
          type: changeAttempted ? "ssh.host_remediation.outcome_unknown" : "ssh.host_remediation.failed",
          level: changeAttempted ? "error" : "warning",
          message: changeAttempted ? "A fixed host remediation could not confirm its final outcome." : "A fixed host remediation stopped before changing the host.",
          data: { targetId: target.id, planId: plan.id, profileId: context.profile.id, action: plan.action, result: plan.result },
        });
      });
      return { ok: true, plan, reused: false };
    }
  }

  return { createPlan, confirmPlan, findPlan };
}
