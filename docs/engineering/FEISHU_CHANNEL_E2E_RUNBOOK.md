# Feishu (Lark) Channel — sandbox E2E runbook (#1110, F4)

The adversarial, durability, isolation, and secret-leakage properties are
covered by automated tests (`apps/server/test/integration/feishu-security.test.mjs`,
`test/feishu-crypto.test.mjs`, `test/feishu-gateway.test.mjs`,
`test/feishu-client.test.mjs`, and the shared S2/S4/S5/S6/S7 suites). This
runbook is the one thing tests cannot self-provide: a live round-trip against a
real Feishu/Lark tenant. Gated on user-supplied credentials — commit none.

## Prerequisites

A Feishu/Lark **custom app** (自建应用) with the "receive messages" event
subscribed (`im.message.receive_v1`) and the `im:message:send_as_bot` (or
`im:message`) permission, from which you obtain:

- `FEISHU_APP_ID` — the app's App ID (`cli_...`).
- `FEISHU_APP_SECRET` — the app's App Secret (send credential).
- `FEISHU_VERIFICATION_TOKEN` — the event-subscription Verification Token.
- `FEISHU_ENCRYPT_KEY` — the event-subscription Encrypt Key (required; the
  gateway rejects unencrypted callbacks).
- A public HTTPS URL that forwards to the gateway port (ngrok / cloudflared).
- For Lark (international): set `FEISHU_BASE_URL=https://open.larksuite.com`.

None are stored in control-plane state (ADR 0010/0012 rule 4); they live only in
the gateway process env.

## Ports

- Control plane: `127.0.0.1:5001` (local only, never public).
- Feishu gateway: `FEISHU_GATEWAY_PORT` (e.g. 5103); callback path is
  `/feishu/callback`; the tunnel forwards only to this port.

## Steps

1. **Phase A — register + enable + map (control plane; no credentials):**
   ```
   curl -XPOST $BASE/api/channels -d '{"provider":"feishu","name":"lark-sandbox"}'
   # note channel.id (chn_xxxx) → FEISHU_CHANNEL_ID
   curl -XPOST $BASE/api/approvals/grants -d '{"action":"channel.enable","targetId":"<chn>"}'
   curl -XPOST $BASE/api/channels/<chn>/enable -d '{"approvalToken":"<token>"}'
   curl -XPOST $BASE/api/channels/<chn>/identities -d '{"externalUserId":"<your open_id>","userId":"usr_local"}'
   ```
   Your Feishu `open_id`: the foolproof way is Phase C's first message — the
   gateway imports it (recording `open_id` as `externalUserId`) before the
   identity check, so read it from `/api/state` `channelEvents` and map exactly.

2. **Phase B — restart with credentials (from `apps/server`):**
   ```
   export FEISHU_APP_ID=... FEISHU_APP_SECRET=... FEISHU_VERIFICATION_TOKEN=... FEISHU_ENCRYPT_KEY=...
   export FEISHU_GATEWAY_PORT=5103 FEISHU_CHANNEL_ID=chn_xxxx
   # Lark international: export FEISHU_BASE_URL=https://open.larksuite.com
   node src/index.mjs
   ```
   Success log: `[feishu-gateway] callback listener on 0.0.0.0:5103 → channel chn_xxxx`.
   Start the tunnel → callback URL = `https://xxxx/feishu/callback`.

3. **Phase C — URL verification (AC #1).** In the Feishu app's event-subscription
   config, set the request URL + Verification Token + Encrypt Key, and save.
   Feishu POSTs an encrypted `url_verification` challenge; the gateway verifies
   the signature, decrypts, checks the token, and echoes `{challenge}` → save
   succeeds.

4. **Phase D — `/status` round-trip (AC #3/#6).** Send `/status` from the mapped
   user in the app chat; a governed read invocation runs and its result returns
   to the same chat (asynchronously via `im/v1/messages`).

5. **Phase E — approval round-trip (AC #5).** Send `/run <write-cap>`; expect an
   in-chat confirmation; reply `/approve <id>`; the run proceeds and its result
   returns.

6. **Phase F — evidence.** Capture the invocation ids and the shared
   `channel_event_imported` / `channel_event_dispatched` / `channel_delivery_recorded`
   events; attach to the F4 PR / parent issue.

## Status

- Automated coverage: **complete and green** — url_verification handshake,
  forged/tampered/wrong-token/stale/replay rejection, exactly-once (event_id),
  unmapped-sender refusal, injection-as-data, cross-team isolation, control-plane
  isolation, secret-leakage scan, restart durability.
- Live tenant round-trip: **blocked on user-supplied credentials** — run the
  steps above once a Feishu/Lark app + public tunnel are available.
