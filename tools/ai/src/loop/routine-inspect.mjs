import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

export const LOOP_ROUTINE_INSPECT_SCHEMA_VERSION = 1;
export const LOOP_ROUTINE_RUNS_INDEX_SCHEMA_VERSION = 1;
export const LOOP_ROUTINE_RUNS_INDEX_PATH = ".myagenttool/state/routine-runs-index.json";

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
  preferIndex = true,
} = {}) {
  const rootPath = resolveRequiredRoot(root);
  const runsRoot = resolve(rootPath, ".myagenttool/routine-runs");
  const safeLimit = positiveIntegerOr(limit, 20);
  const indexPath = routineRunsIndexPath(rootPath);
  const indexMtimeMs = existsSync(indexPath) ? statSync(indexPath).mtimeMs : 0;
  const directoryMtimeMs = existsSync(runsRoot) ? statSync(runsRoot).mtimeMs : 0;
  const cacheKey = JSON.stringify({ root: rootPath, projectId, routineId, status, limit: safeLimit, mode, preferIndex });
  const cacheMtimeMs = preferIndex && indexMtimeMs ? indexMtimeMs : directoryMtimeMs;
  if (
    useCache
    && readModelCache
    && readModelCache.cacheKey === cacheKey
    && readModelCache.cacheMtimeMs === cacheMtimeMs
    && Date.now() - readModelCache.cachedAtMs < cacheTtlMs
  ) {
    return readModelCache.value;
  }

  const indexed = preferIndex ? readRoutineRunsIndex({ root: rootPath, mode }) : null;
  const source = indexed?.ok ? "index" : "scan";
  const runs = (indexed?.ok ? indexed.index.runs : scanRoutineRuns({ root: rootPath, mode }))
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
    index: {
      source,
      status: indexed?.ok ? "ok" : indexed?.status ?? "not_found",
      path: LOOP_ROUTINE_RUNS_INDEX_PATH,
      fallback: source === "scan",
      runCount: indexed?.ok ? indexed.index.runCount : null,
      error: indexed?.ok ? null : indexed?.error ?? null,
    },
    runs,
    boundaries: ROUTINE_READ_MODEL_BOUNDARIES,
  };

  if (useCache) {
    readModelCache = {
      cacheKey,
      cacheMtimeMs,
      cachedAtMs: Date.now(),
      value,
    };
  }
  return value;
}

export function rebuildLoopRoutineRunsIndex({ root, mode = "ui" } = {}) {
  const rootPath = resolveRequiredRoot(root);
  const runs = scanRoutineRuns({ root: rootPath, mode });
  return writeRoutineRunsIndex({
    root: rootPath,
    runs,
    updateReason: "rebuild",
  });
}

export function updateLoopRoutineRunIndex({ routineRunId, root, mode = "ui", updateReason = "incremental" } = {}) {
  const rootPath = resolveRequiredRoot(root);
  const summary = routineRunSummary({ routineRunId, root: rootPath, mode });
  if (!summary) return rebuildLoopRoutineRunsIndex({ root: rootPath, mode });
  const current = readRoutineRunsIndex({ root: rootPath, mode });
  if (!current?.ok) {
    return rebuildLoopRoutineRunsIndex({ root: rootPath, mode });
  }
  const runs = [
    summary,
    ...arrayOr(current.index.runs, []).filter((run) => run.routineRunId !== routineRunId),
  ].sort((left, right) => String(right.startedAt ?? right.routineRunId).localeCompare(String(left.startedAt ?? left.routineRunId)));
  return writeRoutineRunsIndex({
    root: rootPath,
    runs,
    previousGeneratedAt: current.index.generatedAt ?? null,
    updateReason,
  });
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
    index: result.index,
    api: {
      list: "/api/loop-routines",
      show: result.latestRunId ? `/api/loop-routines/${encodeURIComponent(result.latestRunId)}` : null,
      findings: result.latestRunId ? `/api/loop-routines/${encodeURIComponent(result.latestRunId)}/findings` : null,
    },
    boundaries: ROUTINE_READ_MODEL_BOUNDARIES,
  };
}

export function readRoutineRunsIndex({ root, mode = "ui" } = {}) {
  const rootPath = resolveRequiredRoot(root);
  const path = routineRunsIndexPath(rootPath);
  if (!existsSync(path)) {
    return { ok: false, status: "not_found", path: LOOP_ROUTINE_RUNS_INDEX_PATH, error: null, index: null };
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return {
      ok: false,
      status: "invalid_json",
      path: LOOP_ROUTINE_RUNS_INDEX_PATH,
      error: error instanceof Error ? error.message : String(error),
      index: null,
    };
  }
  if (!isObject(parsed) || parsed.schemaVersion !== LOOP_ROUTINE_RUNS_INDEX_SCHEMA_VERSION || !Array.isArray(parsed.runs)) {
    return {
      ok: false,
      status: "invalid_schema",
      path: LOOP_ROUTINE_RUNS_INDEX_PATH,
      error: "Routine runs index schema is invalid.",
      index: null,
    };
  }
  return {
    ok: true,
    status: "ok",
    path: LOOP_ROUTINE_RUNS_INDEX_PATH,
    index: {
      ...parsed,
      runs: parsed.runs.map((run) => normalizeIndexedRun(run, mode)).filter(Boolean),
    },
    error: null,
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

function scanRoutineRuns({ root, mode }) {
  return discoverRoutineRunIds(root)
    .map((routineRunId) => routineRunSummary({ routineRunId, root, mode }))
    .filter(Boolean);
}

function writeRoutineRunsIndex({ root, runs, previousGeneratedAt = null, updateReason }) {
  const rootPath = resolveRequiredRoot(root);
  const path = routineRunsIndexPath(rootPath);
  mkdirSync(dirname(path), { recursive: true });
  const sortedRuns = arrayOr(runs, [])
    .map((run) => normalizeIndexedRun(run, "ui"))
    .filter(Boolean)
    .sort((left, right) => String(right.startedAt ?? right.routineRunId).localeCompare(String(left.startedAt ?? left.routineRunId)));
  const index = {
    schemaVersion: LOOP_ROUTINE_RUNS_INDEX_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    previousGeneratedAt,
    updateReason,
    runCount: sortedRuns.length,
    latestRunId: sortedRuns[0]?.routineRunId ?? null,
    runs: sortedRuns,
    boundaries: ROUTINE_READ_MODEL_BOUNDARIES,
  };
  writeFileSync(path, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  readModelCache = null;
  return {
    schemaVersion: LOOP_ROUTINE_INSPECT_SCHEMA_VERSION,
    indexPath: LOOP_ROUTINE_RUNS_INDEX_PATH,
    index,
  };
}

function normalizeIndexedRun(run, mode) {
  if (!isObject(run) || !stringOr(run.routineRunId, "")) return null;
  const base = {
    routineRunId: stringOr(run.routineRunId, ""),
    routineId: stringOr(run.routineId, "routine"),
    status: stringOr(run.status, "unknown"),
    runDir: stringOr(run.runDir, ""),
    startedAt: run.startedAt ?? null,
    completedAt: run.completedAt ?? null,
    findingCount: numberOr(run.findingCount, run.summary?.findingCount ?? 0),
    suggestedRunCount: numberOr(run.suggestedRunCount, run.summary?.suggestedRunCount ?? 0),
    failedCheckCount: numberOr(run.failedCheckCount, run.summary?.failedCheckCount ?? 0),
    fanoutCandidateCount: nullableNumber(run.fanoutCandidateCount ?? run.summary?.fanoutCandidateCount),
    fanoutCreatedCount: nullableNumber(run.fanoutCreatedCount ?? run.summary?.fanoutCreatedCount),
    evidence: arrayOr(run.evidence, []),
  };
  if (mode !== "ui" && mode !== "summary") return base;
  const summary = isObject(run.summary) ? run.summary : {};
  return {
    ...base,
    name: stringOr(run.name, run.routineId ?? "Routine"),
    summary: {
      name: summary.name ?? run.name ?? null,
      sourcePath: summary.sourcePath ?? null,
      inputCount: numberOr(summary.inputCount, 0),
      skillCount: numberOr(summary.skillCount, 0),
      checkCount: numberOr(summary.checkCount, 0),
      failedCheckCount: numberOr(summary.failedCheckCount, base.failedCheckCount),
      findingCount: numberOr(summary.findingCount, base.findingCount),
      suggestedRunCount: numberOr(summary.suggestedRunCount, base.suggestedRunCount),
      fanoutCandidateCount: nullableNumber(summary.fanoutCandidateCount ?? base.fanoutCandidateCount),
      fanoutCreatedCount: nullableNumber(summary.fanoutCreatedCount ?? base.fanoutCreatedCount),
      fanoutEnqueuedCount: nullableNumber(summary.fanoutEnqueuedCount),
      fanoutWorkerCompletedCount: nullableNumber(summary.fanoutWorkerCompletedCount),
    },
    inputs: arrayOr(run.inputs, []),
    skills: arrayOr(run.skills, []),
    checks: arrayOr(run.checks, []),
    findings: arrayOr(run.findings, []),
    fanout: isObject(run.fanout) ? run.fanout : { plan: null, result: null },
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
    summary: buildRoutineRunSummary({ routine, inputSnapshot, skillSnapshot, checksResult, findings, fanoutPlan, fanoutResult, events }),
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

function routineRunsIndexPath(root) {
  return resolve(root, LOOP_ROUTINE_RUNS_INDEX_PATH);
}

function relativeRepoPath(path, root) {
  return relative(root, path).replace(/\\/g, "/");
}

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function arrayOr(value, fallback = []) {
  return Array.isArray(value) ? value : fallback;
}

function stringOr(value, fallback) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function numberOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
