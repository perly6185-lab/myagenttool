/*
 * #890 — Budget reservations (concurrent spend admission).
 *
 * The pre-#890 budget check read only FINALIZED ledger spend, and a run's spend
 * is recorded at completion — so N runs starting near a limit all read the same
 * pre-spend total, all pass, then all spend (a project with a $10 budget and $0
 * spent admitted unbounded concurrency). A reservation is a synchronous hold
 * placed at admission that a concurrent admission sees; it is released when the
 * run settles. These tests prove the atomic reserve/commit/release semantics, the
 * team-pool gate, the leaked-hold reconcile, and survival across restart.
 *
 * Run: node --test test/budget-reservations.test.mjs (from apps/server).
 */

import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createPersistenceRuntime } from "../src/runtime/persistence.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import { createM3Service } from "../src/services/m3.mjs";
import { sameProjectPath } from "../src/services/projects.mjs";

const now = () => "2026-07-14T00:00:00.000Z";

function m3For(state) {
  let id = 0;
  return createM3Service({
    state,
    now,
    nextId: (prefix) => `${prefix}_${++id}`,
    appendEvent: () => {},
    findAgent: () => null,
  });
}

/** State with two projects (projA/projB) under team_a, no budgets by default. */
function baseState() {
  return {
    users: [{ id: "usr_a", teamId: "team_a" }],
    teams: [{ id: "team_a", name: "A" }],
    projects: [
      { id: "projA", name: "A", ownerTeamId: "team_a" },
      { id: "projB", name: "B", ownerTeamId: "team_a" },
    ],
    budgets: [],
    budgetReservations: [],
    ledgerEntries: [],
  };
}

test("#890 two admissions near the limit cannot jointly exceed a block budget", () => {
  const state = baseState();
  const m3 = m3For(state);
  m3.upsertBudget({ projectId: "projA", limitUsd: 10, policy: "block" });

  const first = m3.reserveBudget({ projectId: "projA", amountUsd: 6, autoRunId: "aur_1" });
  assert.equal(first.ok, true, "first run reserves $6 of $10");

  const second = m3.reserveBudget({ projectId: "projA", amountUsd: 6, autoRunId: "aur_2" });
  assert.equal(second.ok, false, "second run would reach $12 > $10 → refused");
  assert.match(second.reason, /would be exceeded/);

  // Only the first hold exists; the refused one wrote nothing.
  assert.equal((state.budgetReservations ?? []).filter((r) => r.status === "active").length, 1);
  const status = m3.budgetStatusFor("projA");
  assert.equal(status.reservedUsd, 6);
  assert.equal(status.admissionUsd, 6);
  assert.equal(status.spentUsd, 0, "no real spend yet — the hold is not finalized spend");
});

test("#890 a non-positive amount, or a warn/no budget, never refuses (no invented block)", () => {
  const state = baseState();
  const m3 = m3For(state);
  // No budget at all.
  assert.equal(m3.reserveBudget({ projectId: "projA", amountUsd: 1000, autoRunId: "a" }).ok, true);
  // Warn budget never blocks.
  m3.upsertBudget({ projectId: "projB", limitUsd: 1, policy: "warn" });
  assert.equal(m3.reserveBudget({ projectId: "projB", amountUsd: 1000, autoRunId: "b" }).ok, true);
  // Zero amount against a block budget is accounting-only (never refuses).
  m3.upsertBudget({ projectId: "projA", limitUsd: 1, policy: "block" });
  assert.equal(m3.reserveBudget({ projectId: "projA", amountUsd: 0, autoRunId: "c" }).ok, true);
});

test("#890 releasing a hold frees the budget for the next admission", () => {
  const state = baseState();
  const m3 = m3For(state);
  m3.upsertBudget({ projectId: "projA", limitUsd: 10, policy: "block" });

  const first = m3.reserveBudget({ projectId: "projA", amountUsd: 6, autoRunId: "aur_1" });
  assert.equal(m3.reserveBudget({ projectId: "projA", amountUsd: 6, autoRunId: "aur_2" }).ok, false);

  // Release the first, then the next $6 fits.
  assert.equal(m3.releaseBudgetReservation(first.reservationId, { outcome: "committed" }), true);
  assert.equal(m3.releaseBudgetReservation(first.reservationId), false, "release is idempotent");
  assert.equal(m3.budgetStatusFor("projA").reservedUsd, 0);
  assert.equal(m3.reserveBudget({ projectId: "projA", amountUsd: 6, autoRunId: "aur_3" }).ok, true);
});

test("#890 budgetStatusFor exposes reservedUsd + admissionOver without inflating spentUsd/over", () => {
  const state = baseState();
  // $5 already finalized against a $10 block budget.
  state.ledgerEntries.push({ id: "led_1", projectId: "projA", amountUsd: 5, status: "finalized" });
  const m3 = m3For(state);
  m3.upsertBudget({ projectId: "projA", limitUsd: 10, policy: "block" });

  // Reserve $6 → finalized $5 + hold $6 = $11 admission > $10.
  assert.equal(m3.reserveBudget({ projectId: "projA", amountUsd: 6, autoRunId: "aur_1" }).ok, false, "over the limit incl the hold");
  // A $4 hold fits ($5 + $4 = $9).
  assert.equal(m3.reserveBudget({ projectId: "projA", amountUsd: 4, autoRunId: "aur_1" }).ok, true);
  const s = m3.budgetStatusFor("projA");
  assert.equal(s.spentUsd, 5, "display spend is finalized-only");
  assert.equal(s.over, false, "finalized $5 is under $10");
  assert.equal(s.reservedUsd, 4);
  assert.equal(s.admissionUsd, 9);
  assert.equal(s.admissionOver, false);
});

test("#890 releaseReservationsForAutoRun frees every hold a run placed", () => {
  const state = baseState();
  const m3 = m3For(state);
  m3.upsertBudget({ projectId: "projA", limitUsd: 100, policy: "block" });
  m3.reserveBudget({ projectId: "projA", amountUsd: 3, autoRunId: "aur_1" });
  m3.reserveBudget({ projectId: "projA", amountUsd: 4, autoRunId: "aur_1" }); // e.g. a self-repair re-reserve
  m3.reserveBudget({ projectId: "projA", amountUsd: 5, autoRunId: "aur_2" });
  assert.equal(m3.budgetStatusFor("projA").reservedUsd, 12);

  const released = m3.releaseReservationsForAutoRun("aur_1", { outcome: "committed" });
  assert.equal(released, 2);
  assert.equal(m3.budgetStatusFor("projA").reservedUsd, 5, "only aur_2's hold remains");
});

test("#890 reconcileBudgetReservations releases holds for settled/missing runs, keeps active ones", () => {
  const state = baseState();
  const m3 = m3For(state);
  m3.upsertBudget({ projectId: "projA", limitUsd: 100, policy: "block" });
  m3.reserveBudget({ projectId: "projA", amountUsd: 2, autoRunId: "aur_active" });
  m3.reserveBudget({ projectId: "projA", amountUsd: 2, autoRunId: "aur_settled" });
  m3.reserveBudget({ projectId: "projA", amountUsd: 2, autoRunId: "aur_gone" }); // no such run record

  const settled = new Set(["aur_settled"]); // aur_active is running; aur_gone has no record
  const runs = new Set(["aur_active", "aur_settled"]);
  const released = m3.reconcileBudgetReservations({
    isSettled: (id) => !runs.has(id) || settled.has(id),
  });
  assert.equal(released, 2, "settled + missing holds released");
  assert.equal(m3.budgetStatusFor("projA").reservedUsd, 2, "the active run keeps its hold");
});

test("#890 a team pool block budget gates admissions across its projects", () => {
  const state = baseState();
  const m3 = m3For(state);
  m3.upsertBudget({ teamId: "team_a", limitUsd: 10, policy: "block" });
  assert.equal(m3.reserveBudget({ projectId: "projA", amountUsd: 6, autoRunId: "aur_1" }).ok, true);
  // projB is a DIFFERENT project but the SAME team pool — the second $6 would
  // push the pool to $12 > $10.
  const second = m3.reserveBudget({ projectId: "projB", amountUsd: 6, autoRunId: "aur_2" });
  assert.equal(second.ok, false);
  assert.match(second.reason, /Team budget/);
});

test("#890 reservations survive a save→restore and still gate admission (ties #891)", () => {
  const root = join(tmpdir(), `myagenttool-bres-persist-${Date.now()}`);
  const projectPath = join(root, "project");
  const stateStorePath = join(root, "state", "snapshot.json");
  mkdirSync(projectPath, { recursive: true });
  try {
    const first = createServerState({ defaultProjectPath: projectPath, now });
    const projectId = first.defaultProject.id;
    const m3a = m3For(first.state);
    m3a.upsertBudget({ projectId, limitUsd: 10, policy: "block" });
    const held = m3a.reserveBudget({ projectId, amountUsd: 7, autoRunId: "aur_1" });
    assert.equal(held.ok, true);

    createPersistenceRuntime({
      state: first.state, enabled: true, stateStorePath, schemaVersion: 1, now,
      defaultProject: first.defaultProject, sameProjectPath,
    }).savePersistentState();

    const second = createServerState({ defaultProjectPath: projectPath, now });
    createPersistenceRuntime({
      state: second.state, enabled: true, stateStorePath, schemaVersion: 1, now,
      defaultProject: second.defaultProject, sameProjectPath,
    }).restorePersistentState();

    const m3b = m3For(second.state);
    assert.equal(m3b.budgetStatusFor(projectId).reservedUsd, 7, "the hold survives restart");
    // A $4 admission after restore would reach $11 > $10 — still refused.
    assert.equal(m3b.reserveBudget({ projectId, amountUsd: 4, autoRunId: "aur_2" }).ok, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
