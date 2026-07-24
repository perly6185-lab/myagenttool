# Local Issues and Projects operations

Local Issues are the planning source of truth. GitHub Issues are external
bindings, while Auto-runs and worktrees are execution evidence.

## GitHub webhook

Set `MYAGENTTOOL_GITHUB_WEBHOOK_SECRET` and configure GitHub to send `issues`
events to `/api/webhooks/github/work-items`. The endpoint verifies
`X-Hub-Signature-256`, deduplicates `X-GitHub-Delivery`, rejects stale issue
updates, and retains the latest 1,000 delivery outcomes.

Use `GET /api/work-items/github/diagnostics` to inspect binding count, conflicts,
the last webhook time, and recent delivery outcomes. Manual Pull remains the
recovery path when webhook delivery is unavailable.

## Human attention queue

`GET /api/work-items/attention` accepts `projectId`, `kind`, `severity`, `sla`,
and `includeResolved=1`. High-risk items have a four-hour SLA, medium-risk items
24 hours, and low-risk items 72 hours.

Use `POST /api/work-items/attention/actions` with up to 100 `attentionIds` and
an action of `claim`, `release`, `resolve`, or `reopen`. Resolution hides the
derived item without deleting its source evidence or operation history.

## Completion and recovery

Auto-runs copy verified checks, acceptance judgments, PR links, run IDs, and
worktree IDs into the bound Local Issue. Criteria-bearing work cannot close
until every criterion passes and at least one verification passes.

High-risk Project recommendations create an approval request. Approval resumes
the original idempotent action as a governed queued execution; denial records a
terminal decision. Repeating a delivery, approval decision, or idempotency key
is safe.
