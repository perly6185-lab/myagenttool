import assert from "node:assert/strict";
import { test } from "node:test";

import {
  refusalCategories,
  refusalCodes,
  refusalCodesByCategory,
  refusalEventCatalog,
  loopEventTypes,
} from "../src/index.mjs";

test("categories are the four in evaluation order", () => {
  assert.deepEqual(refusalCategories, ["not_granted", "policy", "state", "human"]);
});

test("the code enum is closed and each code belongs to exactly one category", () => {
  const seen = new Set();
  for (const category of refusalCategories) {
    for (const code of refusalCodesByCategory[category]) {
      assert.ok(refusalCodes.includes(code), `${code} not in closed enum`);
      assert.ok(!seen.has(code), `${code} appears in more than one category`);
      seen.add(code);
    }
  }
  // Partition is total: no code is left uncategorised.
  for (const code of refusalCodes) {
    assert.ok(seen.has(code), `${code} not assigned to a category`);
  }
  assert.equal(seen.size, refusalCodes.length);
});

test("capability_not_granted exists but is only reached via the reserved permission_denied", () => {
  assert.ok(refusalCodes.includes("capability_not_granted"));
  const reachable = refusalEventCatalog.filter((e) => e.code === "capability_not_granted");
  assert.equal(reachable.length, 1);
  assert.equal(reachable[0].eventType, "permission_denied");
  assert.equal(reachable[0].reserved, true, "not surfaced to a requester until Phase 4");
});

test("no code is minted for concurrency-cap queuing (it is not a refusal)", () => {
  const banned = refusalCodes.filter((c) => /queue|concurren|capacity|at_cap|busy/i.test(c));
  assert.deepEqual(banned, [], "queuing at the concurrency cap must not have a refusal code");
  const bannedCatalog = refusalEventCatalog.filter((e) => /queue|concurren|capacity/i.test(e.eventType));
  assert.deepEqual(bannedCatalog, []);
});

test("every catalog entry maps to a valid (category, code) from the closed taxonomy", () => {
  for (const entry of refusalEventCatalog) {
    assert.ok(refusalCategories.includes(entry.category), `${entry.eventType}: bad category`);
    assert.ok(refusalCodes.includes(entry.code), `${entry.eventType}: bad code`);
    assert.ok(
      refusalCodesByCategory[entry.category].includes(entry.code),
      `${entry.eventType}: ${entry.category}/${entry.code} disagree with the map`,
    );
  }
});

test("the evaluation-order invariant is expressible: not_granted precedes state", () => {
  // An ungranted + over-budget request must report not_granted, never over_budget.
  const notGrantedIdx = refusalCategories.indexOf("not_granted");
  const stateIdx = refusalCategories.indexOf("state");
  assert.ok(notGrantedIdx < stateIdx);
  assert.equal(
    refusalCodesByCategory.not_granted.includes("over_budget"),
    false,
    "over_budget is a state refusal, evaluated after not_granted",
  );
});

test("every loop refusal event in the protocol vocabulary is mapped", () => {
  const mapped = new Set(refusalEventCatalog.map((e) => e.eventType));
  const loopRefusals = loopEventTypes.filter((t) => /_refused$/.test(t) || /_blocked$/.test(t));
  assert.ok(loopRefusals.length >= 13, "sanity: the promotion pipeline has many refusal stages");
  for (const eventType of loopRefusals) {
    assert.ok(mapped.has(eventType), `unmapped loop refusal event: ${eventType}`);
  }
});

test("all 30 documented refusal event types / error codes are covered", () => {
  // The full inventory from docs/vision/REFUSAL_MODEL.md. If a name here is not in
  // the catalog, the taxonomy is incomplete; if the catalog grows a name absent
  // here, this list (and the design table) must be updated deliberately.
  const expected = [
    "bridge_delivery_refused",
    "bridge_lifecycle_refused",
    "bridge_operation_refused",
    "delivery_refused",
    "device_dispatch_blocked",
    "project_remove_blocked",
    "local_execution_refused",
    "policy_blocked",
    "application_orchestration_recovery_action_rejected",
    "recovery_action_blocked",
    "lifecycle_gate_blocked",
    "rollback_gate_blocked",
    "loop_worktree_promotion_pr_merge_prep_blocked",
    "invocation_rejected",
    "local_approval_denied",
    "codex_approval_denied",
    "auto_run_denied",
    "permission_denied",
    "auto_run_design_rejected",
    "auto_run_decomposition_rejected",
    "loop_human_gate_rejected",
    "loop_worktree_cleanup_refused",
    "loop_worktree_promotion_refused",
    "loop_worktree_promotion_apply_refused",
    "loop_worktree_promotion_verify_refused",
    "loop_worktree_promotion_pr_prep_refused",
    "loop_worktree_promotion_commit_refused",
    "loop_worktree_promotion_push_plan_refused",
    "loop_worktree_promotion_push_preflight_refused",
    "loop_worktree_promotion_push_execute_refused",
    "loop_worktree_promotion_pr_create_prep_refused",
    "loop_worktree_promotion_pr_create_execute_refused",
    "loop_worktree_promotion_pr_merge_prep_refused",
    "loop_worktree_promotion_pr_merge_execute_refused",
  ];
  const mapped = new Set(refusalEventCatalog.map((e) => e.eventType));
  for (const name of expected) {
    assert.ok(mapped.has(name), `expected refusal event not mapped: ${name}`);
  }
});

test("umbrella events map each reason to exactly one code", () => {
  // local_execution_refused refuses for four distinct policy reasons; each maps
  // to its own code, and none is dropped.
  const localExec = refusalEventCatalog.filter((e) => e.eventType === "local_execution_refused");
  assert.deepEqual(
    localExec.map((e) => e.code).sort(),
    ["command_not_allowlisted", "cwd_outside_approved_root", "file_policy_exceeded", "network_policy_exceeded"].sort(),
  );
  for (const e of localExec) assert.equal(e.category, "policy");

  // invocation_rejected spans two categories (state gates + a human denial).
  const invRejected = refusalEventCatalog.filter((e) => e.eventType === "invocation_rejected");
  assert.deepEqual(
    invRejected.map((e) => `${e.category}/${e.code}`).sort(),
    ["human/approval_denied", "state/over_budget", "state/over_quota"].sort(),
  );
});
