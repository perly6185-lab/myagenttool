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
  const savedAppData = process.env.APPDATA;
  try {
    process.env.MYAGENT_BRIDGE_SECRET = "super-secret-token";
    process.env.PATH = "/usr/bin:/bin";
    process.env.APPDATA = "C:\\Users\\person\\Redirected\\Roaming";

    const env = buildMcpChildEnv({ command: "npx", env: { MCP_ROOT: "/data" } });

    assert.equal(env.MYAGENT_BRIDGE_SECRET, undefined, "a bridge-only secret is NOT forwarded to the MCP child");
    assert.equal(env.PATH, "/usr/bin:/bin", "PATH is forwarded so the server can be found/run");
    assert.equal(env.APPDATA, "C:\\Users\\person\\Redirected\\Roaming", "the mail runtime keeps the non-secret Windows credential base path");
    assert.equal(env.MCP_ROOT, "/data", "operator-configured env is merged in");
  } finally {
    if (savedSecret === undefined) delete process.env.MYAGENT_BRIDGE_SECRET;
    else process.env.MYAGENT_BRIDGE_SECRET = savedSecret;
    process.env.PATH = savedPath;
    if (savedAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = savedAppData;
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

test("Electron-as-Node is added only for the exact shell-owned mail runtime", () => {
  const keys = ["MYAGENTTOOL_MAIL_MCP_ENTRY", "MYAGENTTOOL_MAIL_MCP_NODE", "MYAGENTTOOL_MAIL_MCP_ELECTRON_RUN_AS_NODE"];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.MYAGENTTOOL_MAIL_MCP_ENTRY = "C:\\app\\tools\\mail-mcp\\src\\server.mjs";
    process.env.MYAGENTTOOL_MAIL_MCP_NODE = "C:\\app\\MyAgentTool.exe";
    process.env.MYAGENTTOOL_MAIL_MCP_ELECTRON_RUN_AS_NODE = "1";
    const trusted = buildMcpChildEnv({ command: "C:\\app\\MyAgentTool.exe", args: ["C:\\app\\tools\\mail-mcp\\src\\server.mjs"] });
    const otherEntry = buildMcpChildEnv({ command: "C:\\app\\MyAgentTool.exe", args: ["C:\\other\\server.mjs"] });
    const otherCommand = buildMcpChildEnv({ command: "C:\\other\\electron.exe", args: ["C:\\app\\tools\\mail-mcp\\src\\server.mjs"] });
    assert.equal(trusted.ELECTRON_RUN_AS_NODE, "1");
    assert.equal(otherEntry.ELECTRON_RUN_AS_NODE, undefined);
    assert.equal(otherCommand.ELECTRON_RUN_AS_NODE, undefined);
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});

test("Electron-as-Node also trusts only the exact shell-owned WeChat runtime", () => {
  const keys = [
    "MYAGENTTOOL_WECHAT_OFFICIAL_MCP_ENTRY",
    "MYAGENTTOOL_WECHAT_OFFICIAL_MCP_NODE",
    "MYAGENTTOOL_WECHAT_OFFICIAL_MCP_ELECTRON_RUN_AS_NODE",
  ];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.MYAGENTTOOL_WECHAT_OFFICIAL_MCP_ENTRY = "C:\\app\\tools\\wechat-official-site\\src\\server.mjs";
    process.env.MYAGENTTOOL_WECHAT_OFFICIAL_MCP_NODE = "C:\\app\\MyAgentTool.exe";
    process.env.MYAGENTTOOL_WECHAT_OFFICIAL_MCP_ELECTRON_RUN_AS_NODE = "1";
    const trusted = buildMcpChildEnv({
      command: "C:\\app\\MyAgentTool.exe",
      args: ["C:\\app\\tools\\wechat-official-site\\src\\server.mjs"],
    });
    const unrelated = buildMcpChildEnv({ command: "C:\\app\\MyAgentTool.exe", args: ["C:\\other\\server.mjs"] });
    assert.equal(trusted.ELECTRON_RUN_AS_NODE, "1");
    assert.equal(unrelated.ELECTRON_RUN_AS_NODE, undefined);
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});
