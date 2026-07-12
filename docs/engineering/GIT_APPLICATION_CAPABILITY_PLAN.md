# Git as a governed Application

> Epic #772. Reference pattern: ADR 0007 (ccusage as Application). This plan lands
> with the first PR under the epic (#773) and is the design of record for the
> remaining slices.

## The problem

The Application Capability Registry can project invokable wrapper commands **only
for npm sources** (`projectNpmWrapperCapabilities` guards on
`source.type === "npm"`), and the bridge's argv allowlist is hardcoded to
`app.app_ccusage.*`. So an application registered from a `git` source projects
zero executable capabilities. `git` is neither an npm package nor "a repository":
it is a **system binary that operates on whichever repository the invocation is
already scoped to**.

Making `git` a governed Application proves the registry generalizes beyond its
first tenant (ccusage) without weakening the two independent allowlists that keep
a device from spawning anything unapproved.

## The invariants we keep

1. **Two independent allowlists.** The server decides *what may be projected*; the
   bridge decides *what may actually spawn*. The base argv is deliberately
   **duplicated** between the server spec and the bridge policy — a buggy or
   compromised server still cannot make a device spawn something new. They are
   never factored into a shared constant.
2. **All argv comes from an allowlist.** Base argv is fixed per command; only
   declared, validated `argInputs` may append flags/values.
3. **Default-deny at the bridge.** An unknown capability prefix, an argv not
   matching the registered base as a prefix, an undeclared flag, a failing
   validator, a cwd outside `approvedRoots`, or a file/network policy exceeding
   the command's — all refused, each with evidence.
4. **Read-only, offline.** The read-only git slice raises no file or network
   policy ceiling anywhere.

## The slices

### #773 — Wrapper cwd resolves to the invocation's repo (prerequisite)

A wrapper command's cwd defaulted to `"."`, which always won and resolved against
the *bridge process's* own directory. Added `cwdPolicy` to the command descriptor:

- `"fixed"` (default) — today's behavior, ccusage untouched, uses `cwd`.
- `"invocation_root"` — the plan emits `cwd: null`, so the bridge's existing
  `spec.cwd → metadata.worktreePath → metadata.projectPath` fallback resolves it
  to the invocation's repository. `applicationWrapperGate` still confines the
  resolved cwd to `approvedRoots`.

An `invocation_root` command dispatched with **no project** is **refused**
(`invocation_root_requires_project`, with evidence) at the dispatch chokepoint —
never allowed to fall back to the bridge's own directory. No bridge change: the
fallback chain and the `approvedRoots` confinement already exist.

### #774 — Decouple the wrapper descriptor from npm (`binary` source)

Give `git` a source type. `binary` sources carry a bare program name
(`/^[a-z][a-z0-9_-]{0,31}$/` — no path separators, no absolute paths; the caller
never names a path on disk) and a wrapper descriptor. `projectWrapperCapabilities`
guards on `source.wrapper?.mode === "installed-wrapper"` instead of
`source.type === "npm"`. npm sources keep projecting kind `npm_wrapper` with its
risk tag **byte-identical**; binary sources project kind `binary_wrapper`.

### #775 — Generalize the bridge allowlist (keep default-deny)

Replace `ccusageArgsAllowed` with `wrapperArgsAllowed(capability, args)` that
dispatches on capability prefix to a per-application argv spec; **an unknown
prefix returns `false`**. Add the `git` manifest entry
(`filePolicy: read_only`, `networkPolicy: forbidden`) and `GIT_WRAPPER_ARGS` (the
exact base argv per command + allowed trailing flags with validators). The base
argv is duplicated here on purpose (invariant 1).

### #776 — Register `app_git`, ship the read-only git capability set

The canonical `app_git` application with five flag-only read-only commands
(`status`, `log`, `diff_stat`, `branch_list`, `head`), all `cwdPolicy:
invocation_root`, `filePolicy: read_only`, `networkPolicy: forbidden`,
`requiresApproval: false`, `--no-pager` (defense in depth). Opt-in
`git:register-app` script; nothing auto-registers at boot. Porcelain / `--format`
with `%x1f`/`%x1e` separators so results parse without a JSON mode.

### #777 — Positional revision arguments (`git show <rev>`)

Widen the arg-input contract: `argInputs` may declare `positional: true`
(mutually exclusive with `flag`); a new `git-rev` type
(`/^[A-Za-z0-9._\/-]{1,100}$/`, no leading `-`, **no `..`**). Positionals append
after all flags, in declaration order. Mirrored independently in the bridge
allowlist. Adds `show` and `diff_ref`.

## What is deliberately out of scope

- Positional revs until #777 (the read-only slice is flags-only).
- Full-text diff — it would blow the runner's 20 000-char non-JSON cap;
  `diff --stat` stays under it.
- Any write, network, or ceiling-raising git command.
