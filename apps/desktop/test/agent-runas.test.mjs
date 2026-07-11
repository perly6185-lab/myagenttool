/*
 * B1b Tier 2 — run-as-restricted-user gating + spawn wrapping. Pure/hermetic,
 * no spawn: the confinement itself is validated in a live soak (see the design doc).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { runAsUser, runAsUserEnabled, shouldRunAsUser, runAsSpawnPlan } from "../src/agent-runas.mjs";

test("runAsUser parses a valid username, rejects blank/malformed/flag-like", () => {
  assert.equal(runAsUser({ MYAGENTTOOL_BRIDGE_RUN_AS_USER: "_myagentrunner" }), "_myagentrunner");
  assert.equal(runAsUser({ MYAGENTTOOL_BRIDGE_RUN_AS_USER: "  runner1 " }), "runner1", "trimmed");
  assert.equal(runAsUser({}), null, "unset -> null (OFF)");
  assert.equal(runAsUser({ MYAGENTTOOL_BRIDGE_RUN_AS_USER: "" }), null);
  assert.equal(runAsUser({ MYAGENTTOOL_BRIDGE_RUN_AS_USER: "bad user!" }), null, "spaces/specials rejected");
  assert.equal(runAsUser({ MYAGENTTOOL_BRIDGE_RUN_AS_USER: "-rf" }), null, "a flag-like value can't be injected as a username");
});

test("runAsUserEnabled reflects a valid username", () => {
  assert.equal(runAsUserEnabled({ MYAGENTTOOL_BRIDGE_RUN_AS_USER: "_r" }), true);
  assert.equal(runAsUserEnabled({}), false);
});

test("shouldRunAsUser gates to real CLI coding agents, POSIX, with a user", () => {
  const cli = { type: "cli", command: "claude" };
  assert.equal(shouldRunAsUser(cli, { user: "_r", platform: "darwin" }), true);
  assert.equal(shouldRunAsUser(cli, { user: null }), false, "no user -> off");
  assert.equal(shouldRunAsUser(cli, { user: "_r", platform: "win32" }), false, "win32 has no sudo -> off");
  assert.equal(shouldRunAsUser({ type: "cli", command: "demo-agent" }, { user: "_r", platform: "darwin" }), false, "demo agent untouched");
  assert.equal(shouldRunAsUser({ type: "http" }, { user: "_r", platform: "darwin" }), false, "non-cli untouched");
  assert.equal(shouldRunAsUser(null, { user: "_r", platform: "darwin" }), false);
});

test("runAsSpawnPlan wraps the command in non-interactive sudo, preserving cwd/env/args", () => {
  const plan = { command: "claude", args: ["-p", "do the thing", "--model", "x"], cwd: "/wt", env: { HOME: "/h" } };
  const w = runAsSpawnPlan(plan, { user: "_myagentrunner" });
  assert.equal(w.command, "sudo");
  assert.deepEqual(w.args, ["-n", "-u", "_myagentrunner", "--", "claude", "-p", "do the thing", "--model", "x"]);
  assert.equal(w.cwd, "/wt", "cwd preserved (sudo runs there)");
  assert.deepEqual(w.env, { HOME: "/h" }, "spawn env preserved (sudo resets the target env itself)");
  assert.equal(w.runAsUser, "_myagentrunner");
});

test("runAsSpawnPlan is a no-op without a user or command", () => {
  const plan = { command: "claude", args: [], cwd: "/wt" };
  assert.equal(runAsSpawnPlan(plan, { user: null }), plan, "no user -> unchanged");
  assert.equal(runAsSpawnPlan(plan, {}), plan);
  const noCmd = { args: [] };
  assert.equal(runAsSpawnPlan(noCmd, { user: "_r" }), noCmd, "no command -> unchanged");
});
