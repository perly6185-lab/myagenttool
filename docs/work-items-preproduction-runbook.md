# Work Items preproduction runbook

## Required configuration

- Set `MYAGENT_REQUIRE_AUTH=1`.
- Set a non-empty `MYAGENTTOOL_GITHUB_WEBHOOK_SECRET`.
- Enable persistent state and place the state store on backed-up storage.
- Configure GitHub to send only `issues` events to
  `/api/webhooks/github/work-items`.

Before rollout, `GET /api/work-items/github/diagnostics` must report
`secretConfigured: true`. The attention queue must report zero unexplained SLA
breaches.

## Failure drills

### Service interruption

1. Claim one attention item and create one pending project approval.
2. Stop the service without releasing the claim.
3. Restart from the same state store.
4. Verify the claim expiry, approval context, delivery history, and audit
   activity are unchanged.
5. After the lease expires, verify another operator can claim the item.

### Webhook storm and replay

1. Send a current signed issue event.
2. Send duplicate and older deliveries, then a burst of at least 1,000 events.
3. Verify the local title never regresses and retained history stays capped at
   1,000 deliveries.
4. Replay one retained delivery as its owning team and verify another team gets
   `404`.

### Persistence recovery

1. Back up the state store before the drill.
2. Start a copy of the service against the backup in an isolated environment.
3. Verify attention operations, approvals, Webhook deliveries, and failures.
4. If the store cannot be restored, return to the last known-good backup and
   use manual GitHub Pull to reconcile bindings.

## Alert thresholds

- Attention SLA breaches: alert when greater than zero for 10 minutes.
- Webhook failure rate: warn above 1%; page above 5% over 15 minutes.
- Pending approvals: warn when the oldest item exceeds four hours.
- Queue backlog: establish the initial baseline during canary and alert at
  twice the seven-day median.

## Canary and rollback

Deploy to one team first. Observe at least one full business day and exercise a
signed delivery, approval, batch claim, lease expiry, and safe replay. Roll back
the application when authorization isolation, persistence, or stale-event
protection fails. Preserve the state store when rolling back; older binaries
ignore the additive collections.
