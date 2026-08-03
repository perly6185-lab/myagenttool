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
  const { httpDependencies } = createServerRuntimeServices({
    namespace: "test", protocolVersion: "0.0.0", state, defaultProject, defaultProjectPath: "/tmp",
    persistenceEnabled: false, stateStorePath: "/tmp/unused.json", stateSchemaVersion: 1, dispatchLeaseMs: 30_000, now,
  });
  server = createHttpServer({ host: "127.0.0.1", port: 0, namespace: "test", protocolVersion: "0.0.0", ...httpDependencies });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
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

test("approved local delivery fast-forwards the base and only then closes the issue", async () => {
  const item = (await call("/api/work-items", {
    method: "POST", body: { projectId: "prj_a", title: "Deliver over HTTP" },
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

  const detail = await call(`/api/work-items/${item.id}`);
  assert.equal(detail.body.observability.nextAction, "review_delivery");
  assert.equal(detail.body.observability.delivery.mode, "local_merge");
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
  assert.equal(result.status, 201);
  assert.equal(result.body.autoRun.link.type, "local_issue");
  assert.equal(result.body.autoRun.issueBody.includes("Implement the local workflow."), true);
  assert.equal(result.body.autoRun.issueBody.includes("The local path is tested"), true);
  assert.equal(result.body.autoRun.executionChainId, item.id);
  assert.equal(result.body.autoRun.autonomyProfile, "standard");
  assert.equal(result.body.autoRun.terminalId, item.terminalId);
  const invocation = runtimeState.invocations.find((row) => row.id === result.body.autoRun.invocationId);
  assert.equal(invocation.terminalId, item.terminalId);
  assert.equal(invocation.options.metadata.executionChainId, item.id);
  const approval = runtimeState.approvalRequests.find((row) => row.invocationId === invocation.id);
  if (approval) assert.equal(approval.terminalId, item.terminalId);
  const detail = await call(`/api/work-items/${item.id}`);
  assert.equal(detail.body.workItem.executionBindings.some((binding) => binding.kind === "auto_run"), true);
});

test("local issues can be queued as a durable concurrency-limited Auto-run batch", async () => {
  const first = (await call("/api/work-items", {
    method: "POST",
    body: { projectId: "prj_a", title: "Batch task one" },
  })).body.workItem;
  const second = (await call("/api/work-items", {
    method: "POST",
    body: { projectId: "prj_a", title: "Batch task two" },
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
    method: "POST", body: { projectId: "prj_a", title: "Cautious planning work" },
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
  assert.equal(execution.status, 201);
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
