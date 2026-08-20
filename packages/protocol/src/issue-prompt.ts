// Type surface for issue-prompt.mjs (the runtime lives in the .mjs twin, mirroring
// this package's index.ts / index.mjs split). Consumers import
// "@myagenttool/protocol/issue-prompt".

/** The linked issue/PR shape a worktree carries; extra fields are ignored. */
export interface WorktreeLinkItem {
  type: "issue" | "pr" | "local_issue";
  number: number;
  title: string;
  url?: string | null;
}

/** Human label for a linked item: "Issue" or "PR". */
export declare function githubItemKindLabel(type: "issue" | "pr" | "local_issue"): "Issue" | "PR" | "Local Issue";

/** Lowercase, hyphenated, <=40-char slug from free text (empty -> "work"). */
export declare function slugifyIssueTitle(text: string): string;

/** Canonical branch name for a worktree off an issue: `issue-<n>-<title slug>`. */
export declare function branchFromIssue(item: { number: number; title: string }): string;

/**
 * The task prompt an agent receives when it is pointed at a worktree created
 * from a GitHub issue/PR.
 */
export declare function worktreeAutoRunPrompt(item: WorktreeLinkItem): string;

/**
 * The role-aware task prompt for a decided auto-run path
 * (develop | design | prototype | clarify); includes the issue body when given.
 */
export declare function roleAutoRunPrompt(
  item: WorktreeLinkItem,
  options?: {
    path?: "develop" | "design" | "prototype" | "clarify" | "decompose" | "evaluate" | "summarize";
    issueBody?: string | null;
    verifyCommand?: string | null;
    readOnly?: boolean;
  },
): string;

/** The taint (ADR 0011): risk tag on an attacker-controlled-output capability. */
export declare const UNTRUSTED_INPUT_TAG: "untrusted_input";
/** The taint (ADR 0011): issue label applied when such output is transcribed. */
export declare const UNTRUSTED_INPUT_LABEL: "untrusted-input";

/** B1a: wrap an untrusted issue body as delimited data (not instructions). */
export declare function untrustedBodyBlock(label: string, body: string): string;

/** B1a: high-signal prompt-injection detector over untrusted text. */
export declare function detectPromptInjection(text: string | null | undefined): {
  suspicious: boolean;
  markers: string[];
};
