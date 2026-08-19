import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  createMailQueryIndex,
  openMailQueryIndexDatabase,
} from "../src/services/mail-query-index.mjs";

function row(id, { folderId = "inbox", smartView = "other", searchText = "", sortAt = 0, unread = false, classified = false } = {}) {
  return {
    messageKey: `key-${id}`,
    messageId: id,
    accountId: "mail",
    folderId,
    sortAt,
    ordinal: 0,
    unread,
    smartView,
    classified,
    searchText,
    payload: { id, messageId: id, subject: `Subject ${id}` },
  };
}

test("mail query index rebuilds once and reuses a matching durable fingerprint", async () => {
  const database = await openMailQueryIndexDatabase({ path: ":memory:" });
  const index = createMailQueryIndex({ database, now: () => "2026-08-17T00:00:00.000Z" });
  let builds = 0;
  const buildRows = () => {
    builds += 1;
    return [
      row("older", { searchText: "alpha needle", sortAt: 10, smartView: "other" }),
      row("newer", { searchText: "beta needle", sortAt: 20, smartView: "important", unread: true, classified: true }),
      row("archive", { folderId: "archive", searchText: "needle", sortAt: 30 }),
    ];
  };

  const first = index.query({
    teamId: "team_a", fingerprint: "fingerprint-1", buildRows,
    folderId: "inbox", searchQuery: "needle", view: "all", page: 1, pageSize: 1, classifierVersion: 7,
  });
  assert.equal(builds, 1);
  assert.equal(first.rebuilt, true);
  assert.deepEqual(first.messages.map((message) => message.id), ["newer"]);
  assert.deepEqual(first.pagination, { page: 1, pageSize: 1, total: 2, totalPages: 2, offset: 0 });
  assert.deepEqual(first.folderCounts.get("inbox"), { count: 2, unread: 1 });
  assert.deepEqual(first.classificationSummary, {
    counts: { all: 2, needs_attention: 0, important: 1, notifications: 0, subscriptions: 0, other: 1 },
    classified: 1,
    pending: 1,
    classifierVersion: 7,
  });

  const second = index.query({
    teamId: "team_a", fingerprint: "fingerprint-1",
    buildRows: () => { throw new Error("fresh indexes must not rebuild"); },
    folderId: "inbox", searchQuery: "needle", view: "important", page: 1, pageSize: 25,
  });
  assert.equal(second.rebuilt, false);
  assert.deepEqual(second.messages.map((message) => message.id), ["newer"]);
  assert.equal(builds, 1);
  index.close();
});

test("mail query index isolates tenants and atomically replaces stale rows", async () => {
  const database = await openMailQueryIndexDatabase({ path: ":memory:" });
  const index = createMailQueryIndex({ database });
  const query = (teamId, fingerprint, rows) => index.query({
    teamId, fingerprint, buildRows: () => rows,
    folderId: "inbox", searchQuery: "", view: "all", page: 1, pageSize: 25,
  });

  query("team_a", "a1", [row("a-old")]);
  query("team_b", "b1", [row("b-only")]);
  const replaced = query("team_a", "a2", [row("a-new")]);
  const tenantB = query("team_b", "b1", []);

  assert.deepEqual(replaced.messages.map((message) => message.id), ["a-new"]);
  assert.deepEqual(tenantB.messages.map((message) => message.id), ["b-only"]);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM mail_query_messages WHERE owner_team_id = 'team_a'").get().count, 1);
  index.close();
});

test("mail query index incrementally inserts, updates, and deletes only changed message keys", async () => {
  const database = await openMailQueryIndexDatabase({ path: ":memory:" });
  const index = createMailQueryIndex({ database });
  const query = (fingerprint, rows) => index.query({
    teamId: "team_a", fingerprint, buildRows: () => rows,
    folderId: "inbox", searchQuery: "", view: "all", page: 1, pageSize: 25,
  });

  query("delta-1", [
    row("keep", { sortAt: 30 }),
    row("change", { sortAt: 20 }),
    row("delete", { sortAt: 10 }),
  ]);
  const changed = query("delta-2", [
    row("new", { sortAt: 40 }),
    row("keep", { sortAt: 30 }),
    row("change", { sortAt: 20, unread: true, smartView: "important", classified: true }),
  ]);

  assert.deepEqual(changed.maintenance, {
    mode: "incremental", inserted: 1, updated: 1, deleted: 1, unchanged: 1, total: 3,
  });
  assert.deepEqual(changed.messages.map((message) => message.id), ["new", "keep", "change"]);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM mail_query_messages WHERE owner_team_id = 'team_a'").get().count, 3);
  index.close();
});

test("mail query index preserves the previous snapshot when incremental maintenance cannot commit", async () => {
  const database = await openMailQueryIndexDatabase({ path: ":memory:" });
  const index = createMailQueryIndex({ database });
  const input = (fingerprint, rows) => ({
    teamId: "team_a", fingerprint, buildRows: () => rows,
    folderId: "inbox", searchQuery: "", view: "all", page: 1, pageSize: 25,
  });
  index.query(input("atomic-1", [row("original")]));
  database.exec(`
    CREATE TRIGGER reject_mail_query_writes
    BEFORE INSERT ON mail_query_messages
    BEGIN SELECT RAISE(ABORT, 'injected write failure'); END;
  `);
  assert.throws(() => index.query(input("atomic-2", [row("replacement")])));
  database.exec("DROP TRIGGER reject_mail_query_writes");

  const preserved = index.query(input("atomic-1", [row("original")]));
  assert.equal(preserved.maintenance.mode, "reused");
  assert.deepEqual(preserved.messages.map((message) => message.id), ["original"]);
  index.close();
});

test("mail query index detects valid-but-corrupt payloads and can rebuild from facts", async () => {
  const database = await openMailQueryIndexDatabase({ path: ":memory:" });
  const index = createMailQueryIndex({ database, auditIntervalMs: 0 });
  const rows = [row("safe", { unread: true, smartView: "important", classified: true })];
  const input = {
    teamId: "team_a", fingerprint: "audit-1", buildRows: () => rows,
    folderId: "inbox", searchQuery: "", view: "all", page: 1, pageSize: 25,
  };
  index.query(input);
  database.prepare("UPDATE mail_query_messages SET payload_json = ? WHERE owner_team_id = ?").run('{"id":"tampered"}', "team_a");

  const audit = index.audit("team_a");
  assert.deepEqual(audit, { healthy: false, reason: "content_digest" });
  const repaired = index.audit("team_a", { repair: true, fingerprint: "audit-1", buildRows: () => rows });
  assert.equal(repaired.healthy, true);
  assert.equal(repaired.repaired, true);
  assert.deepEqual(index.query(input).messages.map((message) => message.id), ["safe"]);
  index.close();
});

test("incremental writes do not postpone the periodic full-content audit", async () => {
  const database = await openMailQueryIndexDatabase({ path: ":memory:" });
  let currentTime = "2026-08-17T00:00:00.000Z";
  const index = createMailQueryIndex({ database, now: () => currentTime, auditIntervalMs: 5 * 60 * 1_000 });
  const rows = [row("safe")];
  const input = (fingerprint) => ({
    teamId: "team_a", fingerprint, buildRows: () => rows,
    folderId: "inbox", searchQuery: "", view: "all", page: 1, pageSize: 25,
  });
  index.query(input("periodic-1"));
  database.prepare("UPDATE mail_query_messages SET payload_json = ? WHERE owner_team_id = ?").run('{"id":"tampered"}', "team_a");

  currentTime = "2026-08-17T00:03:00.000Z";
  assert.equal(index.query(input("periodic-2")).maintenance.mode, "incremental");
  currentTime = "2026-08-17T00:06:00.000Z";
  const repaired = index.query(input("periodic-2"));
  assert.equal(repaired.maintenance.repaired, true);
  assert.equal(repaired.maintenance.repairReason, "content_digest");
  assert.deepEqual(repaired.messages.map((message) => message.id), ["safe"]);
  index.close();
});

test("mail query index keeps substring search semantics before smart-view pagination", async () => {
  const database = await openMailQueryIndexDatabase({ path: ":memory:" });
  const index = createMailQueryIndex({ database });
  const result = index.query({
    teamId: "team_a", fingerprint: "search-1",
    buildRows: () => [
      row("match", { searchText: "项目abc交付", smartView: "needs_attention", sortAt: 2 }),
      row("wrong-view", { searchText: "项目abc交付", smartView: "subscriptions", sortAt: 3 }),
      row("wrong-search", { searchText: "项目xyz交付", smartView: "needs_attention", sortAt: 4 }),
    ],
    folderId: "inbox", searchQuery: "abc交", view: "needs_attention", page: 99, pageSize: 1,
  });
  assert.deepEqual(result.messages.map((message) => message.id), ["match"]);
  assert.equal(result.pagination.page, 1);
  assert.equal(result.pagination.total, 1);
  assert.equal(result.classificationSummary.counts.all, 2, "summary is scoped by folder/search but not the selected smart view");
  index.close();
});

test("mail query index upgrades a schema-v1 database through a safe derived rebuild", async () => {
  const directory = mkdtempSync(join(tmpdir(), "myagenttool-mail-query-v1-"));
  const path = join(directory, "mail-query.sqlite");
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE mail_query_meta(
        owner_team_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL,
        row_count INTEGER NOT NULL, built_at TEXT NOT NULL, schema_version INTEGER NOT NULL
      );
      CREATE TABLE mail_query_messages(
        owner_team_id TEXT NOT NULL, message_key TEXT NOT NULL, message_id TEXT NOT NULL,
        account_id TEXT NOT NULL, folder_id TEXT NOT NULL, sort_at INTEGER NOT NULL,
        ordinal INTEGER NOT NULL, unread INTEGER NOT NULL, smart_view TEXT NOT NULL,
        classified INTEGER NOT NULL, search_text TEXT NOT NULL, payload_json TEXT NOT NULL,
        PRIMARY KEY(owner_team_id, message_key)
      );
      INSERT INTO mail_query_meta VALUES('team_a', 'legacy', 1, '2026-08-16T00:00:00.000Z', 1);
      INSERT INTO mail_query_messages VALUES(
        'team_a', 'legacy-key', 'legacy', 'mail', 'inbox', 1, 0, 0, 'other', 0, '', '{"id":"legacy"}'
      );
    `);
    legacy.close();

    const database = await openMailQueryIndexDatabase({ path });
    const index = createMailQueryIndex({ database });
    const result = index.query({
      teamId: "team_a", fingerprint: "current", buildRows: () => [row("current")],
      folderId: "inbox", searchQuery: "", view: "all", page: 1, pageSize: 25,
    });
    assert.equal(result.maintenance.mode, "rebuilt");
    assert.deepEqual(result.messages.map((message) => message.id), ["current"]);
    const meta = database.prepare("SELECT schema_version, content_digest, aggregate_digest FROM mail_query_meta WHERE owner_team_id = 'team_a'").get();
    assert.equal(meta.schema_version, 2);
    assert.match(meta.content_digest, /^[a-f0-9]{64}$/);
    assert.match(meta.aggregate_digest, /^[a-f0-9]{64}$/);
    index.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("mail query index handles 10,000 rows and reuses them after reopening", async () => {
  const directory = mkdtempSync(join(tmpdir(), "myagenttool-mail-query-"));
  const path = join(directory, "mail-query.sqlite");
  let index = null;
  try {
    let database = await openMailQueryIndexDatabase({ path });
    index = createMailQueryIndex({ database });
    const rows = Array.from({ length: 10_000 }, (_, position) => row(`message-${position}`, {
      searchText: position === 9_999 ? "unique large mailbox needle" : `routine message ${position}`,
      sortAt: position,
      smartView: position % 5 === 0 ? "notifications" : "other",
      unread: position % 2 === 0,
    }));
    const startedAt = performance.now();
    const built = index.query({
      teamId: "team_large", fingerprint: "large-1", buildRows: () => rows,
      folderId: "inbox", searchQuery: "unique large mailbox needle", view: "all", page: 1, pageSize: 25,
    });
    assert.deepEqual(built.messages.map((message) => message.id), ["message-9999"]);
    assert.ok(performance.now() - startedAt < 10_000, "10,000-row development safety bound should remain practical");

    const changedRows = rows.map((item, position) => position < 50 ? row(`message-${position}`, {
      searchText: `routine message ${position}`,
      sortAt: position,
      smartView: position % 5 === 0 ? "notifications" : "other",
      unread: position % 2 !== 0,
    }) : item);
    const incrementalStartedAt = performance.now();
    const incrementalCpuStartedAt = process.cpuUsage();
    const incremented = index.query({
      teamId: "team_large", fingerprint: "large-2", buildRows: () => changedRows,
      folderId: "inbox", searchQuery: "unique large mailbox needle", view: "all", page: 1, pageSize: 25,
    });
    const incrementalElapsed = performance.now() - incrementalStartedAt;
    const incrementalCpu = process.cpuUsage(incrementalCpuStartedAt);
    const incrementalCpuMs = (incrementalCpu.user + incrementalCpu.system) / 1_000;
    assert.equal(incremented.maintenance.mode, "incremental");
    assert.equal(incremented.maintenance.updated, 50);
    assert.equal(incremented.maintenance.unchanged, 9_950);
    assert.ok(incrementalCpuMs < 300, `50-row delta should stay under 300ms CPU, received ${incrementalCpuMs.toFixed(1)}ms CPU / ${incrementalElapsed.toFixed(1)}ms wall`);

    const addedRows = [
      ...changedRows,
      ...Array.from({ length: 50 }, (_, position) => row(`new-message-${position}`, {
        searchText: `new routine message ${position}`,
        sortAt: 10_000 + position,
      })),
    ];
    const insertStartedAt = performance.now();
    const insertCpuStartedAt = process.cpuUsage();
    const inserted = index.query({
      teamId: "team_large", fingerprint: "large-3", buildRows: () => addedRows,
      folderId: "inbox", searchQuery: "unique large mailbox needle", view: "all", page: 1, pageSize: 25,
    });
    const insertElapsed = performance.now() - insertStartedAt;
    const insertCpu = process.cpuUsage(insertCpuStartedAt);
    const insertCpuMs = (insertCpu.user + insertCpu.system) / 1_000;
    assert.equal(inserted.maintenance.mode, "incremental");
    assert.equal(inserted.maintenance.inserted, 50);
    assert.equal(inserted.maintenance.unchanged, 10_000);
    assert.ok(insertCpuMs < 300, `50-row insert should stay under 300ms CPU, received ${insertCpuMs.toFixed(1)}ms CPU / ${insertElapsed.toFixed(1)}ms wall`);
    index.close();
    index = null;

    database = await openMailQueryIndexDatabase({ path });
    index = createMailQueryIndex({ database });
    const reopened = index.query({
      teamId: "team_large", fingerprint: "large-3",
      buildRows: () => { throw new Error("a matching on-disk fingerprint must survive restart"); },
      folderId: "inbox", searchQuery: "unique large mailbox needle", view: "all", page: 1, pageSize: 25,
    });
    assert.equal(reopened.rebuilt, false);
    assert.deepEqual(reopened.messages.map((message) => message.id), ["message-9999"]);
    index.close();
    index = null;
  } finally {
    try { index?.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  }
});
