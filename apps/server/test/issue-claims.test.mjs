/*
 * #1143 — Issue claims (multi-developer issue distribution).
 *
 * Before this, nothing stopped two humans (or a human and auto-trigger) from
 * starting work on the same issue: dedup only covered issues that already HAD
 * an auto-run. A claim is an issue-level develop lease taken synchronously at
 * admission (same one-tick atomicity argument as #890 budget reservations),
 * released when the run settles, and reclaimed by lease expiry when the holder
 * walks away. These tests prove the mutual-exclusion, renew, expiry, release,
 * auto-trigger-skip, and restart-survival semantics.
 *
 * Run: node --test test/issue-claims.test.mjs (from apps/server).
 */

import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createPersistenceRuntime } from "../src/runtime/persistence.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import { createIssueClaimService, issueHasActiveClaim } from "../src/services/issue-claims.mjs";
import { sameProjectPath } from "../src/services/projects.mjs";
import { selectAutoTriggerCandidates } from "../src/services/auto-trigger.mjs";

const T0 = "2026-07-16T00:00:00.000Z";

function makeClock(startIso = T0) {
  let current = Date.parse(startIso);
  const now = () => new Date(current).toISOString();
  now.advanceMinutes = (minutes) => {
    current += minutes * 60_000;
  };
  return now;
}

function baseState() {
  return {
    users: [
      { id: "usr_a", teamId: "team_a" },
      { id: "usr_b", teamId: "team_a" },
    ],
    teams: [{ id: "team_a", name: "A" }],
    projects: [{ id: "projA", name: "A", ownerTeamId: "team_a" }],
    autoRunSettings: {},
    issueClaims: [],
    events: [],
  };
}

function serviceFor(state, now = makeClock()) {
  let id = 0;
  const events = [];
  const svc = createIssueClaimService({
    state,
    now,
    nextId: (prefix) => `${prefix}_${++id}`,
    appendEvent: (event) => events.push(event),
    persistStateSoon: () => {},
  });
  return { svc, events, now };
}

test("#1143 exactly one develop claim per issue: a foreign holder refuses the second claimer", () => {
  const state = baseState();
  const { svc } = serviceFor(state);

  const first = svc.claimIssue({ projectId: "projA", issueNumber: 7, actor: { userId: "usr_a" } });
  assert.equal(first.ok, true);
  assert.equal(first.claim.mode, "develop");
  assert.equal(first.claim.teamId, "team_a", "claim is stamped with the project's owning team");

  const second = svc.claimIssue({ projectId: "projA", issueNumber: 7, actor: { userId: "usr_b" } });
  assert.equal(second.ok, false, "usr_b cannot also develop #7");
  assert.match(second.reason, /already claimed .* usr_a/);
  assert.equal(second.claim.id, first.claim.id, "the refusal names the blocking claim");

  // Only one row was written; the refused claim wrote nothing.
  assert.equal(state.issueClaims.filter((c) => c.status === "active").length, 1);

  // A different issue is untouched by the lease.
  assert.equal(svc.claimIssue({ projectId: "projA", issueNumber: 8, actor: { userId: "usr_b" } }).ok, true);
});

test("#1143 re-claim by the holder renews the lease and re-attaches the current run (idempotent)", () => {
  const state = baseState();
  const { svc, now } = serviceFor(state);

  const first = svc.claimIssue({ projectId: "projA", issueNumber: 7, actor: { userId: "usr_a" } });
  const firstLease = first.claim.leaseExpiresAt;

  now.advanceMinutes(60);
  const again = svc.claimIssue({ projectId: "projA", issueNumber: 7, actor: { userId: "usr_a" }, autoRunId: "aur_2" });
  assert.equal(again.ok, true);
  assert.equal(again.renewed, true, "same-holder re-claim renews, never a second row");
  assert.equal(again.claim.id, first.claim.id);
  assert.ok(Date.parse(again.claim.leaseExpiresAt) > Date.parse(firstLease), "lease extended");
  assert.equal(again.claim.autoRunId, "aur_2", "the NEW run is attached so its settle releases the claim");
  assert.equal(state.issueClaims.length, 1);
});

test("#1143 review coexists with develop; a reviewer never blocks the developer (or vice versa)", () => {
  const state = baseState();
  const { svc } = serviceFor(state);

  assert.equal(svc.claimIssue({ projectId: "projA", issueNumber: 7, actor: { userId: "usr_a" }, mode: "develop" }).ok, true);
  assert.equal(svc.claimIssue({ projectId: "projA", issueNumber: 7, actor: { userId: "usr_b" }, mode: "review" }).ok, true);
  assert.equal(state.issueClaims.filter((c) => c.status === "active").length, 2);
});

test("#1143 an expired lease returns the issue to the pool, with an auditable expiry", () => {
  const state = baseState();
  const { svc, events, now } = serviceFor(state);

  svc.claimIssue({ projectId: "projA", issueNumber: 7, actor: { userId: "usr_a" } });
  now.advanceMinutes(24 * 60 + 1); // past the default 24h TTL

  const second = svc.claimIssue({ projectId: "projA", issueNumber: 7, actor: { userId: "usr_b" } });
  assert.equal(second.ok, true, "the walked-away holder no longer blocks the issue");
  const expired = state.issueClaims.find((c) => c.claimedBy === "usr_a");
  assert.equal(expired.status, "expired");
  assert.equal(expired.outcome, "lease_expired");
  assert.ok(events.some((e) => e.type === "issue_claim_expired"), "expiry is an event, not a silent drop");
});

test("#1143 releaseClaimsForAutoRun releases the run's claim once; a second settle is a no-op", () => {
  const state = baseState();
  const { svc, events } = serviceFor(state);

  svc.claimIssue({ projectId: "projA", issueNumber: 7, actor: { userId: "usr_a" }, autoRunId: "aur_1" });
  assert.equal(svc.releaseClaimsForAutoRun("aur_1", { outcome: "committed" }), 1);
  assert.equal(svc.releaseClaimsForAutoRun("aur_1", { outcome: "committed" }), 0, "idempotent");
  assert.equal(state.issueClaims[0].status, "released");
  assert.equal(state.issueClaims[0].outcome, "committed");
  assert.equal(events.filter((e) => e.type === "issue_claim_released").length, 1);

  // The issue is claimable again after release.
  assert.equal(svc.claimIssue({ projectId: "projA", issueNumber: 7, actor: { userId: "usr_b" } }).ok, true);
});

test("#1143 releaseIssueClaim is the manual hand-back; invalid input never claims", () => {
  const state = baseState();
  const { svc } = serviceFor(state);

  const claimed = svc.claimIssue({ projectId: "projA", issueNumber: 7, actor: { userId: "usr_a" } });
  assert.equal(svc.releaseIssueClaim(claimed.claim.id, { actor: { userId: "usr_a" } }), true);
  assert.equal(svc.releaseIssueClaim(claimed.claim.id), false, "idempotent");

  assert.equal(svc.claimIssue({ projectId: "projA", issueNumber: Number.NaN, actor: { userId: "usr_a" } }).ok, false);
  assert.equal(svc.claimIssue({ issueNumber: 7, actor: { userId: "usr_a" } }).ok, false);
  assert.equal(svc.claimIssue({ projectId: "projA", issueNumber: 7, mode: "own", actor: { userId: "usr_a" } }).ok, false);
});

test("#1143 auto-trigger skips claimed issues (and only unexpired claims count)", () => {
  const issues = [
    { number: 1, title: "claimed", state: "open" },
    { number: 2, title: "free", state: "open" },
    { number: 3, title: "expired-claim", state: "open" },
  ];
  const issueClaims = [
    { projectId: "prj", issueNumber: 1, status: "active", leaseExpiresAt: "2026-07-17T00:00:00.000Z" },
    { projectId: "prj", issueNumber: 3, status: "active", leaseExpiresAt: "2026-07-15T00:00:00.000Z" }, // already expired
    { projectId: "other", issueNumber: 2, status: "active", leaseExpiresAt: "2026-07-17T00:00:00.000Z" }, // other project
  ];
  const selected = selectAutoTriggerCandidates({
    issues,
    autoRuns: [],
    issueClaims,
    projectId: "prj",
    maxConcurrent: 5,
    requireProjectFields: false,
    nowIso: T0,
  });
  assert.deepEqual(selected.map((i) => i.number), [2, 3], "an active unexpired claim defers the trigger; expired/foreign-project claims do not");

  assert.equal(issueHasActiveClaim({ issueClaims, projectId: "prj", issueNumber: 1, nowIso: T0 }), true);
  assert.equal(issueHasActiveClaim({ issueClaims, projectId: "prj", issueNumber: 3, nowIso: T0 }), false);
});

test("#1143 claims survive restart through the persistence runtime", () => {
  const root = join(tmpdir(), `issue-claims-persist-${process.pid}`);
  rmSync(root, { recursive: true, force: true });
  const projectPath = join(root, "project");
  mkdirSync(projectPath, { recursive: true });
  const stateStorePath = join(root, "state.json");
  const now = makeClock();
  try {
    const first = createServerState({ defaultProjectPath: projectPath, now });
    const { svc } = serviceFor(first.state, now);
    const projectId = first.defaultProject.id;
    svc.claimIssue({ projectId, issueNumber: 7, actor: { userId: "usr_a" } });

    createPersistenceRuntime({
      state: first.state, enabled: true, stateStorePath, schemaVersion: 1, now,
      defaultProject: first.defaultProject, sameProjectPath,
    }).savePersistentState();

    const second = createServerState({ defaultProjectPath: projectPath, now });
    createPersistenceRuntime({
      state: second.state, enabled: true, stateStorePath, schemaVersion: 1, now,
      defaultProject: second.defaultProject, sameProjectPath,
    }).restorePersistentState();

    assert.equal(second.state.issueClaims.length, 1, "the active lease survives a restart");
    assert.equal(second.state.issueClaims[0].claimedBy, "usr_a");
    assert.equal(second.state.issueClaims[0].status, "active");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("#1150 the assignee mirror fires on develop claim/release, never for review, and its failure never breaks the claim", async () => {
  const state = baseState();
  const mirrored = [];
  let id = 0;
  const svc = createIssueClaimService({
    state,
    now: makeClock(),
    nextId: (prefix) => `${prefix}_${++id}`,
    appendEvent: () => {},
    persistStateSoon: () => {},
    mirrorAssignee: async (payload) => {
      mirrored.push(payload);
      throw new Error("gh unavailable"); // fire-and-forget: must be swallowed
    },
  });

  const claimed = svc.claimIssue({ projectId: "projA", issueNumber: 7, actor: { userId: "usr_a" } });
  assert.equal(claimed.ok, true, "a failing mirror never fails the claim");
  assert.deepEqual(mirrored[0], { projectId: "projA", issueNumber: 7, action: "add" });

  svc.claimIssue({ projectId: "projA", issueNumber: 8, actor: { userId: "usr_b" }, mode: "review" });
  assert.equal(mirrored.length, 1, "a review claim is not ownership — no mirror");

  svc.releaseIssueClaim(claimed.claim.id, { actor: { userId: "usr_a" } });
  // Let the fire-and-forget promises settle before asserting.
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(mirrored[1], { projectId: "projA", issueNumber: 7, action: "remove" });
});
