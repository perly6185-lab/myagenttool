process.env.MYAGENT_REQUIRE_AUTH = "1";
process.env.MYAGENTTOOL_STATE_DISABLED = "1";

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { after, before, test } from "node:test";

let server;
let base;
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

test("local work item CRUD is wired through the real HTTP server", async () => {
  const created = await call("/api/work-items", {
    method: "POST",
    body: { projectId: "prj_a", title: "Plan locally", type: "feature" },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.workItem.localRef, "LOCAL-1");

  const updated = await call(`/api/work-items/${created.body.workItem.id}`, {
    method: "PATCH",
    body: { expectedRevision: 1, status: "ready", priority: "p1" },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.workItem.status, "ready");

  const listed = await call("/api/work-items?status=ready&q=plan");
  assert.equal(listed.status, 200);
  assert.equal(listed.body.count, 1);
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
  const foreignProject = await call("/api/work-items", {
    token: "tok_a", method: "POST", body: { projectId: "prj_b", title: "Denied" },
  });
  assert.equal(foreignProject.status, 404);
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
  const detail = await call(`/api/work-items/${item.id}`);
  assert.equal(detail.body.workItem.executionBindings.some((binding) => binding.kind === "auto_run"), true);
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
      changes: { status: "ready" },
    },
  });
  assert.equal(bulk.status, 200);
  assert.equal(bulk.body.count, 2);
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
