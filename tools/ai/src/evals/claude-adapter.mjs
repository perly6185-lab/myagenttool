#!/usr/bin/env node
// Claude Code CLI coding adapter (held-out eval path).
//
// Implements the trusted coding-adapter contract for `ai:work-runner`: runs in
// the work-runner's cwd (the isolated eval worktree), asks the Claude Code CLI
// to implement the held-out case spec with edit-only tools, and writes
// adapter-result.json evidence. Wire it up as:
//
//   MYAGENTTOOL_CODING_ADAPTER=claude \
//   MYAGENTTOOL_CLAUDE_COMMAND_JSON='["node","tools/ai/src/evals/claude-adapter.mjs"]' \
//   pnpm ai:eval-heldout -- --set tools/ai/evals/heldout-real --resolver command \
//     --resolver-command-json '["node","tools/ai/src/evals/work-runner-resolver.mjs"]'
//
// The task spec comes from MYAGENTTOOL_HELDOUT_CASE (forwarded by the
// resolver), not from the generic code plan — the case IS the issue. Oracle
// fields (expectedFiles/forbiddenFiles) are deliberately NOT shown to the
// agent; finding the right files is the capability under test.
//
// Env:
//   MYAGENTTOOL_CLAUDE_CLI       CLI binary (default "claude")
//   MYAGENTTOOL_CLAUDE_MODEL     optional --model override
//   MYAGENTTOOL_CLAUDE_TIMEOUT_MS  per-case budget (default 600000)

import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const CONTRACT_VERSION = "2026-06-19";

function main() {
  const evidenceDir = process.env.MYAGENTTOOL_WORK_EVIDENCE_DIR;
  if (!evidenceDir) throw new Error("MYAGENTTOOL_WORK_EVIDENCE_DIR is required (run via ai:work-runner).");
  const caseRaw = process.env.MYAGENTTOOL_HELDOUT_CASE;
  if (!caseRaw) throw new Error("MYAGENTTOOL_HELDOUT_CASE is required (run via the held-out resolver).");
  const caseObj = JSON.parse(caseRaw);

  const cli = process.env.MYAGENTTOOL_CLAUDE_CLI ?? "claude";
  const model = process.env.MYAGENTTOOL_CLAUDE_MODEL ?? "";
  const timeoutMs = Number(process.env.MYAGENTTOOL_CLAUDE_TIMEOUT_MS ?? 600000);

  const prompt = [
    `You are working in a git worktree of this repository (possibly at a past commit). Implement the following change.`,
    ``,
    `Title: ${caseObj.title}`,
    ``,
    `Task: ${caseObj.spec}`,
    ``,
    `Rules:`,
    `- Locate the right file(s) yourself and edit them in place.`,
    `- Keep the change minimal and scoped to the task; do not refactor unrelated code.`,
    `- Do not run git commands, do not commit, do not create branches.`,
    `- When you are done editing, reply with a one-line summary.`,
  ].join("\n");

  const args = [
    "-p", prompt,
    "--allowedTools", "Read,Glob,Grep,Edit,Write",
    "--permission-mode", "acceptEdits",
  ];
  if (model) args.push("--model", model);

  const startedAt = new Date().toISOString();
  const run = spawnSync(cli, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  const changedFiles = collectChangedFiles(process.cwd());
  const timedOut = run.error?.code === "ETIMEDOUT";
  const ok = !timedOut && run.status === 0;
  const summary = ok
    ? `Claude CLI completed: ${lastLine(run.stdout) || "(no summary line)"}`
    : timedOut
      ? `Claude CLI timed out after ${timeoutMs}ms.`
      : `Claude CLI exited ${run.status ?? "unknown"}.`;

  writeFileSync(resolve(evidenceDir, "adapter-result.json"), `${JSON.stringify({
    adapter: "claude",
    contractVersion: CONTRACT_VERSION,
    status: ok ? "completed" : "failed",
    summary,
    changedFiles,
    commandsRun: [`${cli} -p <prompt> --allowedTools Read,Glob,Grep,Edit,Write --permission-mode acceptEdits${model ? ` --model ${model}` : ""}`],
    risks: ["Model-authored edits; the held-out oracle and human review judge the result."],
    completedAt: new Date().toISOString(),
    startedAt,
  }, null, 2)}\n`, "utf8");

  process.stdout.write(`${summary}\n`);
  if (!ok) {
    process.stderr.write((run.stderr ?? "").slice(-2000));
    process.exit(1);
  }
}

function collectChangedFiles(cwd) {
  const tracked = gitLines(["diff", "--name-only"], cwd);
  const untracked = gitLines(["ls-files", "--others", "--exclude-standard"], cwd);
  return [...new Set([...tracked, ...untracked])]
    .map((path) => path.replace(/\\/g, "/"))
    .filter((path) => !path.startsWith(".myagenttool/"))
    .sort();
}

function gitLines(args, cwd) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
      .split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function lastLine(text) {
  const lines = String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
}
