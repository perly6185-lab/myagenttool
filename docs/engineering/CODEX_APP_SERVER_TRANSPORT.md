# Codex app-server transport

Status: default

## Why

On native Windows, older Codex CLI builds could finish a sandboxed command but
leave `codex exec` running without a timely process `close`. The Desktop Bridge
then held the invocation until its command-idle watchdog fired.

The opt-in app-server transport follows Codex's rich-client lifecycle instead:

```text
initialize → thread/start|resume → turn/start → item/* → turn/completed
```

`turn/completed` is the authoritative invocation boundary. Cancellation and
command-idle timeouts use `turn/interrupt`; they do not terminate the shared
app-server after every turn.

Protocol reference:
[Codex App Server](https://learn.chatgpt.com/docs/app-server).

## Select transport

The Desktop Bridge uses app-server by default. This gives native Windows a
protocol-level completion boundary and lets MyAgentTool broker Codex's
in-protocol approval requests. To temporarily roll back to the legacy
`codex exec --json` transport:

```powershell
$env:MYAGENTTOOL_CODEX_TRANSPORT = "exec"
pnpm --filter @myagenttool/desktop dev
```

Unset the variable (or set it to `app-server`) to restore the default.

MyAgentTool pins `@openai/codex` so packaged and repository runs use the tested
Codex binary instead of an unrelated global npm shim. Explicit
`MYAGENTTOOL_CODEX_COMMAND` and `MYAGENTTOOL_CODEX_COMMAND_JSON` overrides still
take precedence.

## Safety and lifecycle

- The existing high-risk approval and local execution gate run before app-server.
- The selected permission mode is forwarded to `thread/start` as one official
  Codex profile:

  | MyAgentTool mode | Sandbox | Approval policy | Reviewer |
  | --- | --- | --- | --- |
  | Ask for approval (`ask`) | `workspace-write` | `on-request` | `user` |
  | Approve for me (`auto`) | `workspace-write` | `on-request` | `auto_review` |
  | Full access (`full`) | `danger-full-access` | `never` | bypass |

- Full access remains a high-risk MyAgentTool launch and requires the outer
  local approval before execution; it is never silently selected.
- The worktree and its narrow linked-worktree Git administration directory are
  sent as runtime workspace roots.
- Command, file-change, and permission requests emitted by app-server are
  forwarded to the existing MyAgentTool permission broker. Ask mode waits for
  the user; Approve for me may accept non-sensitive actions but still pauses on
  sensitive requests.
- A transport crash fails active work promptly; it does not wait for the full
  invocation timeout.

## Verification

The fixture suite covers persistent-process completion, `turn/interrupt`
cancellation, command-idle interruption, transport crashes, and event
normalization. A native Windows linked-worktree probe using the pinned Codex
version completed through app-server and emitted `turn/completed`.
