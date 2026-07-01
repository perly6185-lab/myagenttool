/*
 * Identity: actor resolution and tenancy helpers.
 *
 * `main` already seeds `state.users` / `state.teams` / `state.tokens`, stamps
 * `project.ownerTeamId`, and mints/revokes session tokens in
 * `routes/control-plane.mjs` (POST/DELETE `/api/session`). What it lacks is the
 * *enforcement* on top of that: resolve the calling actor from a Bearer token,
 * gate the API, and answer "does this actor's team own this project?" for read
 * scoping and write guards. In local dev (the default) there is one seeded user
 * on one team, so every check collapses to "allow" — tenancy only bites once a
 * second team and `MYAGENT_REQUIRE_AUTH=1` are in play.
 */

/** Turn the 401 gate on. Off by default so local dev needs no login. */
export const REQUIRE_AUTH = process.env.MYAGENT_REQUIRE_AUTH === "1";

/** The seeded local identity, used as the fallback actor. */
export const LOCAL_USER_ID = "usr_local";
export const LOCAL_TEAM_ID = "team_local";

/** A project's owning team; unowned projects belong to the local team. */
export function teamOf(project) {
  return project?.ownerTeamId ?? LOCAL_TEAM_ID;
}

export function findUser(state, userId) {
  return (state.users ?? []).find((u) => u.id === userId) ?? null;
}

function bearer(req) {
  const header = req?.headers?.authorization ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(String(header));
  return match ? match[1].trim() : null;
}

/** A token record is live if it isn't revoked and hasn't expired. Accepts both
 *  control-plane's ISO-string `expiresAt` and a raw epoch-ms number. */
function tokenLive(record) {
  if (!record || record.revokedAt) return false;
  const expiry =
    typeof record.expiresAt === "number" ? record.expiresAt : Date.parse(record.expiresAt);
  return Number.isFinite(expiry) && expiry > Date.now();
}

/**
 * Resolve the actor for a request. A valid unexpired token names the user;
 * otherwise we fall back to the seeded local user (so unauthenticated local
 * dev still has an identity). `authenticated` distinguishes the two — the auth
 * gate rejects requests where it is false.
 */
export function resolveActor(state, req) {
  const token = bearer(req);
  const record = token && (state.tokens ?? []).find((t) => t.token === token && tokenLive(t));
  const user =
    (record && findUser(state, record.userId)) ||
    findUser(state, LOCAL_USER_ID) ||
    (state.users ?? [])[0] ||
    null;
  return {
    userId: user?.id ?? LOCAL_USER_ID,
    teamId: user?.teamId ?? LOCAL_TEAM_ID,
    authenticated: Boolean(record),
  };
}

/**
 * Guard a mutating route by project ownership. If the actor's team does not own
 * the project, writes a 404 and returns true (caller should `return`).
 *
 * We answer 404, not 403: project ids are enumerable, so a 403 "it's not yours"
 * would confirm the id exists to a cross-team caller and let them map another
 * team's projects. For true existence-hiding, a resource route passes its own
 * `notFound` body so the "exists but foreign" 404 is byte-identical to that
 * route's "missing" 404. The default generic body is only for guards keyed on a
 * body-supplied projectId, where there is no sibling resource-not-found to
 * mirror. (Tests pin foreign-body === missing-body per route to catch drift.)
 *
 * A provided-but-unknown projectId is denied too, not waved through: a dangling
 * id is either bogus or another team's deleted row, and treating "unknown" the
 * same as "foreign" means a route can rely on this guard alone to scope a write
 * without also needing a paired existence check. Only an absent projectId
 * (`!projectId`) is a no-op — those callers legitimately fall back elsewhere
 * (e.g. invocation creation uses the current project).
 */
export function denyForeignProject({
  res,
  sendJson,
  state,
  actor,
  projectId,
  notFound = { error: "not_found" },
}) {
  if (!projectId) return false;
  if (actor == null) return false; // unscoped (single-team local dev) — allow.
  const project = (state.projects ?? []).find((p) => p.id === projectId);
  if (!project || teamOf(project) !== actor.teamId) {
    sendJson(res, 404, notFound);
    return true;
  }
  return false;
}
