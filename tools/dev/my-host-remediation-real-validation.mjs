#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { createHostRemediationService } from "../../apps/server/src/services/host-remediation.mjs";
import { createPinnedWebsiteHealthChecker } from "../../apps/server/src/services/host-website-health.mjs";
import { sshHostFingerprint } from "../../apps/server/src/services/ssh-host-connector.mjs";

const CHILD_EXIT_AFTER_RELOAD = 73;
const SAFE_VALUE = /^[A-Za-z0-9._/@:-]+$/;

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    values[key.slice(2)] = argv[index + 1];
    index += 1;
  }
  return values;
}

function requireSafe(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized || !SAFE_VALUE.test(normalized)) throw new Error(`Missing or unsafe ${label}`);
  return normalized;
}

function run(program, args, options = {}) {
  const result = spawnSync(program, args, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    throw new Error(`${program} failed (${result.status}): ${String(result.stderr || result.stdout).trim()}`);
  }
  return Buffer.isBuffer(result.stdout) ? result.stdout : String(result.stdout ?? "").trim();
}

function sshClient({ address, user, controlPath }) {
  const destination = `${user}@${address}`;
  const base = ["-S", controlPath, "-o", "BatchMode=yes", destination];
  return {
    command(command, options = {}) {
      return run("ssh", [...base, command], options);
    },
    copy(localPath, remotePath) {
      return run("scp", ["-o", `ControlPath=${controlPath}`, localPath, `${destination}:${remotePath}`]);
    },
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function nginxConfig({ hostname, body = "", status = 200, slow = false }) {
  const escapedBody = JSON.stringify(body);
  const slowDirectives = slow ? "limit_rate_after 0;\n    limit_rate 1;" : "";
  return `server {
  listen 443 ssl;
  server_name ${hostname};
  ssl_certificate /etc/nginx/h2e4/cert.pem;
  ssl_certificate_key /etc/nginx/h2e4/key.pem;
  location / {
    ${slowDirectives}
    default_type text/html;
    return ${status} ${escapedBody};
  }
}
`;
}

function makeState({ address, hostname, fingerprint, content }) {
  const timestamp = new Date().toISOString();
  const target = {
    id: "ssh_target_h2e4", ownerTeamId: "team_h2e4", authMethod: "private_key_ref",
    credentialRef: "credential://h2e4", connectionStatus: "ready", trustStatus: "pinned",
    knownHostFingerprint: sshHostFingerprint(Buffer.from("h2e4-host-key")), agentForwarding: false, revision: 1,
  };
  const tlsScope = {
    id: "hfs_h2e4_tls", ownerTeamId: target.ownerTeamId, sshTargetId: target.id,
    purpose: "tls_certificate", status: "ready", lastResolvedAddress: address, revision: 1,
  };
  const publishScope = {
    id: "hfs_h2e4_publish", ownerTeamId: target.ownerTeamId, sshTargetId: target.id,
    purpose: "site_publish", status: "ready", lastResolvedAddress: address, revision: 1,
  };
  const profile = {
    id: "htp_h2e4", ownerTeamId: target.ownerTeamId, sshTargetId: target.id,
    certificateScopeId: tlsScope.id, type: "docker_nginx", containerName: process.env.H2E4_CONTAINER,
    status: "ready", revision: 1,
  };
  const diagnostic = {
    id: "hdr_h2e4", ownerTeamId: target.ownerTeamId, sshTargetId: target.id,
    targetRevision: target.revision, createdByUserId: "usr_local", version: 1, intent: "website",
    risk: "read_only", steps: [], summary: { severity: "warning", finding: "host_warnings_found" }, createdAt: timestamp,
  };
  const binding = {
    id: "stb_h2e4", ownerTeamId: target.ownerTeamId, siteId: "site_h2e4",
    deploymentTargetId: "sdt_h2e4", hostname, certificateScopeId: tlsScope.id,
    activationProfileId: profile.id, status: "active", certificateEnvironment: "staging",
    certificateFingerprint: fingerprint, revision: 1,
  };
  const publication = {
    id: "spb_h2e4", ownerTeamId: target.ownerTeamId, siteId: binding.siteId, status: "active",
    remoteDeployment: { provider: "ssh_static", verification: { contentHash: sha256(content), contentBytes: Buffer.byteLength(content) } },
  };
  const state = {
    hostFileScopes: [tlsScope, publishScope], hostTlsActivationProfiles: [profile], hostDiagnosticRuns: [diagnostic],
    hostRemediationPlans: [], siteDomainTlsBindings: [binding],
    siteDeploymentTargets: [{ id: "sdt_h2e4", ownerTeamId: target.ownerTeamId, kind: "ssh_static", customDomain: hostname, remoteProjectRef: publishScope.id }],
    sites: [{ id: binding.siteId, ownerTeamId: target.ownerTeamId, activePublicationId: publication.id }],
    sitePublications: [publication],
  };
  return { state, target, profile, diagnostic };
}

function fixedConnector(client, containerName, { exitAfterReload = false, actionLog = null } = {}) {
  const commands = {
    docker_nginx_inspect: `docker inspect --format '{{.State.Running}}' ${containerName}`,
    docker_nginx_config_test: `docker exec ${containerName} nginx -t`,
    docker_nginx_reload: `docker kill --signal=HUP ${containerName}`,
  };
  return {
    async runFixedCommand(_target, _credential, action) {
      assert.ok(Object.hasOwn(commands, action), `unsupported fixed action ${action}`);
      if (actionLog) writeFileSync(actionLog, `${action}\n`, { flag: "a" });
      const output = client.command(commands[action]);
      if (exitAfterReload && action === "docker_nginx_reload") process.exit(CHILD_EXIT_AFTER_RELOAD);
      return { resolvedAddress: process.env.H2E4_ADDRESS, value: { output } };
    },
  };
}

function makeService({ state, client, checker, containerName, persistPath = null, exitAfterReload = false, actionLog = null }) {
  let sequence = 0;
  return createHostRemediationService({
    state,
    now: () => new Date().toISOString(),
    nextId: (prefix) => `${prefix}_h2e4_${++sequence}`,
    appendEvent: () => {},
    persistStateSoon: () => { if (persistPath) writeFileSync(persistPath, JSON.stringify(state)); },
    resolveCredential: async () => ({ ok: true, credential: {} }),
    sshHostConnector: fixedConnector(client, containerName, { exitAfterReload, actionLog }),
    checkWebsiteHealth: checker,
  });
}

async function childMain() {
  const address = requireSafe(process.env.H2E4_ADDRESS, "address");
  const user = requireSafe(process.env.H2E4_USER, "user");
  const controlPath = requireSafe(process.env.H2E4_CONTROL_PATH, "control path");
  const containerName = requireSafe(process.env.H2E4_CONTAINER, "container name");
  const statePath = String(process.env.H2E4_STATE_PATH);
  const actionLog = String(process.env.H2E4_ACTION_LOG);
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const target = state.__target;
  const profile = state.hostTlsActivationProfiles[0];
  const diagnostic = state.hostDiagnosticRuns[0];
  delete state.__target;
  const checker = createPinnedWebsiteHealthChecker({ stagingCaPem: readFileSync(process.env.H2E4_CA_PATH, "utf8"), timeoutMs: 2_000 });
  const service = makeService({ state, client: sshClient({ address, user, controlPath }), checker, containerName, persistPath: statePath, exitAfterReload: true, actionLog });
  const planned = await service.createPlan(target, { profileId: profile.id, diagnosticRunId: diagnostic.id });
  assert.equal(planned.plan.status, "planned");
  await service.confirmPlan(target, planned.plan, { confirmed: true, expectedRevision: planned.plan.revision });
  throw new Error("interruption child reached an impossible continuation");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.child === "true") return childMain();

  const address = requireSafe(args.address, "address");
  const user = requireSafe(args.user, "user");
  const controlPath = requireSafe(args["control-path"], "control path");
  const client = sshClient({ address, user, controlPath });
  const localDir = mkdtempSync(join(tmpdir(), "myagenttool-h2e4-"));
  const token = `${process.pid}-${Date.now()}`;
  const remoteDir = `/tmp/myagenttool-h2e4-${token}`;
  const containerName = `myagenttool-h2e4-nginx-${token}`;
  const hostname = "h2e4.myagenttool.test";
  const healthyBody = "myagenttool H2E real health receipt\n";
  const slowBody = "x".repeat(128);
  const caKey = join(localDir, "ca.key");
  const caPem = join(localDir, "ca.pem");
  const serverKey = join(localDir, "key.pem");
  const serverCsr = join(localDir, "server.csr");
  const serverPem = join(localDir, "cert.pem");
  const extFile = join(localDir, "server.ext");
  const configFile = join(localDir, "default.conf");

  process.env.H2E4_ADDRESS = address;
  process.env.H2E4_USER = user;
  process.env.H2E4_CONTROL_PATH = controlPath;
  process.env.H2E4_CONTAINER = containerName;

  const setConfig = (config, reload = true) => {
    writeFileSync(configFile, config);
    client.copy(configFile, `${remoteDir}/default.conf.next`);
    client.command(`cp ${remoteDir}/default.conf.next ${remoteDir}/default.conf`);
    if (reload) {
      client.command(`docker kill --signal=HUP ${containerName}`);
      run("sleep", ["0.2"]);
    }
  };

  try {
    assert.equal(client.command("ss -ltn '( sport = :443 )' | tail -n +2"), "", "remote TCP port 443 must be unused");
    writeFileSync(extFile, `subjectAltName=DNS:${hostname}\nextendedKeyUsage=serverAuth\n`);
    run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=MyAgentTool H2E Test CA", "-keyout", caKey, "-out", caPem]);
    run("openssl", ["req", "-new", "-newkey", "rsa:2048", "-nodes", "-subj", `/CN=${hostname}`, "-keyout", serverKey, "-out", serverCsr]);
    run("openssl", ["x509", "-req", "-in", serverCsr, "-CA", caPem, "-CAkey", caKey, "-CAcreateserial", "-days", "2", "-extfile", extFile, "-out", serverPem]);
    const der = run("openssl", ["x509", "-in", serverPem, "-outform", "DER"], { encoding: null });
    const fingerprint = createHash("sha256").update(Buffer.isBuffer(der) ? der : Buffer.from(der)).digest("hex");

    writeFileSync(configFile, nginxConfig({ hostname, body: healthyBody }));
    client.command(`mkdir ${remoteDir}`);
    for (const path of [caPem, serverPem, serverKey, configFile]) client.copy(path, `${remoteDir}/${path.split("/").at(-1)}`);
    client.command(`chmod 600 ${remoteDir}/key.pem`);
    client.command(`docker run -d --name ${containerName} -p 443:443 -v ${remoteDir}/cert.pem:/etc/nginx/h2e4/cert.pem:ro -v ${remoteDir}/key.pem:/etc/nginx/h2e4/key.pem:ro -v ${remoteDir}/default.conf:/etc/nginx/conf.d/default.conf:ro nginx:alpine`);
    run("sleep", ["0.4"]);

    const checker = createPinnedWebsiteHealthChecker({ stagingCaPem: readFileSync(caPem, "utf8"), timeoutMs: 2_000 });
    const targetFor = (content = healthyBody) => ({
      address, hostname, certificateFingerprint: fingerprint, certificateEnvironment: "staging",
      expectedContentHash: sha256(content), expectedContentBytes: Buffer.byteLength(content),
    });
    const expectReason = async (label, target, reason) => {
      let result;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        result = await checker(target);
        if (result.reason !== "website_unreachable" || reason === "website_unreachable") break;
        run("sleep", ["0.2"]);
      }
      assert.equal(result.reason, reason, `${label}: ${JSON.stringify(result)}`);
      console.log(`PASS ${label}: ${result.reason}`);
    };

    await expectReason("healthy 2xx", targetFor(), "website_healthy");
    setConfig(nginxConfig({ hostname, body: "Welcome to nginx!\n" }));
    await expectReason("default page replacement", targetFor(), "website_content_mismatch");
    setConfig(nginxConfig({ hostname, status: 502, body: "bad gateway\n" }));
    await expectReason("HTTP 502", targetFor(), "website_http_error");
    await expectReason("certificate hostname", { ...targetFor(), hostname: "wrong.myagenttool.test" }, "website_certificate_invalid");
    await expectReason("certificate fingerprint", { ...targetFor(), certificateFingerprint: "0".repeat(64) }, "website_certificate_mismatch");
    setConfig(nginxConfig({ hostname, body: slowBody, slow: true }));
    const timeoutChecker = createPinnedWebsiteHealthChecker({ stagingCaPem: readFileSync(caPem, "utf8"), timeoutMs: 250 });
    let timeoutResult;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      timeoutResult = await timeoutChecker(targetFor(slowBody));
      if (timeoutResult.reason !== "website_unreachable") break;
      run("sleep", ["0.2"]);
    }
    assert.equal(timeoutResult.reason, "website_timeout", JSON.stringify(timeoutResult));
    console.log(`PASS slow response: ${timeoutResult.reason}`);

    setConfig(nginxConfig({ hostname, body: "stale release\n" }));
    setConfig(nginxConfig({ hostname, body: healthyBody }), false);
    const fixture = makeState({ address, hostname, fingerprint, content: healthyBody });
    const actions = [];
    const service = createHostRemediationService({
      state: fixture.state, now: () => new Date().toISOString(), nextId: (prefix) => `${prefix}_normal`, appendEvent: () => {}, persistStateSoon: () => {},
      resolveCredential: async () => ({ ok: true, credential: {} }),
      sshHostConnector: { async runFixedCommand(target, credential, action, parameters) { actions.push(action); return fixedConnector(client, containerName).runFixedCommand(target, credential, action, parameters); } },
      checkWebsiteHealth: checker,
    });
    const planned = await service.createPlan(fixture.target, { profileId: fixture.profile.id, diagnosticRunId: fixture.diagnostic.id });
    assert.equal(planned.plan.status, "planned");
    const repaired = await service.confirmPlan(fixture.target, planned.plan, { confirmed: true, expectedRevision: planned.plan.revision });
    assert.equal(repaired.plan.status, "completed");
    assert.equal(repaired.plan.result.outcome, "restored");
    assert.deepEqual(actions, ["docker_nginx_inspect", "docker_nginx_config_test", "docker_nginx_reload", "docker_nginx_inspect", "docker_nginx_config_test"]);
    console.log("PASS controlled repair: one HUP and verified recovery");

    setConfig(nginxConfig({ hostname, body: "stale before interruption\n" }));
    setConfig(nginxConfig({ hostname, body: healthyBody }), false);
    const interrupted = makeState({ address, hostname, fingerprint, content: healthyBody });
    const statePath = join(localDir, "interrupted-state.json");
    const actionLog = join(localDir, "interrupted-actions.log");
    writeFileSync(statePath, JSON.stringify({ ...interrupted.state, __target: interrupted.target }));
    const child = spawnSync(process.execPath, [new URL(import.meta.url).pathname, "--child", "true"], {
      encoding: "utf8",
      env: { ...process.env, H2E4_STATE_PATH: statePath, H2E4_ACTION_LOG: actionLog, H2E4_CA_PATH: caPem },
    });
    assert.equal(child.status, CHILD_EXIT_AFTER_RELOAD, child.stderr || child.stdout);
    const recoveredState = JSON.parse(readFileSync(statePath, "utf8"));
    const recoveryService = makeService({ state: recoveredState, client, checker, containerName });
    const recoveredPlan = recoveredState.hostRemediationPlans[0];
    assert.equal(recoveredPlan.status, "outcome_unknown");
    assert.equal(recoveredPlan.result.error, "host_remediation_interrupted");
    const rechecked = await recoveryService.recheckPlan(interrupted.target, recoveredPlan);
    assert.equal(rechecked.plan.lastRecheckedHealth.status, "healthy");
    assert.equal(readFileSync(actionLog, "utf8").split("\n").filter((line) => line === "docker_nginx_reload").length, 1);
    console.log("PASS process interruption: recovered as unknown, rechecked healthy, no second HUP");
    console.log(`H2E-4 PASS container=${containerName} address=${address}`);
  } finally {
    client.command(`docker rm -f ${containerName} >/dev/null 2>&1 || true`);
    client.command(`test -d ${remoteDir} && rm -rf ${remoteDir} || true`);
    rmSync(localDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
