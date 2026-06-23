# Web Console — UI Architecture & Style Guide

This is the design-system and front-end-architecture doc for `apps/web`, the
MyAgentTool control-plane console. Token values live in
[`src/assets/main.css`](./src/assets/main.css) (canonical); this file documents
the **roles, rules, and structure** for using them.

## Stack

| Concern            | Choice                                                |
| ------------------ | ----------------------------------------------------- |
| Framework / build  | React 19 + Vite 6 + TypeScript                        |
| Styling            | Tailwind CSS v4 (`@tailwindcss/vite`) + design tokens |
| Component style    | shadcn-style primitives in `src/components/ui/`        |
| Server state       | TanStack Query (one polled `/api/state` query)         |
| UI state           | Zustand (`src/store/ui-store.ts`) — navigation + selection |
| Domain types       | `@myagenttool/protocol` (mirrored in `src/lib/console-state.ts`) |

The built SPA is served two ways: the `vite` dev server (HMR) and the Node
static server (`src/index.mjs`) over `dist/` for the M0 demo. Both call the
M0 server at `http://127.0.0.1:3001`.

## Layout — three-pane shell

```
Topbar (section title · device · connection)
NavRail │ main outlet (active screen) │ Inspector (selection context)
```

- **NavRail** (`components/layout/nav-rail.tsx`) — top-level control-plane
  domains from `app/sections.ts`. The active section is store-driven.
- **main outlet** — the active screen, resolved through `app/routes.tsx`
  (`SECTION_VIEWS`). Only the main column scrolls.
- **Inspector** (`components/layout/inspector.tsx`) — right-hand context panel
  whose content follows the active section + current selection.

Routing is store-driven, not URL-driven, for M0. Swapping in react-router later
should only touch `routes.tsx` and `nav-rail.tsx`.

## Code organization (feature-sliced)

```
src/
  app/          shell (App), routes, providers, sections
  components/
    ui/         shadcn-style primitives (button, card, badge, input)
    common/     composed display bits (field, fact-list, section-heading)
    layout/     nav-rail, topbar, inspector
  features/<domain>/   one folder per domain: dashboard, invocations, agents,
                       devices, discovery, integrations, audit
  data/         React Query hooks + action wrappers
  lib/          cn, api-client, console-state types, readable-labels
  store/        zustand UI store
```

Rules (carried from the Orca house style):

- **Name files after what they contain**, never `utils`/`helpers`/`common`
  blobs. Plain-language mappers live in `readable-labels.ts`, not `format.ts`.
- **Reuse protocol types.** Domain shapes mirror `@myagenttool/protocol`; do not
  reinvent agent/invocation/event field names.
- **State layering.** Server data goes through React Query; only navigation and
  selection live in Zustand. Never duplicate `/api/state` into the store.

## Color roles

Tokens come in **surface / foreground pairs** that meet contrast together. The
identity is quiet and neutral; color is reserved for state. Never hardcode a hex
value when a token covers the role — add to `main.css` (`:root` **and** `.dark`),
expose it in `@theme inline`, then use the Tailwind binding.

| Token                         | Use it for                                            |
| ----------------------------- | ----------------------------------------------------- |
| `background` / `foreground`   | App canvas, default text                              |
| `card` / `card-foreground`    | Panels lifted off the canvas                          |
| `primary`                     | The single affirmative action in a flow               |
| `secondary`                   | Lower-emphasis actions next to a primary              |
| `muted` / `muted-foreground`  | De-emphasized text, captions, disabled chrome         |
| `accent`                      | Hover/active backgrounds for ghost rows and list items |
| `destructive`                 | Delete / deny / error states (not Cancel)             |
| `border` / `input` / `ring`   | Hairlines / field backgrounds / focus + selection halos |
| `sidebar*`                    | The NavRail and its children only                      |

### State tones

The `StatusBadge` / `Badge` `tone` prop is the one place state color is encoded:
`neutral`, `running` (primary), `success`, `warning`, `danger` (destructive).
Map protocol enums to a tone via `statusTone` / `healthTone` in
`readable-labels.ts` — components never branch on raw enum → color.

## Resolution order

When this guide is silent: reach for **muted/accent/border before color**, a
**CSS token before a hex value**, and the **nearest shadcn primitive before
custom CSS**.
