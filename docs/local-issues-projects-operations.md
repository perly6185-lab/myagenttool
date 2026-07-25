# Local Issues and Projects operations

Local Issues are the planning source of truth. GitHub Issues are external
bindings, while Auto-runs and worktrees are execution evidence.

## GitLab and Gitea adapters

GitLab uses `MYAGENTTOOL_GITLAB_BASE_URL`, `MYAGENTTOOL_GITLAB_TOKEN`, and
`MYAGENTTOOL_GITLAB_WEBHOOK_SECRET`. Gitea uses the corresponding
`MYAGENTTOOL_GITEA_*` variables. Tokens remain in process memory and are never
written to application state or returned by readiness APIs.

Configure issue webhooks at `/api/webhooks/gitlab/work-items` or
`/api/webhooks/gitea/work-items`. GitLab validates `X-Gitlab-Token`; Gitea
validates the SHA-256 HMAC in `X-Gitea-Signature`. Deliveries are deduplicated,
stale updates are ignored, and conflicts enter the same manual-resolution flow
as GitHub. Provider API calls retry network errors, HTTP 429, and transient 5xx
responses up to three attempts.

Use `GET /api/work-items/providers` to inspect boolean API and webhook
readiness. A retained delivery can be replayed with
`POST /api/work-items/:provider/deliveries/:deliveryId/replay`; access is
restricted to teams with the matching binding.

## GitHub webhook

Set `MYAGENTTOOL_GITHUB_WEBHOOK_SECRET` and configure GitHub to send `issues`
events to `/api/webhooks/github/work-items`. The endpoint verifies
`X-Hub-Signature-256`, deduplicates `X-GitHub-Delivery`, rejects stale issue
updates, and retains the latest 1,000 delivery outcomes.

Use `GET /api/work-items/github/diagnostics` to inspect binding count, conflicts,
the last webhook time, secret configuration, team-scoped delivery outcomes, and
the aggregate health state (`healthy`, `degraded`, or `misconfigured`).

An authorized operator can replay a retained delivery with
`POST /api/work-items/github/deliveries/:deliveryId/replay`. Replay is restricted
to a delivery matching that operator's team bindings, receives a new delivery
identity, and still applies stale-update and conflict protections. Manual Pull
remains the recovery path when webhook delivery is unavailable.

## Human attention queue

`GET /api/work-items/attention` accepts `projectId`, `kind`, `severity`, `sla`,
and `includeResolved=1`. High-risk items have a four-hour SLA, medium-risk items
24 hours, and low-risk items 72 hours.

Use `POST /api/work-items/attention/actions` with up to 100 `attentionIds` and
an action of `claim`, `renew`, `release`, `resolve`, or `reopen`. Claims are
atomic across the batch and use a 15-minute lease by default; `leaseSeconds`
accepts 60–86,400 seconds. A different actor receives `409` while a lease is
active. Agents should supply an `idempotencyKey` for retries, especially when
resolving work. Resolution hides the derived item without deleting its source
evidence or operation history.

## Completion and recovery

Auto-runs copy verified checks, acceptance judgments, PR links, run IDs, and
worktree IDs into the bound Local Issue. Criteria-bearing work cannot close
until every criterion passes and at least one verification passes.

High-risk Project recommendations create an approval request. Approval resumes
the original idempotent action as a governed queued execution; denial records a
terminal decision. Repeating a delivery, approval decision, or idempotency key
is safe.
