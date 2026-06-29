import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOOP_ENQUEUEABLE_STATES,
  appendLoopEvent,
  createLoopRegistryEntry,
  findLoopRegistryEntry,
  loopRunPath,
  normalizeLoopQueuePriority,
  updateLoopEvidence,
  updateLoopRun,
  upsertLoopRegistryEntry,
} from "./registry.mjs";
import {
  latestLoopRoutineRunReadModel,
  listLoopRoutineFindingsReadModel,
  listLoopRoutineRunsReadModel,
  rebuildLoopRoutineRunsIndex,
  showLoopRoutineRunReadModel,
  updateLoopRoutineRunIndex,
} from "./routine-inspect.mjs";

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

const LOOP_ROUTINE_SUPPORTED_RUN_INPUTS = ["filesystem.glob", "git.commits", "github.issues", "github.prs", "github.checks", "github.commits", "loop.registry"];
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

export function formatLoopRoutineCheck({ routine, sourcePath, validation }) {
  return `# Loop Routine Check

Routine: ${routine.metadata.id}
Source: ${sourcePath}
OK: ${validation.ok ? "yes" : "no"}

Errors:
${list(validation.errors)}

Warnings:
${list(validation.warnings)}
`;
}

export function formatLoopRoutinePlan(plan) {
  return `# Loop Routine Plan

Routine: ${plan.routineId}
Source: ${plan.sourcePath}
Valid: ${plan.valid ? "yes" : "no"}
Can run now: ${plan.execution.canRunNow ? "yes" : "no"}
Schedule: ${plan.schedule.mode}${plan.schedule.cron ? ` (${plan.schedule.cron})` : ""}

## Inputs

${plan.inputs.map((input) => `- ${input.id}: ${input.type} (${input.supportedInRun ? "implemented" : "planned"}) - ${input.summary}`).join("\n") || "- None."}

## Skills

${plan.skills.map((skill) => `- ${skill.id}: ${skill.path} (${skill.exists ? "found" : "missing"}${skill.required ? ", required" : ""})`).join("\n") || "- None."}

## Checks

${plan.checks.map((check) => `- ${check.id}: ${check.type}${check.command ? ` ${check.command}` : ""} (${check.allowed ? "allowed" : "blocked"})`).join("\n") || "- None."}

## Outputs

- Summary: ${plan.outputs.summary}
- Findings: ${plan.outputs.findings}
- Enqueue findings: ${plan.outputs.enqueueFindings ? "yes" : "no"}

## Safety

- Remote writes: ${plan.safety.remoteWrites}
- GitHub writes: ${plan.safety.githubWrites}
- Approval gates: ${plan.safety.requiresApprovalFor.join(", ") || "none"}

## Risks

${list(plan.risks)}
`;
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

  const checksResult = executeRoutineChecks(routine, root);
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

export function formatLoopRoutineRunList(result) {
  return `# Loop Routine Runs

Runs: ${result.routineRunCount}
Routine filter: ${result.filters.routineId ?? "all"}
Status filter: ${result.filters.status ?? "all"}
Limit: ${result.filters.limit}

## Runs

${result.runs.map((run) => `- ${run.routineRunId}: ${run.routineId} ${run.status} findings=${run.findingCount} suggested=${run.suggestedRunCount} started=${run.startedAt ?? "unknown"}`).join("\n") || "- None."}
`;
}

export function formatLoopRoutineLatest(result) {
  if (!result.routineRun) {
    return `# Latest Loop Routine Run

Routine: ${result.routineId}
Run: none
`;
  }
  return `# Latest Loop Routine Run

Routine: ${result.routineId}
Run: ${result.routineRun.routineRunId}
Status: ${result.routineRun.status}
Started: ${result.routineRun.startedAt ?? "unknown"}
Completed: ${result.routineRun.completedAt ?? "unknown"}
Findings: ${result.routineRun.findingCount}
Suggested runs: ${result.routineRun.suggestedRunCount}
`;
}

export function formatLoopRoutineShow(result) {
  return `# Loop Routine Run

Run: ${result.routineRunId}
Routine: ${result.routineId}
Status: ${result.status}
Started: ${result.startedAt ?? "unknown"}
Completed: ${result.completedAt ?? "unknown"}
Run dir: ${result.runDir}

## Summary

- Inputs: ${result.summary.inputCount}
- Skills: ${result.summary.skillCount}
- Checks: ${result.summary.checkCount}
- Failed checks: ${result.summary.failedCheckCount}
- Findings: ${result.summary.findingCount}
- Suggested runs: ${result.summary.suggestedRunCount}
- Fanout candidates: ${result.summary.fanoutCandidateCount ?? "not planned"}
- Fanout created: ${result.summary.fanoutCreatedCount ?? "not executed"}
- Fanout enqueued: ${result.summary.fanoutEnqueuedCount ?? "not executed"}
- Fanout worker completed: ${result.summary.fanoutWorkerCompletedCount ?? "not executed"}

## Evidence

${list(result.evidence)}

## Findings

${result.findings.map((finding) => `- ${finding.id}: ${finding.severity} ${finding.title}${finding.suggestedRun ? " -> suggested-run" : ""}`).join("\n") || "- None."}

## Fanout

- Plan: ${result.fanout.plan ? `${result.fanout.plan.candidateCount} candidates` : "none"}
- Result: ${result.fanout.result ? `${result.fanout.result.createdCount} created, ${result.fanout.result.enqueuedCount ?? 0} enqueued` : "none"}
`;
}

export function formatLoopRoutineFindings(result) {
  return `# Loop Routine Findings

Routine run: ${result.routineRunId}
Findings: ${result.findingCount}
Severity filter: ${result.filters.severity ?? "all"}
Suggested-run filter: ${result.filters.withSuggestedRun ? "yes" : "no"}

## Findings

${result.findings.map((finding) => [
    `- ${finding.id}: ${finding.severity} ${finding.title}`,
    `  Source: ${formatFindingSource(finding.source)}`,
    `  Proposed action: ${finding.proposedAction || "none"}`,
    `  Suggested run: ${finding.suggestedRun ? "yes" : "no"}`,
  ].join("\n")).join("\n") || "- None."}
`;
}

export function planLoopRoutineFanout({ routineRunId, root = repoRoot }) {
  const run = loadRoutineRun(routineRunId, root);
  const routine = readJsonFile(resolve(run.runDir, "routine.json"));
  const findings = readJsonFile(resolve(run.runDir, "findings.json"));
  const skillSnapshot = existsSync(resolve(run.runDir, "skill-snapshot.json"))
    ? readJsonFile(resolve(run.runDir, "skill-snapshot.json"))
    : collectRoutineSkills(routine, root);
  const candidates = arrayOr(findings, [])
    .filter((finding) => isObject(finding.suggestedRun))
    .map((finding, index) => fanoutCandidate({ routine, routineRunId, finding, index, skillSnapshot }));
  const plan = {
    schemaVersion: LOOP_ROUTINE_SCHEMA_VERSION,
    routineRunId,
    routineId: routine.metadata?.id ?? run.routineId,
    plannedAt: new Date().toISOString(),
    mode: routine.goal?.fanout?.mode ?? "none",
    enabled: Boolean(routine.goal?.fanout?.enabled),
    approvalRequired: true,
    remoteWrites: routine.safety?.remoteWrites ?? "forbidden",
    githubWrites: routine.safety?.githubWrites ?? "forbidden",
    candidateCount: candidates.length,
    skippedCount: arrayOr(findings, []).length - candidates.length,
    skills: skillSnapshot.skills,
    candidates,
    boundaries: [
      "Fanout plan is local evidence only.",
      "Fanout execute creates planned loop runs by default.",
      "Fanout execute enqueues only with --enqueue or --run-worker.",
      "Fanout worker execution runs only with --run-worker and never pushes, creates PRs, or merges PRs.",
    ],
  };
  writeFileSync(resolve(run.runDir, "fanout-plan.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  writeFileSync(resolve(run.runDir, "fanout-plan.md"), formatLoopRoutineFanoutPlan(plan), "utf8");
  appendRoutineRunEvent(run, "loop_routine_fanout_planned", "Loop routine fanout plan written.", {
    candidateCount: candidates.length,
    skippedCount: plan.skippedCount,
    plan: routineRunPath(routineRunId, "fanout-plan.json"),
  });
  updateLoopRoutineRunIndex({ routineRunId, root, updateReason: "fanout-plan" });
  return {
    routineRunId,
    planPath: routineRunPath(routineRunId, "fanout-plan.json"),
    markdownPath: routineRunPath(routineRunId, "fanout-plan.md"),
    plan,
  };
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
  if (!String(approval ?? "").trim()) fail("Missing --approval.");
  if (runWorker && !String(workerId ?? "").trim()) fail("Missing --worker when --run-worker is used.");
  if (runWorker && workerMode !== "child-run") fail("Routine fanout worker only supports child-run mode.");
  if (childApply && !isolateWorktree) fail("--child-apply requires --isolate-worktree for routine fanout worker execution.");
  const run = loadRoutineRun(routineRunId, root);
  const planPath = resolve(run.runDir, "fanout-plan.json");
  const plan = existsSync(planPath) ? readJsonFile(planPath) : planLoopRoutineFanout({ routineRunId, root }).plan;
  if (!plan.enabled) fail(`Routine fanout is disabled for routine run ${routineRunId}.`);

  const previous = existsSync(resolve(run.runDir, "fanout-result.json"))
    ? readJsonFile(resolve(run.runDir, "fanout-result.json"))
    : { createdRuns: [] };
  const existingByFinding = new Map(arrayOr(previous.createdRuns, []).map((item) => [item.findingId, item]));
  const createdRuns = [];
  const skippedRuns = [];
  const allRuns = [];
  for (const candidate of arrayOr(plan.candidates, [])) {
    if (existingByFinding.has(candidate.findingId)) {
      const existing = existingByFinding.get(candidate.findingId);
      skippedRuns.push({ ...existing, reason: "already-created" });
      allRuns.push(existing);
      continue;
    }
    const child = createPlannedLoopRunFromFinding({ candidate, routineRunId, approval, root });
    createdRuns.push(child);
    allRuns.push(child);
  }
  const shouldEnqueue = enqueue || runWorker;
  const enqueuedRuns = shouldEnqueue ? enqueueFanoutRuns({ runs: allRuns, priority: priority ?? plan.priority ?? null, timeoutMs, root }) : [];
  const workerRuns = runWorker
    ? runFanoutWorkers({
        runs: allRuns,
        workerId,
        approval,
        childProvider,
        childApply,
        isolateWorktree,
        baseRef,
        childSkipVerify,
        root,
      })
    : [];
  const result = {
    schemaVersion: LOOP_ROUTINE_SCHEMA_VERSION,
    routineRunId,
    routineId: plan.routineId,
    executedAt: new Date().toISOString(),
    approval,
    options: {
      enqueue: shouldEnqueue,
      runWorker,
      workerId: workerId ?? null,
      priority: priority ?? null,
      timeoutMs: timeoutMs ?? null,
      workerMode,
      childProvider,
      childApply,
      isolateWorktree,
      baseRef: isolateWorktree ? baseRef : null,
      childSkipVerify,
    },
    createdCount: createdRuns.length,
    skippedCount: skippedRuns.length,
    enqueuedCount: enqueuedRuns.filter((item) => item.status === "enqueued" || item.status === "already-queued").length,
    workerCompletedCount: workerRuns.filter((item) => item.status === "completed").length,
    workerFailedCount: workerRuns.filter((item) => item.status === "failed").length,
    createdRuns: [...arrayOr(previous.createdRuns, []), ...createdRuns],
    skippedRuns,
    enqueuedRuns,
    workerRuns,
    boundaries: plan.boundaries,
  };
  writeFileSync(resolve(run.runDir, "fanout-result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  writeFileSync(resolve(run.runDir, "fanout-result.md"), formatLoopRoutineFanoutResult(result), "utf8");
  appendRoutineRunEvent(run, "loop_routine_fanout_executed", "Loop routine fanout executed.", {
    createdCount: createdRuns.length,
    skippedCount: skippedRuns.length,
    enqueuedCount: result.enqueuedCount,
    workerCompletedCount: result.workerCompletedCount,
    workerFailedCount: result.workerFailedCount,
    approval,
    result: routineRunPath(routineRunId, "fanout-result.json"),
  });
  updateLoopRoutineRunIndex({ routineRunId, root, updateReason: "fanout-execute" });
  return {
    routineRunId,
    resultPath: routineRunPath(routineRunId, "fanout-result.json"),
    markdownPath: routineRunPath(routineRunId, "fanout-result.md"),
    result,
  };
}

export function formatLoopRoutineFanoutPlan(plan) {
  return `# Loop Routine Fanout Plan

Routine run: ${plan.routineRunId}
Routine: ${plan.routineId}
Enabled: ${plan.enabled ? "yes" : "no"}
Mode: ${plan.mode}
Approval required: ${plan.approvalRequired ? "yes" : "no"}
Candidates: ${plan.candidateCount}
Skipped findings: ${plan.skippedCount}

## Candidates

${arrayOr(plan.candidates, []).map((candidate) => `- ${candidate.findingId}: ${candidate.title} -> ${candidate.childRunId} (${candidate.priority})`).join("\n") || "- None."}

## Boundaries

${list(plan.boundaries)}
`;
}

export function formatLoopRoutineSchedulePlan(plan) {
  return `# Loop Routine Schedule Plan

Planned: ${plan.plannedAt}
Routines: ${plan.routineCount}
Due: ${plan.dueCount}

## Routines

${plan.routines.map((routine) => `- ${routine.routineId ?? "(invalid)"}: ${routine.due ? "due" : "blocked"} (${routine.reason}) ${routine.sourcePath}`).join("\n") || "- None."}

## Boundaries

${list(plan.boundaries ?? [])}
`;
}

export function formatLoopRoutineScheduleRun(result) {
  return `# Loop Routine Schedule Run

Ran: ${result.ranAt}
Dry run: ${result.dryRun ? "yes" : "no"}
Due: ${result.dueCount}
Runs: ${result.runCount}

## Runs

${result.runs.map((run) => `- ${run.routineId}: ${run.status}${run.routineRunId ? ` (${run.routineRunId})` : ""}${run.error ? ` - ${run.error}` : ""}`).join("\n") || "- None."}

## Skipped

${result.skipped.map((run) => `- ${run.routineId ?? "(invalid)"}: ${run.reason}`).join("\n") || "- None."}
`;
}

export function formatLoopRoutineFanoutResult(result) {
  return `# Loop Routine Fanout Result

Routine run: ${result.routineRunId}
Routine: ${result.routineId}
Created: ${result.createdCount}
Skipped: ${result.skippedCount}
Enqueued: ${result.enqueuedCount ?? 0}
Worker completed: ${result.workerCompletedCount ?? 0}
Worker failed: ${result.workerFailedCount ?? 0}
Executed: ${result.executedAt}

## Created Runs

${arrayOr(result.createdRuns, []).map((run) => `- ${run.findingId}: ${run.loopRunId} (${run.runDir})`).join("\n") || "- None."}

## Skipped Runs

${arrayOr(result.skippedRuns, []).map((run) => `- ${run.findingId}: ${run.loopRunId} (${run.reason})`).join("\n") || "- None."}

## Enqueued Runs

${arrayOr(result.enqueuedRuns, []).map((run) => `- ${run.loopRunId}: ${run.status} (${run.state ?? "unknown"})`).join("\n") || "- None."}

## Worker Runs

${arrayOr(result.workerRuns, []).map((run) => `- ${run.loopRunId}: ${run.status}${run.childRunId ? ` child=${run.childRunId}` : ""}${run.error ? ` error=${run.error}` : ""}`).join("\n") || "- None."}

## Boundaries

${list(result.boundaries ?? [])}
`;
}

function enqueueFanoutRuns({ runs, priority, timeoutMs, root }) {
  const queuePriority = normalizeLoopQueuePriority(priority ?? "normal");
  return arrayOr(runs, []).map((run) => enqueueFanoutRun({ run, priority: queuePriority, timeoutMs, root }));
}

function enqueueFanoutRun({ run, priority, timeoutMs, root }) {
  const entry = findLoopRegistryEntry(run.loopRunId, root);
  if (!entry) return { findingId: run.findingId, loopRunId: run.loopRunId, status: "missing", state: null, error: "Loop run not found." };
  if (entry.state === "queued") return { findingId: run.findingId, loopRunId: run.loopRunId, status: "already-queued", state: entry.state, priority: entry.queuePriority };
  if (!LOOP_ENQUEUEABLE_STATES.includes(entry.state)) {
    return {
      findingId: run.findingId,
      loopRunId: run.loopRunId,
      status: "skipped",
      state: entry.state,
      error: `Cannot enqueue from state ${entry.state}.`,
    };
  }
  const timeoutAt = timeoutMs ? new Date(Date.now() + timeoutMs).toISOString() : null;
  appendLoopEvent(entry, "loop_enqueued", "queued", "Loop run enqueued by routine fanout.", {
    priority,
    timeoutAt,
    timeoutMs: timeoutMs ?? null,
    from: entry.state,
    routineFanout: true,
  });
  const queued = updateLoopRun(entry, {
    state: "queued",
    workerId: null,
    heartbeatAt: null,
    leaseExpiresAt: null,
    timeoutAt,
    queuePriority: priority,
    lastError: null,
  }, "Loop run enqueued by routine fanout.");
  return {
    findingId: run.findingId,
    loopRunId: run.loopRunId,
    status: "enqueued",
    state: queued.state,
    priority,
    timeoutAt,
  };
}

function runFanoutWorkers({ runs, workerId, approval, childProvider, childApply, isolateWorktree, baseRef, childSkipVerify, root }) {
  return arrayOr(runs, []).map((run, index) => runFanoutWorker({
    run,
    workerId: `${safePathSegment(workerId)}-${index + 1}`,
    approval,
    childProvider,
    childApply,
    isolateWorktree,
    baseRef,
    childSkipVerify,
    root,
  }));
}

function runFanoutWorker({ run, workerId, approval, childProvider, childApply, isolateWorktree, baseRef, childSkipVerify, root }) {
  const args = [
    cliPath,
    "loop-worker-once",
    "--run",
    run.loopRunId,
    "--worker",
    workerId,
    "--mode",
    "child-run",
    "--child-provider",
    childProvider,
    "--approval",
    approval,
    "--json",
  ];
  if (childApply) args.push("--child-apply");
  if (isolateWorktree) args.push("--isolate-worktree", "--base-ref", baseRef);
  if (childSkipVerify) args.push("--child-skip-verify");
  try {
    const output = execFileSync("node", args, {
      cwd: root,
      env: {
        ...process.env,
        MYAGENTTOOL_REPO_ROOT: root,
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const parsed = JSON.parse(output);
    return {
      findingId: run.findingId,
      loopRunId: run.loopRunId,
      status: parsed.result?.status ?? parsed.run?.state ?? "unknown",
      state: parsed.run?.state ?? null,
      workerId,
      workerResult: parsed.run?.evidence?.workerResult ?? null,
      childRunId: parsed.result?.childRunId ?? null,
      childState: parsed.result?.childState ?? null,
      isolatedWorktree: Boolean(parsed.result?.isolatedWorktree),
      worktreePath: parsed.result?.worktreePath ?? null,
      error: parsed.result?.error ?? null,
    };
  } catch (error) {
    return {
      findingId: run.findingId,
      loopRunId: run.loopRunId,
      status: "failed",
      state: findLoopRegistryEntry(run.loopRunId, root)?.state ?? null,
      workerId,
      workerResult: null,
      childRunId: null,
      childState: null,
      isolatedWorktree,
      worktreePath: null,
      error: childProcessErrorMessage(error),
    };
  }
}

function loadRoutineRun(routineRunId, root) {
  const id = safePathSegment(routineRunId);
  if (id !== routineRunId) fail(`Invalid routine run id: ${routineRunId}`);
  const runDir = resolve(root, ".myagenttool/routine-runs", routineRunId);
  if (!existsSync(runDir)) fail(`Loop routine run not found: ${routineRunId}`);
  const routine = existsSync(resolve(runDir, "routine.json")) ? readJsonFile(resolve(runDir, "routine.json")) : {};
  return {
    routineRunId,
    routineId: routine.metadata?.id ?? "routine",
    runDir,
  };
}

function formatFindingSource(source) {
  if (!isObject(source)) return "unknown";
  const parts = [
    source.type,
    source.runId,
    source.repo,
    source.issue ? `issue=${source.issue}` : null,
    source.pr ? `pr=${source.pr}` : null,
    source.check ? `check=${source.check}` : null,
  ].filter(Boolean);
  return parts.join(" ");
}

function fanoutCandidate({ routine, routineRunId, finding, index, skillSnapshot }) {
  const suggested = finding.suggestedRun ?? {};
  const findingId = stringOr(finding.id, `finding-${index + 1}`);
  const issue = fanoutIssue(finding, suggested);
  const childRunId = [
    new Date().toISOString().replace(/[:.]/g, "-"),
    "routine",
    safePathSegment(routine.metadata?.id ?? "routine").slice(0, 32),
    String(index + 1),
    safePathSegment(findingId).slice(0, 48),
    shortStableId(`${routineRunId}:${findingId}`),
  ].join("-");
  const priority = stringOr(suggested.priority, routine.goal?.fanout?.priority ?? "normal");
  return {
    findingId,
    title: stringOr(finding.title, findingId),
    severity: stringOr(finding.severity, "medium"),
    source: finding.source ?? null,
    evidence: arrayOr(finding.evidence, []),
    proposedAction: stringOr(finding.proposedAction, ""),
    skillBindings: arrayOr(finding.skillBindings, skillBindings(skillSnapshot)),
    suggestedRun: suggested,
    childRunId,
    issue,
    repo: finding.source?.repo ?? null,
    branch: `loop/fanout/${safePathSegment(findingId).slice(0, 48)}`,
    adapter: "mock",
    priority,
    apply: Boolean(suggested.apply ?? routine.goal?.fanout?.apply ?? false),
    verify: Boolean(suggested.verify ?? routine.goal?.fanout?.verify ?? true),
    openPr: false,
    isolateWorktree: Boolean(suggested.isolateWorktree ?? routine.goal?.fanout?.isolateWorktree ?? true),
  };
}

function createPlannedLoopRunFromFinding({ candidate, routineRunId, approval, root }) {
  const runDir = resolve(root, ".myagenttool/runs", candidate.childRunId);
  mkdirSync(runDir, { recursive: true });
  const createdAt = new Date().toISOString();
  let entry = createLoopRegistryEntry({
    runId: candidate.childRunId,
    issue: candidate.issue,
    repo: candidate.repo,
    branch: candidate.branch,
    adapter: { name: candidate.adapter },
    apply: candidate.apply,
    verify: candidate.verify,
    openPr: candidate.openPr,
    runDir,
    createdAt,
  });
  upsertLoopRegistryEntry(entry);
  appendLoopEvent(entry, "loop_run_created", "created", "Loop run registered from routine fanout.", {
    apply: candidate.apply,
    verify: candidate.verify,
    openPr: candidate.openPr,
    repo: candidate.repo,
    adapter: candidate.adapter,
    branch: candidate.branch,
    routineRunId,
    findingId: candidate.findingId,
  });
  entry = updateLoopRun(entry, { state: "planning" }, "Planning routine fanout child run.");

  const codePlan = fanoutCodePlan(candidate, routineRunId);
  writeFileSync(resolve(runDir, "code-plan.json"), `${JSON.stringify(codePlan, null, 2)}\n`, "utf8");
  entry = updateLoopEvidence(entry, { codePlan: loopRunPath(candidate.childRunId, "code-plan.json") });
  appendLoopEvent(entry, "loop_plan_written", "planning", "Routine fanout code plan written.", { path: entry.evidence.codePlan });

  const context = fanoutWorkContext({ candidate, routineRunId, codePlan, approval });
  writeFileSync(resolve(runDir, "context.json"), `${JSON.stringify(context, null, 2)}\n`, "utf8");

  const testingPlan = fanoutTestingPlan(candidate);
  writeFileSync(resolve(runDir, "testing-plan.json"), `${JSON.stringify(testingPlan, null, 2)}\n`, "utf8");
  writeFileSync(resolve(runDir, "testing-plan.md"), formatFanoutTestingPlan(testingPlan), "utf8");
  entry = updateLoopEvidence(entry, {
    testingPlan: loopRunPath(candidate.childRunId, "testing-plan.md"),
    testingPlanJson: loopRunPath(candidate.childRunId, "testing-plan.json"),
  });
  appendLoopEvent(entry, "loop_testing_plan_written", "planning", "Routine fanout testing plan written.", {
    changes: testingPlan.changes,
    risk: testingPlan.risk,
  });

  writeFileSync(resolve(runDir, "manifest.md"), formatFanoutManifest({ candidate, routineRunId, codePlan, testingPlan }), "utf8");
  entry = updateLoopEvidence(entry, { manifest: loopRunPath(candidate.childRunId, "manifest.md") });
  appendLoopEvent(entry, "loop_manifest_written", "planning", "Routine fanout manifest written.", { path: entry.evidence.manifest });
  entry = updateLoopRun(entry, { state: "planned", lastError: null }, "Loop run planned from routine fanout.");

  return {
    findingId: candidate.findingId,
    loopRunId: candidate.childRunId,
    runDir: loopRunPath(candidate.childRunId, "").replace(/\/$/, ""),
    state: entry.state,
    issue: candidate.issue,
    branch: candidate.branch,
    priority: candidate.priority,
  };
}

function fanoutIssue(finding, suggested) {
  const value = suggested.issue
    ?? finding.source?.issue
    ?? finding.source?.pr
    ?? finding.source?.check
    ?? finding.source?.runId
    ?? "routine";
  return String(value || "routine");
}

function fanoutCodePlan(candidate, routineRunId) {
  return {
    branch: candidate.branch,
    summary: candidate.title,
    productFlow: {
      roleFlow: "Engineering operator reviews a routine finding.",
      scenario: `Routine fanout follow-up for ${candidate.findingId}.`,
      frequency: "As needed after routine triage.",
      ownerSurface: "Loop Engine CLI and registry evidence.",
      usabilityTask: "Inspect the child run manifest and decide whether to enqueue or handle manually.",
      whatNotToShow: "No automatic remote writes or GitHub mutations.",
      partialAcceptanceOrFollowUp: "Child run is planned only; execution is a later operator decision.",
    },
    affectedSurfaces: ["Loop Engine routine fanout"],
    prototypeStates: ["planned child run evidence"],
    acceptanceSignals: [
      "Child run is visible in the loop registry.",
      "Child run records the source routine run and finding id.",
      "No enqueue, apply, push, PR create, or PR merge action is performed.",
      ...fanoutSkillAcceptance(candidate),
    ],
    whatNotToShow: ["Do not apply changes automatically.", "Do not mutate GitHub or remotes."],
    visualQaTasks: [],
    filesToTouch: [],
    steps: [
      candidate.proposedAction || "Review the finding and choose a follow-up action.",
      "Inspect source evidence before enqueueing or executing any work.",
    ],
    commands: ["pnpm ai:loop-registry-check"],
    risks: [`Finding severity: ${candidate.severity}`, `Routine run: ${routineRunId}`, ...fanoutSkillChecks(candidate).map((check) => `Skill check: ${check}`)],
    followUpIssues: [],
    prSummary: "Routine fanout created a planned child run only.",
  };
}

function fanoutWorkContext({ candidate, routineRunId, codePlan, approval }) {
  return {
    issue: candidate.issue,
    repo: candidate.repo,
    branch: candidate.branch,
    runId: candidate.childRunId,
    adapter: { name: candidate.adapter, kind: "internal" },
    plan: codePlan,
    routineFanout: {
      routineRunId,
      findingId: candidate.findingId,
      source: candidate.source,
      evidence: candidate.evidence,
      skillBindings: candidate.skillBindings,
      suggestedRun: candidate.suggestedRun,
      approval,
      isolateWorktree: candidate.isolateWorktree,
    },
  };
}

function fanoutTestingPlan(candidate) {
  const skillChecks = fanoutSkillChecks(candidate);
  return {
    change: "docs",
    changes: ["docs"],
    risk: candidate.severity === "high" ? "high" : "medium",
    requiredEvidence: [
      "Registry can be rebuilt from child run events.",
      "Operator approval is recorded in routine fanout result.",
      ...fanoutSkillAcceptance(candidate),
    ],
    commands: ["pnpm ai:loop-registry-check"],
    manualEvidence: ["Review finding evidence before enqueue or execution.", ...skillChecks],
    skillGuidance: fanoutSkillGuidance(candidate),
  };
}

function formatFanoutTestingPlan(plan) {
  return `# Testing Plan

Change: ${plan.change}
Risk: ${plan.risk}

## Required Evidence

${list(plan.requiredEvidence)}

## Commands

${list(plan.commands)}

## Manual Evidence

${list(plan.manualEvidence)}
`;
}

function formatFanoutManifest({ candidate, routineRunId, codePlan, testingPlan }) {
  return `# Loop Run Manifest

Run: ${candidate.childRunId}
Source routine run: ${routineRunId}
Finding: ${candidate.findingId}
Issue: ${candidate.issue}
Branch: ${candidate.branch}
Adapter: ${candidate.adapter}
Apply: ${candidate.apply ? "yes" : "no"}
Verify: ${candidate.verify ? "yes" : "no"}
Open PR: ${candidate.openPr ? "yes" : "no"}

## Summary

${codePlan.summary}

## Evidence

${list(candidate.evidence)}

## Skill Bindings

${formatFanoutSkillBindings(candidate)}

## Steps

${list(codePlan.steps)}

## Verification

${list(testingPlan.commands)}
`;
}

function fanoutSkillAcceptance(candidate) {
  return uniqueStrings(arrayOr(candidate.skillBindings, []).flatMap((skill) => arrayOr(skill.acceptance, []).map((item) => `${skill.id}: ${item}`)));
}

function fanoutSkillChecks(candidate) {
  return uniqueStrings(arrayOr(candidate.skillBindings, []).flatMap((skill) => arrayOr(skill.checks, []).map((item) => `${skill.id}: ${item}`)));
}

function fanoutSkillGuidance(candidate) {
  const guidance = arrayOr(candidate.skillBindings, []).map((skill) => `${skill.id}: ${skill.title} (${skill.path}, sha256 ${String(skill.sha256 ?? "").slice(0, 12)})`);
  return guidance.length > 0 ? guidance : ["Routine fanout is planning-only unless explicit worker options are passed."];
}

function formatFanoutSkillBindings(candidate) {
  const bindings = arrayOr(candidate.skillBindings, []);
  if (bindings.length === 0) return "- None.";
  return bindings.map((skill) => [
    `- ${skill.id}: ${skill.title} (${skill.path}, sha256 ${String(skill.sha256 ?? "").slice(0, 12)})`,
    ...arrayOr(skill.acceptance, []).map((item) => `  - Acceptance: ${item}`),
    ...arrayOr(skill.checks, []).map((item) => `  - Check: ${item}`),
  ].join("\n")).join("\n");
}

function appendRoutineRunEvent(run, type, message, data = {}) {
  const event = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
    routineRunId: run.routineRunId,
    routineId: run.routineId,
    type,
    createdAt: new Date().toISOString(),
    message,
    data,
  };
  writeFileSync(resolve(run.runDir, "events.jsonl"), `${JSON.stringify(event)}\n`, { encoding: "utf8", flag: "a" });
}

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`Failed to read JSON ${path}: ${error.message}`);
  }
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

function childProcessErrorMessage(error) {
  const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
  const stdout = typeof error?.stdout === "string" ? error.stdout.trim() : "";
  return [error?.message ?? String(error), stdout, stderr].filter(Boolean).join("\n");
}

function executeRoutineChecks(routine, root) {
  const checks = routine.checks.map((check) => {
    const startedAt = new Date().toISOString();
    const command = resolveRoutineCheckCommand(check);
    const required = booleanOr(check.required, true);
    if (!command) {
      return {
        id: check.id,
        type: check.type,
        command: check.command ?? null,
        required,
        status: required ? "failed" : "skipped",
        exitCode: null,
        startedAt,
        completedAt: new Date().toISOString(),
        stdout: "",
        stderr: "",
        error: `Unsupported routine check type: ${check.type}`,
      };
    }
    const result = spawnSync(command.bin, command.args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    const exitCode = result.status ?? (result.error ? 1 : 0);
    return {
      id: check.id,
      type: check.type,
      command: command.id,
      required,
      status: exitCode === 0 ? "passed" : "failed",
      exitCode,
      startedAt,
      completedAt: new Date().toISOString(),
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      error: result.error?.message ?? null,
    };
  });
  return {
    completedAt: new Date().toISOString(),
    ok: checks.every((check) => check.status !== "failed" || !check.required),
    checks,
  };
}

function resolveRoutineCheckCommand(check) {
  const id = check.type === "command" ? check.command : check.type;
  const commands = {
    "ai:loop-registry-check": ["node", [cliPath, "loop-registry-check"]],
    "loop-registry": ["node", [cliPath, "loop-registry-check"]],
    "docs-check": ["pnpm", ["docs:check"]],
    "docs:check": ["pnpm", ["docs:check"]],
    typecheck: ["pnpm", ["typecheck"]],
    test: ["pnpm", ["test"]],
    "ai:check": ["node", [cliPath, "--check"]],
  };
  const command = commands[id];
  if (!command) return null;
  return {
    id,
    bin: command[0],
    args: command[1],
  };
}

function generateRoutineFindings({ routine, inputSnapshot, checksResult, skillSnapshot }) {
  if (routine.metadata.id !== "morning-triage") {
    return bindSkillsToFindings(genericRoutineFindings({ inputSnapshot, checksResult }), skillSnapshot);
  }
  return bindSkillsToFindings(morningTriageFindings({ inputSnapshot, checksResult }), skillSnapshot);
}

function bindSkillsToFindings(findings, skillSnapshot) {
  const bindings = skillBindings(skillSnapshot);
  if (bindings.length === 0) return findings;
  return findings.map((finding) => ({
    ...finding,
    skillBindings: bindings,
    evidence: [
      ...arrayOr(finding.evidence, []),
      ...bindings.map((skill) => `Skill: ${skill.id} ${skill.title} (${skill.sha256.slice(0, 12)})`),
    ],
  }));
}

function skillBindings(skillSnapshot) {
  return arrayOr(skillSnapshot?.skills, [])
    .filter((skill) => skill.status === "found")
    .map((skill) => ({
      id: skill.id,
      path: skill.path,
      title: skill.title,
      summary: skill.summary,
      sha256: skill.sha256,
      acceptance: arrayOr(skill.acceptance, []),
      checks: arrayOr(skill.checks, []),
    }));
}

function genericRoutineFindings({ inputSnapshot, checksResult }) {
  return [
    ...inputFailureFindings(inputSnapshot),
    ...checkFailureFindings(checksResult),
  ];
}

function morningTriageFindings({ inputSnapshot, checksResult }) {
  const findings = [
    ...inputFailureFindings(inputSnapshot),
    ...checkFailureFindings(checksResult),
  ];
  const registryInputs = inputSnapshot.inputs.filter((input) => input.type === "loop.registry" && input.status === "ok");
  for (const input of registryInputs) {
    for (const run of input.items) {
      if (!["failed", "timed_out", "awaiting_human"].includes(run.state)) continue;
      findings.push(loopRunFinding(input, run));
    }
  }
  for (const input of inputSnapshot.inputs.filter((item) => item.type === "github.issues" && item.status === "ok")) {
    for (const issue of input.items) {
      findings.push(...githubIssueFindings(input, issue));
    }
  }
  for (const input of inputSnapshot.inputs.filter((item) => item.type === "github.prs" && item.status === "ok")) {
    for (const pr of input.items) {
      findings.push(...githubPullRequestFindings(input, pr));
    }
  }
  for (const input of inputSnapshot.inputs.filter((item) => item.type === "github.checks" && item.status === "ok")) {
    for (const check of input.items) {
      const finding = githubCheckFinding(input, check);
      if (finding) findings.push(finding);
    }
  }
  return findings;
}

function inputFailureFindings(inputSnapshot) {
  const findings = [];
  for (const input of inputSnapshot.inputs) {
    if (!["failed", "unsupported"].includes(input.status)) continue;
    findings.push(createRoutineFinding({
      id: `input-${safePathSegment(input.id)}-${input.status}`,
      title: `Routine input ${input.id} is ${input.status}`,
      severity: input.status === "failed" ? "high" : "low",
      source: {
        type: "routine.input",
        inputId: input.id,
        inputType: input.type,
      },
      evidence: [
        `Input: ${input.id}`,
        `Type: ${input.type}`,
        `Status: ${input.status}`,
        `Reason: ${input.reason ?? "not recorded"}`,
      ],
      proposedAction: input.status === "failed"
        ? "Fix the input collector or routine input configuration before relying on this routine."
        : "Implement this input collector in a future slice or remove it from this routine.",
      suggestedRun: null,
    }));
  }
  return findings;
}

function checkFailureFindings(checksResult) {
  return checksResult.checks
    .filter((check) => check.status === "failed")
    .map((check) => createRoutineFinding({
      id: `check-${safePathSegment(check.id)}-failed`,
      title: `Routine check failed: ${check.id}`,
      severity: check.required ? "high" : "medium",
      source: {
        type: "routine.check",
        checkId: check.id,
        checkType: check.type,
      },
      evidence: [
        `Check: ${check.id}`,
        `Command: ${check.command ?? "not resolved"}`,
        `Exit code: ${check.exitCode ?? "not recorded"}`,
        `Error: ${check.error ?? "none"}`,
      ],
      proposedAction: "Inspect checks-result.json, fix the failing check, then rerun the routine.",
      suggestedRun: null,
    }));
}

function loopRunFinding(input, run) {
  const severity = run.state === "awaiting_human" ? "medium" : "high";
  const titleByState = {
    failed: `Loop run failed: ${run.runId}`,
    timed_out: `Loop run timed out: ${run.runId}`,
    awaiting_human: `Loop run is awaiting human review: ${run.runId}`,
  };
  const actionByState = {
    failed: "Inspect the last error, then run loop-resume or loop-retry with an explicit operator decision.",
    timed_out: "Inspect the worker lease history, then re-enqueue or retry the run if the work is still relevant.",
    awaiting_human: "Review the active human gate and approve, reject, cancel, or retry the run.",
  };
  const modeByState = {
    failed: "retry",
    timed_out: "retry",
    awaiting_human: "human-gate-review",
  };
  return createRoutineFinding({
    id: `loop-run-${run.state}-${safePathSegment(run.runId)}`,
    title: titleByState[run.state],
    severity,
    source: {
      type: "loop.registry",
      inputId: input.id,
      runId: run.runId,
      state: run.state,
    },
    evidence: [
      `Run: ${run.runId}`,
      `State: ${run.state}`,
      `Issue: ${run.issue ?? "not recorded"}`,
      `Branch: ${run.branch || "not recorded"}`,
      `Updated: ${run.updatedAt ?? "not recorded"}`,
      `Last error: ${run.lastError ?? "none"}`,
    ],
    proposedAction: actionByState[run.state],
    suggestedRun: {
      mode: modeByState[run.state],
      runId: run.runId,
      issue: run.issue ?? null,
      priority: severity === "high" ? "high" : "normal",
      apply: false,
      verify: true,
      isolateWorktree: true,
    },
  });
}

function githubIssueFindings(input, issue) {
  const findings = [];
  if (!issue.assignees || issue.assignees.length === 0) {
    findings.push(createRoutineFinding({
      id: `github-issue-${issue.number}-missing-assignee`,
      title: `GitHub issue has no assignee: #${issue.number} ${issue.title}`,
      severity: "medium",
      source: {
        type: "github.issues",
        inputId: input.id,
        repo: input.repo ?? null,
        issue: issue.number,
      },
      evidence: githubIssueEvidence(issue),
      proposedAction: "Assign an owner or close the issue if it is no longer actionable.",
      suggestedRun: {
        mode: "issue-triage",
        issue: String(issue.number ?? ""),
        priority: "normal",
        apply: false,
        verify: true,
        isolateWorktree: true,
      },
    }));
  }
  if (!issue.labels || issue.labels.length === 0) {
    findings.push(createRoutineFinding({
      id: `github-issue-${issue.number}-missing-label`,
      title: `GitHub issue has no labels: #${issue.number} ${issue.title}`,
      severity: "low",
      source: {
        type: "github.issues",
        inputId: input.id,
        repo: input.repo ?? null,
        issue: issue.number,
      },
      evidence: githubIssueEvidence(issue),
      proposedAction: "Add area/type/priority labels so routine triage can route the issue.",
      suggestedRun: null,
    }));
  }
  return findings;
}

function githubPullRequestFindings(input, pr) {
  const findings = [];
  if (pr.isDraft) {
    findings.push(createRoutineFinding({
      id: `github-pr-${pr.number}-draft`,
      title: `GitHub PR is still draft: #${pr.number} ${pr.title}`,
      severity: "low",
      source: {
        type: "github.prs",
        inputId: input.id,
        repo: input.repo ?? null,
        pr: pr.number,
      },
      evidence: githubPullRequestEvidence(pr),
      proposedAction: "Confirm whether the PR is intentionally draft or needs owner follow-up.",
      suggestedRun: null,
    }));
  }
  if (!pr.reviewDecision || pr.reviewDecision === "REVIEW_REQUIRED") {
    findings.push(createRoutineFinding({
      id: `github-pr-${pr.number}-review-required`,
      title: `GitHub PR needs review: #${pr.number} ${pr.title}`,
      severity: "medium",
      source: {
        type: "github.prs",
        inputId: input.id,
        repo: input.repo ?? null,
        pr: pr.number,
      },
      evidence: githubPullRequestEvidence(pr),
      proposedAction: "Request or complete review before promotion continues.",
      suggestedRun: {
        mode: "pr-review-follow-up",
        issue: null,
        priority: "normal",
        apply: false,
        verify: true,
        isolateWorktree: true,
      },
    }));
  }
  return findings;
}

function githubCheckFinding(input, check) {
  const conclusion = String(check.conclusion ?? "").toLowerCase();
  const status = String(check.status ?? check.state ?? "").toLowerCase();
  const failed = ["failure", "failed", "cancelled", "timed_out", "action_required"].includes(conclusion) || ["failure", "failed"].includes(status);
  const pending = ["queued", "pending", "in_progress", "requested", "waiting"].includes(status) || (!conclusion && status && status !== "completed" && status !== "success");
  if (!failed && !pending) return null;
  return createRoutineFinding({
    id: `github-check-${safePathSegment(check.name || check.id || "check")}-${failed ? "failed" : "pending"}`,
    title: `GitHub check ${failed ? "failed" : "is pending"}: ${check.name || check.id}`,
    severity: failed ? "high" : "medium",
    source: {
      type: "github.checks",
      inputId: input.id,
      repo: input.repo ?? null,
      check: check.id,
    },
    evidence: [
      `Check: ${check.name || check.id}`,
      `Status: ${check.status || check.state || "not recorded"}`,
      `Conclusion: ${check.conclusion ?? "not recorded"}`,
      `Branch: ${check.headBranch ?? "not recorded"}`,
      `SHA: ${check.headSha ?? "not recorded"}`,
      `URL: ${check.url ?? "not recorded"}`,
    ],
    proposedAction: failed
      ? "Inspect the failing GitHub check and create a focused follow-up run if code changes are needed."
      : "Wait for the check or inspect why it is stuck before continuing promotion.",
    suggestedRun: failed
      ? {
          mode: "fix-failing-check",
          issue: null,
          priority: "high",
          apply: false,
          verify: true,
          isolateWorktree: true,
        }
      : null,
  });
}

function githubIssueEvidence(issue) {
  return [
    `Issue: #${issue.number} ${issue.title}`,
    `State: ${issue.state || "not recorded"}`,
    `Labels: ${(issue.labels ?? []).join(", ") || "none"}`,
    `Assignees: ${(issue.assignees ?? []).join(", ") || "none"}`,
    `Milestone: ${issue.milestone ?? "none"}`,
    `Updated: ${issue.updatedAt ?? "not recorded"}`,
    `URL: ${issue.url ?? "not recorded"}`,
  ];
}

function githubPullRequestEvidence(pr) {
  return [
    `PR: #${pr.number} ${pr.title}`,
    `State: ${pr.state || "not recorded"}`,
    `Draft: ${pr.isDraft ? "yes" : "no"}`,
    `Review decision: ${pr.reviewDecision ?? "not recorded"}`,
    `Head: ${pr.headRefName || "not recorded"}`,
    `Base: ${pr.baseRefName || "not recorded"}`,
    `Updated: ${pr.updatedAt ?? "not recorded"}`,
    `URL: ${pr.url ?? "not recorded"}`,
  ];
}

function createRoutineFinding({ id, title, severity, source, evidence, proposedAction, suggestedRun }) {
  return {
    id,
    title,
    severity,
    source,
    evidence,
    proposedAction,
    suggestedRun,
    createdAt: new Date().toISOString(),
  };
}

function collectRoutineInputs(routine, root) {
  const inputs = routine.inputs.map((input) => {
    if (!LOOP_ROUTINE_SUPPORTED_RUN_INPUTS.includes(input.type)) {
      return {
        id: input.id,
        type: input.type,
        status: "unsupported",
        reason: "This input type is planned but not collected by the local routine runner yet.",
        items: [],
      };
    }
    try {
      if (input.type === "loop.registry") return collectLoopRegistryInput(input, root);
      if (input.type === "git.commits") return collectGitCommitsInput(input, root);
      if (input.type === "filesystem.glob") return collectFilesystemGlobInput(input, root);
      if (input.type === "github.issues") return collectGithubIssuesInput(input, root);
      if (input.type === "github.prs") return collectGithubPullRequestsInput(input, root);
      if (input.type === "github.checks") return collectGithubChecksInput(input, root);
      if (input.type === "github.commits") return collectGithubCommitsInput(input, root);
    } catch (error) {
      return {
        id: input.id,
        type: input.type,
        status: "failed",
        reason: error?.message ?? String(error),
        items: [],
      };
    }
    return {
      id: input.id,
      type: input.type,
      status: "unsupported",
      reason: "Input collector missing.",
      items: [],
    };
  });
  return {
    collectedAt: new Date().toISOString(),
    inputs,
  };
}

function collectRoutineSkills(routine, root) {
  const skills = routine.skills.map((skill) => collectRoutineSkill(skill, root));
  return {
    collectedAt: new Date().toISOString(),
    skills,
    foundCount: skills.filter((skill) => skill.status === "found").length,
    missingRequired: skills.filter((skill) => skill.required && skill.status !== "found").map((skill) => skill.id),
  };
}

function collectRoutineSkill(skill, root) {
  const target = resolveRoutineSkillPath(skill, root);
  const base = {
    id: skill.id,
    path: skill.path,
    required: Boolean(skill.required),
  };
  if (!skill.path || !target) {
    return {
      ...base,
      status: "missing",
      sha256: null,
      title: skill.id,
      summary: "",
      acceptance: [],
      checks: [],
      contentPreview: "",
    };
  }
  const content = readFileSync(target, "utf8");
  const parsed = parseSkillMarkdown(content, skill.id);
  return {
    ...base,
    status: "found",
    sha256: createHash("sha256").update(content).digest("hex"),
    ...parsed,
    contentPreview: truncateSkillContent(content),
  };
}

function resolveRoutineSkillPath(skill, root) {
  if (!skill.path) return null;
  const primary = resolve(root, skill.path);
  if (existsSync(primary)) return primary;
  if (skill.sourcePath) {
    const source = resolve(skill.sourcePath);
    if (existsSync(source)) return source;
  }
  return null;
}

function parseSkillMarkdown(content, fallbackTitle) {
  const title = content.match(/^\s*#\s+(.+?)\s*$/m)?.[1]?.trim() ?? fallbackTitle;
  const summary = firstNonHeadingParagraph(content);
  return {
    title,
    summary,
    acceptance: markdownBulletsForHeadings(content, ["Acceptance", "Acceptance Criteria", "验收", "验收标准"]),
    checks: markdownBulletsForHeadings(content, ["Checks", "Validation", "验证", "检查"]),
  };
}

function firstNonHeadingParagraph(content) {
  const lines = content.split(/\r?\n/);
  const paragraph = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("- ") || line.startsWith("* ")) {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(line);
  }
  return paragraph.join(" ").slice(0, 500);
}

function markdownBulletsForHeadings(content, headings) {
  const headingPattern = headings.map(escapeRegExp).join("|");
  const regex = new RegExp(`^#{2,4}\\s+(?:${headingPattern})\\s*\\r?\\n([\\s\\S]*?)(?=^#{1,4}\\s+|(?![\\s\\S]))`, "gim");
  const bullets = [];
  for (const match of content.matchAll(regex)) {
    for (const line of match[1].split(/\r?\n/)) {
      const bullet = line.match(/^\s*[-*]\s+\[?[ xX]?\]?\s*(.+?)\s*$/)?.[1]?.trim();
      if (bullet) bullets.push(bullet);
    }
  }
  return uniqueStrings(bullets).slice(0, 20);
}

function truncateSkillContent(content) {
  return content.length > 2000 ? `${content.slice(0, 2000)}\n\n[truncated ${content.length - 2000} chars]` : content;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectLoopRegistryInput(input, root) {
  const path = resolve(root, ".myagenttool/runs/registry.json");
  if (!existsSync(path)) {
    return { id: input.id, type: input.type, status: "ok", items: [], summary: "No loop registry exists yet." };
  }
  const registry = JSON.parse(readFileSync(path, "utf8"));
  const limit = positiveIntegerOr(input.limit, 20);
  const states = stringArrayOr(input.states, []);
  const runs = arrayOr(registry.runs, [])
    .filter((run) => states.length === 0 || states.includes(run.state))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, limit)
    .map((run) => ({
      runId: run.runId,
      state: run.state,
      issue: run.issue,
      branch: run.branch,
      updatedAt: run.updatedAt,
      lastError: run.lastError,
    }));
  return { id: input.id, type: input.type, status: "ok", items: runs, summary: `${runs.length} loop run(s) collected.` };
}

function collectGitCommitsInput(input, root) {
  const limit = positiveIntegerOr(input.limit, 20);
  const ref = stringOr(input.ref, "HEAD");
  const args = ["log", ref, `--max-count=${limit}`, "--pretty=format:%H%x09%h%x09%cI%x09%s"];
  if (input.since) args.splice(2, 0, `--since=${input.since}`);
  const output = execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const commits = output
    ? output.split(/\r?\n/).map((line) => {
        const [sha, shortSha, committedAt, subject] = line.split("\t");
        return { sha, shortSha, committedAt, subject };
      })
    : [];
  return { id: input.id, type: input.type, status: "ok", items: commits, summary: `${commits.length} commit(s) collected.` };
}

function collectFilesystemGlobInput(input, root) {
  const pattern = normalizePath(input.pattern);
  const limit = positiveIntegerOr(input.limit, 100);
  const tracked = execFileSync("git", ["ls-files"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const matcher = globMatcher(pattern);
  const files = tracked.filter((file) => matcher(normalizePath(file))).slice(0, limit);
  return { id: input.id, type: input.type, status: "ok", items: files.map((path) => ({ path })), summary: `${files.length} file(s) matched ${pattern}.` };
}

function collectGithubIssuesInput(input, root) {
  const repo = requireGithubRepo(input);
  const limit = positiveIntegerOr(input.limit, 20);
  const args = [
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    stringOr(input.state, "open"),
    "--limit",
    String(limit),
    "--json",
    "number,title,state,labels,assignees,milestone,updatedAt,url",
  ];
  if (input.search) args.push("--search", String(input.search));
  const issues = ghJson(args, root);
  return {
    id: input.id,
    type: input.type,
    status: "ok",
    items: arrayOr(issues, []).map(normalizeGithubIssue),
    summary: `${arrayOr(issues, []).length} GitHub issue(s) collected from ${repo}.`,
  };
}

function collectGithubPullRequestsInput(input, root) {
  const repo = requireGithubRepo(input);
  const limit = positiveIntegerOr(input.limit, 20);
  const args = [
    "pr",
    "list",
    "--repo",
    repo,
    "--state",
    stringOr(input.state, "open"),
    "--limit",
    String(limit),
    "--json",
    "number,title,state,isDraft,headRefName,baseRefName,reviewDecision,updatedAt,url",
  ];
  if (input.search) args.push("--search", String(input.search));
  const prs = ghJson(args, root);
  return {
    id: input.id,
    type: input.type,
    status: "ok",
    items: arrayOr(prs, []).map(normalizeGithubPullRequest),
    summary: `${arrayOr(prs, []).length} GitHub pull request(s) collected from ${repo}.`,
  };
}

function collectGithubChecksInput(input, root) {
  const repo = requireGithubRepo(input);
  const pr = input.pr ?? input.prNumber;
  let checks = [];
  if (pr !== undefined && pr !== null && String(pr).trim()) {
    checks = ghJson(["pr", "checks", String(pr), "--repo", repo, "--json", "name,state,conclusion,startedAt,completedAt,link"], root);
  } else {
    const branch = stringOr(input.branch ?? input.ref, "");
    const args = ["run", "list", "--repo", repo, "--limit", String(positiveIntegerOr(input.limit, 20)), "--json", "databaseId,displayTitle,headBranch,headSha,status,conclusion,createdAt,updatedAt,url"];
    if (branch) args.push("--branch", branch);
    checks = ghJson(args, root);
  }
  return {
    id: input.id,
    type: input.type,
    status: "ok",
    items: arrayOr(checks, []).map(normalizeGithubCheck),
    summary: `${arrayOr(checks, []).length} GitHub check/run item(s) collected from ${repo}.`,
  };
}

function collectGithubCommitsInput(input, root) {
  const repo = requireGithubRepo(input);
  const limit = positiveIntegerOr(input.limit, 20);
  const path = `repos/${repo}/commits`;
  const query = [];
  if (input.sha) query.push(`sha=${encodeURIComponent(String(input.sha))}`);
  if (input.since) query.push(`since=${encodeURIComponent(String(input.since))}`);
  if (input.until) query.push(`until=${encodeURIComponent(String(input.until))}`);
  query.push(`per_page=${limit}`);
  const commits = ghJson(["api", `${path}?${query.join("&")}`], root);
  return {
    id: input.id,
    type: input.type,
    status: "ok",
    items: arrayOr(commits, []).map(normalizeGithubCommit),
    summary: `${arrayOr(commits, []).length} GitHub commit(s) collected from ${repo}.`,
  };
}

function normalizeGithubIssue(issue) {
  return {
    number: issue.number ?? null,
    title: issue.title ?? "",
    state: issue.state ?? "",
    labels: arrayOr(issue.labels, []).map((label) => label.name ?? label).filter(Boolean),
    assignees: arrayOr(issue.assignees, []).map((assignee) => assignee.login ?? assignee.name ?? assignee).filter(Boolean),
    milestone: issue.milestone?.title ?? issue.milestone ?? null,
    updatedAt: issue.updatedAt ?? null,
    url: issue.url ?? null,
  };
}

function normalizeGithubPullRequest(pr) {
  return {
    number: pr.number ?? null,
    title: pr.title ?? "",
    state: pr.state ?? "",
    isDraft: Boolean(pr.isDraft),
    headRefName: pr.headRefName ?? "",
    baseRefName: pr.baseRefName ?? "",
    reviewDecision: pr.reviewDecision ?? null,
    updatedAt: pr.updatedAt ?? null,
    url: pr.url ?? null,
  };
}

function normalizeGithubCheck(check) {
  return {
    id: check.databaseId ?? check.name ?? check.displayTitle ?? null,
    name: check.name ?? check.displayTitle ?? "",
    state: check.state ?? check.status ?? "",
    status: check.status ?? check.state ?? "",
    conclusion: check.conclusion ?? null,
    headBranch: check.headBranch ?? null,
    headSha: check.headSha ?? null,
    startedAt: check.startedAt ?? check.createdAt ?? null,
    completedAt: check.completedAt ?? check.updatedAt ?? null,
    url: check.link ?? check.url ?? null,
  };
}

function normalizeGithubCommit(commit) {
  return {
    sha: commit.sha ?? "",
    shortSha: commit.sha ? String(commit.sha).slice(0, 7) : "",
    message: commit.commit?.message ?? "",
    committedAt: commit.commit?.committer?.date ?? commit.commit?.author?.date ?? null,
    author: commit.commit?.author?.name ?? commit.author?.login ?? null,
    url: commit.html_url ?? commit.url ?? null,
  };
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

function inputSummary(input) {
  if (input.type === "github.issues") return `${input.repo} ${input.query ?? ""}`.trim();
  if (input.type === "github.prs") return `${input.repo} ${input.query ?? ""}`.trim();
  if (input.type === "github.checks") return `${input.repo} ${input.ref ?? ""}`.trim();
  if (input.type === "github.commits") return `${input.repo} ${input.sha ?? input.since ?? ""}`.trim();
  if (input.type === "git.commits") return `${input.ref ?? "HEAD"} since ${input.since ?? "not specified"}`;
  if (input.type === "filesystem.glob") return input.pattern ?? "";
  if (input.type === "loop.registry") return `states ${(input.states ?? []).join(", ") || "any"}`;
  return "";
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

function parseSimpleYaml(source) {
  const lines = source
    .split(/\r?\n/)
    .map((raw) => raw.replace(/\t/g, "  "))
    .map((raw) => ({ indent: raw.match(/^ */)[0].length, text: raw.trim() }))
    .filter((line) => line.text && !line.text.startsWith("#"));
  if (lines.length === 0) return {};
  const [value, index] = parseYamlBlock(lines, 0, lines[0].indent);
  if (index < lines.length) fail(`Invalid YAML near: ${lines[index].text}`);
  return value;
}

function parseYamlBlock(lines, index, indent) {
  const line = lines[index];
  if (!line || line.indent < indent) return [null, index];
  if (line.text.startsWith("- ")) return parseYamlArray(lines, index, indent);
  return parseYamlObject(lines, index, indent);
}

function parseYamlArray(lines, index, indent) {
  const items = [];
  let cursor = index;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.indent < indent) break;
    if (line.indent !== indent || !line.text.startsWith("- ")) break;
    const rest = line.text.slice(2).trim();
    cursor += 1;
    if (!rest) {
      const [value, next] = parseYamlBlock(lines, cursor, lines[cursor]?.indent ?? indent + 2);
      items.push(value);
      cursor = next;
      continue;
    }
    if (isYamlKeyValue(rest)) {
      const item = {};
      cursor = assignYamlKeyValue(item, rest, lines, cursor);
      while (cursor < lines.length && lines[cursor].indent === indent + 2 && !lines[cursor].text.startsWith("- ")) {
        const propertyLine = lines[cursor];
        cursor += 1;
        cursor = assignYamlKeyValue(item, propertyLine.text, lines, cursor);
      }
      items.push(item);
    } else {
      items.push(parseYamlScalar(rest));
    }
  }
  return [items, cursor];
}

function parseYamlObject(lines, index, indent) {
  const object = {};
  let cursor = index;
  while (cursor < lines.length) {
    const line = lines[cursor];
    if (line.indent < indent) break;
    if (line.indent !== indent || line.text.startsWith("- ")) break;
    cursor += 1;
    cursor = assignYamlKeyValue(object, line.text, lines, cursor);
  }
  return [object, cursor];
}

function assignYamlKeyValue(object, text, lines, cursor) {
  const match = text.match(/^([^:]+):(.*)$/);
  if (!match) fail(`Invalid YAML key/value line: ${text}`);
  const key = match[1].trim();
  const rawValue = match[2].trim();
  if (rawValue) {
    object[key] = parseYamlScalar(rawValue);
    return cursor;
  }
  if (cursor < lines.length && lines[cursor].indent > 0) {
    const [value, next] = parseYamlBlock(lines, cursor, lines[cursor].indent);
    object[key] = value;
    return next;
  }
  object[key] = null;
  return cursor;
}

function isYamlKeyValue(text) {
  return /^[^:]+:/.test(text);
}

function parseYamlScalar(raw) {
  const value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  if (/^\[[\s\S]*\]$/.test(value)) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((item) => parseYamlScalar(item.trim()));
  }
  if (/^-?\d+$/.test(value)) return Number(value);
  return value;
}

function globMatcher(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "__DOUBLE_STAR__")
    .replace(/\*/g, "[^/]*")
    .replace(/__DOUBLE_STAR__/g, ".*");
  const regex = new RegExp(`^${escaped}$`);
  return (value) => regex.test(value);
}

function safeId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9._-]+$/.test(value);
}

function safePathSegment(text) {
  return String(text)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "routine";
}

function shortStableId(text) {
  let hash = 2166136261;
  for (const char of String(text)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function routineRunPath(runId, file) {
  return `.myagenttool/routine-runs/${runId}/${file}`;
}

function relativeRepoPath(path, root = repoRoot) {
  return normalizePath(resolve(path).replace(resolve(root), "")).replace(/^\/+/, "");
}

function normalizePath(path) {
  return path.replace(/\\/g, "/");
}

function findRoutineSourceRoot(path) {
  let current = dirname(resolve(path));
  while (current && current !== dirname(current)) {
    if (existsSync(resolve(current, ".git")) || existsSync(resolve(current, "package.json"))) return current;
    current = dirname(current);
  }
  return dirname(resolve(path));
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function arrayOr(value, fallback) {
  return Array.isArray(value) ? value : fallback;
}

function stringArrayOr(value, fallback) {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : fallback;
}

function uniqueStrings(items) {
  return [...new Set((items ?? []).filter(Boolean))];
}

function stringOr(value, fallback) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function booleanOr(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function positiveIntegerOr(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeIntegerOr(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function list(items) {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None.";
}

function fail(message) {
  throw new Error(message);
}

function requireGithubRepo(input) {
  const repo = stringOr(input.repo, "");
  if (!repo) fail(`Input ${input.id} requires repo.`);
  return repo;
}

function ghJson(args, root) {
  const ghPath = resolveGhPath();
  const output = commandOutputForJson(ghPath, args, root);
  try {
    return JSON.parse(output || "null");
  } catch (error) {
    throw new Error(`GitHub CLI did not return valid JSON for gh ${args.join(" ")}: ${error.message}`);
  }
}

function commandOutputForJson(command, args, root) {
  if (/\.mjs$/i.test(command)) {
    return execFileSync("node", [command, ...args], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
    const commandLine = [quoteCmdArg(command), ...args.map(quoteCmdArg)].join(" ");
    const result = spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", commandLine], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    if (result.status !== 0) {
      throw new Error(`Command failed: ${command} ${args.join(" ")}\n${result.stderr ?? ""}`);
    }
    return result.stdout ?? "";
  }
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function quoteCmdArg(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function resolveGhPath() {
  if (process.env.GH_PATH) return process.env.GH_PATH;
  if (process.platform === "win32") {
    const defaultPath = "C:\\Program Files\\GitHub CLI\\gh.exe";
    if (existsSync(defaultPath)) return defaultPath;
  }
  return "gh";
}
