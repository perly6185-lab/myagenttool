import { planDiscreteTasks } from "./discrete-task-planner.mjs";
import { validateTaskPlan } from "./task-plan-contract.mjs";

function normalizedKinds(expected) {
  const values = Array.isArray(expected?.taskKinds)
    ? expected.taskKinds
    : expected?.taskKind ? [expected.taskKind] : null;
  return values ? [...new Set(values.map(String).filter(Boolean))].sort() : null;
}
function sameValues(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function evaluateChannelIntentReplayCases(cases = []) {
  const results = [];
  let skipped = 0;
  for (const [index, entry] of (Array.isArray(cases) ? cases : []).entries()) {
    const expectedKinds = normalizedKinds(entry?.expected);
    if (!expectedKinds) {
      skipped += 1;
      results.push({
        id: String(entry?.id ?? `channel-replay-${index + 1}`),
        evaluable: false,
        passed: null,
        reason: "task_boundary_not_reviewed",
      });
      continue;
    }
    const plan = planDiscreteTasks({
      text: String(entry?.text ?? ""),
      intentId: String(entry?.id ?? `channel-replay-${index + 1}`),
    });
    const contract = validateTaskPlan(plan, { requireTasks: expectedKinds.length > 0 && !plan.clarification });
    const actualKinds = [...new Set(plan.tasks.map((task) => task.kind))].sort();
    const expectedClarification = entry?.expected?.clarificationKind ?? null;
    const actualClarification = plan.clarification?.kind ?? null;
    const kindsPassed = sameValues(actualKinds, expectedKinds);
    const clarificationPassed = expectedClarification === actualClarification;
    const passed = kindsPassed && clarificationPassed && contract.ok;
    results.push({
      id: String(entry?.id ?? `channel-replay-${index + 1}`),
      text: String(entry?.text ?? ""),
      source: entry?.source ?? null,
      evaluable: true,
      passed,
      expectedKinds,
      actualKinds,
      expectedClarification,
      actualClarification,
      contractErrors: contract.errors,
    });
  }
  const evaluated = results.filter((result) => result.evaluable);
  const passed = evaluated.filter((result) => result.passed).length;
  const unintended = evaluated.filter((result) =>
    result.actualKinds.some((kind) => !result.expectedKinds.includes(kind)));
  const clarificationCases = evaluated.filter((result) =>
    result.expectedClarification != null || result.actualClarification != null);
  return {
    schemaVersion: 1,
    total: results.length,
    evaluated: evaluated.length,
    skipped,
    passed,
    failed: evaluated.filter((result) => !result.passed),
    results,
    metrics: {
      taskBoundaryAccuracy: evaluated.length ? passed / evaluated.length : null,
      unintendedTaskRate: evaluated.length ? unintended.length / evaluated.length : null,
      clarificationAccuracy: clarificationCases.length
        ? clarificationCases.filter((result) => result.expectedClarification === result.actualClarification).length / clarificationCases.length
        : null,
    },
  };
}
