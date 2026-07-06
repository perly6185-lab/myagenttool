import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createAutoTriggerRuntime, resolveAutoTriggerConfig } from "../services/auto-trigger.mjs";
import { autoRunSettingsEnvOverlay } from "../services/auto-run-config.mjs";

const execFileAsync = promisify(execFile);
const TICK_MS = 60_000;

// gh issue list scoped to the trigger label for a project's ready repo.
function makeListLabeledIssues(state) {
  return async function listLabeledIssues(project, label) {
    const target = (state.projectTargets ?? []).find((t) => t.projectId === project.id && t.state === "ready");
    if (!target) return [];
    const { stdout } = await execFileAsync(
      "gh",
      ["issue", "list", "--state", "open", "--label", label, "--json", "number,title,url,state,body", "--limit", "30"],
      { cwd: target.rootPath, encoding: "utf8", timeout: 15_000 },
    );
    const parsed = JSON.parse(stdout || "[]");
    return Array.isArray(parsed)
      ? parsed.map((issue) => ({ number: issue.number, title: issue.title, url: issue.url ?? null, state: (issue.state ?? "open").toLowerCase(), body: issue.body ?? "" }))
      : [];
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
  const runtime = createAutoTriggerRuntime({
    state: deps.state,
    config,
    listLabeledIssues: makeListLabeledIssues(deps.state),
    startAutoRun: deps.startAutoRun,
    log: (message) => console.log(`[auto-trigger] ${message}`),
  });
  const timer = setInterval(() => {
    void runtime.scanOnce();
  }, intervalMs);
  timer.unref?.();
  return timer;
}
