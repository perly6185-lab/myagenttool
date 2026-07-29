# ADR 0023: Claude Agent SDK is the default local runtime behind the existing governance plane

- Status: Accepted
- Date: 2026-07-28

## Context

MyAgentTool currently invokes Claude Code through `claude -p`, consumes
`stream-json`, and relies on the Desktop Bridge to supervise the child process.
This provides local file tools, but an interactive SDK integration is needed to
surface per-tool approvals, structured user questions, exact session resume,
and richer lifecycle events.

The existing control plane already owns invocation admission, worktree
selection, cancellation, transcripts, file-access evidence, cost attribution,
and a Codex approval broker. Replacing those boundaries with an SDK-specific
parallel control plane would duplicate policy and create inconsistent audit
behavior.

## Decision

1. The Desktop Bridge gains a separate Claude Agent SDK runtime module.
2. The transport is selected by `adapter.claudeRuntime`, then
   `MYAGENTTOOL_CLAUDE_RUNTIME`; the default is `agent_sdk`.
   `MYAGENTTOOL_CLAUDE_RUNTIME=cli` is the rollback switch.
3. SDK messages are normalized into the existing invocation event, transcript,
   file-ledger, usage, and cost vocabulary.
4. The SDK runtime never automatically retries through `claude -p`. Automatic
   fallback could execute a write-capable task twice. Operators roll back by
   selecting the CLI transport.
5. All five product permission profiles are supported: Ask (`default`),
   Approve for me (`acceptEdits`), Plan, Full access
   (`bypassPermissions`), and `dontAsk`. Every SDK tool passes through the
   local `PreToolUse` confinement hook; unresolved Ask/Bash decisions use the
   shared provider-neutral approval broker.
6. The SDK inherits the Bridge's safe child environment, including
   `HOME`/`USERPROFILE`/`CLAUDE_CONFIG_DIR`, so an existing local Claude login
   remains usable. A configured absolute Claude executable may override the
   SDK-bundled native executable through
   `MYAGENTTOOL_CLAUDE_SDK_EXECUTABLE`. This is separate from the CLI fallback
   command so the pinned SDK is not accidentally paired with a stale CLI.
7. Exact session IDs are stored and resumed only when user, project, and
   worktree scope match. Directory-global "continue last" is not an acceptable
   multi-session contract.

## Safety boundary

The SDK executes on the local device, in the invocation's server-resolved
project or worktree directory. The Bridge independently validates the absolute
working directory and approved roots before constructing a query.

`canUseTool` is an interaction mechanism, not the hard confinement boundary:
SDK permission modes and allow rules may approve tools before that callback.
Later writable phases therefore enforce invariant path and operation rules in a
`PreToolUse` hook, with `canUseTool` used for unresolved human decisions.

## Rollout

1. Read-only SDK canary behind the runtime flag. Completed.
2. Event and evidence parity with the CLI transport. Completed.
3. Provider-neutral in-loop approval broker. Completed.
4. Writable Ask / Approve for me / Full access modes. Completed.
5. Session persistence, packaging verification, and default promotion.
   Implemented; real-account operational verification is scheduled separately.
   See `CLAUDE_AGENT_SDK_REAL_ACCOUNT_TEST_PLAN.md`.

## Consequences

- The SDK package and its platform-native optional dependency are included in
  development installs. The desktop distribution instead reuses the
  version-aligned packaged Claude Code executable for both transports, avoiding
  a duplicate native binary.
- CLI and SDK transports coexist for explicit rollback.
- Approval records remain control-plane records rather than SDK-local UI state.
- A selected SDK runtime can fail explicitly if its package, executable, login,
  or working directory is unavailable; it does not silently change transports.
