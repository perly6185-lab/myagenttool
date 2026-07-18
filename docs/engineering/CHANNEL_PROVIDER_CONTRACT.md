# Channel Provider Contract

All shipped Channel gateways implement the same production boundary even though
their wire protocols differ. The machine-readable matrix is
`tools/dev/provider-contracts.json`; run it with:

```text
pnpm smoke:channel-providers
```

The smoke is a pull-request gate and verifies five contracts for WeCom, Feishu,
DingTalk, Slack, and Teams:

- authentic requests require the Provider's signature or signed token;
- stale and replayed requests cannot create another imported event;
- outbound Provider calls carry a 10-second abort signal;
- inbound bodies are byte-bounded before parsing or key lookup;
- Provider retry identifiers map to one imported event and one effective run.

Provider gateway listeners expose only their callback path. Control-plane routes
remain unavailable there. Secrets stay in gateway/client closures and never enter
Channel state, events, refusals, public API responses, or test reports.

## WeCom Acceptance

`integration/wecom-channel-acceptance.test.mjs` drives a signed and encrypted
WeCom message through the real gateway, registry, identity mapping, mechanical
command parser, governed Invocation correlation, durable delivery queue, and
final-result notification. It asserts two successful outbound deliveries and
then replays the identical callback: the replay is rejected and the Invocation
count remains one.

Additional Provider development is intentionally deferred. This contract suite
is the stable base for future adapters without expanding the current release.
