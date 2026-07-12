import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
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

test("under the cap nothing is written; disabled archive drops silently (old behavior)", () => {
  const dir = mkdtempSync(join(tmpdir(), "retention-"));
  const archive = createRetentionArchive({ stateStorePath: join(dir, "state.json"), now });
  const same = archive.capWithArchive([{ id: "x" }], 5, "quiet");
  assert.equal(same.length, 1);
  assert.equal(existsSync(join(archive.archiveDir, "quiet.jsonl")), false);

  const disabled = createRetentionArchive({ stateStorePath: join(dir, "state.json"), enabled: false, now });
  disabled.capWithArchive([{ id: "1" }, { id: "2" }], 1, "disabled");
  assert.equal(existsSync(join(disabled.archiveDir, "disabled.jsonl")), false);
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
