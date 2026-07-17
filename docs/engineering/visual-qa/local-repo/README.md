# Visual QA — the local repo in Projects (#1213)

Evidence that a project with nowhere to publish says so, and that one click gives
it a local repo — no account, no service.

Regenerate in place:

```
pnpm --filter @myagenttool/web build
node tools/dev/local-repo-ui-shot.mjs --out docs/engineering/visual-qa/local-repo
```

Nothing is fabricated. The script seeds a real git repo with **no remote**, boots
the server over it, and drives headless Chromium against that live server via the
console's `?api=` override. The click is a real click and the POST is a real POST
— the claim is that a user who never makes an API call can go from "nowhere to
publish" to a working origin, so a fixture would prove nothing.

| Viewport | No origin | After one click |
| --- | --- | --- |
| 1440×900 | `no-origin-1440w.png` | `local-repo-1440w.png` |
| 390×900 | `no-origin-390w.png` | `local-repo-390w.png` |

**No origin** — the row reads `No origin · nowhere to publish yet` in amber, with
a **Create local repo** button beside it. Today that fact only surfaces when a
publish fails, as "Add a remote first" — too late, and it reads as "go get a
GitHub account".

**After one click** — the same row reads `Local repo · publishes on this device`,
with no reload and no tree browse.

The screenshots are the visible half. The script also counts the POSTs each click
issues and fails if a click produces none:

```
[local-repo-shot] 1440w: clicked once -> 1 POST /local-origin -> row reads "Local repo" with no reload
[local-repo-shot] 390w: clicked once -> 1 POST /local-origin -> row reads "Local repo" with no reload
```

A fresh repo and server are seeded per viewport on purpose: `project.git` is a
cache that only re-reads on a tree browse, so removing the remote between passes
would leave the second one reading the first pass's "Local repo".
