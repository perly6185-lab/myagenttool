# Slack Channel — sandbox E2E runbook (#1128, SL3)

The adversarial, durability, isolation, and secret-leakage properties are
covered by automated tests (`apps/server/test/integration/slack-security.test.mjs`,
`test/slack-crypto.test.mjs`, `test/slack-gateway.test.mjs`,
`test/slack-client.test.mjs`, and the shared S2/S4/S5/S6/S7 suites). This
runbook is the one thing tests cannot self-provide: a live round-trip against a
real Slack workspace. Gated on user-supplied credentials — commit none.

## Prerequisites

A Slack app (api.slack.com/apps) with:

- **Event Subscriptions** enabled, subscribed to `message.im` (and/or
  `app_mention`), with the Request URL pointed at the gateway (below).
- A **Bot Token** (`xoxb-…`) with `chat:write` — this is `SLACK_BOT_TOKEN`.
- The **Signing Secret** (Basic Information → App Credentials) —
  `SLACK_SIGNING_SECRET`.
- A public HTTPS URL forwarding to the gateway port (ngrok / cloudflared).

None are stored in control-plane state (ADR 0010/0012 rule 4); they live only in
the gateway process env.

## Ports

- Control plane: `127.0.0.1:5001` (local only).
- Slack gateway: `SLACK_GATEWAY_PORT` (e.g. 5105); callback path `/slack/callback`;
  the tunnel forwards only to this port.

## Steps

1. **Phase A — register + enable + map (control plane; no credentials):**
   ```
   curl -XPOST $BASE/api/channels -d '{"provider":"slack","name":"slack-sandbox"}'
   # note channel.id (chn_xxxx) → SLACK_CHANNEL_ID
   curl -XPOST $BASE/api/approvals/grants -d '{"action":"channel.enable","targetId":"<chn>"}'
   curl -XPOST $BASE/api/channels/<chn>/enable -d '{"approvalToken":"<token>"}'
   curl -XPOST $BASE/api/channels/<chn>/identities -d '{"externalUserId":"<your Slack user id Uxxxx>","userId":"usr_local"}'
   ```
   Your Slack user id (`Uxxxx`): from your Slack profile → "Copy member ID", or
   read it as `externalUserId` from `/api/state` `channelEvents` after the first
   message (Phase C).

2. **Phase B — restart with credentials (from `apps/server`):**
   ```
   export SLACK_SIGNING_SECRET=... SLACK_BOT_TOKEN=xoxb-...
   export SLACK_GATEWAY_PORT=5105 SLACK_CHANNEL_ID=chn_xxxx
   node src/index.mjs
   ```
   Success log: `[slack-gateway] callback listener on 0.0.0.0:5105 → channel chn_xxxx`.
   Start the tunnel → Request URL = `https://xxxx/slack/callback`.

3. **Phase C — URL verification (AC #1).** Paste the Request URL into the app's
   Event Subscriptions page; Slack POSTs a `url_verification` challenge, the
   gateway verifies the signature and echoes `{challenge}` → "Verified".

4. **Phase D — `/status` round-trip (AC #3).** DM the bot (or @-mention it)
   `/status`; a governed read invocation runs and its result is DM'd back via
   `chat.postMessage`.

5. **Phase E — approval round-trip (AC #4/#5).** `/run <write-cap>` →
   in-conversation confirmation → `/approve <id>` → the run proceeds and its
   result returns.

6. **Phase F — evidence.** Capture the invocation ids and the shared
   `channel_event_imported` / `channel_event_dispatched` / `channel_delivery_recorded`
   events; attach to the SL3 PR / parent issue.

## Notes

- Slack is the simplest provider: HMAC signature over the raw body (no AES) and a
  STATIC bot token (no access_token exchange). Bot-authored messages are dropped
  at the gateway so the bot never loops on its own replies. Replies are DMs to
  the sender (chat.postMessage with `channel` = the sender's user id).

## Status

- Automated coverage: **complete and green** — url_verification, forged/expired
  signature, replay (event_id), exactly-once, bot-message skip, unmapped-sender
  refusal, injection-as-data, cross-team isolation, control-plane isolation,
  secret-leakage scan, restart durability.
- Live workspace round-trip: **blocked on user-supplied credentials** — run the
  steps above once a Slack app + public tunnel are available.
