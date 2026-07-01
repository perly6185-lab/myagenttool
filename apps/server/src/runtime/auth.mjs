/*
 * Identity: actor resolution, session tokens, and tenancy helpers.
 *
 * `main` already seeds `state.users` / `state.teams` / `state.tokens` and stamps
 * `project.ownerTeamId`; this module adds the *behavior* on top of that model:
 * resolve the calling actor from a Bearer token, issue/expire session tokens,
 * and answer "does this actor's team own this project?" for read scoping and
 * write guards. In local dev (the default) there is one seeded user on one team,
 * so every check collapses to "allow" — tenancy only bites once a second team
 * and `MYAGENT_REQUIRE_AUTH=1` are in play.
 */

import crypto from "node:crypto";

/** Turn the 401 gate on. Off by default so local dev needs no login. */
export const REQUIRE_AUTH = process.env.MYAGENT_REQUIRE_AUTH === "1";

const TTL_ENV = Math.floor(Number(process.env.MYAGENT_TOKEN_TTL_MS));
/** Session lifetime; 30 days unless overridden with a positive ms value. */
export const TOKEN_TTL_MS =
  Number.isFinite(TTL_ENV) && TTL_ENV > 0 ? TTL_ENV : 30 * 24 * 60 * 60 * 1000;

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

/**
 * Resolve the actor for a request. A valid unexpired token names the user;
 * otherwise we fall back to the seeded local user (so unauthenticated local
 * dev still has an identity). `authenticated` distinguishes the two — the auth
 * gate rejects requests where it is false.
 */
export function resolveActor(state, req) {
  const token = bearer(req);
  const record =
    token && (state.tokens ?? []).find((t) => t.token === token && t.expiresAt > Date.now());
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

/** Drop expired tokens in place. */
export function pruneTokens(state) {
  const cutoff = Date.now();
  if (state.tokens?.length) {
    state.tokens = state.tokens.filter((t) => t.expiresAt > cutoff);
  }
}

/** Mint a session token for a user and record it on `state.tokens`. */
export function issueToken(state, userId, ttlMs = TOKEN_TTL_MS) {
  state.tokens = state.tokens ?? [];
  pruneTokens(state);
  const record = {
    token: crypto.randomBytes(32).toString("hex"),
    userId,
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + ttlMs,
  };
  state.tokens.push(record);
  return record;
}

/** Revoke a specific token. Returns true if one was removed. */
export function revokeToken(state, token) {
  const before = state.tokens?.length ?? 0;
  if (before) state.tokens = state.tokens.filter((t) => t.token !== token);
  return (state.tokens?.length ?? 0) < before;
}

/**
 * Guard a mutating route by project ownership. If the actor's team does not own
 * the project, writes a 403 and returns true (caller should `return`).
 */
export function denyForeignProject({ res, sendJson, state, actor, projectId }) {
  if (!projectId) return false;
  const project = (state.projects ?? []).find((p) => p.id === projectId);
  if (project && actor && teamOf(project) !== actor.teamId) {
    sendJson(res, 403, { error: "forbidden", message: "Project belongs to another team." });
    return true;
  }
  return false;
}
