// Shared helpers for creating a worktree from a GitHub issue/PR. Used by both the
// project's WorktreeCreator dialog and the Task board's quick-create so the
// branch name and the link payload shape can't drift between the two.

export interface GithubLinkItem {
  type: "issue" | "pr";
  number: number;
  title: string;
  url: string | null;
  state: string;
}

/** Lowercase, hyphenated, ≤40-char slug from free text (empty → "work"). */
export function slugifyTitle(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "work"
  );
}

/** Canonical branch name for a worktree off an issue: `issue-<n>-<title slug>`. */
export function branchFromIssue(item: { number: number; title: string }): string {
  return `issue-${item.number}-${slugifyTitle(item.title)}`;
}

/** The link payload attached to a worktree created from an issue/PR. */
export function worktreeLinkFor(item: GithubLinkItem): GithubLinkItem {
  return { type: item.type, number: item.number, title: item.title, url: item.url, state: item.state };
}
