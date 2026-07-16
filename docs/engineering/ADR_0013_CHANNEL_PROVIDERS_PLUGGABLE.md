# ADR 0013: Channel providers are pluggable; the governed core is provider-agnostic

Status: accepted · 2026-07-16

Date: 2026-07-16

Related issue: [#1111](https://github.com/perly6185-lab/myagenttool/issues/1111) (initiative [#1110](https://github.com/perly6185-lab/myagenttool/issues/1110))

## Context

ADR 0012 shipped the Channel subsystem with WeCom as its first provider and
called it "the first implementation of a reusable Channel subsystem." Adding a
second provider (Feishu/Lark, #1110) forces the question ADR 0012 deferred:
**what exactly is provider-specific, and what is shared?**

Reading the WeCom implementation against that question, the split is clean:

- **Provider-specific** — the callback cryptography and wire format (WeCom:
  SHA-1 signature, AES-256-CBC with `EncodingAESKey`, XML; Feishu: `X-Lark-Signature`
  = SHA256(timestamp+nonce+encryptKey+body), AES-256-CBC with key = SHA256(EncryptKey)
  and a prefixed IV, JSON, a `url_verification` challenge handshake), and the
  outbound client (WeCom: `access_token` + application message; Feishu:
  `tenant_access_token` + `im/v1/messages`).
- **Provider-agnostic** — everything downstream of the normalized `ChannelEvent`:
  identity mapping (fail-closed), the deterministic command parser, capability
  dispatch with the untrusted-input taint, single-use approvals, the durable
  delivery lifecycle, and the console read-model. These operate on
  `{channelId, providerMessageId, externalUserId, content}` and never on wire
  bytes.

Two small couplings in the WeCom-only code prevented a second provider from
slotting in: `readiness()` hard-coded `provider === "wecom"` with a single
probe, and the outbound sender was a single late-bound function.

## Decision

**A Channel provider is exactly three things — a readiness probe, an inbound
gateway (verify + decrypt + normalize), and an outbound client (token + send).
Everything else is shared, and provider selection is dynamic by
`channel.provider`.** Concretely:

1. **The provider set is closed and lives in the protocol** (`channelProviders`
   in `@myagenttool/protocol/channel`), with a per-provider readiness scope map
   (`channelReadinessScopes`). Registration validates against it; the console
   renders whatever scope names a provider declares.

2. **Readiness is a per-provider probe** (`defaultReadinessProbes` in
   `services/channels.mjs`): `readiness(channel)` selects the probe and scope
   list by `channel.provider`. Probes read env **presence** only — never values
   (ADR 0010/0012 rule 4).

3. **The outbound sender is routed by provider.** The delivery service resolves
   the sender for each delivery from `channel.provider`
   (`resolveSender(provider)`); a WeCom and a Feishu delivery route to their own
   client. Each provider's client is late-bound once by `index.mjs` when that
   provider's gateway is configured, so no provider secret ever reaches the
   delivery service or control-plane state.

4. **The inbound gateway is a separate per-provider public listener** (ADR 0012
   rule 1, unchanged): each provider runs its own listener on its own port and
   forwards verified, decrypted, normalized events into the *shared*
   `importChannelEvent`. The exactly-once boundary, the untrusted-input taint,
   the refusal chokepoint, and every governance gate are the shared ones.

5. **No provider may change another provider's behavior, nor the shared core's
   contracts.** Adding a provider is additive: a probe, a gateway module, a
   client module, three wiring lines. It never edits the conversation, approval,
   delivery-lifecycle, or console logic.

## Consequences

- Feishu (#1110) is a leaf addition: `feishu-crypto` + `feishu-gateway` (F2),
  `feishu-client` + per-provider delivery wiring (F3), reusing S2/S4/S5/S6/S7
  unchanged. WeCom is untouched (its full suite stays green).
- The reusable-subsystem claim of ADR 0012 is now load-bearing, not aspirational:
  the shared/specific line is drawn in code and tested (a WeCom and a Feishu
  delivery route independently in one process).
- Cost: two small generalizations (readiness map, sender routing) that keep
  back-compat (a bare `readinessProbe`/`sendMessage` still binds WeCom), so no
  existing caller or test changed behavior.
- A third provider (Slack, Teams, …) follows the same three-part recipe without
  re-opening this decision.

## Alternatives considered

- **A provider abstraction/interface class each provider implements.** Rejected
  as premature: with two providers the three seams (probe, gateway, client) are
  small concrete functions wired in `index.mjs`; an interface layer would add
  indirection without removing any real duplication. Revisit at the third
  provider if a registry pattern earns its keep.
- **One shared gateway that branches on provider inside.** Rejected: it would
  merge two credential sets and two wire formats behind one public socket,
  undercutting ADR 0012 rule 1 (one socket = one exposure decision) and making
  the crypto harder to audit. Separate listeners keep each provider's attack
  surface isolated.
- **Store per-provider credentials on the Channel record to auto-start gateways.**
  Rejected by ADR 0010/0012 rule 4: secrets stay in the gateway process env;
  the control-plane record carries readiness booleans only.
