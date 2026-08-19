import assert from "node:assert/strict";
import test from "node:test";

import { organize163Batch } from "../src/organize-163.mjs";

test("creates an allowlisted folder and moves only the reviewed messages", async () => {
  const calls = [];
  const client = {
    list: async () => [],
    mailboxCreate: async (name) => { calls.push(["create", name]); return { path: name }; },
    getMailboxLock: async (path, options) => { calls.push(["lock", path, options]); return { release: () => calls.push(["release", path]) }; },
    search: async ({ header }) => header["message-id"] === "missing" ? [] : [7],
    messageMove: async (uids, destination, options) => { calls.push(["move", uids, destination, options]); return { path: destination }; },
  };
  const result = await organize163Batch({
    destinationName: "Subscriptions",
    messages: [
      { messageId: "m1", sourceFolderPath: "INBOX" },
      { messageId: "missing", sourceFolderPath: "INBOX" },
    ],
  }, async (action) => action(client));
  assert.deepEqual(result.organization, {
    destinationFolderPath: "Subscriptions", created: true, requestedCount: 2, moved: ["m1"], missing: ["missing"], conflicts: [],
  });
  assert.deepEqual(calls.filter(([kind]) => kind === "move"), [["move", [7], "Subscriptions", { uid: true }]]);
});

test("uses an existing destination and rejects free-form folder names or oversized batches", async () => {
  const client = {
    list: async () => [{ path: "Newsletters" }],
    getMailboxLock: async () => ({ release() {} }),
    search: async () => [1],
    messageMove: async () => ({}),
  };
  const result = await organize163Batch({ destinationFolderPath: "Newsletters", messages: [{ messageId: "m1", sourceFolderPath: "INBOX" }] }, async (action) => action(client));
  assert.equal(result.organization.destinationFolderPath, "Newsletters");
  await assert.rejects(() => organize163Batch({ destinationName: "../../Trash", messages: [{ messageId: "m1", sourceFolderPath: "INBOX" }] }, async (action) => action(client)), /mail_organize_new_folder_invalid/);
  await assert.rejects(() => organize163Batch({ destinationName: "Subscriptions", messages: Array.from({ length: 51 }, (_, index) => ({ messageId: `m${index}`, sourceFolderPath: "INBOX" })) }, async (action) => action(client)), /mail_organize_batch_invalid/);
});

test("refuses a move back into the source folder", async () => {
  const client = { getMailboxLock: async () => ({ release() {} }) };
  await assert.rejects(() => organize163Batch({ destinationFolderPath: "INBOX", messages: [{ messageId: "m1", sourceFolderPath: "INBOX" }] }, async (action) => action(client)), /mail_organize_source_equals_destination/);
});

test("reports an ambiguous Message-ID without moving unreviewed duplicates", async () => {
  let moved = false;
  const client = {
    getMailboxLock: async () => ({ release() {} }),
    search: async () => [7, 8],
    messageMove: async () => { moved = true; return {}; },
  };
  const result = await organize163Batch({ destinationFolderPath: "Subscriptions", messages: [{ messageId: "duplicate", sourceFolderPath: "INBOX" }] }, async (action) => action(client));
  assert.deepEqual(result.organization.conflicts, [{ messageId: "duplicate", reason: "message_id_ambiguous" }]);
  assert.equal(moved, false);
});
