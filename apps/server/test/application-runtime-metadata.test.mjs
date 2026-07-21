/*
 * Stage 2 (#1342): legacy Application descriptors persisted before the dual-layer
 * model gain executionScope + catalog-derived runtimeRequirements on load, without
 * rewriting descriptors that already carry them.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { backfillApplicationRuntimeMetadata } from "../src/services/applications.mjs";

test("backfills executionScope + catalog-derived runtimeRequirements onto a legacy descriptor", () => {
  const apps = [{ id: "app_git", name: "Git" }]; // persisted before the dual-layer model
  backfillApplicationRuntimeMetadata(apps);
  assert.equal(apps[0].executionScope, "local");
  assert.deepEqual(apps[0].runtimeRequirements, [{ runtimeId: "runtime_git", required: true }]);
});

test("is idempotent + additive — a descriptor that already carries the fields is untouched", () => {
  const existing = { id: "app_git", executionScope: "local", runtimeRequirements: [] }; // explicitly empty
  backfillApplicationRuntimeMetadata([existing]);
  assert.deepEqual(existing.runtimeRequirements, [], "an explicit [] is preserved, never re-derived");

  // Only a MISSING field is filled — a half-migrated descriptor gets just the gap.
  const half = { id: "app_ccusage", executionScope: "local" };
  backfillApplicationRuntimeMetadata([half]);
  assert.deepEqual(half.runtimeRequirements, [{ runtimeId: "runtime_ccusage", required: true }]);
});

test("a custom Application with no known runtime backfills to executionScope local + []", () => {
  const apps = [{ id: "app_custom_xyz", name: "Custom" }];
  backfillApplicationRuntimeMetadata(apps);
  assert.equal(apps[0].executionScope, "local");
  assert.deepEqual(apps[0].runtimeRequirements, []);
});

test("tolerates a non-array / malformed entries without throwing", () => {
  assert.doesNotThrow(() => backfillApplicationRuntimeMetadata());
  assert.doesNotThrow(() => backfillApplicationRuntimeMetadata([null, 5, "x", {}]));
});
