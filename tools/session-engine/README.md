# @myagenttool/session-engine

Shared Playwright browser pipeline for **session-backed site plugins** — the
workspace packages under `tools/<site>-imports/` (zhihu, qichacha today) that
render login-walled / WAF-protected sites by reusing a logged-in persistent
browser profile.

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
| `<url>` | headless | `{"ok":true,"url":"<resolved>","html":"<rendered>"}` | 0 / 2 |

exit: `0` success · `1` usage error · `2` render/fetch/login failure.
Environment equivalents (`<SITE>_PROFILE_DIR`, `<SITE>_CHANNEL`, …) mirror the
flags, mirroring `tools/zhihu-imports/src/config.mjs`.

## Adding a new site (recipe)

1. Copy `tools/zhihu-imports/` to `tools/<site>-imports/` and edit
   `src/site.mjs` (loginUrl, healthUrl, authCookie, content selectors) plus
   `src/parse-url.mjs` (host rules). `cli.mjs`, the renderer, login, and probe
   are reusable — they delegate to this engine and read `site.mjs`.
2. Add one line to `SESSION_SITES` in
   `apps/server/src/services/session-manager.mjs`. `heartbeatTier:
   "logged_in"` joins the slow automated sweep; `"manual"` (qichacha's tier —
   logged-in views spend the site's daily quota) is probe-on-demand only and
   the sweep skips it entirely.
3. Add a render branch in `apps/server/src/services/article-imports.mjs`
   (mirror the zhihu/feishu branch) calling a `<site>-imports.mjs` adapter.
4. Write SHIM unit tests (mirror `apps/server/test/session-manager.test.mjs`).

No changes to `http-server.mjs` / `state-factory.mjs` / `index.mjs` are needed —
the registry plus the uniform CLI contract is the whole seam.
