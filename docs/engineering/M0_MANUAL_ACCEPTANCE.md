# M0 Manual Acceptance

This document records the M0 initiative acceptance path for a human reviewer.

## Reviewer Flow

Start the local demo:

```text
pnpm dev
```

Open:

```text
http://127.0.0.1:5000
```

Review these user-visible surfaces:

- Plain-language task field.
- Computer selector and online state.
- Agent selector and ready state.
- Safety, data, cost, and cancellation review.
- Run and cancel actions.
- Activity timeline.
- Result summary.
- Audit summary.
- Collapsed technical details for ids, trace, adapter, and raw state.

## Scripted Acceptance Evidence

Run:

```text
pnpm acceptance:m0
```

The script starts isolated local services on ports 3220, 3221, and 3222. It
checks:

- Web Console page surfaces.
- Offline queued invocation dispatch after bridge reconnect.
- Manual CLI agent registration and successful invocation.
- Manual HTTP agent registration and successful invocation.
- Status, logs, trace, audit, and unknown-cost visibility.
- Running cancellation and audited cancellation result.
- Device unlink credential revocation, queued cleanup, and audit evidence.

## M0 Initiative Decision

Issue #1 can be closed when:

- `pnpm acceptance:m0` passes.
- Standard local checks pass.
- The human reviewer does not find a P0/P1 usability, safety, cancellation, or
  audit problem in the local Web Console.

Known M0 boundaries remain documented in
[M0_ACCEPTANCE_CLOSEOUT.md](M0_ACCEPTANCE_CLOSEOUT.md).
