import { branchFromIssue } from "@myagenttool/protocol/issue-prompt";

// Phase 3: auto-trigger. Periodically scan repo-backed projects for open issues
// carrying an opt-in label and start an auto-run for each new one. Safety model:
// - OFF by default (must be enabled via env).
// - Per-issue opt-in: only issues with the configured label are considered.
// - Dedup: an issue that already has any auto-run (in any state) is never
//   re-triggered, so a merged/blocked issue can't respawn every tick.
// - Bounded: a per-project cap on concurrently-active auto-runs.
// startAutoRun still enforces the local-approval and budget gates, so triggering
// never bypasses them. Merge stays human.

const ACTIVE_STATUSES = new Set(["materializing", "running", "awaiting_approval", "verifying", "publishing"]);

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function resolveAutoTriggerConfig(env = process.env) {
  const flag = env.MYAGENTTOOL_AUTOTRIGGER_ENABLED;
  return {
    enabled: flag === "1" || flag === "true",
    label: env.MYAGENTTOOL_AUTOTRIGGER_LABEL || "auto",
    maxConcurrent: clampInt(env.MYAGENTTOOL_AUTOTRIGGER_MAX_CONCURRENT, 1, 1, 10),
    // Only auto-run issues that carry `## Project Fields`, so the auto-PR they
    // produce can pass pr-governance unattended. On by default; opt out with "0".
    requireProjectFields: env.MYAGENTTOOL_AUTOTRIGGER_REQUIRE_PROJECT_FIELDS !== "0",
  };
}

// The governance gate an auto-PR must satisfy is a linked issue carrying a
// `## Project Fields` block; mirror tools/github's hasProjectFields locally.
export function issueHasProjectFields(body) {
  return /##\s+Project Fields/i.test(body ?? "");
}

// Which label-filtered open issues to auto-run for one project: skip ones that
// already have an auto-run, and stop at the project's concurrency headroom. Pure.
export function selectAutoTriggerCandidates({ issues = [], autoRuns = [], projectId, maxConcurrent = 1, requireProjectFields = true }) {
  const projectRuns = autoRuns.filter((run) => run.projectId === projectId);
  const handled = new Set(projectRuns.map((run) => run.link?.number).filter((n) => Number.isFinite(n)));
  const active = projectRuns.filter((run) => ACTIVE_STATUSES.has(run.status)).length;
  let headroom = Math.max(0, maxConcurrent - active);

  const selected = [];
  for (const issue of issues) {
    if (headroom <= 0) break;
    if (!Number.isFinite(issue?.number)) continue;
    if (issue.state && issue.state !== "open") continue;
    if (handled.has(issue.number)) continue;
    // Skip issues that can't yield a governance-passing PR (no Project Fields).
    if (requireProjectFields && !issueHasProjectFields(issue.body)) continue;
    selected.push(issue);
    headroom -= 1;
  }
  return selected;
}

// Runtime around the pure selector. `listLabeledIssues(project, label)` and
// `startAutoRun` are injected so a scan is fully testable without gh or a server.
export function createAutoTriggerRuntime({ state, config, listLabeledIssues, startAutoRun, log }) {
  async function scanOnce() {
    if (!config.enabled) return { enabled: false, scanned: 0, started: 0 };
    const readyProjectIds = new Set((state.projectTargets ?? []).filter((t) => t.state === "ready").map((t) => t.projectId));
    const projects = (state.projects ?? []).filter((p) => p.source !== "worktree" && readyProjectIds.has(p.id));

    let scanned = 0;
    let started = 0;
    for (const project of projects) {
      scanned += 1;
      let issues = [];
      try {
        issues = await listLabeledIssues(project, config.label);
      } catch (error) {
        log?.(`auto-trigger: issue list failed for ${project.id}: ${error?.message ?? error}`);
        continue;
      }
      const candidates = selectAutoTriggerCandidates({
        issues,
        autoRuns: state.autoRuns ?? [],
        projectId: project.id,
        maxConcurrent: config.maxConcurrent,
        requireProjectFields: config.requireProjectFields,
      });
      for (const issue of candidates) {
        try {
          await startAutoRun({
            projectId: project.id,
            link: { type: "issue", number: issue.number, title: issue.title, url: issue.url ?? null, state: "open" },
            name: branchFromIssue({ number: issue.number, title: issue.title }),
            actor: { userId: "usr_local" },
          });
          started += 1;
        } catch (error) {
          log?.(`auto-trigger: #${issue.number} skipped: ${error?.message ?? error}`);
        }
      }
    }
    return { enabled: true, scanned, started };
  }

  return { scanOnce };
}
