import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  applyClaudeCliResumeArgs,
  claudePermissionRequestSummary,
  claudeSdkCompletionResult,
  claudeSdkExecutionPreview,
  claudeSdkWorkspaceBoundary,
  createClaudeSdkCallbacks,
  createClaudeSdkExecutionPlan,
  evaluateClaudeSdkToolUse,
  isClaudeSdkRuntime,
  resolveClaudeRuntime,
  runClaudeSdkQuery,
  validateClaudeSdkExecutionPlan,
} from "../src/claude-sdk-runtime.mjs";

test("Claude Agent SDK transport is default and adapter-local rollback wins", () => {
  assert.equal(resolveClaudeRuntime({}, {}), "agent_sdk");
  assert.equal(resolveClaudeRuntime({}, { MYAGENTTOOL_CLAUDE_RUNTIME: "agent_sdk" }), "agent_sdk");
  assert.equal(
    resolveClaudeRuntime(
      { claudeRuntime: "cli" },
      { MYAGENTTOOL_CLAUDE_RUNTIME: "agent_sdk" },
    ),
    "cli",
  );
  assert.equal(
    resolveClaudeRuntime(
      { claudeRuntime: "agent_sdk" },
      { MYAGENTTOOL_CLAUDE_RUNTIME: "cli" },
    ),
    "cli",
  );
  assert.equal(
    isClaudeSdkRuntime(
      { command: "C:\\tools\\claude.exe" },
      { MYAGENTTOOL_CLAUDE_RUNTIME: "sdk" },
    ),
    true,
  );
  assert.equal(
    isClaudeSdkRuntime(
      { command: "codex" },
      { MYAGENTTOOL_CLAUDE_RUNTIME: "sdk" },
    ),
    false,
  );
});

test("gate allows supported modes inside the approved worktree", () => {
  const root = mkdtempSync(join(tmpdir(), "claude-sdk-plan-"));
  try {
    const plan = createClaudeSdkExecutionPlan({
      cwd: root,
      permissionMode: "plan",
      env: { USERPROFILE: "C:\\Users\\demo" },
      timeoutMs: 30_000,
      approvedRoots: [root],
    });
    const gate = validateClaudeSdkExecutionPlan(plan, { approvedRoots: [root] });
    assert.equal(gate.allowed, true, gate.reason);
    assert.deepEqual(claudeSdkExecutionPreview(plan), {
      runtime: "agent_sdk",
      commandLine: "Claude Agent SDK query()",
      cwd: root,
      permissionMode: "plan",
      executableSource: "sdk_bundled",
      sessionMode: "new",
      resuming: false,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("worktree boundary never additionally approves or falls back to the main checkout", () => {
  const project = mkdtempSync(join(tmpdir(), "claude-sdk-project-"));
  const worktree = mkdtempSync(join(tmpdir(), "claude-sdk-worktree-"));
  const missingWorktree = join(project, "deleted-worktree");
  try {
    const boundary = claudeSdkWorkspaceBoundary({
      projectPath: project,
      worktreePath: worktree,
    });
    assert.equal(boundary.cwd, worktree);
    assert.deepEqual(boundary.approvedRoots, [worktree]);

    const missing = claudeSdkWorkspaceBoundary({
      projectPath: project,
      worktreePath: missingWorktree,
    });
    const gate = validateClaudeSdkExecutionPlan(createClaudeSdkExecutionPlan({
      cwd: missing.cwd,
      permissionMode: "acceptEdits",
      approvedRoots: missing.approvedRoots,
    }));
    assert.equal(gate.allowed, false);
    assert.match(gate.reason, /existing working directory/i);
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(worktree, { recursive: true, force: true });
  }
});

test("gate allows writable mode but refuses cwd escape and missing scope", () => {
  const root = mkdtempSync(join(tmpdir(), "claude-sdk-root-"));
  const outside = mkdtempSync(join(tmpdir(), "claude-sdk-outside-"));
  try {
    const writable = validateClaudeSdkExecutionPlan(
      createClaudeSdkExecutionPlan({ cwd: root, permissionMode: "acceptEdits" }),
      { approvedRoots: [root] },
    );
    assert.equal(writable.allowed, true, writable.reason);

    const escaped = validateClaudeSdkExecutionPlan(
      createClaudeSdkExecutionPlan({ cwd: outside, permissionMode: "plan" }),
      { approvedRoots: [root] },
    );
    assert.equal(escaped.allowed, false);
    assert.equal(escaped.evidence.refusalCode, "cwd_outside_approved_root");

    const unscoped = validateClaudeSdkExecutionPlan(
      createClaudeSdkExecutionPlan({ cwd: root, permissionMode: "plan" }),
    );
    assert.equal(unscoped.allowed, false);
    assert.equal(unscoped.evidence.refusalCode, "claude_sdk_root_required");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("tool policy confines file tools and keeps plan read-only", () => {
  const root = mkdtempSync(join(tmpdir(), "claude-sdk-tools-"));
  const outside = mkdtempSync(join(tmpdir(), "claude-sdk-tools-outside-"));
  try {
    assert.equal(evaluateClaudeSdkToolUse({
      toolName: "Read",
      input: { file_path: join(root, "README.md") },
      permissionMode: "plan",
      cwd: root,
      approvedRoots: [root],
    }).allowed, true);
    assert.equal(evaluateClaudeSdkToolUse({
      toolName: "Write",
      input: { file_path: join(root, "new.txt") },
      permissionMode: "plan",
      cwd: root,
      approvedRoots: [root],
    }).allowed, false);
    assert.equal(evaluateClaudeSdkToolUse({
      toolName: "Edit",
      input: { file_path: join(outside, "escape.txt") },
      permissionMode: "acceptEdits",
      cwd: root,
      approvedRoots: [root],
    }).allowed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("ask mode routes unresolved tools through the approval callback", async () => {
  const root = mkdtempSync(join(tmpdir(), "claude-sdk-approval-"));
  const requests = [];
  try {
    const plan = createClaudeSdkExecutionPlan({
      cwd: root,
      permissionMode: "ask",
      approvedRoots: [root],
    });
    const callbacks = createClaudeSdkCallbacks({
      plan,
      requestApproval: async (request) => {
        requests.push(request);
        return "approved";
      },
    });
    const result = await callbacks.canUseTool("Bash", { command: "git status" }, {
      toolUseID: "tool_1",
      signal: new AbortController().signal,
    });
    assert.equal(result.behavior, "allow");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].toolUseId, "tool_1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("approve-for-me auto-allows confined edits but still brokers Bash", async () => {
  const root = mkdtempSync(join(tmpdir(), "claude-sdk-auto-"));
  let approvals = 0;
  try {
    const callbacks = createClaudeSdkCallbacks({
      plan: createClaudeSdkExecutionPlan({
        cwd: root,
        permissionMode: "acceptEdits",
        approvedRoots: [root],
      }),
      requestApproval: async () => {
        approvals += 1;
        return "approved";
      },
    });
    assert.equal((await callbacks.canUseTool(
      "Edit",
      { file_path: join(root, "src.mjs") },
      { toolUseID: "edit_1" },
    )).behavior, "allow");
    assert.equal(approvals, 0);
    assert.equal((await callbacks.canUseTool(
      "Bash",
      { command: "pnpm test" },
      { toolUseID: "bash_1" },
    )).behavior, "allow");
    assert.equal(approvals, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("approval summary includes the Bash command and redacts common credentials", () => {
  const summary = claudePermissionRequestSummary({
    toolName: "Bash",
    title: "Run command",
    input: {
      command: "API_TOKEN=top-secret Remove-Item -Recurse C:\\repo --password hunter2",
    },
  });
  assert.match(summary, /Remove-Item -Recurse/);
  assert.doesNotMatch(summary, /top-secret|hunter2/);
  assert.match(summary, /<redacted>/);
});

test("successful mutating hooks make the terminal result report touched files", async () => {
  const root = mkdtempSync(join(tmpdir(), "claude-sdk-touch-"));
  const roundState = { touchedUserFiles: false };
  const observed = [];
  try {
    const callbacks = createClaudeSdkCallbacks({
      plan: createClaudeSdkExecutionPlan({
        cwd: root,
        permissionMode: "acceptEdits",
        approvedRoots: [root],
      }),
      onHook: async (hook) => {
        observed.push(hook);
        if (hook.mayHaveTouchedUserFiles) roundState.touchedUserFiles = true;
      },
    });
    await callbacks.hooks.PostToolUse[0].hooks[0]({
      hook_event_name: "PostToolUse",
      tool_name: "Write",
      tool_input: { file_path: join(root, "created.txt") },
      tool_response: "ok",
      tool_use_id: "write_1",
    });
    const result = claudeSdkCompletionResult(
      { summary: "Created file.", touchedUserFiles: false },
      roundState,
      { runtime: "agent_sdk" },
    );
    assert.equal(observed[0].eventName, "PostToolUse");
    assert.equal(result.touchedUserFiles, true);
    assert.equal(result.runtime, "agent_sdk");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runClaudeSdkQuery streams messages and captures terminal result", async () => {
  const root = mkdtempSync(join(tmpdir(), "claude-sdk-query-"));
  const received = [];
  const queryCalls = [];
  let closed = false;
  const messages = [
    { type: "system", subtype: "init", session_id: "sess_1" },
    { type: "assistant", message: { content: [{ type: "text", text: "Reviewed." }] }, session_id: "sess_1" },
    {
      type: "result",
      subtype: "success",
      result: "Done.",
      session_id: "sess_1",
      total_cost_usd: 0.01,
      usage: { input_tokens: 10, output_tokens: 2 },
    },
  ];
  try {
    const plan = createClaudeSdkExecutionPlan({
      cwd: root,
      permissionMode: "plan",
      env: { HOME: "/tmp/demo" },
      approvedRoots: [root],
    });
    const result = await runClaudeSdkQuery({
      prompt: "Review this project",
      plan,
      loadSdk: async () => ({
        query(params) {
          queryCalls.push(params);
          return {
            async *[Symbol.asyncIterator]() {
              yield* messages;
            },
            close() {
              closed = true;
            },
          };
        },
      }),
      onMessage: async (message) => received.push(message),
    });

    assert.equal(queryCalls.length, 1);
    assert.equal(queryCalls[0].prompt, "Review this project");
    assert.equal(queryCalls[0].options.cwd, root);
    assert.equal(queryCalls[0].options.permissionMode, "plan");
    assert.equal(typeof queryCalls[0].options.canUseTool, "function");
    assert.equal(typeof queryCalls[0].options.hooks.PostToolUse[0].hooks[0], "function");
    assert.equal(typeof queryCalls[0].options.hooks.FileChanged[0].hooks[0], "function");
    assert.equal(queryCalls[0].options.persistSession, true);
    assert.deepEqual(queryCalls[0].options.env, { HOME: "/tmp/demo" });
    assert.deepEqual(received, messages);
    assert.equal(result.sessionId, "sess_1");
    assert.equal(result.resultMessage.result, "Done.");
    assert.equal(closed, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("exact session resume is validated and passed to SDK query()", async () => {
  const root = mkdtempSync(join(tmpdir(), "claude-sdk-resume-"));
  const sessionId = "123e4567-e89b-42d3-a456-426614174001";
  let options = null;
  try {
    const plan = createClaudeSdkExecutionPlan({
      cwd: root,
      permissionMode: "plan",
      approvedRoots: [root],
      resumeSessionId: sessionId,
    });
    assert.equal(validateClaudeSdkExecutionPlan(plan).allowed, true);
    assert.equal(claudeSdkExecutionPreview(plan).sessionMode, "resume_exact");
    assert.equal(claudeSdkExecutionPreview(plan).resuming, true);
    assert.equal("resumeSessionId" in claudeSdkExecutionPreview(plan), false);
    await runClaudeSdkQuery({
      prompt: "Continue",
      plan,
      loadSdk: async () => ({
        query(params) {
          options = params.options;
          return {
            async *[Symbol.asyncIterator]() {
              yield { type: "result", subtype: "success", session_id: sessionId };
            },
            close() {},
          };
        },
      }),
    });
    assert.equal(options.resume, sessionId);
    assert.equal(options.continue, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI rollback resumes only an exact validated Claude session id", () => {
  const sessionId = "123e4567-e89b-42d3-a456-426614174001";
  assert.deepEqual(
    applyClaudeCliResumeArgs(["-p", "Continue"], {
      claudeSessionMode: "continue_last",
      claudeResumeSessionId: sessionId,
    }),
    ["-p", "Continue", "--resume", sessionId],
  );
  assert.deepEqual(
    applyClaudeCliResumeArgs(["-p", "Continue"], {
      claudeSessionMode: "continue_last",
      claudeResumeSessionId: "bad --flag",
    }),
    ["-p", "Continue"],
  );
});
