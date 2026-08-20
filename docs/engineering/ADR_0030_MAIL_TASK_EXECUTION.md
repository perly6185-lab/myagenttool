# ADR 0030: Mail analysis and reply preparation execute as governed Work Items

- Status: Accepted
- Date: 2026-08-20
- Extends: [ADR 0011](ADR_0011_MAIL_UNTRUSTED_INPUT.md), [ADR 0024](ADR_0024_USER_AUTHORED_MAIL_DRAFT.md), [ADR 0027](ADR_0027_MANAGED_MAIL_ARCHIVE.md)

## Context

The mailbox can receive, classify, read, draft, attach, and approval-gate mail.
The task plane already owns durable inputs, clarification, execution contracts,
automatic execution, delivery review, revisions, and evidence. Adding a separate
mail-specific AI runtime would duplicate those controls and leave mail analysis
outside the user's ordinary task history.

Mail is attacker-controlled input. A useful assistant may analyze it and prepare
a response, but model output must never acquire send authority or reference an
arbitrary local file merely by naming it.

## Decision

### 1. A mail message is an intake source; a Work Item is the execution subject

Detailed analysis, attachment inspection, clarification, reply preparation, and
attachment creation run only through a tenant-scoped Work Item. Mail
classification remains a read-only triage signal. It may recommend or, under an
explicit rule, materialize a Work Item; it does not run business analysis or
create an outbound draft itself.

The durable mail/task link is account- and conversation-scoped. Replaying one
message is idempotent, and a later message in the same conversation appends a
new immutable input version to the existing task instead of silently creating a
second task.

Every imported message also receives a stable public identity derived from the
account plus provider `Message-ID`. Legacy raw `Message-ID` lookup is accepted
only when it resolves to exactly one account; ambiguity fails closed.

### 2. Mail task inputs retain untrusted provenance

The source message, conversation context, and selected attachments become task
materials. Every derived prompt fences them as untrusted data. Their hashes and
source identities are frozen into the execution contract. Prompt-injection
signals are retained as evidence and make the run ineligible for automatic
approval; they do not let an attacker suppress read-only analysis.

### 3. Mail tasks use a restricted execution profile

A mail-response run may read its task materials and write task delivery
artifacts. It has no mail-send tool, provider-organize tool, ambient credential,
or arbitrary external-write authority. Project and Application writes continue
to require their own existing preview and approval contracts.

The restricted profile is currently admitted only through the Codex CLI's
approval sandbox. Other adapters, or a run without the current source revision
and fingerprint, are refused before a Worktree or invocation is created.

Professional configuration may select eligible agents, budgets, templates, and
routing. It cannot widen the profile to auto-send or bypass the untrusted-input
approval floor.

### 4. A validated response package is the task delivery contract

Agent output is normalized into a bounded, revisioned `MailResponsePackage`:

```text
analysis summary, requested actions, deadlines, risks, missing information,
reply strategy, reply body, task-output attachment ids, evidence references,
source fingerprint, execution id, review verdict
```

Only a package whose source version is current and whose delivery review is
approved may create a mail draft. Unknown fields, invalid attachment identities,
oversized content, and stale source fingerprints are refused.

Review is a one-way transition from `ready_for_review`; terminal, superseded,
or already reviewed packages cannot be reviewed again. Draft creation accepts
only `approved` packages.

### 5. Draft creation and send remain separate gates

Creating a draft copies recipient/threading from the authoritative source mail,
the body from the approved response package, and attachments from verified task
outputs. It records Work Item, AutoRun, package, and source revisions.

Sending remains ADR 0011's exfiltration boundary and ADR 0024's revision-bound
action. The source mail and complete outgoing draft are reviewed together. No
mail-task rule, operator setting, template, or Agent output can automatically
send.

Task outputs cross into a draft only through the desktop staging boundary. The
server publishes a project-relative path and frozen SHA-256; the desktop resolves
the file inside the registered Project or Worktree, verifies the hash, then
creates the same private `mailatt_*` copy used by manually selected attachments.

### 6. Ordinary and professional surfaces are projections of one model

Ordinary copy uses “交给 AI 处理”, “AI 正在处理”, “需要你补充”, and “回复待检查”.
Technical identifiers, hashes, policy decisions, traces, and rule details are
available through professional details and audit surfaces. Neither surface owns
a separate lifecycle or mutable copy of the result.

### 7. Automation rolls out through an explicit state machine

Account-scoped mail-task automation uses:

```text
off -> shadow -> create_only -> create_and_run
```

Rules are bounded by sender/folder/classification conditions, daily limits,
attachment policy, project routing, and a global kill switch. `shadow` records
decisions without writing Work Items. No mode includes draft send.

Policy mutations require owner/admin authority, operational evaluation admits
operators, and viewers do not receive the Mail AI operations entry point.
Imported mailbox batches invoke matching policies automatically and repeated
evaluation of the same policy/account/message is idempotent.

## Consequences

- Mail work appears in the same task queue, progress view, result review, cost
  ledger, and audit trail as other work.
- The existing task-material and AutoRun recovery machinery is reused.
- Mail-to-task materialization and task-output-to-draft attachment publication
  require explicit, hash-verified bridge services.
- Existing manually created mail tasks remain compatible and gain richer link
  projections as they are read.
- Release must be feature-flagged and must prove idempotency, stale-revision
  refusal, cross-tenant isolation, and no automatic-send path.
