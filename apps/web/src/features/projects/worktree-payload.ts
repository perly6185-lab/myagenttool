// Shared helpers for creating a worktree from a GitHub issue/PR. Used by both the
// project's WorktreeCreator dialog and the Task board's quick-create so the
// branch name and the link payload shape can't drift between the two.
//
// The branch-name helpers now live in @myagenttool/protocol/issue-prompt so the
// server's auto-trigger produces byte-identical branch names; they are re-exported
// here to keep the web import sites unchanged.

import { branchFromIssue, slugifyIssueTitle } from "@myagenttool/protocol/issue-prompt";

export interface GithubLinkItem {
  type: "issue" | "pr";
  number: number;
  title: string;
  url: string | null;
  state: string;
}

/** Canonical branch name for a worktree off an issue: `issue-<n>-<title slug>`. */
export { branchFromIssue };

/** Lowercase, hyphenated, <=40-char slug from free text (empty -> "work"). */
export const slugifyTitle = slugifyIssueTitle;

/** The link payload attached to a worktree created from an issue/PR. */
export function worktreeLinkFor(item: GithubLinkItem): GithubLinkItem {
  return { type: item.type, number: item.number, title: item.title, url: item.url, state: item.state };
}
