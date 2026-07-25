# Multi-terminal operations and security

## Deployment boundary

Run this service separately from every single-terminal server. It binds to
loopback by default. Put authentication and TLS at the reverse proxy before
exposing it beyond the local machine.

The composition service is an observation and owner-operation proxy. It never
accepts task creation, a target-terminal override, pooled capacity, migration,
or failover. Each resource key is `terminalId + localResourceId`.

## Credentials

The registry stores only `observerTokenEnv`. Supply each scoped terminal token
through that environment variable at process start. Raw tokens are rejected
from registration and never appear in browser responses. Protect registration
changes with a distinct `MULTI_TERMINAL_ADMIN_TOKEN` of at least 24 characters.
Rotate a terminal token at its owner, update the referenced environment value,
and restart this service.

Use separate observer and operator tokens. Rotation is additive: provision the
new terminal token, update the referenced environment variable, restart the
composition service, verify `/health` and `/api/overview`, then revoke the old
token. The registry format remains backward compatible; an absent
`operatorTokenEnv` simply disables successful owner mutations.

## Failure and recovery

- A failed or timed-out owner request returns HTTP 503 with
  `owning_terminal_unavailable` and `migrated: false`.
- Do not register another terminal under the same ID during an outage.
- Once the owner returns, its local task and trace reappear under the same
  compound identity and deep link.
- Recovery observations are stored mode `0600`, de-duplicated per minute,
  bounded to 10,000 rows, and queryable in 7/30/90-day windows.
- A latest median above 24 hours produces `recovery_objective_missed`.

## Security review checklist

- Registry URLs require HTTPS, except loopback HTTP.
- URL credentials, query strings, fragments, raw tokens, and unsafe IDs fail
  closed.
- Bridge, credential, settings, and filesystem paths are denied.
- Action adapters map only to existing owner APIs for cancel, retry, replay,
  and Application refresh; arbitrary paths cannot be supplied.
- Static responses set CSP, `nosniff`, and no-referrer headers.

## Performance baseline

The contract test composes 100 terminals with 1,000 visible task summaries in
under one second on the local test runner. Each terminal request has a five
second timeout and all terminals are fetched concurrently, so one offline
terminal does not serialize the overview.

## Fault drill and upgrade

1. Stop one owning terminal and verify cached rows are marked stale and no task
   appears under another terminal.
2. Submit three failing owner operations with distinct idempotency keys and
   verify the owner circuit opens.
3. Restart the owner, wait for the circuit interval, and confirm the same
   compound task identity and deep link recover.
4. Restart this service and verify the mode-`0600` registry, recovery history,
   idempotency results, and operation audit reload.

The container image is stateless except for `.myagenttool`; mount that directory
as a persistent volume. Deploy a new image against the same directory, check
`/health`, then switch traffic. Rollback uses the previous image without a data
migration.
