import assert from "node:assert/strict";
import test from "node:test";

import {
  latestWorkItemExecutionBinding,
  resolveWorkItemExecution,
} from "../src/services/work-item-execution.mjs";

const item = (bindings) => ({ id: "lwi_1", executionBindings: bindings });

test("projects an Issue-bound article import through the unified execution state", () => {
  const workItem = item([{
    kind: "article_import",
    targetId: "article_import_1",
    createdAt: "2026-08-10T00:00:00.000Z",
  }]);

  assert.equal(latestWorkItemExecutionBinding(workItem).kind, "article_import");
  assert.equal(resolveWorkItemExecution(workItem, {
    articleImportJobs: [{ id: "article_import_1", state: "running" }],
  }).executionState, "running");
  const completed = resolveWorkItemExecution(workItem, {
    articleImportJobs: [{ id: "article_import_1", state: "completed" }],
  });
  assert.equal(completed.executionState, "completed");
  assert.equal(completed.articleImport.id, "article_import_1");
});

test("projects an Issue-bound article derivative from its Agent invocation", () => {
  const workItem = item([{
    kind: "article_derivative",
    targetId: "article_derivative_1",
    createdAt: "2026-08-10T00:00:00.000Z",
  }]);
  const invocation = {
    id: "inv_derivative_1",
    status: "succeeded",
    options: { metadata: { articleDerivative: { id: "article_derivative_1", workItemId: "lwi_1" } } },
  };

  const projected = resolveWorkItemExecution(workItem, { invocations: [invocation] });
  assert.equal(projected.executionState, "completed");
  assert.equal(projected.invocation.id, invocation.id);
});

test("uses the newest execution kind across article and Agent bindings", () => {
  const workItem = item([
    { kind: "article_import", targetId: "article_import_1", createdAt: "2026-08-10T00:00:00.000Z" },
    { kind: "auto_run", targetId: "aur_1", createdAt: "2026-08-10T01:00:00.000Z" },
  ]);
  const projected = resolveWorkItemExecution(workItem, {
    articleImportJobs: [{ id: "article_import_1", state: "completed" }],
    autoRuns: [{ id: "aur_1", status: "running" }],
  });
  assert.equal(projected.binding.kind, "auto_run");
  assert.equal(projected.executionState, "running");
});
