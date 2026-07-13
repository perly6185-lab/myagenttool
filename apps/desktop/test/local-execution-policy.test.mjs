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

test("each refusal carries a recovery-category code (routes bridge/refuse into recovery)", () => {
  const p = (filePolicy = "read_only", networkPolicy = "forbidden") => ({ filePolicy, networkPolicy, source: "test" });
  // Unsupported adapter type → agent_unavailable.
  assert.equal(
    localExecutionGate({ options: {} }, { type: "a2a" }, {}, { manifest }).code,
    "agent_unavailable",
  );
  // NUL in argv → validation_failed.
  assert.equal(
    localExecutionGate({ options: {} }, { type: "cli", command: "demo-agent" },
      { command: process.execPath, args: [demoAgentPath, "x\0y"], cwd, localPolicy: p() }, { manifest }).code,
    "validation_failed",
  );
  // Missing/non-absolute cwd → runtime_error.
  assert.equal(
    localExecutionGate({ options: {} }, { type: "cli", command: "demo-agent" },
      { command: process.execPath, args: [demoAgentPath], cwd: join(tmpdir(), "does-not-exist-xyz"), localPolicy: p() }, { manifest }).code,
    "runtime_error",
  );
  // Non-allowlisted command → policy_blocked (the default).
  assert.equal(
    localExecutionGate({ options: {} }, { type: "cli", command: "node" },
      { command: process.execPath, args: [join(tmpdir(), "nope.mjs")], cwd, localPolicy: p() }, { manifest }).code,
    "policy_blocked",
  );
  // An allowed run carries no refusal code.
  assert.equal(
    localExecutionGate({ options: {} }, { type: "cli", command: "demo-agent" },
      { command: process.execPath, args: [demoAgentPath, "--task", "hi"], cwd, localPolicy: p() }, { manifest }).code,
    undefined,
  );
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

// --- #775: generalized git wrapper allowlist (default-deny at the bridge) ---

function gitGate({ execArgs, capability = "app.app_git.wrapper.status", root, cwd: innerCwd, localPolicy }) {
  const spec = { execCommand: "git", execArgs, capability, filePolicy: "read_only", networkPolicy: "forbidden" };
  const work = { project: { path: root }, options: { metadata: { applicationWrapper: spec, worktreePath: root } } };
  return localExecutionGate(
    work,
    { type: "cli", command: "node" },
    {
      command: process.execPath,
      args: wrapperArgs(spec, { cwd: innerCwd }),
      cwd: innerCwd,
      localPolicy: localPolicy ?? { filePolicy: "read_only", networkPolicy: "forbidden", source: "application_wrapper" },
    },
    { manifest },
  );
}

const gitRoot = mkdtempSync(join(tmpdir(), "git-app-root-"));

test("git wrapper: status with its registered base argv is allowed", () => {
  const gate = gitGate({ execArgs: ["--no-pager", "status", "--porcelain=v2", "--branch"], root: gitRoot, cwd: gitRoot });
  assert.equal(gate.allowed, true, gate.reason);
});

test("git wrapper: log with valid since/author/max-count trailing flags is allowed", () => {
  const gate = gitGate({
    capability: "app.app_git.wrapper.log",
    execArgs: ["--no-pager", "log", "--format=%H%x1f%an%x1f%aI%x1f%s%x1e", "--max-count=50", "--since", "2026-01-01", "--author", "octocat", "--max-count", "10"],
    root: gitRoot,
    cwd: gitRoot,
  });
  assert.equal(gate.allowed, true, gate.reason);
});

test("git wrapper: ccusage argv is unaffected by the generalization", () => {
  const spec = { execCommand: "ccusage", execArgs: ["daily", "--json", "--offline"], capability: "app.app_ccusage.wrapper.daily", filePolicy: "read_only", networkPolicy: "forbidden" };
  const gate = localExecutionGate(
    { project: { path: gitRoot }, options: { metadata: { applicationWrapper: spec, worktreePath: gitRoot } } },
    { type: "cli", command: "node" },
    { command: process.execPath, args: wrapperArgs(spec, { cwd: gitRoot }), cwd: gitRoot, localPolicy: { filePolicy: "read_only", networkPolicy: "forbidden", source: "application_wrapper" } },
    { manifest },
  );
  assert.equal(gate.allowed, true, gate.reason);
});

test("git wrapper: an unregistered git command is refused (default-deny within the app)", () => {
  const gate = gitGate({ capability: "app.app_git.wrapper.push", execArgs: ["--no-pager", "push"], root: gitRoot, cwd: gitRoot });
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /args outside the local allowlist/);
});

test("git wrapper: argv not matching the registered base prefix is refused", () => {
  // status capability but log argv → base mismatch.
  const gate = gitGate({ execArgs: ["--no-pager", "log"], root: gitRoot, cwd: gitRoot });
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /args outside the local allowlist/);
});

test("git wrapper: an undeclared trailing flag is refused", () => {
  const gate = gitGate({
    capability: "app.app_git.wrapper.log",
    execArgs: ["--no-pager", "log", "--format=%H%x1f%an%x1f%aI%x1f%s%x1e", "--max-count=50", "--pretty", "oneline"],
    root: gitRoot,
    cwd: gitRoot,
  });
  assert.equal(gate.allowed, false);
});

test("git wrapper: a flag value failing its validator is refused", () => {
  const bad = gitGate({
    capability: "app.app_git.wrapper.log",
    execArgs: ["--no-pager", "log", "--format=%H%x1f%an%x1f%aI%x1f%s%x1e", "--max-count=50", "--since", "not-a-date"],
    root: gitRoot,
    cwd: gitRoot,
  });
  assert.equal(bad.allowed, false);
  const overCount = gitGate({
    capability: "app.app_git.wrapper.log",
    execArgs: ["--no-pager", "log", "--format=%H%x1f%an%x1f%aI%x1f%s%x1e", "--max-count=50", "--max-count", "1001"],
    root: gitRoot,
    cwd: gitRoot,
  });
  assert.equal(overCount.allowed, false, "max-count is capped at 1000");
});

test("git wrapper: value-slot injections (--upload-pack=, -c, --exec-path=, leading dash) are refused", () => {
  for (const injected of [
    ["--author", "--upload-pack=/x"],
    ["-c", "core.pager=cat"],
    ["--exec-path=/tmp"],
    ["--author", "-evil"],
  ]) {
    const gate = gitGate({
      capability: "app.app_git.wrapper.log",
      execArgs: ["--no-pager", "log", "--format=%H%x1f%an%x1f%aI%x1f%s%x1e", "--max-count=50", ...injected],
      root: gitRoot,
      cwd: gitRoot,
    });
    assert.equal(gate.allowed, false, `injection ${injected.join(" ")} must be refused`);
  }
});

test("git wrapper: a cwd outside the approved root is refused", () => {
  const outside = mkdtempSync(join(tmpdir(), "git-outside-"));
  const gate = gitGate({ execArgs: ["--no-pager", "status", "--porcelain=v2", "--branch"], root: gitRoot, cwd: outside });
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /outside the approved/);
});

test("git wrapper: a file/network policy exceeding the command allowlist is refused", () => {
  const gate = gitGate({
    execArgs: ["--no-pager", "status", "--porcelain=v2", "--branch"],
    root: gitRoot,
    cwd: gitRoot,
    localPolicy: { filePolicy: "workspace_write", networkPolicy: "network", source: "application_wrapper" },
  });
  assert.equal(gate.allowed, false);
});

// --- #777: positional revision arguments at the bridge (git-rev), independently ---

test("git wrapper: show/diff_ref with a valid positional rev is allowed", () => {
  const okShow = gitGate({ capability: "app.app_git.wrapper.show", execArgs: ["--no-pager", "show", "--stat", "--no-color", "HEAD"], root: gitRoot, cwd: gitRoot });
  assert.equal(okShow.allowed, true, okShow.reason);
  const okDiff = gitGate({ capability: "app.app_git.wrapper.diff_ref", execArgs: ["--no-pager", "diff", "--stat", "--no-color", "v1.2.3"], root: gitRoot, cwd: gitRoot });
  assert.equal(okDiff.allowed, true, okDiff.reason);
});

test("git wrapper: the bridge independently refuses a bad positional rev", () => {
  for (const rev of ["--upload-pack=/x", "-evil", "a..b", "../../etc", "a;rm", "a b", "a|b", "a".repeat(101)]) {
    const gate = gitGate({ capability: "app.app_git.wrapper.show", execArgs: ["--no-pager", "show", "--stat", "--no-color", rev], root: gitRoot, cwd: gitRoot });
    assert.equal(gate.allowed, false, `bridge must refuse rev "${rev}"`);
  }
});

test("git wrapper: a second positional (over maxPositionals) is refused", () => {
  const gate = gitGate({ capability: "app.app_git.wrapper.show", execArgs: ["--no-pager", "show", "--stat", "--no-color", "HEAD", "main"], root: gitRoot, cwd: gitRoot });
  assert.equal(gate.allowed, false);
});

test("git wrapper: a positional on a command that declares none is refused", () => {
  const gate = gitGate({ capability: "app.app_git.wrapper.status", execArgs: ["--no-pager", "status", "--porcelain=v2", "--branch", "HEAD"], root: gitRoot, cwd: gitRoot });
  assert.equal(gate.allowed, false, "status takes no positional");
});

// --- #794: the device enforces cwdPolicy itself, rather than trusting the server ---
//
// The unrooted case reproduces what the bridge actually builds when projectPath
// and worktreePath never arrive: resolveCwd yields null, so no --cwd is injected,
// and the OUTER spawn cwd falls back to process.cwd() (projectCwd in index.mjs).
// Without the gate's own cwdPolicy check the wrapper would then run git in the
// bridge's own repository — read-only today, a write into the wrong repo at P1.
function cwdPolicyGate({ cwdPolicy, root = null, cwd: innerCwd = null }) {
  const spec = {
    execCommand: "git",
    execArgs: ["--no-pager", "status", "--porcelain=v2", "--branch"],
    capability: "app.app_git.wrapper.status",
    cwdPolicy,
    filePolicy: "read_only",
    networkPolicy: "forbidden",
  };
  const metadata = { applicationWrapper: spec, ...(root ? { worktreePath: root } : {}) };
  return localExecutionGate(
    { ...(root ? { project: { path: root } } : {}), options: { metadata } },
    { type: "cli", command: "node" },
    {
      command: process.execPath,
      args: wrapperArgs(spec, { cwd: innerCwd }),
      cwd: innerCwd ?? process.cwd(),
      localPolicy: { filePolicy: "read_only", networkPolicy: "forbidden", source: "application_wrapper" },
    },
    { manifest },
  );
}

test("cwdPolicy: an invocation_root command with no resolved cwd is refused BY THE DEVICE", () => {
  const gate = cwdPolicyGate({ cwdPolicy: "invocation_root" });
  assert.equal(gate.allowed, false, "the device must not run an unrooted invocation_root command");
  assert.match(gate.reason, /invocation-root .* no resolved working directory/);
  assert.equal(gate.code, "policy_blocked");
  assert.equal(gate.evidence.applicationWrapper.cwdPolicy, "invocation_root");
  assert.equal(gate.evidence.applicationWrapper.cwd, null);
});

test("cwdPolicy: invocation_root with a cwd inside the approved root is allowed", () => {
  const gate = cwdPolicyGate({ cwdPolicy: "invocation_root", root: gitRoot, cwd: gitRoot });
  assert.equal(gate.allowed, true, gate.reason);
  assert.equal(gate.evidence.applicationWrapper.cwdPolicy, "invocation_root");
});

test("cwdPolicy: 'fixed' with no cwd stays allowed (ccusage's contract is untouched)", () => {
  const gate = cwdPolicyGate({ cwdPolicy: "fixed" });
  assert.equal(gate.allowed, true, gate.reason);
});

test("cwdPolicy: an unknown or missing policy is read as 'fixed', never inferred as rooted", () => {
  for (const cwdPolicy of [undefined, null, "", "INVOCATION_ROOT", "invocation-root", "project_root", 7]) {
    const gate = cwdPolicyGate({ cwdPolicy });
    assert.equal(gate.allowed, true, `cwdPolicy ${JSON.stringify(cwdPolicy)} must degrade to "fixed"`);
    assert.equal(gate.evidence.applicationWrapper.cwdPolicy, "fixed");
  }
});
