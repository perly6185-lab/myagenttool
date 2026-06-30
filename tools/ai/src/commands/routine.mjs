import {
  buildLoopRoutinePlan,
  executeLoopRoutineFanout,
  formatLoopRoutineFanoutPlan,
  formatLoopRoutineFanoutResult,
  formatLoopRoutineFindings,
  formatLoopRoutineCheck,
  formatLoopRoutineLatest,
  formatLoopRoutinePlan,
  formatLoopRoutineRunList,
  formatLoopRoutineSchedulePlan,
  formatLoopRoutineScheduleRun,
  formatLoopRoutineShow,
  latestLoopRoutineRun,
  listLoopRoutineFindings,
  listLoopRoutineRuns,
  loadLoopRoutineFile,
  planLoopRoutineFanout,
  planLoopRoutineSchedule,
  rebuildLoopRoutineRunsIndex,
  runLoopRoutineSchedule,
  runLoopRoutine,
  showLoopRoutineRun,
  validateLoopRoutine,
} from "../loop/routine.mjs";

let repoRoot = null;
const loopRoutineCommandsContext = {
  fail: null,
  option: null,
};

export function configureLoopRoutineCommandsContext(context) {
  repoRoot = context.repoRoot;
  loopRoutineCommandsContext.fail = context.fail;
  loopRoutineCommandsContext.option = context.option;
}

function requireLoopRoutineCommandsDependency(name) {
  const dependency = loopRoutineCommandsContext[name];
  if (!dependency) throw new Error("Loop routine command dependency has not been configured: " + name);
  return dependency;
}

function fail(...args) {
  return requireLoopRoutineCommandsDependency("fail")(...args);
}

function option(...args) {
  return requireLoopRoutineCommandsDependency("option")(...args);
}

export function loopRoutineCheck(args) {
  const { relativePath, routine } = loadRoutine(args);
  const validation = validateLoopRoutine(routine, repoRoot);
  if (args.includes("--json")) {
    console.log(JSON.stringify({ routine, validation }, null, 2));
  } else {
    console.log(formatLoopRoutineCheck({ routine, sourcePath: relativePath, validation }));
  }
  if (!validation.ok) {
    fail("Loop routine validation failed.");
  }
}

export function loopRoutinePlan(args) {
  const { relativePath, routine } = loadRoutine(args);
  const plan = buildLoopRoutinePlan({ routine, sourcePath: relativePath, root: repoRoot });
  if (args.includes("--json")) {
    console.log(JSON.stringify({ plan }, null, 2));
  } else {
    console.log(formatLoopRoutinePlan(plan));
  }
  if (!plan.valid) {
    fail("Loop routine plan is invalid.");
  }
}

export function loopRoutineRun(args) {
  const { relativePath, routine } = loadRoutine(args);
  const result = runLoopRoutine({
    routine,
    sourcePath: relativePath,
    dryRun: args.includes("--dry-run"),
    root: repoRoot,
  });
  if (args.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.dryRun) {
    console.log(formatLoopRoutinePlan(result.plan));
    return;
  }
  console.log(`Loop routine run completed: ${result.routineRun.routineRunId}`);
  console.log(`Summary: ${result.routineRun.summary}`);
  console.log(`Findings: ${result.routineRun.findings}`);
}

export function loopRoutineFanoutPlan(args) {
  const routineRunId = option(args, "--routine-run") ?? option(args, "--run");
  if (!routineRunId) fail("Missing --routine-run.");
  const result = planLoopRoutineFanout({ routineRunId, root: repoRoot });
  if (args.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(formatLoopRoutineFanoutPlan(result.plan));
  console.log(`Plan: ${result.planPath}`);
}

export function loopRoutineFanoutExecute(args) {
  const routineRunId = option(args, "--routine-run") ?? option(args, "--run");
  if (!routineRunId) fail("Missing --routine-run.");
  const approval = option(args, "--approval");
  const result = executeLoopRoutineFanout({
    routineRunId,
    approval,
    enqueue: args.includes("--enqueue"),
    runWorker: args.includes("--run-worker"),
    workerId: option(args, "--worker"),
    priority: option(args, "--priority"),
    timeoutMs: optionalPositiveInteger(args, "--timeout-ms"),
    childProvider: option(args, "--child-provider") ?? option(args, "--provider") ?? "mock",
    childApply: args.includes("--child-apply"),
    isolateWorktree: args.includes("--isolate-worktree"),
    baseRef: option(args, "--base-ref") ?? "HEAD",
    childSkipVerify: args.includes("--child-skip-verify"),
    root: repoRoot,
  });
  if (args.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(formatLoopRoutineFanoutResult(result.result));
  console.log(`Result: ${result.resultPath}`);
}

export function loopRoutineSchedulePlan(args) {
  const result = planLoopRoutineSchedule({
    root: repoRoot,
    includeExamples: !args.includes("--no-examples"),
  });
  if (args.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(formatLoopRoutineSchedulePlan(result));
}

export function loopRoutineScheduleRun(args) {
  const result = runLoopRoutineSchedule({
    root: repoRoot,
    includeExamples: !args.includes("--no-examples"),
    dryRun: args.includes("--dry-run"),
    limit: optionalPositiveInteger(args, "--limit"),
  });
  if (args.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(formatLoopRoutineScheduleRun(result));
}

export function loopRoutineList(args) {
  const result = listLoopRoutineRuns({
    root: repoRoot,
    routineId: option(args, "--routine") ?? null,
    status: option(args, "--status") ?? null,
    limit: optionalPositiveInteger(args, "--limit") ?? 20,
  });
  if (args.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(formatLoopRoutineRunList(result));
}

export function loopRoutineLatest(args) {
  const routineId = option(args, "--routine");
  if (!routineId) fail("Missing --routine.");
  const result = latestLoopRoutineRun({ routineId, root: repoRoot });
  if (args.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(formatLoopRoutineLatest(result));
}

export function loopRoutineShow(args) {
  const routineRunId = option(args, "--routine-run") ?? option(args, "--run");
  if (!routineRunId) fail("Missing --routine-run.");
  const result = showLoopRoutineRun({ routineRunId, root: repoRoot });
  if (args.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(formatLoopRoutineShow(result));
}

export function loopRoutineFindings(args) {
  const routineRunId = option(args, "--routine-run") ?? option(args, "--run");
  if (!routineRunId) fail("Missing --routine-run.");
  const result = listLoopRoutineFindings({
    routineRunId,
    root: repoRoot,
    severity: option(args, "--severity") ?? null,
    withSuggestedRun: args.includes("--with-suggested-run"),
  });
  if (args.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(formatLoopRoutineFindings(result));
}

export function loopRoutineIndexRebuild(args) {
  const result = rebuildLoopRoutineRunsIndex({ root: repoRoot });
  if (args.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(formatLoopRoutineIndexRebuild(result));
}

function formatLoopRoutineIndexRebuild(result) {
  return `# Loop Routine Runs Index

Index: ${result.indexPath}
Runs: ${result.index.runCount}
Latest: ${result.index.latestRunId ?? "none"}
Updated: ${result.index.generatedAt}
Reason: ${result.index.updateReason}
`;
}

function optionalPositiveInteger(args, name) {
  const value = option(args, name);
  if (value === undefined) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    fail(`${name} must be a positive integer.`);
  }
  return number;
}

function loadRoutine(args) {
  const file = option(args, "--file") ?? option(args, "--routine");
  try {
    return loadLoopRoutineFile(file, repoRoot);
  } catch (error) {
    fail(error?.message ?? String(error));
  }
}
