# Skin System

This document specifies the desktop console's **skin** (theme) system: how a
user-selectable visual identity is defined, applied at runtime, and kept in sync
with the Electron native window chrome.

Scope for this iteration: **built-in preset skins** (curated by the project; no
user-authored tokens or importable skin packs), each shipping a **light + dark**
pair, with native window chrome following the active skin.

## Foundational premise: a skin is a set of token values

`apps/web/src/assets/main.css` already collapses every color decision into ~30
OKLCH design tokens (surface/foreground pairs) plus `--radius` and font tokens.
`@theme inline` binds those tokens to Tailwind color utilities, and STYLEGUIDE
forbids hardcoded hex in components.

Therefore **a skin is nothing more than one alternate set of values for those
existing tokens.** Component code, the `@theme inline` bindings, and the Tailwind
utilities never change per skin — only the raw token values do. This is the whole
system; everything below is mechanism around that one fact.

> Current state: the `.dark` class is defined in `main.css` but **nothing in the
> app toggles it** — the console is effectively locked to light. Building skins
> also introduces the runtime theme switch that is currently missing.

## Token contract

Every skin MUST provide a complete value for each token below, in **both** light
and dark. A missing token falls back to the default skin's variable, which
produces cross-skin color bleed — so completeness is enforced, not optional.

| Group | Tokens |
| --- | --- |
| Base surfaces | `background/foreground`, `card/*`, `popover/*` |
| State colors | `primary/*`, `secondary/*`, `muted/*`, `accent/*`, `destructive/*`, `success/*`, `warning/*` |
| Borders / focus | `border`, `input`, `ring` |
| Sidebar | `sidebar`, `sidebar-foreground/accent/accent-foreground/border/ring` |
| Geometry / type | `--radius` (optional per skin), `--font-sans` / `--font-mono` (optional) |

Hard constraints:

- **Contrast.** Each `surface / foreground` pair MUST meet WCAG AA — 4.5:1 for
  body text, 3:1 for large text and UI affordances. This carries the existing
  STYLEGUIDE rule that pairs "meet contrast together."
- **Light + dark required.** Every skin ships both modes. A single-mode skin is
  invalid, because native window chrome (below) needs a defined background for
  whichever mode is active.
- **No hardcoded hex in components.** Unchanged from STYLEGUIDE. Skins only add
  token *values*; they never touch component styles or Tailwind bindings.

## Carrier: two orthogonal dimensions

Skin identity and light/dark mode are independent axes, both expressed on the
`<html>` element:

- **Skin identity** → `data-skin` attribute (`<html data-skin="ocean">`).
- **Light / dark** → the existing `.dark` class (kept, along with the existing
  `@custom-variant dark`).

```css
:root                     { /* default skin · light */ }
:root.dark                { /* default skin · dark  */ }
[data-skin="ocean"]       { /* ocean skin   · light */ }
[data-skin="ocean"].dark  { /* ocean skin   · dark  */ }
```

The `@theme inline` block is **not** touched — it references variable names, and
the values are overridden by the selectors above. To keep `main.css` from
bloating, each skin lives in `apps/web/src/assets/skins/<id>.css` and is pulled
in via `@import`. The default skin's tokens stay in `main.css` as the base layer.

## Registry: single source of truth

```ts
// apps/web/src/lib/skins.ts — drives the picker UI and the SkinId union
export const SKINS = [
  { id: 'default', label: '靛蓝（默认）', swatch: ['oklch(0.54 0.16 262)', /* … */] },
  { id: 'ocean',   label: '海洋',        swatch: [/* … */] },
  { id: 'ink',     label: '石墨',        swatch: [/* … */] },
] as const

export type SkinId = (typeof SKINS)[number]['id']
```

`swatch` supplies the preview chips for the picker. Each registry `id` maps 1:1
to a `[data-skin="<id>"]` block in CSS. A unit test asserts that every registry
id has a matching CSS block and that no token is missing from either mode — this
prevents the registry and the stylesheet from drifting apart.

## State and application

State lives in the existing Zustand store (`apps/web/src/store/ui-store.ts`,
which already persists to `localStorage`):

```ts
{ skin: SkinId, mode: 'light' | 'dark' | 'system' }
```

An `applySkin()` effect runs on app boot and on every change:

1. `document.documentElement.dataset.skin = skin`
2. Resolve `mode` (for `'system'`, read `matchMedia('(prefers-color-scheme: dark)')`
   and subscribe to changes), then toggle the `.dark` class accordingly.
3. Set `document.documentElement.style.colorScheme` to `'light' | 'dark'` so
   native scrollbars and form controls follow the mode.

The picker is a shadcn-style control (topbar or a settings surface) that reads
`SKINS` and writes `skin` / `mode` into the store.

## Electron native sync

Each skin declares two **chrome** background colors — the resolved hex of its
`--background` for light and for dark. These drive the native shell so the
window frame never mismatches or flashes white.

- **Renderer → main IPC.** On skin/mode change, the renderer sends
  `{ bg, themeSource, resolved }`. The main process calls
  `win.setBackgroundColor(bg)`, sets `nativeTheme.themeSource`, and (Windows
  only) recolors the caption buttons via `setTitleBarOverlay`.
- **Persisted natively.** The main process writes the active chrome to
  `skin-settings.json` in `userData` — not only to `localStorage` — so the value
  is available before any web code runs. The payload is validated first
  (hex + enum whitelist) so a compromised renderer can't inject arbitrary values.
- **Startup, no white flash.** `BrowserWindow` is created with
  `backgroundColor` read from `skin-settings.json`. The window shell is already
  the correct base color before the SPA finishes loading, so both cold start and
  skin switches avoid a white flash and a mismatched native frame.
- **Windows caption buttons.** On Windows only, the window is created with
  `titleBarStyle: 'hidden'` + a skin-colored `titleBarOverlay`; the native title
  bar is replaced by a window-controls overlay whose strip and glyphs follow the
  skin. The web topbar becomes the drag surface (`.app-titlebar`) and reserves
  the button width (`.app-wco-spacer`, via `env(titlebar-area-*)`). All of that
  is inert on macOS/Linux, which keep their default frame.

## File map

| File | Change |
| --- | --- |
| `apps/web/src/assets/main.css` | Default skin tokens (base layer) + `@import` skins |
| `apps/web/src/assets/skins/<id>.css` | Per-skin token values (light + dark) |
| `apps/web/src/lib/skins.ts` | Registry, `SkinId` type, preview swatches |
| `apps/web/src/store/ui-store.ts` | `skin` / `mode` state + persist |
| `apps/web/src/app/App.tsx` (or providers) | `applySkin()` effect |
| Skin picker component | shadcn dropdown reading `SKINS`, placed in topbar/settings |
| `apps/electron/src/main.mjs` + preload | IPC handler, `settings.json`, startup `backgroundColor` |
| `apps/web/STYLEGUIDE.md` | New "Skins" section documenting the contract |

## Acceptance criteria for a built-in skin

A preset skin is complete when it:

1. Provides every contract token in **both** light and dark.
2. Passes WCAG AA on all surface/foreground pairs.
3. Is registered in `SKINS` with a label and preview swatches.
4. Declares its native chrome background for light and dark.
5. Passes the registry↔CSS drift test and the token-completeness test.

## Why this is safe

The system is purely additive against the current architecture: it does not
touch component code, the `@theme inline` bindings, or the Tailwind utilities. It
only adds token *values* and a thin switch-and-persist layer. Adding, removing,
or editing a skin cannot regress component styling — the blast radius is the
token values and the switch logic alone.
