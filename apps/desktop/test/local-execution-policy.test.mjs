import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  createLocalExecutionPolicyManifest,
  mcpLocalExecutionGate,
} from "../src/local-execution-policy.mjs";

function withWorkspace(fn) {
  const root = mkdtempSync(join(tmpdir(), "myagenttool-mcp-gate-"));
  const appRoot = join(root, "doocs-md");
  const outsideRoot = join(root, "outside");
  mkdirSync(join(appRoot, "packages", "mcp-server"), { recursive: true });
  mkdirSync(outsideRoot, { recursive: true });
  writeFileSync(join(appRoot, "packages", "mcp-server", "run.mjs"), "process.exit(0)\n", "utf8");
  writeFileSync(join(outsideRoot, "run.mjs"), "process.exit(0)\n", "utf8");
  try {
    return fn({ root, appRoot, outsideRoot });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function workFor(appRoot) {
  return {
    invocationId: "inv_mcp_gate",
    project: { path: appRoot },
    options: {
      metadata: {
        applicationPath: appRoot,
        projectPath: appRoot,
      },
    },
  };
}

function adapterFor(appRoot, overrides = {}) {
  return {
    type: "mcp",
    transport: "stdio",
    command: "node",
    args: [join(appRoot, "packages", "mcp-server", "run.mjs")],
    cwd: join(appRoot, "packages", "mcp-server"),
    applicationPath: appRoot,
    filePolicy: "read_only",
    networkPolicy: "forbidden",
    ...overrides,
  };
}

test("mcpLocalExecutionGate allows rooted doocs/md stdio MCP node entrypoints", () => {
  withWorkspace(({ appRoot }) => {
    const gate = mcpLocalExecutionGate(workFor(appRoot), adapterFor(appRoot), {
      manifest: createLocalExecutionPolicyManifest(),
    });
    assert.equal(gate.allowed, true, gate.reason);
    assert.equal(gate.evidence.filePolicy, "read_only");
    assert.equal(gate.evidence.networkPolicy, "forbidden");
  });
});

test("mcpLocalExecutionGate refuses MCP stdio entrypoints outside the application root", () => {
  withWorkspace(({ appRoot, outsideRoot }) => {
    const gate = mcpLocalExecutionGate(workFor(appRoot), adapterFor(appRoot, {
      args: [join(outsideRoot, "run.mjs")],
    }), {
      manifest: createLocalExecutionPolicyManifest(),
    });
    assert.equal(gate.allowed, false);
    assert.match(gate.reason, /outside the approved project or application root/);
    assert.equal(gate.evidence.entrypoint, join(outsideRoot, "run.mjs"));
  });
});

test("mcpLocalExecutionGate refuses non-allowlisted commands and policy expansion", () => {
  withWorkspace(({ appRoot }) => {
    const manifest = createLocalExecutionPolicyManifest();
    const commandGate = mcpLocalExecutionGate(workFor(appRoot), adapterFor(appRoot, {
      command: process.platform === "win32" ? "cmd.exe" : "sh",
    }), { manifest });
    assert.equal(commandGate.allowed, false);
    assert.match(commandGate.reason, /non-allowlisted MCP stdio command/);

    const policyGate = mcpLocalExecutionGate(workFor(appRoot), adapterFor(appRoot, {
      networkPolicy: "network",
    }), { manifest });
    assert.equal(policyGate.allowed, false);
    assert.match(policyGate.reason, /policy outside the local allowlist/);
  });
});
