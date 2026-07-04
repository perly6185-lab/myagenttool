// Type surface for issue-prompt.mjs (the runtime lives in the .mjs twin, mirroring
// this package's index.ts / index.mjs split). Consumers import
// "@myagenttool/protocol/issue-prompt".

/** The linked issue/PR shape a worktree carries; extra fields are ignored. */
export interface WorktreeLinkItem {
  type: "issue" | "pr";
  number: number;
  title: string;
  url?: string | null;
}

/** Human label for a linked item: "Issue" or "PR". */
export declare function githubItemKindLabel(type: "issue" | "pr"): "Issue" | "PR";

/**
 * The task prompt an agent receives when it is pointed at a worktree created
 * from a GitHub issue/PR.
 */
export declare function worktreeAutoRunPrompt(item: WorktreeLinkItem): string;
