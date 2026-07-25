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
    "observerToken":"scoped-session-token"
  }
]' pnpm --filter @myagenttool/multi-terminal start
```

Open `http://127.0.0.1:4311`. Each registry entry is an explicit terminal
address. The service reads only the terminal's authenticated public state,
work-item, and operational-health APIs. It does not call Bridge, credential, or
filesystem endpoints and never returns observer tokens to the browser.

## Boundary

- Every resource is addressed as `terminalId + localResourceId`.
- Counts are per terminal. Totals are presentation-only and never form a queue.
- Cancel, retry, replay, and maintenance are proxied to the owning terminal.
- An unavailable owner returns `503 owning_terminal_unavailable`; no migration
  or fallback occurs.
- Task creation, pooled capacity, target-terminal override, migration, and
  cross-terminal failover are intentionally absent from both UI and API.
