import { execFile } from "node:child_process";
import { hostname } from "node:os";
import { promisify } from "node:util";

import { createAutoTriggerRuntime, resolveAutoTriggerConfig } from "../services/auto-trigger.mjs";
import { autoRunSettingsEnvOverlay } from "../services/auto-run-config.mjs";

const execFileAsync = promisify(execFile);
const TICK_MS = 60_000;

function readyTarget(state, project) {
  return (state.projectTargets ?? []).find((t) => t.projectId === project.id && t.state === "ready") ?? null;
}

// gh issue list scoped to the trigger label for a project's ready repo.
// `labels` rides along so the worker filter and the dispatcher's in-progress /
// assigned/* checks (#1165) see the same snapshot the candidate came from.
function makeListLabeledIssues(state) {
  return async function listLabeledIssues(project, label) {
    const target = readyTarget(state, project);
    if (!target) return [];
    const { stdout } = await execFileAsync(
      "gh",
      ["issue", "list", "--state", "open", "--label", label, "--json", "number,title,url,state,body,labels", "--limit", "30"],
      { cwd: target.rootPath, encoding: "utf8", timeout: 15_000 },
    );
    const parsed = JSON.parse(stdout || "[]");
    return Array.isArray(parsed)
      ? parsed.map((issue) => ({
          number: issue.number,
          title: issue.title,
          url: issue.url ?? null,
          state: (issue.state ?? "open").toLowerCase(),
          body: issue.body ?? "",
          labels: Array.isArray(issue.labels) ? issue.labels.map((l) => l?.name).filter(Boolean) : [],
        }))
      : [];
  };
}

// #1165 dispatcher label writes. `gh issue edit --add-label` refuses a label
// that doesn't exist in the repo, so each added label is ensured first
// (`gh label create` is a no-op failure when it already exists — ignored).
function makeEditIssueLabels(state) {
  return async function editIssueLabels(project, { issueNumber, add = [], remove = [] }) {
    const target = readyTarget(state, project);
    if (!target) throw new Error(`project ${project.id} has no ready repo target`);
    const cwd = target.rootPath;
    for (const label of add) {
      try {
        await execFileAsync(
          "gh",
          ["label", "create", label, "--color", "BFD4F2", "--description", "myagenttool dispatch assignment"],
          { cwd, encoding: "utf8", timeout: 15_000 },
        );
      } catch {
        /* already exists (or race) — the edit below is the authoritative failure */
      }
    }
    const args = ["issue", "edit", String(issueNumber)];
    for (const label of add) args.push("--add-label", label);
    for (const label of remove) args.push("--remove-label", label);
    await execFileAsync("gh", args, { cwd, encoding: "utf8", timeout: 15_000 });
  };
}

// Start the auto-trigger scan loop. Returns null (no timer, no gh calls) when the
// feature is disabled, which is the default — nothing auto-triggers unless an
// operator opts in via MYAGENTTOOL_AUTOTRIGGER_ENABLED.
export function startAutoTriggerScheduler(deps, { intervalMs = TICK_MS, env = process.env } = {}) {
  // Console-saved auto-trigger knobs (state.autoRunSettings) overlaid on env, so
  // enabling/labeling auto-trigger in the UI takes effect on the next start.
  const config = resolveAutoTriggerConfig(autoRunSettingsEnvOverlay(deps?.state?.autoRunSettings, env));
  if (!config.enabled) return null;
  // #1165: this installation's stable id for dispatch labels; hostname default.
  if (!config.serverId) config.serverId = hostname();
  const runtime = createAutoTriggerRuntime({
    state: deps.state,
    config,
    listLabeledIssues: makeListLabeledIssues(deps.state),
    startAutoRun: deps.startAutoRun,
    editIssueLabels: makeEditIssueLabels(deps.state),
    appendEvent: deps.appendEvent,
    persistStateSoon: deps.persistStateSoon,
    log: (message) => console.log(`[auto-trigger] ${message}`),
  });
  const timer = setInterval(() => {
    // O0 kill switch: a global brake checked every tick so flipping it on halts
    // the unattended surface immediately (no restart needed).
    if (deps?.state?.autoRunSettings?.autonomyKillSwitch) return;
    void runtime.scanOnce();
  }, intervalMs);
  timer.unref?.();
  return timer;
}
