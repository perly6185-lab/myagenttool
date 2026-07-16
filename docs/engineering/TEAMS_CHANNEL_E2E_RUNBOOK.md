# Microsoft Teams Channel — sandbox E2E runbook (#1135, T3)

The adversarial, durability, isolation, and secret-leakage properties are
covered by automated tests (`apps/server/test/integration/teams-security.test.mjs`,
`test/teams-crypto.test.mjs`, `test/teams-gateway.test.mjs`,
`test/teams-client.test.mjs`, and the shared S2/S4/S5/S6/S7 suites). This
runbook is the one thing tests cannot self-provide: a live round-trip against a
real Teams tenant. Gated on user-supplied credentials — commit none.

## Prerequisites

An Azure Bot (portal.azure.com → Azure Bot) with a Microsoft Teams channel
enabled, from which you obtain:

- `TEAMS_APP_ID` — the bot's Microsoft App ID (client id / audience).
- `TEAMS_APP_PASSWORD` — a client secret for that app registration.
- A public HTTPS URL forwarding to the gateway port (ngrok / cloudflared), set as
  the bot's **Messaging endpoint** (`https://xxxx/teams/callback`).
- The bot added to a team/chat so it can receive messages.

None are stored in control-plane state (ADR 0010/0012 rule 4); the app password
lives only in the gateway process env, and inbound validation is public-key only
(the Bot Framework JWKS — fetched, not a secret).

## Ports

- Control plane: `127.0.0.1:5001` (local only).
- Teams gateway: `TEAMS_GATEWAY_PORT` (e.g. 5106); callback path `/teams/callback`;
  the tunnel forwards only to this port.

## Steps

1. **Phase A — register + enable + map (control plane; no credentials):**
   ```
   curl -XPOST $BASE/api/channels -d '{"provider":"teams","name":"teams-sandbox"}'
   # note channel.id (chn_xxxx) → TEAMS_CHANNEL_ID
   curl -XPOST $BASE/api/approvals/grants -d '{"action":"channel.enable","targetId":"<chn>"}'
   curl -XPOST $BASE/api/channels/<chn>/enable -d '{"approvalToken":"<token>"}'
   curl -XPOST $BASE/api/channels/<chn>/identities -d '{"externalUserId":"<your Teams user id, e.g. 29:xxxx>","userId":"usr_local"}'
   ```
   Your Teams user id (`from.id`, like `29:1a2b…`) is easiest to read from
   `/api/state` `channelEvents` after the first message (Phase C).

2. **Phase B — restart with credentials (from `apps/server`):**
   ```
   export TEAMS_APP_ID=... TEAMS_APP_PASSWORD=...
   export TEAMS_GATEWAY_PORT=5106 TEAMS_CHANNEL_ID=chn_xxxx
   node src/index.mjs
   ```
   Success log: `[teams-gateway] callback listener on 0.0.0.0:5106 → channel chn_xxxx`.
   Start the tunnel and set the bot's Messaging endpoint to `https://xxxx/teams/callback`.

3. **Phase C — message the bot (AC #1/#3).** DM or @-mention the bot with
   `/status` in Teams. The gateway validates the Bot Framework JWT (RS256 vs the
   fetched JWKS), imports the Activity, and DMs the result back via
   `{serviceUrl}/v3/conversations/…/activities`.

4. **Phase D — approval round-trip (AC #4/#5).** `/run <write-cap>` →
   in-conversation confirmation → `/approve <id>` → the run proceeds and its
   result returns.

5. **Phase E — evidence.** Capture the invocation ids and the shared
   `channel_event_imported` / `channel_event_dispatched` / `channel_delivery_recorded`
   events; attach to the T3 PR / parent issue.

## Notes

- Teams is the heaviest provider: inbound is a Bot Framework JWT (RS256, validated
  against the fetched JWKS — no secret on the inbound path), and the reply address
  is the conversation's `serviceUrl` + `conversationId` (the `replyContext` seam),
  not the sender id. Outbound authenticates with an Azure AD client-credentials
  token derived from the app id + password.

## Status

- Automated coverage: **complete and green** — JWT validation (valid/forged/
  expired/wrong-audience), replay (activity id), exactly-once, unmapped-sender
  refusal, injection-as-data, cross-team isolation, control-plane isolation,
  secret-leakage scan, restart durability (incl. replyContext).
- Live tenant round-trip: **blocked on user-supplied credentials** — run the
  steps above once an Azure Bot + Teams channel + public tunnel are available.
