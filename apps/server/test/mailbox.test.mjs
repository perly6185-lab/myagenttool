import assert from "node:assert/strict";
import { test } from "node:test";

import { createMailboxService, mailSendApprovalTarget } from "../src/services/mailbox.mjs";

function harness({ mailSendEnabled = () => false } = {}) {
  let id = 0;
  const events = [];
  const state = {
    applications: [
      {
        id: "app_163_mail_v2",
        name: "163 Mail",
        status: "active",
        ownerTeamId: "team_a",
        source: { credential: { provider: "netease", scope: "imap.readonly" } },
        credentialReadiness: { status: "authorized" },
        capabilityFacades: [
          { id: "list_unread", agentToolName: "mail_list_unread" },
          { id: "fetch", agentToolName: "mail_fetch" },
        ],
      },
    ],
    applicationResults: [
      {
        id: "appres_body",
        source: "mail_headers",
        applicationId: "app_163_mail_v2",
        ownerTeamId: "team_a",
        createdAt: "2026-08-13T02:00:00.000Z",
        data: { kind: "message", messageId: "<one@example.com>", from: "A <a@example.com>", subject: "Hello", date: "2026-08-13T01:00:00.000Z", body: "Body text" },
      },
      {
        id: "appres_headers",
        source: "mail_headers",
        applicationId: "app_163_mail_v2",
        ownerTeamId: "team_a",
        createdAt: "2026-08-13T01:30:00.000Z",
        data: { kind: "unread_headers", headers: [
          { messageId: "<one@example.com>", from: "A <a@example.com>", subject: "Hello", date: "2026-08-13T01:00:00.000Z" },
          { messageId: "<two@example.com>", from: "B <b@example.com>", subject: "Second", date: "2026-08-12T01:00:00.000Z" },
        ] },
      },
      {
        id: "foreign",
        source: "mail_headers",
        ownerTeamId: "team_b",
        data: { kind: "message", messageId: "<secret@example.com>", from: "Secret <s@example.com>", subject: "Foreign", body: "must not leak" },
      },
    ],
    mailThreads: { "<one@example.com>": { issueNumber: 99 } },
    mailDrafts: [],
    events,
  };
  const service = createMailboxService({
    state,
    now: () => "2026-08-13T03:00:00.000Z",
    nextId: (prefix) => `${prefix}_${++id}`,
    appendEvent: (event) => events.push(event),
    persistStateSoon: () => {},
    mailSendEnabled,
  });
  return { state, service, events };
}

test("mailbox snapshot turns imported mail into a deduplicated ordinary-user inbox", () => {
  const { service } = harness();
  const snapshot = service.snapshot({ actor: { teamId: "team_a" } });
  assert.equal(snapshot.connection.status, "connected");
  assert.equal(snapshot.accounts.length, 1);
  assert.equal(snapshot.accounts[0].name, "163 Mail");
  assert.equal(snapshot.accounts[0].syncCapability, "app.app_163_mail_v2.list_unread");
  assert.equal(snapshot.accounts[0].fetchCapability, "app.app_163_mail_v2.fetch");
  assert.equal(snapshot.messages.length, 2, "header + fetched body merge by Message-ID");
  assert.equal(snapshot.messages[0].body, "Body text");
  assert.equal(snapshot.messages[0].issueNumber, 99);
  assert(!JSON.stringify(snapshot).includes("must not leak"), "foreign-team mail stays hidden");
});

test("user drafts may be incomplete, remain tenant scoped, and increment revision on edit", () => {
  const { state, service, events } = harness();
  const created = service.createDraft({ to: "", subject: "", body: "Starting…", actor: { userId: "usr_a", teamId: "team_a" } });
  assert.equal(created.status, 201);
  assert.equal(created.body.draft.revision, 1);
  assert.equal(mailSendApprovalTarget(created.body.draft), `${created.body.draft.id}@1`);

  const foreign = service.updateDraft({ draftId: created.body.draft.id, to: "b@example.com", subject: "x", body: "x", actor: { teamId: "team_b" } });
  assert.equal(foreign.status, 404);

  const updated = service.updateDraft({ draftId: created.body.draft.id, to: "B <b@example.com>", subject: "Subject", body: "Ready", actor: { teamId: "team_a" } });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.draft.revision, 2);
  assert.equal(updated.body.draft.approvalTarget, `${created.body.draft.id}@2`);
  assert(events.some((event) => event.type === "mail_draft_updated"));
  assert.equal(state.mailDrafts[0].bodyFormat, "plain_text");
});

test("draft validation rejects malformed recipients and sent drafts cannot be edited or deleted", () => {
  const { state, service } = harness();
  const invalid = service.createDraft({ to: "not-an-email", subject: "x", body: "x", actor: { teamId: "team_a" } });
  assert.equal(invalid.status, 422);
  assert.equal(invalid.body.error, "mail_recipient_invalid");

  const created = service.createDraft({ to: "a@example.com", subject: "x", body: "x", actor: { teamId: "team_a" } });
  state.mailDrafts[0].status = "sent";
  assert.equal(service.updateDraft({ draftId: created.body.draft.id, to: "a@example.com", subject: "y", body: "y", actor: { teamId: "team_a" } }).body.error, "mail_draft_not_editable");
  assert.equal(service.deleteDraft({ draftId: created.body.draft.id, actor: { teamId: "team_a" } }).body.error, "mail_draft_not_deletable");
});

test("editable draft approval targets are revision-bound", () => {
  assert.equal(mailSendApprovalTarget({ id: "draft_1", revision: 3 }), "draft_1@3");
  assert.equal(mailSendApprovalTarget({ id: "legacy" }), "legacy");
});

test("send readiness is honest about the flag and separate authorized credential", () => {
  const disabled = harness();
  disabled.state.applications.push(sendApplication());
  assert.equal(disabled.service.snapshot({ actor: { teamId: "team_a" } }).accounts[0].canSend, false);

  const enabled = harness({ mailSendEnabled: () => true });
  enabled.state.applications.push(sendApplication());
  assert.equal(enabled.service.snapshot({ actor: { teamId: "team_a" } }).accounts[0].canSend, true);
  enabled.state.applications.at(-1).credentialReadiness.status = "missing";
  assert.equal(enabled.service.snapshot({ actor: { teamId: "team_a" } }).accounts[0].canSend, false);
});

test("receive readiness does not claim connected before the device reports its credential", () => {
  const { state, service } = harness();
  state.applications[0].credentialReadiness = { status: "missing" };
  const account = service.snapshot({ actor: { teamId: "team_a" } }).accounts[0];
  assert.equal(account.canReceive, false);
  assert.equal(account.status, "needs_attention");
  assert.equal(account.statusDetail, "credential_not_authorized");
});

function sendApplication() {
  return {
    id: "app_163_send",
    name: "163 Mail send",
    status: "active",
    ownerTeamId: "team_a",
    source: { credential: { provider: "netease", scope: "smtp.send" } },
    credentialReadiness: { status: "authorized" },
    capabilityFacades: [{ id: "send", agentToolName: "mail_send" }],
  };
}
