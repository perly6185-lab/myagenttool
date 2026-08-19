# Work Items preproduction runbook

## Required configuration

- Set `MYAGENT_REQUIRE_AUTH=1`.
- Set a non-empty `MYAGENTTOOL_GITHUB_WEBHOOK_SECRET`.
- Enable persistent state and place the state store on backed-up storage.
- Configure GitHub to send only `issues` events to
  `/api/webhooks/github/work-items`.
- For GitLab, set `MYAGENTTOOL_GITLAB_BASE_URL`,
  `MYAGENTTOOL_GITLAB_TOKEN`, and (for webhooks)
  `MYAGENTTOOL_GITLAB_WEBHOOK_SECRET`.
- For Gitea, set `MYAGENTTOOL_GITEA_BASE_URL`, `MYAGENTTOOL_GITEA_TOKEN`, and
  (for webhooks) `MYAGENTTOOL_GITEA_WEBHOOK_SECRET`.
- In Settings, review each project's external Issue switches. Keep automatic
  execution off for the first canary and verify the emergency stop before go-live.

Before rollout, `GET /api/work-items/github/diagnostics` must report
`secretConfigured: true`. The attention queue must report zero unexplained SLA
breaches.

For every enabled provider, `GET /api/work-items/providers` must report
`apiSync: true`. From the Tasks import dialog, run a read-only search against a
canary repository, import one disposable Issue, complete it locally, and test
both completion choices: local-only and explicit provider writeback. Verify a
writeback failure leaves the Local Issue completed and visible as pending in
the external Issue funnel.

Run the offline configuration gate with the same environment that will start
the service:

```sh
node tools/dev/work-items-preflight.mjs
```

For an online canary gate, also set `WORK_ITEMS_PREFLIGHT_URL` and
`WORK_ITEMS_PREFLIGHT_TOKEN`. The tool then verifies health, team-authenticated
GitHub diagnostics, and attention metrics. It prints a machine-readable JSON
report and exits non-zero when a required check fails.

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
- External intake not started and review waiting: warn after 24 hours.
- Completed Local Issues pending provider writeback: warn immediately and page
  if the backlog grows continuously for 30 minutes.
- Queue backlog: establish the initial baseline during canary and alert at
  twice the seven-day median.

## Canary and rollback

Deploy to one team first. Observe at least one full business day and exercise a
signed delivery, approval, batch claim, lease expiry, and safe replay. Roll back
the application when authorization isolation, persistence, or stale-event
protection fails. Preserve the state store when rolling back; older binaries
ignore the additive collections.

Go only when all of the following are true:

- Offline and online preflight reports are both `ready: true`.
- The capacity benchmark completes without invariant failures.
- No cross-team data is visible during the replay exercise.
- Webhook failure rate stays below 1% and there are no unexplained SLA breaches.
- A backup restore drill has succeeded against the release candidate.

Stop or roll back on any authorization leak, lost approval/claim state,
newer-to-older issue regression, persistent `degraded` diagnostics, or a
capacity regression greater than 50% from the environment's accepted baseline.

Before using an external environment, run the isolated rehearsal:

```sh
node tools/dev/work-items-canary-drill.mjs
```

It combines the release preflight, capacity gate, authenticated/HMAC HTTP flow,
team-isolation checks, and backup/restore persistence tests. Its JSON report
sets `externalDeploymentPerformed: false`; a passing rehearsal is necessary but
does not claim that a real team environment has been deployed or observed.
Run the capacity gate without competing CPU-intensive jobs. The benchmark
warms the batch path before measuring steady-state throughput; use the overall
drill duration to track cold-process startup separately.

## Capacity baseline

Run:

```sh
node tools/dev/work-items-capacity-benchmark.mjs
```

The default workload aggregates 10,000 attention rows, verifies and parses 1,000
signed stale Webhook payloads through the service ingestion path, and atomically
claims 100 rows. It does not include network or durable-storage latency; measure
those separately against the canary HTTP endpoint. The script emits one JSON
report and exits non-zero if counts, retention, batch atomicity, or accepted
duration thresholds regress.
Override sizes with `WORK_ITEMS_BENCH_QUEUE`, `WORK_ITEMS_BENCH_DELIVERIES`, and
`WORK_ITEMS_BENCH_BATCH` (batch size remains capped at the API maximum of 100).
Set environment-specific accepted baselines with
`WORK_ITEMS_BENCH_QUEUE_BASELINE_MS`, `WORK_ITEMS_BENCH_DELIVERY_BASELINE_MS`,
and `WORK_ITEMS_BENCH_BATCH_BASELINE_MS`. The default allowed regression factor
is 1.5 and can be changed with `WORK_ITEMS_BENCH_REGRESSION_FACTOR`.

Initial local baseline on 2026-07-24:

- 10,000-row queue aggregation: 19.8 ms.
- 1,000 signed payload verification, parsing, and ingestion operations: 7.8 ms.
- 100-row atomic claim: 13.2 ms.

Use environment-specific canary measurements for release decisions; these
numbers are a regression reference, not a universal production SLO.
