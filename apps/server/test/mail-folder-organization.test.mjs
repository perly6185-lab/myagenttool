import assert from "node:assert/strict";
import test from "node:test";

import {
  createMailFolderOrganizationService,
  isMailAutomaticOrganizationEnabled,
  isMailOrganizationEnabled,
} from "../src/services/mail-folder-organization.mjs";

function harness({ enabled = true, automaticEnabled = true, receipt = null, qualityHealthy = true, previewPurpose = "manual" } = {}) {
  let sequence = 0;
  const events = [];
  const started = [];
  const preview = { id: "preview_1", suggestionId: "suggestion_1", classificationRuleId: "rule_1", classificationRuleRevision: 3, purpose: previewPurpose, status: "previewed", revision: 1 };
  const state = {
    applications: [{ id: "app_read", source: { credential: { provider: "netease", scope: "imap.mail" } } }, {
      id: "app_organize", status: "registered", source: { credential: { provider: "netease", scope: "imap.organize" } },
      capabilityFacades: [{ id: "organize", agentId: "agent_organize", agentToolName: "mail_organize_batch" }],
    }],
    mailFolderMovePreviews: [preview], mailFolderMoveJobs: [],
  };
  const invocation = { id: "inv_1", status: "queued", options: null };
  const automaticMessages = [{ messageKey: "key_m1", messageId: "m1", sourceFolderPath: "INBOX" }];
  let preparedMessages = automaticMessages;
  const createService = (serviceState) => createMailFolderOrganizationService({
    state: serviceState, now: () => "2026-08-17T10:00:00.000Z", nextId: (prefix) => `${prefix}_${++sequence}`,
    appendEvent: (event) => events.push(event), enabled: () => enabled, automaticEnabled: () => automaticEnabled,
    folderSuggestionService: {
      createAutomaticPreview: ({ excludedMessageKeys } = {}) => {
        preparedMessages = automaticMessages.filter((item) => !excludedMessageKeys?.has(item.messageKey));
        return preparedMessages.length
          ? { status: 201, body: { preview: { id: preview.id } } }
          : { status: 409, body: { error: "mail_folder_preview_has_no_recoverable_messages" } };
      },
      inspectAutomaticPreview: () => ({ status: 200, body: { dryRun: { accountId: "app_read", selectedCount: 1, matchedCount: 3, excludedCount: 2, exclusions: { protected: 1, batchLimit: 1 }, exclusionReasons: ["protected_message", "batch_limit"] } } }),
      createRecoveryPreview: () => ({ status: 201, body: { preview: { id: "recovery_preview", purpose: "recovery" } } }),
      prepareExecution: () => preview.status !== "previewed" ? { ok: false, status: 409, body: { error: "mail_folder_preview_not_executable" } } : ({ ok: true, preview, execution: {
      accountId: "app_read", approvalTarget: "preview_1@1:fingerprint",
      destination: { kind: "new", folderId: null, folderPath: null, name: null, category: "subscriptions" },
      destinationName: "Subscriptions",
      messages: preparedMessages,
    } }),
    },
    qualitySummary: () => qualityHealthy ? { status: "healthy", sampleSize: 50, signals: [], organization: { status: "healthy", completedBatches: 10, unconfirmedBatches: 0, unconfirmedRate: 0, minimumSample: 10 } } : { status: "collecting", sampleSize: 2, signals: ["insufficient_sample"], organization: { status: "collecting", completedBatches: 1 } },
    validateApprovalToken: (token, binding) => token === "grant" && ["mail.organize", "mail.organize.auto"].includes(binding.action) && binding.targetId === "preview_1@1:fingerprint" ? { approved: true, grantId: "grant_1" } : { approved: false, reason: "grant_required" },
    findApplication: (id) => id === "app_organize" ? { ...serviceState.applications[1], credentialReadiness: { status: "authorized" } } : null,
    findAgent: () => ({ id: "agent_organize", status: "available", adapter: { allowedTools: ["mail_organize_batch"] } }),
    createInvocation: (_task, _agent, options) => { invocation.options = options; return invocation; },
    startInvocationIfAllowed: (value) => started.push(value.id),
  });
  const service = createService(state);
  return {
    service, state, preview, invocation, events, started, receipt, automaticMessages,
    restart: () => {
      const restartedState = structuredClone(state);
      return { state: restartedState, service: createService(restartedState) };
    },
  };
}

test("a fresh, granted preview dispatches only its server-derived batch", () => {
  const fx = harness();
  const result = fx.service.start({ previewId: "preview_1", approvalToken: "grant", actor: { teamId: "team_local", userId: "user_1" } });
  assert.equal(result.status, 202);
  assert.deepEqual(fx.invocation.options.toolArguments, {
    destinationFolderPath: null, destinationName: "Subscriptions",
    messages: [{ messageId: "m1", sourceFolderPath: "INBOX" }],
  });
  assert.equal(fx.state.mailFolderMoveJobs[0].status, "moving");
  assert.equal(fx.preview.status, "executing");
  assert.deepEqual(fx.started, ["inv_1"]);
});

test("explicit stable automation uses standing authorization and remains bounded", () => {
  const fx = harness({ previewPurpose: "automatic" });
  const enabled = fx.service.enableAutomation({ previewId: "preview_1", approvalToken: "grant", confirmed: true, actor: { teamId: "team_local", userId: "user_1" } });
  assert.equal(enabled.status, 201);
  assert.equal(fx.state.mailFolderAutomations[0].status, "active");
  assert.equal(fx.state.mailFolderAutomations[0].batchSize, 10);
  fx.preview.status = "previewed";
  const run = fx.service.runAutomations({ messages: [], folders: [], actor: { teamId: "team_local", userId: "system_mail_automation" } });
  assert.equal(run.status, 202);
  assert.equal(fx.state.mailFolderMoveJobs[0].mode, "automatic");
  assert.equal(fx.state.mailFolderMoveJobs[0].automationId, fx.state.mailFolderAutomations[0].id);
  assert.equal(fx.state.mailFolderMoveJobs[0].authorizationId, fx.state.mailFolderAutomations[0].id);
});

test("automation cannot be enabled before both quality gates are healthy", () => {
  const fx = harness({ qualityHealthy: false, previewPurpose: "automatic" });
  const result = fx.service.enableAutomation({ previewId: "preview_1", approvalToken: "grant", confirmed: true, actor: { teamId: "team_local" } });
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "mail_folder_automation_quality_gate");
  assert.equal(fx.state.mailFolderAutomations.length, 0);
});

test("automatic organization has an independent default-off gate", () => {
  const fx = harness({ automaticEnabled: false, previewPurpose: "automatic" });
  const result = fx.service.enableAutomation({ previewId: "preview_1", approvalToken: "grant", confirmed: true, actor: { teamId: "team_local" } });
  assert.equal(result.status, 403);
  assert.equal(result.body.error, "mail_folder_automation_disabled");
  assert.equal(fx.state.mailFolderAutomations.length, 0);
});

test("feature flag and issued-grant gates fail closed before dispatch", () => {
  assert.equal(harness({ enabled: false }).service.start({ previewId: "preview_1", approvalToken: "grant" }).body.error, "mail_organization_disabled");
  const fx = harness();
  const result = fx.service.start({ previewId: "preview_1", approvalToken: "free text", actor: { teamId: "team_local" } });
  assert.equal(result.body.error, "approval_required");
  assert.equal(fx.state.mailFolderMoveJobs.length, 0);
});

test("a complete receipt succeeds while a partial receipt is unconfirmed and never replayable", () => {
  const complete = harness();
  complete.service.start({ previewId: "preview_1", approvalToken: "grant", actor: { teamId: "team_local" } });
  complete.invocation.status = "succeeded";
  complete.service.recordResult({ invocation: complete.invocation, result: { output: { organization: { destinationFolderPath: "Subscriptions", requestedCount: 1, moved: ["m1"], missing: [] } } } });
  assert.equal(complete.state.mailFolderMoveJobs[0].status, "succeeded");
  assert.equal(complete.preview.status, "succeeded");

  const partial = harness();
  partial.service.start({ previewId: "preview_1", approvalToken: "grant", actor: { teamId: "team_local" } });
  partial.invocation.status = "succeeded";
  partial.service.recordResult({ invocation: partial.invocation, result: { output: { organization: { destinationFolderPath: "Subscriptions", requestedCount: 1, moved: [], missing: ["m1"] } } } });
  assert.equal(partial.state.mailFolderMoveJobs[0].status, "unconfirmed");
  assert.equal(partial.service.start({ previewId: "preview_1", approvalToken: "grant", actor: { teamId: "team_local" } }).body.error, "mail_folder_preview_not_executable");
});

test("jobs are tenant scoped", () => {
  const fx = harness();
  const started = fx.service.start({ previewId: "preview_1", approvalToken: "grant", actor: { teamId: "team_local" } });
  assert.equal(fx.service.get({ jobId: started.body.job.id, actor: { teamId: "team_b" } }).status, 404);
});

test("organization applications cannot cross tenant boundaries", () => {
  const fx = harness();
  fx.state.applications[1].ownerTeamId = "team_other";
  const result = fx.service.start({ previewId: "preview_1", approvalToken: "grant", actor: { teamId: "team_local" } });
  assert.equal(result.body.error, "mail_organize_application_not_available");
  assert.equal(fx.state.mailFolderMoveJobs.length, 0);
});

test("restart recovery makes an in-flight move unconfirmed instead of retrying it", () => {
  const state = {
    mailFolderMovePreviews: [{ id: "preview_1", status: "executing", revision: 2 }],
    mailFolderMoveJobs: [{
      id: "job_1", ownerTeamId: "team_local", previewId: "preview_1",
      status: "moving", revision: 1, updatedAt: null, completedAt: null,
    }],
  };
  createMailFolderOrganizationService({
    state,
    now: () => "2026-08-17T10:00:00.000Z",
    nextId: () => "unused",
  });
  assert.equal(state.mailFolderMoveJobs[0].status, "unconfirmed");
  assert.equal(state.mailFolderMoveJobs[0].error, "interrupted_on_restart");
  assert.equal(state.mailFolderMovePreviews[0].status, "unconfirmed");
  const revisionAfterFirstCheck = state.mailFolderMoveJobs[0].revision;
  createMailFolderOrganizationService({ state, now: () => "2026-08-17T10:01:00.000Z", nextId: () => "unused" });
  assert.equal(state.mailFolderMoveJobs[0].revision, revisionAfterFirstCheck, "a later startup only audits the already-unconfirmed job");
});

test("rollout flags open manual and automatic organization independently per account", () => {
  const previous = {
    legacy: process.env.MYAGENTTOOL_MAIL_ORGANIZE_ENABLED,
    manual: process.env.MYAGENTTOOL_MAIL_ORGANIZE_MANUAL_ENABLED,
    automatic: process.env.MYAGENTTOOL_MAIL_ORGANIZE_AUTO_ENABLED,
    accounts: process.env.MYAGENTTOOL_MAIL_ORGANIZE_AUTO_ACCOUNTS,
  };
  try {
    delete process.env.MYAGENTTOOL_MAIL_ORGANIZE_ENABLED;
    delete process.env.MYAGENTTOOL_MAIL_ORGANIZE_MANUAL_ENABLED;
    delete process.env.MYAGENTTOOL_MAIL_ORGANIZE_AUTO_ENABLED;
    delete process.env.MYAGENTTOOL_MAIL_ORGANIZE_AUTO_ACCOUNTS;
    assert.equal(isMailOrganizationEnabled(), false);
    assert.equal(isMailAutomaticOrganizationEnabled("mail_a"), false);
    process.env.MYAGENTTOOL_MAIL_ORGANIZE_AUTO_ENABLED = "1";
    assert.equal(isMailAutomaticOrganizationEnabled("mail_a"), false, "automatic rollout depends on the manual stage");
    process.env.MYAGENTTOOL_MAIL_ORGANIZE_MANUAL_ENABLED = "1";
    assert.equal(isMailOrganizationEnabled(), true);
    assert.equal(isMailAutomaticOrganizationEnabled("mail_a"), true);
    process.env.MYAGENTTOOL_MAIL_ORGANIZE_AUTO_ACCOUNTS = "mail_a, mail_b";
    assert.equal(isMailAutomaticOrganizationEnabled("mail_a"), true);
    assert.equal(isMailAutomaticOrganizationEnabled("mail_c"), false);
  } finally {
    for (const [key, value] of Object.entries({
      MYAGENTTOOL_MAIL_ORGANIZE_ENABLED: previous.legacy,
      MYAGENTTOOL_MAIL_ORGANIZE_MANUAL_ENABLED: previous.manual,
      MYAGENTTOOL_MAIL_ORGANIZE_AUTO_ENABLED: previous.automatic,
      MYAGENTTOOL_MAIL_ORGANIZE_AUTO_ACCOUNTS: previous.accounts,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("an unconfirmed batch reconciles after sync and retries only messages still in the source", () => {
  const fx = harness();
  fx.service.start({ previewId: "preview_1", approvalToken: "grant", actor: { teamId: "team_local" } });
  fx.invocation.status = "succeeded";
  fx.service.recordResult({ invocation: fx.invocation, result: { output: { organization: { requestedCount: 1, moved: [], missing: ["m1"], conflicts: [] } } } });
  const job = fx.state.mailFolderMoveJobs[0];
  assert.equal(job.status, "unconfirmed");
  const reconciled = fx.service.reconcile({ jobId: job.id, messages: [{ messageId: "m1", folderPath: "INBOX", folderId: "inbox" }], actor: { teamId: "team_local" } });
  assert.equal(reconciled.body.job.status, "recoverable");
  assert.equal(reconciled.body.job.pendingCount, 1);
  assert.equal(reconciled.body.job.items[0].reason, "still_in_source");
  const recovery = fx.service.createRecoveryPreview({ jobId: job.id, messages: [], folders: [], actor: { teamId: "team_local" } });
  assert.equal(recovery.status, 201);
  assert.equal(recovery.body.preview.purpose, "recovery");
});

test("provider conflicts pause automatic rules and require reauthorization", () => {
  const fx = harness({ previewPurpose: "automatic" });
  fx.service.enableAutomation({ previewId: "preview_1", approvalToken: "grant", confirmed: true, actor: { teamId: "team_local" } });
  fx.preview.status = "previewed";
  fx.service.runAutomations({ messages: [], folders: [], actor: { teamId: "team_local" } });
  fx.invocation.status = "succeeded";
  fx.service.recordResult({ invocation: fx.invocation, result: { output: { organization: { requestedCount: 1, moved: [], missing: [], conflicts: [{ messageId: "m1", reason: "message_id_ambiguous" }] } } } });
  assert.equal(fx.state.mailFolderMoveJobs[0].conflictType, "provider_conflict");
  assert.equal(fx.state.mailFolderAutomations[0].status, "paused");
  assert.equal(fx.state.mailFolderAutomations[0].pauseReason, "provider_conflict");
  const resumed = fx.service.updateAutomation({ automationId: fx.state.mailFolderAutomations[0].id, expectedRevision: fx.state.mailFolderAutomations[0].revision, action: "resume", messages: [], actor: { teamId: "team_local" } });
  assert.equal(resumed.body.error, "mail_folder_automation_reauthorization_required");
});

test("a timed-out automatic invocation becomes unconfirmed and pauses instead of replaying", () => {
  const fx = harness({ previewPurpose: "automatic" });
  fx.service.enableAutomation({ previewId: "preview_1", approvalToken: "grant", confirmed: true, actor: { teamId: "team_local" } });
  fx.preview.status = "previewed";
  fx.service.runAutomations({ messages: [], folders: [], accountId: "app_read", triggerId: "sync_timeout", actor: { teamId: "team_local" } });
  fx.invocation.status = "timed_out";
  fx.service.reconcileTermination(fx.invocation);
  assert.equal(fx.state.mailFolderMoveJobs[0].status, "unconfirmed");
  assert.equal(fx.state.mailFolderMoveJobs[0].conflictType, "provider_failure");
  assert.equal(fx.state.mailFolderAutomations[0].status, "paused");
  assert.equal(fx.state.mailFolderAutomations[0].pauseReason, "provider_failure");
  assert.equal(fx.started.length, 1);
});

test("concurrent and repeated sync triggers reserve one durable automatic operation", () => {
  const fx = harness({ previewPurpose: "automatic" });
  fx.service.enableAutomation({ previewId: "preview_1", approvalToken: "grant", confirmed: true, actor: { teamId: "team_local" } });
  fx.preview.status = "previewed";
  const first = fx.service.runAutomations({ messages: [], folders: [], triggerId: "sync_1", accountId: "app_read", actor: { teamId: "team_local" } });
  assert.equal(first.body.started, 1);
  const concurrent = fx.service.runAutomations({ messages: [], folders: [], triggerId: "sync_1", accountId: "app_read", actor: { teamId: "team_local" } });
  assert.equal(concurrent.body.started, 0);
  assert.equal(concurrent.body.skipped, "account_busy");
  fx.invocation.status = "succeeded";
  fx.service.recordResult({ invocation: fx.invocation, result: { output: { organization: { destinationFolderPath: "Subscriptions", requestedCount: 1, moved: ["m1"], missing: [], conflicts: [] } } } });
  fx.preview.status = "previewed";
  const replay = fx.service.runAutomations({ messages: [], folders: [], triggerId: "sync_2", accountId: "app_read", actor: { teamId: "team_local" } });
  assert.equal(replay.body.started, 0);
  assert.equal(fx.state.mailFolderMoveJobs.length, 1);
  assert.equal(fx.started.length, 1);
  const automation = fx.service.listAutomations({ actor: { teamId: "team_local" } }).body.automations[0];
  assert.equal(automation.consecutiveSuccessfulBatches, 1);
  assert.equal(automation.lastSuccessfulAt, "2026-08-17T10:00:00.000Z");
});

test("a repeated import with an overlapping batch excludes messages already moved successfully", () => {
  const fx = harness({ previewPurpose: "automatic" });
  fx.service.enableAutomation({ previewId: "preview_1", approvalToken: "grant", confirmed: true, actor: { teamId: "team_local" } });
  fx.preview.status = "previewed";
  fx.service.runAutomations({ messages: [], folders: [], accountId: "app_read", actor: { teamId: "team_local" } });
  fx.invocation.status = "succeeded";
  fx.service.recordResult({ invocation: fx.invocation, result: { output: { organization: { destinationFolderPath: "Subscriptions", requestedCount: 1, moved: ["m1"], missing: [], conflicts: [] } } } });
  assert.equal(fx.state.mailFolderMoveDeduplication.length, 1);
  fx.automaticMessages.push({ messageKey: "key_m2", messageId: "m2", sourceFolderPath: "INBOX" });
  fx.preview.status = "previewed";
  fx.invocation.status = "queued";
  const restarted = fx.restart();
  const repeated = restarted.service.runAutomations({ messages: [], folders: [], accountId: "app_read", actor: { teamId: "team_local" } });
  assert.equal(repeated.body.started, 1);
  assert.deepEqual(restarted.state.mailFolderMoveJobs[0].items.map((item) => item.messageId), ["m2"]);
});

test("job retention never evicts moving or unresolved work", () => {
  const fx = harness({ previewPurpose: "automatic" });
  fx.state.mailFolderMoveJobs = Array.from({ length: 200 }, (_, index) => ({
    id: index === 199 ? "unresolved" : `done_${index}`,
    ownerTeamId: "team_local",
    accountId: "app_read",
    status: index === 199 ? "unconfirmed" : "succeeded",
    mode: "manual",
  }));
  fx.service.enableAutomation({ previewId: "preview_1", approvalToken: "grant", confirmed: true, actor: { teamId: "team_local" } });
  fx.preview.status = "previewed";
  fx.service.runAutomations({ messages: [], folders: [], accountId: "app_read", actor: { teamId: "team_local" } });
  assert.equal(fx.state.mailFolderMoveJobs.some((job) => job.id === "unresolved"), true);
});

test("a disabled rollout reports active rules as paused and rejects resume", () => {
  const fx = harness({ automaticEnabled: false, previewPurpose: "automatic" });
  fx.state.mailFolderAutomations = [{
    id: "auto_existing", ownerTeamId: "team_local", accountId: "app_read",
    status: "active", pauseReason: null, revision: 2, destination: { kind: "new", category: "subscriptions" },
  }];
  const listed = fx.service.listAutomations({ actor: { teamId: "team_local" } }).body.automations[0];
  assert.equal(listed.status, "paused");
  assert.equal(listed.pauseReason, "rollout_disabled");
  assert.equal(listed.nextAction, "enable_rollout");
  fx.state.mailFolderAutomations[0].status = "paused";
  fx.state.mailFolderAutomations[0].pauseReason = "user_paused";
  const pausedWhileDisabled = fx.service.listAutomations({ actor: { teamId: "team_local" } }).body.automations[0];
  assert.equal(pausedWhileDisabled.pauseReason, "rollout_disabled");
  const resumed = fx.service.updateAutomation({ automationId: "auto_existing", expectedRevision: 2, action: "resume", actor: { teamId: "team_local" } });
  assert.equal(resumed.status, 403);
  assert.equal(resumed.body.error, "mail_folder_automation_disabled");
});

test("dry run reports bounded exclusions without creating a job or calling the provider", () => {
  const fx = harness({ previewPurpose: "automatic" });
  const enabled = fx.service.enableAutomation({ previewId: "preview_1", approvalToken: "grant", confirmed: true, actor: { teamId: "team_local" } });
  const before = fx.service.listAutomations({ actor: { teamId: "team_local" } }).body.automations[0];
  const result = fx.service.dryRunAutomation({ automationId: enabled.body.automation.id, actor: { teamId: "team_local" } });
  const after = fx.service.listAutomations({ actor: { teamId: "team_local" } }).body.automations[0];
  assert.equal(result.status, 200);
  assert.equal(result.body.dryRun.providerCalled, false);
  assert.equal(result.body.dryRun.successCountersChanged, false);
  assert.equal(result.body.dryRun.selectedCount, 1);
  assert.equal(result.body.dryRun.excludedCount, 2);
  assert.equal(fx.state.mailFolderMoveJobs.length, 0);
  assert.equal(fx.started.length, 0);
  assert.equal(after.consecutiveSuccessfulBatches, before.consecutiveSuccessfulBatches);
  assert.equal(after.revision, before.revision);
});
