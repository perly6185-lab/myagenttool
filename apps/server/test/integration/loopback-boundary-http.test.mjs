/*
 * #1616 loopback trust boundary, wired end-to-end through the real HTTP
 * server: Host allowlist (DNS rebinding), per-launch token gate, and the
 * mutating content-type gate. The token is read from the environment at
 * server construction, so it is set before the runtime imports.
 */
const LOOPBACK_TOKEN = "loopback-integration-token-0123456789abcdef";
process.env.MYAGENT_LOOPBACK_TOKEN = LOOPBACK_TOKEN;
process.env.MYAGENTTOOL_STATE_DISABLED = "1";

import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";

let server;
let base;

// fetch (undici) refuses to forge the Host header, which is exactly what a
// rebinding attack does — so drive that case with node:http directly.
function rawRequest(path, { host, headers = {} } = {}) {
  return new Promise((resolvePromise, reject) => {
    const port = server.address().port;
    const req = http.request(
      { host: "127.0.0.1", port, path, headers: { ...headers, ...(host ? { Host: host } : {}) } },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolvePromise({
          status: res.statusCode ?? 0,
          json: () => JSON.parse(Buffer.concat(chunks).toString("utf8")),
        }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

before(async () => {
  const { createServerState } = await import("../../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../../src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../../src/runtime/http-server.mjs");
  const now = () => new Date().toISOString();
  const created = createServerState({ defaultProjectPath: "/tmp", now });
  const { httpDependencies } = createServerRuntimeServices({
    namespace: "loopback-boundary-http-test",
    protocolVersion: "0.0.0",
    state: created.state,
    defaultProject: created.defaultProject,
    defaultProjectPath: "/tmp",
    persistenceEnabled: false,
    stateStorePath: "/tmp/unused-loopback-http.json",
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
  });
  server = createHttpServer({
    host: "127.0.0.1",
    port: 0,
    namespace: "loopback-boundary-http-test",
    protocolVersion: "0.0.0",
    ...httpDependencies,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

test("a non-loopback Host header is rejected on every path — the DNS-rebinding door", async () => {
  for (const path of ["/health", "/api/state"]) {
    const response = await rawRequest(path, {
      host: "evil.example",
      headers: { "x-loopback-token": LOOPBACK_TOKEN },
    });
    assert.equal(response.status, 403, `${path} must reject a rebound Host`);
    assert.equal(response.json().error, "host_not_allowed");
  }
  const legitimate = await rawRequest("/health", { host: `127.0.0.1:${server.address().port}` });
  assert.equal(legitimate.status, 200, "the same raw client with a loopback Host still passes");
});

test("without the launch token, /api is closed to arbitrary local processes", async () => {
  const bare = await fetch(`${base}/api/state`);
  assert.equal(bare.status, 401);
  assert.equal((await bare.json()).error, "loopback_token_required");

  const wrong = await fetch(`${base}/api/state`, {
    headers: { "x-loopback-token": "x".repeat(LOOPBACK_TOKEN.length) },
  });
  assert.equal(wrong.status, 401);

  const mutating = await fetch(`${base}/api/invocations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(mutating.status, 401, "writes fail closed too");
});

test("with the launch token, the API works; /health stays open for liveness", async () => {
  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200, "/health is not under /api — probes need no secret");

  const withToken = await fetch(`${base}/api/state`, {
    headers: { "x-loopback-token": LOOPBACK_TOKEN },
  });
  assert.equal(withToken.status, 200);
  assert.ok((await withToken.json()).device !== undefined, "returns the real state snapshot");
});

test("declared non-JSON writes are 415 — the cross-site simple-request vector", async () => {
  for (const contentType of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
    const response = await fetch(`${base}/api/agents`, {
      method: "POST",
      headers: { "content-type": contentType, "x-loopback-token": LOOPBACK_TOKEN },
      body: "id=evil",
    });
    assert.equal(response.status, 415, `${contentType} must be rejected before routing`);
    assert.equal((await response.json()).error, "unsupported_content_type");
  }
});

test("the task-material PUT can carry binary content past the JSON gate", async () => {
  const response = await fetch(`${base}/api/projects/prj_myagenttool/task-material-drafts/draft_1/files/file_1?name=reference.pdf`, {
    method: "PUT",
    headers: { "content-type": "application/pdf", "x-loopback-token": LOOPBACK_TOKEN },
    body: "%PDF-1.7",
  });

  assert.equal(response.status, 404, "the binary upload reaches ordinary task-material routing instead of being rejected as non-JSON");
  assert.equal((await response.json()).error, "task_material_draft_not_found");
});
