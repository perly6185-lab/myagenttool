# Work Items canary rehearsal report

Date: 2026-07-24

Scope: isolated local single-team rehearsal. No external deployment was
performed.

## Result

Overall: passed.

- Release configuration preflight: passed.
- Capacity gate: passed.
- Authenticated HTTP and signed GitHub Webhook flow: passed.
- Team isolation and cross-team replay refusal: passed.
- Persistent-state backup/restore coverage: passed.

Observed steady-state capacity across three consecutive drill runs:

- 10,000 attention rows: 19.58–22.55 ms (gate: 29.70 ms).
- 1,000 signed delivery ingestions: 8.64–9.47 ms (gate: 11.70 ms).
- 100-row atomic claim: 13.10–15.87 ms (gate: 19.80 ms).

The initial batch result was close to the local threshold. A repeated run
exposed first-call JIT variance, so the benchmark now warms the batch path
before measuring steady-state throughput. Re-baseline from multiple samples in
the target environment before external rollout.

## External canary still required

Provide a target URL and team-scoped token, then run the online preflight and
observe one business day. Exercise one real signed GitHub delivery, one
approval, one lease expiry, one safe replay, and one backup restore before
declaring production readiness.
