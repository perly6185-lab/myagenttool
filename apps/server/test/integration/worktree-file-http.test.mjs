process.env.MYAGENTTOOL_STATE_DISABLED = "1";

// The worktree file/browse endpoints must read the WORKTREE's own directory, not
// the parent project clone — otherwise a worktree's changes (a design run's
// design/*.html artifacts) are invisible and the browser shows the parent files.
// Regression for the D3 demo finding.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const now = () => new Date().toISOString();
let server;
let base;
let worktreeDir;

before(async () => {
  const { createServerState } = await import("../../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../../src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../../src/runtime/http-server.mjs");

  const projectDir = mkdtempSync(join(tmpdir(), "wt-parent-"));
  writeFileSync(join(projectDir, "README.md"), "parent clone\n");
  worktreeDir = mkdtempSync(join(tmpdir(), "wt-child-"));
  mkdirSync(join(worktreeDir, "design"), { recursive: true });
  // Exists ONLY in the worktree, not the parent clone.
  writeFileSync(join(worktreeDir, "design", "mockup.html"), "<!DOCTYPE html><title>Mockup</title>");
  // a 1x1 PNG (base64) for the image-serving test
  writeFileSync(join(worktreeDir, "design", "shot.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
  // A secret OUTSIDE the worktree + an in-tree symlink pointing at it (the audit
  // read-scope-escape scenario).
  const secretDir = mkdtempSync(join(tmpdir(), "wt-secret-"));
  writeFileSync(join(secretDir, "creds"), "TOP-SECRET");
  try { symlinkSync(join(secretDir, "creds"), join(worktreeDir, "design", "leak.html")); } catch { /* symlink perms */ }

  const { defaultProject, state } = createServerState({ defaultProjectPath: projectDir, now });
  state.worktrees.push({
    id: "wt1",
    projectId: defaultProject.id,
    workspaceProjectId: defaultProject.id,
    path: worktreeDir,
    worktreePath: worktreeDir,
    branchName: "myagent/design",
    createdAt: now(),
  });

  const { httpDependencies } = createServerRuntimeServices({
    namespace: "test",
    protocolVersion: "0.0.0",
    state,
    defaultProject,
    defaultProjectPath: projectDir,
    persistenceEnabled: false,
    stateStorePath: "/tmp/unused-wtfile.json",
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
  });
  server = createHttpServer({ host: "127.0.0.1", port: 0, namespace: "test", protocolVersion: "0.0.0", ...httpDependencies });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

test("GET /api/worktrees/:id/file reads a file that exists only in the worktree", async () => {
  const res = await fetch(`${base}/api/worktrees/wt1/file?path=design/mockup.html`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.path, "design/mockup.html");
  assert.match(body.content, /<!DOCTYPE html>/, "reads the worktree file, not the parent clone (where design/ is absent)");
});

test("GET /api/worktrees/:id/files lists the worktree's own tree", async () => {
  const res = await fetch(`${base}/api/worktrees/wt1/files?path=design`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok((body.tree ?? []).some((n) => n.name === "mockup.html"), "the worktree-only design/ dir is browsable");
});

test("GET /api/worktrees/:id/file rejects an in-tree symlink pointing outside the worktree", async () => {
  const res = await fetch(`${base}/api/worktrees/wt1/file?path=design/leak.html`);
  assert.notEqual(res.status, 200, "a symlink to a host secret must be rejected, not read");
  const body = await res.json();
  assert.ok(!String(body.content ?? "").includes("TOP-SECRET"), "the secret must never be returned");
});

test("GET /api/worktrees/:id/file returns an image as base64 with a mime type (D5)", async () => {
  const res = await fetch(`${base}/api/worktrees/wt1/file?path=design/shot.png`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.encoding, "base64");
  assert.equal(body.mime, "image/png");
  assert.ok(body.content.length > 0, "base64 image bytes returned");
});

test("POST /api/worktrees/:id/attachments replays one stable batch for the run idempotency key", async () => {
  const payload = {
    batchId: "run-attachment-batch-1",
    files: [{ name: "notes.txt", dataBase64: Buffer.from("same attachment\n").toString("base64") }],
  };
  const first = await fetch(`${base}/api/worktrees/wt1/attachments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const replay = await fetch(`${base}/api/worktrees/wt1/attachments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  assert.equal(first.status, 201);
  assert.equal(replay.status, 201);
  const firstBody = await first.json();
  const replayBody = await replay.json();
  assert.deepEqual(replayBody, firstBody, "a retry returns the exact same attachment paths");
  assert.equal(firstBody.attachments.length, 1);
  assert.equal(readFileSync(join(worktreeDir, ...firstBody.attachments[0].path.split("/")), "utf8"), "same attachment\n");
  const batchDir = join(worktreeDir, ".myagenttool", "attachments", firstBody.batchId);
  assert.equal(readdirSync(batchDir).filter((name) => name !== "manifest.json").length, 1, "retry creates no duplicate file");
});

test("POST /api/worktrees/:id/attachments rejects reuse with a different snapshot", async () => {
  const response = await fetch(`${base}/api/worktrees/wt1/attachments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      batchId: "run-attachment-batch-1",
      files: [{ name: "notes.txt", dataBase64: Buffer.from("changed attachment\n").toString("base64") }],
    }),
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "worktree_attachment_batch_conflict");
});

test("POST /api/worktrees/:id/attachments reports every bounded rejection", async () => {
  const response = await fetch(`${base}/api/worktrees/wt1/attachments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      batchId: "run-attachment-batch-skipped",
      files: [
        { name: "empty.txt", dataBase64: "" },
        ...Array.from({ length: 6 }, (_, index) => ({
          name: `file-${index}.txt`,
          dataBase64: Buffer.from(String(index)).toString("base64"),
        })),
      ],
    }),
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.deepEqual(body.skipped.map((item) => item.reason), ["empty", "too_many"]);
});
