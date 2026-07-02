/*
 * End-to-end tests for the bridge's live MCP client against a fixture MCP
 * server (newline-delimited JSON-RPC over stdio). Covers the happy path,
 * notification forwarding, tool resolution, allowlist enforcement, spawn
 * failure, cancellation, and the health probe.
 */

import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { test } from "node:test";

import { callMcpTool, probeMcpServer } from "../src/mcp-client.mjs";

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
