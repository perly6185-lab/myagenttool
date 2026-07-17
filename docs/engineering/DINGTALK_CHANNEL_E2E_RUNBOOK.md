# DingTalk (钉钉) Channel — sandbox E2E runbook (#1119, D3)

The adversarial, durability, isolation, and secret-leakage properties are
covered by automated tests (`apps/server/test/integration/dingtalk-security.test.mjs`,
`test/dingtalk-crypto.test.mjs`, `test/dingtalk-gateway.test.mjs`,
`test/dingtalk-client.test.mjs`, and the shared S2/S4/S5/S6/S7 suites). This
runbook is the one thing tests cannot self-provide: a live round-trip against a
real DingTalk org. Gated on user-supplied credentials — commit none.

## Prerequisites

A DingTalk **enterprise internal robot** (企业内部机器人) with "message receive"
(消息接收) configured, from which you obtain:

- `DINGTALK_APP_KEY` — the app's AppKey.
- `DINGTALK_APP_SECRET` — the app's AppSecret (used BOTH to verify the inbound
  HMAC signature AND to fetch the outbound access_token).
- `DINGTALK_ROBOT_CODE` — the robot's `robotCode` (send identity).
- A public HTTPS URL that forwards to the gateway port (ngrok / cloudflared).
- For a non-default cloud, set `DINGTALK_BASE_URL`.

None are stored in control-plane state (ADR 0010/0012 rule 4); they live only in
the gateway process env.

## Ports

- Control plane: `127.0.0.1:5001` (local only).
- DingTalk gateway: `DINGTALK_GATEWAY_PORT` (e.g. 5104); callback path is
  `/dingtalk/callback`; the tunnel forwards only to this port.

## Steps

1. **Phase A — register + enable + map (control plane; no credentials):**
   ```
   curl -XPOST $BASE/api/channels -d '{"provider":"dingtalk","name":"dt-sandbox"}'
   # note channel.id (chn_xxxx) → DINGTALK_CHANNEL_ID
   curl -XPOST $BASE/api/approvals/grants -d '{"action":"channel.enable","targetId":"<chn>"}'
   curl -XPOST $BASE/api/channels/<chn>/enable -d '{"approvalToken":"<token>"}'
   curl -XPOST $BASE/api/channels/<chn>/identities -d '{"externalUserId":"<your DingTalk userid>","userId":"usr_local"}'
   ```
   Your DingTalk userid = `senderStaffId` in the callback. Foolproof way: send
   any message first (Phase C), then read `externalUserId` from `/api/state`
   `channelEvents` and map exactly.

2. **Phase B — restart with credentials (from `apps/server`):**
   ```
   export DINGTALK_APP_KEY=... DINGTALK_APP_SECRET=... DINGTALK_ROBOT_CODE=...
   export DINGTALK_GATEWAY_PORT=5104 DINGTALK_CHANNEL_ID=chn_xxxx
   node src/index.mjs
   ```
   Success log: `[dingtalk-gateway] callback listener on 0.0.0.0:5104 → channel chn_xxxx`.
   Start the tunnel → message-receive URL = `https://xxxx/dingtalk/callback`.

3. **Phase C — configure the robot callback (AC #1).** In the DingTalk developer
   console, set the robot's message-receive URL to the tunnel URL and save.
   DingTalk signs each callback `sign = base64(HmacSHA256(appSecret,
   timestamp+"\n"+appSecret))`; the gateway verifies it + the timestamp window.

4. **Phase D — `/status` round-trip (AC #3/#6).** @-mention the bot with
   `/status` in a group (or send in 1:1); a governed read invocation runs and its
   result returns via the robot send API.

5. **Phase E — approval round-trip (AC #5).** `/run <write-cap>` → in-conversation
   confirmation → `/approve <id>` → the run proceeds and its result returns.

6. **Phase F — evidence.** Capture the invocation ids and the shared
   `channel_event_imported` / `channel_event_dispatched` / `channel_delivery_recorded`
   events; attach to the D3 PR / parent issue.

## Notes

- DingTalk's inbound signature covers `timestamp + appSecret`, not the request
  body — the gateway therefore composes the freshness window + a
  `(timestamp, sign)` replay cache + `msgId` idempotency at import to bound the
  residual exposure; minting any valid sign still requires the appSecret.

## Status

- Automated coverage: **complete and green** — forged/expired signature, replay,
  exactly-once (msgId), unmapped-sender refusal, injection-as-data, cross-team
  isolation, control-plane isolation, secret-leakage scan, restart durability.
- Live org round-trip: **blocked on user-supplied credentials** — run the steps
  above once a DingTalk internal robot + public tunnel are available.
