# WeChat Official Account site capability

First-party, local browser-assisted plugin for a WeChat Official Account. The
current P0 slice supports a persistent login probe and a governed draft save.
It deliberately exposes no public-publish tool.

## Local setup

1. Start MyAgentTool and its Desktop Bridge.
2. Open **My settings → Website logins → 微信公众号 → Connect account**. The
   bundled MCP Agent and Application are registered automatically.
3. Scan the
   QR code in the visible browser.

The browser profile defaults to `~/.myagenttool-wechat_official-profile` and
is reused across restarts. Cookies remain inside that profile; the control
plane stores only login findings and operation receipts.

Chrome and Edge are detected automatically. An operator can still select one
explicitly with `--channel chrome` or `--channel msedge`.

## Safety boundary

- `wechat_official_probe` is read-only.
- `wechat_official_draft_sync` requires Application approval and saves a draft
  only; it never selects or clicks a public-publish action.
- If a save click has begun but no success marker is observed, the result is
  `unconfirmed`; callers must inspect the draft box before retrying.
- A changed or ambiguous page contract stops with `site_layout_changed`.
- P0 refuses packages containing cover/body image operations until those
  controls have been verified against a real account. It does not silently
  drop media.

## CLI

```text
wechat-official-site --login [--profile <dir>] [--channel auto|chrome|msedge]
wechat-official-site --probe [--profile <dir>] [--channel auto|chrome|msedge]
wechat-official-site --operation draft.sync [--profile <dir>] [--channel auto|chrome|msedge]
```

`draft.sync` reads one JSON request from stdin. The MCP server entry point is
`src/server.mjs`.

The task handoff uses a `.json` article package. Its `packageDigest` is the
SHA-256 of the canonical JSON fields `title`, `author`, `digest`, `contentHtml`,
`cover`, `bodyImages`, and `sourceUrl`; `createWechatArticlePackage` creates a
valid package and the executor rejects content changed after the digest was
calculated.

## Real-account P0 acceptance

Use a test account and a uniquely titled article. Do not use production
material for the first pass.

1. Connect once, scan the QR code, close MyAgentTool, reopen it, and run
   **Probe**. The status should remain logged in without another scan.
2. Send a Channel task that saves the prepared article to the Official Account
   draft box. Confirm that exactly one draft appears and no publish action is
   available.
3. Let the login expire (or sign out), repeat the task, sign in from the Channel
   shortcut, and reply **继续**. The same task should resume.
4. During a test save, interrupt the browser after submission to produce an
   uncertain result. Verify that blind retry is unavailable. Reply
   **已找到草稿** when the draft exists, or **确认未保存** only after confirming it
   does not; the latter should create one new save attempt.
5. Repeat once with Chrome and once with Edge where both are available. Also
   confirm that an occupied profile directory and a QR timeout produce ordinary
   recovery guidance.
