import { makeRunTx } from "../runtime/store/run-tx.mjs";
import { SshHostConnectorError } from "./ssh-host-connector.mjs";

const SAFE_CONTAINER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

export class HostTlsActivationProfileError extends SshHostConnectorError {
  constructor(code, message, status = 400) {
    super(code, message);
    this.name = "HostTlsActivationProfileError";
    this.status = status;
  }
}

function failure(error) {
  if (error instanceof HostTlsActivationProfileError) return { ok: false, status: error.status, error: error.code };
  if (error instanceof SshHostConnectorError) return { ok: false, status: error.code === "ssh_host_fingerprint_changed" ? 409 : 502, error: error.code };
  return { ok: false, status: 502, error: "host_tls_activation_profile_failed" };
}

export function createHostTlsActivationProfileService({ state, now, nextId, appendEvent, persistStateSoon, resolveCredential, sshHostConnector, store }) {
  const runTx = makeRunTx({ store, persistStateSoon });
  state.hostTlsActivationProfiles ??= [];

  function listProfiles(target) {
    return state.hostTlsActivationProfiles.filter((profile) => profile.sshTargetId === target.id);
  }

  async function createProfile(target, body = {}, actor = null) {
    try {
      if (target.connectionStatus !== "ready" || !target.purposes?.some((purpose) => ["site_publish", "tls_certificate"].includes(purpose))) {
        throw new HostTlsActivationProfileError("host_tls_target_not_ready", "The SSH host is not ready for certificate activation.", 409);
      }
      if (body.type != null && body.type !== "docker_nginx") {
        throw new HostTlsActivationProfileError("host_tls_activation_profile_type_invalid", "Only the fixed Docker Nginx activation profile is supported.");
      }
      const certificateScopeId = String(body.certificateScopeId ?? "").trim();
      const scope = state.hostFileScopes.find((item) => item.id === certificateScopeId && item.ownerTeamId === target.ownerTeamId && item.sshTargetId === target.id);
      if (!scope || scope.purpose !== "tls_certificate" || scope.status !== "ready" || !scope.permissions?.includes("certificate_write")) {
        throw new HostTlsActivationProfileError("host_tls_certificate_scope_not_ready", "Choose a ready certificate-only range on this host.", 409);
      }
      const containerName = String(body.containerName ?? "").trim();
      if (!SAFE_CONTAINER_NAME.test(containerName)) throw new HostTlsActivationProfileError("host_tls_container_name_invalid", "Choose a valid Docker container name.");
      const duplicate = state.hostTlsActivationProfiles.some((profile) => profile.sshTargetId === target.id
        && profile.certificateScopeId === scope.id && profile.containerName === containerName && profile.status !== "disabled");
      if (duplicate) throw new HostTlsActivationProfileError("host_tls_activation_profile_exists", "This fixed activation profile already exists.", 409);
      const credential = await resolveCredential(target.credentialRef);
      if (!credential?.ok) throw new HostTlsActivationProfileError(credential?.error ?? "ssh_credential_unavailable", "The SSH credential is unavailable.", 409);
      if (!sshHostConnector?.runFixedCommand) throw new HostTlsActivationProfileError("host_tls_fixed_action_unavailable", "Fixed remote actions are unavailable.", 501);
      const inspected = await sshHostConnector.runFixedCommand(target, credential.credential, "docker_nginx_inspect", { containerName });
      if (inspected.resolvedAddress !== scope.lastResolvedAddress) {
        throw new HostTlsActivationProfileError("host_tls_target_address_changed", "The host address changed since the certificate range was verified.", 409);
      }
      const timestamp = now();
      const profile = {
        id: nextId("htp"), ownerTeamId: target.ownerTeamId, sshTargetId: target.id,
        certificateScopeId: scope.id, label: String(body.label ?? "Docker Nginx HTTPS").trim().slice(0, 80) || "Docker Nginx HTTPS",
        type: "docker_nginx", containerName, status: "ready", lastVerifiedAt: timestamp,
        revision: 1, createdByUserId: actor?.userId ?? "usr_local", createdAt: timestamp, updatedAt: timestamp,
      };
      runTx(() => {
        state.hostTlsActivationProfiles.push(profile);
        appendEvent({ invocationId: null, type: "ssh.host_tls_activation_profile.created", level: "info", message: "A fixed Docker Nginx TLS activation profile was verified.", data: { targetId: target.id, profileId: profile.id, certificateScopeId: scope.id } });
      });
      return { ok: true, profile };
    } catch (error) {
      return failure(error);
    }
  }

  return { listProfiles, createProfile };
}
