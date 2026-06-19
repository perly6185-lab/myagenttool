# M0 Desktop Bridge Demo

This workspace contains the local demo Desktop Bridge and the safe Demo CLI
Agent used by `pnpm smoke:local`.

The demo agent:

- accepts a plain text task,
- emits progress lines,
- sleeps long enough for cancellation tests,
- returns a structured result,
- does not read or write user files.

It is intentionally hardcoded. It does not execute arbitrary user commands.
