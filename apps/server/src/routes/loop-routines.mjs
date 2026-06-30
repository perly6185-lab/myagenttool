import {
  listLoopRoutineFindingsForRequest,
  listLoopRoutineRunsForRequest,
  showLoopRoutineRunForRequest,
} from "../read-models/loop-routines.mjs";

export function handleLoopRoutineRoutes({ req, res, url, sendJson, currentLoopRoutineProjectContext }) {
  if (req.method === "GET" && url.pathname === "/api/loop-routines") {
    const context = currentLoopRoutineProjectContext();
    sendJson(res, 200, listLoopRoutineRunsForRequest(context, url.searchParams));
    return true;
  }

  const findingsMatch = url.pathname.match(/^\/api\/loop-routines\/([^/]+)\/findings$/);
  if (req.method === "GET" && findingsMatch) {
    const context = currentLoopRoutineProjectContext();
    try {
      sendJson(res, 200, listLoopRoutineFindingsForRequest(
        context,
        decodeURIComponent(findingsMatch[1]),
        url.searchParams,
      ));
    } catch (error) {
      sendJson(res, 404, {
        error: "loop_routine_run_not_found",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  const runMatch = url.pathname.match(/^\/api\/loop-routines\/([^/]+)$/);
  if (req.method === "GET" && runMatch) {
    const context = currentLoopRoutineProjectContext();
    try {
      sendJson(res, 200, showLoopRoutineRunForRequest(
        context,
        decodeURIComponent(runMatch[1]),
      ));
    } catch (error) {
      sendJson(res, 404, {
        error: "loop_routine_run_not_found",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }

  return false;
}
