process.env.MYAGENT_REQUIRE_AUTH = "1";
process.env.MYAGENTTOOL_STATE_DISABLED = "1";
process.env.MYAGENTTOOL_GITHUB_WEBHOOK_SECRET = "webhook-secret-a";
process.env.MYAGENTTOOL_GITLAB_WEBHOOK_SECRET = "gitlab-webhook-secret";
process.env.MYAGENTTOOL_GITEA_WEBHOOK_SECRET = "gitea-webhook-secret";

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { after, before, test } from "node:test";

let server;
let base;
let runtimeState;
let closeRuntimeServices;
const root = join(tmpdir(), `myagenttool-work-items-http-${process.pid}`);
const projectAPath = join(root, "a");

before(async () => {
  const { createServerState } = await import("../../src/runtime/state-factory.mjs");
  const { createServerRuntimeServices } = await import("../../src/runtime/service-composer.mjs");
  const { createHttpServer } = await import("../../src/runtime/http-server.mjs");
  const now = () => new Date().toISOString();
  mkdirSync(projectAPath, { recursive: true });
  execFileSync("git", ["init", "-b", "main", projectAPath]);
  execFileSync("git", ["-C", projectAPath, "config", "user.email", "test@example.test"]);
  execFileSync("git", ["-C", projectAPath, "config", "user.name", "Test"]);
  writeFileSync(join(projectAPath, "README.md"), "# test\n");
  execFileSync("git", ["-C", projectAPath, "add", "README.md"]);
  execFileSync("git", ["-C", projectAPath, "commit", "-m", "initial"]);
  const { defaultProject, state } = createServerState({ defaultProjectPath: projectAPath, now });
  runtimeState = state;
  state.teams.push({ id: "team_a" }, { id: "team_b" });
  state.users.push({ id: "usr_a", teamId: "team_a" }, { id: "usr_b", teamId: "team_b" });
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  state.tokens.push({ token: "tok_a", userId: "usr_a", expiresAt }, { token: "tok_b", userId: "usr_b", expiresAt });
  state.projects.push(
    { id: "prj_a", ownerTeamId: "team_a", path: projectAPath },
    { id: "prj_b", ownerTeamId: "team_b", path: "/tmp/b" },
  );
  // Simulate an online bridge so local CLI agents are "available" at auto-run
  // admission. These tests exercise the HTTP creation path, not bridge execution,
  // and startAutoRun now refuses an unavailable agent rather than accepting a run
  // that would stall in "dispatching" forever.
  state.device.status = "online";
  state.device.unlinkState = "linked";
  for (const agent of state.agents) {
    if (agent.location?.type === "local_device") agent.status = "available";
  }
  const runtimeServices = createServerRuntimeServices({
    namespace: "test", protocolVersion: "0.0.0", state, defaultProject, defaultProjectPath: "/tmp",
    persistenceEnabled: false, stateStorePath: join(root, "state", "local-demo-state.json"), stateSchemaVersion: 1, dispatchLeaseMs: 30_000, now,
  });
  const { httpDependencies } = runtimeServices;
  closeRuntimeServices = runtimeServices.closeRuntimeServices;
  server = createHttpServer({ host: "127.0.0.1", port: 0, namespace: "test", protocolVersion: "0.0.0", ...httpDependencies });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server?.close(resolve) ?? resolve());
  await closeRuntimeServices?.();
  rmSync(root, { recursive: true, force: true });
});

async function call(path, { token = "tok_a", method = "GET", body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

async function waitForValue(read, { timeoutMs = 5_000, intervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Timed out waiting for background work-item Auto-run progress.");
}

async function webhook(payload, { secret = process.env.MYAGENTTOOL_GITHUB_WEBHOOK_SECRET, deliveryId = "delivery-http" } = {}) {
  const raw = JSON.stringify(payload);
  const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  const response = await fetch(`${base}/api/webhooks/github/work-items`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "issues",
      "x-github-delivery": deliveryId,
      "x-hub-signature-256": signature,
    },
    body: raw,
  });
  return { status: response.status, body: await response.json() };
}

async function externalWebhook(provider, payload, {
  secret = process.env[`MYAGENTTOOL_${provider.toUpperCase()}_WEBHOOK_SECRET`],
  deliveryId = `${provider}-delivery-http`,
} = {}) {
  const raw = JSON.stringify(payload);
  const headers = provider === "gitlab"
    ? {
        "x-gitlab-event": "Issue Hook",
        "x-gitlab-event-uuid": deliveryId,
        "x-gitlab-token": secret,
      }
    : {
        "x-gitea-event": "issues",
        "x-gitea-delivery": deliveryId,
        "x-gitea-signature": createHmac("sha256", secret).update(raw).digest("hex"),
      };
  const response = await fetch(`${base}/api/webhooks/${provider}/work-items`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: raw,
  });
  return { status: response.status, body: await response.json() };
}

test("learned My template choices are visible and removable through the real HTTP server", async () => {
  runtimeState.myTemplateRoutingFeedback.push(
    {
      id: "mtf_http_a", ownerTeamId: "team_a", projectId: "prj_a", workItemId: "missing_a",
      intentTerms: ["询价"], rejectedOutput: "报价单", selectedOutput: "询价汇总表",
      reason: "user_corrected_desired_output", createdBy: "usr_a", createdAt: "2026-08-11T00:00:00.000Z",
    },
    {
      id: "mtf_http_b", ownerTeamId: "team_b", projectId: "prj_b", workItemId: "missing_b",
      intentTerms: ["合同"], rejectedOutput: "合同摘要", selectedOutput: "合同登记表",
      reason: "user_corrected_desired_output", createdBy: "usr_b", createdAt: "2026-08-11T00:00:00.000Z",
    },
  );

  const listed = await call("/api/work-items/my-template-learning?projectId=prj_a");
  assert.equal(listed.status, 200);
  assert.equal(listed.body.count, 1);
  assert.equal(listed.body.feedback[0].selectedOutput, "询价汇总表");
  assert.equal((await call("/api/work-items/my-template-learning", { token: "tok_b" })).body.count, 1);
  assert.equal((await call("/api/work-items/my-template-learning/mtf_http_a", {
    token: "tok_b", method: "DELETE",
  })).status, 404);

  const removed = await call("/api/work-items/my-template-learning/mtf_http_a", { method: "DELETE" });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.affectsFutureMatchesOnly, true);
  assert.equal((await call("/api/work-items/my-template-learning?projectId=prj_a")).body.count, 0);
  runtimeState.myTemplateRoutingFeedback = runtimeState.myTemplateRoutingFeedback
    .filter((feedback) => feedback.id !== "mtf_http_b");
});

test("local work item CRUD is wired through the real HTTP server", async () => {
  const created = await call("/api/work-items", {
    method: "POST",
    body: { projectId: "prj_a", title: "Plan locally", type: "feature", plannedDate: "2026-07-31" },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.workItem.localRef, "LOCAL-1");
  assert.deepEqual(created.body.workItem.assigneeIds, ["usr_a"]);
  assert.equal(created.body.workItem.plannedDate, "2026-07-31");
  assert.equal(created.body.workItem.completedAt, null);
  assert.equal(created.body.workItem.requesterRelation, "unknown");
  assert.equal(created.body.workItem.intakeChannel, "unknown");
  assert.equal(created.body.workItem.waitingOn, "none");

  const dataContext = await call(`/api/work-items/${created.body.workItem.id}/data-context`);
  assert.equal(dataContext.status, 200);
  assert.equal(dataContext.body.dataContext.status, "empty");
  assert.equal(dataContext.body.dataContext.requiresConfirmation, false);

  const updated = await call(`/api/work-items/${created.body.workItem.id}`, {
    method: "PATCH",
    body: { expectedRevision: 1, status: "ready", priority: "p1" },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.workItem.status, "ready");

  const listed = await call("/api/work-items?status=ready&q=plan");
  assert.equal(listed.status, 200);
  assert.equal(listed.body.count, 1);
  assert.equal((await call("/api/work-items?assigneeId=mine&plannedDate=2026-07-31")).body.count, 1);

  const completed = await call(`/api/work-items/${created.body.workItem.id}`, {
    method: "PATCH",
    body: { expectedRevision: 2, status: "done" },
  });
  assert.equal(completed.status, 200);
  assert.ok(completed.body.workItem.completedAt);
  const reopened = await call(`/api/work-items/${created.body.workItem.id}`, {
    method: "PATCH",
    body: { expectedRevision: 3, status: "ready" },
  });
  assert.equal(reopened.body.workItem.completedAt, null);
});

test("work item revisions invalidate pending ledger plans before old approvals can write", async () => {
  const created = await call("/api/work-items", {
    method: "POST",
    body: { projectId: "prj_a", title: "Refresh ledger plan", type: "task" },
  });
  assert.equal(created.status, 201);
  const workItem = runtimeState.workItems.find((item) => item.id === created.body.workItem.id);
  const planId = `tpp_http_stale_${workItem.id}`;
  workItem.ledgerPostingPlanId = planId;
  runtimeState.taskLedgerPostingPlans.unshift({
    id: planId,
    schemaVersion: 2,
    ownerTeamId: "team_a",
    projectId: "prj_a",
    workItemId: workItem.id,
    resultRevision: 1,
    plan: {
      schemaVersion: 2,
      workItemId: workItem.id,
      resultRevision: 1,
      primary: {
        ledgerDefinitionId: "ldg_http_stale",
        recordId: null,
        action: "create",
        fields: { title: "Old result" },
        sourceEvidence: [{ artifactId: "artifact_http_stale", field: "title" }],
        approvalRequired: true,
      },
      related: [],
      state: "proposed",
    },
    inputDigest: "old-digest",
    previewId: "lup_http_stale",
    batchPreviewId: null,
    previewIds: ["lup_http_stale"],
    previewSnapshot: { id: "lup_http_stale", action: "insert", changedCells: [] },
    batchPreviewSnapshot: null,
    expectedLedgerActions: ["insert"],
    status: "proposed",
    revision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: "usr_a",
  });

  const updated = await call(`/api/work-items/${workItem.id}`, {
    method: "PATCH",
    body: { expectedRevision: 1, title: "Refresh ledger plan with current materials" },
  });
  assert.equal(updated.status, 200);
  assert.equal(runtimeState.taskLedgerPostingPlans.find((plan) => plan.id === planId).status, "invalidated");

  const grant = await call("/api/approvals/grants", {
    method: "POST",
    body: { action: "ledger_posting_plan_commit", targetId: planId },
  });
  assert.equal(grant.status, 201);
  const denied = await call(`/api/work-items/${workItem.id}/ledger-posting-plan/commit`, {
    method: "POST",
    body: { planId, expectedRevision: 2, approvalToken: grant.body.token },
  });
  assert.equal(denied.status, 409);
  assert.equal(denied.body.error, "task_ledger_posting_plan_stale");
  assert.equal(runtimeState.approvalGrants.find((candidate) => candidate.id === grant.body.grantId).consumedAt, null);
  const stale = await call(`/api/work-items/${workItem.id}/ledger-posting-plan`);
  assert.equal(stale.body.plan.status, "invalidated");
  assert.equal(stale.body.plan.resultRevision, 1);
  assert.equal(stale.body.plan.invalidatedReason, "updated");
});

test("failed result checks create one team-scoped independent repair over HTTP", async () => {
  const created = await call("/api/work-items", {
    method: "POST",
    body: {
      projectId: "prj_a",
      title: "客户方案 HTTP",
      status: "blocked",
      taskKind: "business_document",
      acceptanceCriteria: ["生成客户方案文档"],
      artifactContract: {
        consumes: [],
        produces: ["business_document"],
        requirements: [{ kind: "business_document", minCount: 1, extensions: [".docx"] }],
      },
      outputAssets: [{
        id: "http_wrong_result",
        originalName: "customer-plan.png",
        path: "results/customer-plan.png",
        terminalId: runtimeState.device.id,
        family: "image",
        size: 12,
        capabilities: [],
      }],
    },
  });
  assert.equal(created.status, 201);

  const repair = await call(`/api/work-items/${created.body.workItem.id}/result-repair`, {
    method: "POST", body: {},
  });
  assert.equal(repair.status, 201, JSON.stringify(repair.body));
  assert.equal(repair.body.workItem.repairOfWorkItemId, created.body.workItem.id);
  assert.equal(repair.body.workItem.executionPolicy, "manual");
  assert.deepEqual(repair.body.workItem.dependencyIds, []);
  assert.deepEqual(repair.body.workItem.artifactHandoffs[0].kinds, ["failed_output_evidence"]);
  assert.equal(repair.body.workItem.artifactHandoffs[0].evidenceOnly, true);

  const replay = await call(`/api/work-items/${created.body.workItem.id}/result-repair`, {
    method: "POST", body: {},
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.workItem.id, repair.body.workItem.id);
  assert.equal((await call(`/api/work-items/${created.body.workItem.id}/result-repair`, {
    token: "tok_b", method: "POST", body: {},
  })).status, 404);
  assert.equal((await call(`/api/work-items/${created.body.workItem.id}`)).body.workItem.status, "blocked");
});

test("structured requester and follow-up context is validated and audited through HTTP", async () => {
  const created = await call("/api/work-items", {
    method: "POST",
    body: {
      projectId: "prj_a",
      title: "Customer follow-up",
      requesterRelation: "customer",
      requesterName: "张总",
      requesterOrganization: "远山科技",
      intakeChannel: "meeting",
      waitingOn: "me",
      commitmentDate: "2099-08-07T17:00:00+08:00",
      nextFollowUpAt: "2099-08-05T10:00:00+08:00",
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.workItem.requesterRelation, "customer");
  assert.equal(created.body.workItem.commitmentDate, "2099-08-07T09:00:00.000Z");

  const workbench = await call("/api/work-items/home-workbench?assigneeId=mine&timezoneOffset=-480");
  assert.equal(workbench.status, 200);
  assert.ok(workbench.body.items.some((item) => item.workItemId === created.body.workItem.id
    && item.requester.relation === "customer"
    && item.nextAction.section === "task"));
  assert.ok(workbench.body.summary.byRelation.customer >= 1);
  assert.equal((await call("/api/work-items/home-workbench?timezoneOffset=not-a-number")).status, 400);

  const updated = await call(`/api/work-items/${created.body.workItem.id}`, {
    method: "PATCH",
    body: {
      expectedRevision: created.body.workItem.revision,
      requesterRelation: "self",
      intakeChannel: "manual",
      waitingOn: "me",
      nextFollowUpAt: null,
    },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.workItem.requesterUserId, "usr_a");
  assert.equal(updated.body.workItem.requesterName, null);
  assert.equal(updated.body.workItem.requesterOrganization, null);

  const activity = await call(`/api/work-items/${created.body.workItem.id}/activity`);
  assert.equal(activity.status, 200);
  assert.equal(activity.body.activities[0].details.followUpContextChanged, true);
  assert.deepEqual(activity.body.activities[0].details.changes.requesterRelation, {
    from: "customer",
    to: "self",
  });

  const foreignRequester = await call("/api/work-items", {
    method: "POST",
    body: {
      projectId: "prj_a",
      title: "Foreign manager",
      requesterRelation: "manager",
      requesterUserId: "usr_b",
    },
  });
  assert.equal(foreignRequester.status, 400);
  assert.equal(foreignRequester.body.error, "invalid_work_item_requester_user");
});

test("structured progress is recorded and replayed through HTTP", async () => {
  const created = await call("/api/work-items", {
    method: "POST",
    body: {
      projectId: "prj_a",
      title: "HTTP progress",
      requesterRelation: "customer",
      requesterName: "Client",
      waitingOn: "me",
    },
  });
  const path = `/api/work-items/${created.body.workItem.id}/progress`;
  const payload = {
    expectedRevision: created.body.workItem.revision,
    idempotencyKey: "http-progress-1",
    summary: "Prototype shared with the customer",
    waitingOn: "requester",
    nextFollowUpAt: "2099-08-06T10:00:00+08:00",
  };
  const recorded = await call(path, { method: "POST", body: payload });
  assert.equal(recorded.status, 201);
  assert.equal(recorded.body.workItem.lastProgressSummary, payload.summary);
  assert.equal(recorded.body.workItem.waitingOn, "requester");
  assert.equal(recorded.body.replayed, false);

  const replayed = await call(path, { method: "POST", body: payload });
  assert.equal(replayed.status, 200);
  assert.equal(replayed.body.replayed, true);
  const activity = await call(`/api/work-items/${created.body.workItem.id}/activity`);
  assert.equal(activity.body.activities.filter((entry) => entry.action === "progress_recorded").length, 1);
  assert.equal(activity.body.activities[0].details.summary, payload.summary);

  const conflict = await call(path, {
    method: "POST",
    body: { ...payload, summary: "Changed payload" },
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, "work_item_progress_idempotency_conflict");
});

test("local work item claim lease is wired through HTTP", async () => {
  const item = (await call("/api/work-items", {
    method: "POST", body: { projectId: "prj_a", title: "Agent owned" },
  })).body.workItem;
  const claimed = await call(`/api/work-items/${item.id}/claim`, {
    method: "POST", body: { agentId: "agt_a", leaseMinutes: 45, idempotencyKey: "http-claim-1" },
  });
  assert.equal(claimed.status, 201);
  assert.equal(claimed.body.claim.claimedBy, "usr_a");
  assert.equal(claimed.body.claim.agentId, "agt_a");
  const released = await call(`/api/work-items/${item.id}/release-claim`, {
    method: "POST", body: { idempotencyKey: "http-release-1" },
  });
  assert.equal(released.status, 200);
  assert.equal(released.body.released, true);
});

test("unassigned local work can be assigned to the authenticated user through HTTP", async () => {
  const item = (await call("/api/work-items", {
    method: "POST", body: { projectId: "prj_a", title: "Needs an owner", assigneeIds: [] },
  })).body.workItem;
  assert.deepEqual(item.assigneeIds, []);

  const assigned = await call(`/api/work-items/${item.id}/assign-to-me`, {
    method: "POST", body: { expectedRevision: item.revision },
  });
  assert.equal(assigned.status, 200);
  assert.deepEqual(assigned.body.workItem.assigneeIds, ["usr_a"]);

  const foreign = await call(`/api/work-items/${item.id}/assign-to-me`, {
    token: "tok_b", method: "POST", body: { expectedRevision: assigned.body.workItem.revision },
  });
  assert.equal(foreign.status, 404);
});

test("routing feedback HTTP endpoint enforces tenancy, revision, and idempotency", async () => {
  runtimeState.autoRuns.push({
    id: "aur_feedback_http",
    projectId: "prj_a",
    teamId: "team_a",
    invocationId: null,
    decision: { path: "develop" },
  });
  const foreign = await call("/api/auto-runs/aur_feedback_http/routing-override", {
    token: "tok_b",
    method: "POST",
    body: { actualPath: "design", reason: "Design output", expectedRevision: 0, idempotencyKey: "http-feedback-1" },
  });
  assert.equal(foreign.status, 404);

  const recorded = await call("/api/auto-runs/aur_feedback_http/routing-override", {
    method: "POST",
    body: { actualPath: "design", reason: "Design output", expectedRevision: 0, idempotencyKey: "http-feedback-1" },
  });
  assert.equal(recorded.status, 200);
  assert.equal(recorded.body.routingOverride.revision, 1);
  assert.equal(recorded.body.routingOverride.idempotencyKey, undefined);

  const replayed = await call("/api/auto-runs/aur_feedback_http/routing-override", {
    method: "POST",
    body: { actualPath: "design", reason: "Design output", expectedRevision: 0, idempotencyKey: "http-feedback-1" },
  });
  assert.equal(replayed.status, 200);
  assert.equal(replayed.body.replayed, true);

  const conflict = await call("/api/auto-runs/aur_feedback_http/routing-override", {
    method: "POST",
    body: { actualPath: "clarify", reason: "Requirements missing", expectedRevision: 0, idempotencyKey: "http-feedback-2" },
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.currentRevision, 1);
});

test("orphan Auto-run writes are still team scoped", async () => {
  runtimeState.autoRuns.push({
    id: "aur_orphan_b",
    projectId: null,
    teamId: "team_b",
    status: "failed",
    decision: { path: "develop" },
  });
  const foreign = await call("/api/auto-runs/aur_orphan_b/routing-override", {
    token: "tok_a",
    method: "POST",
    body: { actualPath: "design", reason: "foreign", expectedRevision: 0, idempotencyKey: "orphan-foreign" },
  });
  assert.equal(foreign.status, 404);
  assert.equal(runtimeState.autoRuns.find((run) => run.id === "aur_orphan_b").routingOverride, undefined);
});

test("team alert webhook is owner-scoped and its secret is never returned", async () => {
  const saved = await call("/api/teams/team_a/alert-webhook", {
    method: "PATCH",
    body: { alertWebhookUrl: "https://hooks.example.test/team-a" },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.team.alertWebhookConfigured, true);
  assert.equal("alertWebhookUrl" in saved.body.team, false);
  assert.equal(runtimeState.teams.find((team) => team.id === "team_a").alertWebhookUrl, "https://hooks.example.test/team-a");

  const foreign = await call("/api/teams/team_a/alert-webhook", {
    token: "tok_b",
    method: "PATCH",
    body: { alertWebhookUrl: "https://hooks.example.test/stolen" },
  });
  assert.equal(foreign.status, 404);

  const snapshot = await call("/api/state");
  const publicTeam = snapshot.body.teams.find((team) => team.id === "team_a");
  assert.equal(publicTeam.alertWebhookConfigured, true);
  assert.equal("alertWebhookUrl" in publicTeam, false);

  const cleared = await call("/api/teams/team_a/alert-webhook", {
    method: "PATCH",
    body: { alertWebhookUrl: null },
  });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.team.alertWebhookConfigured, false);
  assert.equal(runtimeState.teams.find((team) => team.id === "team_a").alertWebhookUrl, null);
});

test("Auto-run list, summary, and routing slices are team scoped", async () => {
  runtimeState.autoRuns.push({
    id: "aur_private_b",
    projectId: "prj_b",
    teamId: "team_b",
    status: "failed",
    decision: { path: "clarify", via: "agent", confidence: 0.4 },
    routingOverride: { actualPath: "develop", idempotencyKey: "must-not-leak", revision: 1 },
  });
  runtimeState.deployments.push(
    { id: "dep_a", projectId: "prj_a", autoRunId: "aur_feedback_http", status: "deployed", at: "2026-07-24T00:00:00.000Z" },
    { id: "dep_b", projectId: "prj_b", autoRunId: "aur_private_b", status: "failed", at: "2026-07-24T00:00:00.000Z" },
  );
  const teamA = await call("/api/auto-runs", { token: "tok_a" });
  assert.equal(teamA.status, 200);
  assert.equal(teamA.body.autoRuns.some((run) => run.id === "aur_private_b"), false);
  assert.equal(teamA.body.summary.total, teamA.body.autoRuns.length);
  assert.equal(teamA.body.summary.routingHealth.byProject.some((row) => row.projectId === "prj_b"), false);
  assert.equal(teamA.body.deployments.total, 1);
  assert.equal(teamA.body.deployments.failed, 0);

  const teamB = await call("/api/auto-runs", { token: "tok_b" });
  assert.equal(teamB.status, 200);
  assert.deepEqual(teamB.body.autoRuns.map((run) => run.id).sort(), ["aur_orphan_b", "aur_private_b"]);
  assert.equal(teamB.body.summary.total, 2);
  assert.equal(teamB.body.deployments.total, 1);
  assert.equal(teamB.body.deployments.failed, 1);
  assert.equal(teamB.body.autoRuns.find((run) => run.id === "aur_private_b").routingOverride.idempotencyKey, undefined);
});

test("GitHub issue binding and sync are wired through HTTP", async () => {
  const item = (await call("/api/work-items", {
    method: "POST", body: { projectId: "prj_a", title: "GitHub linked" },
  })).body.workItem;
  const remote = {
    number: 99, title: "GitHub linked", body: "", state: "open", labels: [],
    url: "https://github.com/acme/repo/issues/99", updatedAt: "2026-07-24T00:00:00.000Z",
  };
  const linked = await call(`/api/work-items/${item.id}/github/link`, {
    method: "POST", body: { expectedRevision: item.revision, remote },
  });
  assert.equal(linked.status, 201);
  const pulled = await call(`/api/work-items/${item.id}/github/sync`, {
    method: "POST",
    body: {
      expectedRevision: item.revision, direction: "pull",
      remote: { ...remote, title: "Updated remotely", updatedAt: "2026-07-24T01:00:00.000Z" },
    },
  });
  assert.equal(pulled.status, 200);
  assert.equal(pulled.body.workItem.title, "Updated remotely");
});

test("external issue intake creates a Local Issue and direct issue execution is refused", async () => {
  const imported = await call("/api/work-items/from-external", {
    method: "POST",
    body: {
      projectId: "prj_a",
      provider: "gitlab",
      relation: "source",
      remote: {
        number: 301,
        title: "Imported GitLab task",
        body: "Remote task body",
        state: "open",
        labels: ["intake"],
        repository: "acme/repo",
        url: "https://gitlab.example/acme/repo/-/issues/301",
        updatedAt: "2026-07-24T00:00:00.000Z",
      },
    },
  });
  assert.equal(imported.status, 201);
  assert.equal(imported.body.workItem.localRef.startsWith("LOCAL-"), true);
  assert.equal(imported.body.workItem.body, "Remote task body");
  assert.equal(imported.body.binding.relation, "source");
  assert.equal(imported.body.binding.isPrimary, true);

  const direct = await call("/api/projects/prj_a/auto-runs", {
    method: "POST",
    body: {
      link: { type: "issue", number: 302, title: "Must be imported first", url: null, state: "open" },
    },
  });
  assert.equal(direct.status, 409);
  assert.equal(direct.body.error, "local_issue_required");
});

test("external issue intake rejects incomplete provider coordinates before fetching", async () => {
  const unsupported = await call("/api/work-items/from-external", {
    method: "POST",
    body: { projectId: "prj_a", provider: "bitbucket", issueNumber: 12 },
  });
  assert.equal(unsupported.status, 400);
  assert.equal(unsupported.body.error, "unsupported_external_provider");

  const missingRepository = await call("/api/work-items/from-external", {
    method: "POST",
    body: { projectId: "prj_a", provider: "gitlab", issueNumber: 12 },
  });
  assert.equal(missingRepository.status, 400);
  assert.equal(missingRepository.body.error, "invalid_provider_repository_or_issue");

  const missingNumber = await call("/api/work-items/from-external", {
    method: "POST",
    body: { projectId: "prj_a", provider: "gitea", repository: "acme/repo" },
  });
  assert.equal(missingNumber.status, 400);
  assert.equal(missingNumber.body.error, "invalid_external_issue_number");
});

test("project external issue controls are persisted and enforced by intake and writeback routes", async () => {
  const disabledIntake = await call("/api/projects/prj_a", {
    method: "PATCH",
    body: { externalIssuePolicy: { intakeEnabled: false, writebackEnabled: true, autoExecutionEnabled: false, emergencyStop: false } },
  });
  assert.equal(disabledIntake.status, 200);
  assert.equal(disabledIntake.body.project.externalIssuePolicy.intakeEnabled, false);

  const refused = await call("/api/work-items/from-external", {
    method: "POST",
    body: {
      projectId: "prj_a", provider: "gitlab",
      remote: { number: 401, title: "Blocked intake", body: "", state: "open", repository: "acme/repo" },
    },
  });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, "external_issue_intake_disabled");

  await call("/api/projects/prj_a", {
    method: "PATCH",
    body: { externalIssuePolicy: { intakeEnabled: true, writebackEnabled: true, autoExecutionEnabled: false, emergencyStop: false } },
  });
  const imported = await call("/api/work-items/from-external", {
    method: "POST",
    body: {
      projectId: "prj_a", provider: "gitlab",
      remote: { number: 402, title: "Writeback governed", body: "", state: "open", repository: "acme/repo", updatedAt: "2026-07-24T00:00:00.000Z" },
    },
  });
  await call("/api/projects/prj_a", {
    method: "PATCH",
    body: { externalIssuePolicy: { intakeEnabled: true, writebackEnabled: false, autoExecutionEnabled: false, emergencyStop: false } },
  });
  const blockedPush = await call(`/api/work-items/${imported.body.workItem.id}/external-bindings/gitlab/sync`, {
    method: "POST",
    body: { expectedRevision: imported.body.workItem.revision, direction: "push" },
  });
  assert.equal(blockedPush.status, 409);
  assert.equal(blockedPush.body.error, "external_issue_writeback_disabled");

  await call("/api/projects/prj_a", {
    method: "PATCH",
    body: { externalIssuePolicy: { intakeEnabled: true, writebackEnabled: true, autoExecutionEnabled: false, emergencyStop: true } },
  });
  const stoppedWebhook = await externalWebhook("gitlab", {
    project: { path_with_namespace: "acme/repo" },
    object_attributes: { iid: 402, title: "Must not overwrite", state: "opened", labels: [], updated_at: "2026-07-25T00:00:00.000Z" },
  }, { deliveryId: "gitlab-emergency-stop" });
  assert.equal(stoppedWebhook.status, 202);
  assert.equal(stoppedWebhook.body.reason, "external_issue_emergency_stop");
  assert.equal((await call(`/api/work-items/${imported.body.workItem.id}`)).body.workItem.title, "Writeback governed");

  await call("/api/projects/prj_a", {
    method: "PATCH",
    body: { externalIssuePolicy: { intakeEnabled: true, writebackEnabled: true, autoExecutionEnabled: false, emergencyStop: false } },
  });
});

test("GitHub webhook uses HMAC auth, supports rotation, and keeps replay team scoped", async () => {
  const item = (await call("/api/work-items", {
    method: "POST", body: { projectId: "prj_a", title: "Webhook linked" },
  })).body.workItem;
  await call(`/api/work-items/${item.id}/github/link`, {
    method: "POST",
    body: {
      expectedRevision: item.revision,
      remote: {
        number: 199, title: "Webhook linked", body: "", state: "open", labels: [],
        repository: "acme/repo", updatedAt: "2026-07-24T00:00:00.000Z",
      },
    },
  });
  const payload = {
    repository: { full_name: "acme/repo" },
    issue: {
      number: 199, title: "Webhook updated", body: "", state: "open", labels: [],
      html_url: "https://github.test/acme/repo/issues/199",
      updated_at: "2026-07-24T01:00:00.000Z",
    },
  };
  assert.equal((await webhook(payload, { secret: "wrong-secret", deliveryId: "bad-signature" })).status, 401);
  const accepted = await webhook(payload, { deliveryId: "valid-signature" });
  assert.equal(accepted.status, 202);
  assert.equal(accepted.body.synced, 1);
  assert.equal((await call(`/api/work-items/github/deliveries/valid-signature/replay`, {
    token: "tok_b", method: "POST",
  })).status, 404);
  process.env.MYAGENTTOOL_GITHUB_WEBHOOK_SECRET = "webhook-secret-b";
  assert.equal((await webhook(payload, {
    secret: "webhook-secret-a", deliveryId: "old-secret",
  })).status, 401);
  assert.equal((await webhook(payload, {
    secret: "webhook-secret-b", deliveryId: "new-secret",
  })).status, 202);
  const diagnostics = await call("/api/work-items/github/diagnostics");
  assert.equal(diagnostics.body.secretConfigured, true);
  assert.equal(diagnostics.body.recentFailures.length >= 2, true);
});

test("structured verification gates completion over HTTP", async () => {
  let item = (await call("/api/work-items", {
    method: "POST",
    body: { projectId: "prj_a", title: "Acceptance gated", acceptanceCriteria: ["Tests pass"] },
  })).body.workItem;
  assert.equal((await call(`/api/work-items/${item.id}`, {
    method: "PATCH", body: { expectedRevision: item.revision, status: "done" },
  })).status, 409);
  const verified = await call(`/api/work-items/${item.id}/verifications`, {
    method: "POST",
    body: {
      expectedRevision: item.revision, kind: "test", status: "passed", command: "pnpm test",
      summary: "Passed", acceptanceResults: [{ criterion: "Tests pass", status: "passed" }],
      evidence: [{ kind: "run", ref: "run:http-test", summary: "HTTP integration" }],
    },
  });
  assert.equal(verified.status, 201);
  item = verified.body.workItem;
  assert.equal(item.completionGate.ready, true);
  assert.equal((await call(`/api/work-items/${item.id}`, {
    method: "PATCH", body: { expectedRevision: item.revision, status: "done" },
  })).status, 200);
});

test("human attention queue is exposed over HTTP", async () => {
  const item = (await call("/api/work-items", {
    method: "POST",
    body: {
      projectId: "prj_a", title: "Needs acceptance",
      status: "review", acceptanceCriteria: ["Human sign-off"],
    },
  })).body.workItem;
  const attention = await call("/api/work-items/attention?projectId=prj_a");
  assert.equal(attention.status, 200);
  assert.equal(attention.body.items.some((row) =>
    row.kind === "acceptance_blocked" && row.workItemId === item.id), true);
  assert.equal((await call("/api/work-items/attention", { token: "tok_b" })).body.items.length, 0);
});

test("foreign work items and projects are existence-hidden", async () => {
  const created = await call("/api/work-items", {
    method: "POST",
    body: { projectId: "prj_a", title: "Private" },
  });
  assert.equal((await call(`/api/work-items/${created.body.workItem.id}`, { token: "tok_b" })).status, 404);
  assert.equal((await call(`/api/work-items/${created.body.workItem.id}/external-bindings`, {
    token: "tok_b",
    method: "POST",
    body: { provider: "gitlab", repository: "private/repo", issueNumber: 1, expectedRevision: 1 },
  })).status, 404);
  const foreignProject = await call("/api/work-items", {
    token: "tok_a", method: "POST", body: { projectId: "prj_b", title: "Denied" },
  });
  assert.equal(foreignProject.status, 404);
});

test("HTTP local Issue creation pins and preserves a published business routine binding", async () => {
  runtimeState.workflowSources.push({
    id: "wfs_http_routine", ownerTeamId: "team_a", projectId: "prj_a", state: "active",
  });
  runtimeState.workflowArtifacts.push({
    id: "wfa_http_inquiry", ownerTeamId: "team_a", projectId: "prj_a",
    sourceId: "wfs_http_routine", availability: "available",
  });
  runtimeState.routineDefinitions.push({
    id: "rtd_http_inquiry", ownerTeamId: "team_a", projectId: "prj_a",
    sourceId: "wfs_http_routine", version: 1, state: "published",
  });
  runtimeState.businessCases.push({
    id: "bcs_http_inquiry", ownerTeamId: "team_a", projectId: "prj_a",
    sourceId: "wfs_http_routine", businessKey: "RFQ-HTTP-001", state: "proposed",
  });
  const payload = {
    projectId: "prj_a",
    title: "Process RFQ-HTTP-001",
    routineDefinitionId: "rtd_http_inquiry",
    routineVersion: 1,
    businessCaseId: "bcs_http_inquiry",
    businessKey: "RFQ-HTTP-001",
    triggerArtifactIds: ["wfa_http_inquiry"],
  };
  const unconfirmed = await call("/api/work-items", { method: "POST", body: payload });
  assert.equal(unconfirmed.status, 409);
  assert.equal(unconfirmed.body.error, "work_item_business_case_not_confirmed");
  runtimeState.businessCases.at(-1).state = "confirmed";
  const created = await call("/api/work-items", { method: "POST", body: payload });
  assert.equal(created.status, 201);
  assert.equal(created.body.workItem.type, "task");
  assert.equal(created.body.workItem.routineDefinitionId, "rtd_http_inquiry");
  const replay = await call("/api/work-items", {
    method: "POST",
    body: { ...payload, title: "Duplicate request" },
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.workItem.id, created.body.workItem.id);
  const rebind = await call(`/api/work-items/${created.body.workItem.id}`, {
    method: "PATCH",
    body: { expectedRevision: created.body.workItem.revision, businessKey: "RFQ-HTTP-OTHER" },
  });
  assert.equal(rebind.status, 409);
  assert.equal(rebind.body.error, "work_item_routine_binding_immutable");
});

test("close and archive transitions are revision gated", async () => {
  const item = (await call("/api/work-items", {
    method: "POST", body: { projectId: "prj_a", title: "Lifecycle" },
  })).body.workItem;
  assert.equal((await call(`/api/work-items/${item.id}/close`, {
    method: "POST", body: { expectedRevision: 9 },
  })).status, 409);
  const closed = await call(`/api/work-items/${item.id}/close`, {
    method: "POST", body: { expectedRevision: 1 },
  });
  assert.equal(closed.body.workItem.state, "closed");
});

test("comments and activity timeline are available through nested endpoints", async () => {
  const item = (await call("/api/work-items", {
    method: "POST", body: { projectId: "prj_a", title: "Discuss over HTTP" },
  })).body.workItem;
  const created = await call(`/api/work-items/${item.id}/comments`, {
    method: "POST", body: { body: "Initial comment" },
  });
  assert.equal(created.status, 201);
  const edited = await call(`/api/work-items/${item.id}/comments/${created.body.comment.id}`, {
    method: "PATCH", body: { expectedRevision: 1, body: "Edited comment" },
  });
  assert.equal(edited.body.comment.body, "Edited comment");
  assert.equal((await call(`/api/work-items/${item.id}/comments`)).body.count, 1);
  const activity = await call(`/api/work-items/${item.id}/activity`);
  assert.equal(activity.status, 200);
  assert.equal(activity.body.activities.some((row) => row.action === "comment_updated"), true);
  assert.equal((await call(`/api/work-items/${item.id}/activity`, { token: "tok_b" })).status, 404);
});

test("a local issue creates a linked git worktree without a GitHub issue binding", async () => {
  const item = (await call("/api/work-items", {
    method: "POST", body: { projectId: "prj_a", title: "Local execution" },
  })).body.workItem;
  const result = await call(`/api/work-items/${item.id}/worktrees`, { method: "POST", body: {} });
  assert.equal(result.status, 201);
  assert.equal(result.body.worktree.link.type, "local_issue");
  assert.equal(result.body.worktree.link.number, item.localNumber);
  const detail = await call(`/api/work-items/${item.id}`);
  assert.equal(detail.body.workItem.executionBindings[0].worktreeId, result.body.worktree.id);
  const activity = await call(`/api/work-items/${item.id}/activity`);
  assert.equal(activity.body.activities.some((row) => row.action === "worktree_created"), true);
});

test("a report-only AI task reaches the same simple result review flow through HTTP", async () => {
  const created = await call("/api/work-items", {
    method: "POST",
    body: {
      projectId: "prj_a",
      title: "Archive and summarize the article",
      dueDate: "2099-08-08",
      waitingOn: "me",
    },
  });
  const stored = runtimeState.workItems.find((candidate) => candidate.id === created.body.workItem.id);
  const completedAt = new Date().toISOString();
  const autoRun = {
    id: `aur_report_${stored.localNumber}`,
    status: "report_posted",
    phase: "review_ready",
    projectId: stored.projectId,
    invocationId: `inv_report_${stored.localNumber}`,
    link: { type: "local_issue", number: stored.localNumber, title: stored.title },
    decision: { path: "summarize", confidence: 0.93, rationale: "Article summary requested" },
    report: "# Article result\n\nThe platform packages AI work into a repeatable delivery workflow.\n\n### Local archive\n\n- artifacts/article.md",
    createdAt: completedAt,
    updatedAt: completedAt,
  };
  runtimeState.autoRuns.unshift(autoRun);
  runtimeState.invocations.unshift({
    id: autoRun.invocationId,
    status: "succeeded",
    options: { metadata: { autoRunId: autoRun.id, role: "summarize" } },
    createdAt: completedAt,
    completedAt,
    updatedAt: completedAt,
  });
  stored.executionBindings.push({ kind: "auto_run", targetId: autoRun.id, createdAt: completedAt });
  stored.status = "review";
  stored.waitingOn = "me";

  const detail = await call(`/api/work-items/${stored.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.observability.latestRun.status, "report_posted");
  assert.equal(detail.body.observability.outcome.status, "available");
  assert.match(detail.body.observability.outcome.summary, /repeatable delivery workflow/);

  const home = await call("/api/work-items/home-workbench?assigneeId=mine&timezoneOffset=-480");
  const row = home.body.items.find((candidate) => candidate.workItemId === stored.id);
  assert.equal(row.userStatus, "ready_for_review");
  assert.equal(row.attentionReason, "review_ready");
  assert.equal(row.nextAction.kind, "review_result");
  assert.equal(row.nextAction.targetId, stored.id);
  assert.equal(row.nextAction.section, "task");
  assert.equal(row.result.status, "available");
  assert.match(row.result.summary, /repeatable delivery workflow/);
});

test("approved local delivery fast-forwards the base and only then closes the issue", async () => {
  const item = (await call("/api/work-items", {
    method: "POST", body: {
      projectId: "prj_a",
      title: "Deliver over HTTP",
      acceptanceCriteria: ["The delivery is ready to apply"],
    },
  })).body.workItem;
  const created = await call(`/api/work-items/${item.id}/worktrees`, { method: "POST", body: {} });
  const worktree = created.body.worktree;
  writeFileSync(join(worktree.worktreePath, `DELIVERY-${item.localNumber}.txt`), "delivered\n");
  execFileSync("git", ["-C", worktree.worktreePath, "add", "."]);
  execFileSync("git", ["-C", worktree.worktreePath, "commit", "-m", `deliver ${item.localRef}`]);
  const stored = runtimeState.workItems.find((candidate) => candidate.id === item.id);
  const autoRun = {
    id: `aur_delivery_${item.localNumber}`,
    status: "done",
    projectId: item.projectId,
    worktreeId: worktree.id,
    link: { type: "local_issue", number: item.localNumber, title: item.title },
    localDelivery: { worktreeId: worktree.id, branchName: worktree.branchName },
    updatedAt: new Date().toISOString(),
  };
  runtimeState.autoRuns.unshift(autoRun);
  stored.executionBindings.push({
    kind: "auto_run", targetId: autoRun.id, worktreeId: worktree.id, createdAt: new Date().toISOString(),
  });
  stored.status = "review";
  const review = await call(`/api/worktrees/${worktree.id}/review`, {
    method: "POST", body: { verdict: "approved", summary: "Ready" },
  });
  assert.equal(review.status, 201);

  let detail = await call(`/api/work-items/${item.id}`);
  assert.equal(detail.body.observability.nextAction, "review_delivery");
  assert.equal(detail.body.observability.delivery.mode, "local_merge");
  const verified = await call(`/api/work-items/${item.id}/verifications`, {
    method: "POST",
    body: {
      expectedRevision: detail.body.workItem.revision,
      kind: "review",
      status: "passed",
      summary: "Delivery reviewed",
      acceptanceResults: [{ criterion: "The delivery is ready to apply", status: "passed" }],
      evidence: [{ kind: "run", ref: `worktree:${worktree.id}`, summary: "Approved worktree review" }],
    },
  });
  assert.equal(verified.status, 201);
  detail = await call(`/api/work-items/${item.id}`);
  const delivered = await call(`/api/work-items/${item.id}/delivery/local`, {
    method: "POST", body: { expectedRevision: detail.body.workItem.revision },
  });
  assert.equal(delivered.status, 200);
  assert.equal(delivered.body.workItem.status, "done");
  assert.equal(delivered.body.workItem.state, "closed");
  assert.equal(execFileSync("git", ["-C", projectAPath, "show", `HEAD:DELIVERY-${item.localNumber}.txt`], { encoding: "utf8" }).trim(), "delivered");
});

test("a local issue starts an auto-run with its local body and acceptance criteria", async () => {
  const item = (await call("/api/work-items", {
    method: "POST",
    body: {
      projectId: "prj_a",
      title: "Run locally",
      body: "Implement the local workflow.",
      acceptanceCriteria: ["The local path is tested"],
    },
  })).body.workItem;
  const result = await call(`/api/work-items/${item.id}/auto-runs`, { method: "POST", body: {} });
  assert.equal(result.status, 202);
  assert.equal(result.body.autoRun.phase, "understanding");
  assert.equal(result.body.autoRun.worktreeId, null);
  assert.equal(result.body.autoRun.decision, null, "routing is performed after the HTTP handoff");
  const autoRun = await waitForValue(() => {
    const candidate = runtimeState.autoRuns.find((row) => row.id === result.body.autoRun.id);
    return candidate?.invocationId ? candidate : null;
  });
  assert.equal(autoRun.link.type, "local_issue");
  assert.equal(autoRun.issueBody.includes("Implement the local workflow."), true);
  assert.equal(autoRun.issueBody.includes("The local path is tested"), true);
  assert.match(autoRun.issueBody, /Acceptance criteria \(frozen for this run\)/);
  assert.match(autoRun.issueBody, /Owner verification SOP \(frozen for this run\)/);
  assert.equal(autoRun.executionChainId, item.id);
  assert.equal(autoRun.autonomyProfile, "standard");
  assert.equal(autoRun.terminalId, item.terminalId);
  assert.match(autoRun.branchName, /-autorun-\d+$/, "the AI branch cannot collide with a manually created worktree branch");
  const invocation = runtimeState.invocations.find((row) => row.id === autoRun.invocationId);
  assert.equal(invocation.terminalId, item.terminalId);
  assert.equal(invocation.options.metadata.executionChainId, item.id);
  const approval = runtimeState.approvalRequests.find((row) => row.invocationId === invocation.id);
  if (approval) assert.equal(approval.terminalId, item.terminalId);
  const detail = await call(`/api/work-items/${item.id}`);
  const binding = detail.body.workItem.executionBindings.find((candidate) => candidate.kind === "auto_run");
  assert.equal(binding?.targetId, autoRun.id);
  assert.equal(binding?.worktreeId, autoRun.worktreeId);
});

test("a local issue without a confirmed execution contract is prepared after handoff and starts AI", async () => {
  const item = (await call("/api/work-items", {
    method: "POST",
    body: { projectId: "prj_a", title: "Run without explicit criteria", body: "Keep the workflow predictable." },
  })).body.workItem;
  const result = await call(`/api/work-items/${item.id}/auto-runs`, { method: "POST", body: {} });
  assert.equal(result.status, 202, JSON.stringify(result.body));
  assert.equal(result.body.autoRun.phase, "understanding");
  const autoRun = await waitForValue(() => {
    const candidate = runtimeState.autoRuns.find((row) => row.id === result.body.autoRun.id);
    return candidate?.executionPlan?.status === "ready" && candidate?.invocationId ? candidate : null;
  });
  assert.equal(autoRun.link.type, "local_issue");
  assert.equal(autoRun.executionPlan.confirmedBy, "ai_policy");
  assert.ok(autoRun.executionPlan.acceptanceCriteria.length > 0);
  assert.ok(autoRun.executionPlan.verificationSop.length > 0);
  const detail = await call(`/api/work-items/${item.id}`);
  assert.equal(detail.body.workItem.executionContractSource, "assisted");
  assert.ok(detail.body.workItem.executionContractConfirmedAt);
});

test("local issues can be queued as a durable concurrency-limited Auto-run batch", async () => {
  const first = (await call("/api/work-items", {
    method: "POST",
    body: { projectId: "prj_a", title: "Batch task one", acceptanceCriteria: ["Batch task one is complete"] },
  })).body.workItem;
  const second = (await call("/api/work-items", {
    method: "POST",
    body: { projectId: "prj_a", title: "Batch task two", acceptanceCriteria: ["Batch task two is complete"] },
  })).body.workItem;

  const created = await call("/api/work-item-auto-run-batches", {
    method: "POST",
    body: {
      workItemIds: [first.id, second.id],
      maxConcurrent: 1,
      idempotencyKey: "http-batch-1",
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.batch.total, 2);
  assert.equal(created.body.batch.maxConcurrent, 1);
  assert.equal(created.body.batch.counts.queued, 2);
  assert.equal(created.body.batch.agentId, "agt_codex_cli");
  assert.equal(created.body.batch.agentResolution, "canonical_default");
  assert.equal(created.body.replayed, false);

  const replayed = await call("/api/work-item-auto-run-batches", {
    method: "POST",
    body: {
      workItemIds: [first.id, second.id],
      maxConcurrent: 1,
      idempotencyKey: "http-batch-1",
    },
  });
  assert.equal(replayed.status, 200);
  assert.equal(replayed.body.replayed, true);
  assert.equal(replayed.body.batch.id, created.body.batch.id);

  const conflict = await call("/api/work-item-auto-run-batches", {
    method: "POST",
    body: {
      workItemIds: [first.id],
      maxConcurrent: 1,
      idempotencyKey: "http-batch-1",
    },
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, "idempotency_key_conflict");

  const demoAgent = await call("/api/work-item-auto-run-batches", {
    method: "POST",
    body: {
      workItemIds: [first.id],
      maxConcurrent: 1,
      agentId: "agt_demo_cli",
      idempotencyKey: "http-batch-demo-agent",
    },
  });
  assert.equal(demoAgent.status, 409);
  assert.equal(demoAgent.body.error, "batch_agent_not_eligible");
  assert.equal(demoAgent.body.reason, "demo_agent_not_allowed");

  const listed = await call("/api/work-item-auto-run-batches");
  assert.equal(listed.status, 200);
  assert.equal(listed.body.batches.some((batch) => batch.id === created.body.batch.id), true);
});

test("AI assistance and alert retry routes are scoped and governed", async () => {
  const draft = await call("/api/work-items/assist/draft", {
    method: "POST",
    body: { projectId: "prj_a", title: "Fix checkout error", body: "Checkout fails for signed-in users." },
  });
  assert.equal(draft.status, 200);
  assert.equal(draft.body.draft.type, "bug");
  assert.deepEqual(draft.body.draft.templateMatch.decision, {
    kind: "no_match", confidence: "low", reason: "insufficient_evidence",
  });
  assert.equal((await call("/api/work-items/assist/draft", {
    token: "tok_b", method: "POST", body: { projectId: "prj_a", title: "Foreign" },
  })).status, 404);

  const item = (await call("/api/work-items", {
    method: "POST", body: { projectId: "prj_a", title: "Alert ownership" },
  })).body.workItem;
  runtimeState.alertOutbox.unshift({
    id: "aob_http_retry",
    alert: { kind: "run_failed", data: { localIssueId: item.id } },
    status: "failed",
    attempts: 8,
    nextAttemptAt: null,
    sentAt: null,
    lastError: "offline",
  });
  const retried = await call(`/api/work-items/${item.id}/alerts/aob_http_retry/retry`, { method: "POST" });
  assert.equal(retried.status, 200);
  assert.equal(retried.body.alert.status, "queued");
  runtimeState.alertOutbox[0].status = "sent";
  assert.equal((await call(`/api/work-items/${item.id}/alerts/aob_http_retry/retry`, {
    method: "POST",
  })).status, 409);
  assert.equal((await call(`/api/work-items/${item.id}/alerts/aob_http_retry/retry`, {
    token: "tok_b", method: "POST",
  })).status, 404);
});

test("external provider capability and manual issue sync contract are wired over HTTP", async () => {
  const catalog = await call("/api/work-items/providers");
  assert.equal(catalog.status, 200);
  assert.equal(catalog.body.providers.find(({ id }) => id === "github").apiSync, true);
  assert.equal(catalog.body.providers.find(({ id }) => id === "gitlab").apiSync, false);

  const item = (await call("/api/work-items", {
    method: "POST", body: { projectId: "prj_a", title: "GitLab portable" },
  })).body.workItem;
  const remote = {
    number: 31, title: "GitLab portable", body: "", state: "open", labels: [],
    repository: "acme/repo", url: "https://gitlab.example/acme/repo/-/issues/31",
    updatedAt: "2026-07-24T01:00:00.000Z",
  };
  const linked = await call(`/api/work-items/${item.id}/external-bindings`, {
    method: "POST", body: { expectedRevision: item.revision, provider: "gitlab", remote },
  });
  assert.equal(linked.status, 201);
  assert.equal(linked.body.binding.provider, "gitlab");

  const pulled = await call(`/api/work-items/${item.id}/external-bindings/gitlab/sync`, {
    method: "POST",
    body: {
      expectedRevision: item.revision, direction: "pull",
      remote: { ...remote, title: "Pulled from GitLab", updatedAt: "2026-07-24T02:00:00.000Z" },
    },
  });
  assert.equal(pulled.status, 200);
  assert.equal(pulled.body.workItem.title, "Pulled from GitLab");
  assert.equal((await call(`/api/work-items/${item.id}/external-bindings/gitlab/sync`, {
    token: "tok_b", method: "POST", body: { expectedRevision: 1, direction: "pull", remote },
  })).status, 404);
});

test("GitLab and Gitea webhooks reject bad signatures and deduplicate deliveries", async () => {
  for (const provider of ["gitlab", "gitea"]) {
    const number = provider === "gitlab" ? 61 : 62;
    const item = (await call("/api/work-items", {
      method: "POST", body: { projectId: "prj_a", title: `${provider} webhook` },
    })).body.workItem;
    await call(`/api/work-items/${item.id}/external-bindings`, {
      method: "POST",
      body: {
        expectedRevision: item.revision,
        provider,
        remote: {
          number, title: `${provider} webhook`, body: "", state: "open", labels: [],
          repository: "acme/repo", updatedAt: "2026-07-24T00:00:00.000Z",
        },
      },
    });
    const issue = {
      number, iid: number, title: `${provider} accepted once`, description: "", body: "",
      state: "opened", labels: [], updated_at: "2026-07-24T03:00:00.000Z",
    };
    const payload = provider === "gitlab"
      ? { project: { path_with_namespace: "acme/repo" }, object_attributes: issue }
      : { repository: { full_name: "acme/repo" }, issue: { ...issue, state: "open" } };
    const deliveryId = `${provider}-dedupe-http`;

    assert.equal((await externalWebhook(provider, payload, {
      secret: "invalid-secret", deliveryId: `${deliveryId}-bad`,
    })).status, 401);
    const accepted = await externalWebhook(provider, payload, { deliveryId });
    assert.equal(accepted.status, 202, JSON.stringify({ provider, accepted }));
    assert.equal(accepted.body.synced, 1);
    const replayed = await externalWebhook(provider, payload, { deliveryId });
    assert.equal(replayed.status, 200);
    assert.equal(replayed.body.replayed, true);

    const refreshed = await call(`/api/work-items/${item.id}`);
    assert.equal(refreshed.body.workItem.title, `${provider} accepted once`);
  }
});

test("planning projects manage local issue membership over HTTP", async () => {
  const item = (await call("/api/work-items", {
    method: "POST", body: { projectId: "prj_a", title: "Plan membership" },
  })).body.workItem;
  const created = await call("/api/planning-projects", {
    method: "POST", body: { name: "Q3 roadmap", description: "Delivery plan" },
  });
  assert.equal(created.status, 201);
  const planningProjectId = created.body.project.id;
  assert.equal((await call(`/api/planning-projects/${planningProjectId}/items/${item.id}`, {
    method: "PUT",
  })).status, 201);
  const detail = await call(`/api/planning-projects/${planningProjectId}`);
  assert.equal(detail.body.project.items[0].workItem.id, item.id);
  const filtered = await call(`/api/work-items?planningProjectId=${planningProjectId}`);
  assert.equal(filtered.body.count, 1);
  assert.equal(filtered.body.workItems[0].planningProjects[0].name, "Q3 roadmap");
  assert.equal((await call(`/api/planning-projects/${planningProjectId}`, { token: "tok_b" })).status, 404);
  const archived = await call(`/api/planning-projects/${planningProjectId}/archive`, {
    method: "POST", body: { expectedRevision: 1 },
  });
  assert.ok(archived.body.project.archivedAt);
  const restored = await call(`/api/planning-projects/${planningProjectId}/restore`, {
    method: "POST", body: { expectedRevision: 2 },
  });
  assert.equal(restored.body.project.archivedAt, null);
});

test("planning AI plans are review-only and autonomy reaches local executions", async () => {
  const item = (await call("/api/work-items", {
    method: "POST", body: {
      projectId: "prj_a",
      title: "Cautious planning work",
      acceptanceCriteria: ["The planned change meets its stated goal"],
    },
  })).body.workItem;
  const project = (await call("/api/planning-projects", {
    method: "POST", body: { name: "Governed plan", autonomyProfile: "cautious" },
  })).body.project;
  await call(`/api/planning-projects/${project.id}/items/${item.id}`, { method: "PUT" });
  const suggestion = await call(`/api/planning-projects/${project.id}/assist/plan`, {
    method: "POST", body: {},
  });
  assert.equal(suggestion.status, 200);
  assert.equal(suggestion.body.plan.requiresApproval, true);
  assert.equal(suggestion.body.plan.autonomyProfile, "cautious");
  const execution = await call(`/api/work-items/${item.id}/auto-runs`, { method: "POST", body: {} });
  assert.equal(execution.status, 202);
  assert.equal(execution.body.autoRun.autonomyProfile, "cautious");
});

test("planning fields, bulk updates, and project ordering are wired over HTTP", async () => {
  const first = (await call("/api/work-items", {
    method: "POST",
    body: { projectId: "prj_a", title: "First ordered", dueDate: "2026-08-15", milestone: "M3" },
  })).body.workItem;
  const second = (await call("/api/work-items", {
    method: "POST", body: { projectId: "prj_a", title: "Second ordered" },
  })).body.workItem;
  const bulk = await call("/api/work-items/bulk", {
    method: "PATCH",
    body: {
      items: [{ id: first.id, expectedRevision: 1 }, { id: second.id, expectedRevision: 1 }],
      changes: { status: "ready", plannedDate: "2026-08-01", carriedFromDate: "2026-07-31" },
    },
  });
  assert.equal(bulk.status, 200);
  assert.equal(bulk.body.count, 2);
  assert.ok(bulk.body.workItems.every((item) => item.plannedDate === "2026-08-01"));
  assert.ok(bulk.body.workItems.every((item) => item.carriedFromDate === "2026-07-31"));
  const project = (await call("/api/planning-projects", {
    method: "POST", body: { name: "Ordered roadmap" },
  })).body.project;
  const membership = await call(`/api/planning-projects/${project.id}/items`, {
    method: "PATCH", body: { addWorkItemIds: [first.id, second.id], removeWorkItemIds: [] },
  });
  assert.deepEqual(membership.body.project.items.map((row) => row.workItem.id), [first.id, second.id]);
  const reordered = await call(`/api/planning-projects/${project.id}/items`, {
    method: "PUT",
    body: { expectedRevision: 2, workItemIds: [second.id, first.id] },
  });
  assert.equal(reordered.status, 200);
  assert.deepEqual(reordered.body.project.items.map((row) => row.workItem.id), [second.id, first.id]);
});

test("governed report drafts preview an exact target and send with a durable receipt without closing work", async () => {
  const created = await call("/api/work-items", {
    method: "POST",
    body: {
      projectId: "prj_a",
      title: "Customer launch report",
      status: "review",
      requesterRelation: "customer",
      requesterName: "HTTP Customer",
      waitingOn: "requester",
    },
  });
  assert.equal(created.status, 201);
  const item = created.body.workItem;
  const generated = await call(`/api/work-items/${item.id}/report-drafts`, {
    method: "POST",
    body: {
      expectedWorkItemRevision: item.revision,
      idempotencyKey: "http-report-generate",
      tone: "concise",
    },
  });
  assert.equal(generated.status, 201);
  assert.equal(generated.body.reportDraft.status, "draft");
  assert.equal(generated.body.reportDraft.audience.name, "HTTP Customer");
  assert.equal((await call(`/api/work-items/${item.id}/report-drafts`, { token: "tok_b" })).status, 404);

  const edited = await call(`/api/work-items/${item.id}/report-drafts/${generated.body.reportDraft.id}`, {
    method: "PATCH",
    body: {
      expectedRevision: generated.body.reportDraft.revision,
      content: "The launch is ready for the customer review checkpoint.",
    },
  });
  assert.equal(edited.status, 200);
  const confirmed = await call(`/api/work-items/${item.id}/report-drafts/${edited.body.reportDraft.id}/confirm`, {
    method: "POST",
    body: {
      expectedRevision: edited.body.reportDraft.revision,
      idempotencyKey: "http-report-confirm",
    },
  });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.reportDraft.status, "confirmed");
  assert.equal(confirmed.body.reportDraft.confirmedSnapshot.content, edited.body.reportDraft.content);
  const replayed = await call(`/api/work-items/${item.id}/report-drafts/${edited.body.reportDraft.id}/confirm`, {
    method: "POST",
    body: {
      expectedRevision: edited.body.reportDraft.revision,
      idempotencyKey: "http-report-confirm",
    },
  });
  assert.equal(replayed.status, 200);
  assert.equal(replayed.body.replayed, true);
  const unchanged = await call(`/api/work-items/${item.id}`);
  assert.equal(unchanged.body.workItem.status, "review");
  assert.equal(unchanged.body.workItem.state, "open");
  assert.equal(unchanged.body.workItem.revision, item.revision);
  const listed = await call(`/api/work-items/${item.id}/report-drafts`);
  assert.equal(listed.status, 200);
  assert.equal(listed.body.count, 1);

  runtimeState.channels.push({
    id: "chn_http_report",
    ownerTeamId: "team_a",
    provider: "wecom",
    name: "HTTP customer updates",
    status: "enabled",
  });
  runtimeState.channelConversations.push({
    id: "ccv_http_customer",
    channelId: "chn_http_report",
    ownerTeamId: "team_a",
    externalUserId: "wx_http_customer",
    status: "active",
  });
  const previewed = await call(`/api/work-items/${item.id}/report-drafts/${confirmed.body.reportDraft.id}/deliveries`, {
    method: "POST",
    body: {
      channelId: "chn_http_report",
      conversationId: "ccv_http_customer",
      idempotencyKey: "http-report-preview",
    },
  });
  assert.equal(previewed.status, 201);
  assert.equal(previewed.body.reportDelivery.status, "preview");
  assert.equal(previewed.body.reportDelivery.target.recipientId, "wx_http_customer");
  assert.equal((await call(
    `/api/work-items/${item.id}/report-drafts/${confirmed.body.reportDraft.id}/deliveries`,
    { token: "tok_b" },
  )).status, 404);
  const grant = await call("/api/approvals/grants", {
    method: "POST",
    body: { action: "work_item.report.deliver", targetId: previewed.body.reportDelivery.id },
  });
  assert.equal(grant.status, 201);
  const sent = await call(
    `/api/work-items/${item.id}/report-drafts/${confirmed.body.reportDraft.id}/deliveries/${previewed.body.reportDelivery.id}/send`,
    {
      method: "POST",
      body: {
        expectedRevision: previewed.body.reportDelivery.revision,
        idempotencyKey: "http-report-send",
        approvalToken: grant.body.token,
      },
    },
  );
  assert.equal(sent.status, 202);
  assert.equal(sent.body.reportDelivery.status, "queued");
  assert.equal(sent.body.reportDelivery.receipt.status, "queued");
  assert.ok(sent.body.reportDelivery.channelDeliveryIds.length > 0);
  assert.ok(sent.body.reportDelivery.channelDeliveryIds.every((id) =>
    runtimeState.channelDeliveries.some((delivery) =>
      delivery.id === id
      && delivery.sourceContext?.reportDeliveryId === previewed.body.reportDelivery.id)));
  const stillOpen = await call(`/api/work-items/${item.id}`);
  assert.equal(stillOpen.body.workItem.status, "review");
  assert.equal(stillOpen.body.workItem.state, "open");
  assert.equal(stillOpen.body.workItem.revision, item.revision);
});

test("local content search and task references are tenant-scoped through the real HTTP server", async () => {
  writeFileSync(join(projectAPath, "library-source.txt"), "HTTP local library integration phrase.\n");
  const producer = await call("/api/work-items", {
    method: "POST",
    body: { projectId: "prj_a", title: "Produce local library source", type: "task" },
  });
  assert.equal(producer.status, 201);
  const producerState = runtimeState.workItems.find((item) => item.id === producer.body.workItem.id);
  producerState.outputAssets = [{
    id: "http_local_content_output",
    originalName: "library-source.txt",
    path: "library-source.txt",
    family: "text",
    mimeType: "text/plain",
    readiness: { state: "ready", reason: "available" },
  }];

  const rebuilt = await call("/api/local-content/rebuild", { method: "POST", body: {} });
  assert.equal(rebuilt.status, 200);
  const searched = await call("/api/local-content?q=integration%20phrase&kind=task_output");
  assert.equal(searched.status, 200);
  assert.equal(searched.body.count, 1);
  const content = searched.body.results[0];
  assert.equal(content.title, "library-source.txt");
  assert.equal(JSON.stringify(content).includes(projectAPath), false);

  const preview = await call(`/api/local-content/${content.id}/preview`);
  assert.equal(preview.status, 200);
  assert.match(preview.body.preview.text, /HTTP local library integration phrase/);
  assert.equal((await call("/api/local-content?q=integration%20phrase", { token: "tok_b" })).body.count, 0);
  assert.equal((await call(`/api/local-content/${content.id}/preview`, { token: "tok_b" })).status, 404);

  const consumer = await call("/api/work-items", {
    method: "POST",
    body: { projectId: "prj_a", title: "Consume local library source", type: "task" },
  });
  assert.equal(consumer.status, 201);
  const attached = await call(`/api/work-items/${consumer.body.workItem.id}/content-references`, {
    method: "POST",
    body: { contentId: content.id, expectedRevision: consumer.body.workItem.revision, purpose: "required_input" },
  });
  assert.equal(attached.status, 201);
  assert.equal(attached.body.reference.contentId, content.id);
  assert.equal(attached.body.workItem.localContentRefs.length, 1);
  assert.equal((await call(`/api/work-items/${consumer.body.workItem.id}/content-references`, {
    token: "tok_b",
    method: "POST",
    body: { contentId: content.id, expectedRevision: attached.body.workItem.revision },
  })).status, 404);

  const removed = await call(
    `/api/work-items/${consumer.body.workItem.id}/content-references/${attached.body.reference.id}`,
    { method: "DELETE", body: { expectedRevision: attached.body.workItem.revision } },
  );
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body.workItem.localContentRefs, []);
});

test("completed My template result feedback is recorded and summarized through HTTP", async () => {
  const workItem = {
    id: "lwi_template_outcome_http", localRef: "LOCAL-OUTCOME", ownerTeamId: "team_a", projectId: "prj_a",
    title: "Summarize inquiry", body: "Produce an inquiry summary.", type: "task", priority: "p2",
    status: "done", state: "closed", revision: 1, labels: [], assigneeIds: ["usr_a"],
    acceptanceCriteria: [], verificationSop: [], acceptanceResults: [], verificationRecords: [],
    inputAssets: [], outputAssets: [], requiredCapabilities: [], externalBindings: [], executionBindings: [],
    terminalId: runtimeState.device.id, createdBy: "usr_a", lastModifiedBy: "usr_a",
    createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:01:00.000Z",
    myTemplateBinding: {
      schemaVersion: 1, definitionId: "rtd_outcome_http", familyId: "family_outcome_http", version: 1,
      name: "Inquiry summary", expectedOutput: "Inquiry summary", matchReasons: ["Expected result matched"],
      snapshot: { name: "Inquiry summary", description: "Summarize inquiries", expectedOutput: "Inquiry summary", steps: [] },
      snapshotHash: "outcome-http-hash", matchedAt: "2026-08-11T00:00:00.000Z",
    },
  };
  runtimeState.workItems.push(workItem);

  const recorded = await call(`/api/work-items/${workItem.id}/my-template-outcome-feedback`, {
    method: "POST", body: { outcome: "needs_quality_adjustment" },
  });
  assert.equal(recorded.status, 200);
  assert.equal(recorded.body.feedback.outcome, "needs_quality_adjustment");
  assert.equal(recorded.body.workItem.myTemplateOutcomeFeedback.outcome, "needs_quality_adjustment");
  assert.equal((await call(`/api/work-items/${workItem.id}/my-template-outcome-feedback`, {
    token: "tok_b", method: "POST", body: { outcome: "wrong_result" },
  })).status, 404);

  runtimeState.routineDefinitions.push({
    id: "rtd_outcome_http", familyId: "family_outcome_http", projectId: "prj_a", ownerTeamId: "team_a",
    state: "published", version: 1, name: "Inquiry summary", description: "Summarize inquiries",
    triggerDocumentTypes: ["inquiry"], steps: [],
  });
  runtimeState.myTemplateOutcomeFeedback.push(
    ...["wrong_result", "met_expectations", "wrong_result", "met_expectations", "wrong_result"].map((outcome, index) => ({
      id: `mtof_outcome_http_${index}`, ownerTeamId: "team_a", projectId: "prj_a",
      workItemId: `missing_outcome_http_${index}`, definitionId: "rtd_outcome_http",
      familyId: "family_outcome_http", version: 1, outcome, note: "", revision: 1,
      createdAt: `2026-08-11T01:0${index}:00.000Z`, updatedAt: `2026-08-11T01:0${index}:00.000Z`,
    })),
  );

  const summary = await call("/api/work-items/my-template-outcomes?projectId=prj_a");
  assert.equal(summary.status, 200);
  assert.equal(summary.body.summaries.find((entry) => entry.familyId === "family_outcome_http").needsQualityAdjustment, 1);
  assert.equal(summary.body.summaries.find((entry) => entry.familyId === "family_outcome_http").governance.state, "paused");
  assert.equal(summary.body.feedback.find((entry) => entry.workItemId === workItem.id).workItem.localRef, "LOCAL-OUTCOME");
  assert.equal((await call("/api/work-items/my-template-governance/family_outcome_http/resume-observation", {
    token: "tok_b", method: "POST", body: { projectId: "prj_a", confirm: true },
  })).status, 404);
  assert.equal((await call("/api/work-items/my-template-governance/family_outcome_http/resume-observation", {
    method: "POST", body: { projectId: "prj_a", confirm: false },
  })).status, 400);
  const resumed = await call("/api/work-items/my-template-governance/family_outcome_http/resume-observation", {
    method: "POST", body: { projectId: "prj_a", confirm: true },
  });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.governance.manualObservation, true);
  assert.equal(resumed.body.governance.matchingFeedbackCount, 0);
  assert.equal((await call("/api/work-items/my-template-outcomes", { token: "tok_b" })).body.feedback
    .some((entry) => entry.workItemId === workItem.id), false);
  runtimeState.workItems = runtimeState.workItems.filter((entry) => entry.id !== workItem.id);
  runtimeState.routineDefinitions = runtimeState.routineDefinitions.filter((entry) => entry.id !== "rtd_outcome_http");
  runtimeState.myTemplateOutcomeFeedback = runtimeState.myTemplateOutcomeFeedback
    .filter((entry) => entry.familyId !== "family_outcome_http");
  runtimeState.myTemplateGovernanceInterventions = runtimeState.myTemplateGovernanceInterventions
    .filter((entry) => entry.familyId !== "family_outcome_http");
});

test("completed ordinary tasks can create tenant-scoped learning My template drafts through HTTP", async () => {
  const created = await call("/api/work-items", {
    method: "POST",
    body: { projectId: "prj_a", title: "HTTP 客户回访汇总" },
  });
  assert.equal(created.status, 201);
  const stored = runtimeState.workItems.find((item) => item.id === created.body.workItem.id);
  stored.status = "done";
  stored.outputAssets = [{ id: "http-output", path: "回访汇总.xlsx", family: "spreadsheet" }];

  const preview = await call(`/api/work-items/${stored.id}/my-template-draft`);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.eligible, true);
  assert.equal(preview.body.suggestion.expectedOutput, "回访汇总.xlsx");
  assert.equal((await call(`/api/work-items/${stored.id}/my-template-draft`, { token: "tok_b" })).status, 404);

  const saved = await call(`/api/work-items/${stored.id}/my-template-draft`, {
    method: "POST",
    body: {
      expectedRevision: stored.revision,
      confirm: true,
      name: "客户回访汇总",
      typicalInput: "客户回访记录",
      expectedOutput: "客户回访汇总表",
      idempotencyKey: "http-task-template",
    },
  });
  assert.equal(saved.status, 201);
  assert.equal(saved.body.draft.state, "needs_review");
  assert.equal(saved.body.draft.casesRequired, 1);
  assert.equal(saved.body.workItem.myTemplateDraft.id, saved.body.draft.id);
  assert.equal(saved.body.workItem.myTemplateBinding, undefined);

  const similarCreated = await call("/api/work-items", {
    method: "POST", body: { projectId: "prj_a", title: "客户回访汇总 九月" },
  });
  const similarStored = runtimeState.workItems.find((item) => item.id === similarCreated.body.workItem.id);
  similarStored.status = "done";
  similarStored.outputAssets = [{ id: "http-output-similar", path: "客户回访汇总表.xlsx", family: "spreadsheet" }];
  const suggestions = await call(`/api/work-items/my-template-drafts/${saved.body.draft.id}/similar-work-items`);
  assert.equal(suggestions.status, 200);
  assert.ok(suggestions.body.suggestions.some((entry) => entry.workItem.id === similarStored.id));
  assert.equal((await call(`/api/work-items/my-template-drafts/${saved.body.draft.id}/similar-work-items`, { token: "tok_b" })).status, 404);
  const added = await call(`/api/work-items/my-template-drafts/${saved.body.draft.id}/cases`, {
    method: "POST",
    body: {
      workItemId: similarStored.id,
      expectedDraftRevision: saved.body.draft.revision,
      expectedWorkItemRevision: similarStored.revision,
      confirm: true,
    },
  });
  assert.equal(added.status, 201);
  assert.equal(added.body.draft.caseCount, 2);
  assert.equal(added.body.draft.state, "needs_review");
  assert.equal(similarStored.myTemplateBinding, undefined);

  const review = await call(`/api/work-items/my-template-drafts/${saved.body.draft.id}/review`);
  assert.equal(review.status, 200);
  assert.equal(review.body.readiness.canEnable, true);
  assert.equal(review.body.cases.length, 2);
  assert.equal((await call(`/api/work-items/my-template-drafts/${saved.body.draft.id}/review`, { token: "tok_b" })).status, 404);
  assert.equal((await call(`/api/work-items/my-template-drafts/${saved.body.draft.id}/activate`, {
    token: "tok_b", method: "POST",
    body: { expectedDraftRevision: added.body.draft.revision, confirm: true },
  })).status, 404);
  assert.equal((await call(`/api/work-items/my-template-drafts/${saved.body.draft.id}/activate`, {
    method: "POST",
    body: { expectedDraftRevision: added.body.draft.revision, confirm: false },
  })).body.error, "my_template_activation_confirmation_required");
  const activated = await call(`/api/work-items/my-template-drafts/${saved.body.draft.id}/activate`, {
    method: "POST",
    body: {
      expectedDraftRevision: added.body.draft.revision,
      confirm: true,
      name: "客户回访分析",
      typicalInput: "客户回访记录",
      expectedOutput: "客户回访汇总表",
    },
  });
  assert.equal(activated.status, 201);
  assert.equal(activated.body.draft.state, "ready");
  assert.equal(activated.body.definition.state, "published");
  assert.equal(activated.body.review.futureBehavior.participatesInMatching, true);
  assert.equal(stored.myTemplateBinding, undefined);
  const definitions = await call("/api/workflow-memory/business-routine-definitions");
  const activatedDefinition = definitions.body.routineDefinitions.find((entry) => entry.id === activated.body.definition.id);
  assert.equal(activatedDefinition.evidenceHealth.state, "valid");

  const listA = await call("/api/work-items/my-template-drafts");
  const listB = await call("/api/work-items/my-template-drafts", { token: "tok_b" });
  assert.ok(listA.body.drafts.some((draft) => draft.id === saved.body.draft.id));
  assert.ok(listB.body.drafts.every((draft) => draft.id !== saved.body.draft.id));
});

test("Channel business-object registry is revisioned, masked, and team scoped over HTTP", async () => {
  const created = await call("/api/channel-objects", {
    method: "POST",
    body: {
      kind: "account",
      projectId: "prj_a",
      label: "公司付款账户",
      fields: { accountName: "公司付款账户", accountNumber: "6222000012345678" },
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.object.fields.accountNumber, "****5678");
  assert.equal(JSON.stringify(runtimeState.channelObjectRecords).includes("6222000012345678"), false);
  assert.equal((await call("/api/channel-objects?projectId=prj_a")).body.count, 1);
  assert.equal((await call("/api/channel-objects?projectId=prj_a", { token: "tok_b" })).body.count, 0);
  const disabled = await call(`/api/channel-objects/${created.body.object.id}/status`, {
    method: "PATCH",
    body: { status: "disabled", expectedRevision: 1 },
  });
  assert.equal(disabled.status, 200);
  assert.equal(disabled.body.object.status, "disabled");
  assert.equal((await call("/api/channel-objects?projectId=prj_a&status=active")).body.count, 0);
});

test("Channel object import requires confirmation and exposes the read-only business connector", async () => {
  const preview = await call("/api/channel-objects/import/preview", {
    method: "POST",
    body: {
      projectId: "prj_a",
      kind: "contact",
      format: "json",
      fileName: "contacts.json",
      content: Buffer.from(JSON.stringify([{ name: "导入联系人", email: "imported@example.test" }])).toString("base64"),
    },
  });
  assert.equal(preview.status, 201);
  assert.equal(preview.body.canConfirm, true);
  assert.equal((await call("/api/channel-objects?projectId=prj_a&kind=contact")).body.count, 0);
  const denied = await call("/api/channel-objects/import/confirm", {
    method: "POST", body: { importId: preview.body.import.id },
  });
  assert.equal(denied.status, 409);
  assert.equal(denied.body.error, "channel_object_import_approval_required");
  const grant = await call("/api/approvals/grants", {
    method: "POST", body: { action: "channel_object_import_confirm", targetId: preview.body.import.id },
  });
  const confirmed = await call("/api/channel-objects/import/confirm", {
    method: "POST", body: { importId: preview.body.import.id, approvalToken: grant.body.token },
  });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.objects[0].label, "导入联系人");
  assert.equal((await call("/api/channel-objects/import/confirm", {
    method: "POST", body: { importId: preview.body.import.id },
  })).body.replayed, true);
  const connectors = await call("/api/channel-objects/connectors");
  assert.ok(connectors.body.connectors.some((connector) => connector.id === "business_entities"));
});

test("Channel mutation binding is project-scoped and revisioned over HTTP", async () => {
  runtimeState.channelObjectFileSources.push({
    id: "csrc_http_customers",
    ownerTeamId: "team_a",
    projectId: "prj_a",
    fileName: "customers.csv",
    revision: 2,
    status: "active",
  });
  runtimeState.ledgerDefinitions.push({
    id: "ldg_http_customers",
    ownerTeamId: "team_a",
    projectId: "prj_a",
    state: "active",
    format: "csv",
    relativePath: "ledgers/customers.csv",
    sourceId: "wfs_http_customers",
    revision: 5,
  });
  runtimeState.workflowSources.push({
    id: "wfs_http_customers",
    ownerTeamId: "team_a",
    projectId: "prj_a",
    state: "active",
  });
  const created = await call("/api/channel-objects/mutation-bindings", {
    method: "POST",
    body: { projectId: "prj_a", fileSourceId: "csrc_http_customers", ledgerDefinitionId: "ldg_http_customers" },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.binding.stale, false);
  assert.equal((await call("/api/channel-objects/mutation-bindings?projectId=prj_a")).body.count, 1);
  assert.equal((await call("/api/channel-objects/mutation-bindings?projectId=prj_a", { token: "tok_b" })).body.count, 0);
  runtimeState.channelObjectFileSources.find((source) => source.id === "csrc_http_customers").revision = 3;
  const stale = await call("/api/channel-objects/mutation-bindings?projectId=prj_a");
  assert.equal(stale.body.bindings[0].stale, true);
  const disabled = await call(`/api/channel-objects/mutation-bindings/${created.body.binding.id}/status`, {
    method: "PATCH", body: { status: "disabled", expectedRevision: created.body.binding.revision },
  });
  assert.equal(disabled.status, 200);
  assert.equal(disabled.body.binding.status, "disabled");
});

test("Channel connector configuration, health check, and sync preview are team scoped over HTTP", async () => {
  const saved = await call("/api/channel-objects/connector-configs", {
    method: "POST",
    body: { projectId: "prj_a", connectorId: "business_entities", kinds: ["contact"], name: "本地联系人" },
  });
  assert.equal(saved.status, 201);
  assert.equal(saved.body.config.credentialConfigured, false);
  assert.equal((await call("/api/channel-objects/connector-configs", { token: "tok_b" })).body.count, 0);
  const tested = await call(`/api/channel-objects/connector-configs/${saved.body.config.id}/test`, { method: "POST", body: {} });
  assert.equal(tested.status, 200);
  assert.equal(tested.body.ok, true);
  const preview = await call("/api/channel-objects/sync/preview", {
    method: "POST", body: { configId: saved.body.config.id, kind: "contact" },
  });
  assert.equal(preview.status, 201);
  assert.equal(preview.body.preview.status, "preview");
  const denied = await call("/api/channel-objects/sync/confirm", {
    method: "POST", body: { previewId: preview.body.preview.id },
  });
  assert.equal(denied.status, 409);
  assert.equal(denied.body.error, "channel_object_sync_approval_required");
  const grant = await call("/api/approvals/grants", {
    method: "POST",
    body: { action: "channel_object_connector_sync_confirm", targetId: preview.body.preview.id },
  });
  assert.equal(grant.status, 201);
  const confirmed = await call("/api/channel-objects/sync/confirm", {
    method: "POST", body: { previewId: preview.body.preview.id, approvalToken: grant.body.token },
  });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.preview.status, "confirmed");
  assert.equal((await call(`/api/channel-objects/connector-configs/${saved.body.config.id}/status`, {
    method: "PATCH", body: { status: "disabled", expectedRevision: tested.body.config.revision },
  })).status, 200);
});

test("local ledger changes invalidate task bindings and require a managed refresh over HTTP", async () => {
  const directory = join(projectAPath, "record-freshness-http");
  const ledgerPath = join(directory, "customers.csv");
  mkdirSync(directory, { recursive: true });
  writeFileSync(ledgerPath, "Customer ID,Customer,Status\nCUS-001,Acme,active\n");

  const source = await call("/api/workflow-memory/sources", {
    method: "POST",
    body: {
      projectId: "prj_a",
      relativePath: "record-freshness-http",
      readMode: "supported_text",
      name: "Task record freshness fixtures",
    },
  });
  assert.equal(source.status, 201, JSON.stringify(source.body));
  const definition = await call("/api/workflow-memory/ledger-definitions", {
    method: "POST",
    body: {
      projectId: "prj_a",
      sourceId: source.body.source.id,
      name: "Customer ledger freshness fixture",
      documentType: "inquiry_ledger",
      format: "csv",
      relativePath: "customers.csv",
      businessKeyField: "customer_id",
      fieldMappings: {
        customer_id: "Customer ID",
        customer: "Customer",
        status: "Status",
      },
      requiredFields: ["customer_id", "customer"],
      writePolicy: { approval: "always", allowInsert: true, allowUpdate: true },
    },
  });
  assert.equal(definition.status, 201, JSON.stringify(definition.body));
  const ledgerDefinitionId = definition.body.ledgerDefinition.id;
  const activated = await call(`/api/workflow-memory/ledger-definitions/${ledgerDefinitionId}/activate`, {
    method: "POST",
    body: { expectedRevision: definition.body.ledgerDefinition.revision },
  });
  assert.equal(activated.status, 200, JSON.stringify(activated.body));

  const initialRecord = await call(
    `/api/workflow-memory/ledger-definitions/${ledgerDefinitionId}/records?businessKey=CUS-001`,
  );
  assert.equal(initialRecord.status, 200, JSON.stringify(initialRecord.body));
  const recordRef = initialRecord.body.record;
  const created = await call("/api/work-items", {
    method: "POST",
    body: {
      projectId: "prj_a",
      title: "Prepare the current Acme account review",
      recordBindings: [{
        id: "binding_customer_http",
        slotKey: "customer",
        direction: "input",
        role: "required",
        ledgerDefinitionId,
        record: recordRef,
        selection: { fieldKeys: ["customer", "status"], queryId: null, rowLimit: 1 },
        snapshot: {
          revision: recordRef.revision,
          fingerprint: recordRef.fingerprint,
          capturedAt: recordRef.observedAt,
          evidenceRefs: [],
        },
        resolution: { source: "explicit_user", confidence: 1, state: "resolved", reasons: ["confirmed"] },
      }],
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const workItemId = created.body.workItem.id;
  const stored = runtimeState.workItems.find((item) => item.id === workItemId);
  stored.ledgerPostingPlanId = `tpp_record_freshness_${workItemId}`;
  runtimeState.taskLedgerPostingPlans.push({
    id: stored.ledgerPostingPlanId,
    ownerTeamId: "team_a",
    projectId: "prj_a",
    workItemId,
    resultRevision: stored.revision,
    status: "proposed",
    revision: 1,
    plan: { state: "proposed" },
    updatedAt: new Date().toISOString(),
  });

  writeFileSync(ledgerPath, "Customer ID,Customer,Status\nCUS-001,Acme,paused\n");
  const attention = await call("/api/work-items/attention?projectId=prj_a&kind=record_binding_stale");
  assert.equal(attention.status, 200, JSON.stringify(attention.body));
  assert.equal(attention.body.count, 1);
  assert.equal(attention.body.metrics.staleRecords, 1);
  assert.equal(attention.body.items[0].id, `record_binding_stale:${workItemId}`);
  assert.deepEqual(attention.body.items[0].details.bindingIds, ["binding_customer_http"]);
  assert.equal(attention.body.items[0].details.executionBlocked, true);
  assert.equal(attention.body.items[0].details.refreshable, true);

  const stale = await call(`/api/work-items/${workItemId}`);
  assert.equal(stale.status, 200, JSON.stringify(stale.body));
  assert.equal(stale.body.workItem.revision, 2);
  assert.equal(stale.body.workItem.recordBindings[0].resolution.state, "stale");
  assert.equal(runtimeState.taskLedgerPostingPlans.find((plan) => plan.id === stored.ledgerPostingPlanId).status, "invalidated");

  const blocked = await call(`/api/work-items/${workItemId}/auto-runs`, {
    method: "POST",
    body: { timezoneOffset: 0 },
  });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error, "work_item_record_bindings_stale");
  assert.equal(runtimeState.autoRuns.some((run) => run.localIssueId === workItemId), false);

  const refreshed = await call("/api/work-items/record-bindings/refresh", {
    method: "POST",
    body: {
      items: [{
        id: workItemId,
        expectedRevision: 2,
        bindingIds: ["binding_customer_http"],
      }],
    },
  });
  assert.equal(refreshed.status, 200, JSON.stringify(refreshed.body));
  assert.equal(refreshed.body.refreshedCount, 1);
  assert.equal(refreshed.body.workItems[0].revision, 3);
  assert.equal(refreshed.body.workItems[0].recordBindings[0].resolution.state, "resolved");
  assert.notEqual(refreshed.body.workItems[0].recordBindings[0].snapshot.fingerprint, recordRef.fingerprint);
  assert.equal((await call("/api/work-items/attention?kind=record_binding_stale")).body.count, 0);

  const unmanaged = await call(`/api/work-items/${workItemId}`, {
    method: "PATCH",
    body: { expectedRevision: 3, recordBindings: created.body.workItem.recordBindings },
  });
  assert.equal(unmanaged.status, 409);
  assert.equal(unmanaged.body.error, "work_item_record_bindings_require_managed_update");
});
