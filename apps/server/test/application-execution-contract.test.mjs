import test from "node:test";
import assert from "node:assert/strict";
import {
  createApplicationExecutionContract,
  nextLocalApplicationRetry,
  normalizeApplicationResult,
} from "../src/services/application-execution-contract.mjs";

const resolution = {
  state: "waiting_approval",
  terminalId: "terminal-1",
  capability: { name: "app.office.apply", applicationId: "app_office", riskLevel: "medium" },
  approval: { required: true },
  readiness: { runtime: "ready", credential: { configured: true, scopeMatch: true, expired: false } },
};
const workItem = { id: "task-1", projectId: "project-1", worktreeId: "wt-1", terminalId: "terminal-1" };
const asset = { id: "asset-1", projectId: "project-1", terminalId: "terminal-1", path: "docs/a.xlsx", hash: "sha256:x", version: "v1" };

test("binds Application execution to task, queue, principal, terminal, approval, assets, and trace", () => {
  const contract = createApplicationExecutionContract({
    resolution, workItem, principalId: "user-1", approvalId: "approval-1", input: { operation: "update" }, inputAssets: [asset],
  });
  assert.equal(contract.taskId, "task-1");
  assert.equal(contract.queueEntryId, "task-1");
  assert.equal(contract.traceId, "task-1");
  assert.equal(contract.terminalId, "terminal-1");
  assert.equal(contract.approvalId, "approval-1");
  assert.match(contract.fingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(contract), true);
});

test("never weakens approval or terminal ownership", () => {
  assert.throws(() => createApplicationExecutionContract({ resolution, workItem, principalId: "user-1" }), /execution_approval_required/);
  assert.throws(() => createApplicationExecutionContract({
    resolution: { ...resolution, terminalId: "terminal-2" }, workItem, principalId: "user-1", approvalId: "approval-1",
  }), /execution_terminal_mismatch/);
  assert.throws(() => createApplicationExecutionContract({
    resolution, workItem, principalId: "user-1", approvalId: "approval-1",
    inputAssets: [{ ...asset, terminalId: "terminal-2" }],
  }), /asset_execution_scope_mismatch/);
});

test("bounded retry stays on the same terminal and preserves approval", () => {
  const contract = createApplicationExecutionContract({ resolution, workItem, principalId: "user-1", approvalId: "approval-1" });
  const retry = nextLocalApplicationRetry(contract, { transient: true, errorCode: "runtime_busy" });
  assert.deepEqual({ terminalId: retry.terminalId, applicationId: retry.applicationId, approvalId: retry.approvalId }, {
    terminalId: "terminal-1", applicationId: "app_office", approvalId: "approval-1",
  });
  assert.equal(retry.attempt, 1);
  assert.equal(nextLocalApplicationRetry({ ...contract, retry: { attempt: 3, maxAttempts: 3 } }, { transient: true }).state, "human_attention");
  assert.equal(nextLocalApplicationRetry(contract, { transient: false }).reason, "permanent_application_failure");
});

test("normalizes and redacts bounded user-facing results", () => {
  const contract = createApplicationExecutionContract({ resolution, workItem, principalId: "user-1", approvalId: "approval-1" });
  const result = normalizeApplicationResult({
    contract,
    status: "succeeded",
    summary: "token=super-secret finished",
    outputRefs: [{ assetId: "asset-2", hash: "sha256:y", version: "v2", raw: "drop" }],
  });
  assert.match(result.summary, /\[redacted\]/);
  assert.equal(JSON.stringify(result).includes("super-secret"), false);
  assert.deepEqual(result.outputRefs, [{ assetId: "asset-2", hash: "sha256:y", version: "v2" }]);
});
