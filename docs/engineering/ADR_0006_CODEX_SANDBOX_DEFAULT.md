# ADR 0006: Codex CLI Sandbox Default and Writable Opt-In

Status: accepted

Date: 2026-06-23

Related issue: pending (writable Codex sandbox task)

## Context

Codex CLI is the first real coding agent registered through the control plane. It
runs non-interactively as `codex exec --json` and can both read repository
context and, depending on its `--sandbox` mode, modify files and run shell
commands. The available modes are:

- `read-only` — can read the workspace; cannot edit files.
- `workspace-write` — can edit files within the working directory.
- `danger-full-access` — no sandbox; can edit anywhere and use the network.

The control plane's mandate is that every invocation be attributable,
cancellable, observable, and auditable, and that the default product be safe for
non-professional users. A coding agent that can silently modify a user's files is
exactly the high-consequence case that mandate exists for. At the same time,
users legitimately need Codex to *do work* (edit code), so writable execution
cannot simply be forbidden.

## Decision

Make `read-only` the sandbox default everywhere Codex can be registered without an
explicit choice, and make writable execution an explicit, governed opt-in.

1. **Read-only by default.** Conservative discovery and the Integration Builder
   register Codex with `--sandbox read-only`. The shared `codexCliArgs(sandbox)`
   helper defaults to `read-only`, so any call site that does not pass a sandbox
   stays read-only.
2. **Writable is opt-in and validated.** A sandbox may be chosen explicitly at
   registration (`read-only` | `workspace-write` | `danger-full-access`).
   `normalizeCodexSandbox()` rejects anything else and falls back to `read-only`.
3. **Writable never bypasses governance.** Codex is always classified high-risk
   (its capability risk tags include `write_local` and `shell_exec`), so every
   invocation — regardless of sandbox — passes through the local approval gate
   before dispatch. Sandbox choice changes a CLI flag, not the policy path.
4. **The choice is surfaced in the console.** The web console exposes a sandbox
   selector with per-mode risk hints so the writable decision is deliberate and
   visible, not buried in an API payload.

## Rationale

- Safe defaults protect the non-professional-first product: a user who clicks
  "Add Codex" without understanding sandboxes gets the harmless mode.
- Opt-in writable keeps Codex useful for real work without weakening the default.
- Routing every Codex run through approval means writability raises *what is
  reviewed*, never *whether it is reviewed*.
- Centralizing the mode in one validated helper prevents an unvalidated
  `--sandbox` value from reaching the bridge spawn.

## Consequences

Positive:

- The dangerous capability (file mutation) is never the silent default.
- One audited path covers read-only and writable Codex alike.
- Adding future agents with sandbox semantics can follow the same pattern.

Tradeoffs:

- Writable Codex requires an explicit per-registration choice; there is no
  global "always writable" switch by design.
- `danger-full-access` is selectable; the approval gate and plain-language risk
  hints are the controls, not prohibition.

## Non-Goals

This decision does not commit to:

- Per-invocation sandbox switching (sandbox is set at registration for now).
- Sandbox enforcement beyond what the Codex CLI itself provides.
- A persisted writable-agent store (M0 registration remains in-memory).

## Implementation Notes

- Server: `codexCliArgs(sandbox = "read-only")`, `normalizeCodexSandbox()`, and
  custom registration (`POST /api/agents`) deriving Codex args + sandbox metadata
  from the chosen sandbox while keeping Codex high-risk.
- Web: a coding-agent registration card with a mode selector in the Discovery view.
- Verification: read-only default is covered by the local smoke test; a real
  `codex exec --sandbox workspace-write` run was confirmed to create a file only
  after explicit approval.

## Generalization to Claude Code

The same policy — safe-by-default, writable opt-in, always approval-gated —
applies to Claude Code via its `--permission-mode`: `plan` is the safe default
(no edits), while `acceptEdits` and `bypassPermissions` are the writable opt-ins.
`default`/`auto` are excluded because they block on interactive prompts in the
headless bridge. Claude runs as `claude -p ... --output-format stream-json`, and
the bridge parses its `result` event for the answer. Both coding agents share one
registration path, one risk classification (high), and one approval gate.
