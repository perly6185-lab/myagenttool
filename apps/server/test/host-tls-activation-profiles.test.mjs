import assert from "node:assert/strict";
import { test } from "node:test";

import { createHostTlsActivationProfileService } from "../src/services/host-tls-activation-profiles.mjs";

function harness({ resolvedAddress = "10.10.10.222" } = {}) {
  const calls = [];
  const target = { id: "ssh_1", ownerTeamId: "team_a", credentialRef: "credential://ssh/ssh_1", purposes: ["site_publish"], connectionStatus: "ready" };
  const scope = { id: "hfs_tls", ownerTeamId: "team_a", sshTargetId: target.id, purpose: "tls_certificate", status: "ready", permissions: ["certificate_write"], lastResolvedAddress: "10.10.10.222" };
  const state = { hostFileScopes: [scope], hostTlsActivationProfiles: [] };
  const service = createHostTlsActivationProfileService({
    state, now: () => "2026-08-26T00:00:00.000Z", nextId: () => "htp_1", appendEvent: () => {}, persistStateSoon: () => {},
    resolveCredential: async () => ({ ok: true, credential: { privateKey: "SSH KEY" } }),
    sshHostConnector: { runFixedCommand: async (_target, _credential, action, params) => { calls.push({ action, params }); return { resolvedAddress }; } },
  });
  return { service, state, target, scope, calls };
}

test("creates only a verified fixed Docker Nginx activation profile", async () => {
  const { service, state, target, scope, calls } = harness();
  const result = await service.createProfile(target, { certificateScopeId: scope.id, containerName: "site-nginx_1", label: "Site HTTPS" }, { userId: "usr_a" });
  assert.equal(result.ok, true);
  assert.equal(result.profile.type, "docker_nginx");
  assert.equal(result.profile.status, "ready");
  assert.deepEqual(calls, [{ action: "docker_nginx_inspect", params: { containerName: "site-nginx_1" } }]);
  assert.equal(JSON.stringify(state).includes("SSH KEY"), false);
  assert.equal((await service.createProfile(target, { certificateScopeId: scope.id, containerName: "site-nginx; id" })).error, "host_tls_container_name_invalid");
});

test("rejects a profile when the fixed host address changed", async () => {
  const { service, target, scope } = harness({ resolvedAddress: "10.10.10.223" });
  const result = await service.createProfile(target, { certificateScopeId: scope.id, containerName: "site-nginx" });
  assert.equal(result.error, "host_tls_target_address_changed");
});
