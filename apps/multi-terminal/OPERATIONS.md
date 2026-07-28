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

## SLO and notifications

The console evaluates availability, stale-terminal count, mean terminal recovery
time, and the last 100 owner-operation outcomes. Defaults are 99%, 0 stale,
24 hours, and 95% respectively. Override with:

- `MULTI_TERMINAL_SLO_AVAILABILITY`
- `MULTI_TERMINAL_SLO_STALE`
- `MULTI_TERMINAL_SLO_RECOVERY_HOURS`
- `MULTI_TERMINAL_SLO_OPERATION_SUCCESS`

Set `MULTI_TERMINAL_ALERT_WEBHOOK_URL` to an HTTPS (or loopback HTTP) endpoint
to receive only healthy/breached transitions. The UI and `/api/slo` expose
7/30/90-day history without exposing notification credentials.

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

For a filesystem release:

```sh
pnpm --filter @myagenttool/multi-terminal release:install -- \
  /path/to/extracted-release /opt/myagenttool-multi 1.1.0
pnpm --filter @myagenttool/multi-terminal release:rollback -- \
  _ /opt/myagenttool-multi
```

The release state swaps only the active version metadata. Registry, audit, SLO,
and recovery data remain outside versioned release directories.

## Production hardening

- Non-loopback binding fails closed unless `MULTI_TERMINAL_TRUST_PROXY=true`
  and `MULTI_TERMINAL_TLS_TERMINATED=true`; `deploy/nginx.conf` is the TLS
  reverse-proxy baseline.
- Keep admin, observer, operator, and webhook secrets in the host keychain or
  service credential manager. `POST /api/admin/session` exchanges the admin
  secret for an expiring in-memory session.
- Set `MULTI_TERMINAL_ALERT_WEBHOOK_SECRET` to sign webhook bodies with a
  timestamped HMAC-SHA256 signature. Receivers should reject timestamps older
  than five minutes.
- Managed alerts are deduplicated and support acknowledge, silence, resolve,
  and explicit recovery notification through admin-protected endpoints.
- Automatic recovery is opt-in and allowlists only idempotent retry with an
  immutable owner reference. Replay, migration, failover, and target selection
  are never automatic.
- Before an upgrade, stop the service and back up the persistent
  `.myagenttool` directory. Install metadata records package SHA-256 integrity;
  restore persistent data only while stopped.

The production drill covers restart, network loss, timeout, disk failure,
failed upgrade, and rollback. Record detection time and RTO for each fault and
verify all retries remain on the registered owner. Scale acceptance runs at
10, 50, and 100 terminals.
