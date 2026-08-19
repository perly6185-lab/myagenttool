/* Durable mailbox facts, independent from the generic Application result log.
 *
 * applicationResults is intentionally a short operational history shared by
 * every application. Mail headers, bodies, folders and cursors are product data
 * and must not disappear when unrelated runs evict that history.
 */

import { createHash } from "node:crypto";

const MAX_MESSAGES_PER_ACCOUNT = 20_000;
const MAX_FOLDERS_PER_ACCOUNT = 2_000;
const MAX_CURSORS_PER_ACCOUNT = 2_000;

export function foldMailApplicationResult(state, record) {
  if (record?.source !== "mail_headers" || !record.data) return false;
  state.mailFactImportIds ??= [];
  const marker = record.id ? importMarker(record) : null;
  if (marker && state.mailFactImportIds.includes(marker)) return false;
  state.mailMessages ??= [];
  state.mailFolders ??= [];
  state.mailCursors ??= [];
  const data = record.data;
  const context = {
    ownerTeamId: record.ownerTeamId ?? "team_local",
    applicationId: record.applicationId ?? null,
    accountId: data.accountId ?? record.accountId ?? null,
    updatedAt: record.createdAt ?? new Date(0).toISOString(),
  };

  if (data.kind === "mailbox_sync") {
    for (const folder of data.folders ?? []) upsertFact(state.mailFolders, folderKey(context, folder.path), { ...context, ...folder }, MAX_FOLDERS_PER_ACCOUNT);
    for (const cursor of data.cursors ?? []) upsertFact(state.mailCursors, folderKey(context, cursor.folderPath), { ...context, ...cursor }, MAX_CURSORS_PER_ACCOUNT);
    for (const message of data.messages ?? []) upsertMessage(state, context, message);
    for (const readState of data.readStates ?? []) {
      const row = state.mailMessages.find((candidate) => sameAccount(candidate, context)
        && candidate.payload?.folderPath === readState.folderPath && candidate.payload?.uid === readState.uid);
      if (row && isAtLeastAsRecent(context.updatedAt, row.updatedAt)) {
        row.payload = { ...row.payload, unread: readState.unread };
        row.updatedAt = context.updatedAt;
      }
    }
  } else if (data.kind === "message") {
    upsertMessage(state, context, data);
  } else if (data.kind === "unread_headers") {
    for (const message of data.headers ?? []) upsertMessage(state, context, { ...message, unread: true });
  } else if (data.kind === "read_state") {
    const row = state.mailMessages.find((candidate) => (candidate.ownerTeamId ?? "team_local") === context.ownerTeamId
      && (!context.applicationId || sameAccount(candidate, context)) && candidate.payload?.messageId === data.messageId);
    if (row && isAtLeastAsRecent(context.updatedAt, row.updatedAt)) {
      row.payload = { ...row.payload, unread: data.read !== true, folderId: data.folderId ?? row.payload.folderId, folderPath: data.folderPath ?? row.payload.folderPath };
      row.updatedAt = context.updatedAt;
    }
  }
  if (marker) {
    state.mailFactImportIds.unshift(marker);
    state.mailFactImportIds = [...new Set(state.mailFactImportIds)].slice(0, 5_000);
  }
  return true;
}

export function backfillMailFacts(state) {
  let imported = 0;
  for (const record of [...(state.applicationResults ?? [])].sort(byCreatedAt)) {
    if (foldMailApplicationResult(state, record)) imported += 1;
  }
  return imported;
}

export function mailFactRecords(state, teamId = null) {
  // Test fixtures and a few import paths may append operational results after
  // service construction. Folding is idempotent, so keep this compatibility
  // bridge while new imports write facts transactionally at ingestion time.
  backfillMailFacts(state);
  const owns = (row) => teamId == null || (row.ownerTeamId ?? "team_local") === teamId;
  const groups = new Map();
  for (const row of state.mailFolders ?? []) {
    if (!owns(row)) continue;
    const group = factGroup(groups, row);
    group.folders.push(stripContext(row));
  }
  for (const row of state.mailCursors ?? []) {
    if (!owns(row)) continue;
    const group = factGroup(groups, row);
    group.cursors.push(stripContext(row));
  }
  const records = [...groups.values()].map((group) => ({
    id: `mailfacts_sync_${stableKey(group)}`,
    source: "mail_headers", kind: "mailbox_sync", status: "parsed",
    applicationId: group.applicationId, accountId: group.accountId,
    ownerTeamId: group.ownerTeamId, createdAt: group.updatedAt,
    data: { kind: "mailbox_sync", accountId: group.accountId, folders: group.folders, messages: [], readStates: [], cursors: group.cursors, hasMore: false },
  }));
  for (const row of state.mailMessages ?? []) {
    if (!owns(row)) continue;
    records.push({
      id: `mailfacts_message_${row.key}`,
      source: "mail_headers", kind: "message", status: "parsed",
      applicationId: row.applicationId, accountId: row.accountId,
      ownerTeamId: row.ownerTeamId, createdAt: row.updatedAt,
      data: { kind: "message", accountId: row.accountId, ...row.payload },
    });
  }
  return records;
}

function upsertMessage(state, context, incoming) {
  const messageId = String(incoming?.messageId ?? "").trim();
  if (!messageId) return;
  const key = messageKey(context, messageId);
  const existing = state.mailMessages.find((row) => row.key === key);
  const payload = cleanUndefined(incoming);
  if (existing) {
    if (!isAtLeastAsRecent(context.updatedAt, existing.updatedAt)) return;
    existing.payload = { ...existing.payload, ...payload };
    existing.updatedAt = context.updatedAt;
  } else {
    state.mailMessages.push({ key, ...context, payload });
  }
  state.mailMessages.sort((left, right) => Date.parse(right.payload?.date ?? right.updatedAt ?? 0) - Date.parse(left.payload?.date ?? left.updatedAt ?? 0));
  trimAccountRows(state.mailMessages, context, MAX_MESSAGES_PER_ACCOUNT);
}

function upsertFact(rows, key, value, max) {
  const index = rows.findIndex((row) => row.key === key);
  const next = { key, ...cleanUndefined(value) };
  if (index >= 0) {
    if (isAtLeastAsRecent(next.updatedAt, rows[index].updatedAt)) rows[index] = next;
  } else rows.push(next);
  trimAccountRows(rows, value, max);
}

function trimAccountRows(rows, account, max) {
  const key = accountKey(account);
  const owned = rows.filter((row) => accountKey(row) === key);
  if (owned.length <= max) return;
  owned.sort((left, right) => Date.parse(right.payload?.date ?? right.updatedAt ?? 0) - Date.parse(left.payload?.date ?? left.updatedAt ?? 0));
  const retained = new Set(owned.slice(0, max));
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (accountKey(rows[index]) === key && !retained.has(rows[index])) rows.splice(index, 1);
  }
}

function factGroup(groups, row) {
  const key = accountKey(row);
  let group = groups.get(key);
  if (!group) {
    group = { ownerTeamId: row.ownerTeamId, applicationId: row.applicationId, accountId: row.accountId ?? null, folders: [], cursors: [], updatedAt: row.updatedAt };
    groups.set(key, group);
  } else if (Date.parse(row.updatedAt ?? 0) > Date.parse(group.updatedAt ?? 0)) group.updatedAt = row.updatedAt;
  return group;
}

function stripContext(row) {
  const { key: _key, ownerTeamId: _owner, applicationId: _application, accountId: _account, updatedAt: _updated, ...value } = row;
  return value;
}

function sameAccount(left, right) { return accountKey(left) === accountKey(right); }
function accountKey(value) { return `${value.ownerTeamId ?? "team_local"}\0${value.applicationId ?? "mail"}\0${value.accountId ?? "legacy"}`; }
function messageKey(context, messageId) { return `${accountKey(context)}\0${messageId}`; }
function folderKey(context, path) { return `${accountKey(context)}\0${String(path ?? "")}`; }
function stableKey(group) { return Buffer.from(accountKey(group)).toString("base64url"); }
function cleanUndefined(value) { return Object.fromEntries(Object.entries(value ?? {}).filter(([, entry]) => entry !== undefined)); }
function byCreatedAt(left, right) { return Date.parse(left.createdAt ?? 0) - Date.parse(right.createdAt ?? 0); }
function isAtLeastAsRecent(next, current) { return Date.parse(next ?? 0) >= Date.parse(current ?? 0); }
function importMarker(record) { return `${record.id}:${createHash("sha256").update(JSON.stringify(record.data)).digest("hex").slice(0, 16)}`; }
