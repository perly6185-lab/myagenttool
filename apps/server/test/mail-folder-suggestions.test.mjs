import assert from "node:assert/strict";
import test from "node:test";

import { createMailFolderSuggestionService } from "../src/services/mail-folder-suggestions.mjs";

function harness() {
  let sequence = 0;
  const state = {
    mailClassificationRules: [{
      id: "mailclsrule_news", ownerTeamId: "team_a", accountId: "app_mail", status: "active",
      matchKind: "sender", matchValue: "news@example.com",
      target: { attention: "low_value", mailType: "newsletter", suggestedAction: "archive_candidate" }, revision: 3,
    }],
    mailFolderMovePreviews: [],
  };
  const classificationService = {
    publicFor: (message) => message.manual
      ? { source: "manual", attention: "routine", mailType: "newsletter" }
      : message.protected
        ? { source: "rule", attention: "important", mailType: "newsletter" }
        : { source: "rule", attention: "low_value", mailType: "newsletter" },
  };
  const service = createMailFolderSuggestionService({
    state, classificationService,
    now: () => "2026-08-17T09:00:00.000Z",
    nextId: (prefix) => `${prefix}_${++sequence}`,
    persistStateSoon: () => {},
  });
  return { state, service };
}

const actor = { userId: "usr_a", teamId: "team_a" };
const folders = [
  { accountId: "app_mail", id: "inbox", path: "INBOX", name: "Inbox", specialUse: "\\Inbox" },
  { accountId: "app_mail", id: "subscriptions", path: "Archive/Subscriptions", name: "Subscriptions", specialUse: null },
  { accountId: "app_mail", id: "trash", path: "Trash", name: "Trash", specialUse: "\\Trash" },
  { accountId: "app_other", id: "other-subscriptions", path: "Subscriptions", name: "Subscriptions", specialUse: null },
];

function message(index, extra = {}) {
  return {
    applicationId: "app_mail", folderId: "inbox", folderPath: "INBOX",
    messageId: `<folder-${index}@example.com>`, from: "News <news@example.com>",
    subject: `Newsletter ${index}`, date: `2026-08-${String(10 + index).padStart(2, "0")}T09:00:00.000Z`, ...extra,
  };
}

test("active stable rules suggest an existing same-account directory without moving messages", () => {
  const { state, service } = harness();
  const messages = [message(1), message(2), message(3, { protected: true }), message(4, { manual: true })];
  const before = structuredClone(messages);
  const result = service.catalog({ messages, folders, actor });
  assert.equal(result.status, 200);
  assert.equal(result.body.movesSupported, false);
  assert.equal(result.body.suggestions.length, 1);
  const suggestion = result.body.suggestions[0];
  assert.equal(suggestion.affectedCount, 2);
  assert.equal(suggestion.protectedCount, 1);
  assert.deepEqual(suggestion.proposedDestination, {
    kind: "existing", folderId: "subscriptions", folderPath: "Archive/Subscriptions", name: "Subscriptions", category: "subscriptions",
  });
  assert(!suggestion.folderOptions.some((folder) => folder.folderId === "trash"));
  assert(!suggestion.folderOptions.some((folder) => folder.folderId === "other-subscriptions"));
  assert.deepEqual(messages, before, "catalog generation is read-only");
  assert.equal(state.mailFolderMovePreviews.length, 0);
});

test("preview is server-recomputed, bounded, durable, and exposes the full confirmation batch", () => {
  const { state, service } = harness();
  const messages = Array.from({ length: 55 }, (_, index) => message(index));
  const suggestion = service.catalog({ messages, folders, actor }).body.suggestions[0];
  const previewed = service.createPreview({ suggestionId: suggestion.id, destinationFolderId: "subscriptions", messages, folders, actor });
  assert.equal(previewed.status, 201);
  assert.equal(previewed.body.preview.selectedCount, 50);
  assert.equal(previewed.body.preview.remainingCount, 5);
  assert.equal(previewed.body.preview.movesSupported, false);
  assert.equal(previewed.body.preview.destination.folderId, "subscriptions");
  assert.equal(previewed.body.preview.samples.length, 50);
  assert.equal(state.mailFolderMovePreviews.length, 1);
  assert.equal(state.mailFolderMovePreviews[0].messageKeys.length, 50);
  assert.equal("subject" in state.mailFolderMovePreviews[0], false);
  assert.equal(service.createPreview({ suggestionId: suggestion.id, destinationFolderId: "trash", messages, folders, actor }).status, 400);
  assert.equal(service.createPreview({ suggestionId: suggestion.id, messages, folders, actor: { teamId: "team_b" } }).status, 404);
});

test("missing target directory is proposed but never created", () => {
  const { state, service } = harness();
  const inboxOnly = folders.filter((folder) => folder.id === "inbox");
  const suggestion = service.catalog({ messages: [message(1)], folders: inboxOnly, actor }).body.suggestions[0];
  assert.deepEqual(suggestion.proposedDestination, {
    kind: "new", folderId: null, folderPath: null, name: null, category: "subscriptions",
  });
  const preview = service.createPreview({ suggestionId: suggestion.id, messages: [message(1)], folders: inboxOnly, actor });
  assert.equal(preview.body.preview.destination.kind, "new");
  assert.equal(state.mailFolderMovePreviews.length, 1);
});
