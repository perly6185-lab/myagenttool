# ADR 0012: A Channel is a governed conversation boundary; the gateway is a separate public listener; channel credentials never enter control-plane state

Status: accepted · 2026-07-15

Date: 2026-07-15

Related issue: [#1093](https://github.com/perly6185-lab/myagenttool/issues/1093) (initiative [#1090](https://github.com/perly6185-lab/myagenttool/issues/1090))

## Context

myagenttool governs Agents and Applications but has no first-class messaging
Channel: no way to receive a command from an external conversation (the first
provider is a WeCom — Enterprise WeChat — custom application), route it through
governed capabilities, approve risky work in-conversation, and deliver an
audited result back to the same conversation.

A Channel is a genuinely new kind of boundary, and it forces four questions the
existing subsystems answered only for themselves:

1. **Exposure.** WeCom callbacks must be reachable from the public internet.
   Today the server is a single `http.createServer` control plane
   (`apps/server/src/index.mjs`) bound to `127.0.0.1` — and the initiative's
   non-goal is explicit: the control-plane API is never exposed publicly.
2. **Trust.** A channel message is attacker-controlled text, exactly like a
   mail body (ADR 0011): anyone who can message the WeCom app writes input that
   moves toward a system where agents act.
3. **Credentials.** WeCom requires `CorpSecret`, a callback `Token`, and an
   `EncodingAESKey`, plus short-lived access tokens derived from them. ADR 0010
   already ruled that external authorization is *readiness, not a capability*,
   and that secrets stay out of descriptors and control-plane records.
4. **Identity and approval.** A WeCom `UserID` is not a myagenttool actor, and
   a chat reply is not an approval — unless something makes both bindings
   explicit, single-use, and auditable.

The machinery to answer these mostly exists: `UNTRUSTED_INPUT_TAG`
(`@myagenttool/protocol/issue-prompt`), the `refuse()` chokepoint with its
closed taxonomy (`packages/protocol/src/refusal.ts`), single-use approval
grants (`apps/server/src/services/approval-grants.mjs`,
`docs/design/APPROVAL_GRANTS.md`), owner-team tenancy scoping, and the
`makeRunTx` unit-of-work seam. This ADR decides how a Channel composes them —
it introduces no new isolation layer.

## Decision

Six rules, each bound to an existing mechanism.

### 1. The gateway is a separate listener; the control plane stays private

The public callback surface is a dedicated HTTP listener (its own port, off
unless configured) that serves **only** the provider callback path. It verifies
signatures, decrypts, normalizes, and forwards events to the channel service
in-process; no `/api/*` control-plane route is reachable on it. A public
deployment exposes the gateway port and nothing else. This mirrors the plane
separation the bridge already implies (`/api/bridge/*` self-authenticates with
device credentials, not user sessions) but makes it a socket boundary, not a
path prefix.

### 2. A channel message is data, never instruction — the ADR 0011 rules apply verbatim

Every inbound message carries `UNTRUSTED_INPUT_TAG` from import through
invocation and result evidence. Command handling is a **deterministic parser**
over a closed command set (`/help`, `/status`, `/apps`, `/run`, `/result`,
`/approve`, `/cancel`) — no LLM reads raw channel text, the message body is
preserved verbatim as evidence, `detectPromptInjection` flags but never blocks,
and a run originating from a channel message is never eligible for
auto-approval. Free-form model-selected execution is out of scope for the first
release by the initiative's non-goal.

### 3. Identity is an explicit mapping that fails closed

A WeCom `UserID` (and chat context) becomes a myagenttool actor only through a
registered, owner-team-scoped identity mapping. An unmapped sender is refused
through `refuse()` using the existing closed taxonomy — no new refusal codes:
`action_not_permitted` (policy) for unmapped identities and cross-user actions,
`command_not_allowlisted` (policy) for capabilities outside the channel
allowlist, `undeliverable` (state) for terminal delivery failure. The
in-channel reply to a refused stranger is generic; capability names and
existence are never leaked to unmapped identities (the same opaqueness the
capability gateway's `capability_not_found` already practices).

### 4. Channel credentials live in the gateway; the control plane sees readiness booleans

`CorpSecret`, callback `Token`, `EncodingAESKey`, and cached access tokens are
gateway configuration (environment/credential store). They are never written to
`state`, events, refusals, API responses, or logs. The control-plane `Channel`
record reports **readiness** — which provider scopes are configured — as
booleans, exactly as ADR 0010 rules for external Applications. Access tokens
are a gateway in-memory cache, never persisted.

### 5. Approvals reuse single-use grants; a chat reply approves only via the grant chokepoint

A channel-originated write pauses under the normal invocation approval policy.
The in-channel `/approve` succeeds only when the mapped actor **is the original
requester**, and it flows through the approval-grants service: a single-use
grant bound to (action, invocation), consumed via `validateApprovalToken`, with
the channel message recorded as the decision source. The console Approvals
Center and the in-channel reply act on the **same** pending decision — there is
one approval system, not two.

### 6. Contracts are shared constants in `@myagenttool/protocol/channel`

`Channel`, `ChannelEvent`, `ChannelConversation`, `ChannelDelivery` shapes, the
provider id (`wecom`), command names, event/conversation/delivery statuses, and
readiness scope names are exported once from
`packages/protocol/src/channel.mjs` and imported by the server, the gateway,
and the console — the contract's name and the code's name cannot drift (the
same rule ADR 0011 set for the untrusted-input tag).

## Consequences

- S2–S8 of #1090 inherit settled answers: registry records are owner-team
  scoped control-plane state; the gateway is the only public surface; every
  denial goes through `refuse()`; every write approval through grants.
- Duplicate/replayed callbacks are a gateway + import concern (durable `MsgId`
  idempotency, timestamp window, nonce cache) and never reach dispatch — the
  import boundary is where exactly-once is enforced.
- Cost: a second listener to configure and deploy, and deterministic commands
  only in the first release. Accepted — a closed command set is the price of
  rule 2, and the listener split is the price of the non-goal.
- The closed refusal taxonomy is *not* extended. If operational experience
  shows channel-specific codes are needed (e.g. distinguishing unmapped
  identity from forbidden action), that is a deliberate protocol change with
  its own review, not a side effect of this epic.

## Alternatives considered

- **Mount the callback route on the control-plane server behind a path
  allowlist.** Rejected: one socket means one exposure decision; a reverse
  proxy misconfiguration or allowlist regression exposes the whole API. A
  separate listener makes "only the gateway is public" a property of the
  deployment, not of route-order code.
- **Store WeCom credentials on the Channel record (encrypted).** Rejected by
  ADR 0010's precedent: control-plane records travel (snapshots, exports,
  read-models, test fixtures); readiness booleans give the console everything
  it needs without the secret ever entering that surface.
- **Let `/approve` flip the invocation directly (mapped actor calls
  `approveInvocation`).** Rejected: it would bypass the grant record — no
  single-use token, no decision→grant→execution audit chain, and a second
  approval path to keep honest. The grant service exists precisely so every
  approval leaves the same evidence.
- **A general free-form agent conversation in the channel.** Deferred by the
  initiative's non-goal: the deterministic command set keeps the first release
  reviewable; free-form execution would put an LLM over raw untrusted text,
  which rule 2 forbids at this hop.
