import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { after, before, test } from "node:test";

// GET /api/applications/:id/recovery-archive — the read half of the retention
// archive (docs: retention-archive.mjs). Recovery actions the 200-row cap
// evicted are recoverable per application, tenancy-guarded, without loading the
// full state file. Seeded by writing the archive JSONL directly (the write path
// is covered by retention-archive.test.mjs); this exercises the endpoint.

const now = () => new Date().toISOString();
let server;
let base;
let stateStorePath;
let appA;
let appB;

before(async () => {
  const { createServerState } = await import("../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../src/runtime/http-server.mjs");

  const projectDir = mkdtempSync(join(tmpdir(), "archive-project-"));
  stateStorePath = join(mkdtempSync(join(tmpdir(), "archive-state-")), "state.json");

  const created = createServerState({ defaultProjectPath: projectDir, now });
  const { httpDependencies } = createServerRuntimeServices({
    namespace: "test",
    protocolVersion: "0.0.0",
    state: created.state,
    defaultProject: created.defaultProject,
    defaultProjectPath: projectDir,
    persistenceEnabled: false,
    stateStorePath,
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
  });
  server = createHttpServer({ host: "127.0.0.1", port: 0, namespace: "test", protocolVersion: "0.0.0", ...httpDependencies });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const regA = await call("/api/applications/register", { method: "POST", body: { source: { type: "manual", uri: "https://example.com/a" }, name: "app-a" } });
  const regB = await call("/api/applications/register", { method: "POST", body: { source: { type: "manual", uri: "https://example.com/b" }, name: "app-b" } });
  appA = regA.body.application.id;
  appB = regB.body.application.id;

  // Seed the archive directly: two evicted recovery actions for app A, one for app B.
  const archiveDir = join(dirname(stateStorePath), "archive");
  mkdirSync(archiveDir, { recursive: true });
  const line = (archivedAt, row) => JSON.stringify({ archivedAt, collection: "applicationRecoveryActions", row });
  writeFileSync(join(archiveDir, "applicationRecoveryActions.jsonl"), [
    line("2026-07-12T00:00:01.000Z", { id: "rec_a1", applicationId: appA, actionType: "rerun", status: "executed" }),
    line("2026-07-12T00:00:02.000Z", { id: "rec_b1", applicationId: appB, actionType: "regenerate_orchestration", status: "approval_denied" }),
    line("2026-07-12T00:00:03.000Z", { id: "rec_a2", applicationId: appA, actionType: "rerun", status: "failed" }),
  ].join("\n") + "\n");
});

after(() => server?.close());

test("returns only this application's evicted recovery actions, most-recent first", async () => {
  const res = await call(`/api/applications/${appA}/recovery-archive`);
  assert.equal(res.status, 200);
  assert.equal(res.body.applicationId, appA);
  assert.deepEqual(res.body.entries.map((e) => e.row.id), ["rec_a2", "rec_a1"], "app A rows only, newest archived first");
  assert.equal(res.body.entries[0].row.applicationId, appA);
  assert.equal(res.body.entries[0].archivedAt, "2026-07-12T00:00:03.000Z");
});

test("limit bounds the result", async () => {
  const res = await call(`/api/applications/${appA}/recovery-archive?limit=1`);
  assert.equal(res.body.entries.length, 1);
  assert.equal(res.body.entries[0].row.id, "rec_a2");
});

test("app B returns its single archived row (never app A's)", async () => {
  const res = await call(`/api/applications/${appB}/recovery-archive`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.entries.map((e) => e.row.id), ["rec_b1"]);
});

test("an unknown application is rejected by the tenancy guard, not served", async () => {
  const res = await call("/api/applications/app_does_not_exist/recovery-archive");
  assert.equal(res.status, 404);
  assert.equal(res.body.error, "application_not_found");
});

async function call(path, { method = "GET", body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed };
}
