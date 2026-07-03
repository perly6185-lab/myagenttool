/*
 * Unit test for true provider-session resume (#163): resolveResumeCodexSessionId
 * picks the correct prior Codex session's captured provider id to continue, so
 * the bridge can resume BY ID instead of the fragile global `--last`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createCodexService } from "../src/services/codex.mjs";

function serviceWithSessions(codexSessions) {
  const state = { codexSessions, codexWorkspaces: [], codexSessionsAudit: [] };
  return createCodexService({
    state,
    now: () => "2026-07-03T00:00:00.000Z",
    nextId: (p) => `${p}_x`,
    appendEvent: () => {},
    currentProject: () => null,
    findInvocation: () => null,
    persistStateSoon: () => {},
    uniqueStrings: (list) => [...new Set(list)],
    worktreeForProject: () => null,
  });
}

test("resolves the most recent prior session that captured a provider id (newest-first)", () => {
  // codexSessions is newest-first (the service unshifts on create).
  const { resolveResumeCodexSessionId } = serviceWithSessions([
    { id: "s3", codexSessionId: "sess-new", userId: "u1", repoPath: "/repo" },
    { id: "s2", codexSessionId: "sess-old", userId: "u1", repoPath: "/repo" },
  ]);
  assert.equal(resolveResumeCodexSessionId({ repoPath: "/repo", userId: "u1" }), "sess-new");
});

test("skips sessions that never captured a provider id", () => {
  const { resolveResumeCodexSessionId } = serviceWithSessions([
    { id: "s2", codexSessionId: null, userId: "u1", repoPath: "/repo" },
    { id: "s1", codexSessionId: "sess-real", userId: "u1", repoPath: "/repo" },
  ]);
  assert.equal(resolveResumeCodexSessionId({ repoPath: "/repo", userId: "u1" }), "sess-real");
});

test("scopes by repo and user so continue never crosses projects or tenants", () => {
  const { resolveResumeCodexSessionId } = serviceWithSessions([
    { id: "s2", codexSessionId: "other-repo", userId: "u1", repoPath: "/elsewhere" },
    { id: "s1", codexSessionId: "other-user", userId: "u2", repoPath: "/repo" },
  ]);
  assert.equal(resolveResumeCodexSessionId({ repoPath: "/repo", userId: "u1" }), null);
});

test("excludes the just-created session and returns null when nothing is resumable", () => {
  const { resolveResumeCodexSessionId } = serviceWithSessions([
    { id: "s_new", codexSessionId: "self", userId: "u1", repoPath: "/repo" },
  ]);
  assert.equal(
    resolveResumeCodexSessionId({ repoPath: "/repo", userId: "u1", excludeSessionId: "s_new" }),
    null,
  );
});
