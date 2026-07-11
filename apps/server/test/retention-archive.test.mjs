import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createRetentionArchive } from "../src/services/retention-archive.mjs";
import { createApprovalGrantService } from "../src/services/approval-grants.mjs";

const now = () => "2026-07-11T12:00:00.000Z";

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
