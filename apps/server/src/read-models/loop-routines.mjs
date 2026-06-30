import {
  compactLoopRoutineStateSummary,
  listLoopRoutineFindingsReadModel,
  listLoopRoutineRunsReadModel,
  showLoopRoutineRunReadModel,
} from "../../../../tools/ai/src/loop/routine-inspect.mjs";

export function buildLoopRoutineStateSummary(context) {
  return compactLoopRoutineStateSummary(context);
}

export function listLoopRoutineRunsForRequest(context, searchParams) {
  return listLoopRoutineRunsReadModel({
    ...context,
    routineId: searchParams.get("routine") ?? null,
    status: searchParams.get("status") ?? null,
    limit: Number(searchParams.get("limit") ?? 50),
    mode: "ui",
    useCache: true,
  });
}

export function listLoopRoutineFindingsForRequest(context, routineRunId, searchParams) {
  return listLoopRoutineFindingsReadModel({
    ...context,
    routineRunId,
    severity: searchParams.get("severity") ?? null,
    withSuggestedRun: searchParams.get("withSuggestedRun") === "1" || searchParams.get("withSuggestedRun") === "true",
  });
}

export function showLoopRoutineRunForRequest(context, routineRunId) {
  return showLoopRoutineRunReadModel({
    ...context,
    routineRunId,
    mode: "ui",
  });
}
