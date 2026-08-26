process.env.MYAGENT_REQUIRE_AUTH = "0";
process.env.MYAGENTTOOL_STATE_DISABLED = "1";
process.env.MYAGENT_DESKTOP_CREDENTIAL_TOKEN = "desktop-credential-token-for-tests";

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createCanvas } from "@napi-rs/canvas";

let server;
let base;

before(async () => {
  const { createServerState } = await import("../../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../../src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../../src/runtime/http-server.mjs");
  let tick = 0;
  const now = () => new Date(Date.parse("2026-08-24T00:00:00.000Z") + tick++ * 1000).toISOString();
  const projectPath = mkdtempSync(join(tmpdir(), "site-http-project-"));
  const statePath = join(mkdtempSync(join(tmpdir(), "site-http-state-")), "state.json");
  const created = createServerState({ defaultProjectPath: projectPath, now });
  const { httpDependencies } = createServerRuntimeServices({
    namespace: "site-http-test", protocolVersion: "0.0.0", state: created.state,
    defaultProject: created.defaultProject, defaultProjectPath: projectPath,
    persistenceEnabled: false, stateStorePath: statePath, stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000, now,
  });
  server = createHttpServer({ host: "127.0.0.1", port: 0, namespace: "site-http-test", protocolVersion: "0.0.0", ...httpDependencies });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

async function call(path, { method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test("site HTTP flow creates, edits, previews, plans, and publishes one immutable version", async () => {
  const created = await call("/api/sites", { method: "POST", body: {
    name: "HTTP 官网", description: "从一个简单流程发布", audience: "普通访客",
    primaryAction: "联系我们", contactEmail: "hello@example.com",
  } });
  assert.equal(created.status, 201);
  const site = created.body.site;
  assert.equal(site.entries.length, 5);

  const homeSummary = site.entries.find((entry) => entry.slug === "home");
  const home = await call(`/api/sites/${site.id}/entries/${homeSummary.id}`);
  const edited = await call(`/api/sites/${site.id}/entries/${homeSummary.id}`, { method: "PATCH", body: {
    expectedRevision: home.body.entry.revision,
    title: "新的首页",
    summary: "更新后的摘要",
    slug: "home",
    status: "draft",
    blocks: [{ id: "hero", type: "hero", data: { title: "新的首页", subtitle: "安全预览后发布" } }],
  } });
  assert.equal(edited.status, 200);

  const preview = await call(`/api/sites/${site.id}/preview?path=index.html`);
  assert.equal(preview.status, 200);
  assert.match(preview.body.preview.html, /新的首页/);

  const planned = await call(`/api/sites/${site.id}/publication-plans`, { method: "POST", body: {} });
  assert.equal(planned.status, 201);
  assert.equal(planned.body.plan.status, "planned");
  const published = await call(`/api/sites/${site.id}/publication-plans/${planned.body.plan.id}/confirm`, { method: "POST", body: { confirmed: true } });
  assert.equal(published.status, 200);
  assert.equal(published.body.site.visibility, "private_preview");
  assert.ok(published.body.site.activePublicationId, "a local release is active without claiming public hosting");
  assert.equal(published.body.site.unpublishedCount, 0);

  const completedPlan = await call(`/api/sites/${site.id}/publication-plans/${planned.body.plan.id}`);
  assert.equal(completedPlan.body.plan.progress.stage, "completed");
  assert.equal(completedPlan.body.plan.snapshot, undefined);

  const history = await call(`/api/sites/${site.id}/publications`);
  assert.equal(history.body.count, 1);
  assert.equal(history.body.publications[0].verification.status, "healthy");
});

test("desktop site credential handoff is write-only and requires its independent token", async () => {
  const body = {
    reference: "credential://aliyun/main",
    provider: "aliyun_oss_cdn",
    credential: { accessKeyId: "LTAI5exampleKey", accessKeySecret: "never-return-this" },
  };
  const hidden = await call("/api/internal/site-credentials", { method: "PUT", body });
  assert.equal(hidden.status, 404);
  const stored = await call("/api/internal/site-credentials", {
    method: "PUT",
    headers: { "x-desktop-credential-token": "desktop-credential-token-for-tests" },
    body,
  });
  assert.equal(stored.status, 200);
  assert.deepEqual(stored.body, { ok: true, reference: "credential://aliyun/main" });
  assert.equal(JSON.stringify(stored.body).includes("never-return-this"), false);
  const unreadable = await call("/api/internal/site-credentials", {
    headers: { "x-desktop-credential-token": "desktop-credential-token-for-tests" },
  });
  assert.equal(unreadable.status, 405);
  const removed = await call("/api/internal/site-credentials", {
    method: "DELETE",
    headers: { "x-desktop-credential-token": "desktop-credential-token-for-tests" },
    body: { reference: "credential://aliyun/main" },
  });
  assert.equal(removed.status, 200);
});

test("desktop Cloudflare credential handoff is write-only and provider scoped", async () => {
  const stored = await call("/api/internal/site-credentials", {
    method: "PUT",
    headers: { "x-desktop-credential-token": "desktop-credential-token-for-tests" },
    body: {
      reference: "credential://cloudflare/main",
      provider: "cloudflare_pages",
      credential: { accountId: "0123456789abcdef0123456789abcdef", apiToken: "never-return-cloudflare-token" },
    },
  });
  assert.deepEqual(stored.body, { ok: true, reference: "credential://cloudflare/main" });
  assert.equal(JSON.stringify(stored.body).includes("never-return"), false);
  const mismatched = await call("/api/internal/site-credentials", {
    method: "PUT",
    headers: { "x-desktop-credential-token": "desktop-credential-token-for-tests" },
    body: {
      reference: "credential://aliyun/main",
      provider: "cloudflare_pages",
      credential: { accountId: "0123456789abcdef0123456789abcdef", apiToken: "x" },
    },
  });
  assert.equal(mismatched.status, 400);
  assert.equal(mismatched.body.error, "site_credential_invalid");
  assert.equal((await call("/api/internal/site-credentials", {
    method: "DELETE",
    headers: { "x-desktop-credential-token": "desktop-credential-token-for-tests" },
    body: { reference: "credential://cloudflare/main" },
  })).status, 200);
});

test("desktop AliDNS credential handoff uses an independent provider namespace", async () => {
  const stored = await call("/api/internal/site-credentials", {
    method: "PUT",
    headers: { "x-desktop-credential-token": "desktop-credential-token-for-tests" },
    body: {
      reference: "credential://alidns/main",
      provider: "alidns_acme",
      credential: { accessKeyId: "LTAI5dnsExampleKey", accessKeySecret: "never-return-dns-secret" },
    },
  });
  assert.deepEqual(stored.body, { ok: true, reference: "credential://alidns/main" });
  assert.equal(JSON.stringify(stored.body).includes("never-return"), false);
  const mismatched = await call("/api/internal/site-credentials", {
    method: "PUT",
    headers: { "x-desktop-credential-token": "desktop-credential-token-for-tests" },
    body: {
      reference: "credential://aliyun/main",
      provider: "alidns_acme",
      credential: { accessKeyId: "LTAI5dnsExampleKey", accessKeySecret: "x" },
    },
  });
  assert.equal(mismatched.status, 400);
  assert.equal(mismatched.body.error, "site_credential_invalid");
  assert.equal((await call("/api/internal/site-credentials", {
    method: "DELETE",
    headers: { "x-desktop-credential-token": "desktop-credential-token-for-tests" },
    body: { reference: "credential://alidns/main" },
  })).status, 200);
});

test("publication confirmation is explicit and provider discovery reports implemented adapters", async () => {
  const providers = await call("/api/site-deployment-providers");
  assert.equal(providers.status, 200);
  assert.equal(providers.body.providers.find((provider) => provider.kind === "cloudflare_pages").productionReady, true);
  assert.equal(providers.body.providers.find((provider) => provider.kind === "aliyun_oss_cdn").productionReady, true);

  const list = await call("/api/sites");
  const planned = await call(`/api/sites/${list.body.sites[0].id}/publication-plans`, { method: "POST", body: {} });
  const refused = await call(`/api/sites/${list.body.sites[0].id}/publication-plans/${planned.body.plan.id}/confirm`, { method: "POST", body: { confirmed: false } });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, "site_publication_confirmation_required");

  const verified = await call(`/api/sites/${list.body.sites[0].id}/deployment-target/verify`, { method: "POST", body: {} });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.site.deploymentTarget.status, "ready");
});

test("domain and HTTPS binding endpoint fails closed until an SSH publishing target exists", async () => {
  const list = await call("/api/sites");
  const configured = await call(`/api/sites/${list.body.sites[0].id}/domain-tls-binding`, {
    method: "PUT",
    body: { expectedRevision: 0, hostname: "lan.mytoolagent.com", accessMode: "private_lan" },
  });
  assert.equal(configured.status, 409);
  assert.equal(configured.body.error, "site_domain_ssh_target_required");
  const verifyDns = await call(`/api/sites/${list.body.sites[0].id}/domain-tls-binding/verify-dns`, {
    method: "POST", body: { expectedRevision: 0 },
  });
  assert.equal(verifyDns.status, 404);
  assert.equal(verifyDns.body.error, "site_domain_tls_binding_not_found");
  const issueStaging = await call(`/api/sites/${list.body.sites[0].id}/domain-tls-binding/issue-staging`, {
    method: "POST", body: { expectedRevision: 0, confirmed: true },
  });
  assert.equal(issueStaging.status, 404);
  assert.equal(issueStaging.body.error, "site_domain_tls_binding_not_found");
});

test("site image HTTP endpoints accept bounded binary uploads and serve managed content", async () => {
  const list = await call("/api/sites");
  const site = list.body.sites[0];
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x11, 0x22]);
  const uploadResponse = await fetch(`${base}/api/sites/${site.id}/assets?name=${encodeURIComponent("HTTP 图片.png")}&clientFileId=http-file-1`, {
    method: "PUT", headers: { "content-type": "image/png" }, body: png,
  });
  assert.equal(uploadResponse.status, 201);
  const uploaded = await uploadResponse.json();
  assert.equal(uploaded.asset.name, "HTTP 图片.png");

  const assets = await call(`/api/sites/${site.id}/assets`);
  assert.equal(assets.status, 200);
  assert.equal(assets.body.count, 1);
  assert.equal(assets.body.usage.bytes, png.length);

  const content = await fetch(`${base}/api/sites/${site.id}/assets/${uploaded.asset.id}/content`);
  assert.equal(content.status, 200);
  assert.equal(content.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await content.arrayBuffer()), png);

  const canvas = createCanvas(800, 450);
  canvas.getContext("2d").fillRect(0, 0, 800, 450);
  const validUploadResponse = await fetch(`${base}/api/sites/${site.id}/assets?name=responsive.png`, {
    method: "PUT", headers: { "content-type": "image/png" }, body: canvas.toBuffer("image/png"),
  });
  assert.equal(validUploadResponse.status, 201);
  const validUpload = await validUploadResponse.json();
  assert.equal(validUpload.asset.derivatives[0].key, "w480");
  const derivative = await fetch(`${base}/api/sites/${site.id}/assets/${validUpload.asset.id}/content?variant=w480`);
  assert.equal(derivative.status, 200);
  assert.equal(derivative.headers.get("content-type"), "image/webp");
  assert.equal(Buffer.from(await derivative.arrayBuffer()).subarray(0, 4).toString("ascii"), "RIFF");

  const mismatch = await fetch(`${base}/api/sites/${site.id}/assets?name=wrong.jpg`, {
    method: "PUT", headers: { "content-type": "image/jpeg" }, body: png,
  });
  assert.equal(mismatch.status, 400);
  assert.equal((await mismatch.json()).error, "site_asset_content_type_mismatch");
});

test("host file upload binary requests reach the governed transfer route", async () => {
  const response = await fetch(`${base}/api/host-file-scopes/missing/transfers/upload?filename=probe.txt`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream", "x-transfer-confirmed": "true" },
    body: Buffer.from("probe"),
  });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "host_file_scope_not_found" });
});
