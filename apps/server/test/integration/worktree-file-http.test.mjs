process.env.MYAGENTTOOL_STATE_DISABLED = "1";

// The worktree file/browse endpoints must read the WORKTREE's own directory, not
// the parent project clone — otherwise a worktree's changes (a design run's
// design/*.html artifacts) are invisible and the browser shows the parent files.
// Regression for the D3 demo finding.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const now = () => new Date().toISOString();
let server;
let base;

before(async () => {
  const { createServerState } = await import("../../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../../src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../../src/runtime/http-server.mjs");

  const projectDir = mkdtempSync(join(tmpdir(), "wt-parent-"));
  writeFileSync(join(projectDir, "README.md"), "parent clone\n");
  const worktreeDir = mkdtempSync(join(tmpdir(), "wt-child-"));
  mkdirSync(join(worktreeDir, "design"), { recursive: true });
  // Exists ONLY in the worktree, not the parent clone.
  writeFileSync(join(worktreeDir, "design", "mockup.html"), "<!DOCTYPE html><title>Mockup</title>");

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
