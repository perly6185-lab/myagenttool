import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import {
  createLocalExecutionPolicyManifest,
  localExecutionGate,
  localPolicyForAdapter,
} from "../src/local-execution-policy.mjs";

const cwd = tmpdir();
const demoAgentPath = resolve("apps/desktop/src/demo-agent.mjs");
const codexFixtureAgentPath = resolve("apps/desktop/src/codex-fixture-agent.mjs");
const manifest = createLocalExecutionPolicyManifest({ demoAgentPath, codexFixtureAgentPath });

test("allows the manifest-pinned demo agent with read-only/no-network policy", () => {
  const gate = localExecutionGate(
    { options: {} },
    { type: "cli", command: "demo-agent" },
    {
      command: process.execPath,
      args: [demoAgentPath, "--task", "hello"],
      cwd,
      localPolicy: { filePolicy: "read_only", networkPolicy: "forbidden", source: "test" },
    },
    { manifest },
  );
  assert.equal(gate.allowed, true);
  assert.equal(gate.evidence.commandKind, "demoAgent");
});

test("rejects a node script outside the local execution manifest", () => {
  const gate = localExecutionGate(
    { options: {} },
    { type: "cli", command: "node" },
    {
      command: process.execPath,
      args: [join(tmpdir(), "not-allowlisted.mjs")],
      cwd,
      localPolicy: { filePolicy: "read_only", networkPolicy: "forbidden", source: "test" },
    },
    { manifest },
  );
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /non-allowlisted/);
});

test("requires approval evidence for full-access Codex execution", () => {
  const gate = localExecutionGate(
    { options: {} },
    { type: "cli", command: "codex" },
    {
      command: process.execPath,
      args: [codexFixtureAgentPath, "exec", "--dangerously-bypass-approvals-and-sandbox", "{{task}}"],
      cwd,
      localPolicy: { filePolicy: "native_controls", networkPolicy: "native_controls", source: "test" },
    },
    { permissionDecision: "pending", manifest },
  );
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /without approval evidence/);
});

test("rejects wrapper execution when file or network policy exceeds the manifest", () => {
  const wrapperScript = resolve("tools/agents/application-wrapper.mjs");
  const gate = localExecutionGate(
    { options: {} },
    { type: "cli", command: "node" },
    {
      command: process.execPath,
      args: [wrapperScript],
      cwd,
      localPolicy: { filePolicy: "workspace_write", networkPolicy: "network", source: "test" },
    },
    { manifest },
  );
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /policy exceeds/);
  assert.equal(gate.evidence.commandKind, "wrapper");
});

test("derives applicationWrapper file/network policies for the bridge gate", () => {
  const policy = localPolicyForAdapter({ type: "cli", command: "node" }, {
    options: {
      metadata: {
        applicationWrapper: {
          execCommand: "ccusage",
          execArgs: ["daily", "--json"],
          filePolicy: "read_only",
          networkPolicy: "forbidden",
        },
      },
    },
  });
  assert.deepEqual(policy, {
    filePolicy: "read_only",
    networkPolicy: "forbidden",
    source: "application_wrapper",
  });
});
