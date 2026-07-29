import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { createPersistenceRuntime } from "../src/runtime/persistence.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import { sameProjectPath } from "../src/services/projects.mjs";
import {
  backfillWorkItemTerminalOwnership,
  createWorkItemService,
  taskTraceStage,
} from "../src/services/work-items.mjs";

const ACTOR_A = { userId: "usr_a", teamId: "team_a", role: "operator" };
const ACTOR_B = { userId: "usr_b", teamId: "team_b" };
const ACTOR_C = { userId: "usr_c", teamId: "team_a" };

function harness({
  clock = () => "2026-07-24T00:00:00.000Z",
  store,
  persistStateSoon,
  budgetStatusFor = () => null,
  teamBudgetStatusFor = () => null,
  retryAlert = () => null,
  resolveApplicationCapability,
  invokeResolvedCapability,
  issueApplicationApprovalGrant,
} = {}) {
  let counter = 0;
  const events = [];
  const alerts = [];
  const state = {
    devices: [{ id: "dev_local" }],
    workItems: [],
    workItemComments: [],
    workItemActivities: [],
    projects: [
      { id: "prj_a", ownerTeamId: "team_a" },
      { id: "prj_b", ownerTeamId: "team_b" },
    ],
  };
  const service = createWorkItemService({
    state,
    now: clock,
    nextId: (prefix) => `${prefix}_${++counter}`,
    appendEvent: (event) => events.push(event),
    sendAlert: (alert) => {
      alerts.push(alert);
      return Promise.resolve({ sent: true });
    },
    store,
    persistStateSoon,
    budgetStatusFor,
    teamBudgetStatusFor,
    retryAlert,
    resolveApplicationCapability,
    invokeResolvedCapability,
    issueApplicationApprovalGrant,
  });
  return { state, events, alerts, service };
}

test("creates a local work item with server-owned identity and defaults", () => {
  const { service, events, state } = harness();
  const result = service.createWorkItem({
    projectId: "prj_a",
    title: "Local planning",
    ownerTeamId: "team_b",
  }, ACTOR_A);
  assert.equal(result.status, 201);
  assert.equal(result.body.workItem.localRef, "LOCAL-1");
  assert.equal(result.body.workItem.ownerTeamId, "team_a");
  assert.equal(result.body.workItem.createdBy, "usr_a");
  assert.equal(result.body.workItem.status, "backlog");
  assert.equal(result.body.workItem.terminalId, "dev_local");
  assert.equal(result.body.workItem.revision, 1);
  assert.equal(events[0].type, "work_item_created");
  assert.deepEqual(state.workItemActivities[0].details, {
    title: "Local planning",
    type: "task",
    status: "backlog",
    priority: "p2",
    principalId: "usr_a",
    deviceId: "dev_local",
    effectiveAuthority: "operator",
    terminalId: "dev_local",
    entryContext: "task",
    traceParent: result.body.workItem.id,
  });
});

test("local delivery closes only after base integration; pull-request delivery stays in review", () => {
  const { service, state } = harness();
  const created = service.createWorkItem({ projectId: "prj_a", title: "Deliver by PR" }, ACTOR_A).body.workItem;
  state.autoRuns = [{
    id: "aur_local", status: "done", link: { type: "local_issue", number: created.localNumber },
    localDelivery: { worktreeId: "wtr_1", branchName: "local-1" },
  }];
  service.recordExecutionBinding({
    workItemId: created.id, kind: "auto_run", targetId: "aur_local", worktreeId: "wtr_1",
  }, ACTOR_A);
  const item = state.workItems[0];
  item.status = "review";

  const promoted = service.completeDelivery({
    workItemId: item.id,
    expectedRevision: item.revision,
    mode: "pull_request",
    autoRunId: "aur_local",
    result: { number: 14, url: "https://github.test/o/r/pull/14" },
  }, ACTOR_A);
  assert.equal(promoted.status, 200);
  assert.equal(item.status, "review");
  assert.equal(item.state, "open");
  assert.equal(state.autoRuns[0].status, "pr_open");

  const localCreated = service.createWorkItem({ projectId: "prj_a", title: "Deliver locally" }, ACTOR_A).body.workItem;
  state.autoRuns.unshift({
    id: "aur_local_merge", status: "done", link: { type: "local_issue", number: localCreated.localNumber },
    localDelivery: { worktreeId: "wtr_2", branchName: "local-2" },
  });
  service.recordExecutionBinding({
    workItemId: localCreated.id, kind: "auto_run", targetId: "aur_local_merge", worktreeId: "wtr_2",
  }, ACTOR_A);
  const localItem = state.workItems.find((candidate) => candidate.id === localCreated.id);
  localItem.status = "review";
  const delivered = service.completeDelivery({
    workItemId: localItem.id,
    expectedRevision: localItem.revision,
    mode: "local_merge",
    autoRunId: "aur_local_merge",
    result: { baseBranch: "main", commit: "abc123" },
  }, ACTOR_A);
  assert.equal(delivered.status, 200);
  assert.equal(localItem.status, "done");
  assert.equal(localItem.state, "closed");
  assert.equal(state.autoRuns[0].localDelivery.deliveredCommit, "abc123");
});

test("links asset requirements to the owning terminal and exposes waiting capability", () => {
  const { service } = harness();
  const waiting = service.createWorkItem({
    projectId: "prj_a",
    title: "Update workbook",
    inputAssets: [{
      id: "asset-1", path: "reports/input.xlsx", family: "excel",
      terminalId: "dev_local", capabilities: ["preview"],
      readiness: { state: "ready", reason: "available_on_owning_terminal" },
    }],
    requiredCapabilities: ["edit"],
  }, ACTOR_A);
  assert.equal(waiting.status, 201);
  assert.deepEqual(waiting.body.workItem.assetReadiness, {
    state: "waiting_capability",
    reason: "missing_local_capability:edit",
    terminalId: "dev_local",
  });
  assert.equal(waiting.body.workItem.inputAssets[0].path, "reports/input.xlsx");

  const foreign = service.createWorkItem({
    projectId: "prj_a",
    title: "Foreign asset",
    inputAssets: [{
      path: "reports/input.xlsx", terminalId: "dev_other",
      capabilities: ["preview"], readiness: { state: "ready" },
    }],
    requiredCapabilities: ["preview"],
  }, ACTOR_A);
  assert.equal(foreign.status, 409);
  assert.equal(foreign.body.error, "asset_terminal_mismatch");
  assert.equal(foreign.body.terminalId, "dev_local");

  const large = service.createWorkItem({
    projectId: "prj_a",
    title: "Compare large local images",
    inputAssets: [{
      id: "asset-large", path: "media/source.png", family: "image",
      terminalId: "dev_local", size: 120 * 1024 * 1024, resourceClass: "large",
      capabilities: ["compare"], readiness: { state: "ready" },
    }],
    requiredCapabilities: ["compare"],
  }, ACTOR_A);
  assert.equal(large.status, 201);
  assert.equal(large.body.workItem.assetReadiness.state, "waiting_capability");
  assert.equal(large.body.workItem.assetReadiness.reason, "local_resource_class_required:large");
  assert.equal(large.body.workItem.assetReadiness.terminalId, "dev_local");
});

test("backfills legacy work items and rejects terminal ownership changes", () => {
  const state = {
    devices: [{ id: "dev_local" }],
    agents: [{ id: "agt", location: { type: "local_device", deviceId: "dev_agent" } }],
    invocations: [{ id: "inv", agentId: "agt", delivery: { deviceId: "dev_agent" } }],
    autoRuns: [{ id: "run", invocationId: "inv" }],
    approvalRequests: [{ id: "approval", invocationId: "inv" }],
    auditSummaries: [{ invocationId: "inv", deviceId: "dev_agent" }],
    workItems: [
      { id: "legacy", executionBindings: [{ kind: "auto_run", targetId: "run" }] },
      { id: "owned", terminalId: "dev_existing" },
    ],
  };
  assert.equal(backfillWorkItemTerminalOwnership(state), 6);
  assert.equal(state.workItems[0].terminalId, "dev_local");
  assert.equal(state.workItems[0].executionBindings[0].terminalId, "dev_local");
  assert.equal(state.workItems[1].terminalId, "dev_existing");
  assert.equal(state.invocations[0].terminalId, "dev_agent");
  assert.equal(state.autoRuns[0].terminalId, "dev_agent");
  assert.equal(state.approvalRequests[0].terminalId, "dev_agent");
  assert.equal(state.auditSummaries[0].terminalId, "dev_agent");
  assert.equal(backfillWorkItemTerminalOwnership(state), 0);

  const { service } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "Pinned task" }, ACTOR_A).body.workItem;
  const result = service.updateWorkItem({
    workItemId: item.id,
    expectedRevision: item.revision,
    terminalId: "dev_other",
  }, ACTOR_A);
  assert.equal(result.status, 409);
  assert.equal(result.body.error, "work_item_terminal_immutable");
  assert.equal(result.body.terminalId, "dev_local");
  assert.equal(service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.workItem.revision, 1);
});

test("normalizes task trace events into the user execution chain", () => {
  assert.equal(taskTraceStage("created"), "creation");
  assert.equal(taskTraceStage("auto_run_started"), "routing");
  assert.equal(taskTraceStage("delivery_queued", "execution"), "queue");
  assert.equal(taskTraceStage("local_approval_requested", "execution"), "approval");
  assert.equal(taskTraceStage("tool_invocation_created", "execution"), "tool");
  assert.equal(taskTraceStage("verification_recorded"), "verification");
  assert.equal(taskTraceStage("auto_run_retry"), "retry");
  assert.equal(taskTraceStage("invocation_completed", "execution"), "completion");
});

test("exposes independent business, planning, and fact-derived execution states", () => {
  const { service, state } = harness();
  const created = service.createWorkItem({
    projectId: "prj_a", title: "Three state model", status: "ready",
  }, ACTOR_A).body.workItem;
  assert.deepEqual(created.statusModel, {
    business: "open", planning: "ready", execution: "unclaimed",
  });
  assert.equal(created.businessState, created.state);
  assert.equal(created.planningStatus, created.status);

  service.claimWorkItem({ workItemId: created.id, agentId: "agt_a" }, ACTOR_A);
  assert.equal(service.getWorkItem({ workItemId: created.id }, ACTOR_A).body.workItem.executionState, "claimed");

  state.workItems[0].executionBindings = [{
    kind: "auto_run", targetId: "ar_1", worktreeId: null, createdAt: "2026-07-24T00:00:00.000Z",
  }];
  state.autoRuns = [{ id: "ar_1", status: "running" }];
  for (const [runStatus, expected] of [
    ["running", "running"],
    ["awaiting_approval", "awaiting_approval"],
    ["verifying", "verifying"],
    ["failed", "failed"],
    ["done", "completed"],
  ]) {
    state.autoRuns[0].status = runStatus;
    assert.equal(
      service.getWorkItem({ workItemId: created.id }, ACTOR_A).body.workItem.executionState,
      expected,
    );
  }
});

test("Entry execution state follows the bound Application invocation lifecycle", () => {
  const { service, state } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "Render evidence" }, ACTOR_A).body.workItem;
  state.workItems[0].executionBindings.push({
    kind: "application_invocation", id: "inv-app", terminalId: "dev_local",
    applicationId: "app-image", capabilityId: "render", traceId: item.id,
    createdAt: "2026-07-24T00:00:00.000Z",
  });
  state.invocations = [{ id: "inv-app", status: "running" }];
  assert.equal(service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.workItem.executionState, "running");
  state.invocations[0].status = "waiting_for_local_approval";
  assert.equal(service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.workItem.executionState, "awaiting_approval");
  state.invocations[0].status = "succeeded";
  assert.equal(service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.workItem.executionState, "completed");
  state.invocations = [];
  assert.equal(service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.workItem.executionState, "failed");
});

test("GitHub sync pulls one-sided changes and exposes two-sided conflicts", () => {
  const { service } = harness();
  let item = service.createWorkItem({ projectId: "prj_a", title: "Initial" }, ACTOR_A).body.workItem;
  const remote = {
    number: 42, title: "Initial", body: "", state: "open", labels: [],
    url: "https://github.com/acme/repo/issues/42", repository: "acme/repo",
    updatedAt: "2026-07-23T20:00:00.000Z",
  };
  assert.equal(service.bindGithubIssue({
    workItemId: item.id, expectedRevision: item.revision, remote,
  }, ACTOR_A).status, 201);
  const pulled = service.syncGithubIssue({
    workItemId: item.id, expectedRevision: item.revision, direction: "pull",
    remote: { ...remote, title: "Remote title", updatedAt: "2026-07-24T01:00:00.000Z" },
  }, ACTOR_A);
  assert.equal(pulled.body.action, "pulled");
  assert.equal(pulled.body.workItem.title, "Remote title");

  item = service.updateWorkItem({
    workItemId: item.id, expectedRevision: pulled.body.workItem.revision, title: "Local title",
  }, ACTOR_A).body.workItem;
  const conflict = service.syncGithubIssue({
    workItemId: item.id, expectedRevision: item.revision, direction: "pull",
    remote: { ...remote, title: "Other remote title", updatedAt: "2026-07-24T02:00:00.000Z" },
  }, ACTOR_A);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, "github_sync_conflict");
  assert.deepEqual(conflict.body.conflict.fields, ["title"]);
  assert.equal(service.syncGithubIssue({
    workItemId: item.id, expectedRevision: item.revision, direction: "push",
  }, ACTOR_A).status, 409);
  const resolved = service.syncGithubIssue({
    workItemId: item.id, expectedRevision: item.revision, direction: "resolve_local",
  }, ACTOR_A);
  assert.equal(resolved.body.action, "push_required");
  assert.equal(resolved.body.payload.title, "Local title");
});

test("GitHub push uses a two-step payload and confirmation baseline", () => {
  const { service } = harness();
  let item = service.createWorkItem({ projectId: "prj_a", title: "Initial" }, ACTOR_A).body.workItem;
  service.bindGithubIssue({
    workItemId: item.id, expectedRevision: item.revision,
    remote: {
      number: 7, title: "Initial", body: "", state: "open", labels: [],
      updatedAt: "2026-07-23T20:00:00.000Z",
    },
  }, ACTOR_A);
  item = service.updateWorkItem({
    workItemId: item.id, expectedRevision: item.revision, title: "Publish me",
  }, ACTOR_A).body.workItem;
  const required = service.syncGithubIssue({
    workItemId: item.id, expectedRevision: item.revision, direction: "push",
  }, ACTOR_A);
  assert.equal(required.body.action, "push_required");
  assert.equal(required.body.payload.title, "Publish me");
  const confirmed = service.syncGithubIssue({
    workItemId: item.id, expectedRevision: item.revision, direction: "push",
    pushedRemoteUpdatedAt: "2026-07-24T03:00:00.000Z",
  }, ACTOR_A);
  assert.equal(confirmed.body.action, "pushed");
});

test("external issue contract supports GitLab and Gitea without overstating adapter capabilities", () => {
  const { service } = harness();
  const providers = service.listExternalProviders().body.providers;
  assert.deepEqual(providers.map(({ id }) => id), ["github", "gitlab", "gitea"]);
  assert.equal(providers.find(({ id }) => id === "gitlab").apiSync, false);
  assert.equal(providers.find(({ id }) => id === "gitea").webhook, false);

  const item = service.createWorkItem({ projectId: "prj_a", title: "Portable issue" }, ACTOR_A).body.workItem;
  const remote = {
    number: 18, title: "Portable issue", body: "", state: "open", labels: ["portable"],
    url: "https://gitlab.example/acme/repo/-/issues/18", repository: "acme/repo",
    updatedAt: "2026-07-23T20:00:00.000Z",
  };
  const linked = service.bindExternalIssue({
    workItemId: item.id, expectedRevision: item.revision, provider: "gitlab", remote,
  }, ACTOR_A);
  assert.equal(linked.status, 201);
  assert.deepEqual({
    kind: linked.body.binding.kind,
    provider: linked.body.binding.provider,
    resourceType: linked.body.binding.resourceType,
    externalId: linked.body.binding.externalId,
  }, {
    kind: "gitlab_issue", provider: "gitlab", resourceType: "issue", externalId: "18",
  });
  assert.equal(linked.body.binding.bindingId, "gitlab:issue:acme/repo:18");

  const pulled = service.syncExternalIssue({
    workItemId: item.id, expectedRevision: item.revision, provider: "gitlab", direction: "pull",
    remote: { ...remote, title: "Updated in GitLab", updatedAt: "2026-07-24T01:00:00.000Z" },
  }, ACTOR_A);
  assert.equal(pulled.body.action, "pulled");
  assert.equal(pulled.body.workItem.title, "Updated in GitLab");
  assert.equal(service.bindExternalIssue({
    workItemId: item.id, expectedRevision: pulled.body.workItem.revision, provider: "bitbucket", remote,
  }, ACTOR_A).body.error, "unsupported_external_provider");
});

test("GitLab and Gitea webhook ingestion is idempotent, tenant-aware, and replayable", () => {
  const { service } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "Webhook portable" }, ACTOR_A).body.workItem;
  const remote = {
    number: 28, title: "Webhook portable", body: "", state: "open", labels: [],
    repository: "acme/repo", updatedAt: "2026-07-24T00:00:00.000Z",
  };
  service.bindExternalIssue({
    workItemId: item.id, expectedRevision: item.revision, provider: "gitea", remote,
  }, ACTOR_A);
  const accepted = service.ingestExternalWebhook({
    provider: "gitea", deliveryId: "delivery-28",
    snapshot: { ...remote, title: "Webhook changed", updatedAt: "2026-07-24T01:00:00.000Z" },
  });
  assert.equal(accepted.status, 202);
  assert.equal(accepted.body.synced, 1);
  assert.equal(service.ingestExternalWebhook({
    provider: "gitea", deliveryId: "delivery-28",
    snapshot: { ...remote, title: "Ignored duplicate", updatedAt: "2026-07-24T02:00:00.000Z" },
  }).body.replayed, true);
  assert.equal(service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.workItem.title, "Webhook changed");
  assert.equal(service.replayExternalWebhook({
    provider: "gitea", deliveryId: "delivery-28",
  }, ACTOR_B).status, 404);
  assert.equal(service.replayExternalWebhook({
    provider: "gitea", deliveryId: "delivery-28",
  }, ACTOR_A).status, 202);
});

test("structured acceptance and verification gate completion", () => {
  const { service } = harness();
  let item = service.createWorkItem({
    projectId: "prj_a", title: "Verified delivery",
    acceptanceCriteria: ["Tests pass", "Docs updated"],
  }, ACTOR_A).body.workItem;
  const blocked = service.updateWorkItem({
    workItemId: item.id, expectedRevision: item.revision, status: "done",
  }, ACTOR_A);
  assert.equal(blocked.status, 409);
  assert.deepEqual(blocked.body.missingCriteria, ["Tests pass", "Docs updated"]);
  assert.equal(blocked.body.verificationRequired, true);

  const recorded = service.recordVerification({
    workItemId: item.id, expectedRevision: item.revision,
    kind: "test", status: "passed", command: "pnpm test", summary: "All suites passed.",
    acceptanceResults: [
      { criterion: "Tests pass", status: "passed", note: "321 tests" },
      { criterion: "Docs updated", status: "passed", note: "README checked" },
    ],
    evidence: [
      { kind: "commit", ref: "abc123", summary: "Implementation" },
      { kind: "log", ref: "run:test-1", summary: "Test output" },
    ],
  }, ACTOR_A);
  assert.equal(recorded.status, 201);
  assert.equal(recorded.body.workItem.completionGate.ready, true);
  assert.equal(recorded.body.workItem.verificationRecords[0].recordedBy, "usr_a");
  item = recorded.body.workItem;
  assert.equal(service.updateWorkItem({
    workItemId: item.id, expectedRevision: item.revision, status: "done",
  }, ACTOR_A).status, 200);
});

test("a combined status and acceptance edit evaluates the candidate completion gate", () => {
  const { service } = harness();
  const item = service.createWorkItem({
    projectId: "prj_a",
    title: "Do not bypass acceptance",
    idempotencyKey: "candidate-gate",
  }, ACTOR_A).body.workItem;

  const blocked = service.updateWorkItem({
    workItemId: item.id,
    expectedRevision: item.revision,
    status: "done",
    acceptanceCriteria: ["Must pass"],
  }, ACTOR_A);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error, "work_item_acceptance_incomplete");

  const current = service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.workItem;
  assert.equal(current.status, "backlog");
  assert.deepEqual(current.acceptanceCriteria, []);
  assert.equal(Object.hasOwn(current, "createIdempotencyKey"), false);

  const closed = service.transitionWorkItem({
    workItemId: item.id,
    expectedRevision: current.revision,
    action: "close",
  }, ACTOR_A);
  assert.equal(Object.hasOwn(closed.body.workItem, "createIdempotencyKey"), false);
});

test("verification rejects unknown criteria and malformed evidence", () => {
  const { service } = harness();
  const item = service.createWorkItem({
    projectId: "prj_a", title: "Evidence", acceptanceCriteria: ["Known"],
  }, ACTOR_A).body.workItem;
  assert.equal(service.recordVerification({
    workItemId: item.id, expectedRevision: item.revision, kind: "test", status: "passed",
    acceptanceResults: [{ criterion: "Unknown", status: "passed" }],
  }, ACTOR_A).body.error, "invalid_work_item_acceptance_result");
  assert.equal(service.recordVerification({
    workItemId: item.id, expectedRevision: item.revision, kind: "test", status: "passed",
    evidence: [{ kind: "secret", ref: "x" }],
  }, ACTOR_A).body.error, "invalid_work_item_evidence");
});

test("cross-asset task trace links Excel input through PowerPoint output to image evidence", () => {
  const { service, events } = harness();
  let item = service.createWorkItem({
    projectId: "prj_a",
    title: "Build a review deck from the workbook",
    acceptanceCriteria: ["Rendered deck evidence is verified"],
    inputAssets: [{
      id: "asset-xlsx", path: "reports/source.xlsx", family: "excel",
      terminalId: "dev_local", hash: "sha256:excel-v1", version: "excel-v1",
      capabilities: ["preview", "inspect", "edit"],
      readiness: { state: "ready", reason: "available_on_owning_terminal" },
    }],
    requiredCapabilities: ["edit"],
  }, ACTOR_A).body.workItem;
  assert.equal(item.assetReadiness.state, "ready");
  const queued = service.claimWorkItem({
    workItemId: item.id, agentId: "agt-office", idempotencyKey: "asset-e2e-queue",
  }, ACTOR_A);
  assert.equal(queued.status, 201);
  item = service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.workItem;
  assert.equal(item.executionState, "claimed");
  assert.equal(item.terminalId, "dev_local");

  const deck = service.recordAssetOperation({
    workItemId: item.id, expectedRevision: item.revision,
    capability: "edit", inputAssetId: "asset-xlsx",
    invocationId: "inv-office-1", approvalId: "apr-office-1",
    applicationResolution: {
      state: "ready", reason: "local_capability_selected", terminalId: "dev_local",
      capability: { applicationId: "app_officecli", displayName: "Update workbook", name: "internal.must-not-render" },
      telemetry: { durationMs: 2.5 },
    },
    summary: "Generated the quarterly review deck from workbook data.",
    outputAsset: {
      id: "asset-pptx", path: "outputs/review.pptx", family: "powerpoint",
      terminalId: "dev_local", hash: "sha256:pptx-v1", version: "pptx-v1",
      capabilities: ["preview", "inspect", "edit", "render", "attach_evidence"],
      readiness: { state: "ready", reason: "available_on_owning_terminal" },
    },
  }, ACTOR_A);
  assert.equal(deck.status, 201);
  assert.equal(deck.body.operation.traceId, item.id);
  assert.equal(deck.body.operation.approvalId, "apr-office-1");
  assert.deepEqual(deck.body.operation.applicationResolution, {
    state: "ready", terminalId: "dev_local", applicationId: "app_officecli",
    label: "Update workbook", reason: "local_capability_selected", durationMs: 2.5,
  });
  item = deck.body.workItem;

  const image = service.recordAssetOperation({
    workItemId: item.id, expectedRevision: item.revision,
    capability: "render", inputAssetId: "asset-pptx",
    invocationId: "inv-render-1", summary: "Rendered a safe review image.",
    outputAsset: {
      id: "asset-image", path: "evidence/review.png", family: "image",
      terminalId: "dev_local", hash: "sha256:image-v1", version: "image-v1",
      capabilities: ["preview", "inspect", "compare", "attach_evidence"],
      readiness: { state: "ready", reason: "available_on_owning_terminal" },
    },
  }, ACTOR_A);
  assert.equal(image.status, 201);
  item = image.body.workItem;

  const previewed = service.recordAssetOperation({
    workItemId: item.id, expectedRevision: item.revision,
    capability: "preview", inputAssetId: "asset-image",
    invocationId: "inv-preview-1", summary: "Previewed the bounded local image.",
  }, ACTOR_A);
  assert.equal(previewed.status, 201);
  item = previewed.body.workItem;

  const verified = service.recordVerification({
    workItemId: item.id, expectedRevision: item.revision,
    kind: "manual", status: "passed", summary: "Deck image reviewed.",
    acceptanceResults: [{
      criterion: "Rendered deck evidence is verified", status: "passed", note: "Image matches source totals.",
    }],
    evidence: [{
      kind: "asset", assetId: "asset-image", ref: "evidence/review.png",
      hash: "sha256:image-v1", version: "image-v1", terminalId: "dev_local",
      summary: "Rendered PowerPoint evidence.",
    }],
  }, ACTOR_A);
  assert.equal(verified.status, 201);
  assert.equal(verified.body.workItem.completionGate.ready, true);
  assert.equal(verified.body.workItem.outputAssets.length, 2);
  assert.equal(verified.body.workItem.verificationRecords[0].evidence[0].assetId, "asset-image");

  const detail = service.getWorkItem({ workItemId: item.id }, ACTOR_A);
  assert.equal(detail.body.observability.executionChainId, item.id);
  assert.ok(detail.body.observability.timeline.some((row) => row.type === "asset_operation_recorded" && row.stage === "tool"));
  assert.ok(detail.body.observability.timeline.some((row) => row.type === "asset_evidence_attached" && row.stage === "verification"));
  assert.equal(events.filter((event) => event.type === "work_item_asset_operation_recorded").length, 3);
  assert.ok(events.every((event) => event.type !== "work_item_asset_operation_recorded"
    || (event.data.traceId === item.id && event.data.terminalId === "dev_local")));
});

test("real task Application execution resolves server-side and stamps immutable task/terminal trace context", () => {
  const invocations = [];
  const resolution = {
    state: "waiting_approval", reason: "capability_requires_approval", terminalId: "dev_local",
    capability: { name: "app.office.apply", displayName: "Update workbook", applicationId: "app_office", riskLevel: "medium" },
    approval: { required: true },
    readiness: { runtime: "ready", credential: { configured: true, scopeMatch: true, expired: false } },
  };
  const { service } = harness({
    resolveApplicationCapability: () => resolution,
    issueApplicationApprovalGrant: (input, actor) => {
      assert.deepEqual(input, { action: "wrapper:apply", targetId: "app_office" });
      assert.equal(actor.userId, "usr_a");
      return { ok: true, status: 201, body: { token: "grant-1", expiresAt: "2026-07-24T00:05:00.000Z" } };
    },
    invokeResolvedCapability: (name, input) => {
      assert.equal(name, "app.office.apply");
      assert.equal(input.projectId, "prj_a");
      assert.equal(input.approvalToken, "grant-1");
      const invocation = { id: "inv-app-1", status: "queued", options: { metadata: {} } };
      invocations.push(invocation);
      return { status: 202, body: { invocation } };
    },
  });
  let item = service.createWorkItem({
    projectId: "prj_a", title: "Update workbook",
    inputAssets: [{
      id: "asset-1", path: "input.xlsx", family: "excel", terminalId: "dev_local",
      hash: "sha256:x", version: "v1", capabilities: ["edit"], readiness: { state: "ready" },
    }],
    requiredCapabilities: ["edit"],
  }, ACTOR_A).body.workItem;
  assert.equal(item.queueReadiness.state, "waiting_approval");
  const blocked = service.startApplicationExecution({
    workItemId: item.id, expectedRevision: item.revision, assetVerb: "edit", assetFamily: "excel",
  }, ACTOR_A);
  assert.equal(blocked.body.error, "approval_required");
  const approval = service.requestApplicationExecutionApproval({
    workItemId: item.id, expectedRevision: item.revision, assetVerb: "edit", assetFamily: "excel",
  }, ACTOR_A);
  assert.equal(approval.status, 201);
  assert.equal(approval.body.approvalToken, "grant-1");
  const started = service.startApplicationExecution({
    workItemId: item.id, expectedRevision: item.revision, assetVerb: "edit", assetFamily: "excel",
    approvalToken: "grant-1", parameters: { operation: "update" },
  }, ACTOR_A);
  assert.equal(started.status, 202);
  assert.equal(invocations[0].options.metadata.applicationExecution.taskId, item.id);
  assert.equal(invocations[0].options.metadata.applicationExecution.terminalId, "dev_local");
  assert.equal(invocations[0].options.metadata.applicationExecution.principalId, "usr_a");
  assert.match(invocations[0].options.metadata.applicationExecution.contractFingerprint, /^sha256:/);
  assert.equal(started.body.workItem.executionBindings.at(-1).id, "inv-app-1");
});

test("task Application execution rejects caller capability overrides before resolution", () => {
  let resolved = false;
  const { service } = harness({
    resolveApplicationCapability: () => { resolved = true; return null; },
  });
  const item = service.createWorkItem({ projectId: "prj_a", title: "Unsafe" }, ACTOR_A).body.workItem;
  const result = service.startApplicationExecution({
    workItemId: item.id, expectedRevision: item.revision, intent: "edit",
    parameters: { command: "rm", applicationId: "attacker-choice" },
  }, ACTOR_A);
  assert.equal(result.body.error, "invalid_application_execution_parameters");
  assert.equal(resolved, false);
});

test("human attention queue aggregates conflicts, approvals, and failed evidence", () => {
  const { service, state } = harness();
  const item = service.createWorkItem({
    projectId: "prj_a", title: "Needs a human", status: "review", acceptanceCriteria: ["Ship safely"],
  }, ACTOR_A).body.workItem;
  state.workItems[0].externalBindings = [{
    kind: "github_issue", number: 3, conflict: { detectedAt: "2026-07-24T01:00:00.000Z", fields: ["title"] },
  }];
  state.workItems[0].executionBindings = [{ kind: "auto_run", targetId: "ar_3" }];
  state.autoRuns = [{
    id: "ar_3", status: "awaiting_approval", createdAt: "2026-07-24T00:30:00.000Z",
  }];
  state.workItems[0].verificationRecords = [{
    id: "wvr_bad", status: "failed", summary: "Tests failed", recordedAt: "2026-07-24T00:45:00.000Z",
  }];
  state.planningProjects = [{
    id: "plan_1", name: "Release", ownerTeamId: "team_a",
    recommendedActionApprovalRequests: [{
      id: "par_1", code: "recover_schedule", status: "pending",
      requestedAt: "2026-07-24T00:15:00.000Z",
    }],
  }];
  const attention = service.listAttention({}, ACTOR_A).body;
  assert.equal(attention.count, 5);
  assert.deepEqual(new Set(attention.items.slice(0, 4).map((row) => row.kind)), new Set([
    "github_conflict", "verification_failed", "execution_approval", "recommended_action_approval",
  ]));
  assert.equal(attention.items[4].kind, "acceptance_blocked");
  assert.equal(service.listAttention({}, ACTOR_B).body.count, 0);
  assert.equal(attention.items.filter((row) => row.workItemId).every((row) => row.workItemId === item.id), true);
  assert.equal(service.listAttention({ kind: "recommended_action_approval" }, ACTOR_A).body.items[0].planningProjectId, "plan_1");
  assert.equal(attention.items.every((row) => row.dueAt && row.slaStatus && Array.isArray(row.history)), true);
  assert.equal(attention.metrics.backlog, 5);
  assert.equal(attention.metrics.pendingApprovals, 1);
  assert.equal(service.listAttention({ kind: "github_conflict" }, ACTOR_A).body.count, 1);
  const attentionId = attention.items[0].id;
  const claimed = service.updateAttention({
    attentionIds: [attentionId], action: "claim", leaseSeconds: 600, idempotencyKey: "claim-1",
  }, ACTOR_A);
  assert.equal(claimed.body.updated[0].handling.actorId, "usr_a");
  assert.equal(claimed.body.updated[0].handling.expiresAt, "2026-07-24T00:10:00.000Z");
  assert.equal(service.listAttention({ handler: "mine" }, ACTOR_A).body.items.some((row) => row.id === attentionId), true);
  const unclaimedView = service.listAttention({ handler: "unclaimed" }, ACTOR_A).body;
  assert.equal(unclaimedView.items.some((row) => row.id === attentionId), false);
  assert.equal(unclaimedView.metrics.backlog, 5);
  assert.equal(service.updateAttention({
    attentionIds: [attentionId], action: "claim",
  }, ACTOR_C).status, 409);
  assert.equal(service.updateAttention({
    attentionIds: [attentionId], action: "renew", leaseSeconds: 1_200,
  }, ACTOR_A).body.updated[0].handling.expiresAt, "2026-07-24T00:20:00.000Z");
  const resolvedOnce = service.updateAttention({
    attentionIds: [attentionId], action: "resolve", note: "Handled", idempotencyKey: "resolve-1",
  }, ACTOR_A);
  const resolvedReplay = service.updateAttention({
    attentionIds: [attentionId], action: "resolve", note: "Handled", idempotencyKey: "resolve-1",
  }, ACTOR_A);
  assert.equal(resolvedOnce.status, 200);
  assert.equal(resolvedReplay.body.replayed, true);
  assert.equal(service.listAttention({}, ACTOR_A).body.items.some((row) => row.id === attentionId), false);
  const resolved = service.listAttention({ includeResolved: "1" }, ACTOR_A).body.items.find((row) => row.id === attentionId);
  assert.equal(resolved.resolution.note, "Handled");
});

test("attention leases expire and batch claims fail atomically on contention", () => {
  let currentTime = "2026-07-24T00:00:00.000Z";
  const { service, state } = harness({ clock: () => currentTime });
  const first = service.createWorkItem({ projectId: "prj_a", title: "First" }, ACTOR_A).body.workItem;
  const second = service.createWorkItem({ projectId: "prj_a", title: "Second" }, ACTOR_A).body.workItem;
  for (const item of state.workItems) {
    item.externalBindings = [{
      kind: "github_issue", number: item.localNumber,
      conflict: { detectedAt: currentTime, fields: ["title"] },
    }];
  }
  const [firstAttention, secondAttention] = service.listAttention({}, ACTOR_A).body.items;
  service.updateAttention({
    attentionIds: [secondAttention.id], action: "claim", leaseSeconds: 60,
  }, ACTOR_C);
  const contended = service.updateAttention({
    attentionIds: [firstAttention.id, secondAttention.id], action: "claim",
  }, ACTOR_A);
  assert.equal(contended.status, 409);
  assert.equal(service.listAttention({ handler: "unclaimed" }, ACTOR_A).body.items.some(
    (row) => row.id === firstAttention.id,
  ), true);
  currentTime = "2026-07-24T00:01:01.000Z";
  const claimedAfterExpiry = service.updateAttention({
    attentionIds: [firstAttention.id, secondAttention.id], action: "claim",
    idempotencyKey: "batch-claim-1",
  }, ACTOR_A);
  assert.equal(claimedAfterExpiry.status, 200);
  assert.equal(claimedAfterExpiry.body.count, 2);
  assert.equal(service.updateAttention({
    attentionIds: [firstAttention.id, secondAttention.id], action: "claim",
    idempotencyKey: "batch-claim-1",
  }, ACTOR_A).body.replayed, true);
  assert.equal(first.id !== second.id, true);
});

test("GitHub webhook sync is idempotent and ignores stale deliveries", () => {
  const { service } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "Before" }, ACTOR_A).body.workItem;
  service.bindGithubIssue({
    workItemId: item.id, expectedRevision: item.revision,
    remote: {
      number: 8, title: "Before", body: "", state: "open", labels: [],
      repository: "acme/repo", updatedAt: "2026-07-24T00:00:00.000Z",
    },
  }, ACTOR_A);
  const payload = {
    repository: { full_name: "acme/repo" },
    issue: {
      number: 8, title: "From webhook", body: "", state: "open", labels: [],
      milestone: { title: "M4" }, assignees: [{ login: "octocat" }],
      html_url: "https://github.test/acme/repo/issues/8", updated_at: "2026-07-24T01:00:00.000Z",
    },
  };
  const first = service.ingestGithubWebhook({ deliveryId: "delivery-1", event: "issues", payload });
  assert.equal(first.body.synced, 1);
  assert.equal(service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.workItem.title, "From webhook");
  assert.equal(service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.workItem.milestone, "M4");
  assert.deepEqual(service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.workItem.assigneeIds, ["octocat"]);
  assert.equal(service.ingestGithubWebhook({
    deliveryId: "delivery-1", event: "issues", payload,
  }).body.replayed, true);
  const stale = service.ingestGithubWebhook({
    deliveryId: "delivery-2", event: "issues",
    payload: { ...payload, issue: { ...payload.issue, title: "Stale", updated_at: "2026-07-23T00:00:00.000Z" } },
  });
  assert.equal(stale.body.stale, 1);
  assert.equal(service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.workItem.title, "From webhook");
  assert.equal(service.githubSyncDiagnostics(ACTOR_A).body.boundIssues, 1);
  assert.equal(service.githubSyncDiagnostics(ACTOR_A).body.recentDeliveries.length, 2);
  assert.equal(service.githubSyncDiagnostics(ACTOR_B).body.recentDeliveries.length, 0);
  const replay = service.replayGithubWebhook({ deliveryId: "delivery-1" }, ACTOR_A);
  assert.equal(replay.status, 202);
  assert.equal(replay.body.outcome, "stale");
  assert.equal(replay.body.replayOf, "delivery-1");
  assert.equal(service.replayGithubWebhook({ deliveryId: "delivery-1" }, ACTOR_B).status, 404);
  service.recordGithubWebhookFailure({
    deliveryId: "bad-delivery", event: "issues", reason: "invalid_signature",
  });
  assert.notEqual(service.githubSyncDiagnostics(ACTOR_A).body.health, "healthy");
  assert.equal(service.githubSyncDiagnostics(ACTOR_A).body.recentFailures[0].reason, "invalid_signature");
  assert.equal(service.githubSyncDiagnostics(ACTOR_A).body.failureRate > 0, true);
  const comment = service.ingestGithubWebhook({
    deliveryId: "comment-1", event: "issue_comment",
    payload: {
      action: "created", repository: { full_name: "acme/repo" }, issue: { number: 8 },
      comment: {
        id: 55, body: "Remote note", user: { login: "reviewer" },
        created_at: "2026-07-24T02:00:00.000Z", updated_at: "2026-07-24T02:00:00.000Z",
      },
    },
  });
  assert.equal(comment.body.syncedComments, 1);
  assert.equal(service.listComments({ workItemId: item.id }, ACTOR_A).body.comments[0].body, "Remote note");
  const deleted = service.ingestGithubWebhook({
    deliveryId: "deleted-1", event: "issues",
    payload: {
      action: "deleted", repository: { full_name: "acme/repo" },
      issue: { number: 8, updated_at: "2026-07-24T03:00:00.000Z" },
    },
  });
  assert.equal(deleted.body.deleted, 1);
  assert.equal(service.listAttention({ kind: "github_deleted" }, ACTOR_A).body.count, 1);
});

test("GitHub webhook event storms stay bounded and cannot regress newer state", () => {
  const { service, state } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "Initial" }, ACTOR_A).body.workItem;
  service.bindGithubIssue({
    workItemId: item.id, expectedRevision: item.revision,
    remote: {
      number: 9, title: "Initial", body: "", state: "open", labels: [],
      repository: "acme/repo", updatedAt: "2026-07-24T00:00:00.000Z",
    },
  }, ACTOR_A);
  const payload = (title, updatedAt) => ({
    repository: { full_name: "acme/repo" },
    issue: {
      number: 9, title, body: "", state: "open", labels: [],
      html_url: "https://github.test/acme/repo/issues/9", updated_at: updatedAt,
    },
  });
  service.ingestGithubWebhook({
    deliveryId: "newest", event: "issues", payload: payload("Newest", "2026-07-24T02:00:00.000Z"),
  });
  for (let index = 0; index < 1_005; index += 1) {
    service.ingestGithubWebhook({
      deliveryId: `storm-${index}`, event: "issues",
      payload: payload(`Old ${index}`, "2026-07-24T01:00:00.000Z"),
    });
  }
  assert.equal(state.githubWorkItemWebhookDeliveries.length, 1_000);
  assert.equal(service.getWorkItem({ workItemId: item.id }, ACTOR_A).body.workItem.title, "Newest");
  assert.equal(state.githubWorkItemWebhookDeliveries[0].result.outcome, "stale");
});

test("SLA and Webhook failure alerts are dispatched once per health transition", () => {
  const { service, state, alerts, events } = harness({
    clock: () => "2026-07-25T00:00:00.000Z",
  });
  const item = service.createWorkItem({ projectId: "prj_a", title: "Alert me" }, ACTOR_A).body.workItem;
  state.workItems[0].externalBindings = [{
    kind: "github_issue", number: 1,
    conflict: { detectedAt: "2026-07-24T00:00:00.000Z", fields: ["title"] },
  }];
  service.recordGithubWebhookFailure({
    deliveryId: "failed-alert", event: "issues", reason: "invalid_signature",
  });
  assert.equal(service.sweepOperationalAlerts().changed, 2);
  assert.deepEqual(new Set(alerts.map((alert) => alert.kind)), new Set([
    "work_item_sla_breach", "github_work_item_webhook_failures",
  ]));
  assert.equal(service.sweepOperationalAlerts().changed, 0);
  assert.equal(alerts.length, 2);
  state.workItems[0].externalBindings = [];
  state.githubWorkItemWebhookFailures = [];
  assert.equal(service.sweepOperationalAlerts().changed, 2);
  assert.equal(events.filter((event) => event.type === "work_item_operational_recovered").length, 2);
  assert.equal(item.id, state.workItems[0].id);
});

test("webhook bookkeeping and alert transitions commit once without debounce writes", () => {
  let commits = 0;
  const { service } = harness({
    store: { transaction: (fn) => { commits += 1; return fn(); } },
    persistStateSoon: () => assert.fail("store-backed writes must not use the debounce"),
  });

  service.recordGithubWebhookFailure({
    deliveryId: "failed-transaction", event: "issues", reason: "invalid_signature",
  });
  assert.equal(commits, 1);

  service.ingestGithubWebhook({
    deliveryId: "delivery-transaction",
    event: "issues",
    payload: {
      repository: { full_name: "acme/repo" },
      issue: {
        number: 7, title: "No binding", state: "open", labels: [],
        updated_at: "2026-07-24T00:00:00.000Z",
      },
    },
  });
  assert.equal(commits, 2);

  assert.equal(service.sweepOperationalAlerts().changed, 1);
  assert.equal(commits, 3);
  assert.equal(service.sweepOperationalAlerts().changed, 0);
  assert.equal(commits, 3);
});

test("team scoping hides foreign work items and foreign projects", () => {
  const { service } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "A" }, ACTOR_A).body.workItem;
  assert.equal(service.listWorkItems({}, ACTOR_A).body.count, 1);
  assert.equal(service.listWorkItems({}, ACTOR_B).body.count, 0);
  assert.equal(service.getWorkItem({ workItemId: item.id }, ACTOR_B).status, 404);
  assert.equal(service.createWorkItem({ projectId: "prj_b", title: "No" }, ACTOR_A).status, 404);
});

test("updates are revision-gated and validate structured fields", () => {
  const { service } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "A" }, ACTOR_A).body.workItem;
  assert.equal(service.updateWorkItem({ workItemId: item.id, title: "B" }, ACTOR_A).body.error, "expected_revision_required");
  assert.equal(service.updateWorkItem({ workItemId: item.id, expectedRevision: 9, title: "B" }, ACTOR_A).status, 409);
  assert.equal(service.updateWorkItem({ workItemId: item.id, expectedRevision: 1, priority: "urgent" }, ACTOR_A).status, 400);
  const updated = service.updateWorkItem({
    workItemId: item.id,
    expectedRevision: 1,
    title: "B",
    status: "ready",
    labels: ["local", "local"],
    acceptanceCriteria: ["It persists"],
  }, ACTOR_A);
  assert.equal(updated.status, 200);
  assert.equal(updated.body.workItem.revision, 2);
  assert.deepEqual(updated.body.workItem.labels, ["local"]);
});

test("planning fields validate and bulk updates are atomic", () => {
  const { service } = harness();
  const first = service.createWorkItem({
    projectId: "prj_a", title: "First", dueDate: "2026-08-01", milestone: "M3", estimatePoints: 5,
  }, ACTOR_A).body.workItem;
  const second = service.createWorkItem({ projectId: "prj_a", title: "Second" }, ACTOR_A).body.workItem;
  assert.equal(first.dueDate, "2026-08-01");
  assert.equal(first.milestone, "M3");
  assert.equal(first.estimatePoints, 5);
  assert.equal(service.updateWorkItem({
    workItemId: first.id, expectedRevision: 1, dueDate: "08/01/2026",
  }, ACTOR_A).status, 400);
  const conflict = service.bulkUpdateWorkItems({
    items: [{ id: first.id, expectedRevision: 1 }, { id: second.id, expectedRevision: 9 }],
    changes: { status: "ready" },
  }, ACTOR_A);
  assert.equal(conflict.status, 409);
  assert.equal(service.getWorkItem({ workItemId: first.id }, ACTOR_A).body.workItem.status, "backlog");
  const updated = service.bulkUpdateWorkItems({
    items: [{ id: first.id, expectedRevision: 1 }, { id: second.id, expectedRevision: 1 }],
    changes: { status: "ready", milestone: "M4", estimatePoints: 8 },
  }, ACTOR_A);
  assert.equal(updated.body.count, 2);
  assert.equal(updated.body.workItems.every((item) =>
    item.status === "ready" && item.milestone === "M4" && item.estimatePoints === 8), true);
  assert.equal(service.updateWorkItem({
    workItemId: first.id, expectedRevision: 2, estimatePoints: -1,
  }, ACTOR_A).status, 400);
});

test("dependencies expose blocking state and reject cycles", () => {
  const { service } = harness();
  const foundation = service.createWorkItem({ projectId: "prj_a", title: "Foundation" }, ACTOR_A).body.workItem;
  const delivery = service.createWorkItem({ projectId: "prj_a", title: "Delivery" }, ACTOR_A).body.workItem;
  const linked = service.updateWorkItem({
    workItemId: delivery.id,
    expectedRevision: 1,
    dependencyIds: [foundation.id],
  }, ACTOR_A);
  assert.equal(linked.status, 200);
  assert.equal(linked.body.workItem.blockedBy[0].resolved, false);
  assert.equal(service.getWorkItem({ workItemId: foundation.id }, ACTOR_A).body.workItem.blocks[0].id, delivery.id);

  const cycle = service.updateWorkItem({
    workItemId: foundation.id,
    expectedRevision: 1,
    dependencyIds: [delivery.id],
  }, ACTOR_A);
  assert.equal(cycle.status, 409);
  assert.equal(cycle.body.error, "work_item_dependency_cycle");

  service.updateWorkItem({
    workItemId: foundation.id,
    expectedRevision: 1,
    status: "done",
  }, ACTOR_A);
  assert.equal(service.getWorkItem({ workItemId: delivery.id }, ACTOR_A).body.workItem.blockedBy[0].resolved, true);
});

test("parent and sub-issues expose progress and reject hierarchy cycles", () => {
  const { service, state } = harness();
  state.projects.push({ id: "prj_c", ownerTeamId: "team_a" });
  const parent = service.createWorkItem({
    projectId: "prj_a", title: "Parent", type: "initiative",
  }, ACTOR_A).body.workItem;
  const first = service.createWorkItem({
    projectId: "prj_a", title: "Child one", parentId: parent.id,
  }, ACTOR_A).body.workItem;
  const second = service.createWorkItem({
    projectId: "prj_a", title: "Child two", parentId: parent.id, status: "done",
  }, ACTOR_A).body.workItem;
  assert.equal(first.parent.id, parent.id);
  const detail = service.getWorkItem({ workItemId: parent.id }, ACTOR_A).body.workItem;
  assert.equal(detail.subIssuesSummary.total, 2);
  assert.equal(detail.subIssuesSummary.completed, 1);
  assert.equal(detail.subIssuesSummary.percentCompleted, 50);
  assert.deepEqual(detail.subIssues.map((item) => item.id).sort(), [first.id, second.id].sort());
  assert.equal(service.updateWorkItem({
    workItemId: parent.id, expectedRevision: 1, parentId: first.id,
  }, ACTOR_A).status, 409);
  assert.equal(service.createWorkItem({
    projectId: "prj_c", title: "Wrong project", parentId: parent.id,
  }, ACTOR_A).status, 400);
});

test("execution admission claims the item and rejects duplicate auto-runs", () => {
  const { service, state } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "Run once" }, ACTOR_A).body.workItem;

  const admitted = service.beginExecution({
    workItemId: item.id,
    kind: "auto_run",
    agentId: "agt_a",
  }, ACTOR_A);
  assert.equal(admitted.status, 201);
  assert.equal(admitted.body.claim.claimedBy, "usr_a");
  assert.equal(service.beginExecution({
    workItemId: item.id,
    kind: "auto_run",
  }, ACTOR_A).body.error, "work_item_execution_in_progress");
  assert.equal(service.beginExecution({
    workItemId: item.id,
    kind: "auto_run",
  }, ACTOR_C).body.error, "work_item_execution_in_progress");

  state.autoRuns = [{ id: "aur_once", status: "running" }];
  const recorded = service.recordExecutionBinding({
    workItemId: item.id,
    kind: "auto_run",
    targetId: "aur_once",
    worktreeId: "wtr_once",
    operationId: admitted.body.operation.id,
  }, ACTOR_A);
  assert.equal(recorded.status, 200);
  assert.equal(recorded.body.workItem.executionOperation, null);
  assert.equal(service.beginExecution({
    workItemId: item.id,
    kind: "auto_run",
  }, ACTOR_A).body.error, "work_item_auto_run_active");
});

test("delivery admission serializes side effects and completes by operation id", () => {
  const { service, state } = harness();
  const created = service.createWorkItem({ projectId: "prj_a", title: "Serialize delivery" }, ACTOR_A).body.workItem;
  state.autoRuns = [{
    id: "aur_delivery_lock",
    status: "done",
    link: { type: "local_issue", number: created.localNumber },
    localDelivery: { worktreeId: "wtr_lock", branchName: "local-lock" },
  }];
  service.recordExecutionBinding({
    workItemId: created.id,
    kind: "auto_run",
    targetId: "aur_delivery_lock",
    worktreeId: "wtr_lock",
  }, ACTOR_A);
  const item = service.getWorkItem({ workItemId: created.id }, ACTOR_A).body.workItem;
  const admitted = service.beginDelivery({
    workItemId: item.id,
    expectedRevision: item.revision,
    mode: "local_merge",
    autoRunId: "aur_delivery_lock",
  }, ACTOR_A);
  assert.equal(admitted.status, 201);
  assert.equal(service.updateWorkItem({
    workItemId: item.id,
    expectedRevision: admitted.body.workItem.revision,
    title: "Must wait",
  }, ACTOR_A).body.error, "work_item_delivery_in_progress");
  assert.equal(service.beginDelivery({
    workItemId: item.id,
    expectedRevision: admitted.body.workItem.revision,
    mode: "local_merge",
    autoRunId: "aur_delivery_lock",
  }, ACTOR_A).body.error, "work_item_delivery_in_progress");

  const completed = service.completeDelivery({
    workItemId: item.id,
    mode: "local_merge",
    autoRunId: "aur_delivery_lock",
    operationId: admitted.body.operation.id,
    result: { baseBranch: "main", commit: "locked123" },
  }, ACTOR_A);
  assert.equal(completed.status, 200);
  assert.equal(completed.body.workItem.state, "closed");
  assert.equal(completed.body.delivery.deliveredCommit, "locked123");
});

test("agent claims renew, conflict, expire, transfer, and release safely", () => {
  const { service, state } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "Claim me" }, ACTOR_A).body.workItem;
  const claimed = service.claimWorkItem({
    workItemId: item.id, agentId: "agt_a", leaseMinutes: 30, idempotencyKey: "claim-1",
  }, ACTOR_A);
  assert.equal(claimed.status, 201);
  assert.equal(claimed.body.claim.claimedBy, "usr_a");
  const renewed = service.claimWorkItem({
    workItemId: item.id, agentId: "agt_a", leaseMinutes: 60, idempotencyKey: "claim-1",
  }, ACTOR_A);
  assert.equal(renewed.status, 200);
  assert.equal(service.claimWorkItem({ workItemId: item.id }, ACTOR_C).status, 409);
  state.workItems[0].claim.leaseExpiresAt = "2026-07-23T00:00:00.000Z";
  const takeover = service.claimWorkItem({ workItemId: item.id, agentId: "agt_c" }, ACTOR_C);
  assert.equal(takeover.status, 201);
  assert.equal(takeover.body.claim.claimedBy, "usr_c");
  assert.equal(service.releaseWorkItemClaim({ workItemId: item.id }, ACTOR_A).status, 409);
  assert.equal(service.releaseWorkItemClaim({ workItemId: item.id }, ACTOR_C).body.released, true);
  assert.equal(service.releaseWorkItemClaim({ workItemId: item.id }, ACTOR_C).body.released, false);
});

test("detail returns an authoritative per-item observability snapshot", () => {
  const { service, state } = harness({
    budgetStatusFor: () => ({
      exists: true, budgetId: "bud_a", limitUsd: 1, spentUsd: 0.25, finalizedUsd: 0.25,
      estimatedUsd: 0, reservedUsd: 0.1, admissionUsd: 0.35, remainingUsd: 0.75,
      policy: "block", currency: "USD", over: false, admissionOver: false,
    }),
  });
  const item = service.createWorkItem({ projectId: "prj_a", title: "Observe me" }, ACTOR_A).body.workItem;
  service.claimWorkItem({ workItemId: item.id, agentId: "agt_a", leaseMinutes: 30 }, ACTOR_A);
  state.autoRuns = [{
    id: "aur_1", projectId: "prj_a", status: "awaiting_approval",
    updatedAt: "2026-07-24T00:01:00.000Z",
    decision: { path: "develop", confidence: 0.8, via: "agent" },
    routingOverride: {
      recommendedPath: "develop", actualPath: "design", reason: "Needs a wireframe",
      actorId: "usr_a", recordedAt: "2026-07-24T00:01:10.000Z", revision: 1,
    },
  }];
  state.workItems[0].executionBindings = [{ kind: "auto_run", targetId: "aur_1", worktreeId: "wtr_1", createdAt: "2026-07-24T00:00:00.000Z" }];
  state.ledgerEntries = [{
    id: "led_1", localIssueId: item.id, projectId: "prj_a", autoRunId: "aur_1",
    model: "gpt-test", budgetPoolId: "bud_a", amountUsd: 0.25, billable: true, status: "final",
    createdAt: "2026-07-24T00:01:30.000Z",
  }];
  state.budgets = [{ id: "bud_a", projectId: "prj_a", limitUsd: 1, policy: "block" }];
  state.alertOutbox = [{
    id: "aob_1", alert: { data: { autoRunId: "aur_1" } }, status: "queued",
    createdAt: "2026-07-24T00:01:40.000Z",
  }];

  const detail = service.getWorkItem({ workItemId: item.id }, ACTOR_A).body;
  assert.equal(detail.observability.executionChainId, item.id);
  assert.ok(detail.observability.timeline.some((entry) => entry.source === "issue"));
  assert.ok(detail.observability.timeline.some((entry) => entry.source === "cost"));
  assert.ok(detail.observability.timeline.some((entry) => entry.source === "alert"));
  assert.equal(detail.observability.timeline[0].stage, "creation");
  assert.equal(detail.observability.routingExplanation.selectedPath, "develop");
  assert.equal(detail.observability.routingExplanation.humanCorrection.actualPath, "design");
  assert.equal(detail.observability.nextAction, "review_approval");
  assert.equal(detail.observability.latestRun.id, "aur_1");
  assert.equal(detail.observability.activeClaim.actorId, "usr_a");
  assert.deepEqual(detail.observability.cost, {
    knownUsd: 0.25,
    unknownEntries: 0,
    entryCount: 1,
    byAutoRun: [{ autoRunId: "aur_1", knownUsd: 0.25, unknownEntries: 0, entryCount: 1 }],
    byModel: [{ model: "gpt-test", knownUsd: 0.25, unknownEntries: 0, entryCount: 1 }],
    byBudgetPool: [{ budgetPoolId: "bud_a", knownUsd: 0.25, unknownEntries: 0, entryCount: 1 }],
    projectBudget: {
      exists: true, budgetId: "bud_a", limitUsd: 1, spentUsd: 0.25, finalizedUsd: 0.25,
      estimatedUsd: 0, reservedUsd: 0.1, admissionUsd: 0.35, remainingUsd: 0.75,
      policy: "block", currency: "USD", over: false, admissionOver: false,
    },
    teamBudget: null,
  });
  assert.deepEqual(detail.observability.alerts, {
    queued: 1,
    failed: 0,
    sent: 0,
    skipped: 0,
    items: [{
      id: "aob_1",
      kind: "unknown",
      status: "queued",
      attempts: 0,
      nextAttemptAt: null,
      sentAt: null,
      lastError: null,
    }],
  });
});

test("AI issue assistance returns an editable draft without creating work", () => {
  const { service, state } = harness();
  const result = service.suggestWorkItemDraft({
    projectId: "prj_a",
    title: "Fix login crash",
    body: "Users cannot sign in after upgrading.",
  }, ACTOR_A);
  assert.equal(result.status, 200);
  assert.equal(result.body.draft.type, "bug");
  assert.equal(result.body.draft.suggestedRoute, "clarify");
  assert.ok(result.body.draft.acceptanceCriteria.length >= 2);
  assert.equal(state.workItems.length, 0);
  assert.equal(service.suggestWorkItemDraft({
    projectId: "prj_b", title: "Foreign", body: "",
  }, ACTOR_A).status, 404);
});

test("linked alert retries are ownership checked", () => {
  let retriedId = null;
  const { service, state } = harness({
    retryAlert: (id) => {
      retriedId = id;
      return { id, status: "queued" };
    },
  });
  const item = service.createWorkItem({ projectId: "prj_a", title: "Retry delivery" }, ACTOR_A).body.workItem;
  state.autoRuns = [{ id: "aur_retry", projectId: "prj_a", status: "failed" }];
  state.workItems[0].executionBindings = [{
    kind: "auto_run", targetId: "aur_retry", worktreeId: null, createdAt: "2026-07-24T00:00:00.000Z",
  }];
  state.alertOutbox = [{
    id: "aob_retry", alert: { data: { autoRunId: "aur_retry" } }, status: "failed",
  }];
  assert.equal(service.retryWorkItemAlert({
    workItemId: item.id, alertId: "aob_retry",
  }, ACTOR_A).body.alert.status, "queued");
  assert.equal(retriedId, "aob_retry");
  state.alertOutbox[0].status = "sent";
  assert.equal(service.retryWorkItemAlert({
    workItemId: item.id, alertId: "aob_retry",
  }, ACTOR_A).status, 409);
  assert.equal(service.retryWorkItemAlert({
    workItemId: item.id, alertId: "aob_retry",
  }, ACTOR_B).status, 404);
});

test("agent create idempotency prevents duplicate local issues", () => {
  const { service, state } = harness();
  const first = service.createWorkItem({
    projectId: "prj_a", title: "Exactly once", idempotencyKey: "create-1",
  }, ACTOR_A);
  const replay = service.createWorkItem({
    projectId: "prj_a", title: "Ignored replay body", idempotencyKey: "create-1",
  }, ACTOR_A);
  assert.equal(first.status, 201);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.workItem.id, first.body.workItem.id);
  assert.equal(state.workItems.length, 1);
  const otherActor = service.createWorkItem({
    projectId: "prj_a", title: "Separate actor", idempotencyKey: "create-1",
  }, ACTOR_C);
  assert.equal(otherActor.status, 201);
  assert.equal(state.workItems.length, 2);
});

test("planning automation adds matching work items once", () => {
  const { service, state } = harness();
  state.planningProjects = [{
    id: "ppj_1", ownerTeamId: "team_a", name: "Urgent bugs", archivedAt: null,
    automationRules: [{ id: "par_1", status: "", priority: "p0", type: "bug", label: "release" }],
  }];
  state.planningProjectItems = [];
  const item = service.createWorkItem({
    projectId: "prj_a", title: "Ship blocker", type: "bug", priority: "p0", labels: ["release"],
  }, ACTOR_A).body.workItem;
  assert.equal(state.planningProjectItems.length, 1);
  assert.equal(state.planningProjectItems[0].workItemId, item.id);
  assert.equal(state.planningProjects[0].activity[0].action, "item_auto_added");
  service.updateWorkItem({
    workItemId: item.id, expectedRevision: 1, status: "ready",
  }, ACTOR_A);
  assert.equal(state.planningProjectItems.length, 1);
  assert.equal(service.listActivity({ workItemId: item.id }, ACTOR_A).body.activities
    .some((row) => row.action === "planning_auto_added"), true);
});

test("close, reopen, archive and restore preserve the record", () => {
  const { service } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "A" }, ACTOR_A).body.workItem;
  const closed = service.transitionWorkItem({ workItemId: item.id, expectedRevision: 1, action: "close" }, ACTOR_A);
  assert.equal(closed.body.workItem.state, "closed");
  const archived = service.transitionWorkItem({ workItemId: item.id, expectedRevision: 2, action: "archive" }, ACTOR_A);
  assert.ok(archived.body.workItem.archivedAt);
  assert.equal(service.listWorkItems({}, ACTOR_A).body.count, 0);
  const restored = service.transitionWorkItem({ workItemId: item.id, expectedRevision: 3, action: "restore" }, ACTOR_A);
  assert.equal(restored.body.workItem.archivedAt, null);
  const reopened = service.transitionWorkItem({ workItemId: item.id, expectedRevision: 4, action: "reopen" }, ACTOR_A);
  assert.equal(reopened.body.workItem.state, "open");
});

test("list supports project, status, type, assignee and text filters", () => {
  const { service } = harness();
  service.createWorkItem({
    projectId: "prj_a",
    title: "Repair release",
    type: "bug",
    status: "blocked",
    assigneeIds: ["usr_a"],
    labels: ["release"],
  }, ACTOR_A);
  service.createWorkItem({ projectId: "prj_a", title: "Write docs" }, ACTOR_A);
  assert.equal(service.listWorkItems({ q: "release" }, ACTOR_A).body.count, 1);
  assert.equal(service.listWorkItems({ status: "blocked", type: "bug", assigneeId: "usr_a" }, ACTOR_A).body.count, 1);
  assert.equal(service.listWorkItems({ status: "done" }, ACTOR_A).body.count, 0);
});

test("work item and attention lists support opaque cursors and incremental windows", () => {
  const { service, state } = harness();
  service.createWorkItem({ projectId: "prj_a", title: "First" }, ACTOR_A);
  service.createWorkItem({ projectId: "prj_a", title: "Second" }, ACTOR_A);
  state.workItems.find((item) => item.title === "First").updatedAt = "2026-07-24T00:01:00.000Z";
  state.workItems.find((item) => item.title === "Second").updatedAt = "2026-07-24T00:02:00.000Z";
  const firstPage = service.listWorkItems({ limit: "1" }, ACTOR_A).body;
  assert.equal(firstPage.workItems[0].title, "Second");
  assert.equal(firstPage.hasMore, true);
  const secondPage = service.listWorkItems({ limit: "1", cursor: firstPage.nextCursor }, ACTOR_A).body;
  assert.equal(secondPage.workItems[0].title, "First");
  assert.equal(secondPage.hasMore, false);
  assert.equal(service.listWorkItems({
    updatedSince: "2026-07-24T00:01:30.000Z",
  }, ACTOR_A).body.workItems[0].title, "Second");
  assert.equal(service.listWorkItems({ cursor: "invalid" }, ACTOR_A).status, 400);
});

test("list filters by planning project and returns reverse memberships", () => {
  const { service, state } = harness();
  const first = service.createWorkItem({ projectId: "prj_a", title: "In roadmap" }, ACTOR_A).body.workItem;
  service.createWorkItem({ projectId: "prj_a", title: "Unplanned" }, ACTOR_A);
  state.planningProjects = [{
    id: "ppj_1", ownerTeamId: "team_a", name: "Roadmap", archivedAt: null,
  }];
  state.planningProjectItems = [{
    id: "ppi_1", ownerTeamId: "team_a", planningProjectId: "ppj_1", workItemId: first.id,
  }];
  const result = service.listWorkItems({ planningProjectId: "ppj_1" }, ACTOR_A);
  assert.equal(result.body.count, 1);
  assert.equal(result.body.workItems[0].planningProjects[0].name, "Roadmap");
  assert.equal(service.getWorkItem({ workItemId: first.id }, ACTOR_A).body.workItem.planningProjects[0].id, "ppj_1");
});

test("work items survive a persistent-state restart", () => {
  const root = join(tmpdir(), `myagenttool-work-items-${Date.now()}`);
  const projectPath = join(root, "project");
  const stateStorePath = join(root, "state.json");
  mkdirSync(projectPath, { recursive: true });
  try {
    const now = () => "2026-07-24T00:00:00.000Z";
    const first = createServerState({ defaultProjectPath: projectPath, now });
    first.state.workItems.push({
      id: "lwi_1", localNumber: 1, localRef: "LOCAL-1",
      ownerTeamId: "team_local", projectId: first.defaultProject.id,
      title: "Persist me", body: "", type: "task", status: "backlog", priority: "p2",
      labels: [], assigneeIds: [], acceptanceCriteria: [], dueDate: "2026-08-15", milestone: "M3",
      revision: 1, state: "open",
      archivedAt: null, externalBindings: [], executionBindings: [], createdAt: now(), updatedAt: now(),
      createdBy: "usr_local", lastModifiedBy: "usr_local",
    });
    first.state.workItemComments.push({
      id: "wic_1", workItemId: "lwi_1", ownerTeamId: "team_local",
      projectId: first.defaultProject.id, body: "Still here", revision: 1,
      createdAt: now(), updatedAt: now(), createdBy: "usr_local",
      lastModifiedBy: "usr_local", deletedAt: null,
    });
    first.state.workItemActivities.push({
      id: "wia_1", workItemId: "lwi_1", ownerTeamId: "team_local",
      projectId: first.defaultProject.id, action: "commented", actorId: "usr_local",
      createdAt: now(), details: { commentId: "wic_1" },
    });
    first.state.workItemAttentionOperations.push({
      attentionId: "github_conflict:lwi_1", ownerTeamId: "team_local",
      handling: { actorId: "usr_local", claimedAt: now(), expiresAt: "2026-07-24T00:15:00.000Z" },
      resolution: null, history: [],
    });
    first.state.githubWorkItemWebhookDeliveries.push({
      id: "delivery-persisted", event: "issues", receivedAt: now(),
      repository: "acme/repo", issueNumber: 1, teamIds: ["team_local"],
      result: { outcome: "synced" },
    });
    first.state.githubWorkItemWebhookFailures.push({
      id: "delivery-failed", event: "issues", reason: "invalid_signature", receivedAt: now(),
    });
    first.state.planningProjects.push({
      id: "ppj_1", ownerTeamId: "team_local", name: "Roadmap", description: "",
      color: "indigo", revision: 1, archivedAt: null, createdAt: now(), updatedAt: now(),
      createdBy: "usr_local", lastModifiedBy: "usr_local",
    });
    first.state.planningProjectItems.push({
      id: "ppi_1", ownerTeamId: "team_local", planningProjectId: "ppj_1",
      workItemId: "lwi_1", position: 2000, addedAt: now(), addedBy: "usr_local",
    });
    createPersistenceRuntime({
      state: first.state, enabled: true, stateStorePath, schemaVersion: 1,
      now, defaultProject: first.defaultProject, sameProjectPath,
    }).savePersistentState();

    const second = createServerState({ defaultProjectPath: projectPath, now });
    createPersistenceRuntime({
      state: second.state, enabled: true, stateStorePath, schemaVersion: 1,
      now, defaultProject: second.defaultProject, sameProjectPath,
    }).restorePersistentState();
    assert.equal(second.state.workItems.length, 1);
    assert.equal(second.state.workItems[0].localRef, "LOCAL-1");
    assert.equal(second.state.workItems[0].dueDate, "2026-08-15");
    assert.equal(second.state.workItems[0].milestone, "M3");
    assert.equal(second.state.workItems[0].terminalId, second.state.devices[0].id);
    assert.equal(second.state.planningProjectItems[0].position, 2000);
    assert.equal(second.state.workItemComments[0].body, "Still here");
    assert.equal(second.state.workItemActivities[0].action, "commented");
    assert.equal(second.state.workItemAttentionOperations[0].handling.actorId, "usr_local");
    assert.equal(second.state.githubWorkItemWebhookDeliveries[0].id, "delivery-persisted");
    assert.equal(second.state.githubWorkItemWebhookFailures[0].reason, "invalid_signature");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("comments support create, edit and soft-delete with revision conflicts", () => {
  const { service } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "Discuss" }, ACTOR_A).body.workItem;
  const created = service.createComment({ workItemId: item.id, body: " First note " }, ACTOR_A);
  assert.equal(created.status, 201);
  assert.equal(created.body.comment.body, "First note");
  assert.equal(service.createComment({ workItemId: item.id, body: " " }, ACTOR_A).status, 400);
  assert.equal(service.updateComment({
    workItemId: item.id, commentId: created.body.comment.id, expectedRevision: 9, body: "No",
  }, ACTOR_A).status, 409);
  const updated = service.updateComment({
    workItemId: item.id, commentId: created.body.comment.id, expectedRevision: 1, body: "Edited",
  }, ACTOR_A);
  assert.equal(updated.body.comment.revision, 2);
  assert.equal(updated.body.comment.body, "Edited");
  const deleted = service.deleteComment({
    workItemId: item.id, commentId: created.body.comment.id, expectedRevision: 2,
  }, ACTOR_A);
  assert.equal(deleted.body.comment.body, null);
  assert.ok(deleted.body.comment.deletedAt);
  assert.equal(service.updateComment({
    workItemId: item.id, commentId: created.body.comment.id, expectedRevision: 3, body: "Restore",
  }, ACTOR_A).status, 404);
});

test("comments and activity are team scoped and form a dedicated timeline", () => {
  const { service } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "Timeline" }, ACTOR_A).body.workItem;
  service.updateWorkItem({ workItemId: item.id, expectedRevision: 1, status: "ready" }, ACTOR_A);
  service.createComment({ workItemId: item.id, body: "Ready to start" }, ACTOR_A);
  const activity = service.listActivity({ workItemId: item.id }, ACTOR_A);
  assert.deepEqual(new Set(activity.body.activities.map((row) => row.action)), new Set(["created", "updated", "commented"]));
  assert.equal(service.listComments({ workItemId: item.id }, ACTOR_A).body.count, 1);
  assert.equal(service.listActivity({ workItemId: item.id }, ACTOR_B).status, 404);
  assert.equal(service.listComments({ workItemId: item.id }, ACTOR_B).status, 404);
});

test("execution bindings attach worktrees and auto-runs to the local issue", () => {
  const { service } = harness();
  const item = service.createWorkItem({ projectId: "prj_a", title: "Execute locally" }, ACTOR_A).body.workItem;
  const worktree = service.recordExecutionBinding({
    workItemId: item.id, kind: "worktree", targetId: "wtr_1", worktreeId: "wtr_1",
  }, ACTOR_A);
  assert.equal(worktree.status, 200);
  assert.equal(worktree.body.binding.terminalId, "dev_local");
  assert.equal(worktree.body.workItem.executionBindings.length, 1);
  const run = service.recordExecutionBinding({
    workItemId: item.id, kind: "auto_run", targetId: "aur_1", worktreeId: "wtr_2",
  }, ACTOR_A);
  assert.equal(run.body.binding.terminalId, "dev_local");
  assert.equal(run.body.workItem.executionBindings.length, 2);
  assert.equal(service.listActivity({ workItemId: item.id }, ACTOR_A).body.activities[0].action, "auto_run_started");
  assert.equal(service.recordExecutionBinding({
    workItemId: item.id, kind: "auto_run", targetId: "aur_evil",
  }, ACTOR_B).status, 404);
});
