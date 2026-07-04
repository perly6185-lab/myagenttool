import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Phase 4: issue status writeback. As an auto-run advances, move the issue's
// status label forward (ready -> in-progress -> review) so the Project board
// reflects the work. Writing to GitHub is an outward-facing side effect, so it
// is OFF by default and opt-in via MYAGENTTOOL_AUTORUN_STATUS_WRITEBACK. Best
// effort: a gh failure never breaks the auto-run.
//
// This moves the label (the governance source of truth); syncing the ProjectV2
// board field needs project scope and stays with github:sync-project.

const STATUS_TRANSITIONS = {
  "in-progress": { add: ["status/in-progress"], remove: ["status/ready", "status/backlog"] },
  review: { add: ["status/review"], remove: ["status/in-progress"] },
};

export function resolveStatusWritebackConfig(env = process.env) {
  const flag = env.MYAGENTTOOL_AUTORUN_STATUS_WRITEBACK;
  return { enabled: flag === "1" || flag === "true" };
}

export function statusTransitionLabels(to) {
  return STATUS_TRANSITIONS[to] ?? null;
}

// Run `gh issue edit <n> --add-label ... --remove-label ...` in the repo. Never
// throws; returns a structured result the caller can log.
export async function runIssueStatusTransition({ cwd, issueNumber, to, gh = defaultGh }) {
  const labels = statusTransitionLabels(to);
  if (!labels) return { ok: false, skipped: true, reason: `unknown status "${to}"` };
  const args = ["issue", "edit", String(issueNumber)];
  for (const label of labels.add) args.push("--add-label", label);
  for (const label of labels.remove) args.push("--remove-label", label);
  try {
    await gh(args, cwd);
    return { ok: true, issueNumber, to, args };
  } catch (error) {
    return { ok: false, issueNumber, to, error: String(error?.stderr ?? error?.message ?? error).trim() };
  }
}

async function defaultGh(args, cwd) {
  return execFileAsync("gh", args, { cwd, encoding: "utf8", timeout: 15_000, env: { ...process.env, GH_PROMPT_DISABLED: "1" } });
}
