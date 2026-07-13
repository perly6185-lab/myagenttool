/*
 * Refusal model (#758) Tier-2 coverage: HTTP-error gates that deny via a
 * sendJson response (lifecycle_gate_blocked, rollback_gate_blocked,
 * project_remove_blocked) now record a first-class refusal in the owner's ledger
 * — with NO event (the HTTP error already surfaces it), so the refusal lens can
 * answer "what did this device refuse?" without changing any HTTP contract.
 */

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { recordHttpGateRefusal } from "../src/routes/refusal-http-gate.mjs";

const now = () => "2026-07-13T00:00:00.000Z";

// --- unit: the shared helper ---

test("recordHttpGateRefusal derives the category from the code and fires no event", () => {
  const calls = [];
  const refuse = (args) => calls.push(args);
  recordHttpGateRefusal(refuse, {
    subjectKind: "lifecycle_action",
    subjectId: "lcr_1",
    code: "action_not_permitted",
    summary: "blocked",
    evidence: { x: 1 },
    remedy: "fix it",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].category, "policy", "action_not_permitted → policy, derived from the closed map");
  assert.equal(calls[0].code, "action_not_permitted");
  assert.equal(calls[0].event, null, "HTTP-gate refusals fire no event");
  assert.equal(calls[0].appealTo, "device_owner");

  const stateCase = [];
  recordHttpGateRefusal((a) => stateCase.push(a), { subjectKind: "registration", subjectId: "prj_1", code: "subject_not_actionable", summary: "s" });
  assert.equal(stateCase[0].category, "state", "subject_not_actionable → state");
});

test("recordHttpGateRefusal is a no-op when refuse() is not wired", () => {
  assert.doesNotThrow(() => recordHttpGateRefusal(undefined, { subjectKind: "registration", subjectId: "x", code: "subject_not_actionable", summary: "s" }));
});

// --- integration: a real gate (removing the last project) records a refusal ---

let server;
let base;
let state;

before(async () => {
  const { createServerState } = await import("../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../src/runtime/http-server.mjs");

  const projectDir = mkdtempSync(join(tmpdir(), "refusal-gate-"));
  const created = createServerState({ defaultProjectPath: projectDir, now });
  state = created.state;
  const { httpDependencies: deps } = createServerRuntimeServices({
    namespace: "test",
    protocolVersion: "0.0.0",
    state,
    defaultProject: created.defaultProject,
    defaultProjectPath: projectDir,
    persistenceEnabled: false,
    stateStorePath: "/tmp/unused.json",
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
  });
  server = createHttpServer({ host: "127.0.0.1", port: 0, namespace: "test", protocolVersion: "0.0.0", ...deps });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

test("project_remove_blocked (removing the last project) records a state/subject_not_actionable refusal, no event", async () => {
  const project = state.projects[0];
  assert.ok(project, "a default project exists");
  const eventsBefore = state.events.length;

  const res = await fetch(`${base}/api/projects/${encodeURIComponent(project.id)}`, { method: "DELETE" });
  const body = await res.json();

  // HTTP contract unchanged.
  assert.equal(res.status, 400);
  assert.equal(body.error, "project_remove_blocked");

  // The veto is now auditable.
  const refusal = state.refusals.find((r) => r.subject?.id === project.id);
  assert.ok(refusal, "a refusal was recorded for the blocked removal");
  assert.equal(refusal.category, "state");
  assert.equal(refusal.code, "subject_not_actionable");
  assert.equal(refusal.subject.kind, "registration");
  assert.match(refusal.summary, /Project removal was blocked/);
  assert.equal(refusal.appealTo, "device_owner");

  // No event fired for it — the HTTP error already surfaced it.
  assert.equal(state.events.length, eventsBefore, "recording the refusal fires no new event");
});
