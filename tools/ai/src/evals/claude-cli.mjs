// Shared Claude Code CLI invocation for the eval scripts (claude-adapter.mjs,
// claude-provider.mjs).
//
// Extracted from a review-flagged duplication (#245): both scripts carried
// their own env reads, spawnSync call, and ETIMEDOUT handling, and the timeout
// knobs had already forked. The distinct timeout envs/defaults are deliberate
// (a full coding run needs a bigger budget than one structured call) and stay
// at the call sites via `timeoutEnv`/`timeoutDefaultMs`.

import { spawnSync } from "node:child_process";

// Env knobs shared by every caller: MYAGENTTOOL_CLAUDE_CLI (binary, default
// "claude"), MYAGENTTOOL_CLAUDE_MODEL (optional --model override), and
// MYAGENTTOOL_CLAUDE_SETTING_SOURCES (default "user"). Eval calls deliberately
// exclude project/local settings and project-discovered MCP configuration: a
// held-out worktree must measure the coding task, not hooks or connectors from
// the maintainer's active checkout.
export function runClaudeCli({ promptArgs, cwd, timeoutEnv, timeoutDefaultMs }) {
  const cli = process.env.MYAGENTTOOL_CLAUDE_CLI ?? "claude";
  const model = process.env.MYAGENTTOOL_CLAUDE_MODEL ?? "";
  const settingSources = process.env.MYAGENTTOOL_CLAUDE_SETTING_SOURCES?.trim() || "user";
  // Guard the coercion: Number("") is 0 (spawnSync reads 0 as "no timeout")
  // and garbage is NaN (spawnSync throws) — both fall back to the default.
  const timeoutRaw = Number(process.env[timeoutEnv]);
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : timeoutDefaultMs;

  const args = buildClaudeArgs(promptArgs, { model, settingSources });

  const run = spawnSync(cli, args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  return {
    cli,
    model,
    timeoutMs,
    timedOut: run.error?.code === "ETIMEDOUT",
    status: run.status,
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? "",
  };
}

export function buildClaudeArgs(promptArgs, { model = "", settingSources = "user" } = {}) {
  const args = [...promptArgs];
  if (model) args.push("--model", model);
  args.push("--setting-sources", settingSources, "--strict-mcp-config");
  return args;
}

export function inspectClaudeProbeOutput(stdout) {
  try {
    const parsed = JSON.parse(String(stdout ?? ""));
    const models = Object.keys(parsed?.modelUsage ?? {});
    return {
      parsed: true,
      models,
      claudeModelsOnly: models.length > 0
        && models.every((model) => /^claude(?:[-_.]|$)/i.test(model)),
    };
  } catch {
    return { parsed: false, models: [], claudeModelsOnly: false };
  }
}
