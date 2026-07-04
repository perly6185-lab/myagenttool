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
const applicationWrapperPath = resolve("tools/agents/application-wrapper.mjs");
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

test("rejects an allowlisted command when argv contains a NUL byte", () => {
  const gate = localExecutionGate(
    { options: {} },
    { type: "cli", command: "demo-agent" },
    {
      command: process.execPath,
      args: [demoAgentPath, "--task", "hello\0world"],
      cwd,
      localPolicy: { filePolicy: "read_only", networkPolicy: "forbidden", source: "test" },
    },
    { manifest },
  );
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /NUL byte/);
  assert.equal(gate.evidence.commandKind, "demoAgent");
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

import { mkdirSync, mkdtempSync } from "node:fs";

test("cwd confinement: allows a cwd inside the approved worktree root", () => {
  const root = mkdtempSync(join(tmpdir(), "wt-root-"));
  const inside = join(root, "sub");
  mkdirSync(inside, { recursive: true });
  const gate = localExecutionGate(
    { options: { metadata: { worktreePath: root } } },
    { type: "cli", command: "demo-agent" },
    {
      command: process.execPath,
      args: [demoAgentPath, "--task", "hello"],
      cwd: inside,
      localPolicy: { filePolicy: "read_only", networkPolicy: "forbidden", source: "test" },
    },
    { manifest },
  );
  assert.equal(gate.allowed, true, gate.reason);
  assert.deepEqual(gate.evidence.approvedRoots, [resolve(root)]);
});

test("cwd confinement: refuses a cwd outside the approved root", () => {
  const root = mkdtempSync(join(tmpdir(), "wt-root-"));
  const outside = mkdtempSync(join(tmpdir(), "elsewhere-")); // absolute + exists, but not under root
  const gate = localExecutionGate(
    { options: { metadata: { worktreePath: root } } },
    { type: "cli", command: "demo-agent" },
    {
      command: process.execPath,
      args: [demoAgentPath, "--task", "hello"],
      cwd: outside,
      localPolicy: { filePolicy: "read_only", networkPolicy: "forbidden", source: "test" },
    },
    { manifest },
  );
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /outside the approved project or worktree root/);
});

test("cwd confinement: no derivable root leaves the run un-confined (skipped, not blocked)", () => {
  const gate = localExecutionGate(
    { options: {} },
    { type: "cli", command: "demo-agent" },
    {
      command: process.execPath,
      args: [demoAgentPath, "--task", "hello"],
      cwd: tmpdir(),
      localPolicy: { filePolicy: "read_only", networkPolicy: "forbidden", source: "test" },
    },
    { manifest },
  );
  assert.equal(gate.allowed, true, "with no approved root there is nothing to confine to");
});

test("application wrapper gate allows the local ccusage allowlist contract", () => {
  const spec = {
    execCommand: "ccusage",
    execArgs: ["daily", "--json", "--offline", "--since", "2026-07-01"],
    capability: "app.app_ccusage.wrapper.daily",
    filePolicy: "read_only",
    networkPolicy: "forbidden",
  };
  const gate = localExecutionGate(
    { project: { path: cwd }, options: { metadata: { applicationWrapper: spec } } },
    { type: "cli", command: "node" },
    {
      command: process.execPath,
      args: wrapperArgs(spec, { cwd }),
      cwd,
      localPolicy: { filePolicy: "read_only", networkPolicy: "forbidden", source: "application_wrapper" },
    },
    { manifest },
  );
  assert.equal(gate.allowed, true, gate.reason);
  assert.equal(gate.evidence.applicationWrapper.command, "ccusage");
});

test("application wrapper gate refuses a non-allowlisted inner command before spawn", () => {
  const spec = {
    execCommand: "node",
    execArgs: ["-e", "console.log('nope')"],
    capability: "app.app_ccusage.wrapper.daily",
    filePolicy: "read_only",
    networkPolicy: "forbidden",
  };
  const gate = localExecutionGate(
    { project: { path: cwd }, options: { metadata: { applicationWrapper: spec } } },
    { type: "cli", command: "node" },
    {
      command: process.execPath,
      args: wrapperArgs(spec),
      cwd,
      localPolicy: { filePolicy: "read_only", networkPolicy: "forbidden", source: "application_wrapper" },
    },
    { manifest },
  );
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /non-allowlisted application wrapper command/);
  assert.equal(gate.evidence.applicationWrapper.command, "node");
});

test("application wrapper gate confines the child command cwd to the approved root", () => {
  const root = mkdtempSync(join(tmpdir(), "app-wrapper-root-"));
  const outside = mkdtempSync(join(tmpdir(), "app-wrapper-outside-"));
  const spec = {
    execCommand: "ccusage",
    execArgs: ["daily", "--json", "--offline"],
    capability: "app.app_ccusage.wrapper.daily",
    filePolicy: "read_only",
    networkPolicy: "forbidden",
  };
  const gate = localExecutionGate(
    { project: { path: root }, options: { metadata: { applicationWrapper: spec } } },
    { type: "cli", command: "node" },
    {
      command: process.execPath,
      args: wrapperArgs(spec, { cwd: outside }),
      cwd: root,
      localPolicy: { filePolicy: "read_only", networkPolicy: "forbidden", source: "application_wrapper" },
    },
    { manifest },
  );
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /application wrapper cwd outside/);
  assert.equal(gate.evidence.applicationWrapper.cwd, outside);
});

function wrapperArgs(spec, { cwd: innerCwd } = {}) {
  const args = [
    applicationWrapperPath,
    "--exec-command", spec.execCommand,
  ];
  if (innerCwd) args.push("--cwd", innerCwd);
  args.push("--capability", spec.capability);
  for (const arg of spec.execArgs) {
    args.push("--exec-arg", arg);
  }
  return args;
}
