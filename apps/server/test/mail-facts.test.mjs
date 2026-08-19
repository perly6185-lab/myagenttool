import assert from "node:assert/strict";
import test from "node:test";

import { backfillMailFacts, foldMailApplicationResult, mailFactRecords } from "../src/services/mail-facts.mjs";

test("mail facts survive eviction from the generic application result history", () => {
  const state = { applicationResults: [{
    id: "appres_1", source: "mail_headers", status: "parsed", applicationId: "app_mail", ownerTeamId: "team_a",
    createdAt: "2026-08-19T01:00:00.000Z",
    data: { kind: "mailbox_sync", accountId: "netease:1111111111111111", folders: [{ id: "inbox", path: "INBOX", name: "Inbox" }], cursors: [{ folderId: "inbox", folderPath: "INBOX", uidValidity: "1", lastUid: 3 }], readStates: [], messages: [{ messageId: "<one@example.com>", folderId: "inbox", folderPath: "INBOX", uid: 3, unread: true, subject: "One" }] },
  }] };
  backfillMailFacts(state);
  state.applicationResults = [];

  const records = mailFactRecords(state, "team_a");
  assert.equal(records.some((record) => record.data?.messageId === "<one@example.com>"), true);
  assert.equal(records.find((record) => record.data?.kind === "mailbox_sync").data.cursors[0].lastUid, 3);
});

test("mail facts keep accounts with the same Message-ID isolated", () => {
  const state = {};
  for (const [accountId, subject] of [["netease:1111111111111111", "Account one"], ["netease:2222222222222222", "Account two"]]) {
    foldMailApplicationResult(state, {
      source: "mail_headers", status: "parsed", applicationId: "app_mail", ownerTeamId: "team_a", createdAt: "2026-08-19T01:00:00.000Z",
      data: { kind: "message", accountId, messageId: "<same@example.com>", subject, body: subject },
    });
  }
  const records = mailFactRecords(state, "team_a").filter((record) => record.data?.messageId === "<same@example.com>");
  assert.equal(records.length, 2);
  assert.deepEqual(new Set(records.map((record) => record.accountId)), new Set(["netease:1111111111111111", "netease:2222222222222222"]));
});
