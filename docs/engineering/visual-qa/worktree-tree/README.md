# Visual QA — Worktree Session file tree (#1200)

Evidence that expanding a directory in the Worktree Session tree loads and shows
its contents. Before #1200 it could not: the client never requested the level
below, so clicking a folder flipped a chevron and nothing else happened.

Regenerate in place:

```
pnpm --filter @myagenttool/web build
node tools/dev/worktree-tree-shot.mjs --out docs/engineering/visual-qa/worktree-tree
```

Nothing here is fabricated. The script builds a real git repo (`README.md`,
`apps/web/main.ts`, `docs/`), boots the server over it, creates a real worktree
through `POST /api/worktrees`, and drives headless Chromium against that live
server via the console's `?api=` override. The tree's data comes from
`GET /api/worktrees/:id/files`, so a fixture would proves nothing — the bug was
that the request for the next level was never made, and only a live request path
can show that it now is.

| Viewport | Collapsed | Expanded |
| --- | --- | --- |
| 1440×900 | `tree-collapsed-1440w.png` | `tree-expanded-1440w.png` |
| 390×900 | `tree-collapsed-390w.png` | `tree-expanded-390w.png` |

**Collapsed** — `apps`, `docs` sit closed at the root, `README.md` beside them.

**Expanded** — after clicking `apps`: it opens and `web` appears nested beneath
it, itself closed (one level loaded, not a recursive walk). `docs` stays closed
and unfetched — expanding one directory does not pull the rest.

The screenshots are the visible half. The load itself is asserted by the script,
which counts the `?path=` requests the page issues and fails if a click produces
none:

```
[tree-shot] 1440w: clicking "apps" fetched 1 directory listing(s) (apps) and revealed its children
[tree-shot] 390w: clicking "apps" fetched 1 directory listing(s) (apps) and revealed its children
```

Exactly one request per expand — the click fetches the level it opens, and no
more.
