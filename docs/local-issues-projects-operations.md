# Local Issues and Projects operations

Local Issues are the planning source of truth. GitHub Issues are external
bindings, while Auto-runs and worktrees are execution evidence.

## Local-first development boundary

Every development execution must be addressed by a non-archived Local Issue.
The terminal, AI agents, Auto-runs, worktrees, and unattended Auto-trigger
queues all use the Local Issue ID as their execution identity.

External GitHub, GitLab, or Gitea Issues are intake and context only. To bring
one into development, use `POST /api/work-items/from-external`; this creates a
Local Issue and records the external relation in `externalBindings`. The
relation metadata includes `relation`, `isPrimary`, `syncPolicy`, `linkedAt`,
and `linkedBy`. Re-importing the same provider issue in the same project is
rejected as a duplicate.

Direct Auto-run or worktree creation with an unbound external Issue is rejected
with `409 local_issue_required`. Auto-trigger only selects external Issues that
already have a matching, active Local Issue. This prevents an external Issue
from silently becoming an execution task or disappearing from the local plan.

## Creating and starting work from Home

Home creates tracked Local Issues rather than temporary runs. A user can choose
**Create task only**, open the new task in Simple details, and later choose
**Let AI start**. This path stores `waitingOn: none` so an intentionally deferred
task remains startable without entering Expert details.

**Create and let AI work** is enabled only after the current project passes the
Auto-run preflight. The check is repeated immediately before creation to avoid
starting from stale readiness. A blocked check does not create a partial task;
it lists the reason and opens the relevant Agent, Device, Project, Economics,
or Auto-run setup page. Returning from setup restores the selected Local Issue,
and **Recheck** reruns readiness without requiring a browser refresh.

Reference-file drafts are project-bound. Switching projects clears files staged
for the previous project and resets the creation idempotency key. Creation is
disabled while the server is offline, and an empty project list links directly
to project setup.

## Importing from the Tasks UI

Use **Tasks → Import external issue** for an operator-facing intake flow:

1. Select GitHub, GitLab, or Gitea and the owning local project.
2. For GitLab or Gitea, enter the repository path (`owner/repo`; GitLab also
   accepts nested group paths). Import one Issue by number, or search the open
   Issue list, page through results, and select up to 20 loaded Issues for a
   batch import.
3. Review the inline connection check and choose **Import as local issue** or
   **Import selected issues**.
4. The created Local Issue opens in Simple details. Review its goal and
   reference materials, then explicitly choose **Let AI start**.

GitHub checks both the ready repository target and the `gh` connection before
enabling import. GitLab and Gitea use the boolean readiness response from
`GET /api/work-items/providers`; secrets are never returned to the browser.
Re-importing an already-linked Issue opens the existing Local Issue instead of
leaving the user at a duplicate error.

External bindings use manual synchronization by default. When a user accepts a
result, the completion dialog explicitly asks whether to complete only the
Local Issue or also write back and close the external Issue. Local completion
is committed first. If provider writeback fails, the Local Issue stays safely
completed and **Manage sync** is the retry path.

Before **Let AI start** is enabled, Simple details runs the project Auto-run
preflight. Missing agents, a non-Git repository, an unlinked bridge, an open
kill switch, an exhausted budget, or saturated capacity blocks execution with
a plain-language reason and a link to Settings. Warnings such as a missing
verification command remain visible but do not block an attended start.

## Project safety controls

Open **Settings → External issue project controls** for the current project.
The four switches are enforced by the HTTP routes, not only by the browser:

- **Allow intake and binding** controls creation of new external bindings.
- **Allow writeback** controls provider pushes, conflict resolution that picks
  local data, and remote closure.
- **Allow automatic execution** is an authorization boundary for automation;
  it does not prevent a person from starting an already-created Local Issue.
- **Emergency stop** pauses intake, binding, sync, and writeback without
  deleting Local Issues, bindings, or audit evidence.

New projects receive safe defaults: intake and writeback are on, automatic
execution and emergency stop are off. Legacy projects without this additive
policy retain their prior Auto-trigger behavior until an operator saves the new
controls, which avoids silently disabling an existing automation. Use emergency
stop during a credential incident or provider outage, then review the external
Issue funnel before re-enabling operations.

The Tasks Local tab reports the external funnel (`not started`, `running`, `in
review`, and `completed`) from all team-visible external bindings. It highlights
failed executions, imports not started for 24 hours, reviews waiting for 24
hours, and completed Local Issues that still need manual writeback. Each alert
opens the task at the relevant recovery surface. The same read model is
available from `GET /api/work-items/external-funnel`.

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

Use `GET /api/work-items/external-issues` with `provider`, `projectId`,
`repository`, optional `q`, `page`, and `limit` (maximum 50) to browse open
GitLab or Gitea Issues. The route is team-scoped, observes the project intake
and emergency-stop switches, and never exposes provider credentials.

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
