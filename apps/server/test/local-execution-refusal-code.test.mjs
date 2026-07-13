/*
 * Refusal model (#758) Tier-3: the server classifies a desktop-reported
 * local_execution_refused by the PRECISE sub-code the gate declared
 * (evidence.refusalCode), instead of bucketing everything as
 * command_not_allowlisted. Falls back safely for older bridges.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { localExecutionRefusalCode } from "../src/routes/bridge.mjs";

test("prefers the precise refusalCode declared by the gate", () => {
  assert.equal(localExecutionRefusalCode({ refusalCode: "cwd_outside_approved_root" }), "cwd_outside_approved_root");
  assert.equal(localExecutionRefusalCode({ refusalCode: "file_policy_exceeded" }), "file_policy_exceeded");
  assert.equal(localExecutionRefusalCode({ refusalCode: "network_policy_exceeded" }), "network_policy_exceeded");
});

test("ignores a refusalCode that is not a known policy sub-code", () => {
  assert.equal(localExecutionRefusalCode({ refusalCode: "not_a_real_code" }), "command_not_allowlisted");
  assert.equal(localExecutionRefusalCode({ refusalCode: "policy_blocked" }), "command_not_allowlisted", "the recovery category is not a refusal sub-code");
});

test("falls back to a legacy evidence.code, then to command_not_allowlisted", () => {
  assert.equal(localExecutionRefusalCode({ code: "cwd_outside_approved_root" }), "cwd_outside_approved_root");
  assert.equal(localExecutionRefusalCode({}), "command_not_allowlisted");
  assert.equal(localExecutionRefusalCode(), "command_not_allowlisted");
});

test("refusalCode wins over a legacy evidence.code", () => {
  assert.equal(
    localExecutionRefusalCode({ refusalCode: "network_policy_exceeded", code: "cwd_outside_approved_root" }),
    "network_policy_exceeded",
  );
});
