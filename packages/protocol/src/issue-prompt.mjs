// Shared, side-effect-free prompt construction for turning a linked GitHub
// issue/PR into an agent task. One source of truth for the console's Automate
// action and the server-side auto-run orchestrator so the two can't drift.
//
// Kept in its own module (not index.mjs) so importing it never runs the
// protocol vocabulary self-check, and so browser bundles stay clean.

/** Human label for a linked item: "Issue" or "PR". */
export function githubItemKindLabel(type) {
  return type === "pr" ? "PR" : "Issue";
}

/** Lowercase, hyphenated, <=40-char slug from free text (empty -> "work"). */
export function slugifyIssueTitle(text) {
  return (
    String(text ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "work"
  );
}

/** Canonical branch name for a worktree off an issue: `issue-<n>-<title slug>`. */
export function branchFromIssue(item) {
  return `issue-${item?.number}-${slugifyIssueTitle(item?.title)}`;
}

/**
 * The task prompt an agent receives when it is pointed at a worktree created
 * from a GitHub issue/PR. `item` is the worktree link shape
 * ({ type, number, title, url }); extra fields are ignored.
 */
export function worktreeAutoRunPrompt(item) {
  const label = githubItemKindLabel(item?.type);
  const number = item?.number;
  const title = String(item?.title ?? "").trim();
  const urlLine = item?.url ? `\n${item.url}` : "";
  return (
    `Make progress on GitHub ${label} #${number}: ${title}.${urlLine}\n` +
    "Review the latest state, do the next useful step, and summarize what changed."
  );
}

// Role-specific instructions for a decided auto-run path. The develop role
// implements; design and clarify explicitly must NOT change product code (their
// deliverable is the final summary); prototype builds a throwaway spike.
const ROLE_INSTRUCTIONS = {
  develop:
    "Implement the change this issue asks for. Honor the issue's acceptance criteria, " +
    "keep the scope tied to the issue, follow the repository's existing style, and add or " +
    "update tests where the change warrants them. Commit your work with a clear message, " +
    "then summarize what changed and how you verified it.",
  design:
    "Do NOT implement a fix or feature. Explore the codebase and produce a detailed design as " +
    "your final summary: the problem, two or three viable options with trade-offs, a recommended " +
    "option with rationale, and concrete acceptance criteria for implementing it. Do not modify " +
    "product code.",
  prototype:
    "Build a small, time-boxed, runnable prototype in this worktree to reduce the uncertainty in " +
    "this issue. Prototype code is throwaway — do not polish it or wire it into production paths. " +
    "Finish with a summary of what the spike demonstrated, what you learned, and a recommendation.",
  clarify:
    "Do NOT change anything. Analyze the issue against the codebase and produce, as your final " +
    "summary, the specific questions that must be answered before work can start — each with the " +
    "context a human needs to answer it, and your best-guess answer.",
};

/**
 * The role-aware task prompt for a decided auto-run path. Includes the issue
 * body (capped) when available so the agent finally sees what the issue actually
 * asks — not just its title. Unknown paths fall back to the develop role.
 */
export function roleAutoRunPrompt(item, { path = "develop", issueBody = null } = {}) {
  const label = githubItemKindLabel(item?.type);
  const number = item?.number;
  const title = String(item?.title ?? "").trim();
  const urlLine = item?.url ? `\n${item.url}` : "";
  const body = typeof issueBody === "string" && issueBody.trim()
    ? `\n\n${label} description:\n${issueBody.trim().slice(0, 6000)}`
    : "";
  const instructions = ROLE_INSTRUCTIONS[path] ?? ROLE_INSTRUCTIONS.develop;
  return `GitHub ${label} #${number}: ${title}.${urlLine}${body}\n\n${instructions}`;
}
