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

// Read the issue body (read-only, no opt-in needed — same trust level as the
// console's live gh issue listing). Null on any failure.
export async function runIssueBodyFetch({ cwd, issueNumber, gh = defaultGh }) {
  try {
    const result = await gh(["issue", "view", String(issueNumber), "--json", "body", "--jq", ".body"], cwd);
    const body = String(result?.stdout ?? "").trim();
    return body || null;
  } catch {
    return null;
  }
}

// Read a PR's state (OPEN | MERGED | CLOSED) for the routing evaluation's
// disposition signal. Read-only; null on any failure.
export async function runPrStateFetch({ cwd, prNumber, gh = defaultGh }) {
  try {
    const result = await gh(["pr", "view", String(prNumber), "--json", "state", "--jq", ".state"], cwd);
    const prState = String(result?.stdout ?? "").trim().toUpperCase();
    return ["OPEN", "MERGED", "CLOSED"].includes(prState) ? prState : null;
  } catch {
    return null;
  }
}

function tallyChecks(items, classify) {
  let passed = 0;
  let failed = 0;
  let pending = 0;
  for (const it of items) {
    const kind = classify(it);
    if (kind === "pass") passed += 1;
    else if (kind === "fail") failed += 1;
    else pending += 1;
  }
  const total = items.length;
  const state = total === 0 ? "NONE" : failed > 0 ? "FAILURE" : pending > 0 ? "PENDING" : "SUCCESS";
  return { total, passed, failed, pending, state };
}

// Summarize a PR's CI checks so the console (and the auto-merge gate) can see the
// check posture. Primary path = statusCheckRollup (needs the token's Checks:read).
// FALLBACK = GitHub Actions runs by the PR's head SHA — works when the token can
// read Actions but not the Checks API (a fine-grained PAT without Checks:read, or
// a private repo), so the auto-merge gate isn't permanently blind on such tokens.
// Never throws; null on total failure. state: NONE | SUCCESS | FAILURE | PENDING.
export async function runPrChecks({ cwd, prNumber, gh = defaultGh }) {
  try {
    const result = await gh(["pr", "view", String(prNumber), "--json", "statusCheckRollup"], cwd);
    const rollup = JSON.parse(result?.stdout ?? "{}")?.statusCheckRollup ?? [];
    if (rollup.length > 0) {
      return tallyChecks(rollup, (check) => {
        const s = String(check?.conclusion || check?.state || check?.status || "").toUpperCase();
        if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(s)) return "pass";
        if (["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(s)) return "fail";
        return "pending"; // IN_PROGRESS / QUEUED / PENDING / EXPECTED / ""
      });
    }
    // Empty rollup: could be genuinely no checks, or the token couldn't read them.
    // Confirm via the Actions fallback before reporting NONE.
  } catch {
    /* rollup forbidden / gh error → try the Actions fallback */
  }
  try {
    const repoMeta = JSON.parse((await gh(["repo", "view", "--json", "nameWithOwner"], cwd))?.stdout ?? "{}");
    const nameWithOwner = repoMeta?.nameWithOwner;
    const sha = JSON.parse((await gh(["pr", "view", String(prNumber), "--json", "headRefOid"], cwd))?.stdout ?? "{}")?.headRefOid;
    if (!nameWithOwner || !sha) return null;
    const runs = JSON.parse((await gh(["api", `repos/${nameWithOwner}/actions/runs?head_sha=${sha}&per_page=100`], cwd))?.stdout ?? "{}")?.workflow_runs ?? [];
    // Dedup: the Actions API returns EVERY run for a SHA (re-runs, per-event), so
    // a failed-then-rerun-green workflow yields both records and would tally
    // FAILURE. Keep only the latest run per workflow (by run_number). (audit)
    const latest = new Map();
    runs.forEach((r, i) => {
      // Dedup only runs that share a real workflow identity; runs with no
      // workflow_id are kept distinct (never collapse unrelated checks).
      const key = r?.workflow_id != null ? `wf:${r.workflow_id}:${r?.event ?? ""}` : `run:${r?.id ?? i}`;
      const prev = latest.get(key);
      if (!prev || Number(r?.run_number ?? 0) >= Number(prev?.run_number ?? 0)) latest.set(key, r);
    });
    const actions = tallyChecks([...latest.values()], (r) => {
      if (r?.status !== "completed") return "pending"; // queued / in_progress
      const c = String(r?.conclusion || "").toLowerCase();
      if (["success", "neutral", "skipped"].includes(c)) return "pass";
      if (["failure", "cancelled", "timed_out", "action_required", "startup_failure"].includes(c)) return "fail";
      return "pending";
    });
    // The Actions API is blind to external/commit-status checks — an affirmative
    // SUCCESS from Actions alone could hide a red third-party check. Fold in the
    // commit statuses (readable with this token shape) so an external failure/
    // pending downgrades the verdict. (audit)
    let status = { state: null, total: 0 };
    try {
      status = JSON.parse((await gh(["api", `repos/${nameWithOwner}/commits/${sha}/status`], cwd))?.stdout ?? "{}");
    } catch {
      /* statuses unreadable → rely on Actions alone */
    }
    const stState = String(status?.state ?? "").toLowerCase();
    if (stState === "failure" || stState === "error") {
      return { total: actions.total + (status.total_count ?? 1), passed: actions.passed, failed: actions.failed + 1, pending: actions.pending, state: "FAILURE" };
    }
    if (stState === "pending" && Number(status?.total_count ?? 0) > 0 && actions.state !== "FAILURE") {
      return { total: actions.total + status.total_count, passed: actions.passed, failed: actions.failed, pending: actions.pending + status.total_count, state: "PENDING" };
    }
    return actions;
  } catch {
    return null;
  }
}

// Human-triggered PR merge from the console (the merge stays human — this is a
// person clicking Merge in the tool, never an automatic step). Runs
// `gh pr merge <n> --<method>` in the project repo. Never throws; returns a
// structured result the caller turns into prState = MERGED on success.
export async function runPrMerge({ cwd, prNumber, method = "squash", gh = defaultGh }) {
  const allowed = ["squash", "merge", "rebase"].includes(method) ? method : "squash";
  try {
    await gh(["pr", "merge", String(prNumber), `--${allowed}`], cwd);
    return { ok: true, prNumber, method: allowed };
  } catch (error) {
    return { ok: false, prNumber, error: String(error?.stderr ?? error?.message ?? error).trim() };
  }
}

// Post a comment on the issue — used to deliver an investigation auto-run's
// findings back to the issue. Never throws; returns a structured result.
export async function runIssueComment({ cwd, issueNumber, body, gh = defaultGh }) {
  try {
    await gh(["issue", "comment", String(issueNumber), "--body", body], cwd);
    return { ok: true, issueNumber };
  } catch (error) {
    return { ok: false, issueNumber, error: String(error?.stderr ?? error?.message ?? error).trim() };
  }
}

async function defaultGh(args, cwd) {
  return execFileAsync("gh", args, { cwd, encoding: "utf8", timeout: 15_000, env: { ...process.env, GH_PROMPT_DISABLED: "1" } });
}
