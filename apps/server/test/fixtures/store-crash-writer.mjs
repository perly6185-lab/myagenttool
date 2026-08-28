import { dirname } from "node:path";

import { createServerState } from "../../src/runtime/state-factory.mjs";
import { createRuntimeStoreBoundary } from "../../src/runtime/store-composition.mjs";
import { openSqliteStore } from "../../src/runtime/store/sqlite-store.mjs";
import { sameProjectPath } from "../../src/services/projects.mjs";
import { beginExecutionAction, updateExecutionAction } from "../../src/services/work-item-execution-action.mjs";

const sqlitePath = process.argv[2];
const stateStorePath = process.argv[3];
const now = () => "2026-08-28T00:00:00.000Z";
const { defaultProject, state } = createServerState({
  defaultProjectPath: dirname(stateStorePath),
  now,
});
const sqliteStore = await openSqliteStore({ path: sqlitePath });
const boundary = createRuntimeStoreBoundary({
  state,
  persistenceEnabled: true,
  stateStorePath,
  stateSchemaVersion: 1,
  now,
  defaultProject,
  sameProjectPath,
  sqliteStore,
});

boundary.store.transaction((tx) => {
  tx.insert("invocations", {
    id: "inv_committed_before_crash",
    ownerTeamId: "team_local",
    projectId: defaultProject.id,
    status: "queued",
    createdAt: now(),
  });
  const autoRun = {
    id: "aur_crash_ledger",
    teamId: "team_local",
    projectId: defaultProject.id,
    status: "failed",
    invocationId: "inv_committed_before_crash",
    createdAt: now(),
    updatedAt: now(),
  };
  state.autoRuns.unshift(autoRun);
  for (let index = 0; index < 21; index += 1) {
    const action = beginExecutionAction({
      state,
      autoRun,
      kind: "retry_execution",
      idempotencyKey: `crash-ledger-${index}`,
      request: { feedback: `attempt-${index}` },
      now,
      nextId: (prefix) => `${prefix}_crash_${index}`,
    });
    updateExecutionAction(action.receipt, {
      status: "succeeded",
      messageCode: "retry_started",
      targetId: `inv_retry_${index}`,
      nextOwner: "ai",
      now,
    });
  }
});
process.stdout.write("STORE_COMMIT_COMPLETE\n");

// The parent intentionally sends SIGKILL. No close handler or normal shutdown
// runs, which exercises the durable commit rather than graceful flushing.
setInterval(() => {}, 60_000);
