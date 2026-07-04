/*
 * WS3 bridge-trust deepening: a spawned MCP server (often a third-party npm
 * package) must NOT inherit the bridge's full environment — that would leak
 * every secret/token in the bridge process to untrusted code. buildMcpChildEnv
 * passes only a curated non-secret base plus operator-configured env.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { buildMcpChildEnv } from "../src/mcp-client.mjs";

test("scoped env excludes bridge secrets, keeps run essentials, merges operator env", () => {
  const savedSecret = process.env.MYAGENT_BRIDGE_SECRET;
  const savedPath = process.env.PATH;
  try {
    process.env.MYAGENT_BRIDGE_SECRET = "super-secret-token";
    process.env.PATH = "/usr/bin:/bin";

    const env = buildMcpChildEnv({ command: "npx", env: { MCP_ROOT: "/data" } });

    assert.equal(env.MYAGENT_BRIDGE_SECRET, undefined, "a bridge-only secret is NOT forwarded to the MCP child");
    assert.equal(env.PATH, "/usr/bin:/bin", "PATH is forwarded so the server can be found/run");
    assert.equal(env.MCP_ROOT, "/data", "operator-configured env is merged in");
  } finally {
    if (savedSecret === undefined) delete process.env.MYAGENT_BRIDGE_SECRET;
    else process.env.MYAGENT_BRIDGE_SECRET = savedSecret;
    process.env.PATH = savedPath;
  }
});

test("no adapter env is fine; only the safe base is passed", () => {
  const env = buildMcpChildEnv({ command: "npx" });
  assert.equal(typeof env, "object");
  // Nothing outside the safe allowlist leaks in (only keys present in the base).
  assert.equal(env.MYAGENT_BRIDGE_SECRET, undefined);
});

test("operator env overrides a base key deterministically", () => {
  const saved = process.env.TZ;
  try {
    process.env.TZ = "UTC";
    const env = buildMcpChildEnv({ command: "npx", env: { TZ: "America/New_York" } });
    assert.equal(env.TZ, "America/New_York", "explicit operator env wins over the inherited base");
  } finally {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  }
});
