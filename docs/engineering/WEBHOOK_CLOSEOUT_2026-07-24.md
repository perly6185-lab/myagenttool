# GitHub Webhook closeout — 2026-07-24

- Repository Hook: `656379331`
- Events: `issues`, `issue_comment`, `milestone`
- Content type: JSON
- Secret storage: macOS Keychain service `myagenttool-github-webhook`
- Local target: `/api/webhooks/github/work-items`
- Relay: a dedicated Smee channel (the repository contains no secret)

The initial unsigned/incorrectly-secreted ping was rejected with HTTP 401. After
rotating the Hook to the Keychain-backed secret, two real `issues` deliveries were
triggered by adding and removing the existing `documentation` label on issue
`#1495`. Both reached the local endpoint with HTTP 202. GitHub recorded both
deliveries as successful.

The work item sync classified both events as conflicts rather than overwriting the
newer local record. That is the expected fail-safe outcome and proves the full
GitHub → signed Hook → relay → local HMAC verification → team-scoped ingestion →
conflict classification path.
