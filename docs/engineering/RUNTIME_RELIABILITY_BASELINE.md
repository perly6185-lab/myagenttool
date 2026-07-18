# Runtime Reliability Baseline

The runtime health contract combines device capacity, dispatch queue reasons,
redelivery, same-device Agent failover, Issue claim expiry, and explicit human
intervention. The API remains team-scoped for work records while device capacity
is intentionally global because every tenant shares the physical slots.

## Fault Matrix

| Fault | Expected terminal behavior | Evidence |
| --- | --- | --- |
| Bridge disconnect before acknowledgement | bounded redelivery, then `dispatch_timeout` | `dispatch-durability.test.mjs`, `bridge-liveness.test.mjs` |
| Live capacity change | new readiness cap controls subsequent dispatch | `bridge-readiness-maxconcurrency.test.mjs` |
| Agent infrastructure failure | same-device, same-adapter failover; tried Agents excluded | `agent-failover.test.mjs`, `auto-run.test.mjs` |
| Cancellation versus late event | cancellation remains terminal; late event is rejected | `bridge-auth.test.mjs`, `bridge-events.test.mjs`, local smoke |
| Process restart | dispatch lease, claims, audit history, and failure data restore | `dispatch-durability.test.mjs`, `issue-claims.test.mjs`, `persistence.test.mjs` |

One logical auto-run may have multiple Invocation attempts, but only its current
Invocation can advance the run. Failover is bounded to two transitions, stays on
the same device and adapter type, records old/new Invocation IDs, and exposes a
`needs_human` state when recovery cannot continue.

## Capacity Probe

Run the deterministic read-model benchmark with:

```text
pnpm benchmark:runtime-health
```

Defaults are 20,000 queued and 5,000 settled Invocations. The command verifies
the complete counts and prints a JSON report containing elapsed time and derived
Invocations per second. Timing is evidence, not a CI assertion: shared runners
vary too much for a stable wall-clock threshold. Override the workload with
`RUNTIME_HEALTH_QUEUED` and `RUNTIME_HEALTH_SETTLED`.
