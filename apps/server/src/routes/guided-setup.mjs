import { LOCAL_TEAM_ID, LOCAL_USER_ID } from "../runtime/auth.mjs";

const RUN_CAP = 50;

function ownedBy(run, actor) {
  return (run?.ownerTeamId ?? LOCAL_TEAM_ID) === (actor?.teamId ?? LOCAL_TEAM_ID)
    && (run?.ownerUserId ?? LOCAL_USER_ID) === (actor?.userId ?? LOCAL_USER_ID);
}

function latestRun(state, actor) {
  return (state.guidedSetupRuns ?? []).find((run) => ownedBy(run, actor)) ?? null;
}

function recordCommand(run, command, now) {
  run.status = command === "cancel" ? "cancelled" : "active";
  run.lastCommand = command;
  run.updatedAt = now();
  run.checkCount = Number(run.checkCount ?? 0) + (command === "cancel" ? 0 : 1);
  if (command === "cancel") run.cancelledAt = run.updatedAt;
  else run.cancelledAt = null;
}

export async function handleGuidedSetupRoutes({
  req,
  res,
  url,
  sendJson,
  readJson,
  state,
  actor,
  now,
  nextId,
  persistStateSoon,
  persistStateNow,
  publicState,
}) {
  const match = url.pathname.match(/^\/api\/guided-setup\/(start|resume|recheck|cancel)$/);
  if (req.method !== "POST" || !match) return false;

  const command = match[1];
  const body = await readJson(req).catch(() => ({}));
  const requestedRunId = String(body?.runId ?? "").trim();
  let run = requestedRunId
    ? (state.guidedSetupRuns ?? []).find((candidate) => candidate.id === requestedRunId && ownedBy(candidate, actor)) ?? null
    : latestRun(state, actor);

  if (requestedRunId && !run) {
    sendJson(res, 404, { error: "guided_setup_not_found" });
    return true;
  }

  if (command === "cancel" && !run) {
    sendJson(res, 404, { error: "guided_setup_not_found" });
    return true;
  }

  let created = false;
  if (!run || (command === "start" && run.status === "cancelled")) {
    const createdAt = now();
    run = {
      id: nextId("gsr"),
      ownerTeamId: actor?.teamId ?? LOCAL_TEAM_ID,
      ownerUserId: actor?.userId ?? LOCAL_USER_ID,
      status: "active",
      lastCommand: command,
      checkCount: 0,
      createdAt,
      updatedAt: createdAt,
      cancelledAt: null,
      lastResultStatus: null,
    };
    state.guidedSetupRuns = [run, ...(state.guidedSetupRuns ?? [])].slice(0, RUN_CAP);
    created = true;
  }

  recordCommand(run, command, now);
  const guidedSetup = publicState(actor).guidedSetup;
  run.lastResultStatus = guidedSetup.status;
  if (guidedSetup.status === "ready") run.status = "complete";
  (persistStateNow ?? persistStateSoon)();

  sendJson(res, created ? 201 : 200, { guidedSetup });
  return true;
}
