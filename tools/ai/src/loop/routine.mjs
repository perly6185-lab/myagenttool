import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  latestLoopRoutineRunReadModel,
  listLoopRoutineFindingsReadModel,
  listLoopRoutineRunsReadModel,
  rebuildLoopRoutineRunsIndex,
  showLoopRoutineRunReadModel,
  updateLoopRoutineRunIndex,
} from "./routine-inspect.mjs";
export {
  formatLoopRoutineCheck,
  formatLoopRoutineFanoutPlan,
  formatLoopRoutineFanoutResult,
  formatLoopRoutineFindings,
  formatLoopRoutineLatest,
  formatLoopRoutinePlan,
  formatLoopRoutineRunList,
  formatLoopRoutineSchedulePlan,
  formatLoopRoutineScheduleRun,
  formatLoopRoutineShow,
} from "./routine-formatters.mjs";
import { executeRoutineChecks, resolveRoutineCheckCommand } from "./routine-checks.mjs";
import {
  executeLoopRoutineFanout as executeLoopRoutineFanoutCore,
  planLoopRoutineFanout as planLoopRoutineFanoutCore,
} from "./routine-fanout.mjs";
import { generateRoutineFindings } from "./routine-findings.mjs";
import { collectRoutineInputs, inputSummary, LOOP_ROUTINE_SUPPORTED_RUN_INPUTS } from "./routine-inputs.mjs";
import { collectRoutineSkills, resolveRoutineSkillPath } from "./routine-skills.mjs";
import { readJsonFile, routineRunPath } from "./routine-runs.mjs";
import {
  arrayOr,
  booleanOr,
  fail,
  findRoutineSourceRoot,
  isObject,
  nonNegativeIntegerOr,
  normalizePath,
  positiveIntegerOr,
  relativeRepoPath,
  safeId,
  safePathSegment,
  stringArrayOr,
  stringOr,
  uniqueStrings,
} from "./routine-utils.mjs";
import { parseSimpleYaml } from "./routine-yaml.mjs";

export { rebuildLoopRoutineRunsIndex };

const scriptPath = fileURLToPath(import.meta.url);
const __dirname = dirname(scriptPath);
const defaultRepoRoot = resolve(__dirname, "../../../..");
const repoRoot = resolve(process.env.MYAGENTTOOL_REPO_ROOT ?? defaultRepoRoot);
const cliPath = resolve(__dirname, "../index.mjs");

export const LOOP_ROUTINE_API_VERSION = "myagenttool.dev/v1";
export const LOOP_ROUTINE_KIND = "LoopRoutine";
export const LOOP_ROUTINE_SCHEMA_VERSION = 1;
export const LOOP_ROUTINE_SCHEDULE_MODES = ["manual", "cron", "event"];
export const LOOP_ROUTINE_INPUT_TYPES = [
  "filesystem.glob",
  "git.commits",
  "github.issues",
  "github.prs",
  "github.checks",
  "github.commits",
  "loop.registry",
];
export const LOOP_ROUTINE_CHECK_TYPES = ["command", "loop-registry", "docs-check", "typecheck", "test"];
export const LOOP_ROUTINE_WRITE_POLICIES = ["forbidden", "approval-required", "allowed"];

const LOOP_ROUTINE_DEFAULT_COMMAND_ALLOWLIST = new Set([
  "ai:loop-registry-check",
  "docs:check",
  "typecheck",
  "test",
  "ai:check",
]);

export function loadLoopRoutineFile(file, root = repoRoot) {
  if (!file) fail("Missing --file.");
  const path = resolve(root, file);
  if (!existsSync(path)) fail(`Loop routine file not found: ${file}`);
  const source = readFileSync(path, "utf8");
  const parsed = parseLoopRoutineSource(source, path);
  const sourceRoot = findRoutineSourceRoot(path);
  return {
    path,
    relativePath: relativeRepoPath(path, root),
    routine: normalizeLoopRoutine(parsed, { sourceRoot }),
  };
}

export function parseLoopRoutineSource(source, path = "routine.json") {
  if (/\.(ya?ml)$/i.test(path)) return parseSimpleYaml(source);
  try {
    return JSON.parse(source);
  } catch (error) {
    fail(`Invalid loop routine JSON in ${path}: ${error.message}`);
  }
}

export function normalizeLoopRoutine(value, context = {}) {
  const routine = isObject(value) ? value : {};
  const id = stringOr(routine.metadata?.id, "routine");
  return {
    apiVersion: stringOr(routine.apiVersion, LOOP_ROUTINE_API_VERSION),
    kind: stringOr(routine.kind, LOOP_ROUTINE_KIND),
    metadata: {
      id,
      name: stringOr(routine.metadata?.name, id),
      description: stringOr(routine.metadata?.description, ""),
      owner: stringOr(routine.metadata?.owner, "engineering"),
      enabled: booleanOr(routine.metadata?.enabled, true),
    },
    schedule: {
      mode: stringOr(routine.schedule?.mode, "manual"),
      timezone: stringOr(routine.schedule?.timezone, "UTC"),
      cron: routine.schedule?.cron ?? null,
      event: routine.schedule?.event ?? null,
      maxConcurrency: positiveIntegerOr(routine.schedule?.maxConcurrency, 1),
      cooldownMs: nonNegativeIntegerOr(routine.schedule?.cooldownMs, 0),
      deadlineMs: positiveIntegerOr(routine.schedule?.deadlineMs, 1800000),
    },
    inputs: arrayOr(routine.inputs, []).map((input) => ({ ...input })),
    skills: arrayOr(routine.skills, []).map((skill) => ({
      id: stringOr(skill?.id, ""),
      path: stringOr(skill?.path, ""),
      required: booleanOr(skill?.required, false),
      sourcePath: stringOr(skill?.sourcePath, context.sourceRoot ? normalizePath(resolve(context.sourceRoot, stringOr(skill?.path, ""))) : ""),
    })),
    goal: {
      summary: stringOr(routine.goal?.summary, ""),
      successCriteria: stringArrayOr(routine.goal?.successCriteria, []),
      fanout: {
        enabled: booleanOr(routine.goal?.fanout?.enabled, false),
        mode: stringOr(routine.goal?.fanout?.mode, "none"),
        priority: stringOr(routine.goal?.fanout?.priority, "normal"),
        apply: booleanOr(routine.goal?.fanout?.apply, false),
        verify: booleanOr(routine.goal?.fanout?.verify, true),
        isolateWorktree: booleanOr(routine.goal?.fanout?.isolateWorktree, true),
      },
    },
    checks: arrayOr(routine.checks, []).map((check) => ({ ...check })),
    outputs: {
      summary: stringOr(routine.outputs?.summary, `.myagenttool/state/${id}.md`),
      findings: stringOr(routine.outputs?.findings, `.myagenttool/state/${id}-findings.json`),
      enqueueFindings: booleanOr(routine.outputs?.enqueueFindings, false),
    },
    safety: {
      remoteWrites: stringOr(routine.safety?.remoteWrites, "forbidden"),
      githubWrites: stringOr(routine.safety?.githubWrites, "forbidden"),
      requiresApprovalFor: stringArrayOr(routine.safety?.requiresApprovalFor, ["apply", "push", "pr-create", "pr-merge"]),
      commandAllowlist: stringArrayOr(routine.safety?.commandAllowlist, [...LOOP_ROUTINE_DEFAULT_COMMAND_ALLOWLIST]),
    },
  };
}

export function validateLoopRoutine(routine, root = repoRoot) {
  const errors = [];
  const warnings = [];
  if (routine.apiVersion !== LOOP_ROUTINE_API_VERSION) errors.push(`apiVersion must be ${LOOP_ROUTINE_API_VERSION}.`);
  if (routine.kind !== LOOP_ROUTINE_KIND) errors.push(`kind must be ${LOOP_ROUTINE_KIND}.`);
  if (!safeId(routine.metadata.id)) errors.push("metadata.id must use letters, numbers, dots, underscores, or hyphens.");
  if (!routine.metadata.name) errors.push("metadata.name is required.");
  if (!LOOP_ROUTINE_SCHEDULE_MODES.includes(routine.schedule.mode)) {
    errors.push(`schedule.mode must be one of: ${LOOP_ROUTINE_SCHEDULE_MODES.join(", ")}.`);
  }
  if (routine.schedule.mode === "cron" && !routine.schedule.cron) {
    errors.push("schedule.cron is required when schedule.mode is cron.");
  }
  if (routine.schedule.mode === "event" && !routine.schedule.event) {
    errors.push("schedule.event is required when schedule.mode is event.");
  }
  if (routine.schedule.mode !== "manual") {
    warnings.push("Only manual routine execution is implemented in this slice; cron/event are validated for future schedulers.");
  }
  if (!routine.goal.summary) errors.push("goal.summary is required.");
  if (routine.goal.successCriteria.length === 0) warnings.push("goal.successCriteria is empty.");

  for (const input of routine.inputs) {
    if (!safeId(input.id)) errors.push("Each input requires a stable id.");
    if (!LOOP_ROUTINE_INPUT_TYPES.includes(input.type)) {
      errors.push(`Input ${input.id ?? "(missing id)"} has unsupported type ${input.type ?? "(missing type)"}.`);
    }
    if (input.type?.startsWith("github.") && !input.repo) {
      errors.push(`Input ${input.id} requires repo for GitHub input type ${input.type}.`);
    }
    if (input.type === "filesystem.glob" && !input.pattern) {
      errors.push(`Input ${input.id} requires pattern.`);
    }
  }

  for (const skill of routine.skills) {
    if (!safeId(skill.id)) errors.push("Each skill requires a stable id.");
    if (!skill.path) errors.push(`Skill ${skill.id || "(missing id)"} requires path.`);
    if (skill.path && skill.required && !resolveRoutineSkillPath(skill, root)) {
      errors.push(`Required skill ${skill.id} not found: ${skill.path}`);
    }
    if (skill.path && !resolveRoutineSkillPath(skill, root)) {
      warnings.push(`Skill ${skill.id || skill.path} not found locally: ${skill.path}`);
    }
  }

  for (const check of routine.checks) {
    if (!safeId(check.id)) errors.push("Each check requires a stable id.");
    if (!LOOP_ROUTINE_CHECK_TYPES.includes(check.type)) {
      errors.push(`Check ${check.id ?? "(missing id)"} has unsupported type ${check.type ?? "(missing type)"}.`);
    }
    if (check.type === "command" && !check.command) errors.push(`Check ${check.id} requires command.`);
    if (check.command && !routine.safety.commandAllowlist.includes(check.command)) {
      errors.push(`Check ${check.id} command is not allowlisted: ${check.command}`);
    }
  }

  if (!routine.outputs.summary) errors.push("outputs.summary is required.");
  if (!routine.outputs.findings) errors.push("outputs.findings is required.");
  if (!LOOP_ROUTINE_WRITE_POLICIES.includes(routine.safety.remoteWrites)) {
    errors.push(`safety.remoteWrites must be one of: ${LOOP_ROUTINE_WRITE_POLICIES.join(", ")}.`);
  }
  if (!LOOP_ROUTINE_WRITE_POLICIES.includes(routine.safety.githubWrites)) {
    errors.push(`safety.githubWrites must be one of: ${LOOP_ROUTINE_WRITE_POLICIES.join(", ")}.`);
  }
  if (routine.safety.remoteWrites !== "forbidden") warnings.push("Routine may affect remote state in a future execute step.");
  if (routine.safety.githubWrites !== "forbidden") warnings.push("Routine may affect GitHub state in a future execute step.");

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    routineId: routine.metadata.id,
  };
}

export function buildLoopRoutinePlan({ routine, sourcePath, root = repoRoot }) {
  const validation = validateLoopRoutine(routine, root);
  const inputPlan = routine.inputs.map((input) => ({
    id: input.id,
    type: input.type,
    supportedInRun: LOOP_ROUTINE_SUPPORTED_RUN_INPUTS.includes(input.type),
    readOnly: true,
    summary: inputSummary(input),
  }));
  const skillPlan = routine.skills.map((skill) => ({
    id: skill.id,
    path: skill.path,
    required: skill.required,
    exists: Boolean(resolveRoutineSkillPath(skill, root)),
  }));
  const checkPlan = routine.checks.map((check) => ({
    id: check.id,
    type: check.type,
    command: check.command ?? null,
    required: booleanOr(check.required, true),
    allowed: !check.command || routine.safety.commandAllowlist.includes(check.command),
  }));
  return {
    schemaVersion: LOOP_ROUTINE_SCHEMA_VERSION,
    routineId: routine.metadata.id,
    sourcePath,
    valid: validation.ok,
    validation,
    schedule: routine.schedule,
    execution: {
      implementedMode: "manual",
      canRunNow: validation.ok && routine.metadata.enabled && routine.schedule.mode === "manual",
      dryRunSupported: true,
      writesLocalEvidence: true,
      remoteWrites: routine.safety.remoteWrites,
      githubWrites: routine.safety.githubWrites,
    },
    inputs: inputPlan,
    skills: skillPlan,
    goal: routine.goal,
    checks: checkPlan,
    outputs: routine.outputs,
    safety: routine.safety,
    risks: loopRoutinePlanRisks({ routine, inputPlan, skillPlan, checkPlan }),
  };
}

export function runLoopRoutine({ routine, sourcePath, dryRun = false, root = repoRoot }) {
  const plan = buildLoopRoutinePlan({ routine, sourcePath, root });
  if (!plan.valid) fail(`Loop routine is invalid:\n${plan.validation.errors.map((error) => `- ${error}`).join("\n")}`);
  if (!routine.metadata.enabled) fail(`Loop routine is disabled: ${routine.metadata.id}`);
  if (routine.schedule.mode !== "manual") fail(`Only manual routine execution is implemented. Got: ${routine.schedule.mode}`);
  if (dryRun) {
    return {
      dryRun: true,
      plan,
      routineRun: null,
    };
  }

  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${safePathSegment(routine.metadata.id)}`;
  const runDir = resolve(root, ".myagenttool/routine-runs", runId);
  mkdirSync(runDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const events = [];
  const appendEvent = (type, message, data = {}) => {
    const event = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
      routineRunId: runId,
      routineId: routine.metadata.id,
      type,
      createdAt: new Date().toISOString(),
      message,
      data,
    };
    events.push(event);
    writeFileSync(resolve(runDir, "events.jsonl"), `${JSON.stringify(event)}\n`, { encoding: "utf8", flag: "a" });
  };

  appendEvent("loop_routine_run_created", "Loop routine run created.", { sourcePath });
  writeFileSync(resolve(runDir, "routine.json"), `${JSON.stringify(routine, null, 2)}\n`, "utf8");
  writeFileSync(resolve(runDir, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  appendEvent("loop_routine_plan_written", "Loop routine plan written.", { plan: routineRunPath(runId, "plan.json") });

  const inputSnapshot = collectRoutineInputs(routine, root);
  writeFileSync(resolve(runDir, "input-snapshot.json"), `${JSON.stringify(inputSnapshot, null, 2)}\n`, "utf8");
  appendEvent("loop_routine_inputs_collected", "Loop routine inputs collected.", {
    inputCount: inputSnapshot.inputs.length,
    unsupportedCount: inputSnapshot.inputs.filter((input) => input.status === "unsupported").length,
  });

  const skillSnapshot = collectRoutineSkills(routine, root);
  writeFileSync(resolve(runDir, "skill-snapshot.json"), `${JSON.stringify(skillSnapshot, null, 2)}\n`, "utf8");
  appendEvent("loop_routine_skills_bound", "Loop routine skills bound.", {
    skillCount: skillSnapshot.skills.length,
    foundCount: skillSnapshot.skills.filter((skill) => skill.status === "found").length,
    requiredMissingCount: skillSnapshot.skills.filter((skill) => skill.required && skill.status !== "found").length,
  });

  const checksResult = executeRoutineChecks(routine, root, { cliPath });
  writeFileSync(resolve(runDir, "checks-result.json"), `${JSON.stringify(checksResult, null, 2)}\n`, "utf8");
  appendEvent("loop_routine_checks_completed", "Loop routine checks completed.", {
    checkCount: checksResult.checks.length,
    failedCount: checksResult.checks.filter((check) => check.status === "failed").length,
  });

  const findings = generateRoutineFindings({ routine, inputSnapshot, checksResult, skillSnapshot });
  const summary = buildRoutineSummary({ routine, plan, inputSnapshot, skillSnapshot, checksResult, findings, startedAt });
  writeFileSync(resolve(runDir, "summary.md"), summary, "utf8");
  writeFileSync(resolve(runDir, "findings.json"), `${JSON.stringify(findings, null, 2)}\n`, "utf8");
  writeRoutineOutput(root, routine.outputs.summary, summary);
  writeRoutineOutput(root, routine.outputs.findings, `${JSON.stringify(findings, null, 2)}\n`);
  appendEvent("loop_routine_outputs_written", "Loop routine outputs written.", {
    summary: routine.outputs.summary,
    findings: routine.outputs.findings,
  });
  const requiredFailures = checksResult.checks.filter((check) => check.required && check.status === "failed");
  const finalStatus = requiredFailures.length > 0 ? "failed" : "completed";
  appendEvent(finalStatus === "failed" ? "loop_routine_run_failed" : "loop_routine_run_completed", `Loop routine run ${finalStatus}.`, {
    findingCount: findings.length,
    failedRequiredChecks: requiredFailures.map((check) => check.id),
    fanoutExecuted: false,
  });

  const routineRun = {
    routineRunId: runId,
    routineId: routine.metadata.id,
    status: finalStatus,
    runDir: relativeRepoPath(runDir, root),
    events: routineRunPath(runId, "events.jsonl"),
    summary: routineRunPath(runId, "summary.md"),
    findings: routineRunPath(runId, "findings.json"),
    checksResult: routineRunPath(runId, "checks-result.json"),
    inputSnapshot: routineRunPath(runId, "input-snapshot.json"),
    skillSnapshot: routineRunPath(runId, "skill-snapshot.json"),
    outputSummary: routine.outputs.summary,
    outputFindings: routine.outputs.findings,
    findingCount: findings.length,
    failedRequiredChecks: requiredFailures.map((check) => check.id),
    eventsWritten: events.length,
  };
  updateLoopRoutineRunIndex({ routineRunId: runId, root, updateReason: "routine-run" });
  if (requiredFailures.length > 0) {
    const ids = requiredFailures.map((check) => check.id).join(", ");
    const error = new Error(`Loop routine required check(s) failed: ${ids}`);
    error.routineRun = routineRun;
    throw error;
  }

  return {
    dryRun: false,
    plan,
    routineRun,
  };
}

export function planLoopRoutineSchedule({ root = repoRoot, includeExamples = true, now = new Date() } = {}) {
  const state = readRoutineSchedulerState(root);
  const discovered = discoverLoopRoutineFiles({ root, includeExamples });
  const routines = discovered.map((file) => {
    try {
      const loaded = loadLoopRoutineFile(file, root);
      const plan = buildLoopRoutinePlan({ routine: loaded.routine, sourcePath: loaded.relativePath, root });
      const decision = routineScheduleDecision({ routine: loaded.routine, sourcePath: loaded.relativePath, plan, state, now });
      return {
        sourcePath: loaded.relativePath,
        routineId: loaded.routine.metadata.id,
        name: loaded.routine.metadata.name,
        enabled: loaded.routine.metadata.enabled,
        schedule: loaded.routine.schedule,
        valid: plan.valid,
        due: decision.due,
        reason: decision.reason,
        blockedBy: decision.blockedBy,
        lastRunAt: decision.lastRunAt,
        cooldownUntil: decision.cooldownUntil,
        validation: plan.validation,
      };
    } catch (error) {
      return {
        sourcePath: normalizePath(file),
        routineId: null,
        name: null,
        enabled: false,
        schedule: null,
        valid: false,
        due: false,
        reason: "load-failed",
        blockedBy: [error?.message ?? String(error)],
        lastRunAt: null,
        cooldownUntil: null,
        validation: { ok: false, errors: [error?.message ?? String(error)], warnings: [] },
      };
    }
  });
  const result = {
    schemaVersion: LOOP_ROUTINE_SCHEMA_VERSION,
    plannedAt: now.toISOString(),
    routineCount: routines.length,
    dueCount: routines.filter((routine) => routine.due).length,
    statePath: ".myagenttool/state/routine-scheduler.json",
    planPath: ".myagenttool/state/routine-schedule-plan.json",
    routines,
    boundaries: [
      "Schedule plan is local and does not run routines.",
      "Schedule run is a single local tick, not a daemon.",
      "Remote and GitHub writes remain governed by routine safety policy and explicit fanout commands.",
    ],
  };
  writeRoutineOutput(root, ".myagenttool/state/routine-schedule-plan.json", `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

export function runLoopRoutineSchedule({
  root = repoRoot,
  includeExamples = true,
  now = new Date(),
  dryRun = false,
  limit = null,
} = {}) {
  const schedulePlan = planLoopRoutineSchedule({ root, includeExamples, now });
  const state = readRoutineSchedulerState(root);
  const due = schedulePlan.routines.filter((routine) => routine.due).slice(0, limit ?? undefined);
  const runs = [];
  for (const item of due) {
    if (dryRun) {
      runs.push({
        routineId: item.routineId,
        sourcePath: item.sourcePath,
        status: "dry-run",
        routineRunId: null,
        error: null,
      });
      continue;
    }
    try {
      const loaded = loadLoopRoutineFile(item.sourcePath, root);
      const result = runLoopRoutine({ routine: loaded.routine, sourcePath: loaded.relativePath, root });
      const routineState = schedulerRoutineState(state, loaded.routine.metadata.id);
      routineState.lastRunAt = now.toISOString();
      routineState.lastStatus = result.routineRun.status;
      routineState.lastRoutineRunId = result.routineRun.routineRunId;
      routineState.lastSourcePath = loaded.relativePath;
      routineState.cooldownUntil = loaded.routine.schedule.cooldownMs > 0
        ? new Date(now.getTime() + loaded.routine.schedule.cooldownMs).toISOString()
        : null;
      routineState.running = [];
      runs.push({
        routineId: loaded.routine.metadata.id,
        sourcePath: loaded.relativePath,
        status: result.routineRun.status,
        routineRunId: result.routineRun.routineRunId,
        error: null,
      });
    } catch (error) {
      const routineId = item.routineId ?? item.sourcePath;
      const routineState = schedulerRoutineState(state, routineId);
      routineState.lastRunAt = now.toISOString();
      routineState.lastStatus = "failed";
      routineState.lastRoutineRunId = error?.routineRun?.routineRunId ?? null;
      routineState.lastSourcePath = item.sourcePath;
      routineState.lastError = error?.message ?? String(error);
      routineState.running = [];
      runs.push({
        routineId,
        sourcePath: item.sourcePath,
        status: "failed",
        routineRunId: error?.routineRun?.routineRunId ?? null,
        error: error?.message ?? String(error),
      });
    }
  }
  state.updatedAt = now.toISOString();
  writeRoutineSchedulerState(root, state);
  const result = {
    schemaVersion: LOOP_ROUTINE_SCHEMA_VERSION,
    ranAt: now.toISOString(),
    dryRun,
    dueCount: due.length,
    runCount: runs.length,
    planPath: ".myagenttool/state/routine-schedule-plan.json",
    statePath: ".myagenttool/state/routine-scheduler.json",
    runs,
    skipped: schedulePlan.routines.filter((routine) => !routine.due).map((routine) => ({
      routineId: routine.routineId,
      sourcePath: routine.sourcePath,
      reason: routine.reason,
      blockedBy: routine.blockedBy,
    })),
  };
  writeRoutineOutput(root, ".myagenttool/state/routine-schedule-result.json", `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

export function listLoopRoutineRuns({ routineId = null, status = null, limit = 20, root = repoRoot } = {}) {
  return listLoopRoutineRunsReadModel({ routineId, status, limit, root });
}

export function latestLoopRoutineRun({ routineId, root = repoRoot } = {}) {
  try {
    return latestLoopRoutineRunReadModel({ routineId, root });
  } catch (error) {
    fail(error?.message ?? String(error));
  }
}

export function showLoopRoutineRun({ routineRunId, root = repoRoot }) {
  try {
    return showLoopRoutineRunReadModel({ routineRunId, root });
  } catch (error) {
    fail(error?.message ?? String(error));
  }
}

export function listLoopRoutineFindings({ routineRunId, severity = null, withSuggestedRun = false, root = repoRoot }) {
  try {
    return listLoopRoutineFindingsReadModel({ routineRunId, severity, withSuggestedRun, root });
  } catch (error) {
    fail(error?.message ?? String(error));
  }
}

export function planLoopRoutineFanout({ routineRunId, root = repoRoot }) {
  const result = planLoopRoutineFanoutCore({ routineRunId, root, schemaVersion: LOOP_ROUTINE_SCHEMA_VERSION });
  updateLoopRoutineRunIndex({ routineRunId, root, updateReason: "fanout-plan" });
  return result;
}

export function executeLoopRoutineFanout({
  routineRunId,
  approval,
  enqueue = false,
  runWorker = false,
  workerId = null,
  priority = null,
  timeoutMs = null,
  workerMode = "child-run",
  childProvider = "mock",
  childApply = false,
  isolateWorktree = false,
  baseRef = "HEAD",
  childSkipVerify = false,
  root = repoRoot,
}) {
  const result = executeLoopRoutineFanoutCore({
    routineRunId,
    approval,
    enqueue,
    runWorker,
    workerId,
    priority,
    timeoutMs,
    workerMode,
    childProvider,
    childApply,
    isolateWorktree,
    baseRef,
    childSkipVerify,
    root,
    schemaVersion: LOOP_ROUTINE_SCHEMA_VERSION,
    cliPath,
    planRoutineFanout: planLoopRoutineFanoutCore,
  });
  updateLoopRoutineRunIndex({ routineRunId, root, updateReason: "fanout-execute" });
  return result;
}

function discoverLoopRoutineFiles({ root, includeExamples }) {
  const dirs = [resolve(root, ".myagenttool/routines")];
  if (includeExamples) dirs.push(resolve(root, "docs/examples/loop-routines"));
  const files = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!/\.(json|ya?ml)$/i.test(name)) continue;
      files.push(relativeRepoPath(resolve(dir, name), root));
    }
  }
  return uniqueStrings(files).sort();
}

function readRoutineSchedulerState(root) {
  const path = resolve(root, ".myagenttool/state/routine-scheduler.json");
  if (!existsSync(path)) {
    return { schemaVersion: LOOP_ROUTINE_SCHEMA_VERSION, updatedAt: null, routines: {} };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return {
      schemaVersion: parsed.schemaVersion ?? LOOP_ROUTINE_SCHEMA_VERSION,
      updatedAt: parsed.updatedAt ?? null,
      routines: isObject(parsed.routines) ? parsed.routines : {},
    };
  } catch {
    return { schemaVersion: LOOP_ROUTINE_SCHEMA_VERSION, updatedAt: null, routines: {} };
  }
}

function writeRoutineSchedulerState(root, state) {
  writeRoutineOutput(root, ".myagenttool/state/routine-scheduler.json", `${JSON.stringify(state, null, 2)}\n`);
}

function schedulerRoutineState(state, routineId) {
  if (!state.routines[routineId]) {
    state.routines[routineId] = {
      lastRunAt: null,
      lastStatus: null,
      lastRoutineRunId: null,
      lastSourcePath: null,
      cooldownUntil: null,
      running: [],
      lastError: null,
    };
  }
  return state.routines[routineId];
}

function routineScheduleDecision({ routine, sourcePath, plan, state, now }) {
  const routineState = schedulerRoutineState(state, routine.metadata.id);
  const blockedBy = [];
  if (!plan.valid) blockedBy.push("invalid");
  if (!routine.metadata.enabled) blockedBy.push("disabled");
  const cooldownUntil = routineState.cooldownUntil ?? cooldownUntilFromLastRun(routine, routineState);
  if (cooldownUntil && Date.parse(cooldownUntil) > now.getTime()) blockedBy.push("cooldown");
  if (arrayOr(routineState.running, []).length >= routine.schedule.maxConcurrency) blockedBy.push("maxConcurrency");
  const scheduleDue = isRoutineScheduleDue({ routine, routineState, now });
  if (!scheduleDue.due) blockedBy.push(scheduleDue.reason);
  return {
    due: blockedBy.length === 0,
    reason: blockedBy.length === 0 ? "due" : blockedBy[0],
    blockedBy,
    lastRunAt: routineState.lastRunAt ?? null,
    cooldownUntil,
    sourcePath,
  };
}

function cooldownUntilFromLastRun(routine, routineState) {
  if (!routineState.lastRunAt || routine.schedule.cooldownMs <= 0) return null;
  const last = Date.parse(routineState.lastRunAt);
  if (!Number.isFinite(last)) return null;
  return new Date(last + routine.schedule.cooldownMs).toISOString();
}

function isRoutineScheduleDue({ routine, routineState, now }) {
  if (routine.schedule.mode === "manual") {
    return { due: !routineState.lastRunAt, reason: routineState.lastRunAt ? "manual-already-ran" : "manual-first-run" };
  }
  if (routine.schedule.mode === "event") {
    return { due: false, reason: "event-scheduler-future-slice" };
  }
  if (routine.schedule.mode === "cron") {
    return isSimpleCronDue({ cron: routine.schedule.cron, routineState, now });
  }
  return { due: false, reason: "unsupported-schedule" };
}

function isSimpleCronDue({ cron, routineState, now }) {
  const last = Date.parse(routineState.lastRunAt ?? "");
  if (!Number.isFinite(last)) return { due: true, reason: "cron-first-run" };
  const elapsed = now.getTime() - last;
  if (cron === "@hourly") return { due: elapsed >= 60 * 60 * 1000, reason: elapsed >= 60 * 60 * 1000 ? "cron-hourly" : "cron-not-due" };
  if (cron === "@daily") return { due: elapsed >= 24 * 60 * 60 * 1000, reason: elapsed >= 24 * 60 * 60 * 1000 ? "cron-daily" : "cron-not-due" };
  return { due: false, reason: "cron-parser-future-slice" };
}

function buildRoutineSummary({ routine, plan, inputSnapshot, skillSnapshot, checksResult, findings, startedAt }) {
  const inputLines = inputSnapshot.inputs.map((input) => `- ${input.id}: ${input.status} (${input.items.length} item(s))${input.reason ? ` - ${input.reason}` : ""}`);
  const skillLines = skillSnapshot.skills.map((skill) => `- ${skill.id}: ${skill.status} (${skill.path})${skill.sha256 ? ` sha256=${skill.sha256.slice(0, 12)}` : ""}`);
  const checkLines = checksResult.checks.map((check) => `- ${check.id}: ${check.status} (${check.command ?? "no command"}, exit ${check.exitCode ?? "n/a"})`);
  const findingLines = findings.map((finding) => `- [${finding.severity}] ${finding.title}: ${finding.proposedAction}`);
  return `# Loop Routine Summary

Routine: ${routine.metadata.name}
Routine ID: ${routine.metadata.id}
Started: ${startedAt}
Completed: ${new Date().toISOString()}
Schedule mode: ${routine.schedule.mode}

## Goal

${routine.goal.summary}

## Inputs

${inputLines.join("\n") || "- None."}

## Skills

${skillLines.join("\n") || "- None."}

## Checks

${checkLines.join("\n") || "- None."}

## Findings

${findingLines.join("\n") || "- No findings generated by this local routine slice."}

## Outputs

- Summary: ${routine.outputs.summary}
- Findings: ${routine.outputs.findings}

## Safety

- Remote writes: ${plan.safety.remoteWrites}
- GitHub writes: ${plan.safety.githubWrites}
- Fanout executed: no
`;
}

function writeRoutineOutput(root, path, content) {
  const target = resolve(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
}

function loopRoutinePlanRisks({ routine, inputPlan, skillPlan, checkPlan }) {
  const risks = [];
  if (routine.schedule.mode !== "manual") risks.push("Cron/event scheduling is specified but not executed by this local slice.");
  if (inputPlan.some((input) => !input.supportedInRun)) risks.push("Some inputs are planned but not collected by the local runner yet.");
  if (skillPlan.some((skill) => skill.required && !skill.exists)) risks.push("A required skill is missing.");
  if (checkPlan.some((check) => !check.allowed)) risks.push("One or more checks are blocked by the command allowlist.");
  if (routine.goal.fanout.enabled) risks.push("Finding fanout is specified but not executed by this slice.");
  if (routine.outputs.enqueueFindings) risks.push("Output enqueueFindings is recorded but not executed by this slice.");
  if (risks.length === 0) risks.push("No known routine plan risks.");
  return risks;
}
