# Multi-terminal console

This is a separately runnable, observation-only frontend and composition service
for one user's independent single-terminal installations.

```sh
MULTI_TERMINALS_JSON='[
  {
    "id":"studio",
    "name":"Studio",
    "apiUrl":"http://127.0.0.1:4310",
    "consoleUrl":"http://127.0.0.1:4173",
    "observerTokenEnv":"STUDIO_OBSERVER_TOKEN",
    "operatorTokenEnv":"STUDIO_OPERATOR_TOKEN"
  }
]' STUDIO_OBSERVER_TOKEN='read-only-observer-token' \
STUDIO_OPERATOR_TOKEN='scoped-owner-operation-session-token' \
MULTI_TERMINAL_ADMIN_TOKEN='replace-with-at-least-24-characters' \
pnpm --filter @myagenttool/multi-terminal start
```

Open `http://127.0.0.1:4311`. Each registry entry is an explicit terminal
address. The service reads only the versioned, read-only
`/api/terminal-observation/v1` contract. Owner operations use a separate
operator session token. It does not call Bridge, credential, or
filesystem endpoints and never returns observer tokens to the browser.
Registration changes use `POST /api/terminals` and
`DELETE /api/terminals/:id`, require the separate admin bearer token, and
persist only environment-variable references in a mode-`0600` registry.

The management section supports registration/editing, deletion, owner health
diagnostics, and redacted operation audit. `/api/slo` and the SLO panel expose
availability, freshness, recovery, and operation-success trends.

The ordinary overview includes first-run pairing guidance and owner-local
remediation. Trace search links terminal, task, Application, Channel, asset,
operation, and evidence identifiers while complete evidence remains on the
owner. Production deployment and fault-drill controls are documented in
`OPERATIONS.md`.

## Boundary

- Every resource is addressed as `terminalId + localResourceId`.
- Counts are per terminal. Totals are presentation-only and never form a queue.
- Cancel, retry, replay, and maintenance are proxied to the owning terminal.
- Mutations require an `Idempotency-Key` header (8–128 safe characters).
- An unavailable owner returns `503 owning_terminal_unavailable`; no migration
  or fallback occurs.
- Task creation, pooled capacity, target-terminal override, migration, and
  cross-terminal failover are intentionally absent from both UI and API.
