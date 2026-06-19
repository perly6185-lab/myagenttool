# M0 Desktop Bridge Demo

This workspace contains the local demo Desktop Bridge and the safe Demo CLI
Agent used by `pnpm smoke:local`.

The demo bridge now exercises the M0 manual agent registration contract. The
default demo agent:

- accepts a plain text task,
- emits progress lines,
- sleeps long enough for cancellation tests,
- returns a structured result,
- does not read or write user files.

The built-in `demo-agent` command remains the safe smoke-test target. Manually
registered CLI agents execute with structured argv and explicit adapter
metadata instead of shell strings.
