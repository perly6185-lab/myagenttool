import assert from "node:assert/strict";
import test from "node:test";
import { projectWorkItemExecutionReview } from "../src/services/work-item-execution-review.mjs";

const STARTED = {
  status: "started",
  requestedAt: "2026-08-27T01:00:00.000Z",
  startedAt: "2026-08-27T01:01:00.000Z",
  updatedAt: "2026-08-27T01:01:00.000Z",
  executionKind: "auto_run",
  targetId: "aur_1",
  agentId: "agt_1",
};

test("projects a running development task into ordinary stages and structured verification", () => {
  const item = {
    id: "wi_1",
    state: "open",
    status: "in_progress",
    executionBindings: [{ kind: "auto_run", targetId: "aur_1", createdAt: "2026-08-27T01:01:00.000Z" }],
    verificationRecords: [{
      id: "wvr_1",
      kind: "test",
      status: "failed",
      command: "pnpm test",
      summary: "One test failed.",
      evidence: [{ kind: "log", ref: "artifact:test-log", summary: "Test log" }],
      recordedAt: "2026-08-27T01:04:00.000Z",
    }],
  };
  const state = {
    autoRuns: [{
      id: "aur_1",
      status: "blocked",
      phase: "verifying",
      agentId: "agt_1",
      verification: { verified: true, passed: false, commands: ["pnpm test"], exitCode: 1, summary: "One test failed." },
      executionActionReceipts: [{
        schemaVersion: 1,
        id: "ear_1",
        kind: "retry_execution",
        status: "running",
        messageCode: "request_accepted",
        impact: "none",
        nextOwner: "ai",
        requestedAt: "2026-08-27T01:04:30.000Z",
        updatedAt: "2026-08-27T01:04:30.000Z",
        completedAt: null,
        requestedBy: "usr_1",
        idempotencyKey: "private-action-key",
        requestDigest: "private-request-digest",
        targetId: null,
        errorCode: null,
        errorMessage: null,
      }],
      updatedAt: "2026-08-27T01:04:00.000Z",
    }],
    invocations: [],
    agents: [{ id: "agt_1", name: "Coding assistant" }],
  };

  const review = projectWorkItemExecutionReview({ item, state, startReceipt: STARTED, now: "2026-08-27T01:05:00.000Z" });
  assert.equal(review.state, "failed");
  assert.equal(review.stage, "verifying");
  assert.equal(review.stages.find((stage) => stage.key === "verifying").status, "attention");
  assert.deepEqual(review.verification.commands, ["pnpm test"]);
  assert.equal(review.verification.status, "failed");
  assert.equal(review.verification.exitCode, 1);
  assert.equal(review.verification.evidenceCount, 1);
  assert.equal(review.agentName, "Coding assistant");
  assert.deepEqual(review.impact, { status: "unknown", reasonCode: "external_impact_not_recorded" });
  assert.equal(review.recommendedAction.kind, "retry_execution");
  assert.equal(review.actionReceipt.status, "running");
  assert.equal(review.actionReceipt.messageCode, "request_accepted");
  assert.equal(review.actionReceipt.idempotencyKey, undefined);
  assert.equal(review.actionReceipt.requestDigest, undefined);
  assert.deepEqual(review.riskReasons.map((reason) => reason.code), ["execution_failed", "verification_failed", "external_impact_unknown"]);
});

test("projects a direct office invocation without pretending it changed external data", () => {
  const item = {
    id: "wi_office",
    state: "open",
    status: "in_progress",
    executionBindings: [{ kind: "application_invocation", targetId: "inv_office", createdAt: "2026-08-27T02:00:00.000Z" }],
  };
  const state = {
    autoRuns: [],
    invocations: [{ id: "inv_office", status: "running", agentId: "agt_office", startedAt: "2026-08-27T02:00:02.000Z", updatedAt: "2026-08-27T02:00:03.000Z" }],
    agents: [{ id: "agt_office", name: "Office assistant" }],
  };
  const review = projectWorkItemExecutionReview({
    item,
    state,
    startReceipt: { ...STARTED, executionKind: "application_invocation", targetId: "inv_office", agentId: "agt_office" },
    now: "2026-08-27T02:00:04.000Z",
  });

  assert.equal(review.state, "working");
  assert.equal(review.stage, "working");
  assert.equal(review.executionKind, "application_invocation");
  assert.equal(review.verification.status, "pending");
  assert.deepEqual(review.impact, { status: "none", reasonCode: "changes_isolated_until_confirmation" });
  assert.deepEqual(review.recommendedAction, {
    kind: "open_details", reasonCode: "execution_in_progress", requiresConfirmation: false, nextOwner: "ai",
  });
  assert.deepEqual(review.riskReasons, []);
});

test("separates a created pull request from an applied result", () => {
  const item = {
    id: "wi_pr",
    state: "open",
    status: "review",
    executionBindings: [{ kind: "auto_run", targetId: "aur_pr", createdAt: "2026-08-27T03:00:00.000Z" }],
  };
  const state = {
    autoRuns: [{
      id: "aur_pr",
      status: "pr_open",
      phase: "review_ready",
      verification: { verified: true, passed: true, command: "pnpm test", exitCode: 0, summary: "Checks passed." },
      updatedAt: "2026-08-27T03:05:00.000Z",
    }],
    invocations: [],
  };
  const review = projectWorkItemExecutionReview({ item, state, startReceipt: { ...STARTED, targetId: "aur_pr" } });

  assert.equal(review.state, "review_ready");
  assert.equal(review.verification.status, "passed");
  assert.deepEqual(review.impact, { status: "proposed", reasonCode: "pull_request_created" });
  assert.equal(review.recommendedAction.kind, "review_result");
  assert.deepEqual(review.riskReasons, [{ code: "pull_request_not_applied", severity: "medium", scope: "external_impact" }]);
});

test("uses result verification for a document-only code task without runtime verification requirements", () => {
  const item = {
    id: "wi_document_change",
    state: "open",
    status: "review",
    artifactContract: { verification: { requiredKinds: [] } },
    resultVerification: {
      status: "passed",
      summary: "Target document and content checks passed.",
      checkedAt: "2026-08-27T03:04:00.000Z",
      checks: [{
        id: "result_check_1",
        kind: "software_change",
        status: "passed",
        summary: "The requested document is the only changed file.",
        executionArtifactIds: ["artifact_1"],
      }],
    },
    executionBindings: [{ kind: "auto_run", targetId: "aur_document_change", createdAt: "2026-08-27T03:00:00.000Z" }],
  };
  const state = {
    autoRuns: [{
      id: "aur_document_change",
      status: "done",
      phase: "review_ready",
      deliveryReport: {
        verification: {
          passed: true,
          verified: false,
          summary: "No verification command configured — PR opened unverified.",
        },
      },
      localDelivery: { mode: "uncommitted_worktree", commitCreated: false },
      updatedAt: "2026-08-27T03:05:00.000Z",
    }],
    invocations: [],
  };

  const review = projectWorkItemExecutionReview({
    item,
    state,
    startReceipt: { ...STARTED, targetId: "aur_document_change" },
  });

  assert.equal(review.verification.status, "passed");
  assert.equal(review.verification.verified, true);
  assert.equal(review.verification.passed, true);
  assert.equal(review.verification.summary, "Target document and content checks passed.");
  assert.equal(review.verification.checkedAt, "2026-08-27T03:04:00.000Z");
  assert.equal(review.verification.evidenceCount, 1);
  assert.deepEqual(review.verification.checks, [{
    id: "result_check_1",
    kind: "software_change",
    status: "passed",
    command: null,
    summary: "The requested document is the only changed file.",
    recordedAt: "2026-08-27T03:04:00.000Z",
    evidenceCount: 1,
  }]);
});

test("only reports an applied result when a delivery or office commit proves it", () => {
  const completedItem = {
    id: "wi_completed",
    state: "closed",
    status: "done",
    executionBindings: [{ kind: "auto_run", targetId: "aur_completed", createdAt: "2026-08-27T04:00:00.000Z" }],
  };
  const baseRun = {
    id: "aur_completed",
    status: "done",
    phase: "review_ready",
    updatedAt: "2026-08-27T04:05:00.000Z",
  };
  const withoutReceipt = projectWorkItemExecutionReview({
    item: completedItem,
    state: { autoRuns: [baseRun], invocations: [] },
    startReceipt: { ...STARTED, targetId: "aur_completed" },
  });
  assert.equal(withoutReceipt.state, "completed");
  assert.deepEqual(withoutReceipt.impact, { status: "unknown", reasonCode: "external_impact_not_recorded" });
  assert.equal(withoutReceipt.recommendedAction.kind, "view_result");

  const withReceipt = projectWorkItemExecutionReview({
    item: completedItem,
    state: {
      autoRuns: [{
        ...baseRun,
        localDelivery: {
          mode: "local_merge",
          deliveredAt: "2026-08-27T04:05:00.000Z",
          deliveredCommit: "abc123",
        },
      }],
      invocations: [],
    },
    startReceipt: { ...STARTED, targetId: "aur_completed" },
  });
  assert.deepEqual(withReceipt.impact, { status: "applied", reasonCode: "local_delivery_applied" });
});
