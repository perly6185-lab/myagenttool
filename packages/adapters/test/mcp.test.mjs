/*
 * Unit tests for the MCP adapter slice: capability contract, config
 * normalization/validation, and the tools/call request descriptor + allowlist.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { MCP_ADAPTER_CONTRACT, describeMcpToolCall, normalizeMcpAdapterConfig } from "../src/mcp.mjs";

test("contract: MCP supports success/failure/cancellation/event streaming over stdio + http", () => {
  assert.equal(MCP_ADAPTER_CONTRACT.kind, "mcp");
  assert.equal(MCP_ADAPTER_CONTRACT.cancellation, "supported");
  assert.equal(MCP_ADAPTER_CONTRACT.streamsEvents, true);
  assert.deepEqual([...MCP_ADAPTER_CONTRACT.transports], ["stdio", "http"]);
});

test("normalize stdio: command required, args + defaults applied", () => {
  const c = normalizeMcpAdapterConfig({ transport: "stdio", command: "mcp-fs", args: ["--root", "/x"] });
  assert.equal(c.transport, "stdio");
  assert.equal(c.command, "mcp-fs");
  assert.deepEqual(c.args, ["--root", "/x"]);
  assert.equal(c.timeoutMs, 60_000);
  assert.deepEqual(c.allowedTools, []);
  assert.throws(() => normalizeMcpAdapterConfig({ transport: "stdio" }), /requires a command/);
});

test("normalize http: valid url required, headers preserved, timeout clamped", () => {
  const c = normalizeMcpAdapterConfig({
    transport: "http",
    url: "https://mcp.example/sse",
    headers: { authorization: "Bearer x" },
    timeoutMs: 10,
    allowedTools: ["search", " read "],
  });
  assert.equal(c.url, "https://mcp.example/sse");
  assert.equal(c.headers.authorization, "Bearer x");
  assert.equal(c.timeoutMs, 1_000, "timeout clamped to the minimum");
  assert.deepEqual(c.allowedTools, ["search", "read"]);
  assert.throws(() => normalizeMcpAdapterConfig({ transport: "http", url: "not-a-url" }), /valid http/);
});

test("normalize: unknown transport is rejected", () => {
  assert.throws(() => normalizeMcpAdapterConfig({ transport: "grpc" }), /transport must be one of/);
});

test("describeMcpToolCall: builds a JSON-RPC tools/call descriptor", () => {
  const cfg = normalizeMcpAdapterConfig({ transport: "stdio", command: "mcp-fs" });
  const req = describeMcpToolCall(cfg, "read_file", { path: "/x" });
  assert.deepEqual(req, {
    jsonrpc: "2.0",
    method: "tools/call",
    params: { name: "read_file", arguments: { path: "/x" } },
  });
  assert.equal(req.id, undefined, "the bridge assigns the JSON-RPC id, not the descriptor");
});

test("describeMcpToolCall: enforces the allowlist and requires a tool name", () => {
  const cfg = normalizeMcpAdapterConfig({ transport: "stdio", command: "mcp-fs", allowedTools: ["read_file"] });
  assert.doesNotThrow(() => describeMcpToolCall(cfg, "read_file"));
  assert.throws(() => describeMcpToolCall(cfg, "delete_everything"), /not in the adapter's allowed tools/);
  assert.throws(() => describeMcpToolCall(cfg, ""), /tool name is required/);
});
