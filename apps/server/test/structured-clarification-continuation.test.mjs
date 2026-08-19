import test from "node:test";
import assert from "node:assert/strict";

import { continueStructuredClarification } from "../src/routes/projects.mjs";

function harness({ failFirstStart = false } = {}) {
  const sourceRun = {
    id: "aur_source",
    projectId: "prj_source",
    agentId: "agt_1",
    localIssueId: "lwi_source",
    executionChainId: "lwi_source",
    autonomyProfile: "standard",
    link: { type: "local_issue", number: 7, title: "Evaluate the selected repository" },
    issueBody: "Evaluate the repository and report the findings.",
    clarifyAnswer: {
      at: "2026-08-08T00:00:00.000Z",
      by: "usr_1",
      selectedAction: "evaluate",
      repoUrl: "https://github.com/example/target.git",
    },
  };
  const state = {
    projects: [{ id: "prj_source", path: "D:/projects", ownerTeamId: "team_local", git: { remoteUrl: null } }],
    workItems: [{
      id: "lwi_source",
      projectId: "prj_source",
      localNumber: 7,
      title: "Evaluate the selected repository",
      body: "Evaluate the repository and report the findings.",
      type: "task",
      priority: "p1",
      labels: ["evaluation"],
      acceptanceCriteria: ["A report is produced."],
      verificationSop: ["Review the report."],
    }],
    autoRuns: [sourceRun],
  };
  const calls = { clone: 0, create: 0, start: 0, persist: 0, startInput: null };
  let shouldFail = failFirstStart;
  return {
    state,
    sourceRun,
    calls,
    input: {
      state,
      autoRunId: sourceRun.id,
      result: {
        shouldRetry: true,
        repoUrl: "https://github.com/example/target.git",
        selectedAction: "evaluate",
      },
      requestBody: { selectedAction: "evaluate" },
      actor: { userId: "usr_1", teamId: "team_local" },
      persistStateSoon: () => { calls.persist += 1; },
      cloneProject: async () => {
        calls.clone += 1;
        const project = {
          id: "prj_target",
          path: "D:/projects/target",
          ownerTeamId: "team_local",
          git: { remoteUrl: "https://github.com/example/target.git" },
        };
        state.projects.push(project);
        return project;
      },
      createWorkItem: async (body) => {
        calls.create += 1;
        assert.equal(body.projectId, "prj_target");
        assert.equal(body.idempotencyKey, "structured-clarification:aur_source");
        const workItem = {
          ...body,
          id: "lwi_target",
          localNumber: 8,
          terminalId: "terminal_local",
        };
        state.workItems.push(workItem);
        return { ok: true, status: 201, body: { workItem } };
      },
      startAutoRun: async (body) => {
        calls.start += 1;
        calls.startInput = body;
        if (shouldFail) {
          shouldFail = false;
          const error = new Error("Agent capacity is temporarily unavailable.");
          error.code = "agent_capacity_unavailable";
          throw error;
        }
        const autoRun = {
          id: "aur_target",
          status: "understanding",
          projectId: body.projectId,
          localIssueId: body.localIssueId,
          executionChainId: body.executionChainId,
        };
        state.autoRuns.push(autoRun);
        return { autoRun };
      },
    },
  };
}

test("structured clarification creates a governed target Local Issue before starting the selected repository run", async () => {
  const { input, sourceRun, calls } = harness();
  const result = await continueStructuredClarification(input);

  assert.deepEqual(result.retryRun, { id: "aur_target", status: "understanding" });
  assert.equal(result.retryError, null);
  assert.deepEqual(result.continuation, {
    status: "completed",
    projectId: "prj_target",
    localIssueId: "lwi_target",
  });
  assert.equal(calls.clone, 1);
  assert.equal(calls.create, 1);
  assert.equal(calls.start, 1);
  assert.equal(calls.startInput.localIssueId, "lwi_target");
  assert.equal(calls.startInput.taskMaterialWorkItemId, "lwi_target");
  assert.equal(calls.startInput.executionChainId, "lwi_target");
  assert.deepEqual(calls.startInput.link, {
    type: "local_issue",
    number: 8,
    title: "Evaluate the selected repository",
    url: null,
    state: "open",
  });
  assert.equal(calls.startInput.decisionOverride.path, "evaluate");
  assert.equal(sourceRun.clarificationContinuation.status, "completed");
  assert.equal(sourceRun.clarificationContinuation.retryRunId, "aur_target");
});

test("structured clarification exposes a retryable failure and resumes from its durable checkpoints", async () => {
  const { input, sourceRun, calls } = harness({ failFirstStart: true });
  const failed = await continueStructuredClarification(input);

  assert.equal(failed.retryRun, null);
  assert.deepEqual(failed.retryError, {
    code: "agent_capacity_unavailable",
    message: "Agent capacity is temporarily unavailable.",
    retryable: true,
  });
  assert.equal(sourceRun.clarificationContinuation.status, "failed");
  assert.equal(sourceRun.clarificationContinuation.projectId, "prj_target");
  assert.equal(sourceRun.clarificationContinuation.localIssueId, "lwi_target");

  const resumed = await continueStructuredClarification(input);
  assert.deepEqual(resumed.retryRun, { id: "aur_target", status: "understanding" });
  assert.equal(resumed.retryError, null);
  assert.equal(calls.clone, 1, "the cloned repository is reused");
  assert.equal(calls.create, 1, "the governed Local Issue is reused");
  assert.equal(calls.start, 2, "only the failed run start is retried");
  assert.equal(sourceRun.clarificationContinuation.attemptCount, 2);
});

test("structured clarification replays an already-created continuation run", async () => {
  const { input, calls } = harness();
  await continueStructuredClarification(input);
  const replay = await continueStructuredClarification(input);

  assert.deepEqual(replay.retryRun, { id: "aur_target", status: "understanding" });
  assert.equal(replay.continuation.status, "completed");
  assert.equal(calls.clone, 1);
  assert.equal(calls.create, 1);
  assert.equal(calls.start, 1);
});
