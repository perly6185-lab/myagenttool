import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(new URL("../src/server.mjs", import.meta.url));

test("MCP server advertises only probe and draft sync tools", async (t) => {
  const child = spawn(process.execPath, [serverPath], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => child.kill());
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
  const replies = await readReplies(child, 2);
  assert.equal(replies[0].result.serverInfo.name, "myagenttool-wechat-official");
  assert.deepEqual(replies[1].result.tools.map((tool) => tool.name), ["wechat_official_probe", "wechat_official_draft_sync"]);
  assert.ok(replies[1].result.tools.every((tool) => !tool.name.includes("publish")));
});

function readReplies(child, count) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const replies = [];
    const timeout = setTimeout(() => reject(new Error("MCP response timeout")), 5_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        replies.push(JSON.parse(line));
        if (replies.length === count) {
          clearTimeout(timeout);
          resolve(replies);
        }
      }
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (replies.length < count) reject(new Error(`MCP server exited early (${code})`));
    });
  });
}
