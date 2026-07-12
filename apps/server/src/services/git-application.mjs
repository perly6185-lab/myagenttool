// Canonical git Application (Epic #772, slice #776). Mirrors ccusage-application.mjs.
//
// git is not an npm package and not "a repository": it is a system binary that
// operates on whichever repository the invocation is scoped to. Registered from a
// `binary` source (#774), it projects a read-only capability set. Every command
// is expressible with FLAGS ONLY, so this slice keeps the "all argv comes from an
// allowlist" invariant fully intact — positional revs (git show <rev>) are a
// separate slice (#777).
//
// Plan: docs/engineering/GIT_APPLICATION_CAPABILITY_PLAN.md.

export const GIT_APPLICATION_ID = "app_git";

// Porcelain / --format with %x1f (unit separator) and %x1e (record separator) so
// the result parses without a JSON mode (git has none). --no-pager is defense in
// depth — the spawn has no tty anyway. All read-only, offline, low risk.
const GIT_WRAPPER_COMMANDS = [
  {
    id: "status",
    displayName: "Git status",
    description: "Working-tree state (porcelain v2, with branch header).",
    args: ["--no-pager", "status", "--porcelain=v2", "--branch"],
  },
  {
    id: "log",
    displayName: "Git log",
    description: "Recent commits (hash, author, ISO date, subject), separator-delimited.",
    args: ["--no-pager", "log", "--format=%H%x1f%an%x1f%aI%x1f%s%x1e", "--max-count=50"],
    argInputs: [
      { key: "since", flag: "--since", type: "date" },
      { key: "until", flag: "--until", type: "date" },
      { key: "author", flag: "--author", type: "token" },
      { key: "maxCount", flag: "--max-count", type: "token" },
    ],
  },
  {
    id: "diff_stat",
    displayName: "Git diff (stat)",
    description: "Change summary of the working tree (names + insertion/deletion counts).",
    args: ["--no-pager", "diff", "--stat", "--no-color"],
  },
  {
    id: "branch_list",
    displayName: "Git branches",
    description: "Local branches (short name + objectname), separator-delimited.",
    args: ["--no-pager", "branch", "--list", "--format=%(refname:short)%x1f%(objectname)"],
  },
  {
    id: "head",
    displayName: "Git HEAD",
    description: "The current HEAD commit hash.",
    args: ["--no-pager", "rev-parse", "HEAD"],
  },
];

/**
 * Build a `registerApplication` body for the canonical git application.
 * Registered (not auto-online) by default — enabling is an explicit lifecycle
 * step, matching the rest of the registry. Nothing auto-registers at boot.
 */
export function createGitApplicationRegistration({ autoOnline = false } = {}) {
  return {
    id: GIT_APPLICATION_ID,
    name: "git",
    autoOnline,
    source: {
      type: "binary",
      binary: "git",
      wrapper: {
        mode: "installed-wrapper",
        commands: GIT_WRAPPER_COMMANDS.map((command) => ({
          id: command.id,
          displayName: command.displayName,
          description: command.description,
          commandType: "bin",
          command: "git",
          args: command.args,
          argInputs: command.argInputs ?? [],
          status: "approved",
          // Explicit — the `bin` default is `high`. Read-only offline git is low
          // risk; the real authorization boundary is owner-scoped tenancy plus the
          // project the invocation is already scoped to.
          riskLevel: "low",
          riskTags: ["vcs", "read-only"],
          requiresApproval: false,
          filePolicy: "read_only",
          networkPolicy: "forbidden",
          // Resolve cwd to the invocation's repository (#773).
          cwdPolicy: "invocation_root",
          // The runner's non-JSON fallback stores { text } (capped at 20 000 chars);
          // diff --stat stays well under it. Full-text diff is out of scope.
          outputCollection: "applicationResults",
          resultImport: { source: "git", kind: "repo_state" },
        })),
      },
    },
  };
}
