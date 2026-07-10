import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { test } from "node:test";

import { runMcpInvocation } from "../src/mcp-invocation-runner.mjs";
import { createLocalExecutionPolicyManifest } from "../src/local-execution-policy.mjs";

const fixture = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/mcp-echo-server.mjs");
const fixtureRoot = dirname(fixture);

function mcpWork(overrides = {}) {
  return {
    invocationId: "inv_mcp_bridge",
    input: {
      task: "client supplied task should not choose the command",
      command: "must-not-run",
      adapter: { command: "must-not-run" },
    },
    project: { path: fixtureRoot },
    adapter: {
      type: "mcp",
      transport: "stdio",
      command: process.execPath,
      args: [fixture],
      cwd: fixtureRoot,
      applicationPath: fixtureRoot,
      allowedTools: ["echo"],
      filePolicy: "read_only",
      networkPolicy: "forbidden",
      timeoutMs: 5_000,
    },
    options: {
      toolName: "echo",
      toolArguments: { task: "server registered arguments" },
      metadata: {
        applicationPath: fixtureRoot,
        projectPath: fixtureRoot,
      },
    },
    ...overrides,
  };
}

function recorder({ cancelRequested = false } = {}) {
  const calls = [];
  return {
    calls,
    async request(method, path, body) {
      calls.push({ method, path, body });
      if (method === "GET" && path.startsWith("/api/bridge/cancel-status")) {
        return { cancelRequested };
      }
      return null;
    },
    complete() {
      return calls.find((call) => call.method === "POST" && call.path === "/api/bridge/complete")?.body ?? null;
    },
    events(type = null) {
      return calls
        .filter((call) => call.method === "POST" && call.path === "/api/bridge/events")
        .map((call) => call.body)
        .filter((event) => !type || event.type === type);
    },
  };
}

test("MCP bridge runner executes the server-registered adapter and tool arguments", async () => {
  const rec = recorder();
  await runMcpInvocation(mcpWork(), {
    request: rec.request,
    manifest: createLocalExecutionPolicyManifest(),
  });

  const complete = rec.complete();
  assert.equal(complete.status, "succeeded", complete.summary);
  assert.equal(complete.result.toolName, "echo");
  assert.equal(complete.result.output, "echo: server registered arguments");
  assert.ok(rec.events().some((event) => event.message.includes("MCP calling tool echo")));
  assert.ok(rec.events().some((event) => event.message.includes("working on it")));
});

test("MCP bridge runner refuses unsafe stdio adapters before starting the client", async () => {
  const rec = recorder();
  let clientCalled = false;
  await runMcpInvocation(mcpWork({
    adapter: {
      ...mcpWork().adapter,
      command: process.platform === "win32" ? "cmd.exe" : "sh",
    },
  }), {
    request: rec.request,
    manifest: createLocalExecutionPolicyManifest(),
    clientFn: async () => {
      clientCalled = true;
      return { status: "succeeded", summary: "should not run", result: null };
    },
  });

  const complete = rec.complete();
  assert.equal(clientCalled, false);
  assert.equal(complete.status, "failed");
  assert.equal(complete.result.policyDecision, "local_execution_refused");
  assert.equal(rec.events("local_execution_refused").length, 1);
});

test("MCP bridge runner completes timed out client outcomes", async () => {
  const rec = recorder();
  await runMcpInvocation(mcpWork(), {
    request: rec.request,
    manifest: createLocalExecutionPolicyManifest(),
    gateFn: () => ({ allowed: true, reason: "test gate allowed", evidence: {} }),
    clientFn: async () => ({
      status: "timed_out",
      summary: "MCP request tools/call timed out.",
      result: null,
    }),
  });

  const complete = rec.complete();
  assert.equal(complete.status, "timed_out");
  assert.match(complete.summary, /timed out/);
});
