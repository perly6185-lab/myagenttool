# Managed Terminal Join Contract

This contract defines the join point between the Agent Workspace UI and the
future managed terminal runtime. It covers #157 and the contract portion of
#145. It does not implement PTY, SSH, or relay transport.

## Product Flow

- Role flow: advanced developer, team administrator, auditor.
- Scenario: attach future terminal runtime work to Agent Workspace without
  making unmanaged command execution look governed.
- Frequency: medium for advanced developers, low but critical for auditors and
  administrators.
- Owner surface: Terminal workspace surface, with evidence visible through
  Evidence and approval visible through Approval.
- Usability task: understand whether terminal is unavailable, blocked,
  attaching, managed, exited, or disconnected.
- What not to show: unmanaged terminal as compliant evidence, raw terminal in
  the Run composer, raw output flood before summaries, private auth files, or
  private Codex session files.

## UI Ownership

The Terminal workspace surface owns:

- attach and detach controls
- terminal availability status
- shell, cwd, device, repo, and policy summary
- managed/unmanaged boundary copy
- terminal session status
- links to evidence and approval records

Run owns none of the terminal controls. Run may show only plain-language task
status such as "waiting for approval" or "running". It must not embed raw
terminal output, attach buttons, SSH setup, PTY controls, or terminal evidence.

Evidence owns terminal proof. Approval owns pending terminal permission
requests. Setup owns runtime target configuration such as local PTY availability
and SSH target setup.

## Terminal UI States

| State | Meaning | Allowed UI Action | Evidence Claim |
| --- | --- | --- | --- |
| `unavailable` | No managed runtime capability reported. | View runtime plan. | No terminal evidence. |
| `blocked_unmanaged` | Runtime exists outside MyAgentTool control. | Explain boundary; offer Setup. | Not managed proof. |
| `blocked_policy` | Policy prevents attach, shell, cwd, network, or target. | Request approval or change setup. | Policy event only. |
| `approval_required` | Attach or command input needs approval. | Approve or deny in Approval surface. | Approval record. |
| `attaching` | Managed runtime is starting a PTY/SSH session. | Cancel attach. | Session start event. |
| `attached` | Managed runtime session is active. | Input, resize, detach. | Managed terminal evidence. |
| `detached` | UI detached but session may continue. | Reattach or close if policy allows. | Detach event. |
| `exited` | Runtime process exited. | View summary and evidence. | Exit event and summary. |
| `error` | Managed runtime failed. | View troubleshooting. | Runtime warning/error evidence. |

## Runtime Session Registry

Each managed terminal session must register before the UI can display it as
managed:

```json
{
  "terminalSessionId": "term_123",
  "ownerInvocationId": "inv_123",
  "ownerCodexSessionId": "codex_session_123",
  "deviceId": "dev_123",
  "userId": "usr_123",
  "repoPath": "D:/github/perly6185-lab/myagenttool",
  "cwd": "D:/github/perly6185-lab/myagenttool",
  "shell": "powershell",
  "runtimeKind": "local_pty",
  "targetId": "local",
  "status": "attached",
  "policyProfile": "managed-codex-default",
  "approvalPolicy": "ask_before_risky_tools",
  "sandboxMode": "workspace_write",
  "networkPolicy": "restricted",
  "startedAt": "2026-06-21T00:00:00.000Z",
  "lastSeenAt": "2026-06-21T00:00:00.000Z",
  "exitedAt": null,
  "exitCode": null,
  "evidenceIds": []
}
```

Required fields:

- `terminalSessionId`
- `ownerInvocationId`
- `deviceId`
- `repoPath`
- `cwd`
- `shell`
- `runtimeKind`
- `status`
- `policyProfile`
- `startedAt`
- `lastSeenAt`
- `evidenceIds`

Optional association fields:

- `ownerCodexSessionId`
- `codexThreadId`
- `targetId`
- `userId`
- `retentionProfile`

## Protocol Events

The runtime line must produce structured events before Web Console terminal
transport is implemented.

```text
terminal.session.create
terminal.session.attached
terminal.input.submit
terminal.output.chunk
terminal.resize
terminal.permission.request
terminal.permission.resolved
terminal.detach
terminal.exit
terminal.close
terminal.policy.blocked
terminal.runtime.warning
```

Minimum event envelope:

```json
{
  "id": "evt_123",
  "type": "terminal.output.chunk",
  "terminalSessionId": "term_123",
  "ownerInvocationId": "inv_123",
  "createdAt": "2026-06-21T00:00:00.000Z",
  "source": "managed_terminal_runtime",
  "summary": "stdout chunk received",
  "data": {}
}
```

## Evidence Model

Terminal evidence records must distinguish summary from raw stream data:

| Evidence Type | Required Data | Retention Default |
| --- | --- | --- |
| `terminal_session_start` | shell, cwd, runtime kind, policy, owner invocation | retain summary |
| `terminal_input` | redacted input summary, approval id if any | redact by default |
| `terminal_output_chunk` | stream, byte count, redaction state, chunk id | retain limited or summarized |
| `terminal_command_summary` | command summary, status, files touched if known | retain summary |
| `terminal_resize` | rows, columns | retain metadata |
| `terminal_permission` | request, decision, approver, timeout | retain audit |
| `terminal_exit` | status, exit code, duration | retain summary |
| `terminal_policy_event` | blocked reason, policy profile | retain audit |

Raw output must not dominate the first view. Evidence Center should show
summaries and filters first, with raw chunks accessible only when retention and
redaction policy allow.

## Approval Join

Terminal attach or input may require approval when policy marks shell, cwd,
network, command, target, or environment as risky.

Approval request fields expected by the UI:

- `approvalRequestId`
- `terminalSessionId`
- `ownerInvocationId`
- `toolName`
- `requestedAction`
- `riskLevel`
- `cwd`
- `shell`
- `commandSummary`
- `consequence`
- `timeoutAt`
- `status`

Deny or timeout must leave the terminal session in `blocked_policy`,
`detached`, `closed`, or another explicit non-active state. The UI must not
silently continue input after denial.

## Runtime Capability Report

Setup and Terminal surfaces depend on a capability report:

```json
{
  "deviceId": "dev_123",
  "localPty": {
    "available": false,
    "reason": "node-pty not installed"
  },
  "ssh": {
    "available": false,
    "reason": "connector not configured"
  },
  "relay": {
    "available": false,
    "reason": "remote relay not configured"
  },
  "supportedShells": ["powershell", "cmd"],
  "defaultShell": "powershell"
}
```

If the capability report is absent, the Terminal surface must show
`unavailable` and the UI must not expose attach controls.

## Runtime Issue Mapping

| Runtime Issue | Contract Dependency |
| --- | --- |
| #145 | protocol events, registry, evidence model |
| #146 | local PTY manager must populate registry and events |
| #147 | Web Console detail pane must bind to these states |
| #148 | Managed Codex terminal mode must associate terminal sessions with Codex session registry |
| #149 | SSH connector must use the same registry and evidence envelope |
| #150 | remote relay must use the same status and evidence model |
| #157 | UI/runtime join contract and blocked-state copy |

## Acceptance Checks

- Terminal attach/detach belongs only to the Terminal surface.
- Run does not show raw terminal, SSH setup, PTY setup, or terminal evidence.
- Unavailable, unmanaged, policy-blocked, and not-yet-connected states are
  explicit.
- A terminal session cannot be labeled managed unless it has a registry record
  and managed runtime evidence.
- Evidence Center distinguishes terminal summaries from raw output chunks.
- Approval records include consequence and timeout.
