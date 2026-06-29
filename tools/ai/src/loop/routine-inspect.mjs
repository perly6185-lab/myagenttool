import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

export const LOOP_ROUTINE_INSPECT_SCHEMA_VERSION = 1;

const ROUTINE_READ_MODEL_BOUNDARIES = [
  "This read model is local and read-only.",
  "It does not start routines, enqueue fanout, run workers, push, create PRs, or merge PRs.",
  "Mutation still requires explicit Loop Routine CLI commands and approval flags.",
];

let readModelCache = null;

export function listLoopRoutineRunsReadModel({
  routineId = null,
  status = null,
  limit = 20,
  root,
  projectId = null,
  projectPath = root,
  mode = "cli",
  useCache = false,
  cacheTtlMs = 2000,
} = {}) {
  const rootPath = resolveRequiredRoot(root);
  const runsRoot = resolve(rootPath, ".myagenttool/routine-runs");
  const safeLimit = positiveIntegerOr(limit, 20);
  const cacheKey = JSON.stringify({ root: rootPath, projectId, routineId, status, limit: safeLimit, mode });
  const directoryMtimeMs = existsSync(runsRoot) ? statSync(runsRoot).mtimeMs : 0;
  if (
    useCache
    && readModelCache
    && readModelCache.cacheKey === cacheKey
    && readModelCache.directoryMtimeMs === directoryMtimeMs
    && Date.now() - readModelCache.cachedAtMs < cacheTtlMs
  ) {
    return readModelCache.value;
  }

  const runs = discoverRoutineRunIds(rootPath)
    .map((routineRunId) => routineRunSummary({ routineRunId, root: rootPath, mode }))
    .filter(Boolean)
    .filter((run) => !routineId || run.routineId === routineId)
    .filter((run) => !status || run.status === status)
    .sort((left, right) => String(right.startedAt ?? right.routineRunId).localeCompare(String(left.startedAt ?? left.routineRunId)))
    .slice(0, safeLimit);

  const value = {
    schemaVersion: LOOP_ROUTINE_INSPECT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    projectId,
    projectPath,
    routineRunCount: runs.length,
    runCount: runs.length,
    latestRunId: runs[0]?.routineRunId ?? null,
    filters: { routineId, status, limit: safeLimit },
    runs,
    boundaries: ROUTINE_READ_MODEL_BOUNDARIES,
  };

  if (useCache) {
    readModelCache = {
      cacheKey,
      directoryMtimeMs,
      cachedAtMs: Date.now(),
      value,
    };
  }
  return value;
}

export function latestLoopRoutineRunReadModel({ routineId, root } = {}) {
  if (!routineId) throw new Error("Missing --routine.");
  const result = listLoopRoutineRunsReadModel({ routineId, limit: 1, root });
  return {
    schemaVersion: LOOP_ROUTINE_INSPECT_SCHEMA_VERSION,
    routineId,
    routineRun: result.runs[0] ?? null,
  };
}

export function showLoopRoutineRunReadModel({ routineRunId, root, mode = "cli" } = {}) {
  const run = loadRoutineRun(routineRunId, root);
  return routineRunDetail({ run, root: resolveRequiredRoot(root), mode });
}

export function listLoopRoutineFindingsReadModel({ routineRunId, severity = null, withSuggestedRun = false, root } = {}) {
  const run = loadRoutineRun(routineRunId, root);
  const findings = arrayOr(readOptionalJsonFile(resolve(run.runDir, "findings.json")), [])
    .filter((finding) => !severity || finding.severity === severity)
    .filter((finding) => !withSuggestedRun || Boolean(finding.suggestedRun))
    .map((finding) => ({
      ...compactRoutineFinding(finding),
      evidence: arrayOr(finding.evidence, []),
      skillBindings: arrayOr(finding.skillBindings, []),
      suggestedRun: finding.suggestedRun ?? null,
    }));
  return {
    schemaVersion: LOOP_ROUTINE_INSPECT_SCHEMA_VERSION,
    routineRunId,
    filters: { severity, withSuggestedRun },
    findingCount: findings.length,
    findings,
  };
}

export function compactLoopRoutineStateSummary({ root, projectId = null, projectPath = root } = {}) {
  const result = listLoopRoutineRunsReadModel({
    root,
    projectId,
    projectPath,
    limit: 1,
    mode: "summary",
    useCache: true,
  });
  return {
    schemaVersion: result.schemaVersion,
    generatedAt: result.generatedAt,
    projectId: result.projectId,
    projectPath: result.projectPath,
    runCount: result.runCount,
    latestRunId: result.latestRunId,
    api: {
      list: "/api/loop-routines",
      show: result.latestRunId ? `/api/loop-routines/${encodeURIComponent(result.latestRunId)}` : null,
      findings: result.latestRunId ? `/api/loop-routines/${encodeURIComponent(result.latestRunId)}/findings` : null,
    },
    boundaries: ROUTINE_READ_MODEL_BOUNDARIES,
  };
}

export function routineRunSummary({ routineRunId, root, mode = "cli" }) {
  const rootPath = resolveRequiredRoot(root);
  const runDir = resolve(rootPath, ".myagenttool/routine-runs", routineRunId);
  const routine = readOptionalJsonFile(resolve(runDir, "routine.json"));
  const inputSnapshot = mode === "ui" ? readOptionalJsonFile(resolve(runDir, "input-snapshot.json")) : null;
  const skillSnapshot = mode === "ui" ? readOptionalJsonFile(resolve(runDir, "skill-snapshot.json")) : null;
  const checksResult = readOptionalJsonFile(resolve(runDir, "checks-result.json"));
  const findings = arrayOr(readOptionalJsonFile(resolve(runDir, "findings.json")), []);
  const fanoutPlan = readOptionalJsonFile(resolve(runDir, "fanout-plan.json"));
  const fanoutResult = readOptionalJsonFile(resolve(runDir, "fanout-result.json"));
  const events = readRoutineRunEvents(runDir);
  if (!routine && events.length === 0) return null;

  const base = {
    routineRunId,
    routineId: routine?.metadata?.id ?? events[0]?.routineId ?? "routine",
    status: routineRunStatusFromEvents(events, checksResult),
    runDir: relativeRepoPath(runDir, rootPath),
    startedAt: events[0]?.createdAt ?? null,
    completedAt: routineRunCompletedAt(events),
    findingCount: findings.length,
    suggestedRunCount: findings.filter((finding) => finding.suggestedRun).length,
    failedCheckCount: arrayOr(checksResult?.checks, []).filter((check) => check.status === "failed").length,
    fanoutCandidateCount: fanoutPlan?.candidateCount ?? null,
    fanoutCreatedCount: fanoutResult?.createdRuns?.length ?? null,
    evidence: routineRunEvidencePaths(routineRunId, runDir),
  };

  if (mode !== "ui" && mode !== "summary") return base;

  return {
    ...base,
    name: routine?.metadata?.name ?? routine?.metadata?.id ?? "Routine",
    summary: buildRoutineRunSummary({ routine, inputSnapshot, skillSnapshot, checksResult, findings, fanoutPlan, fanoutResult, events }),
    inputs: compactInputs(inputSnapshot),
    skills: compactSkills(skillSnapshot),
    checks: compactChecks(checksResult),
    findings: findings.slice(0, mode === "summary" ? 5 : 20).map(compactRoutineFindingForUi),
    fanout: compactFanout(fanoutPlan, fanoutResult),
  };
}

function routineRunDetail({ run, root, mode }) {
  const routine = readOptionalJsonFile(resolve(run.runDir, "routine.json"));
  const plan = readOptionalJsonFile(resolve(run.runDir, "plan.json"));
  const inputSnapshot = readOptionalJsonFile(resolve(run.runDir, "input-snapshot.json"));
  const skillSnapshot = readOptionalJsonFile(resolve(run.runDir, "skill-snapshot.json"));
  const checksResult = readOptionalJsonFile(resolve(run.runDir, "checks-result.json"));
  const findings = readOptionalJsonFile(resolve(run.runDir, "findings.json")) ?? [];
  const fanoutPlan = readOptionalJsonFile(resolve(run.runDir, "fanout-plan.json"));
  const fanoutResult = readOptionalJsonFile(resolve(run.runDir, "fanout-result.json"));
  const events = readRoutineRunEvents(run.runDir);
  const base = {
    schemaVersion: LOOP_ROUTINE_INSPECT_SCHEMA_VERSION,
    routineRunId: run.routineRunId,
    routineId: routine?.metadata?.id ?? run.routineId,
    name: routine?.metadata?.name ?? routine?.metadata?.id ?? run.routineId,
    status: routineRunStatusFromEvents(events, checksResult),
    runDir: relativeRepoPath(run.runDir, root),
    startedAt: events[0]?.createdAt ?? null,
    completedAt: routineRunCompletedAt(events),
    evidence: routineRunEvidencePaths(run.routineRunId, run.runDir),
    summary: buildRoutineRunSummary({ routine, inputSnapshot, skillSnapshot, checksResult, findings, fanoutPlan, fanoutResult }),
    inputs: compactInputs(inputSnapshot),
    skills: compactSkills(skillSnapshot),
    checks: compactChecks(checksResult),
    findings: arrayOr(findings, []).map(mode === "ui" ? compactRoutineFindingForUi : compactRoutineFinding),
    fanout: compactFanout(fanoutPlan, fanoutResult),
  };
  if (mode === "ui") return base;
  return {
    ...base,
    routine,
    plan,
  };
}

function loadRoutineRun(routineRunId, root) {
  const rootPath = resolveRequiredRoot(root);
  const id = safePathSegment(routineRunId);
  if (id !== routineRunId) throw new Error(`Invalid routine run id: ${routineRunId}`);
  const runDir = resolve(rootPath, ".myagenttool/routine-runs", routineRunId);
  if (!existsSync(runDir)) throw new Error(`Loop routine run not found: ${routineRunId}`);
  const routine = existsSync(resolve(runDir, "routine.json")) ? readOptionalJsonFile(resolve(runDir, "routine.json")) : {};
  return {
    routineRunId,
    routineId: routine?.metadata?.id ?? "routine",
    runDir,
  };
}

function discoverRoutineRunIds(root) {
  const runsDir = resolve(root, ".myagenttool/routine-runs");
  if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => safePathSegment(name) === name);
}

function buildRoutineRunSummary({ routine, inputSnapshot, skillSnapshot, checksResult, findings, fanoutPlan, fanoutResult, events = [] }) {
  return {
    name: routine?.metadata?.name ?? null,
    sourcePath: events.find((event) => event.type === "loop_routine_run_created")?.data?.sourcePath ?? null,
    inputCount: arrayOr(inputSnapshot?.inputs, []).length,
    skillCount: arrayOr(skillSnapshot?.skills, []).length,
    checkCount: arrayOr(checksResult?.checks, []).length,
    failedCheckCount: arrayOr(checksResult?.checks, []).filter((check) => check.status === "failed").length,
    findingCount: arrayOr(findings, []).length,
    suggestedRunCount: arrayOr(findings, []).filter((finding) => finding.suggestedRun).length,
    fanoutCandidateCount: fanoutPlan?.candidateCount ?? null,
    fanoutCreatedCount: fanoutResult?.createdRuns?.length ?? null,
    fanoutEnqueuedCount: fanoutResult?.enqueuedCount ?? null,
    fanoutWorkerCompletedCount: fanoutResult?.workerCompletedCount ?? null,
  };
}

function compactInputs(inputSnapshot) {
  return arrayOr(inputSnapshot?.inputs, []).map((input) => ({
    id: input.id,
    type: input.type,
    status: input.status,
    summary: input.summary ?? null,
  }));
}

function compactSkills(skillSnapshot) {
  return arrayOr(skillSnapshot?.skills, []).map((skill) => ({
    id: skill.id,
    status: skill.status,
    title: skill.title,
    path: skill.path,
    acceptance: arrayOr(skill.acceptance, []).slice(0, 6),
    checks: arrayOr(skill.checks, []).slice(0, 6),
  }));
}

function compactChecks(checksResult) {
  return arrayOr(checksResult?.checks, []).map((check) => ({
    id: check.id,
    status: check.status,
    command: check.command,
    required: check.required,
    exitCode: check.exitCode,
  }));
}

function compactFanout(fanoutPlan, fanoutResult) {
  return {
    plan: fanoutPlan ? {
      candidateCount: fanoutPlan.candidateCount,
      skippedCount: fanoutPlan.skippedCount,
      candidates: arrayOr(fanoutPlan.candidates, []).map((candidate) => ({
        findingId: candidate.findingId,
        childRunId: candidate.childRunId,
        priority: candidate.priority,
      })),
    } : null,
    result: fanoutResult ? {
      createdCount: fanoutResult.createdCount,
      skippedCount: fanoutResult.skippedCount,
      enqueuedCount: fanoutResult.enqueuedCount,
      workerCompletedCount: fanoutResult.workerCompletedCount,
      workerFailedCount: fanoutResult.workerFailedCount,
      createdRuns: arrayOr(fanoutResult.createdRuns, []),
      enqueuedRuns: arrayOr(fanoutResult.enqueuedRuns, []),
      workerRuns: arrayOr(fanoutResult.workerRuns, []),
    } : null,
  };
}

function readOptionalJsonFile(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function readRoutineRunEvents(runDir) {
  const path = resolve(runDir, "events.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function routineRunStatusFromEvents(events, checksResult) {
  const terminal = [...events].reverse().find((event) => [
    "loop_routine_run_completed",
    "loop_routine_run_failed",
    "loop_routine_checks_failed",
  ].includes(event.type));
  if (terminal?.type === "loop_routine_run_failed" || terminal?.type === "loop_routine_checks_failed") return "failed";
  if (terminal?.type === "loop_routine_run_completed") return "completed";
  if (arrayOr(checksResult?.checks, []).some((check) => check.required !== false && check.status === "failed")) return "failed";
  if (events.some((event) => event.type === "loop_routine_run_created")) return "running";
  return "unknown";
}

function routineRunCompletedAt(events) {
  return [...events].reverse().find((event) => [
    "loop_routine_run_completed",
    "loop_routine_run_failed",
    "loop_routine_checks_failed",
  ].includes(event.type))?.createdAt ?? null;
}

function routineRunEvidencePaths(routineRunId, runDir) {
  const files = [
    "routine.json",
    "plan.json",
    "events.jsonl",
    "input-snapshot.json",
    "skill-snapshot.json",
    "checks-result.json",
    "summary.md",
    "findings.json",
    "fanout-plan.json",
    "fanout-plan.md",
    "fanout-result.json",
    "fanout-result.md",
  ];
  return files
    .filter((file) => existsSync(resolve(runDir, file)))
    .map((file) => routineRunPath(routineRunId, file));
}

function compactRoutineFinding(finding) {
  return {
    id: stringOr(finding?.id, ""),
    severity: stringOr(finding?.severity, "medium"),
    title: stringOr(finding?.title, ""),
    source: finding?.source ?? null,
    proposedAction: stringOr(finding?.proposedAction, ""),
    suggestedRun: finding?.suggestedRun ?? null,
  };
}

function compactRoutineFindingForUi(finding) {
  return {
    ...compactRoutineFinding(finding),
    evidence: arrayOr(finding?.evidence, []).slice(0, 6),
    skillBindings: arrayOr(finding?.skillBindings, []).map((skill) => ({
      id: skill.id,
      title: skill.title,
      path: skill.path,
      acceptance: arrayOr(skill.acceptance, []).slice(0, 4),
    })),
  };
}

function positiveIntegerOr(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function resolveRequiredRoot(root) {
  if (!root) throw new Error("Missing repository root.");
  return resolve(root);
}

function safePathSegment(text) {
  return String(text ?? "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

function routineRunPath(runId, file) {
  return `.myagenttool/routine-runs/${runId}/${file}`;
}

function relativeRepoPath(path, root) {
  return relative(root, path).replace(/\\/g, "/");
}

function arrayOr(value, fallback = []) {
  return Array.isArray(value) ? value : fallback;
}

function stringOr(value, fallback) {
  return typeof value === "string" && value.trim() ? value : fallback;
}
