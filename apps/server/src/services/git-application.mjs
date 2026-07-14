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
//
// SCOPE (#909): this managed git Application is INSPECTOR-ONLY. Its parsed
// repo_state results land in state.applicationResults and are shown in the
// Applications inspector — they do NOT drive the project file tree or the
// git-status badges. Those are a SEPARATE subsystem: `gitStatusMap` /
// `readGitFacts` in services/projects.mjs, which shell out to git directly and
// never touch this Application. The two are independent by design; don't assume
// changing one affects the other. See docs/engineering/GIT_APPLICATION_HARDENING_ISSUE_PLAN.md.

export const GIT_APPLICATION_ID = "app_git";

// Porcelain / --format with a %x1f unit separator and `-z` (NUL) record
// separation so the result parses without a JSON mode (git has none). NUL cannot
// appear in a commit message, so a message cannot forge a log record boundary
// (#864). --no-pager is defense in depth — the spawn has no tty anyway. All
// read-only, offline, low risk.
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
    description: "Recent commits (hash, author, ISO date, subject), NUL-record-delimited.",
    args: ["--no-pager", "log", "-z", "--format=%H%x1f%an%x1f%aI%x1f%s", "--max-count=50"],
    argInputs: [
      { key: "since", flag: "--since", type: "date" },
      { key: "until", flag: "--until", type: "date" },
      { key: "author", flag: "--author", type: "token" },
      { key: "maxCount", flag: "--max-count", type: "count" },
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
    // NOTE the escape: ref-filter (`branch --format`, `for-each-ref`) spells a hex
    // byte `%1f`, while `log --format` spells the same byte `%x1f`. They are not
    // interchangeable — git emits an unrecognized escape VERBATIM rather than
    // failing, so `%x1f` here silently produced "name%x1f<hash>" (#801).
    args: ["--no-pager", "branch", "--list", "--format=%(refname:short)%1f%(objectname)"],
  },
  {
    id: "head",
    displayName: "Git HEAD",
    description: "The current HEAD commit hash.",
    args: ["--no-pager", "rev-parse", "HEAD"],
  },
  // Positional-rev commands (#777): the rev is an argv element with no --flag in
  // front of it, validated by the closed `git-rev` type (no leading "-", no "..").
  {
    id: "show",
    displayName: "Git show (stat)",
    description: "Commit metadata + change summary for a revision.",
    args: ["--no-pager", "show", "--stat", "--no-color"],
    argInputs: [{ key: "rev", positional: true, type: "git-rev" }],
  },
  {
    id: "diff_ref",
    displayName: "Git diff (stat) against a ref",
    description: "Change summary of the working tree against a revision.",
    args: ["--no-pager", "diff", "--stat", "--no-color"],
    argInputs: [{ key: "rev", positional: true, type: "git-rev" }],
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
