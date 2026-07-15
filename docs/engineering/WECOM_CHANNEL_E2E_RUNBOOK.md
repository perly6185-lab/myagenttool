# WeCom Channel — sandbox-enterprise E2E runbook (#1090, S8)

The adversarial, durability, isolation, and secret-leakage properties are
covered by automated tests (`apps/server/test/integration/channel-security.test.mjs`,
`test/wecom-crypto.test.mjs`, `test/wecom-gateway.test.mjs`, and the S2–S7
unit suites). This runbook is the **one thing tests cannot self-provide**: a
live round-trip against a real WeCom (Enterprise WeChat) sandbox enterprise. It
is gated on user-supplied sandbox credentials — do not commit any of them.

## Prerequisites

A WeCom sandbox enterprise with a self-built application, from which you obtain:

- `WECOM_CORP_ID` — the enterprise CorpID.
- `WECOM_CORP_SECRET` — the application's Secret (send credential).
- `WECOM_AGENT_ID` — the application's AgentId.
- `WECOM_CALLBACK_TOKEN` and `WECOM_ENCODING_AES_KEY` — the receive-message
  API's Token and EncodingAESKey (43 chars).
- A public HTTPS URL that forwards to the gateway port (e.g. an ngrok tunnel).

None of these are stored in control-plane state (ADR 0012 rule 4); they live
only in the gateway process's environment.

## Steps

1. **Register + enable a channel** (control plane):
   ```
   curl -XPOST $BASE/api/channels -d '{"provider":"wecom","name":"sandbox"}'
   # then mint a grant and enable:
   curl -XPOST $BASE/api/approvals/grants -d '{"action":"channel.enable","targetId":"<chn>"}'
   curl -XPOST $BASE/api/channels/<chn>/enable -d '{"approvalToken":"<token>"}'
   ```
   Note the channel id — it is `WECOM_CHANNEL_ID` for the gateway.

2. **Map your WeCom UserID** to a myagenttool user:
   ```
   curl -XPOST $BASE/api/channels/<chn>/identities -d '{"externalUserId":"<WeComUserID>","userId":"usr_local"}'
   ```

3. **Allowlist a read capability** and set `/status` (approval-gated):
   ```
   curl -XPOST $BASE/api/approvals/grants -d '{"action":"channel.allowlist","targetId":"<chn>"}'
   curl -XPOST $BASE/api/channels/<chn>/allowlist -d '{"capabilities":["<cap>"],"statusCapability":"<cap>","approvalToken":"<token>"}'
   ```

4. **Start the gateway** with the env above plus `WECOM_GATEWAY_PORT` and
   `WECOM_CHANNEL_ID`, expose the port over HTTPS, and set that URL + Token +
   AESKey as the application's receive-callback config in the WeCom admin.

5. **URL verification** — the WeCom console's "save" issues the GET verification
   request. Expect it to succeed (the gateway decrypts `echostr` and echoes it).
   Acceptance: parent AC #1.

6. **`/status` round-trip** — send `/status` from the mapped WeCom user in the
   app conversation. Expect a governed read invocation to run and its result to
   arrive back in the same conversation. Acceptance: parent AC #4, #8.

7. **Approval round-trip** — send `/run <write-cap>`; expect an in-channel
   confirmation; reply `/approve <id>`; expect the run to proceed and its result
   to return. Acceptance: parent AC #7.

8. **Record evidence** — capture the invocation ids, the `channel_event_imported`
   / `channel_event_dispatched` / `channel_delivery_recorded` events, and the
   conversation transcript. Attach to the S8 PR / parent issue.

## Status

- Automated coverage: **complete and green** (adversarial, replay, cross-team,
  injection-as-data, control-plane isolation, secret-leakage scan, restart
  durability).
- Live sandbox round-trip: **blocked on user-supplied sandbox credentials** —
  run the steps above once a sandbox enterprise + public tunnel are available,
  then check off parent acceptance items #1/#4/#7/#8's live confirmation.
