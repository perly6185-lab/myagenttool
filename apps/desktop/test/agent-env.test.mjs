/*
 * B1b Tier 1 — agent env minimization. The security property under test: a coding
 * agent forced onto the minimized env gets the curated non-secret base + operator
 * env ONLY; a bridge secret in process.env is NOT forwarded. Plus the opt-in gate
 * (default off, explicit policies respected, demo/non-CLI untouched).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { agentMinimalBaseEnv, minimizeAgentEnvEnabled, shouldMinimizeAgentEnv } from "../src/agent-env.mjs";

test("agentMinimalBaseEnv: keeps the safe base, drops a bridge secret, merges operator env", () => {
  const source = {
    PATH: "/usr/bin",
    HOME: "/Users/me",
    USER: "me",
    LOGNAME: "me",
    LANG: "en_US.UTF-8",
    MYAGENT_BRIDGE_SECRET: "super-secret-token",
    AWS_SECRET_ACCESS_KEY: "leak-me",
  };
  const env = agentMinimalBaseEnv(source, { MY_OPERATOR_KEY: "v" });

  assert.equal(env.PATH, "/usr/bin", "PATH (allowlisted) kept");
  assert.equal(env.HOME, "/Users/me", "HOME kept — local login state is reached through it");
  assert.equal(env.USER, "me", "USER kept — claude's keychain login lookup needs it (soak finding)");
  assert.equal(env.LOGNAME, "me");
  assert.equal(env.LANG, "en_US.UTF-8");
  assert.equal(env.MYAGENT_BRIDGE_SECRET, undefined, "a bridge-only secret is NOT forwarded");
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined, "an ambient cloud secret is NOT forwarded");
  assert.equal(env.MY_OPERATOR_KEY, "v", "operator-declared env is merged in");
});

test("agentMinimalBaseEnv: operator env wins a collision with the base", () => {
  const env = agentMinimalBaseEnv({ PATH: "/usr/bin" }, { PATH: "/opt/bin" });
  assert.equal(env.PATH, "/opt/bin");
});

test("agentMinimalBaseEnv: only present keys appear (no undefined placeholders)", () => {
  const env = agentMinimalBaseEnv({ HOME: "/h" }, {});
  assert.equal("PATH" in env, false, "an absent allowlist key is not synthesized");
  assert.equal(env.HOME, "/h");
});

test("minimizeAgentEnvEnabled: default off; truthy strings on", () => {
  assert.equal(minimizeAgentEnvEnabled({}), false, "unset => off");
  assert.equal(minimizeAgentEnvEnabled({ MYAGENTTOOL_BRIDGE_MINIMIZE_AGENT_ENV: "0" }), false);
  assert.equal(minimizeAgentEnvEnabled({ MYAGENTTOOL_BRIDGE_MINIMIZE_AGENT_ENV: "1" }), true);
  assert.equal(minimizeAgentEnvEnabled({ MYAGENTTOOL_BRIDGE_MINIMIZE_AGENT_ENV: "true" }), true);
  assert.equal(minimizeAgentEnvEnabled({ MYAGENTTOOL_BRIDGE_MINIMIZE_AGENT_ENV: "on" }), true);
});

test("shouldMinimizeAgentEnv: real CLI agent minimized only when enabled", () => {
  const claude = { type: "cli", command: "claude" };
  assert.equal(shouldMinimizeAgentEnv(claude, { enabled: false }), false, "default off = no change");
  assert.equal(shouldMinimizeAgentEnv(claude, { enabled: true }), true);
  assert.equal(shouldMinimizeAgentEnv({ type: "cli", command: "codex" }, { enabled: true }), true);
});

test("shouldMinimizeAgentEnv: demo-agent and non-CLI adapters are never minimized", () => {
  assert.equal(shouldMinimizeAgentEnv({ type: "cli", command: "demo-agent" }, { enabled: true }), false);
  assert.equal(shouldMinimizeAgentEnv({ type: "mcp", command: "npx" }, { enabled: true }), false);
  assert.equal(shouldMinimizeAgentEnv(null, { enabled: true }), false);
});

test("shouldMinimizeAgentEnv: an explicit/stricter policy is respected (never overridden)", () => {
  for (const environmentPolicy of ["none", "explicit_only", "agent_minimal"]) {
    assert.equal(
      shouldMinimizeAgentEnv({ type: "cli", command: "claude", environmentPolicy }, { enabled: true }),
      false,
      `${environmentPolicy} is left as declared`,
    );
  }
});
