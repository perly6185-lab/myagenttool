# Mail Task Execution Delivery Plan

Status: accepted for implementation · 2026-08-20

Implementation status: P0-P9 implemented behind the controls below · 2026-08-20

## Outcome

Deliver one governed loop:

```text
mail -> Work Item -> AI analysis -> reply and output attachments -> review ->
revision-bound draft -> explicit send -> receipt on the Work Item
```

The ordinary and professional experiences share all domain records. Progressive
disclosure changes presentation and authority, not lifecycle semantics.

## Delivery batches

| Batch | Deliverable | Exit gate |
| --- | --- | --- |
| P0 | ADR, protocol, states, safety contract | Contracts are accepted and linked from the ADR index. |
| P1 | Account/conversation-scoped durable mail/task links | Replay and restart do not duplicate tasks; later thread messages link safely. |
| P2 | Ordinary “交给 AI 处理” flow and task status projection | A non-professional user can create and start a mail task without Agent or Worktree terminology. |
| P3 | Restricted mail-task execution contract | The run reads only frozen task inputs, writes task outputs, and owns no send authority. |
| P4 | Validated, revisioned `MailResponsePackage` and delivery review | Invalid, unreviewed, or stale output cannot become a draft. |
| P5 | Approved package to draft, verified attachments, send receipt writeback | The complete manual happy path works once and is idempotent. |
| P6 | Natural revision and continued-thread handling | New source mail invalidates stale packages and approvals without losing history. |
| P7 | `off/shadow/create_only/create_and_run` automation | Kill switch and daily limits stop new task admission; no mode sends mail. |
| P8 | Professional rules, timeline, evidence, cost, and recovery | An operator can explain and recover every lifecycle step without viewing credentials. |
| P9 | Unit, integration, E2E, security, restart, and rollout gates | No duplicate task/send, no cross-tenant access, and no unapproved exfiltration. |

## Canonical states

### Response package

```text
ready_for_review | changes_requested | approved | draft_created | sent |
send_failed | send_unconfirmed | superseded
```

### Automation

```text
off | shadow | create_only | create_and_run
```

### Ordinary projection

| Canonical task/package state | Ordinary label |
| --- | --- |
| backlog, ready | 等待处理 |
| materializing | 正在准备邮件和附件 |
| running | AI 正在分析并准备回复 |
| waiting for user | 需要你补充信息 |
| verifying, reviewing | 正在检查回复和附件 |
| approved | 回复待检查 |
| sent | 已处理 |
| failed, send_unconfirmed | 需要处理 |

## Release controls

- `MYAGENTTOOL_MAIL_TASKS_ENABLED` gates ordinary creation/start extensions.
- `MYAGENTTOOL_MAIL_TASK_AUTOMATION_MODE` is an operator ceiling; persisted
  account policy can only choose an equal or safer mode.
- The automation ceiling defaults to `off`. Supported values are `off`,
  `shadow`, `create_only`, and `create_and_run`.
- The global autonomy kill switch prevents new automatic Work Item admission.
- Existing runs remain cancellable and reviewable after rollback.
- Mail send retains its separate default-off flag and single-use approval grant.

## Required evidence

- Contract and normalization unit tests.
- Mail/task link idempotency and account isolation tests.
- Material hash and task-output attachment provenance tests.
- Stale source, stale package, and stale draft refusal tests.
- Prompt-injection fixtures proving data fencing and no send tool.
- Restart tests for active task, approved package, draft, and send receipt.
- Ordinary desktop and narrow-screen E2E paths.
- Professional shadow, enable, pause, kill-switch, and recovery E2E paths.

## Implemented evidence map

| Batch | Primary implementation evidence |
| --- | --- |
| P0 | ADR 0030, this delivery plan, ADR index entry |
| P1 | Account-scoped conversation key, source fingerprint, durable revisioned mail/task link |
| P2 | “交给 AI 处理” review with manual and automatic task modes |
| P3 | Fail-closed `mail_response_restricted` prompt, Codex approval sandbox, immutable source binding, and invocation metadata |
| P4 | Revisioned response package, strict normalization, approve/request-changes transitions |
| P5 | Approved-only package-to-draft provenance, contained and SHA-256-verified task-output staging, send receipt written to Work Item activity |
| P6 | Later-thread immutable source revision, Work Item input refresh, immediate package supersession, stale-run refusal |
| P7 | Import-triggered policy modes, idempotent decisions, unique daily admission count, operator ceiling, and kill switch |
| P8 | Role-gated Mail AI operations, evidence timeline, known-cost/unmetered split, current recovery queue, and manager-only policy editor |
| P9 | Mailbox, AutoRun, send security, persistence, cross-account identity, desktop bridge, web unit, and Playwright review-to-draft gates |
