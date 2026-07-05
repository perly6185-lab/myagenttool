/*
 * End-to-end tests for the bridge's live MCP client against a fixture MCP
 * server (newline-delimited JSON-RPC over stdio). Covers the happy path,
 * notification forwarding, tool resolution, allowlist enforcement, spawn
 * failure, cancellation, and the health probe.
 */

import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { after, test } from "node:test";

import { callMcpTool, mcpHandshakeTimeoutMs, probeMcpServer } from "../src/mcp-client.mjs";

const fixture = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/mcp-echo-server.mjs");

const echoAdapter = (extra = {}) => ({
  kind: "mcp",
  transport: "stdio",
  command: process.execPath,
  args: [fixture],
  allowedTools: [],
  timeoutMs: 5_000,
  ...extra,
});

test("mcpHandshakeTimeoutMs: slow-start servers can use the adapter timeout budget", () => {
  assert.equal(mcpHandshakeTimeoutMs({}), 10_000);
  assert.equal(mcpHandshakeTimeoutMs({ timeoutMs: 60_000 }), 60_000);
  assert.equal(mcpHandshakeTimeoutMs({ timeoutMs: 60_000, startupTimeoutMs: 120_000 }), 120_000);
  assert.equal(mcpHandshakeTimeoutMs({ timeoutMs: 1_000 }), 10_000);
});

test("happy path: handshake, single-tool default, echo result, notification forwarded", async () => {
  const events = [];
  const outcome = await callMcpTool({
    adapter: echoAdapter(),
    task: "hello world",
    onEvent: (e) => events.push(e),
  });
  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.result.toolName, "echo");
  assert.equal(outcome.result.output, "echo: hello world");
  assert.ok(events.some((e) => e.message.includes("working on it")), "server log notification is forwarded");
});

test("tool resolution: two tools with no toolName is an explicit error; explicit toolName works", async () => {
  const ambiguous = await callMcpTool({ adapter: echoAdapter({ args: [fixture, "--two-tools"] }), task: "x" });
  assert.equal(ambiguous.status, "failed");
  assert.match(ambiguous.summary, /set toolName/);

  const explicit = await callMcpTool({
    adapter: echoAdapter({ args: [fixture, "--two-tools"] }),
    task: "x",
    options: { toolName: "echo" },
  });
  assert.equal(explicit.status, "succeeded");
});

test("allowlist: a tool outside allowedTools is refused by the shared descriptor", async () => {
  const outcome = await callMcpTool({
    adapter: echoAdapter({ allowedTools: ["other"], args: [fixture, "--two-tools"] }),
    task: "x",
    options: { toolName: "echo" },
  });
  assert.equal(outcome.status, "failed");
  assert.match(outcome.summary, /not in the adapter's allowed tools/);
});

test("spawn failure: a missing command fails with a clear summary", async () => {
  const outcome = await callMcpTool({
    adapter: echoAdapter({ command: "/nonexistent/mcp-server-xyz", args: [] }),
    task: "x",
  });
  assert.equal(outcome.status, "failed");
  assert.match(outcome.summary, /could not start|failed/i);
});

test("cancellation: a hung tools/call is cancelled when shouldCancel flips", async () => {
  let cancel = false;
  setTimeout(() => (cancel = true), 300);
  const outcome = await callMcpTool({
    adapter: echoAdapter({ args: [fixture, "--slow"], timeoutMs: 10_000 }),
    task: "x",
    shouldCancel: () => cancel,
  });
  assert.equal(outcome.status, "cancelled");
});

test("timeout: a hung tools/call times out at the adapter timeout", async () => {
  const outcome = await callMcpTool({
    adapter: echoAdapter({ args: [fixture, "--slow"], timeoutMs: 1_000 }),
    task: "x",
  });
  assert.equal(outcome.status, "timed_out");
});

test("probeMcpServer: healthy against the fixture, unhealthy against a bad command", async () => {
  const ok = await probeMcpServer(echoAdapter());
  assert.equal(ok.ok, true);
  assert.match(ok.message, /1 tool\(s\): echo/);

  const bad = await probeMcpServer(echoAdapter({ command: "/nonexistent/mcp-server-xyz", args: [] }));
  assert.equal(bad.ok, false);
});

// --- Streamable-HTTP transport ---

import { spawn as spawnProc } from "node:child_process";
import { normalizeMcpAdapterConfig } from "@myagenttool/adapters/mcp";

const httpFixture = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/mcp-http-server.mjs");
const httpServers = [];
async function startHttpFixture(...flags) {
  const child = spawnProc(process.execPath, [httpFixture, ...flags], { stdio: ["ignore", "pipe", "pipe"] });
  httpServers.push(child);
  const port = await new Promise((resolvePort, reject) => {
    child.stdout.on("data", (chunk) => {
      const match = chunk.toString("utf8").match(/LISTENING (\d+)/);
      if (match) resolvePort(Number(match[1]));
    });
    child.on("error", reject);
    setTimeout(() => reject(new Error("http fixture did not start")), 5_000);
  });
  return normalizeMcpAdapterConfig({ transport: "http", url: `http://127.0.0.1:${port}/`, timeoutMs: 5_000 });
}
// Kill fixture servers in after() — a live child's handles keep the test
// process's event loop alive, so process.on("exit") would never fire (hang).
after(() => {
  for (const child of httpServers) child.kill("SIGTERM");
});

test("http transport: handshake echoes the session id and the tool call succeeds (JSON mode)", async () => {
  const adapter = await startHttpFixture();
  const outcome = await callMcpTool({ adapter, task: "hello http" });
  assert.equal(outcome.status, "succeeded", outcome.summary);
  assert.equal(outcome.result.output, "echo: hello http");
});

test("http transport: an SSE tools/call reply is consumed and notifications forwarded", async () => {
  const adapter = await startHttpFixture("--sse");
  const events = [];
  const outcome = await callMcpTool({ adapter, task: "hello sse", onEvent: (e) => events.push(e) });
  assert.equal(outcome.status, "succeeded", outcome.summary);
  assert.equal(outcome.result.output, "echo: hello sse");
  assert.ok(events.some((e) => e.message.includes("http working")), "SSE notification frames become events");
});

test("http transport: a hung call is cancelled promptly via abort", async () => {
  const adapter = await startHttpFixture("--slow");
  let cancel = false;
  setTimeout(() => (cancel = true), 300);
  const outcome = await callMcpTool({ adapter, task: "x", shouldCancel: () => cancel });
  assert.equal(outcome.status, "cancelled");
});

test("http transport: probe is healthy against the fixture, unhealthy against a dead port", async () => {
  const ok = await probeMcpServer(await startHttpFixture());
  assert.equal(ok.ok, true, ok.message);
  assert.match(ok.message, /echo/);
  const bad = await probeMcpServer(normalizeMcpAdapterConfig({ transport: "http", url: "http://127.0.0.1:1/", timeoutMs: 2_000 }));
  assert.equal(bad.ok, false);
});
