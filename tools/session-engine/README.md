# @myagenttool/session-engine

Shared Playwright browser pipeline for **session-backed site plugins** — the
workspace packages under `tools/<site>-imports/` (zhihu, qichacha, xiaohongshu,
jianshu today) that render login-walled / WAF-protected sites by reusing a
logged-in persistent browser profile.

The product bundles no browser and the server never imports playwright; only
these tool packages do, via the hoisted root devDependency.

## Modules

- `src/launch.mjs` — `openContext({ headless, channel, profileDir })`,
  `launchOptions`, `contextOptions`. Persistent profile
  (`launchPersistentContext`) when `profileDir` is set — the only proven way
  past aggressive WAFs like zhihu's secng — ephemeral context otherwise.
  Includes the anti-bot baseline (`--disable-blink-features=AutomationControlled`,
  desktop UA, zh-CN locale, Asia/Shanghai timezone).
- `src/scroll.mjs` — `scrollToBottom(page, limits)`: stepped scrolling with a
  stable-height early exit, to trigger lazy hydration so the returned HTML
  carries every image attribute.

## The profile lock

`launchPersistentContext` takes an **exclusive lock** on the profile dir: two
concurrent runs against the same profile collide. The server-side
`session-manager.mjs` serializes per site with a `Map<site, Promise>` chain;
site CLIs are single-flight by nature (one process, one render).

## Site-plugin CLI contract

Every site plugin exposes the same three modes. Site specifics (login URL,
health URL, auth cookie, content selectors) live ONLY in
`tools/<site>-imports/src/site.mjs` — never in the server.

```
<site>-imports --login  [--profile <dir>] [--channel <name>] [--headed]
<site>-imports --probe  [--profile <dir>] [--channel <name>]
<site>-imports <url>     [--profile <dir>] [--channel <name>] [--headed]
```

| Mode | headless | stdout (success) | exit |
|---|---|---|---|
| `--login` | headed | (no JSON; stderr progress) | 0 / 2 |
| `--probe` | headless | `{"ok":true,"loggedIn":true,"detail":"z_c0 present"}` | 0 / 2 |
| `<url>` | headless | `{"ok":true,"url":"<resolved>","html":"<composed>","meta":{…}}` (see below) | 0 / 2 |

exit: `0` success · `1` usage error · `2` render/fetch/login failure.
Environment equivalents (`<SITE>_PROFILE_DIR`, `<SITE>_CHANNEL`, …) mirror the
flags, mirroring `tools/zhihu-imports/src/config.mjs`.

## The canonical render form: composed document + meta (jianshu onward)

Since `tools/jianshu-imports`, the canonical `<url>` render returns a
**composed** document — the plugin extracts the site's data structure in-page
(hydration JSON / state scripts) and returns a clean `<article>` document —
plus an optional `meta` object the server applies as authoritative field
overrides:

```json
{"ok":true,"url":"<resolved>","html":"<composed article>",
 "meta":{"title":"…","author":"…","publishedAt":"YYYY-MM-DD"}}
```

- Extraction lives ONLY plugin-side; the server parses the composed doc with
  generic selectors. The composed doc may reuse the site's own classes so the
  server's provider hints still hit — belt and braces, `meta` wins.
- Differentiated failures: a missing/empty payload exits 2 with a distinct
  message (deleted article / layout changed / empty body) — a plugin never
  returns a shell page for the server to silently archive (the xiaohongshu
  lesson, issue #1703).
- Older plugins are grandfathered: zhihu/qichacha return the rendered DOM and
  rely on server-side provider selectors; xiaohongshu's state-script parsing
  still lives server-side. Migrating those to the canonical form (plus a
  shared document-extractor package) is tracked in issue #1706.

## When a site becomes a plugin (promotion trigger)

The plugin boundary exists to keep playwright OUT of the server process — not
to make every site a plugin. A site earns a package the day it needs a
browser: a login wall, a WAF, or its body shipped in hydration JSON instead of
SSR DOM. Plain-HTML sites reachable by anonymous fetch (wechat, juejin, the
generic `web` fallback) stay in-process in article-imports.mjs.

## Adding a new site (recipe)

1. Copy `tools/jianshu-imports/` (the canonical template: composed document +
   meta + differentiated failures) to `tools/<site>-imports/` and edit
   `src/site.mjs` (loginUrl, healthUrl, login marker, content selector) plus
   `src/parse-url.mjs` (host rules). `cli.mjs`, the renderer, login, and probe
   are reusable — they delegate to this engine and read `site.mjs`.
2. Add one line to `SESSION_SITES` in
   `apps/server/src/services/session-manager.mjs`. `heartbeatTier:
   "logged_in"` joins the slow automated sweep; `"manual"` (qichacha's tier —
   logged-in views spend the site's daily quota) is probe-on-demand only and
   the sweep skips it entirely.
3. Add a render branch in `apps/server/src/services/article-imports.mjs`
   (mirror the jianshu adapter + `inspectJianshuArticle` branch).
4. Write SHIM unit tests (mirror `apps/server/test/jianshu-imports.test.mjs`).

No changes to `http-server.mjs` / `state-factory.mjs` / `index.mjs` are needed —
the registry plus the uniform CLI contract is the whole seam.
