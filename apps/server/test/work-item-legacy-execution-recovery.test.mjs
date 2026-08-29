import assert from "node:assert/strict";
import test from "node:test";

import { createWorkItemLegacyExecutionRecoveryService } from "../src/services/work-item-legacy-execution-recovery.mjs";

test("a failed legacy invocation creates one bound Auto-run and replays by recovery request id", async () => {
  const item = {
    id: "lwi_legacy",
    localNumber: 8,
    title: "Documentation-only recovery",
    body: "Create docs/result.md.",
    taskKind: "general",
    intentContract: {
      action: { accessMode: "write", operation: "mutate_files" },
      goal: "In the current Git project, create docs/result.md and do not change other files.",
    },
    projectId: "prj_1",
    terminalId: "dev_1",
    revision: 4,
    state: "open",
    waitingOn: "me",
    plannedDate: null,
    executionBindings: [{ kind: "application_invocation", targetId: "inv_failed" }],
  };
  const state = { autoRuns: [] };
  let reserveCount = 0;
  let enqueueCount = 0;
  const detail = () => ({
    ok: true,
    status: 200,
    body: {
      workItem: { ...item, executionBindings: [...item.executionBindings] },
      observability: {
        executionReview: {
          state: "failed",
          executionKind: "application_invocation",
          targetId: "inv_failed",
          targetStatus: "failed",
          attentionCode: "transport_closed",
        },
      },
    },
  });
  const service = createWorkItemLegacyExecutionRecoveryService({
    state,
    getWorkItem: detail,
    updateWorkItem: ({ plannedDate, waitingOn }) => {
      item.revision += 1;
      item.plannedDate = plannedDate;
      item.waitingOn = waitingOn;
      return { ok: true, body: { workItem: { ...item } } };
    },
    beginExecution: () => ({ ok: true, body: { operation: { id: "weo_recovery" } } }),
    abortExecution: () => ({ ok: true }),
    recordExecutionBinding: ({ targetId, operationId }) => {
      assert.equal(operationId, "weo_recovery");
      if (!item.executionBindings.some((binding) => binding.targetId === targetId)) {
        item.executionBindings.push({ kind: "auto_run", targetId });
      }
      return { ok: true, body: { workItem: { ...item } } };
    },
    reserveAutoRun: async (input) => {
      reserveCount += 1;
      const autoRun = {
        id: "aur_recovery",
        status: "materializing",
        phase: "understanding",
        worktreeId: null,
        executionRecovery: { ...input.executionRecovery },
      };
      state.autoRuns.push(autoRun);
      return { autoRun };
    },
    enqueueAutoRunUnderstanding: () => { enqueueCount += 1; },
    failAutoRunUnderstanding: () => {},
  });
  const request = {
    workItemId: item.id,
    recoveryRequestId: "ear_recovery",
    sourceTargetId: "inv_failed",
    timezoneOffset: -480,
  };

  const created = await service.restartAsAutoRun(request);
  assert.equal(created.replayed, false);
  assert.equal(created.autoRun.executionRecovery.sourceTargetId, "inv_failed");
  assert.equal(created.autoRun.executionRecovery.reasonCode, "transport_closed");
  assert.equal(created.autoRun.executionRecovery.routeHint, "develop");
  assert.equal(reserveCount, 1);
  assert.equal(enqueueCount, 1);
  assert.equal(item.executionBindings.at(-1).targetId, "aur_recovery");

  const replayed = await service.restartAsAutoRun(request);
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.autoRun.id, "aur_recovery");
  assert.equal(reserveCount, 1);
  assert.equal(enqueueCount, 2, "an unfinished understanding run is safely re-enqueued");
});
