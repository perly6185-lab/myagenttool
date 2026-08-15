import assert from "node:assert/strict";
import test from "node:test";

import { sync163Mailbox } from "../src/sync-163.mjs";

test("incremental sync fetches only UIDs above a valid cursor while refreshing recent Seen flags", async () => {
  const searches = [];
  const envelope = (uid) => ({ uid, flags: new Set(uid === 12 ? ["\\Seen"] : []), envelope: { messageId: `<${uid}@example.com>`, from: [{ address: "a@example.com" }], subject: `Mail ${uid}`, date: new Date("2026-08-13T00:00:00Z") } });
  const client = {
    mailbox: null,
    list: async () => [{ path: "INBOX", name: "Inbox", flags: new Set(), specialUse: "\\Inbox", status: { messages: 12, unseen: 1, uidValidity: 99n } }],
    getMailboxLock: async () => { client.mailbox = { uidValidity: 99n, exists: 12 }; return { release() {} }; },
    search: async (query) => { searches.push(query); return query.all ? [10, 11, 12] : [11, 12]; },
    fetchAll: async (uids, query) => query.envelope ? uids.map(envelope) : uids.map((uid) => ({ uid, flags: new Set(uid === 12 ? ["\\Seen"] : []) })),
  };
  const result = await sync163Mailbox({ limit: 50, cursors: [{ folderPath: "INBOX", uidValidity: "99", lastUid: 11 }] }, async (action) => action(client));
  assert.deepEqual(searches[0], { uid: "12:4294967295" });
  assert.deepEqual(result.messages.map((message) => message.uid), [12]);
  assert.equal(result.messages[0].unread, false);
  assert.equal(result.readStates.length, 3);
  assert.deepEqual(result.cursors[0], { folderId: "inbox", folderPath: "INBOX", uidValidity: "99", lastUid: 12 });
});

test("UIDVALIDITY change resets only that folder cursor", async () => {
  const client = {
    mailbox: null,
    list: async () => [{ path: "INBOX", name: "Inbox", flags: new Set(), status: { messages: 1, unseen: 1, uidValidity: 200n } }],
    getMailboxLock: async () => { client.mailbox = { uidValidity: 200n, exists: 1 }; return { release() {} }; },
    search: async (query) => query.all ? [1] : [],
    fetchAll: async (uids, query) => query.envelope ? uids.map((uid) => ({ uid, flags: new Set(), envelope: { messageId: "<reset@example.com>", from: [], subject: "reset", date: new Date() } })) : uids.map((uid) => ({ uid, flags: new Set() })),
  };
  const result = await sync163Mailbox({ cursors: [{ folderPath: "INBOX", uidValidity: "199", lastUid: 99 }] }, async (action) => action(client));
  assert.equal(result.folders[0].cursorReset, true);
  assert.equal(result.cursors[0].lastUid, 1);
});

test("one unavailable folder preserves its cursor without losing healthy folder results", async () => {
  const client = {
    mailbox: null,
    list: async () => [
      { path: "INBOX", name: "Inbox", flags: new Set(), status: { messages: 1, unseen: 0, uidValidity: 1n } },
      { path: "Broken", name: "Broken", flags: new Set(), status: { messages: 5, unseen: 2, uidValidity: 2n } },
    ],
    getMailboxLock: async (path) => {
      if (path === "Broken") throw new Error("provider refused folder");
      client.mailbox = { uidValidity: 1n, exists: 1 };
      return { release() {} };
    },
    search: async () => [1],
    fetchAll: async (uids, query) => query.envelope ? [{ uid: 1, flags: new Set(["\\Seen"]), envelope: { messageId: "<ok@example.com>", from: [], subject: "ok", date: new Date() } }] : [{ uid: 1, flags: new Set(["\\Seen"]) }],
  };
  const result = await sync163Mailbox({ cursors: [{ folderPath: "Broken", uidValidity: "2", lastUid: 5 }] }, async (action) => action(client));
  assert.equal(result.messages.length, 1);
  assert.equal(result.folders.find((folder) => folder.path === "Broken").syncError, true);
  assert.equal(result.cursors.find((cursor) => cursor.folderPath === "Broken").lastUid, 5);
});
