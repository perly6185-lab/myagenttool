# Claude Agent SDK real-account acceptance plan

Status: Deferred by operator request.

This plan is the only remaining operational gate. It must run against a
disposable test repository or worktree; it must not use production source as
the first writable target.

## Preconditions

- Desktop Bridge and Electron package use the same pinned Claude Code version.
- The test user is already logged in through `claude.exe`.
- `USERPROFILE`/`HOME` and optional `CLAUDE_CONFIG_DIR` reach the SDK child.
- The console shows the expected project/worktree and permission profile.
- `MYAGENTTOOL_CLAUDE_RUNTIME` is unset for SDK testing. Setting it to `cli`
  remains the rollback.

## Test sequence

1. **Plan:** Read, Glob, and Grep inside the worktree succeed. Edit, Write, and
   Bash are refused. No files change.
2. **Ask:** Read succeeds. Edit, Write, and Bash pause in the shared Approvals
   queue; approve and deny paths both settle correctly.
3. **Approve for me:** Confined Edit and Write succeed automatically. Bash still
   enters the approval broker.
4. **dontAsk:** Read succeeds and an unapproved write is rejected without
   parking the invocation.
5. **Full access:** The outer high-risk launch approval is required. After it,
   a bounded disposable edit and test command succeed.
6. **Confinement:** A file path outside the approved root and a symlink escape
   are denied before execution.
7. **Lifecycle:** Cancellation and total timeout terminate the SDK query and
   produce one terminal outcome.
8. **Session resume:** Name a completed session, continue it from the picker,
   and confirm the exact Claude session UUID is resumed only for the same user
   and repository/worktree.
9. **Governed capabilities:** Run review, explain, analyze, plan, and propose;
   confirm the wrappers remain read-only and their structured imports match the
   CLI baseline.
10. **Packaging and rollback:** Repeat Plan from the packaged Electron app,
    then set `MYAGENTTOOL_CLAUDE_RUNTIME=cli` and confirm a new invocation uses
    the CLI transport without reinstalling.

## Pass criteria

- No duplicate execution or silent SDK-to-CLI retry.
- Approval decisions, tool events, usage, cost, file ledger, and session IDs
  are visible in the existing evidence surfaces.
- No path outside the bound root changes in Plan, Ask, Approve for me, or
  dontAsk testing.
- Session resume never crosses user or repository/worktree scope.
- The packaged app and development runtime produce equivalent outcomes.

