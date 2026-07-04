/*
 * #305: a git-source application must NOT clone synchronously (that blocks the
 * whole server event loop). Registration returns immediately in a "probing"
 * state and the clone runs in the background, settling the app to
 * "registered" (success) or "failed" (error).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createApplicationService } from "../src/services/applications.mjs";

function make(cloneProject) {
  const state = { applications: [], projects: [] };
  const service = createApplicationService({
    state,
    now: () => "2026-07-04T00:00:00.000Z",
    nextId: (p) => `${p}_x`,
    appendEvent: () => {},
    persistStateSoon: () => {},
    addProject: () => null,
    cloneProject,
    defaultProjectPath: "/tmp/repo",
  });
  return { state, service };
}

const gitBody = { source: { type: "git", url: "https://example.com/x.git" } };
const tick = () => new Promise((r) => setImmediate(r));

test("git registration returns 'probing' immediately without awaiting the clone", () => {
  let started = false;
  const { service } = make(() => { started = true; return new Promise(() => {}); }); // never resolves
  const app = service.registerApplication(gitBody);
  assert.equal(app.status, "probing");
  assert.equal(app.projectId, null);
  assert.equal(started, true, "clone is kicked off in the background, not awaited");
});

test("transitions to 'registered' with the project linked when the clone resolves", async () => {
  const { service } = make(() => Promise.resolve({ id: "prj_cloned", path: "/repo/x" }));
  const app = service.registerApplication(gitBody);
  assert.equal(app.status, "probing");
  await tick();
  assert.equal(app.status, "registered");
  assert.equal(app.projectId, "prj_cloned");
  assert.equal(app.path, "/repo/x");
});

test("transitions to 'failed' (with the error) when the clone rejects", async () => {
  const { service } = make(() => Promise.reject(new Error("clone boom")));
  const app = service.registerApplication(gitBody);
  await tick();
  assert.equal(app.status, "failed");
  assert.match(app.lifecycle.error, /clone boom/);
});
