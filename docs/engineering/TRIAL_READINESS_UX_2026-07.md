# Controlled-trial UX readiness

The supported trial remains single-user and single-terminal. Code changes and
merge remain human-reviewed.

## Trial entry

- Entry exposes three safe first-task templates and keeps the generated prompt
  editable before execution.
- Entry action failures use one model: cause, impact, remediation, and a bounded
  retry when retrying is safe.
- Operational health raises durable attention signals for reaped/stuck tasks,
  unhealthy execution providers, and Applications requiring login.

## Trial measures

The Auto-runs view already exposes the required non-fabricated measures:

- PR success rate;
- median time to PR;
- human escalation rate;
- routing alignment over conclusive runs;
- median recovery time.

Empty populations render as no data rather than zero.

## Incremental module boundaries

Large modules are not rewritten during the trial. Tested responsibilities are
already moving behind narrower seams:

- Task detail delegates acceptance, execution actions, external sync,
  observability, section navigation, trace links, and worktree options to feature
  modules.
- Desktop execution delegates readiness, policy, credentials, and process
  supervision to dedicated modules while `index.mjs` remains the composition
  root.
- Server composition delegates routing, metrics, operational health, recovery,
  persistence, and invocation behavior to services/read-models while
  `service-composer.mjs` remains the wiring root.

Further extraction is responsibility-at-a-time and must preserve a focused
contract test; file size alone is not a trial blocker.
