import {
  ProfileInferenceInputError,
  inferProfileCandidates,
  reviewableWorkProfileInference,
} from "../services/profile-inference.mjs";

const CATEGORIES = new Set(["role", "domain", "work_type", "skill", "preference"]);
const MAX_VALUE_LENGTH = 120;
const MAX_REASON_LENGTH = 500;
const LOCAL_TEAM_ID = "team_local";
const LOCAL_USER_ID = "usr_local";

export async function handleWorkProfileRoutes({
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
}) {
  if (url.pathname === "/api/work-profile/infer") {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return true;
    }
    const body = await readJson(req).catch(() => ({}));
    const projectId = String(body?.projectId ?? "").trim();
    const teamId = actor?.teamId ?? LOCAL_TEAM_ID;
    const project = (state.projects ?? []).find(
      (row) => row.id === projectId && (row.ownerTeamId ?? LOCAL_TEAM_ID) === teamId,
    );
    if (!project) {
      sendJson(res, 404, { error: "work_profile_project_not_found" });
      return true;
    }
    try {
      const result = inferProfileCandidates(body?.input, {
        maxCandidates: body?.maxCandidates,
      });
      const createdAt = now();
      const inferences = state.workProfileInferences ?? (state.workProfileInferences = []);
      const projected = result.candidates.map((candidate) =>
        reviewableWorkProfileInference(candidate, {
          id: nextId("wpi"),
          userId: actor?.userId ?? LOCAL_USER_ID,
          ownerTeamId: teamId,
          project,
          createdAt,
        }));
      for (const inference of projected) {
        const existingIndex = inferences.findIndex((row) =>
          visibleToActor(row, actor)
          && row.sourceProjectId === inference.sourceProjectId
          && row.value === inference.value
          && row.status === "pending");
        if (existingIndex >= 0) {
          inference.id = inferences[existingIndex].id;
          inference.createdAt = inferences[existingIndex].createdAt;
          inferences[existingIndex] = inference;
        } else {
          inferences.unshift(inference);
        }
      }
      persistStateSoon();
      sendJson(res, 201, { inference: result, reviewInferences: projected });
    } catch (error) {
      if (error instanceof ProfileInferenceInputError) {
        sendJson(res, 400, { error: error.code, message: error.message });
      } else {
        throw error;
      }
    }
    return true;
  }

  const match = url.pathname.match(/^\/api\/work-profile\/inferences\/([^/]+)(?:\/(confirm|reject))?$/);
  if (!match) return false;

  const inferenceId = decodeURIComponent(match[1]);
  const command = match[2] ?? null;
  const inferences = state.workProfileInferences ?? (state.workProfileInferences = []);
  const index = inferences.findIndex((row) => row.id === inferenceId && visibleToActor(row, actor));
  if (index < 0) {
    sendJson(res, 404, { error: "work_profile_inference_not_found" });
    return true;
  }

  const inference = inferences[index];
  if (req.method === "POST" && command === "confirm") {
    const before = snapshot(inference);
    inference.status = "confirmed";
    inference.updatedAt = now();
    const audit = recordAudit(state, {
      inference,
      action: "confirmed",
      before,
      after: snapshot(inference),
      actor,
      now,
      nextId,
    });
    persistStateSoon();
    sendJson(res, 200, { inference, audit });
    return true;
  }

  if (req.method === "POST" && command === "reject") {
    const body = await readJson(req).catch(() => ({}));
    const before = snapshot(inference);
    inference.status = "rejected";
    inference.updatedAt = now();
    const audit = recordAudit(state, {
      inference,
      action: "rejected",
      before,
      after: snapshot(inference),
      reason: normalizeReason(body?.reason),
      actor,
      now,
      nextId,
    });
    persistStateSoon();
    sendJson(res, 200, { inference, audit });
    return true;
  }

  if (req.method === "PATCH" && !command) {
    const body = await readJson(req).catch(() => ({}));
    const category = String(body?.category ?? "").trim();
    const value = String(body?.value ?? "").trim();
    if (!CATEGORIES.has(category)) {
      sendJson(res, 400, { error: "invalid_work_profile_category" });
      return true;
    }
    if (!value || value.length > MAX_VALUE_LENGTH) {
      sendJson(res, 400, {
        error: "invalid_work_profile_value",
        message: `Value must contain 1-${MAX_VALUE_LENGTH} characters.`,
      });
      return true;
    }
    const before = snapshot(inference);
    inference.category = category;
    inference.value = value;
    // A correction changes the system's understanding and therefore needs a
    // fresh explicit confirmation.
    inference.status = "pending";
    inference.updatedAt = now();
    const audit = recordAudit(state, {
      inference,
      action: "modified",
      before,
      after: snapshot(inference),
      reason: normalizeReason(body?.reason),
      actor,
      now,
      nextId,
    });
    persistStateSoon();
    sendJson(res, 200, { inference, audit });
    return true;
  }

  if (req.method === "DELETE" && !command) {
    const body = await readJson(req).catch(() => ({}));
    const before = snapshot(inference);
    inferences.splice(index, 1);
    const audit = recordAudit(state, {
      inference,
      action: "deleted",
      before,
      after: null,
      reason: normalizeReason(body?.reason),
      actor,
      now,
      nextId,
    });
    persistStateSoon();
    sendJson(res, 200, { deletedId: inference.id, audit });
    return true;
  }

  sendJson(res, 405, { error: "method_not_allowed" });
  return true;
}

function visibleToActor(row, actor) {
  const teamId = actor?.teamId ?? LOCAL_TEAM_ID;
  const userId = actor?.userId ?? LOCAL_USER_ID;
  return (row?.ownerTeamId ?? LOCAL_TEAM_ID) === teamId
    && (row?.userId ?? LOCAL_USER_ID) === userId;
}

function recordAudit(state, {
  inference,
  action,
  before,
  after,
  reason = null,
  actor,
  now,
  nextId,
}) {
  const audit = {
    id: nextId("wpa"),
    inferenceId: inference.id,
    ownerTeamId: inference.ownerTeamId ?? actor?.teamId ?? LOCAL_TEAM_ID,
    userId: inference.userId ?? actor?.userId ?? LOCAL_USER_ID,
    actorId: actor?.userId ?? LOCAL_USER_ID,
    action,
    before,
    after,
    reason,
    at: now(),
  };
  (state.workProfileAuditEvents ?? (state.workProfileAuditEvents = [])).unshift(audit);
  return audit;
}

function snapshot(inference) {
  return {
    category: inference.category,
    value: inference.value,
    status: inference.status,
    evidence: (inference.evidence ?? []).map((item) => ({ ...item })),
  };
}

function normalizeReason(value) {
  const reason = String(value ?? "").trim();
  return reason ? reason.slice(0, MAX_REASON_LENGTH) : null;
}
