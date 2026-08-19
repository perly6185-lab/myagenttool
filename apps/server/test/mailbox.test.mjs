import assert from "node:assert/strict";
import { test } from "node:test";

import { createMailboxService, isMailClassificationEnabled, mailSendApprovalTarget } from "../src/services/mailbox.mjs";
import { createMailClassificationService } from "../src/services/mail-classification.mjs";
import { createMailQueryIndex, openMailQueryIndexDatabase } from "../src/services/mail-query-index.mjs";

function harness({ mailSendEnabled = () => false, mailClassificationEnabled = () => true, createWorkItem = null, inspectTaskMaterialDraft = null, mailQueryIndex = null } = {}) {
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
          { id: "prefetch_body", agentToolName: "mail_prefetch_body" },
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
        data: { kind: "message", messageId: "<one@example.com>", from: "A <a@example.com>", subject: "Hello", date: "2026-08-13T01:00:00.000Z", body: "Body text", bodyHtml: '<p>Body <a href="https://example.com">text</a></p>', hasHtml: true, bodyTruncated: true },
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
    mailTaskLinks: [],
    mailClassifications: [],
    mailClassificationJobs: [],
    workItems: [],
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
  const nextId = (prefix) => `${prefix}_${++id}`;
  const classificationService = createMailClassificationService({
    state,
    now: () => "2026-08-13T03:00:00.000Z",
    nextId,
    appendEvent: (event) => events.push(event),
    persistStateSoon: () => {},
  });
  const service = createMailboxService({
    state,
    now: () => "2026-08-13T03:00:00.000Z",
    nextId,
    appendEvent: (event) => events.push(event),
    persistStateSoon: () => {},
    mailSendEnabled,
    mailClassificationEnabled,
    createCapabilityInvocation,
    createWorkItem,
    inspectTaskMaterialDraft,
    classificationService,
    mailQueryIndex,
  });
  return { state, service, events, capabilityCalls };
}

test("read-only classification can roll back without hiding the ordinary inbox", () => {
  const { service } = harness({ mailClassificationEnabled: () => false });
  const snapshot = service.snapshot({ actor: { teamId: "team_a" }, view: "needs_attention" });
  assert.equal(snapshot.selectedView, "all");
  assert.equal(snapshot.classificationSummary, null);
  assert.equal(snapshot.messages.length, 2);
  assert.equal(snapshot.messages.every((message) => message.classification === undefined), true);
  assert.equal(service.startClassification({ actor: { teamId: "team_a" } }).body.error, "mail_classification_disabled");
});

test("classification environment gate defaults on and fails closed only when explicitly disabled", () => {
  const previous = process.env.MYAGENTTOOL_MAIL_CLASSIFICATION_ENABLED;
  try {
    delete process.env.MYAGENTTOOL_MAIL_CLASSIFICATION_ENABLED;
    assert.equal(isMailClassificationEnabled(), true);
    process.env.MYAGENTTOOL_MAIL_CLASSIFICATION_ENABLED = "0";
    assert.equal(isMailClassificationEnabled(), false);
  } finally {
    if (previous === undefined) delete process.env.MYAGENTTOOL_MAIL_CLASSIFICATION_ENABLED;
    else process.env.MYAGENTTOOL_MAIL_CLASSIFICATION_ENABLED = previous;
  }
});

test("body prefetch queues once, prioritizes a selected message, and advances serially", () => {
  const { service, state, capabilityCalls } = harness();
  const queued = service.enqueueBodyPrefetch({
    ownerTeamId: "team_a",
    applicationId: "app_163_mail_v2",
    messages: [{ messageId: "<two@example.com>", folderPath: "INBOX", unread: true, date: "2026-08-12T01:00:00.000Z" }],
  });
  assert.equal(queued.queued, 1);
  service.sweepBodyPrefetch();
  assert.equal(capabilityCalls.length, 1);
  assert.equal(capabilityCalls[0].name, "app.app_163_mail_v2.prefetch_body");
  assert.equal(state.mailBodyPrefetchJobs[0].status, "running");
  assert.equal(state.mailBodyPrefetchJobs[0].attempt, 1);

  const replay = service.enqueueBodyPrefetch({ ownerTeamId: "team_a", applicationId: "app_163_mail_v2", messages: [{ messageId: "<two@example.com>" }] });
  assert.equal(replay.queued, 0, "the durable key deduplicates repeated sync results");
  const priority = service.prioritizeBodyPrefetch({ messageId: "<two@example.com>", actor: { teamId: "team_a", userId: "user_a" } });
  assert.equal(priority.status, 202);
  assert.equal(state.mailBodyPrefetchJobs[0].priority, "user");
  assert.equal(capabilityCalls.length, 1, "clicking does not dispatch a duplicate while the background job is active");
});

test("a moved message revives an unavailable body job with its new folder", () => {
  const { service, state } = harness();
  service.enqueueBodyPrefetch({
    ownerTeamId: "team_a",
    applicationId: "app_163_mail_v2",
    messages: [{ messageId: "<two@example.com>", folderPath: "INBOX", unread: true }],
    schedule: false,
  });
  Object.assign(state.mailBodyPrefetchJobs[0], { status: "unavailable", attempt: 3, lastError: "mail_message_not_found", completedAt: "2026-08-13T03:00:00.000Z" });

  const recovered = service.enqueueBodyPrefetch({
    ownerTeamId: "team_a",
    applicationId: "app_163_mail_v2",
    messages: [{ messageId: "<two@example.com>", folderPath: "Subscriptions", unread: true }],
    schedule: false,
  });

  assert.equal(recovered.queued, 1);
  assert.equal(state.mailBodyPrefetchJobs[0].folderPath, "Subscriptions");
  assert.equal(state.mailBodyPrefetchJobs[0].status, "queued");
  assert.equal(state.mailBodyPrefetchJobs[0].attempt, 0);
});

test("classification rollback rebuilds the derived index without classification payloads", async () => {
  const database = await openMailQueryIndexDatabase({ path: ":memory:" });
  const index = createMailQueryIndex({ database });
  let enabled = true;
  const { service } = harness({ mailClassificationEnabled: () => enabled, mailQueryIndex: index });
  const classified = service.snapshot({ actor: { teamId: "team_a" } });
  assert.equal(classified.messages.some((message) => Object.hasOwn(message, "classification")), true);
  enabled = false;
  const rolledBack = service.snapshot({ actor: { teamId: "team_a" }, view: "needs_attention" });
  assert.equal(rolledBack.selectedView, "all");
  assert.equal(rolledBack.messages.some((message) => Object.hasOwn(message, "classification")), false);
  index.close();
});

test("mailbox uses an available query index and fails open to its original projection", () => {
  const calls = [];
  const indexed = harness({
    mailQueryIndex: {
      query(input) {
        calls.push(input);
        const rows = input.buildRows();
        return {
          messages: rows.slice(0, 1).map((item) => item.payload),
          folderCounts: new Map([["inbox", { count: rows.length, unread: rows.length }]]),
          classificationSummary: { counts: { all: rows.length }, classified: 0, pending: rows.length, classifierVersion: 1 },
          pagination: { page: 1, pageSize: 1, total: rows.length, totalPages: rows.length, offset: 0 },
        };
      },
    },
  }).service.snapshot({ actor: { teamId: "team_a" }, pageSize: 1 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].teamId, "team_a");
  assert.equal(indexed.messages.length, 1);
  assert.equal(indexed.pagination.total, 2);

  const fallback = harness({ mailQueryIndex: { query() { throw new Error("corrupt index"); } } })
    .service.snapshot({ actor: { teamId: "team_a" } });
  assert.equal(fallback.messages.length, 2);
  assert.equal(fallback.pagination.total, 2);
});

test("mailbox state changes update only the affected durable query row", async () => {
  const database = await openMailQueryIndexDatabase({ path: ":memory:" });
  const index = createMailQueryIndex({ database });
  const maintenance = [];
  const trackedIndex = {
    query(input) {
      const result = index.query(input);
      maintenance.push(result.maintenance);
      return result;
    },
  };
  const { service } = harness({ mailQueryIndex: trackedIndex });
  const actor = { userId: "usr_a", teamId: "team_a" };
  const first = service.snapshot({ actor });
  service.setMessageRead({ messageId: first.messages[0].messageId, read: true, actor });
  const changed = service.snapshot({ actor });

  assert.equal(maintenance[0].mode, "rebuilt");
  assert.deepEqual(maintenance[1], {
    mode: "incremental", inserted: 0, updated: 1, deleted: 0, unchanged: 1, total: 2,
  });
  assert.equal(changed.folders.find((folder) => folder.id === "inbox").unread, 1);
  index.close();
});

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
  assert.equal(snapshot.messages[0].hasHtml, true);
  assert.match(snapshot.messages[0].bodyHtml, /https:\/\/example\.com/);
  assert.equal(snapshot.messages[0].bodyTruncated, true);
  assert.equal(snapshot.messages[0].bodyContentVersion, 1, "legacy imported bodies are marked for one-time enrichment");
  assert.equal(snapshot.messages[0].issueNumber, 99);
  assert(!JSON.stringify(snapshot).includes("must not leak"), "foreign-team mail stays hidden");
});

test("switching the connected account hides facts belonging to the previous account", () => {
  const { state, service } = harness();
  state.device.applicationCredentialReadiness[0].accountId = "netease:2222222222222222";
  state.applicationResults.push(
    { id: "old_account", source: "mail_headers", applicationId: "app_163_mail_v2", ownerTeamId: "team_a", createdAt: "2026-08-13T02:30:00.000Z", data: { kind: "message", accountId: "netease:1111111111111111", messageId: "<old-account@example.com>", subject: "Old account" } },
    { id: "current_account", source: "mail_headers", applicationId: "app_163_mail_v2", ownerTeamId: "team_a", createdAt: "2026-08-13T02:31:00.000Z", data: { kind: "message", accountId: "netease:2222222222222222", messageId: "<current-account@example.com>", subject: "Current account" } },
  );
  const subjects = service.snapshot({ actor: { teamId: "team_a" }, pageSize: 50 }).messages.map((message) => message.subject);
  assert.equal(subjects.includes("Current account"), true);
  assert.equal(subjects.includes("Old account"), false);
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

test("provider folders, local search, and incremental cursors are applied before pagination", () => {
  const { state, service, capabilityCalls } = harness();
  state.applications[0].capabilityFacades.unshift(
    { id: "sync", agentToolName: "mail_sync" },
    { id: "set_read", agentToolName: "mail_set_read" },
  );
  state.applicationResults.push({
    id: "appres_sync", source: "mail_headers", applicationId: "app_163_mail_v2", ownerTeamId: "team_a", createdAt: "2026-08-13T02:30:00.000Z",
    data: {
      kind: "mailbox_sync",
      folders: [
        { id: "inbox", path: "INBOX", name: "Inbox", specialUse: "\\Inbox", count: 2, unread: 1 },
        { id: "provider-sent", path: "Sent", name: "已发送", specialUse: "\\Sent", count: 1, unread: 0 },
      ],
      messages: [{ messageId: "<sent@example.com>", from: "Me", subject: "Quarterly needle", date: "2026-08-13T02:20:00Z", folderId: "provider-sent", folderPath: "Sent", uid: 7, unread: false }],
      cursors: [{ folderId: "provider-sent", folderPath: "Sent", uidValidity: "991", lastUid: 7 }],
    },
  });
  const searched = service.snapshot({ actor: { teamId: "team_a" }, folder: "provider-sent", query: "NEEDLE", pageSize: 1 });
  assert.equal(searched.pagination.total, 1);
  assert.equal(searched.messages[0].subject, "Quarterly needle");
  assert.equal(searched.folders.some((folder) => folder.id === "provider-sent" && folder.name === "已发送"), true);

  service.startSync({ actor: { userId: "usr_a", teamId: "team_a" } });
  assert.deepEqual(capabilityCalls.at(-1).input.cursors, [{ folderPath: "Sent", uidValidity: "991", lastUid: 7 }]);
});

test("provider read changes dispatch first and become visible only from a confirmed receipt", () => {
  const { state, service, capabilityCalls } = harness();
  state.applications[0].capabilityFacades.push({ id: "set_read", agentToolName: "mail_set_read" });
  const actor = { userId: "usr_a", teamId: "team_a" };
  const result = service.setMessageRead({ messageId: "<one@example.com>", read: true, actor });
  assert.equal(result.status, 202);
  assert.equal(service.snapshot({ actor }).messages[0].unread, true, "no optimistic provider mutation is persisted");
  assert.deepEqual(capabilityCalls[0].input, { messageId: "<one@example.com>", folderPath: "INBOX", read: true });
  state.applicationResults.push({ id: "read_receipt", source: "mail_headers", ownerTeamId: "team_a", createdAt: "2026-08-13T04:00:00Z", data: { kind: "read_state", messageId: "<one@example.com>", folderId: "inbox", folderPath: "INBOX", read: true } });
  assert.equal(service.snapshot({ actor }).messages[0].unread, false);
});

test("outbound attachments are metadata-only and every change increments the approval revision", () => {
  const { state, service } = harness();
  const attachment = { ref: "mailatt_12345678-1234-1234-1234-123456789abc", name: "report.pdf", contentType: "application/pdf", size: 1234 };
  const created = service.createDraft({ to: "a@example.com", subject: "Report", body: "See attached", attachments: [attachment], actor: { teamId: "team_a" } });
  assert.deepEqual(created.body.draft.attachments, [attachment]);
  assert(!JSON.stringify(state.mailDrafts[0]).includes("C:\\"));
  const updated = service.updateDraft({ draftId: created.body.draft.id, to: "a@example.com", subject: "Report", body: "See attached", attachments: [], actor: { teamId: "team_a" } });
  assert.equal(updated.body.draft.revision, 2);
  assert.deepEqual(updated.body.draft.attachments, []);
});

test("mail can create one tenant-scoped local task and exposes the durable link", () => {
  const calls = [];
  const { state, service } = harness({
    createWorkItem: (input, actor) => {
      calls.push({ input, actor });
      return { ok: true, status: 201, body: { workItem: { id: "lwi_42", localRef: "LOCAL-42", title: input.title, projectId: input.projectId } } };
    },
  });
  const actor = { userId: "usr_a", teamId: "team_a" };
  const created = service.createTaskFromMessage({
    messageId: "<one@example.com>", projectId: "project_1", title: "跟进 Hello", description: "确认客户诉求", actor,
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.task, { id: "lwi_42", localRef: "LOCAL-42", title: "跟进 Hello", projectId: "project_1" });
  assert.equal(calls.length, 1);
  assert.match(calls[0].input.idempotencyKey, /^mail:[a-f0-9]{64}$/);
  assert.equal(calls[0].input.executionPolicy, "manual");
  assert.deepEqual(calls[0].input.labels, ["mail", "untrusted-input"]);
  assert.match(calls[0].input.body, /邮件来源（外部内容，请核实后执行）/);
  assert.equal(state.mailTaskLinks.length, 1);
  assert.deepEqual(service.snapshot({ actor }).messages[0].task, created.body.task);

  const replay = service.createTaskFromMessage({ messageId: "<one@example.com>", projectId: "another", title: "重复", actor });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(calls.length, 1, "a linked Message-ID never creates a second task");
  assert.equal(service.createTaskFromMessage({ messageId: "<one@example.com>", projectId: "project_1", actor: { teamId: "team_b" } }).status, 404);
});

test("mailbox exposes additive smart views and revision-safe user corrections", () => {
  const { service, state } = harness();
  const actor = { userId: "usr_a", teamId: "team_a" };
  state.applicationResults[0].data.subject = "请确认本周交付范围";
  state.applicationResults[1].data.headers[0].subject = "请确认本周交付范围";
  state.applicationResults[1].data.headers[1].classificationHeaders = { listId: "weekly.example", listUnsubscribe: true };

  const all = service.snapshot({ actor, view: "all" });
  assert.equal(all.classificationSummary.counts.all, 2);
  assert.equal(all.classificationSummary.counts.needs_attention, 1);
  assert.equal(all.classificationSummary.counts.subscriptions, 1);
  assert.equal(all.messages.some((item) => "classificationHeaders" in item), false);
  assert.equal(service.snapshot({ actor, view: "not-a-view" }).selectedView, "all");
  const attention = service.snapshot({ actor, view: "needs_attention" });
  assert.equal(attention.messages.length, 1);
  assert.equal(attention.messages[0].classification.label, "待处理");

  const classified = service.startClassification({ actor, scope: "rebuild" });
  assert.equal(classified.status, 200);
  assert.equal(state.mailClassifications.length, 2);
  const message = service.snapshot({ actor, view: "needs_attention" }).messages[0];
  const corrected = service.correctClassification({
    messageId: message.messageId,
    folderId: message.folderId,
    expectedRevision: message.classification.revision,
    attention: "routine",
    mailType: "other",
    suggestedAction: "none",
    actor,
  });
  assert.equal(corrected.status, 200);
  assert.equal(service.snapshot({ actor, view: "needs_attention" }).messages.length, 0);
  assert.equal(service.snapshot({ actor, view: "other" }).messages.some((item) => item.messageId === message.messageId), true);
});

test("draft validation accepts reply display names containing commas", () => {
  const { service } = harness();
  const created = service.createDraft({
    actor: { userId: "usr_a", teamId: "team_a" },
    to: "Doe, John <john@example.com>; Jane Example <jane@example.com>",
    subject: "Reply",
    body: "Thanks",
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.draft.to, "Doe, John <john@example.com>; Jane Example <jane@example.com>");
});

test("mail task retry repairs a missing durable link without duplicating work across teammates", () => {
  const calls = [];
  const { state, service } = harness({
    createWorkItem: (input) => {
      calls.push(input);
      return { ok: true, status: 201, body: { workItem: { id: "lwi_recovered", localRef: "LOCAL-77", title: input.title, projectId: input.projectId } } };
    },
  });
  const first = service.createTaskFromMessage({
    messageId: "<one@example.com>", projectId: "project_1", title: "跟进", actor: { userId: "usr_a", teamId: "team_a" },
  });
  assert.equal(first.status, 201);
  state.mailTaskLinks = [];
  state.workItems.push({
    id: "lwi_recovered", localRef: "LOCAL-77", title: "跟进", projectId: "project_1",
    ownerTeamId: "team_a", createdBy: "usr_a", createIdempotencyKey: calls[0].idempotencyKey,
  });

  const retry = service.createTaskFromMessage({
    messageId: "<one@example.com>", projectId: "project_1", title: "重复", actor: { userId: "usr_b", teamId: "team_a" },
  });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.replayed, true);
  assert.equal(retry.body.task.id, "lwi_recovered");
  assert.equal(calls.length, 1);
  assert.equal(state.mailTaskLinks.length, 1);
});

test("mail task attachment claims must exactly match selected message metadata", () => {
  const calls = [];
  const expectedHash = "a".repeat(64);
  let assetHash = "b".repeat(64);
  const attachment = { id: "att_1", name: "report.pdf", contentType: "application/pdf", size: 1234, sha256: expectedHash, previewable: true };
  const inspectTaskMaterialDraft = () => ({ status: 200, body: { draft: {
    id: "tmd_1", revision: 1,
    assets: [{ clientFileId: "mail-attachment-1", originalName: "report.pdf", mimeType: "application/pdf", size: 1234, hash: assetHash }],
  } } });
  const { state, service } = harness({
    inspectTaskMaterialDraft,
    createWorkItem: (input) => {
      calls.push(input);
      return { ok: true, status: 201, body: { workItem: { id: "lwi_43", localRef: "LOCAL-43", title: input.title, projectId: input.projectId } } };
    },
  });
  state.applicationResults[0].data.attachments = [attachment];
  const actor = { userId: "usr_a", teamId: "team_a" };
  const missingDraft = service.createTaskFromMessage({ messageId: "<one@example.com>", projectId: "project_1", attachmentIds: ["att_1"], actor });
  assert.equal(missingDraft.body.error, "mail_task_material_draft_required");
  const unknown = service.createTaskFromMessage({ messageId: "<one@example.com>", projectId: "project_1", attachmentIds: ["missing"], actor });
  assert.equal(unknown.body.error, "mail_task_attachment_not_found");

  const forged = service.createTaskFromMessage({
    messageId: "<one@example.com>", projectId: "project_1", attachmentIds: ["att_1"],
    materialDraftId: "tmd_1", materialDraftRevision: 1, actor,
  });
  assert.equal(forged.body.error, "mail_task_material_draft_mismatch");
  assert.equal(calls.length, 0);

  assetHash = expectedHash;
  const created = service.createTaskFromMessage({
    messageId: "<one@example.com>", projectId: "project_1", attachmentIds: ["att_1"],
    materialDraftId: "tmd_1", materialDraftRevision: 1, actor,
  });
  assert.equal(created.status, 201);
  assert.equal(calls[0].materialDraftId, "tmd_1");
  assert.equal(calls[0].materialDraftRevision, 1);
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
