import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Governed child-issue spawning (ISSUE_DECISION_AGENT_PLAN.md slice 4). A
// design/prototype auto-run's deliverable becomes a PENDING-DECISION child
// issue: it inherits the parent's Project Fields, is never labelled `auto` at
// creation, and carries a depth-1 marker so a child can never spawn
// grandchildren. A human reviews the design and labels the child `auto` (or
// starts it manually) — only then does implementation begin, through the
// existing auto-trigger with zero new re-entry machinery.

// Depth-1 marker embedded in every spawned child body.
const CHILD_MARKER_PREFIX = "<!-- myagent:autorun:child-of:#";

export function spawnIssuesConfig(env = process.env) {
  const flag = env.MYAGENTTOOL_AUTORUN_SPAWN_ISSUES;
  return { enabled: flag === "1" || flag === "true" };
}

/** True when an issue body identifies a spawned child (depth 1 reached). */
export function isSpawnedChildBody(body) {
  return String(body ?? "").includes(CHILD_MARKER_PREFIX);
}

/** The parent's `## Project Fields` block, verbatim, or null. */
export function extractProjectFieldsBlock(body) {
  const match = String(body ?? "").match(/##\s+Project Fields\s*\n([\s\S]*?)(?:\n##\s+|$)/i);
  if (!match) return null;
  const block = match[1].trim();
  return block ? `## Project Fields\n\n${block}` : null;
}

export function childIssueTitle(parentLink) {
  const title = String(parentLink?.title ?? "").trim() || `issue #${parentLink?.number}`;
  return `Implement: ${title}`.slice(0, 120);
}

/**
 * The governed child body: what happened, the human gate, the depth-1 marker,
 * the design (the run's deliverable), acceptance, and the inherited Project
 * Fields. Status is forced back to backlog — the child is unstarted work.
 */
export function childIssueBody({ parentLink, design, projectFieldsBlock = null }) {
  const parentRef = Number.isFinite(parentLink?.number) ? `#${parentLink.number}` : "its parent issue";
  const fields = projectFieldsBlock
    ? `\n\n${projectFieldsBlock.replace(/^(\s*Status:).*$/im, "$1 backlog")}`
    : "\n\n_Project Fields need human triage before this issue can enter the auto loop._";
  return (
    `Spawned from ${parentRef} by an auto-run design pass. **A human must review this design** ` +
    "and label this issue `auto` (or start it manually) to begin implementation — it is never " +
    "implemented automatically without that decision.\n\n" +
    `${CHILD_MARKER_PREFIX}${parentLink?.number ?? 0} -->\n\n` +
    `## Design\n\n${String(design ?? "").trim() || "(see the parent issue's auto-run report)"}\n\n` +
    "## Acceptance\n\n- [ ] The design above is implemented and its acceptance criteria hold.\n" +
    `- [ ] The implementation PR references this issue.${fields}`
  );
}

/** `gh issue create` in the repo; returns {number, url} or throws. */
export async function runChildIssueCreate({ cwd, title, body, gh = defaultGh }) {
  const result = await gh(["issue", "create", "--title", title, "--body", body], cwd);
  const url = String(result?.stdout ?? "").trim().split("\n").at(-1) ?? "";
  const number = Number(url.match(/\/issues\/(\d+)\s*$/)?.[1]);
  if (!Number.isFinite(number)) throw new Error(`gh issue create returned no issue url: ${url || "(empty)"}`);
  return { number, url };
}

async function defaultGh(args, cwd) {
  return execFileAsync("gh", args, { cwd, encoding: "utf8", timeout: 20_000, env: { ...process.env, GH_PROMPT_DISABLED: "1" } });
}
