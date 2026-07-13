/*
 * #832: a record id must be unique.
 *
 * It was not. A real store held 1577 invocations under 74 ids — `inv_demo_0001`
 * appeared 89 times. One of them, the oldest, was stuck `running`; `find` by id
 * returned a *different*, newer one (`cancelled`). So every read of that id said
 * cancelled while the scheduler's in-flight FILTER saw the other one still
 * running. Cancelling "it" updated the wrong record. The stuck one was a ghost:
 * unreachable by its own id, and (with #817) it wedged the device's dispatch for
 * three weeks without a single error, refusal, or event.
 *
 * The tests below pin the three places that now make that impossible: minting,
 * restoring, and resetting.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createPersistenceRuntime } from "../src/runtime/persistence.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import { createServerRuntimeServices } from "../src/runtime/service-composer.mjs";

const now = () => "2026-07-13T00:00:00.000Z";

// `nextId` lives on the http deps and `resetIdCounter` on the self-check deps;
// both close over the same counter, which is the point.
function services({ state, defaultProject }) {
  const built = createServerRuntimeServices({
    namespace: "test",
    protocolVersion: "0.0.0",
    state,
    defaultProject,
    defaultProjectPath: process.cwd(),
    persistenceEnabled: false,
    stateStorePath: "/tmp/unused.json",
    stateSchemaVersion: 1,
    dispatchLeaseMs: 30_000,
    now,
  });
  return {
    nextId: built.httpDependencies.nextId,
    resetIdCounter: built.selfCheckDependencies.resetIdCounter,
  };
}

function fresh() {
  const created = createServerState({ defaultProjectPath: process.cwd(), now });
  return { state: created.state, deps: services(created) };
}

// --- minting -----------------------------------------------------------------

test("nextId never reissues an id the state already holds", () => {
  const { state, deps } = fresh();
  // A record the counter knows nothing about — exactly what a restored snapshot,
  // or a counter reset, leaves behind.
  state.invocations.push({ id: "inv_demo_0001", status: "running" });
  state.invocations.push({ id: "inv_demo_0002", status: "running" });

  deps.resetIdCounter(); // the counter is now 1: it WOULD mint inv_demo_0001
  const minted = [deps.nextId("inv_demo"), deps.nextId("inv_demo")];

  assert.deepEqual(minted, ["inv_demo_0003", "inv_demo_0004"], "it skips the occupied ids");
  assert.equal(new Set(state.invocations.map((i) => i.id)).size, 2, "and never collides");
});

test("a wrong counter costs a GAP in the numbering, never a duplicate key", () => {
  const { state, deps } = fresh();
  state.invocations.push({ id: "inv_demo_0007", status: "succeeded" });
  deps.resetIdCounter();
  const ids = Array.from({ length: 8 }, () => deps.nextId("inv_demo"));
  assert.equal(ids.includes("inv_demo_0007"), false, "the occupied id is skipped");
  assert.equal(new Set(ids).size, ids.length, "and nothing repeats");
});

test("ids are namespaced by prefix — a taken invocation id does not block a project id", () => {
  const { state, deps } = fresh();
  state.invocations.push({ id: "inv_demo_0001" });
  deps.resetIdCounter();
  assert.equal(deps.nextId("prj"), "prj_0001", "a different prefix is a different id space");
});

test("a NEW collection is protected without anyone teaching a scan about it", () => {
  const { state, defaultProject } = createServerState({ defaultProjectPath: process.cwd(), now });
  // A collection that did not exist when the id logic was written.
  state.somethingNobodyHasWrittenYet = [{ id: "inv_demo_0001", status: "running" }];
  const deps = services({ state, defaultProject });
  deps.resetIdCounter();
  assert.notEqual(deps.nextId("inv_demo"), "inv_demo_0001", "the id is taken, wherever it lives");
});

// --- persistence -------------------------------------------------------------

function persistence(state, storePath, defaultProject) {
  return createPersistenceRuntime({
    state,
    enabled: true,
    stateStorePath: storePath,
    schemaVersion: 1,
    now,
    defaultProject,
    sameProjectPath: (a, b) => a === b,
  });
}

test("the id counter travels with the snapshot it minted ids for", () => {
  const dir = mkdtempSync(join(tmpdir(), "id-uniq-"));
  const storePath = join(dir, "state.json");

  const first = createServerState({ defaultProjectPath: process.cwd(), now });
  const firstDeps = services(first);
  for (let index = 0; index < 5; index += 1) first.state.invocations.unshift({ id: firstDeps.nextId("inv_demo") });
  persistence(first.state, storePath, first.defaultProject).savePersistentState();

  const snapshot = JSON.parse(readFileSync(storePath, "utf8"));
  assert.ok(Number.isFinite(snapshot.idCounter), "the counter is persisted, not re-derived by a regex scan");

  // A fresh process restores it and must not mint over the records it just read.
  const second = createServerState({ defaultProjectPath: process.cwd(), now });
  persistence(second.state, storePath, second.defaultProject).restorePersistentState();
  const secondDeps = services(second);
  const minted = secondDeps.nextId("inv_demo");
  assert.equal(
    second.state.invocations.some((invocation) => invocation.id === minted),
    false,
    "the id minted after a restart collides with nothing already in the store",
  );
});

test("a snapshot with duplicate ids is REPAIRED on restore, keeping the newest of each", () => {
  const dir = mkdtempSync(join(tmpdir(), "id-uniq-"));
  const storePath = join(dir, "state.json");
  const seed = createServerState({ defaultProjectPath: process.cwd(), now });

  // The exact corruption found in the real store: one id, several records,
  // newest first (records are unshifted).
  seed.state.invocations = [
    { id: "inv_demo_0001", status: "cancelled", createdAt: "2026-07-04T00:00:00.000Z" },
    { id: "inv_demo_0002", status: "succeeded", createdAt: "2026-07-01T00:00:00.000Z" },
    { id: "inv_demo_0001", status: "succeeded", createdAt: "2026-06-30T00:00:00.000Z" },
    { id: "inv_demo_0001", status: "running", createdAt: "2026-06-21T00:00:00.000Z" }, // the ghost
  ];
  persistence(seed.state, storePath, seed.defaultProject).savePersistentState();

  const restored = createServerState({ defaultProjectPath: process.cwd(), now });
  persistence(restored.state, storePath, restored.defaultProject).restorePersistentState();

  const ids = restored.state.invocations.map((invocation) => invocation.id);
  assert.equal(ids.length, new Set(ids).size, "no id survives twice");
  assert.equal(restored.state.invocations.length, 2);

  const kept = restored.state.invocations.find((invocation) => invocation.id === "inv_demo_0001");
  assert.equal(kept.status, "cancelled", "the NEWEST record under that id is the one that survives");

  // The failure this whole issue is about: reading by id and filtering must never
  // see different records.
  const byId = restored.state.invocations.find((invocation) => invocation.id === "inv_demo_0001");
  const inFlight = restored.state.invocations.filter((invocation) => invocation.status === "running");
  assert.equal(inFlight.length, 0, "the ghost is gone");
  assert.equal(byId.status, "cancelled", "and find() and filter() agree about what that id is");
});

test("the repair is not a silent one", () => {
  const dir = mkdtempSync(join(tmpdir(), "id-uniq-"));
  const storePath = join(dir, "state.json");
  const seed = createServerState({ defaultProjectPath: process.cwd(), now });
  seed.state.invocations = [{ id: "inv_demo_0001" }, { id: "inv_demo_0001" }];
  persistence(seed.state, storePath, seed.defaultProject).savePersistentState();

  const errors = [];
  const original = console.error;
  console.error = (message) => errors.push(String(message));
  try {
    const restored = createServerState({ defaultProjectPath: process.cwd(), now });
    persistence(restored.state, storePath, restored.defaultProject).restorePersistentState();
  } finally {
    console.error = original;
  }
  // Loading corruption quietly is what let this hide for three weeks.
  assert.ok(
    errors.some((message) => /duplicate-id/i.test(message) && /invocations/.test(message)),
    "a corrupt snapshot must say so, naming the collection and the count",
  );
});

/*
 * `devices` (the fleet) restores through its OWN path — a per-record merge with
 * the seeded defaults — so it does not pass through the array loop that repairs
 * every other collection. It is the newest collection in the state, which is
 * precisely the case #832 is about: a guard that only covers the arrays someone
 * remembered to route through it is not a guard.
 */
test("the device fleet is de-duplicated on restore like every other collection", () => {
  const dir = mkdtempSync(join(tmpdir(), "id-uniq-"));
  const storePath = join(dir, "state.json");
  const seed = createServerState({ defaultProjectPath: process.cwd(), now });

  const device = (id, name) => ({
    id,
    name,
    ownerUserId: "usr_local",
    status: "online",
    unlinkState: "linked",
    bridgeCredential: null,
    credentialRevokedAt: null,
  });
  // Two machines under one id — the newest first, as records are written.
  seed.state.devices = [device("dev_local_001", "current"), device("dev_local_001", "stale")];
  persistence(seed.state, storePath, seed.defaultProject).savePersistentState();

  const restored = createServerState({ defaultProjectPath: process.cwd(), now });
  persistence(restored.state, storePath, restored.defaultProject).restorePersistentState();

  const ids = restored.state.devices.map((item) => item.id);
  assert.equal(ids.length, new Set(ids).size, "a fleet cannot hold two machines under one id");
  assert.equal(
    restored.state.devices.find((item) => item.id === "dev_local_001").name,
    "current",
    "and the newest record under that id is the one that survives",
  );
});
