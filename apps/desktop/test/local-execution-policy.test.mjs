import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import {
  binaryAvailableOnPath,
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

import { closeSync, mkdirSync, mkdtempSync, openSync } from "node:fs";

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
    { manifest, resolveBinary: () => true }, // #802: this contract tests argv/policy, not availability
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

function gitGate({ execArgs, capability = "app.app_git.wrapper.status", root, cwd: innerCwd, localPolicy, resolveBinary = () => true }) {
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
    // Default the availability resolver to "present" so these tests assert argv/cwd
    // policy independently of whether the CI runner has git; #802 cases override it.
    { manifest, resolveBinary },
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
    execArgs: ["--no-pager", "log", "-z", "--format=%H%x1f%an%x1f%aI%x1f%s", "--max-count=50", "--since", "2026-01-01", "--author", "octocat", "--max-count", "10"],
    root: gitRoot,
    cwd: gitRoot,
  });
  assert.equal(gate.allowed, true, gate.reason);
});

test("#802: an allowlisted git command whose binary is NOT on the device is refused with binary_unavailable", () => {
  const gate = gitGate({
    execArgs: ["--no-pager", "status", "--porcelain=v2", "--branch"],
    root: gitRoot,
    cwd: gitRoot,
    resolveBinary: () => false, // this device has no git
  });
  assert.equal(gate.allowed, false);
  assert.equal(gate.evidence.refusalCode, "binary_unavailable", "precise per-device signal, not an opaque exit 127");
  assert.match(gate.reason, /not available on this device/i);
});

test("#802: the availability check runs AFTER the allowlist — a bad command is still command-refused, not binary-refused", () => {
  const gate = gitGate({
    capability: "app.app_git.wrapper.log",
    execArgs: ["--no-pager", "log", "--format=%H", "--max-count=50", "--evil"],
    root: gitRoot,
    cwd: gitRoot,
    resolveBinary: () => false,
  });
  assert.equal(gate.allowed, false);
  assert.notEqual(gate.evidence.refusalCode, "binary_unavailable", "an allowlist refusal takes precedence over availability");
});

test("#802: binaryAvailableOnPath resolves a bare name against PATH and a path directly", () => {
  assert.equal(binaryAvailableOnPath("node", { PATH: process.env.PATH }), true, "node is on PATH in this runner");
  assert.equal(binaryAvailableOnPath("definitely-not-a-real-binary-xyz", { PATH: process.env.PATH }), false);
  assert.equal(binaryAvailableOnPath(process.execPath), true, "an absolute path is checked directly");
  assert.equal(binaryAvailableOnPath("git", { PATH: "" }), false, "empty PATH resolves nothing");
});

test("#802: binaryAvailableOnPath accepts Windows command names that already include an extension", () => {
  const dir = mkdtempSync(join(tmpdir(), "path-ext-"));
  closeSync(openSync(join(dir, "tool.EXE"), "w"));
  assert.equal(binaryAvailableOnPath("tool.EXE", { PATH: dir, PATHEXT: ".EXE;.CMD" }), true);
});

test("git wrapper: ccusage argv is unaffected by the generalization", () => {
  const spec = { execCommand: "ccusage", execArgs: ["daily", "--json", "--offline"], capability: "app.app_ccusage.wrapper.daily", filePolicy: "read_only", networkPolicy: "forbidden" };
  const gate = localExecutionGate(
    { project: { path: gitRoot }, options: { metadata: { applicationWrapper: spec, worktreePath: gitRoot } } },
    { type: "cli", command: "node" },
    { command: process.execPath, args: wrapperArgs(spec, { cwd: gitRoot }), cwd: gitRoot, localPolicy: { filePolicy: "read_only", networkPolicy: "forbidden", source: "application_wrapper" } },
    { manifest, resolveBinary: () => true }, // #802: this contract tests argv/policy, not availability
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
    execArgs: ["--no-pager", "log", "-z", "--format=%H%x1f%an%x1f%aI%x1f%s", "--max-count=50", "--pretty", "oneline"],
    root: gitRoot,
    cwd: gitRoot,
  });
  assert.equal(gate.allowed, false);
});

test("git wrapper: a flag value failing its validator is refused", () => {
  const bad = gitGate({
    capability: "app.app_git.wrapper.log",
    execArgs: ["--no-pager", "log", "-z", "--format=%H%x1f%an%x1f%aI%x1f%s", "--max-count=50", "--since", "not-a-date"],
    root: gitRoot,
    cwd: gitRoot,
  });
  assert.equal(bad.allowed, false);
  const overCount = gitGate({
    capability: "app.app_git.wrapper.log",
    execArgs: ["--no-pager", "log", "-z", "--format=%H%x1f%an%x1f%aI%x1f%s", "--max-count=50", "--max-count", "1001"],
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
      execArgs: ["--no-pager", "log", "-z", "--format=%H%x1f%an%x1f%aI%x1f%s", "--max-count=50", ...injected],
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

// --- #758 Tier-3: the gate stamps a precise refusalCode for server classification ---

test("gate stamps refusalCode cwd_outside_approved_root for a cwd outside the approved root", () => {
  const outside = mkdtempSync(join(tmpdir(), "rc-outside-"));
  const gate = gitGate({ execArgs: ["--no-pager", "status", "--porcelain=v2", "--branch"], root: gitRoot, cwd: outside });
  assert.equal(gate.allowed, false);
  assert.equal(gate.evidence.refusalCode, "cwd_outside_approved_root");
});

// The file/network branch fires when spec and localPolicy AGREE (as they do in
// production — localPolicy is derived from the spec) but exceed the manifest
// ceiling (git is read_only/forbidden). Build both to that shape.
function gitPolicyGate({ filePolicy, networkPolicy }) {
  const spec = { execCommand: "git", execArgs: ["--no-pager", "status", "--porcelain=v2", "--branch"], capability: "app.app_git.wrapper.status", filePolicy, networkPolicy };
  return localExecutionGate(
    { project: { path: gitRoot }, options: { metadata: { applicationWrapper: spec, worktreePath: gitRoot } } },
    { type: "cli", command: "node" },
    { command: process.execPath, args: wrapperArgs(spec, { cwd: gitRoot }), cwd: gitRoot, localPolicy: { filePolicy, networkPolicy, source: "application_wrapper" } },
    { manifest, resolveBinary: () => true },
  );
}

test("gate stamps file_policy_exceeded when the file policy exceeds the command allowlist", () => {
  const gate = gitPolicyGate({ filePolicy: "workspace_write", networkPolicy: "forbidden" });
  assert.equal(gate.allowed, false);
  assert.equal(gate.evidence.refusalCode, "file_policy_exceeded");
});

test("gate stamps network_policy_exceeded when only the network policy exceeds", () => {
  const gate = gitPolicyGate({ filePolicy: "read_only", networkPolicy: "network" });
  assert.equal(gate.allowed, false);
  assert.equal(gate.evidence.refusalCode, "network_policy_exceeded");
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
  // Maps onto the closed refusal taxonomy (#758/#759) rather than minting a code.
  assert.equal(gate.evidence.applicationWrapper.refusalCode, "cwd_outside_approved_root");
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

// --- OfficeCLI read-only wrapper allowlist (P1, default-deny at the bridge) ---

function officecliGate({ execArgs, capability, root = gitRoot, cwd = gitRoot, resolveBinary = () => true }) {
  const spec = { execCommand: "officecli", execArgs, capability, filePolicy: "read_only", networkPolicy: "forbidden" };
  const work = { project: { path: root }, options: { metadata: { applicationWrapper: spec, worktreePath: root } } };
  return localExecutionGate(
    work,
    { type: "cli", command: "node" },
    {
      command: process.execPath,
      args: wrapperArgs(spec, { cwd }),
      cwd,
      localPolicy: { filePolicy: "read_only", networkPolicy: "forbidden", source: "application_wrapper" },
    },
    { manifest, resolveBinary },
  );
}

test("officecli wrapper: get with file + path positionals is allowed", () => {
  const gate = officecliGate({
    capability: "app.app_officecli.wrapper.get",
    execArgs: ["get", "--json", "demo.xlsx", "/Sheet1/A1"],
  });
  assert.equal(gate.allowed, true, gate.reason);
});

test("officecli wrapper: view with an in-set mode positional is allowed", () => {
  for (const mode of ["text", "html"]) {
    const gate = officecliGate({
      capability: "app.app_officecli.wrapper.view",
      execArgs: ["view", "report.docx", mode],
    });
    assert.equal(gate.allowed, true, `${mode}: ${gate.reason}`);
  }
});

test("officecli wrapper: a non-Office file extension is refused (device is stricter than the server)", () => {
  const gate = officecliGate({
    capability: "app.app_officecli.wrapper.get",
    execArgs: ["get", "--json", "/etc/passwd"],
  });
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /args outside the local allowlist/);
});

test("officecli wrapper: an out-of-set view mode is refused", () => {
  const gate = officecliGate({
    capability: "app.app_officecli.wrapper.view",
    execArgs: ["view", "report.docx", "screenshot"],
  });
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /args outside the local allowlist/);
});

test("officecli wrapper: an undeclared trailing flag is refused (no write/verb smuggling)", () => {
  const gate = officecliGate({
    capability: "app.app_officecli.wrapper.get",
    execArgs: ["get", "--json", "demo.xlsx", "--set", "value=x"],
  });
  assert.equal(gate.allowed, false);
});

test("officecli wrapper: argv not matching the registered base prefix is refused", () => {
  // A write verb under a read capability id → base mismatch, refused.
  const gate = officecliGate({
    capability: "app.app_officecli.wrapper.get",
    execArgs: ["set", "demo.xlsx", "/Sheet1/A1"],
  });
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /args outside the local allowlist/);
});

test("officecli wrapper: an unregistered command id is refused (default-deny within the app)", () => {
  const gate = officecliGate({
    capability: "app.app_officecli.wrapper.batch",
    execArgs: ["batch", "demo.xlsx"],
  });
  assert.equal(gate.allowed, false);
});

test("#802: an allowlisted officecli command whose binary is absent is refused with binary_unavailable", () => {
  const gate = officecliGate({
    capability: "app.app_officecli.wrapper.get",
    execArgs: ["get", "--json", "demo.xlsx", "/"],
    resolveBinary: () => false,
  });
  assert.equal(gate.allowed, false);
  assert.equal(gate.evidence.refusalCode, "binary_unavailable");
});

test("#1356: the excalidraw-cli runtime is presence-only — any invocation is default-denied (no verb wired in PR1)", () => {
  // The manifest carries an excalidraw-cli probe entry (for readiness), but
  // wrapperArgsAllowed has NO branch for its prefix, so the device refuses every
  // invocation regardless of argv. This locks the PR1 scaffolding: the runtime can
  // be detected/installed but NOT executed until the governed export slice (PR2).
  const spec = { execCommand: "excalidraw-cli", execArgs: ["export", "diagram.excalidraw"], capability: "app.app_excalidraw_cli.wrapper.export", filePolicy: "read_only", networkPolicy: "forbidden" };
  const work = { project: { path: gitRoot }, options: { metadata: { applicationWrapper: spec, worktreePath: gitRoot } } };
  const gate = localExecutionGate(
    work,
    { type: "cli", command: "node" },
    {
      command: process.execPath,
      args: wrapperArgs(spec, { cwd: gitRoot }),
      cwd: gitRoot,
      localPolicy: { filePolicy: "read_only", networkPolicy: "forbidden", source: "application_wrapper" },
    },
    { manifest, resolveBinary: () => true },
  );
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /args outside the local allowlist/);
});

// --- excalidraw-cli export WRITE verb (#1356 PR2): the excalidrawCliApply policy ---

function excalidrawApplyGate({ execArgs, capability, root = gitRoot, cwd = gitRoot, worktreePath = root, resolveBinary = () => true }) {
  const spec = { execCommand: "excalidraw-cli", execArgs, capability, filePolicy: "workspace_write", networkPolicy: "forbidden" };
  const metadata = { applicationWrapper: spec };
  if (worktreePath !== null) metadata.worktreePath = worktreePath;
  const work = { project: { path: root }, options: { metadata } };
  return localExecutionGate(
    work,
    { type: "cli", command: "node" },
    {
      command: process.execPath,
      args: wrapperArgs(spec, { cwd }),
      cwd,
      localPolicy: { filePolicy: "workspace_write", networkPolicy: "forbidden", source: "application_wrapper" },
    },
    { manifest, resolveBinary },
  );
}

test("#1356 PR2: a workspace_write export with .excalidraw input + .png output is allowed and classified excalidrawCliApply", () => {
  const gate = excalidrawApplyGate({
    capability: "app.app_excalidraw_cli.apply.export",
    execArgs: ["diagrams/flow.excalidraw", "out/flow.png"],
  });
  assert.equal(gate.allowed, true, gate.reason);
  assert.equal(gate.evidence.commandKind, "excalidrawCliApply", "a render is its own write bucket, never read-only wrapper");
});

test("#1356 PR2: an export outside a worktree is refused (writes must run in the invocation's worktree)", () => {
  const gate = excalidrawApplyGate({
    capability: "app.app_excalidraw_cli.apply.export",
    execArgs: ["flow.excalidraw", "flow.png"],
    worktreePath: null,
  });
  assert.equal(gate.allowed, false);
  assert.equal(gate.evidence.refusalCode, "cwd_outside_approved_root");
});

test("#1356 PR2: a traversal input or a wrong-extension output is refused (args outside the allowlist)", () => {
  for (const execArgs of [["../secret.excalidraw", "flow.png"], ["flow.excalidraw", "flow.svg"], ["flow.excalidraw", "/etc/out.png"]]) {
    const gate = excalidrawApplyGate({ capability: "app.app_excalidraw_cli.apply.export", execArgs });
    assert.equal(gate.allowed, false, `must refuse ${JSON.stringify(execArgs)}`);
    assert.match(gate.reason, /args outside the local allowlist/);
  }
});

test("#1356 PR2: an export whose binary is absent is refused with binary_unavailable", () => {
  const gate = excalidrawApplyGate({
    capability: "app.app_excalidraw_cli.apply.export",
    execArgs: ["flow.excalidraw", "flow.png"],
    resolveBinary: () => false,
  });
  assert.equal(gate.allowed, false);
  assert.equal(gate.evidence.refusalCode, "binary_unavailable");
});

test("#1356 PR2: a write filePolicy presented under the presence-only READ prefix is refused (read bucket never widens to a write)", () => {
  // The read prefix routes to the read-only `wrapper` bucket; a workspace_write
  // policy there is refused by the file-policy gate — a read entry can never
  // resolve to a write policy. (The args-level default-deny of the read prefix is
  // covered by the PR1 presence-only test above.)
  const gate = excalidrawApplyGate({
    capability: "app.app_excalidraw_cli.wrapper.export",
    execArgs: ["flow.excalidraw", "flow.png"],
  });
  assert.equal(gate.allowed, false);
  assert.equal(gate.evidence.refusalCode, "file_policy_exceeded");
});

// --- OfficeCLI WRITE verbs (P3.1): the officecliApply write-policy kind ---

function officecliApplyGate({ execArgs, capability, root = gitRoot, cwd = gitRoot, worktreePath = root, filePolicy = "workspace_write", resolveBinary = () => true }) {
  const spec = { execCommand: "officecli", execArgs, capability, filePolicy, networkPolicy: "forbidden" };
  const metadata = { applicationWrapper: spec };
  if (worktreePath !== null) metadata.worktreePath = worktreePath;
  const work = { project: { path: root }, options: { metadata } };
  return localExecutionGate(
    work,
    { type: "cli", command: "node" },
    {
      command: process.execPath,
      args: wrapperArgs(spec, { cwd }),
      cwd,
      localPolicy: { filePolicy, networkPolicy: "forbidden", source: "application_wrapper" },
    },
    { manifest, resolveBinary },
  );
}

test("officecliApply: a workspace_write remove with file+path positionals is allowed", () => {
  const gate = officecliApplyGate({
    capability: "app.app_officecli.apply.remove",
    execArgs: ["remove", "deck.pptx", "/slide[2]/shape[3]"],
  });
  assert.equal(gate.allowed, true, gate.reason);
  assert.equal(gate.evidence.commandKind, "officecliApply", "a write is classified into its own bucket, never read-only wrapper");
});

test("officecliApply: the read-only wrapper bucket does NOT permit an officecli write", () => {
  // Same argv, but presented under the READ capability prefix → classified `wrapper`,
  // whose bucket is read_only-only, so a workspace_write policy is refused there.
  const gate = officecliApplyGate({
    capability: "app.app_officecli.wrapper.remove",
    execArgs: ["remove", "deck.pptx", "/slide[2]/shape[3]"],
  });
  assert.equal(gate.allowed, false, "a write under the read prefix must not slip through");
});

test("officecliApply: a read_only file policy under the apply prefix is refused (policy must match)", () => {
  const gate = officecliApplyGate({
    capability: "app.app_officecli.apply.remove",
    execArgs: ["remove", "deck.pptx", "/slide[1]"],
    filePolicy: "read_only",
  });
  assert.equal(gate.allowed, false);
});

test("officecliApply: a non-Office file is refused (device stays stricter than the server)", () => {
  const gate = officecliApplyGate({
    capability: "app.app_officecli.apply.remove",
    execArgs: ["remove", "/etc/hosts", "/x"],
  });
  assert.equal(gate.allowed, false);
  assert.match(gate.reason, /args outside the local allowlist/);
});

test("officecliApply: an unregistered write verb is refused (batch/add not shipped yet)", () => {
  const gate = officecliApplyGate({
    capability: "app.app_officecli.apply.batch",
    execArgs: ["batch", "deck.pptx", "--commands", "[]"],
  });
  assert.equal(gate.allowed, false);
});

test("officecliApply: an undeclared trailing flag is refused (no extra-arg smuggling on a write)", () => {
  const gate = officecliApplyGate({
    capability: "app.app_officecli.apply.remove",
    execArgs: ["remove", "deck.pptx", "/slide[1]", "--force"],
  });
  assert.equal(gate.allowed, false);
});

test("officecliApply: set with file, path, and repeated --prop key=value is allowed", () => {
  const gate = officecliApplyGate({
    capability: "app.app_officecli.apply.set",
    execArgs: ["set", "deck.pptx", "/slide[1]/shape[1]", "--prop", "text=Hi", "--prop", "bold=true", "--prop", "formula=SUM(A1:A2)"],
  });
  assert.equal(gate.allowed, true, gate.reason);
});

test("officecliApply: a --prop media source (src/path/preview) that escapes the worktree is refused", () => {
  for (const src of ["src=../secret.png", "src=/etc/x.png", "path=../../x", "preview=https://attacker/x.png", "src=~/x", "src=C:\\x.png"]) {
    const gate = officecliApplyGate({
      capability: "app.app_officecli.apply.add",
      execArgs: ["add", "b.xlsx", "/Sheet1", "--type", "picture", "--prop", src],
    });
    assert.equal(gate.allowed, false, `unsafe media source "${src}" must be refused`);
  }
});

test("officecliApply: a worktree-relative media source and a data: URI are allowed; non-source props unaffected", () => {
  const rel = officecliApplyGate({ capability: "app.app_officecli.apply.add", execArgs: ["add", "b.xlsx", "/Sheet1", "--type", "picture", "--prop", "src=assets/logo.png"] });
  assert.equal(rel.allowed, true, rel.reason);
  const data = officecliApplyGate({ capability: "app.app_officecli.apply.set", execArgs: ["set", "b.xlsx", "/Sheet1/pic", "--prop", "src=data:image/png;base64,AAA"] });
  assert.equal(data.allowed, true, data.reason);
  const text = officecliApplyGate({ capability: "app.app_officecli.apply.set", execArgs: ["set", "b.xlsx", "/Sheet1/A1", "--prop", "value=../this/is/text"] });
  assert.equal(text.allowed, true, "a non-source prop with a path-looking value stays allowed");
});

test("officecliApply: a batch item with an unsafe media-source prop is refused", () => {
  const cmds = JSON.stringify([{ command: "add", parent: "/Sheet1", type: "picture", props: { src: "../../etc/passwd.png" } }]);
  const gate = officecliApplyGate({
    capability: "app.app_officecli.apply.batch",
    execArgs: ["batch", "b.xlsx", "--commands", cmds],
  });
  assert.equal(gate.allowed, false);
});

test("officecliApply: a --prop with a flag-shaped key is refused (no option smuggling via props)", () => {
  const gate = officecliApplyGate({
    capability: "app.app_officecli.apply.set",
    execArgs: ["set", "deck.pptx", "/slide[1]", "--prop", "--inject=x"],
  });
  assert.equal(gate.allowed, false);
});

test("officecliApply: a --prop missing its value token is refused", () => {
  const gate = officecliApplyGate({
    capability: "app.app_officecli.apply.set",
    execArgs: ["set", "deck.pptx", "/slide[1]", "--prop"],
  });
  assert.equal(gate.allowed, false);
});

test("officecliApply: add with file, parent, --type (enum) and --prop pairs is allowed", () => {
  const gate = officecliApplyGate({
    capability: "app.app_officecli.apply.add",
    execArgs: ["add", "demo.xlsx", "/Sheet1", "--type", "cell", "--prop", "ref=F1", "--prop", "value=ADDED"],
  });
  assert.equal(gate.allowed, true, gate.reason);
});

test("officecliApply: add with an out-of-set --type is refused (closed enum)", () => {
  const gate = officecliApplyGate({
    capability: "app.app_officecli.apply.add",
    execArgs: ["add", "demo.xlsx", "/Sheet1", "--type", "malware", "--prop", "ref=F1"],
  });
  assert.equal(gate.allowed, false);
});

test("officecliApply: merge with two safe office files + --data JSON (+ --force) is allowed", () => {
  const gate = officecliApplyGate({
    capability: "app.app_officecli.apply.merge",
    execArgs: ["merge", "tmpl.xlsx", "out.xlsx", "--data", '{"name":"World"}', "--force"],
  });
  assert.equal(gate.allowed, true, gate.reason);
});

test("officecliApply: merge with a traversal output file is refused", () => {
  const gate = officecliApplyGate({
    capability: "app.app_officecli.apply.merge",
    execArgs: ["merge", "tmpl.xlsx", "../out.xlsx", "--data", '{"a":1}'],
  });
  assert.equal(gate.allowed, false);
});

test("officecliApply: merge with malformed --data JSON is refused", () => {
  const gate = officecliApplyGate({
    capability: "app.app_officecli.apply.merge",
    execArgs: ["merge", "tmpl.xlsx", "out.xlsx", "--data", "not json"],
  });
  assert.equal(gate.allowed, false);
});

test("officecliApply: import with worktree-safe source + --header/--format is allowed", () => {
  const gate = officecliApplyGate({
    capability: "app.app_officecli.apply.import",
    execArgs: ["import", "book.xlsx", "/Sheet1", "data/rows.csv", "--header", "--format", "csv"],
  });
  assert.equal(gate.allowed, true, gate.reason);
});

test("officecliApply: import with a traversal CSV source is refused", () => {
  const gate = officecliApplyGate({
    capability: "app.app_officecli.apply.import",
    execArgs: ["import", "book.xlsx", "/Sheet1", "../secret.csv"],
  });
  assert.equal(gate.allowed, false);
});

test("officecliApply: import with a bad --format value is refused", () => {
  const gate = officecliApplyGate({
    capability: "app.app_officecli.apply.import",
    execArgs: ["import", "book.xlsx", "/Sheet1", "data.csv", "--format", "exe"],
  });
  assert.equal(gate.allowed, false);
});

test("officecliApply: swap with three positional paths is allowed", () => {
  const gate = officecliApplyGate({
    capability: "app.app_officecli.apply.swap",
    execArgs: ["swap", "demo.xlsx", "/Sheet1/row[2]", "/Sheet1/row[3]"],
  });
  assert.equal(gate.allowed, true, gate.reason);
});

test("officecliApply: move with a --to/--after/--before path flag is allowed", () => {
  const gate = officecliApplyGate({
    capability: "app.app_officecli.apply.move",
    execArgs: ["move", "deck.pptx", "/slide[3]", "--after", "/slide[1]"],
  });
  assert.equal(gate.allowed, true, gate.reason);
});

test("officecliApply: move with an undeclared destination flag is refused", () => {
  const gate = officecliApplyGate({
    capability: "app.app_officecli.apply.move",
    execArgs: ["move", "deck.pptx", "/slide[3]", "--into", "/slide[1]"],
  });
  assert.equal(gate.allowed, false);
});

test("officecliApply: batch with a verb-allowlisted --commands JSON is allowed", () => {
  const cmds = JSON.stringify([
    { command: "set", path: "/Sheet1/A1", props: { value: "x" } },
    { command: "remove", path: "/Sheet1/A2" },
  ]);
  const gate = officecliApplyGate({
    capability: "app.app_officecli.apply.batch",
    execArgs: ["batch", "demo.xlsx", "--commands", cmds],
  });
  assert.equal(gate.allowed, true, gate.reason);
});

test("officecliApply: batch with a non-write verb in --commands is refused", () => {
  const cmds = JSON.stringify([{ command: "set", path: "/A1" }, { command: "raw-set", part: "/document" }]);
  const gate = officecliApplyGate({
    capability: "app.app_officecli.apply.batch",
    execArgs: ["batch", "demo.xlsx", "--commands", cmds],
  });
  assert.equal(gate.allowed, false);
});

test("officecliApply: batch with malformed JSON in --commands is refused", () => {
  const gate = officecliApplyGate({
    capability: "app.app_officecli.apply.batch",
    execArgs: ["batch", "demo.xlsx", "--commands", "not json"],
  });
  assert.equal(gate.allowed, false);
});

test("officecliApply: a write with NO worktree is refused (never the project clone)", () => {
  const gate = officecliApplyGate({
    capability: "app.app_officecli.apply.remove",
    execArgs: ["remove", "deck.pptx", "/slide[1]"],
    worktreePath: null, // invocation has no worktree → the write would hit the project clone
  });
  assert.equal(gate.allowed, false);
  assert.equal(gate.evidence.refusalCode, "cwd_outside_approved_root");
  assert.match(gate.reason, /must run in the invocation's worktree/i);
});

test("officecliApply: a write whose cwd is the project root (not the worktree) is refused", () => {
  const worktree = mkdtempSync(join(tmpdir(), "oc-worktree-"));
  // worktree exists but the command's cwd is the project root → not inside the worktree.
  const gate = officecliApplyGate({
    capability: "app.app_officecli.apply.remove",
    execArgs: ["remove", "deck.pptx", "/slide[1]"],
    root: gitRoot,
    cwd: gitRoot,
    worktreePath: worktree,
  });
  assert.equal(gate.allowed, false);
  assert.equal(gate.evidence.refusalCode, "cwd_outside_approved_root");
});

test("officecliApply: a file positional that escapes the worktree is REFUSED (traversal/absolute)", () => {
  // Confining the cwd is not enough — a `../`/absolute file argv resolves outside
  // the worktree and writes an arbitrary file. The device refuses it.
  for (const file of ["../outside.xlsx", "/etc/evil.xlsx", "a/../../b.xlsx", "~/x.xlsx", "C:\\x.xlsx"]) {
    const gate = officecliApplyGate({
      capability: "app.app_officecli.apply.set",
      execArgs: ["set", file, "/Sheet1/A1", "--prop", "value=x"],
    });
    assert.equal(gate.allowed, false, `write to escaping file "${file}" must be refused`);
  }
});

test("officecli read: a traversal file positional is refused too (no arbitrary reads)", () => {
  const gate = officecliGate({
    capability: "app.app_officecli.wrapper.get",
    execArgs: ["get", "--json", "../../etc/passwd.xlsx", "/"],
  });
  assert.equal(gate.allowed, false);
});

test("officecliApply: a safe subdirectory file inside the worktree is allowed", () => {
  const gate = officecliApplyGate({
    capability: "app.app_officecli.apply.set",
    execArgs: ["set", "reports/q1.xlsx", "/Sheet1/A1", "--prop", "value=x"],
  });
  assert.equal(gate.allowed, true, gate.reason);
});

test("officecliApply: the read wrapper bucket is unchanged — a read command still works", () => {
  const gate = officecliGate({
    capability: "app.app_officecli.wrapper.get",
    execArgs: ["get", "--json", "demo.xlsx", "/"],
  });
  assert.equal(gate.allowed, true, gate.reason);
  assert.equal(gate.evidence.commandKind, "wrapper");
});
