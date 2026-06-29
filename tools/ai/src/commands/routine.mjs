import {
  buildLoopRoutinePlan,
  formatLoopRoutineCheck,
  formatLoopRoutinePlan,
  loadLoopRoutineFile,
  runLoopRoutine,
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

function loadRoutine(args) {
  const file = option(args, "--file") ?? option(args, "--routine");
  try {
    return loadLoopRoutineFile(file, repoRoot);
  } catch (error) {
    fail(error?.message ?? String(error));
  }
}
