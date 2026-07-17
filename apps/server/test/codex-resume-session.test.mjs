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

test("with an explicit target invocation, resumes THAT session even if it is not the newest", () => {
  const { resolveResumeCodexSessionId } = serviceWithSessions([
    { id: "s2", invocationId: "inv_new", codexSessionId: "newest", userId: "u1", repoPath: "/repo" },
    { id: "s1", invocationId: "inv_old", codexSessionId: "clicked", userId: "u1", repoPath: "/repo" },
  ]);
  assert.equal(resolveResumeCodexSessionId({ userId: "u1", invocationId: "inv_old" }), "clicked");
});

test("an explicit target belonging to another user is refused (tenancy)", () => {
  const { resolveResumeCodexSessionId } = serviceWithSessions([
    { id: "s1", invocationId: "inv_foreign", codexSessionId: "secret", userId: "u2", repoPath: "/repo" },
  ]);
  assert.equal(resolveResumeCodexSessionId({ userId: "u1", invocationId: "inv_foreign" }), null);
});

test("an explicit target that never captured a provider id returns null (no fallthrough to newest)", () => {
  const { resolveResumeCodexSessionId } = serviceWithSessions([
    { id: "s2", invocationId: "inv_other", codexSessionId: "newest", userId: "u1", repoPath: "/repo" },
    { id: "s1", invocationId: "inv_target", codexSessionId: null, userId: "u1", repoPath: "/repo" },
  ]);
  assert.equal(resolveResumeCodexSessionId({ userId: "u1", invocationId: "inv_target" }), null);
});

// --- #123: user-authored session names + the resume picker ---

function namingService(codexSessions) {
  const events = [];
  const state = { codexSessions, codexWorkspaces: [], codexSessionsAudit: [], events };
  const service = createCodexService({
    state,
    now: () => "2026-07-16T00:00:00.000Z",
    nextId: (p) => `${p}_x`,
    appendEvent: (e) => events.push(e),
    currentProject: () => null,
    findInvocation: () => null,
    persistStateSoon: () => {},
    uniqueStrings: (list) => [...new Set(list)],
    worktreeForProject: () => null,
  });
  return { state, service, events };
}

test("#123 setCodexSessionName: set, cap, tenancy, clear", () => {
  const { state, service, events } = namingService([
    { id: "cdx_a", codexSessionId: "prov-1", userId: "usr_a", repoPath: "/repo", invocationId: "inv_1", name: null },
  ]);
  assert.equal(service.setCodexSessionName("cdx_a", "parser bugfix run", { userId: "usr_a" }).status, 200);
  assert.equal(state.codexSessions[0].name, "parser bugfix run");

  const tooLong = service.setCodexSessionName("cdx_a", "x".repeat(81), { userId: "usr_a" });
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.body.error, "codex_session_name_too_long");

  assert.equal(service.setCodexSessionName("cdx_a", "steal", { userId: "usr_b" }).status, 404, "foreign user reads not-found");
  assert.equal(state.codexSessions[0].name, "parser bugfix run", "unchanged by the foreign attempt");

  assert.equal(service.setCodexSessionName("cdx_ghost", "x", { userId: "usr_a" }).status, 404);

  assert.equal(service.setCodexSessionName("cdx_a", "   ", { userId: "usr_a" }).status, 200);
  assert.equal(state.codexSessions[0].name, null, "blank clears the label");
  assert.ok(events.some((e) => e.type === "codex_session_named"));
});

test("#123 resumableCodexSessions: caller-scoped, resumable-only, names included, safe metadata only", () => {
  const { service } = namingService([
    { id: "cdx_new", codexSessionId: "prov-9", userId: "usr_a", repoPath: "/repo", invocationId: "inv_9", name: "the good run", sessionMode: "new", startedAt: "t1", lastSeenAt: "t2", status: "registered", evidenceIds: ["ev1"] },
    { id: "cdx_unresumable", codexSessionId: null, userId: "usr_a", repoPath: "/repo", invocationId: "inv_8", name: null },
    { id: "cdx_foreign", codexSessionId: "prov-7", userId: "usr_b", repoPath: "/repo", invocationId: "inv_7", name: null },
    { id: "cdx_other_repo", codexSessionId: "prov-6", userId: "usr_a", repoPath: "/elsewhere", invocationId: "inv_6", name: null },
  ]);
  const all = service.resumableCodexSessions({ userId: "usr_a" });
  assert.deepEqual(all.map((row) => row.id), ["cdx_new", "cdx_other_repo"], "resumable + caller-scoped, newest-first");
  const scoped = service.resumableCodexSessions({ userId: "usr_a", repoPath: "/repo" });
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0].name, "the good run");
  assert.equal(scoped[0].invocationId, "inv_9", "the invocation id IS the named-continuation handle (resolveResumeCodexSessionId targets it)");
  const serialized = JSON.stringify(scoped);
  assert.ok(!serialized.includes("prov-9"), "the raw provider id never rides the picker");
  assert.ok(!serialized.includes("ev1"), "no evidence linkage in the picker");
});

test("#123 the picker handle feeds targeted resume end to end", () => {
  const { service } = namingService([
    { id: "cdx_named", codexSessionId: "prov-42", userId: "usr_a", repoPath: "/repo", invocationId: "inv_42", name: "release prep" },
    { id: "cdx_newer", codexSessionId: "prov-43", userId: "usr_a", repoPath: "/repo", invocationId: "inv_43", name: null },
  ]);
  const picked = service.resumableCodexSessions({ userId: "usr_a" }).find((row) => row.name === "release prep");
  assert.equal(
    service.resolveResumeCodexSessionId({ invocationId: picked.invocationId, userId: "usr_a" }),
    "prov-42",
    "a named pick resumes THAT session, not the newest",
  );
});
