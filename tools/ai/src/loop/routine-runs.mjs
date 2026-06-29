import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fail, safePathSegment } from "./routine-utils.mjs";

export function routineRunPath(runId, file) {
  return `.myagenttool/routine-runs/${runId}/${file}`;
}

export function loadRoutineRun(routineRunId, root) {
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

export function appendRoutineRunEvent(run, type, message, data = {}) {
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

export function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`Failed to read JSON ${path}: ${error.message}`);
  }
}
