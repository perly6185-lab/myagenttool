import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createRetentionArchive } from "../src/services/retention-archive.mjs";
import { createApprovalGrantService } from "../src/services/approval-grants.mjs";

const now = () => "2026-07-11T12:00:00.000Z";

test("readArchive: recovers evicted rows most-recently-archived first, filters, bounds, tolerates a torn line", () => {
  const dir = mkdtempSync(join(tmpdir(), "retention-read-"));
  let clock = 0;
  const archive = createRetentionArchive({ stateStorePath: join(dir, "state.json"), now: () => `2026-07-12T00:00:0${clock}.000Z` });

  // No file yet → honest empty, not a throw.
  assert.deepEqual(archive.readArchive("recovery"), []);

  // Two eviction batches at distinct times. capWithArchive evicts list.slice(max)
  // (the oldest of a newest-first list): batch 1 evicts a1, batch 2 evicts b1.
  clock = 1;
  archive.capWithArchive([{ id: "a2", app: "x" }, { id: "a1", app: "y" }], 1, "recovery");
  clock = 2;
  archive.capWithArchive([{ id: "b2", app: "x" }, { id: "b1", app: "x" }], 1, "recovery");

  const all = archive.readArchive("recovery");
  assert.deepEqual(all.map((e) => e.row.id), ["b1", "a1"], "most-recently-archived first");
  assert.equal(all[0].archivedAt, "2026-07-12T00:00:02.000Z");

  // Filter by a row field (the endpoint scopes by applicationId this way).
  assert.deepEqual(archive.readArchive("recovery", { filter: (row) => row.app === "x" }).map((e) => e.row.id), ["b1"]);
  assert.equal(archive.readArchive("recovery", { limit: 1 }).length, 1);

  // A torn final line (crash mid-append) is skipped, not fatal.
  appendFileSync(join(archive.archiveDir, "recovery.jsonl"), '{"archivedAt":"2026-07-12T00:00:09.000Z","collection":"recovery","row":{"id":"tor');
  assert.deepEqual(archive.readArchive("recovery").map((e) => e.row.id), ["b1", "a1"], "torn line ignored");
  const diagnostic = archive.readArchiveWithMetadata("recovery");
  assert.equal(diagnostic.malformedLines, 1, "a caller can report that the recovered history is incomplete");
  assert.equal(diagnostic.readError, null);
});

test("capWithArchive keeps the cap and appends the overflow as JSONL, newest kept", () => {
  const dir = mkdtempSync(join(tmpdir(), "retention-"));
  const archive = createRetentionArchive({ stateStorePath: join(dir, "state.json"), now });
  const rows = Array.from({ length: 7 }, (_, i) => ({ id: `row_${i}` })); // newest first
  const capped = archive.capWithArchive(rows, 5, "demoCollection");
  assert.deepEqual(capped.map((r) => r.id), ["row_0", "row_1", "row_2", "row_3", "row_4"]);

  const lines = readFileSync(join(archive.archiveDir, "demoCollection.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.row.id), ["row_5", "row_6"], "the evicted oldest rows are archived");
  assert.equal(lines[0].collection, "demoCollection");
  assert.equal(lines[0].archivedAt, now());

  // Append-only: a second overflow adds lines, never truncates.
  archive.capWithArchive([{ id: "a" }, { id: "b" }], 1, "demoCollection");
  const after = readFileSync(join(archive.archiveDir, "demoCollection.jsonl"), "utf8").trim().split("\n");
  assert.equal(after.length, 3);
});

test("under the cap nothing is written; a disabled archive reports unavailable", () => {
  const dir = mkdtempSync(join(tmpdir(), "retention-"));
  const archive = createRetentionArchive({ stateStorePath: join(dir, "state.json"), now });
  const same = archive.capWithArchive([{ id: "x" }], 5, "quiet");
  assert.equal(same.length, 1);
  assert.equal(existsSync(join(archive.archiveDir, "quiet.jsonl")), false);

  const disabled = createRetentionArchive({ stateStorePath: join(dir, "state.json"), enabled: false, now });
  const disabledResult = disabled.archiveEvicted("disabled", [{ id: "2" }]);
  assert.equal(disabledResult.ok, false);
  assert.equal(disabledResult.error, "archive_disabled");
  disabled.capWithArchive([{ id: "1" }, { id: "2" }], 1, "disabled");
  assert.equal(existsSync(join(disabled.archiveDir, "disabled.jsonl")), false);
});

test("archiveEvicted reports an I/O failure instead of silently claiming durability", () => {
  const dir = mkdtempSync(join(tmpdir(), "retention-failure-"));
  const blocker = join(dir, "not-a-directory");
  writeFileSync(blocker, "file");
  const archive = createRetentionArchive({ stateStorePath: join(blocker, "state.json"), now });
  const result = archive.archiveEvicted("events", [{ id: "evt_1" }]);
  assert.equal(result.ok, false);
  assert.equal(result.archivedCount, 0);
  assert.ok(result.error);
});

test("invocation events use traversal-safe per-invocation shards with a restart id floor", () => {
  const dir = mkdtempSync(join(tmpdir(), "invocation-event-shards-"));
  const stateStorePath = join(dir, "state.json");
  const archive = createRetentionArchive({ stateStorePath, now });
  const suspiciousInvocationId = "../../inv_a";
  const result = archive.archiveInvocationEvents([
    { id: "evt_demo_101", invocationId: suspiciousInvocationId, type: "log", createdAt: now() },
    { id: "evt_demo_103", invocationId: suspiciousInvocationId, type: "log", createdAt: now() },
    { id: "evt_demo_102", invocationId: "inv_b", type: "log", createdAt: now() },
  ]);
  assert.equal(result.ok, true);
  assert.equal(existsSync(join(dir, "inv_a.jsonl")), false, "an invocation id never becomes a path");
  assert.equal(existsSync(join(archive.archiveDir, "events.jsonl")), false, "production event reads are not global");
  assert.deepEqual(
    readdirSync(archive.invocationEventArchiveDir).sort().map((name) => /^[a-f0-9]{64}\.jsonl$/.test(name)),
    [true, true],
  );
  assert.deepEqual(
    archive.readInvocationEventArchive(suspiciousInvocationId).entries.map((entry) => entry.row.id),
    ["evt_demo_101", "evt_demo_103"],
  );
  assert.deepEqual(
    archive.readInvocationEventArchive("inv_b").entries.map((entry) => entry.row.id),
    ["evt_demo_102"],
  );

  // A power loss can leave the JSON row complete but omit only its trailing
  // newline. The row is readable and therefore its id must still raise the
  // allocator floor after restart.
  for (const name of readdirSync(archive.invocationEventArchiveDir)) {
    const path = join(archive.invocationEventArchiveDir, name);
    writeFileSync(path, readFileSync(path, "utf8").trimEnd());
  }
  const restarted = createRetentionArchive({ stateStorePath, now });
  assert.deepEqual(restarted.prepareInvocationEventArchive(), { maxOrdinal: 103, readError: null });

  const suspiciousShard = readdirSync(archive.invocationEventArchiveDir)
    .map((name) => join(archive.invocationEventArchiveDir, name))
    .find((path) => readFileSync(path, "utf8").includes(suspiciousInvocationId));
  assert.ok(suspiciousShard);
  appendFileSync(
    suspiciousShard,
    '\n{"archivedAt":"2026-07-11T12:00:00.000Z","collection":"events","row":{"id":"evt_demo_104"',
  );
  const afterTornRow = createRetentionArchive({ stateStorePath, now });
  assert.deepEqual(afterTornRow.prepareInvocationEventArchive(), { maxOrdinal: 104, readError: null });
  assert.equal(afterTornRow.archiveInvocationEvents([
    { id: "evt_demo_105", invocationId: suspiciousInvocationId, type: "log", createdAt: now() },
  ]).ok, true);
  const recovered = afterTornRow.readInvocationEventArchive(suspiciousInvocationId);
  assert.deepEqual(recovered.entries.map((entry) => entry.row.id), ["evt_demo_101", "evt_demo_103", "evt_demo_105"]);
  assert.equal(recovered.malformedLines, 1, "the torn row remains an honest truncation signal");
  assert.deepEqual(
    createRetentionArchive({ stateStorePath, now }).prepareInvocationEventArchive(),
    { maxOrdinal: 105, readError: null },
    "a later valid append remains restart-readable after a torn row",
  );
});

test("grant pruning archives what it drops — expired-unconsumed and over-cap consumed alike", () => {
  const dir = mkdtempSync(join(tmpdir(), "retention-"));
  const archive = createRetentionArchive({ stateStorePath: join(dir, "state.json"), now });
  const state = { approvalGrants: [], events: [], approvalTokenLegacyUses: { count: 0, lastAt: null } };
  let idCounter = 0;
  const { issueApprovalGrant } = createApprovalGrantService({
    state,
    now: () => new Date().toISOString(),
    nextId: (p) => `${p}_${(idCounter += 1)}`,
    appendEvent: (e) => state.events.push(e),
    persistStateSoon: () => {},
    archiveEvicted: archive.archiveEvicted,
  });
  issueApprovalGrant({ action: "online", targetId: "app_1" }, null);
  // Make it expired-unconsumed, then trigger pruning via a fresh issuance.
  state.approvalGrants[0].expiresAt = new Date(Date.now() - 1000).toISOString();
  const expiredId = state.approvalGrants[0].id;
  issueApprovalGrant({ action: "online", targetId: "app_1" }, null);

  assert.ok(!state.approvalGrants.some((g) => g.id === expiredId), "expired grant left memory");
  const lines = readFileSync(join(archive.archiveDir, "approvalGrants.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(lines.some((l) => l.row.id === expiredId), "…but landed in the archive");
});
