import { spawnSync } from "node:child_process";

import { childProcessErrorMessage, gitOutputForRoot } from "./worktree.mjs";

export function buildLoopPromotionPushPlanRisks({ remote, remoteUrl, remoteNames, branch }) {
  const risks = [];
  if (!remoteNames.includes(remote)) risks.push(`Remote not configured: ${remote}`);
  if (!remoteUrl.trim()) risks.push(`Remote URL not available for ${remote}`);
  if (!/^[-./A-Za-z0-9_]+$/.test(branch ?? "")) risks.push(`Integration branch has unusual characters: ${branch ?? "missing"}`);
  if (!branch?.startsWith("loop/promotion/")) risks.push(`Integration branch does not use loop/promotion prefix: ${branch ?? "missing"}`);
  return risks;
}

export function runLoopWorktreePromotionPushPreflightChecks(pushPlan, { includeDryRun, worktreePath, truncate }) {
  const checks = [
    {
      id: "remote-url",
      description: "Confirm the configured remote URL is still available.",
      args: ["remote", "get-url", pushPlan.remote],
    },
    {
      id: "remote-head",
      description: "Read remote branch state without modifying the remote.",
      args: ["ls-remote", "--heads", pushPlan.remote, pushPlan.integrationBranch],
    },
  ];
  if (includeDryRun) {
    checks.push({
      id: "push-dry-run",
      description: "Run git push --dry-run for the planned refspec.",
      args: ["push", "--dry-run", pushPlan.remote, pushPlan.refspec],
    });
  }
  return checks.map((check) => runLoopWorktreePromotionPushPreflightCheck(worktreePath, check, { truncate }));
}

export function runLoopWorktreePromotionPushExecuteCommand(worktreePath, preflight, { truncate }) {
  const startedAt = new Date().toISOString();
  const args = ["push", preflight.remote, preflight.refspec];
  const result = spawnSync("git", args, {
    cwd: worktreePath,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  const completedAt = new Date().toISOString();
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return {
    command: ["git", ...args].join(" "),
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

export function readLoopWorktreePromotionRemoteHead(worktreePath, preflight) {
  try {
    const branch = preflight.integrationBranch ?? preflight.headBranch;
    if (!branch) return null;
    const output = gitOutputForRoot(worktreePath, ["ls-remote", "--heads", preflight.remote, branch]);
    const first = output.split(/\r?\n/).find(Boolean);
    return first?.split(/\s+/)[0] ?? null;
  } catch {
    return null;
  }
}

function runLoopWorktreePromotionPushPreflightCheck(worktreePath, check, { truncate }) {
  const startedAt = new Date().toISOString();
  const result = spawnSync("git", check.args, {
    cwd: worktreePath,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  const completedAt = new Date().toISOString();
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return {
    id: check.id,
    description: check.description,
    command: ["git", ...check.args].join(" "),
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
