# Project Diagnostic Remediation (2026-07)

## Current facts

- The supported product is single-user, single-terminal; multi-terminal is a
  separate frontend and composes terminal APIs without cross-terminal scheduling.
- SQLite is the durable default. The service remains intentionally single-writer.
- Entry, Settings, Trace, local Issues, Application execution, Channels,
  approvals, evidence, recovery, and three-browser journeys are implemented.
- Realtime invalidation is primary; bounded, visibility-aware polling is fallback.

## This remediation

1. Production dependency audit is a required CI gate; `lodash-es` is pinned to
   the patched line through a root override.
2. Incremental seams replace big-bang rewrites: Trace contracts/API are removed
   from the global state/client modules, Application dependency derivation is a
   pure feature module, and polling policy is centralized.
3. Trace search has a deterministic 100k-record performance/correctness budget.
4. Application dependencies expose declared, configured, verified, used, and
   unavailable lifecycle states.
5. A secret-free, opt-in self-hosted nightly verifies real Codex/Claude CLI
   availability before deterministic capability contracts.

## Remaining scale boundaries

- `service-composer.mjs`, Desktop execution, and Task detail remain large. Future
  extractions must move one tested responsibility at a time.
- Trace search currently builds bounded records per query. The benchmark is the
  ratchet; crossing its budget triggers an indexed SQLite search implementation.
- Real-provider nightly is disabled unless
  `ENABLE_REAL_PROVIDER_NIGHTLY=true`; it must never run on untrusted PR code.
