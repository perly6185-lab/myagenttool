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
