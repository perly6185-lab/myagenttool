# @myagenttool/protocol

Shared TypeScript protocol skeleton for `com.myagenttool`.

This package defines the first M0 contract types shared by:

- Web Console.
- Server control plane.
- Desktop Bridge.
- Agent adapters.

It currently contains shared type definitions, M0 protocol vocabulary constants,
and a small vocabulary self-check. It does not implement transport, validation,
persistence, invocation execution, billing, or adapter behavior.

Source documents:

- `docs/vision/AGENT_PROTOCOL.md`
- `docs/vision/STATE_MACHINE.md`
- `docs/vision/ECONOMIC_LEDGER.md`

Protocol namespace:

```text
com.myagenttool
```
