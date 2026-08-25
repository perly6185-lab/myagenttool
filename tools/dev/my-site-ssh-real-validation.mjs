import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const config = {
  host: requiredEnv("MYAGENTTOOL_REAL_SSH_HOST"),
  port: boundedPort(process.env.MYAGENTTOOL_REAL_SSH_PORT ?? "22"),
  user: requiredEnv("MYAGENTTOOL_REAL_SSH_USER"),
  password: requiredEnv("MYAGENTTOOL_REAL_SSH_PASSWORD"),
  expectedFingerprint: requiredEnv("MYAGENTTOOL_REAL_SSH_FINGERPRINT"),
  rootPath: requiredEnv("MYAGENTTOOL_REAL_SSH_SCOPE_ROOT"),
  domain: String(process.env.MYAGENTTOOL_REAL_SITE_DOMAIN ?? "validation-host.invalid").trim(),
  siteUrl: String(process.env.MYAGENTTOOL_REAL_SITE_URL ?? "").trim(),
  name: String(process.env.MYAGENTTOOL_REAL_SSH_NAME ?? "real SSH validation host").trim(),
  expectPublishFailure: process.env.MYAGENTTOOL_REAL_EXPECT_PUBLISH_FAILURE === "1",
  runPublication: process.env.MYAGENTTOOL_REAL_RUN_PUBLICATION === "1",
};
if (config.expectPublishFailure && config.runPublication) throw new Error("Choose either failure protection or successful publication validation, not both.");
if (config.runPublication && !config.siteUrl) throw new Error("MYAGENTTOOL_REAL_SITE_URL is required for successful publication validation.");

const desktopToken = randomBytes(32).toString("base64url");
process.env.MYAGENT_REQUIRE_AUTH = "0";
process.env.MYAGENTTOOL_STATE_DISABLED = "1";
process.env.MYAGENT_DESKTOP_CREDENTIAL_TOKEN = desktopToken;

const temporaryRoot = mkdtempSync(join(tmpdir(), "myagenttool-site-ssh-real-"));
let server;
let base;
let credentialReference;

try {
  const { createServerState } = await import("../../apps/server/src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../../apps/server/src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../../apps/server/src/runtime/http-server.mjs");
  const { createSshStaticSiteAdapter } = await import("../../apps/server/src/services/ssh-static-site-adapter.mjs");

  const projectPath = join(temporaryRoot, "project");
  mkdirSync(projectPath, { recursive: true });
  const statePath = join(temporaryRoot, "state.json");
  const now = () => new Date().toISOString();
  const created = createServerState({ defaultProjectPath: projectPath, now });
  const { httpDependencies } = createServerRuntimeServices({
    namespace: "my-site-ssh-real-validation",
    protocolVersion: "0.0.0",
    state: created.state,
    defaultProject: created.defaultProject,
    defaultProjectPath: projectPath,
    persistenceEnabled: false,
    stateStorePath: statePath,
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
    siteSshAdapterFactory: config.siteUrl
      ? ({ state, sshHostConnector, resolveCredential }) => createMappedSshSiteAdapter({
          createSshStaticSiteAdapter,
          state,
          sshHostConnector,
          resolveCredential,
          siteUrl: config.siteUrl,
          privateAddress: config.host,
        })
      : null,
  });
  server = createHttpServer({
    host: "127.0.0.1",
    port: 0,
    namespace: "my-site-ssh-real-validation",
    protocolVersion: "0.0.0",
    ...httpDependencies,
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;

  const createdHost = await call("/api/hosts", {
    method: "POST",
    body: {
      name: config.name,
      host: config.host,
      port: config.port,
      user: config.user,
      authMethod: "password_ref",
      knownHostPolicy: "manual_review",
      purposes: ["site_publish"],
      networkPolicy: "allow_private_network",
      platformHint: "linux",
      agentForwarding: false,
      keySelection: "explicit_key_ref",
    },
  });
  assertStatus(createdHost, 201, "create host");
  let host = createdHost.body.target;
  credentialReference = host.credentialRef;

  const provisioned = await call("/api/internal/site-credentials", {
    method: "PUT",
    headers: { "x-desktop-credential-token": desktopToken },
    body: { reference: credentialReference, provider: "ssh", credential: { authMethod: "password_ref", password: config.password } },
  });
  assertStatus(provisioned, 200, "provision process-local SSH credential");
  assert.deepEqual(provisioned.body, { ok: true, reference: credentialReference });

  const observed = await call(`/api/hosts/${encodeURIComponent(host.id)}/observe-fingerprint`, { method: "POST", body: {} });
  assertStatus(observed, 200, "observe host fingerprint");
  assert.equal(observed.body.observation.fingerprint, config.expectedFingerprint, "the live SSH fingerprint changed");
  host = observed.body.host;

  const confirmed = await call(`/api/hosts/${encodeURIComponent(host.id)}/confirm-fingerprint`, {
    method: "POST",
    body: { fingerprint: config.expectedFingerprint, expectedRevision: host.revision },
  });
  assertStatus(confirmed, 200, "confirm host fingerprint");
  host = confirmed.body.host;

  const verified = await call(`/api/hosts/${encodeURIComponent(host.id)}/verify`, { method: "POST", body: {} });
  assertStatus(verified, 200, "verify SSH and SFTP capabilities");
  host = verified.body.host;
  assert.equal(host.connectionStatus, "ready");
  assert.equal(host.capabilities?.sftp, true);
  assert.equal(host.capabilities?.posixRename, true);
  assert.equal(host.capabilities?.symlink, true);

  const createdScope = await call(`/api/hosts/${encodeURIComponent(host.id)}/file-scopes`, {
    method: "POST",
    body: {
      label: "real host site E2E",
      purpose: "site_publish",
      rootPath: config.rootPath,
      permissions: ["list", "upload", "download"],
    },
  });
  assertStatus(createdScope, 201, "create and verify site publishing scope");
  const scope = createdScope.body.scope;
  assert.equal(scope.resolvedRootPath, config.rootPath);
  assert.equal(scope.status, "ready");

  const createdSite = await call("/api/sites", {
    method: "POST",
    body: {
      name: "真实主机联合验收站点",
      description: "验证我的主机与我的站点 SSH 发布链路",
      audience: "内部验收人员",
      primaryAction: "查看验收结果",
      contactEmail: "validation@example.com",
    },
  });
  assertStatus(createdSite, 201, "create validation site");
  let site = createdSite.body.site;
  const professionalSite = await call(`/api/sites/${encodeURIComponent(site.id)}?professional=1`);
  assertStatus(professionalSite, 200, "read professional site deployment settings");
  site = professionalSite.body.site;

  const configured = await call(`/api/sites/${encodeURIComponent(site.id)}/deployment-target`, {
    method: "PUT",
    body: {
      expectedRevision: site.deploymentTarget.revision,
      kind: "ssh_static",
      displayName: "真实主机自托管",
      remoteProjectRef: scope.id,
      customDomain: config.domain,
    },
  });
  assertStatus(configured, 200, "link SSH scope to My Site");
  site = configured.body.site;
  assert.equal(site.deploymentTarget.credentialRef, null, "the site target must not duplicate the host credential reference");

  const targetVerified = await call(`/api/sites/${encodeURIComponent(site.id)}/deployment-target/verify`, { method: "POST", body: {} });
  assertStatus(targetVerified, 200, "verify My Site SSH deployment target");
  site = targetVerified.body.site;

  let failureProtection = null;
  let publicationFlow = null;
  if (config.expectPublishFailure) {
    const planned = await call(`/api/sites/${encodeURIComponent(site.id)}/publication-plans`, { method: "POST", body: {} });
    assertStatus(planned, 201, "plan real SSH publication");
    const attempted = await call(`/api/sites/${encodeURIComponent(site.id)}/publication-plans/${encodeURIComponent(planned.body.plan.id)}/confirm`, {
      method: "POST",
      body: { confirmed: true },
    });
    assertStatus(attempted, 502, "expect HTTPS-gated real SSH publication failure");
    assert.equal(attempted.body.error, "site_deployment_healthcheck_failed");
    const afterFailure = await call(`/api/sites/${encodeURIComponent(site.id)}?professional=1`);
    assertStatus(afterFailure, 200, "read site after failed publication");
    assert.equal(afterFailure.body.site.activePublicationId ?? null, null, "a failed first publication must not become active");
    failureProtection = {
      attempted: true,
      error: attempted.body.error,
      retryable: attempted.body.retryable,
      activePublicationId: afterFailure.body.site.activePublicationId ?? null,
    };
  }
  if (config.runPublication) {
    const beforePublication = await call(`/api/sites/${encodeURIComponent(site.id)}`);
    assertStatus(beforePublication, 200, "read validation site before publication");
    const homeSummary = beforePublication.body.site.entries.find((entry) => entry.slug === "home");
    assert.ok(homeSummary, "validation site home page is missing");
    const homeBefore = await call(`/api/sites/${encodeURIComponent(site.id)}/entries/${encodeURIComponent(homeSummary.id)}`);
    assertStatus(homeBefore, 200, "read validation home page");
    const firstTitle = homeBefore.body.entry.title;

    const first = await publishSite(site.id, "publish v1");
    const firstBytes = await readSiteBytes(config.siteUrl);
    assert.match(firstBytes.toString("utf8"), new RegExp(escapeRegExp(firstTitle)));

    const secondTitle = `${firstTitle} · v2`;
    const edited = await call(`/api/sites/${encodeURIComponent(site.id)}/entries/${encodeURIComponent(homeSummary.id)}`, {
      method: "PATCH",
      body: { expectedRevision: homeBefore.body.entry.revision, title: secondTitle },
    });
    assertStatus(edited, 200, "edit validation home page for v2");
    const second = await publishSite(site.id, "publish v2");
    const secondBytes = await readSiteBytes(config.siteUrl);
    assert.match(secondBytes.toString("utf8"), new RegExp(escapeRegExp(secondTitle)));

    const rollbackPlan = await call(`/api/sites/${encodeURIComponent(site.id)}/rollback-plans`, {
      method: "POST",
      body: { targetPublicationId: first.body.publication.id },
    });
    assertStatus(rollbackPlan, 201, "plan rollback to v1");
    const rolledBack = await call(`/api/sites/${encodeURIComponent(site.id)}/rollback-plans/${encodeURIComponent(rollbackPlan.body.plan.id)}/confirm`, {
      method: "POST",
      body: { confirmed: true },
    });
    assertStatus(rolledBack, 200, "rollback to v1");
    const rollbackBytes = await readSiteBytes(config.siteUrl);
    assert.match(rollbackBytes.toString("utf8"), new RegExp(escapeRegExp(firstTitle)));
    assert.doesNotMatch(rollbackBytes.toString("utf8"), new RegExp(escapeRegExp(secondTitle)));
    site = rolledBack.body.site;
    publicationFlow = {
      firstPublicationId: first.body.publication.id,
      secondPublicationId: second.body.publication.id,
      activePublicationId: rolledBack.body.publication.id,
      publicUrl: site.publicUrl,
      firstBytes: firstBytes.length,
      secondBytes: secondBytes.length,
      rollbackBytes: rollbackBytes.length,
    };
  }

  const entries = await call(`/api/host-file-scopes/${encodeURIComponent(scope.id)}/entries`);
  assertStatus(entries, 200, "inspect managed publishing layout");
  const layoutNames = entries.body.entries.map((entry) => entry.name).sort();
  assert.ok(layoutNames.includes("releases"), "managed releases directory is missing");
  if (config.expectPublishFailure) assert.equal(layoutNames.includes("current"), false, "failed first publication must remove the active pointer");
  if (config.runPublication) assert.equal(layoutNames.includes("current"), true, "successful publication must keep the active pointer");

  console.log(JSON.stringify({
    ok: true,
    host: {
      id: host.id,
      address: `${host.host}:${host.port}`,
      fingerprint: host.knownHostFingerprint,
      connectionStatus: host.connectionStatus,
      capabilities: host.capabilities,
    },
    scope: {
      id: scope.id,
      rootPath: scope.rootPath,
      resolvedRootPath: scope.resolvedRootPath,
      status: scope.status,
      permissions: scope.permissions,
      managedEntries: layoutNames,
    },
    site: {
      id: site.id,
      deploymentKind: site.deploymentTarget.kind,
      deploymentStatus: site.deploymentTarget.status,
      credentialRef: site.deploymentTarget.credentialRef,
      domain: site.deploymentTarget.customDomain,
    },
    failureProtection,
    publicationFlow,
    nextGate: "Configure a trusted HTTPS domain whose web root points to <scope>/current before publishing.",
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
} finally {
  if (base && credentialReference) {
    await call("/api/internal/site-credentials", {
      method: "DELETE",
      headers: { "x-desktop-credential-token": desktopToken },
      body: { reference: credentialReference },
    }).catch(() => {});
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  rmSync(temporaryRoot, { recursive: true, force: true });
}

function requiredEnv(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function boundedPort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("MYAGENTTOOL_REAL_SSH_PORT must be a valid TCP port.");
  return port;
}

async function call(path, { method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const responseBody = await response.json();
  return { status: response.status, body: responseBody };
}

function assertStatus(result, expected, operation) {
  assert.equal(result.status, expected, `${operation} failed (${result.status}): ${JSON.stringify(result.body)}`);
}

function createMappedSshSiteAdapter({ createSshStaticSiteAdapter, state, sshHostConnector, resolveCredential, siteUrl, privateAddress }) {
  const mappedUrl = new URL(siteUrl);
  const strictAdapter = createSshStaticSiteAdapter({
    state,
    sshHostConnector,
    resolveCredential,
    validatePublicHost: async () => ({ address: privateAddress }),
    fetchImpl: async (requestedUrl, options) => {
      const requested = new URL(requestedUrl);
      const destination = new URL(mappedUrl);
      destination.search = requested.search;
      return fetch(destination, options);
    },
  });
  const mapUrl = (result) => ({ ...result, url: mappedUrl.href, publicUrl: mappedUrl.href });
  return {
    verifyConnection: async (input) => mapUrl(await strictAdapter.verifyConnection(input)),
    deploy: async (input) => mapUrl(await strictAdapter.deploy(input)),
    rollback: async (input) => mapUrl(await strictAdapter.rollback(input)),
  };
}

async function publishSite(siteId, operation) {
  const planned = await call(`/api/sites/${encodeURIComponent(siteId)}/publication-plans`, { method: "POST", body: {} });
  assertStatus(planned, 201, `${operation} plan`);
  const published = await call(`/api/sites/${encodeURIComponent(siteId)}/publication-plans/${encodeURIComponent(planned.body.plan.id)}/confirm`, {
    method: "POST",
    body: { confirmed: true },
  });
  assertStatus(published, 200, operation);
  return published;
}

async function readSiteBytes(siteUrl) {
  const url = new URL(siteUrl);
  url.searchParams.set("myagenttool_acceptance", Date.now().toString(36));
  const response = await fetch(url, { headers: { Accept: "text/html", "Cache-Control": "no-cache" }, redirect: "error" });
  assert.equal(response.status, 200, `internal site returned ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
