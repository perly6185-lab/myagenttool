import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createEventLogRuntime, EVENT_HOT_LIMIT } from "../src/runtime/event-log.mjs";
import { createHttpServer } from "../src/runtime/http-server.mjs";
import { createServerRuntimeServices } from "../src/runtime/service-composer.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import { createInvocationEventService } from "../src/services/invocation-events.mjs";
import { createRetentionArchive } from "../src/services/retention-archive.mjs";

test("invocation event pages walk newest to oldest without duplicate or missing rows", () => {
  const invocation = invocationFixture("inv_page");
  const all = Array.from({ length: 250 }, (_, index) => eventFixture(invocation.id, index + 1));
  all[0].type = "invocation_created";
  const archived = all.slice(0, 151).map((row) => ({ archivedAt: row.createdAt, row }));
  const hot = all.slice(149).reverse(); // ids 150/151 intentionally overlap the archive
  const service = createInvocationEventService({
    state: { events: hot, eventHistoryRetention: retentionFixture() },
    readArchiveWithMetadata: (_collection, { filter }) => ({
      entries: archived.filter((entry) => filter(entry.row)).reverse(),
      malformedLines: 0,
      readError: null,
    }),
  });

  const pages = [];
  let before = null;
  do {
    const page = service.listInvocationEvents(invocation, { limit: 100, before });
    pages.push(page);
    assert.deepEqual(page.events, [...page.events].sort(compareEvents), "every page is oldest-to-newest");
    assert.equal(page.retentionTruncated, false);
    before = page.nextCursor;
  } while (pages.at(-1).hasMore);

  assert.deepEqual(pages.map((page) => page.events.length), [100, 100, 50]);
  assert.equal(pages.at(-1).nextCursor, null);
  const recovered = pages.flatMap((page) => page.events).map((event) => event.id);
  assert.equal(new Set(recovered).size, 250, "archive/hot overlap is de-duplicated before paging");
  assert.deepEqual(new Set(recovered), new Set(all.map((event) => event.id)), "no event is skipped across cursors");
});

test("invocation event cursor is opaque, invocation-bound, and invalid cursors are rejected", () => {
  const invocation = invocationFixture("inv_cursor");
  const rows = [eventFixture(invocation.id, 1), eventFixture(invocation.id, 2)];
  rows[0].type = "invocation_created";
  const service = createInvocationEventService({
    state: { events: rows, eventHistoryRetention: retentionFixture() },
    readArchiveWithMetadata: () => ({ entries: [], malformedLines: 0, readError: null }),
  });
  const page = service.listInvocationEvents(invocation, { limit: 1 });
  assert.equal(page.hasMore, true);
  assert.ok(page.nextCursor && !page.nextCursor.includes(invocation.id));
  assert.equal(service.listInvocationEvents(invocation, { limit: null }).events.length, 2, "a missing route limit uses the 100-row default");

  assert.throws(
    () => service.listInvocationEvents(invocation, { before: "not+base64" }),
    (error) => error?.code === "invalid_cursor",
  );
  assert.throws(
    () => service.listInvocationEvents(invocation, { before: "" }),
    (error) => error?.code === "invalid_cursor",
  );
  assert.throws(
    () => service.listInvocationEvents(invocation, { before: "a".repeat(2_049) }),
    (error) => error?.code === "invalid_cursor",
  );
  const otherInvocation = invocationFixture("inv_other");
  assert.throws(
    () => service.listInvocationEvents(otherInvocation, { before: page.nextCursor }),
    (error) => error?.code === "invalid_cursor",
  );
});

test("same-timestamp pagination orders trailing numeric ids across 9999 and 10000", () => {
  const invocation = invocationFixture("inv_bigint_cursor");
  const createdAt = "2026-07-14T00:00:00.000Z";
  const rows = [9_998, 9_999, 10_000, 10_001].map((ordinal, index) => ({
    ...eventFixture(invocation.id, index + 1),
    id: `evt_demo_${ordinal}`,
    type: index === 0 ? "invocation_created" : "log",
    createdAt,
  }));
  const service = createInvocationEventService({
    state: { events: [...rows].reverse(), eventHistoryRetention: retentionFixture() },
    readArchiveWithMetadata: () => ({ entries: [], malformedLines: 0, readError: null }),
  });

  const newest = service.listInvocationEvents(invocation, { limit: 2 });
  assert.deepEqual(newest.events.map((event) => event.id), ["evt_demo_10000", "evt_demo_10001"]);
  assert.equal(newest.hasMore, true);
  const older = service.listInvocationEvents(invocation, { limit: 2, before: newest.nextCursor });
  assert.deepEqual(older.events.map((event) => event.id), ["evt_demo_9998", "evt_demo_9999"]);
  assert.equal(older.hasMore, false);
});

test("event ordering remains append-stable when the system clock moves backward", () => {
  const invocation = invocationFixture("inv_clock_rollback");
  const rows = [
    { ...eventFixture(invocation.id, 42), id: "evt_demo_42", createdAt: "2026-07-14T09:02:00.000Z" },
    { ...eventFixture(invocation.id, 43), id: "evt_demo_43", createdAt: "2026-07-14T08:59:00.000Z" },
  ];
  rows[0].type = "invocation_created";
  const service = createInvocationEventService({
    state: { events: [...rows].reverse(), eventHistoryRetention: retentionFixture() },
    readArchiveWithMetadata: () => ({ entries: [], malformedLines: 0, readError: null }),
  });

  assert.deepEqual(
    service.listInvocationEvents(invocation).events.map((event) => event.id),
    ["evt_demo_42", "evt_demo_43"],
  );
});

test("retentionTruncated reports known write failures, damaged archives, and a missing lifecycle start", () => {
  const invocation = invocationFixture("inv_truncated");
  const completed = eventFixture(invocation.id, 2);
  completed.type = "invocation_succeeded";

  const knownFailure = createInvocationEventService({
    state: {
      events: [eventFixture(invocation.id, 1), completed],
      eventHistoryRetention: { ...retentionFixture(), truncatedInvocationIds: [invocation.id] },
    },
    readArchiveWithMetadata: () => ({ entries: [], malformedLines: 0, readError: null }),
  }).listInvocationEvents(invocation);
  assert.equal(knownFailure.retentionTruncated, true);

  const missingStart = createInvocationEventService({
    state: { events: [completed], eventHistoryRetention: retentionFixture() },
    readArchiveWithMetadata: () => ({ entries: [], malformedLines: 0, readError: null }),
  }).listInvocationEvents(invocation);
  assert.equal(missingStart.retentionTruncated, true);

  const damagedArchive = createInvocationEventService({
    state: { events: [eventFixture(invocation.id, 1)], eventHistoryRetention: retentionFixture() },
    readArchiveWithMetadata: () => ({ entries: [], malformedLines: 1, readError: null }),
  }).listInvocationEvents(invocation);
  assert.equal(damagedArchive.retentionTruncated, true);
});

test("event writer archives overflow before trimming and marks an archive failure", () => {
  const state = { events: [], eventHistoryRetention: retentionFixture() };
  const archived = [];
  let next = 0;
  const runtime = createEventLogRuntime({
    state,
    now: () => "2026-07-14T00:00:00.000Z",
    nextId: () => `evt_${String(++next).padStart(4, "0")}`,
    persistStateSoon: () => {},
    getCodexEventHandlers: () => ({
      updateCodexSessionFromEvent: () => {},
      createCodexEvidenceRecord: () => {},
    }),
    archiveEvicted: (collection, rows) => {
      assert.equal(collection, "events");
      assert.equal(state.events.length, EVENT_HOT_LIMIT + 1, "overflow still exists when archival starts");
      archived.push(...rows);
      return { ok: true, archivedCount: rows.length, error: null };
    },
  });
  for (let index = 0; index <= EVENT_HOT_LIMIT; index += 1) {
    runtime.appendEvent({ invocationId: "inv_archive", type: "log", level: "info", message: String(index) });
  }
  assert.equal(state.events.length, EVENT_HOT_LIMIT);
  assert.equal(archived.length, 1);
  assert.equal(archived[0].message, "0");
  assert.deepEqual(state.eventHistoryRetention.truncatedInvocationIds, []);

  const failedState = {
    events: Array.from({ length: EVENT_HOT_LIMIT }, (_, index) => eventFixture("inv_failed_archive", index + 1)).reverse(),
    eventHistoryRetention: retentionFixture(),
  };
  createEventLogRuntime({
    state: failedState,
    now: () => "2026-07-14T00:00:01.000Z",
    nextId: () => "evt_failed_new",
    persistStateSoon: () => {},
    getCodexEventHandlers: () => ({
      updateCodexSessionFromEvent: () => {},
      createCodexEvidenceRecord: () => {},
    }),
    archiveEvicted: () => ({ ok: false, archivedCount: 0, error: "disk full" }),
  }).appendEvent({ invocationId: "inv_failed_archive", type: "log", level: "warn", message: "new" });
  assert.equal(failedState.events.length, EVENT_HOT_LIMIT);
  assert.deepEqual(failedState.eventHistoryRetention.truncatedInvocationIds, ["inv_failed_archive"]);
  assert.equal(failedState.eventHistoryRetention.lastArchiveError, "disk full");
});

test("invocation history survives global eviction and a server restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "invocation-history-restart-"));
  const stateStorePath = join(root, "state", "snapshot.json");
  const clock = monotonicClock();
  let server = null;
  try {
    // Persistence deliberately rejects projects whose checkout path no longer
    // exists, so use the already-created temp root as this test's project.
    const firstCreated = createServerState({ defaultProjectPath: root, now: clock });
    const first = createServerRuntimeServices({
      namespace: "test",
      protocolVersion: "0.0.0",
      state: firstCreated.state,
      defaultProject: firstCreated.defaultProject,
      defaultProjectPath: root,
      persistenceEnabled: true,
      stateStorePath,
      stateSchemaVersion: 1,
      dispatchLeaseMs: 30_000,
      now: clock,
    });
    const invocation = first.httpDependencies.createInvocation(
      "Trace a long lifecycle.",
      first.httpDependencies.defaultAgent(),
      {},
    );
    for (let index = 0; index < 120; index += 1) {
      first.httpDependencies.appendEvent({
        invocationId: invocation.id,
        type: "log",
        level: "info",
        message: `lifecycle output ${index}`,
      });
    }
    first.httpDependencies.completeInvocation(invocation, {
      status: "succeeded",
      summary: "Long lifecycle completed.",
      result: { summary: "done" },
    });
    const expected = firstCreated.state.events
      .filter((event) => event.invocationId === invocation.id)
      .map((event) => event.id);
    assert.ok(expected.length > 40);

    for (let index = 0; index < EVENT_HOT_LIMIT + 20; index += 1) {
      first.httpDependencies.appendEvent({
        invocationId: null,
        type: "global_noise",
        level: "info",
        message: `global noise ${index}`,
      });
    }
    assert.equal(firstCreated.state.events.length, EVENT_HOT_LIMIT);
    assert.equal(firstCreated.state.events.some((event) => event.invocationId === invocation.id), false);
    firstCreated.state.eventHistoryRetention.truncatedInvocationIds.push("inv_known_archive_gap");
    await new Promise((resolve) => setTimeout(resolve, 40));
    first.savePersistentState();

    const secondCreated = createServerState({ defaultProjectPath: root, now: clock });
    const second = createServerRuntimeServices({
      namespace: "test",
      protocolVersion: "0.0.0",
      state: secondCreated.state,
      defaultProject: secondCreated.defaultProject,
      defaultProjectPath: root,
      persistenceEnabled: true,
      stateStorePath,
      stateSchemaVersion: 1,
      dispatchLeaseMs: 30_000,
      now: clock,
    });
    assert.deepEqual(secondCreated.state.eventHistoryRetention.truncatedInvocationIds, ["inv_known_archive_gap"]);
    server = createHttpServer({
      host: "127.0.0.1",
      port: 0,
      namespace: "test",
      protocolVersion: "0.0.0",
      ...second.httpDependencies,
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    const pages = [];
    let before = null;
    do {
      const query = new URLSearchParams({ limit: "40" });
      if (before) query.set("before", before);
      const response = await fetch(`${base}/api/invocations/${encodeURIComponent(invocation.id)}/events?${query}`);
      assert.equal(response.status, 200);
      const page = await response.json();
      pages.push(page);
      assert.equal(page.retentionTruncated, false);
      assert.deepEqual(page.events, [...page.events].sort(compareEvents));
      before = page.nextCursor;
    } while (pages.at(-1).hasMore);

    const actual = pages.flatMap((page) => page.events).map((event) => event.id);
    assert.equal(new Set(actual).size, expected.length);
    assert.deepEqual(new Set(actual), new Set(expected));
    assert.ok(pages.flatMap((page) => page.events).some((event) => event.type === "invocation_created"));
    assert.ok(pages.flatMap((page) => page.events).some((event) => event.type === "invocation_succeeded"));

    const stateResponse = await fetch(`${base}/api/state`);
    assert.equal(stateResponse.status, 200);
    assert.equal((await stateResponse.json()).events.length, EVENT_HOT_LIMIT, "/api/state remains only the bounded hot tail");
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
});

test("restart never reissues an event id already durable in a shard when the state snapshot lags", async () => {
  const root = mkdtempSync(join(tmpdir(), "invocation-history-id-floor-"));
  const stateStorePath = join(root, "state", "snapshot.json");
  const clock = monotonicClock();
  try {
    const firstCreated = createServerState({ defaultProjectPath: root, now: clock });
    const first = createServerRuntimeServices({
      namespace: "test",
      protocolVersion: "0.0.0",
      state: firstCreated.state,
      defaultProject: firstCreated.defaultProject,
      defaultProjectPath: root,
      persistenceEnabled: true,
      stateStorePath,
      stateSchemaVersion: 1,
      dispatchLeaseMs: 30_000,
      now: clock,
    });
    const invocation = first.httpDependencies.createInvocation(
      "Exercise an event archive crash window.",
      first.httpDependencies.defaultAgent(),
      {},
    );
    first.savePersistentState();
    const snapshotCounter = firstCreated.state.idCounter;

    // Do not yield: the debounced snapshot cannot catch up before the simulated
    // restart, while shard fsyncs still make each evicted event durable.
    for (let index = 0; index < EVENT_HOT_LIMIT + 30; index += 1) {
      first.httpDependencies.appendEvent({
        invocationId: invocation.id,
        type: "log",
        level: "info",
        message: `burst ${index}`,
      });
    }
    const archivedFloor = createRetentionArchive({ stateStorePath, now: clock })
      .prepareInvocationEventArchive().maxOrdinal;
    assert.ok(archivedFloor >= snapshotCounter, "the archive advanced beyond the deliberately stale snapshot");

    const secondCreated = createServerState({ defaultProjectPath: root, now: clock });
    const second = createServerRuntimeServices({
      namespace: "test",
      protocolVersion: "0.0.0",
      state: secondCreated.state,
      defaultProject: secondCreated.defaultProject,
      defaultProjectPath: root,
      persistenceEnabled: true,
      stateStorePath,
      stateSchemaVersion: 1,
      dispatchLeaseMs: 30_000,
      now: clock,
    });
    // The simulated restart has already restored from the stale snapshot. Let
    // the first runtime's queued timer drain before the second schedules one,
    // avoiding two test-only writers racing on the same atomic temp file.
    await new Promise((resolve) => setTimeout(resolve, 40));
    const afterRestart = second.httpDependencies.appendEvent({
      invocationId: invocation.id,
      type: "log",
      level: "info",
      message: "after restart",
    });
    assert.ok(numericSuffix(afterRestart.id) > archivedFloor);

    // Let the restarted runtime drain its debounce timer before cleanup.
    await new Promise((resolve) => setTimeout(resolve, 40));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("startup refuses to allocate ids when the invocation-event archive high-water is unreadable", () => {
  const root = mkdtempSync(join(tmpdir(), "invocation-history-unreadable-floor-"));
  const stateStorePath = join(root, "state", "snapshot.json");
  const archiveDir = join(root, "state", "archive");
  mkdirSync(archiveDir, { recursive: true });
  writeFileSync(join(archiveDir, "events-by-invocation"), "not a directory\n");
  try {
    const created = createServerState({ defaultProjectPath: root, now: monotonicClock() });
    assert.throws(
      () => createServerRuntimeServices({
        namespace: "test",
        protocolVersion: "0.0.0",
        state: created.state,
        defaultProject: created.defaultProject,
        defaultProjectPath: root,
        persistenceEnabled: true,
        stateStorePath,
        stateSchemaVersion: 1,
        dispatchLeaseMs: 30_000,
        now: monotonicClock(),
      }),
      /Cannot establish invocation event id high-water/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function invocationFixture(id) {
  return {
    id,
    projectId: "prj_test",
    requestedBy: "usr_local",
    options: { metadata: {} },
  };
}

function eventFixture(invocationId, ordinal) {
  return {
    id: `evt_${String(ordinal).padStart(4, "0")}`,
    invocationId,
    type: ordinal === 1 ? "invocation_created" : "log",
    level: "info",
    message: `event ${ordinal}`,
    data: null,
    createdAt: `2026-07-14T00:${String(Math.floor(ordinal / 60)).padStart(2, "0")}:${String(ordinal % 60).padStart(2, "0")}.000Z`,
  };
}

function retentionFixture() {
  return {
    truncatedInvocationIds: [],
    globalTruncated: false,
    lastArchiveErrorAt: null,
    lastArchiveError: null,
  };
}

function compareEvents(left, right) {
  const byTime = left.createdAt.localeCompare(right.createdAt);
  return byTime || left.id.localeCompare(right.id);
}

function monotonicClock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 6, 14, 0, 0, 0, tick++)).toISOString();
}

function numericSuffix(id) {
  return Number(/([0-9]+)$/.exec(id)?.[1] ?? -1);
}
