import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { childProcessErrorMessage } from "./worktree.mjs";

export function runLoopWorktreePromotionPrCreateCommand(prCreatePrep, { repoRoot, truncate }) {
  const startedAt = new Date().toISOString();
  let ghCommand;
  try {
    ghCommand = resolveLoopWorktreePromotionPrCreateCommand();
  } catch (error) {
    const completedAt = new Date().toISOString();
    return emptyGhResult({ startedAt, completedAt, error: error.message });
  }
  const args = [
    ...ghCommand.args,
    "pr",
    "create",
    "--base",
    prCreatePrep.baseBranch,
    "--head",
    prCreatePrep.headBranch,
    "--title",
    prCreatePrep.title,
    "--body-file",
    resolve(repoRoot, prCreatePrep.bodyFile),
    "--json",
    "number,url,state",
  ];
  return runGhCommand({ ghCommand, args, cwd: prCreatePrep.integrationWorktreePath, startedAt, truncate });
}

export function runLoopWorktreePromotionGhCommand(context, commandArgs, { truncate }) {
  const startedAt = new Date().toISOString();
  let ghCommand;
  try {
    ghCommand = resolveLoopWorktreePromotionPrCreateCommand();
  } catch (error) {
    const completedAt = new Date().toISOString();
    return emptyGhResult({ startedAt, completedAt, error: error.message });
  }
  const args = [...ghCommand.args, ...commandArgs];
  return runGhCommand({ ghCommand, args, cwd: context.integrationWorktreePath, startedAt, truncate });
}

export function normalizeLoopWorktreePromotionMergeMethod(method) {
  const normalized = String(method ?? "").toLowerCase();
  return ["squash", "merge", "rebase"].includes(normalized) ? normalized : null;
}

export function runLoopWorktreePromotionPrMergeCommand(context, mergeMethod, { truncate }) {
  const methodFlag = `--${mergeMethod}`;
  return runLoopWorktreePromotionGhCommand(context, [
    "pr",
    "merge",
    String(context.prNumber),
    methodFlag,
  ], { truncate });
}

export function parseLoopWorktreePromotionGhPrCreateOutput(stdout) {
  const text = stdout.trim();
  if (!text) return { number: null, url: null, state: null, raw: "" };
  try {
    const parsed = JSON.parse(text);
    return {
      number: parsed.number ?? null,
      url: parsed.url ?? null,
      state: parsed.state ?? null,
      raw: text,
    };
  } catch {
    const urlMatch = text.match(/https?:\/\/\S+/);
    return {
      number: null,
      url: urlMatch?.[0] ?? null,
      state: null,
      raw: text,
    };
  }
}

export function parseLoopWorktreePromotionGhJsonObject(stdout) {
  const text = stdout.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function parseLoopWorktreePromotionGhJsonArray(stdout) {
  const text = stdout.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function assessLoopWorktreePromotionPrMergePrep({ prCreateExecute, remoteHead, prView, prViewData, checks, checksData, allowNoChecks }) {
  const blockers = [];
  if (remoteHead !== prCreateExecute.commitSha) blockers.push("remote-head-mismatch");
  if (prView.exitCode !== 0) blockers.push("gh-pr-view-failed");
  if (!prViewData) blockers.push("gh-pr-view-invalid-json");
  if (checks.exitCode !== 0) blockers.push("gh-pr-checks-failed");
  if (checks.exitCode === 0 && !Array.isArray(checksData)) blockers.push("gh-pr-checks-invalid-json");
  if (prViewData) {
    if (!hasLoopWorktreePromotionValue(prViewData.number)) blockers.push("pr-number-missing");
    else if (String(prViewData.number) !== String(prCreateExecute.prNumber)) blockers.push("pr-number-mismatch");
    if (!hasLoopWorktreePromotionValue(prViewData.url)) blockers.push("pr-url-missing");
    else if (prViewData.url !== prCreateExecute.prUrl) blockers.push("pr-url-mismatch");
    if (!hasLoopWorktreePromotionValue(prViewData.state)) blockers.push("pr-state-missing");
    else if (prViewData.state !== "OPEN") blockers.push("pr-not-open");
    if (typeof prViewData.isDraft !== "boolean") blockers.push("pr-draft-state-missing");
    else if (prViewData.isDraft === true) blockers.push("pr-is-draft");
    if (!hasLoopWorktreePromotionValue(prViewData.headRefName)) blockers.push("pr-head-branch-missing");
    else if (prViewData.headRefName !== prCreateExecute.headBranch) blockers.push("pr-head-branch-mismatch");
    if (!hasLoopWorktreePromotionValue(prViewData.baseRefName)) blockers.push("pr-base-branch-missing");
    else if (prViewData.baseRefName !== prCreateExecute.baseBranch) blockers.push("pr-base-branch-mismatch");
    if (!hasLoopWorktreePromotionValue(prViewData.headRefOid)) blockers.push("pr-head-commit-missing");
    else if (prViewData.headRefOid !== prCreateExecute.commitSha) blockers.push("pr-head-commit-mismatch");
    if (!hasLoopWorktreePromotionValue(prViewData.mergeable)) blockers.push("pr-mergeable-missing");
    else if (!["MERGEABLE", "UNKNOWN"].includes(String(prViewData.mergeable))) blockers.push("pr-not-mergeable");
  }
  const normalizedChecksData = Array.isArray(checksData) ? checksData : [];
  const failedChecks = normalizedChecksData.filter((check) => !isPassingLoopWorktreePromotionPrCheck(check));
  if (checks.exitCode === 0 && normalizedChecksData.length === 0 && !allowNoChecks) blockers.push("pr-checks-missing");
  if (failedChecks.length > 0) blockers.push("pr-checks-not-passing");
  return {
    status: blockers.length === 0 ? "ready" : "blocked",
    reason: blockers.length === 0 ? null : `Promotion PR merge prep blocked: ${blockers.join(", ")}.`,
    blockers,
  };
}

export function isPassingLoopWorktreePromotionPrCheck(check) {
  const state = String(check?.state ?? check?.bucket ?? "").toUpperCase();
  return ["SUCCESS", "PASSING", "PASSED", "SKIPPED", "NEUTRAL"].includes(state);
}

export function normalizeLoopWorktreePromotionGhResult(result) {
  return result ?? {
    command: null,
    executable: null,
    args: [],
    startedAt: null,
    completedAt: null,
    exitCode: null,
    signal: null,
    error: null,
    stdoutBytes: 0,
    stderrBytes: 0,
    stdout: "",
    stderr: "",
  };
}

function resolveLoopWorktreePromotionPrCreateCommand() {
  const rawJson = process.env.MYAGENTTOOL_GH_COMMAND_JSON;
  if (rawJson) {
    let parsed;
    try {
      parsed = JSON.parse(rawJson);
    } catch (error) {
      throw new Error(`MYAGENTTOOL_GH_COMMAND_JSON must be JSON, for example ["gh"]. Parse error: ${error.message}`);
    }
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((item) => typeof item !== "string" || item.length === 0)) {
      throw new Error('MYAGENTTOOL_GH_COMMAND_JSON must be a non-empty string array, for example ["gh"].');
    }
    const [command, ...args] = parsed;
    return { command, args };
  }
  return { command: process.env.MYAGENTTOOL_GH_COMMAND || "gh", args: [] };
}

function runGhCommand({ ghCommand, args, cwd, startedAt, truncate }) {
  const result = spawnSync(ghCommand.command, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GH_PROMPT_DISABLED: "1",
    },
  });
  const completedAt = new Date().toISOString();
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return {
    command: [ghCommand.command, ...args].join(" "),
    executable: ghCommand.command,
    args,
    startedAt,
    completedAt,
    exitCode: result.status ?? (result.error ? 1 : 0),
    signal: result.signal ?? null,
    error: result.error ? childProcessErrorMessage(result.error) : null,
    stdoutBytes: Buffer.byteLength(stdout, "utf8"),
    stderrBytes: Buffer.byteLength(stderr, "utf8"),
    stdout: truncate(stdout.trim(), 4000),
    stderr: truncate(stderr.trim(), 4000),
  };
}

function emptyGhResult({ startedAt, completedAt, error }) {
  return {
    command: null,
    executable: null,
    args: [],
    startedAt,
    completedAt,
    exitCode: 1,
    signal: null,
    error,
    stdoutBytes: 0,
    stderrBytes: 0,
    stdout: "",
    stderr: "",
  };
}

function hasLoopWorktreePromotionValue(value) {
  return value !== null && value !== undefined && String(value).length > 0;
}
