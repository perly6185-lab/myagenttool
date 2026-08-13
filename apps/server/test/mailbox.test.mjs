import assert from "node:assert/strict";
import { test } from "node:test";

import { createMailboxService, mailSendApprovalTarget } from "../src/services/mailbox.mjs";

function harness({ mailSendEnabled = () => false } = {}) {
  let id = 0;
  const events = [];
  const capabilityCalls = [];
  const state = {
    device: {
      applicationCredentialReadiness: [
        { applicationId: "app_163_mail_v2", provider: "netease", scope: "imap.readonly", status: "present" },
      ],
    },
    applications: [
      {
        id: "app_163_mail_v2",
        name: "163 Mail",
        status: "active",
        ownerTeamId: "team_a",
        source: { credential: { provider: "netease", scope: "imap.readonly" } },
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
    mailMessageStates: [],
    invocations: [],
    events,
  };
  const createCapabilityInvocation = (name, input, actor) => {
    capabilityCalls.push({ name, input, actor });
    const invocation = {
      id: `inv_${capabilityCalls.length}`,
      status: "queued",
      createdAt: "2026-08-13T03:00:00.000Z",
      updatedAt: "2026-08-13T03:00:00.000Z",
      options: { metadata: { capability: name, applicationId: "app_163_mail_v2" } },
    };
    state.invocations.unshift(invocation);
    return { status: 202, body: { invocationId: invocation.id, invocation } };
  };
  const service = createMailboxService({
    state,
    now: () => "2026-08-13T03:00:00.000Z",
    nextId: (prefix) => `${prefix}_${++id}`,
    appendEvent: (event) => events.push(event),
    persistStateSoon: () => {},
    mailSendEnabled,
    createCapabilityInvocation,
  });
  return { state, service, events, capabilityCalls };
}

test("mailbox snapshot turns imported mail into a deduplicated ordinary-user inbox", () => {
  const { service } = harness();
  const snapshot = service.snapshot({ actor: { teamId: "team_a" } });
  assert.equal(snapshot.connection.status, "connected");
  assert.equal(snapshot.accounts.length, 1);
  assert.equal(snapshot.accounts[0].name, "163 Mail");
  assert.equal(snapshot.accounts[0].syncCapability, undefined, "internal capability names stay out of the ordinary-user API");
  assert.equal(snapshot.accounts[0].fetchCapability, "app.app_163_mail_v2.fetch");
  assert.equal(snapshot.sync.status, "idle");
  assert.equal(snapshot.messages.length, 2, "header + fetched body merge by Message-ID");
  assert.equal(snapshot.messages[0].body, "Body text");
  assert.equal(snapshot.messages[0].issueNumber, 99);
  assert(!JSON.stringify(snapshot).includes("must not leak"), "foreign-team mail stays hidden");
});

test("inbox pagination is bounded and local read state updates counts without provider mutation", () => {
  const { state, service } = harness();
  const actor = { userId: "usr_a", teamId: "team_a" };
  const first = service.snapshot({ actor, page: 1, pageSize: 1 });
  assert.equal(first.messages.length, 1);
  assert.deepEqual(first.pagination, { page: 1, pageSize: 1, total: 2, totalPages: 2, hasPrevious: false, hasNext: true });
  assert.equal(first.folders[0].unread, 2);

  const marked = service.setMessageRead({ messageId: first.messages[0].messageId, read: true, actor });
  assert.deepEqual(marked.body, { messageId: first.messages[0].messageId, unread: false });
  assert.equal(state.mailMessageStates.length, 1);
  assert.match(state.mailMessageStates[0].id, /^mailmsgstate_/);
  const afterRead = service.snapshot({ actor, page: 1, pageSize: 1 });
  assert.equal(afterRead.messages[0].unread, false);
  assert.equal(afterRead.folders[0].unread, 1);

  service.setMessageRead({ messageId: first.messages[0].messageId, read: false, actor });
  assert.equal(state.mailMessageStates.length, 0);
  assert.equal(service.snapshot({ actor }).folders[0].unread, 2);
});

test("read state is tenant-scoped and unknown messages fail closed", () => {
  const { state, service } = harness();
  const foreign = service.setMessageRead({ messageId: "<one@example.com>", actor: { teamId: "team_b" } });
  assert.equal(foreign.status, 404);
  assert.equal(state.mailMessageStates.length, 0);
  assert.equal(service.setMessageRead({ messageId: "<missing@example.com>", actor: { teamId: "team_a" } }).status, 404);
});

test("one tenant's read-state cap never evicts another tenant's records", () => {
  const { state, service } = harness();
  state.mailMessageStates = [
    ...Array.from({ length: 10_000 }, (_, index) => ({
      id: `mailmsgstate_a_${index}`,
      messageId: `<old-${index}@example.com>`,
      ownerTeamId: "team_a",
      readAt: "2026-08-12T00:00:00.000Z",
    })),
    { id: "mailmsgstate_b", messageId: "<foreign@example.com>", ownerTeamId: "team_b", readAt: "2026-08-12T00:00:00.000Z" },
  ];
  service.setMessageRead({ messageId: "<one@example.com>", read: true, actor: { teamId: "team_a" } });
  assert.equal(state.mailMessageStates.filter((row) => row.ownerTeamId === "team_a").length, 10_000);
  assert.equal(state.mailMessageStates.some((row) => row.id === "mailmsgstate_b"), true);
});

test("one-click sync dispatches a server-owned capability and reuses the active run", () => {
  const { state, service, capabilityCalls } = harness();
  const actor = { userId: "usr_a", teamId: "team_a" };
  const started = service.startSync({ actor });
  assert.equal(started.status, 202);
  assert.equal(started.body.sync.status, "syncing");
  assert.equal(started.body.reused, false);
  assert.deepEqual(capabilityCalls, [{
    name: "app.app_163_mail_v2.list_unread",
    input: { limit: 50 },
    actor,
  }]);

  const repeated = service.startSync({ actor });
  assert.equal(repeated.status, 202);
  assert.equal(repeated.body.reused, true);
  assert.equal(capabilityCalls.length, 1, "an in-flight receive run is never duplicated");

  state.invocations[0].status = "succeeded";
  state.invocations[0].completedAt = "2026-08-13T03:01:00.000Z";
  const completed = service.snapshot({ actor });
  assert.deepEqual(completed.sync, {
    status: "succeeded",
    invocationId: "inv_1",
    lastCompletedAt: "2026-08-13T03:01:00.000Z",
    lastSucceededAt: "2026-08-13T03:01:00.000Z",
  });
});

test("sync refuses disconnected mailboxes and exposes no internal dispatch failure", () => {
  const { state, service, capabilityCalls } = harness();
  state.device.applicationCredentialReadiness = [];
  const result = service.startSync({ actor: { teamId: "team_a" } });
  assert.equal(result.status, 409);
  assert.deepEqual(result.body, { error: "mailbox_not_connected" });
  assert.equal(capabilityCalls.length, 0);
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
  enabled.state.device.applicationCredentialReadiness.push({ applicationId: "app_163_send", provider: "netease", scope: "smtp.send", status: "present" });
  assert.equal(enabled.service.snapshot({ actor: { teamId: "team_a" } }).accounts[0].canSend, true);
  enabled.state.device.applicationCredentialReadiness = enabled.state.device.applicationCredentialReadiness.filter((row) => row.applicationId !== "app_163_send");
  assert.equal(enabled.service.snapshot({ actor: { teamId: "team_a" } }).accounts[0].canSend, false);
});

test("receive readiness does not claim connected before the device reports its credential", () => {
  const { state, service } = harness();
  state.device.applicationCredentialReadiness = [];
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
    capabilityFacades: [{ id: "send", agentToolName: "mail_send" }],
  };
}
