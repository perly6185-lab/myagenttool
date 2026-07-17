/*
 * #1049 (#912): `claude.explain.code` — governed read-only code-in-place analysis.
 * Locks the governed identity gate, the worktree-relative path gate (server side),
 * the facade projection, tool discovery + dispatch + validation, and the wrapper's
 * pre-spawn filesystem confinement (exercised against a real temp worktree, no
 * Claude binary needed — every refusal fires before the spawn).
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { createApplicationService } from "../src/services/applications.mjs";
import { CLAUDE_APPLICATION_ID, createClaudeApplicationRegistration } from "../src/services/claude-application.mjs";
import {
  CLAUDE_EXPLAIN_CODE_TOOL_CONTRACT,
  createClaudeExplainCodeAgentRegistration,
  isGovernedClaudeExplainCodeAgent,
  isSafeWorktreeRelativePath,
} from "../src/services/claude-explain-code-agent.mjs";
import { createToolService } from "../src/services/tools.mjs";

const now = () => "2026-07-15T00:00:00.000Z";

function governedExplainCodeAgent({ args, status = "available" } = {}) {
  return {
    id: "agt_claude_explain_code",
    name: "Claude Code Explain",
    adapter: {
      type: "cli",
      command: "node",
      args: args ?? ["/opt/myagenttool/tools/agents/claude-review-wrapper.mjs", "--mode", "code-explain"],
      outputFormat: "plain_result",
    },
    toolContract: { name: CLAUDE_EXPLAIN_CODE_TOOL_CONTRACT.name },
    capabilities: [{ name: "code_analysis" }],
    status,
    health: { status: "healthy" },
    location: { type: "local_device", deviceId: "dev_local_001" },
  };
}

// --- Governed-agent identity gate ---

test("createClaudeExplainCodeAgentRegistration produces a governed code-explain agent", () => {
  const registration = createClaudeExplainCodeAgentRegistration();
  const agent = {
    id: registration.id,
    adapter: { type: "cli", command: registration.command, args: registration.args, outputFormat: registration.outputFormat },
    toolContract: registration.toolContract,
    capabilities: [{ name: registration.capabilityName }],
  };
  assert.equal(registration.id, "agt_claude_explain_code");
  assert.deepEqual(registration.args, ["tools/agents/claude-review-wrapper.mjs", "--mode", "code-explain"]);
  assert.equal(isGovernedClaudeExplainCodeAgent(agent), true);
});

test("isGovernedClaudeExplainCodeAgent rejects other modes and a foreign wrapper path", () => {
  assert.equal(isGovernedClaudeExplainCodeAgent(governedExplainCodeAgent({
    args: ["/opt/myagenttool/tools/agents/claude-review-wrapper.mjs", "--mode", "diff-explain"],
  })), false, "diff-explain is not the code-explain agent");
  assert.equal(isGovernedClaudeExplainCodeAgent(governedExplainCodeAgent({
    args: ["/tmp/evil/claude-review-wrapper.mjs", "--mode", "code-explain"],
  })), false, "a wrapper outside tools/agents is not governed");
});

// --- The server-side path shape gate ---

test("isSafeWorktreeRelativePath admits plain relative paths and refuses every escape shape", () => {
  assert.equal(isSafeWorktreeRelativePath("src/index.mjs"), true);
  assert.equal(isSafeWorktreeRelativePath("a b/c-d.txt"), true);
  for (const bad of [
    "", "../secrets", "src/../../etc/passwd", "/etc/passwd", "C:/windows/system32",
    "c:\\windows", "src\\index.mjs", "src/./x", "src//x", `bad${"\0"}.txt`, "x/".padEnd(600, "y"),
  ]) {
    assert.equal(isSafeWorktreeRelativePath(bad), false, `must refuse: ${JSON.stringify(bad)}`);
  }
});

// --- Application facade projection ---

test("app_claude projects the explain.code facade beside explain.diff", () => {
  const state = { applications: [] };
  const service = createApplicationService({
    state,
    now,
    nextId: (prefix) => `${prefix}_x`,
    appendEvent: () => {},
    persistStateSoon: () => {},
    addProject: () => null,
    cloneProject: () => null,
    defaultProjectPath: "/tmp/repo",
  });
  const application = service.registerApplication(createClaudeApplicationRegistration({ autoOnline: true }));
  const capability = service.listApplicationCapabilities(application.id)
    .find((item) => item.name === "app.app_claude.explain.code");
  assert.ok(capability, "explain.code capability should be projected");
  assert.equal(capability.kind, "tool_facade");
  assert.equal(capability.metadata.execution.toolName, "claude.explain.code");
  assert.equal(capability.requiresApproval, false);
});

// --- Tool discovery + dispatch + validation ---

function toolServiceWith({ agents = [], projects = [], worktrees = [], apps = [] } = {}) {
  const created = [];
  const state = {
    agents,
    projects,
    worktrees,
    applications: apps,
    currentProjectId: projects[0]?.id ?? null,
    device: { unlinkState: "linked" },
  };
  const service = createToolService({
    state,
    now,
    appendEvent: () => {},
    createInvocation: (task, agent, options) => {
      const invocation = { id: "inv_explain_code", status: "queued", agentId: agent.id, options, task };
      created.push(invocation);
      return invocation;
    },
    startInvocationIfAllowed: () => {},
    findApplication: (id) => apps.find((app) => app.id === id) ?? null,
    findAgent: (id) => agents.find((agent) => agent.id === id) ?? null,
    planApplicationWrapperInvocation: () => ({ ok: false, status: 500, body: { error: "unexpected_plan" } }),
  });
  return { service, state, created };
}

test("claude.explain.code is discoverable only when a governed code-explain agent is present", () => {
  const absent = toolServiceWith({ agents: [] });
  assert.equal(absent.service.getTool("claude.explain.code"), null);

  const present = toolServiceWith({ agents: [governedExplainCodeAgent()], apps: [{ id: CLAUDE_APPLICATION_ID, status: "active" }] });
  const descriptor = present.service.getTool("claude.explain.code");
  assert.ok(descriptor, "descriptor should surface once the agent exists");
  assert.equal(descriptor.outputCollection, "invocations");
  assert.equal(descriptor.agents[0].mode, "code-explain");
  assert.equal(descriptor.inputSchema.required.includes("path"), true);
  assert.equal(descriptor.application.capability, "app.app_claude.explain.code");
});

test("claude.explain.code refuses unknown fields, a missing path, and every unsafe path shape", () => {
  const { service, created } = toolServiceWith({
    agents: [governedExplainCodeAgent()],
    projects: [{ id: "prj_a", ownerTeamId: "team_a" }],
    worktrees: [{ id: "wt_a", projectId: "prj_a" }],
  });
  const actor = { userId: "usr_a", teamId: "team_a" };

  const unknown = service.createToolInvocation("claude.explain.code", { worktreeId: "wt_a", path: "a.mjs", severityFloor: "high" }, actor);
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error, "unknown_field");

  const noPath = service.createToolInvocation("claude.explain.code", { worktreeId: "wt_a" }, actor);
  assert.equal(noPath.status, 400);
  assert.equal(noPath.body.error, "path_required");

  for (const bad of ["../x.mjs", "/etc/passwd", "a/../../x", "a\\b.mjs"]) {
    const res = service.createToolInvocation("claude.explain.code", { worktreeId: "wt_a", path: bad }, actor);
    assert.equal(res.status, 400, `must refuse path ${bad}`);
    assert.equal(res.body.error, "path_invalid");
  }

  const longPath = service.createToolInvocation("claude.explain.code", { worktreeId: "wt_a", path: "a/".padEnd(600, "b") }, actor);
  assert.equal(longPath.body.error, "path_too_long");

  const badRange = service.createToolInvocation("claude.explain.code", { worktreeId: "wt_a", path: "a.mjs", startLine: 9 }, actor);
  assert.equal(badRange.body.error, "line_range_invalid");
  const reversed = service.createToolInvocation("claude.explain.code", { worktreeId: "wt_a", path: "a.mjs", startLine: 9, endLine: 3 }, actor);
  assert.equal(reversed.body.error, "line_range_invalid");

  assert.equal(created.length, 0, "no refusal path creates an invocation");
});

test("claude.explain.code dispatches with the target stamped for bridge argv injection", () => {
  const { service, created } = toolServiceWith({
    agents: [governedExplainCodeAgent()],
    apps: [{ id: CLAUDE_APPLICATION_ID, status: "active" }],
    projects: [{ id: "prj_a", ownerTeamId: "team_a" }],
    worktrees: [{ id: "wt_a", projectId: "prj_a" }],
  });
  const result = service.createToolInvocation(
    "claude.explain.code",
    { projectId: "prj_a", worktreeId: "wt_a", path: "src/auth/session.mjs", symbol: "refreshSession", startLine: 10, endLine: 42, instruction: "Focus on expiry." },
    { userId: "usr_a", teamId: "team_a" },
  );
  assert.equal(result.status, 201);
  assert.equal(result.body.tool, "claude.explain.code");
  assert.equal(result.body.outputCollection, "invocations");
  const metadata = created[0].options.metadata;
  assert.equal(metadata.targetPath, "src/auth/session.mjs");
  assert.equal(metadata.targetSymbol, "refreshSession");
  assert.equal(metadata.targetLines, "10-42");
  assert.equal(metadata.capability, "app.app_claude.explain.code");
  assert.match(created[0].task, /src\/auth\/session\.mjs.*symbol refreshSession.*lines 10-42/);
});

test("claude.explain.code denies a foreign-team worktree before creating an invocation", () => {
  const { service, created } = toolServiceWith({
    agents: [governedExplainCodeAgent()],
    projects: [{ id: "prj_a", ownerTeamId: "team_a" }],
    worktrees: [{ id: "wt_a", projectId: "prj_a" }],
  });
  const result = service.createToolInvocation(
    "claude.explain.code",
    { projectId: "prj_a", worktreeId: "wt_a", path: "a.mjs" },
    { userId: "usr_b", teamId: "team_b" },
  );
  assert.equal(result.status, 404);
  assert.equal(result.body.error, "project_not_found");
  assert.equal(created.length, 0);
});

// --- Wrapper pre-spawn confinement (real filesystem, no Claude binary) ---

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const wrapper = join(repoRoot, "tools/agents/claude-review-wrapper.mjs");

function runWrapper(args) {
  const res = spawnSync(process.execPath, [wrapper, ...args], { cwd: repoRoot, encoding: "utf8" });
  const line = (res.stdout ?? "").split(/\r?\n/).find((l) => l.startsWith("RESULT "));
  assert.ok(line, `expected a RESULT line in:\n${res.stdout}\n${res.stderr}`);
  return { status: res.status, payload: JSON.parse(line.slice("RESULT ".length)) };
}

test("the wrapper refuses a missing, escaping, or absent-on-disk --path before any spawn", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "claude-explain-code-")));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "a.mjs"), "export const a = 1;\n");

  const missing = runWrapper(["--mode", "code-explain", "--cwd", dir]);
  assert.notEqual(missing.status, 0);
  assert.match(missing.payload.output.error, /--path is required/);

  const escape = runWrapper(["--mode", "code-explain", "--cwd", dir, "--path", "../outside.txt"]);
  assert.notEqual(escape.status, 0);
  assert.match(escape.payload.output.error, /escapes the worktree/);

  const absent = runWrapper(["--mode", "code-explain", "--cwd", dir, "--path", "src/nope.mjs"]);
  assert.notEqual(absent.status, 0);
  assert.match(absent.payload.output.error, /does not exist/);

  const badLines = runWrapper(["--mode", "code-explain", "--cwd", dir, "--path", "src/a.mjs", "--lines", "9"]);
  assert.notEqual(badLines.status, 0);
  assert.match(badLines.payload.output.error, /--lines must be/);
  assert.equal(missing.payload.output.tool, "claude.explain.code", "refusals are stamped with the right tool");
});

test("audit: a symlink inside the worktree pointing OUTSIDE it is refused (realpath confinement)", () => {
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "claude-explain-outside-")));
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "claude-explain-symlink-")));
  writeFileSync(join(outside, "secret.txt"), "outside the worktree\n");
  symlinkSync(join(outside, "secret.txt"), join(dir, "innocent.txt"));

  const escaped = runWrapper(["--mode", "code-explain", "--cwd", dir, "--path", "innocent.txt"]);
  assert.notEqual(escaped.status, 0);
  assert.match(escaped.payload.output.error, /resolves \(via symlink\) outside the worktree/);

  // A symlink that stays INSIDE the worktree is fine.
  writeFileSync(join(dir, "real.txt"), "inside\n");
  symlinkSync(join(dir, "real.txt"), join(dir, "alias.txt"));
  const inside = runWrapper(["--mode", "code-explain", "--cwd", dir, "--path", "alias.txt"]);
  // Fails later at the Claude spawn (no CLI in tests) — but NOT at the path gate.
  assert.ok(!/outside the worktree|escapes the worktree/.test(String(inside.payload.output.error ?? "")), "an inside-pointing symlink passes the gate");
});
