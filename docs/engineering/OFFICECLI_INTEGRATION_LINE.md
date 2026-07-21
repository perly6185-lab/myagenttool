# OfficeCLI Integration Line

**Status:** complete · 20 PRs merged to `main` (browse + governed writes through `3a96e35`;
in-app markdown editing — L1 — through `c903862`).

OfficeCLI ([`@officecli/officecli`](https://github.com/iOfficeAI/OfficeCLI), a .NET CLI
that reads/edits `.docx` / `.xlsx` / `.pptx`) is integrated as a first-class,
**governed local capability**: a way to **browse and edit** Office documents inside
the console where every write is approval-gated, worktree-isolated, and reviewable
before it touches the base branch.

This document archives what was built, how it is governed, and what was
deliberately left out. It is a record, not a spec — the source of truth is the code
and the linked PRs.

---

## The human loop

Everything composes into one governed round-trip. No step trusts the previous one:
a write lands in an isolated worktree and only reaches the base after an explicit
review.

```
Browse ──▶ Edit ──▶ Compare ──▶ Review ──▶ Promote
(render)   (set →   (before vs   (approval   (merge worktree
           worktree) after)      verdict)    → base)
```

1. **Browse** — click a document in the file tree → it renders inline, not as raw OOXML bytes.
2. **Edit** — the docx markdown editor (block or whole-document mode; see *In-app markdown
   editing* below), or a path + value form → one governed `batch`/`set` into the worktree.
3. **Compare** — rendered *before* (base) vs *after* (worktree), side by side.
4. **Review** — an explicit approval verdict on the worktree change.
5. **Promote** — merge the approved worktree into the base branch.

---

## Capabilities

13 governed verbs, projected as fixed-args bin-wrapper capabilities. Every argv
token is validated on **two independent allowlists** (server spec + device gate).

| Class | Verbs | Policy |
| --- | --- | --- |
| **Read** | `get` `query` `view` `validate` `dump` | `read_only`, no approval, offline, Office-extension + path-confined |
| **Write** | `set` `add` `remove` `move` `swap` `batch` `import` `merge` | `workspace_write`, **approval-gated**, **worktree-only**, verb + arg allowlisted |

Writes edit the real OOXML **surgically** — a precise change that preserves
everything else, so the worktree diff stays minimal and the review stays meaningful.

---

## Ledger — 15 pull requests

Read foundation first, then the write path one verb at a time, with security fixes
folded in as an adversarial audit surfaced them.

| Phase | PR | Commit | What shipped |
| --- | --- | --- | --- |
| Browse | [#1348](https://github.com/perly6185-lab/myagenttool/pull/1348) | `c350a6b` | Read-only Application + workspace preview (get/query/view/validate/dump; HTML render route). |
| Write · P3.1 | [#1358](https://github.com/perly6185-lab/myagenttool/pull/1358) | `d4c488d` | `officecliApply` policy kind + `remove` — the write-policy bucket, separate from the read-only wrapper bucket. |
| Write · P3.2 | [#1362](https://github.com/perly6185-lab/myagenttool/pull/1362) | `840783d` | `set` + `add` — repeatable `--prop key=value` arg modeling + positionals-first order. |
| Write · P3.3 | [#1366](https://github.com/perly6185-lab/myagenttool/pull/1366) | `dee65e5` | `batch` — `--commands` JSON list, each item's verb allowlisted and bounded. |
| Write · P3.4 | [#1368](https://github.com/perly6185-lab/myagenttool/pull/1368) | `841b798` | `move` + `swap` — structural verbs; no new arg modeling. |
| **Security** | [#1370](https://github.com/perly6185-lab/myagenttool/pull/1370) | `9123426` | File positional → worktree. Confirmed traversal fixed with safe-relative-path types. |
| Write · P3.5 | [#1373](https://github.com/perly6185-lab/myagenttool/pull/1373) | `3b7dc8d` | `import` (CSV/TSV → sheet) — worktree-safe `csv_file` source + valueless boolean flags. |
| Write · P3.6 | [#1375](https://github.com/perly6185-lab/myagenttool/pull/1375) | `05d481b` | `merge` — template `{{key}}` + inline JSON `--data`. |
| Review UX | [#1378](https://github.com/perly6185-lab/myagenttool/pull/1378) | `3a0e1e5` | Rendered before/after visual diff in the worktree review. |
| **Security** | [#1380](https://github.com/perly6185-lab/myagenttool/pull/1380) | `5dcee40` | Wrapper runner → absolute path. Platform fix: `invocation_root` apps (git, officecli) failed to launch live. |
| **Security** | [#1383](https://github.com/perly6185-lab/myagenttool/pull/1383) | `b4ffe20` | Media-source props → worktree + forced write approval. Confirmed exfiltration fixed; approval made an invariant. |
| Browse fix | [#1386](https://github.com/perly6185-lab/myagenttool/pull/1386) | `59f8812` | Render Office files in the file browser instead of dumping raw bytes. |
| Human write | [#1390](https://github.com/perly6185-lab/myagenttool/pull/1390) | `6c8ce90` | Governed write from the capability panel, scoped to a worktree (server resolves `worktreeId`). |
| Human write | [#1392](https://github.com/perly6185-lab/myagenttool/pull/1392) | `7d81991` | Inline edit on the preview — mint grant → worktree-scoped `set` → re-render. |
| Human write | [#1395](https://github.com/perly6185-lab/myagenttool/pull/1395) | `3a96e35` | Paragraph-level docx editor — full-document editing feel, surgical per-paragraph writes. |

---

## Architecture

Key mechanisms (files under `apps/server/src/services/officecli-application.mjs`,
`apps/server/src/services/officecli-preview.mjs`, `apps/desktop/src/local-execution-policy.mjs`,
`apps/server/src/services/capabilities.mjs`):

- **Two independent allowlists.** A server spec and a device gate validate *every*
  argv token separately. A buggy or compromised server still cannot make the device
  run something new — the device re-checks bases, flags, and each positional.
- **`officecliApply` policy kind.** Writes get their own device policy bucket
  (`workspace_write`), classified *before* the generic read-only `wrapper` kind — so
  a read surface can never widen to writes.
- **Worktree-only writes.** A write is refused unless it runs inside the invocation's
  worktree — never the project clone. Enforced at the device gate on the actual
  `--cwd`.
- **Shared arg model, extended (opt-in).** The wrapper arg model gained `office_file`
  / `csv_file` (traversal-safe paths), `props`, `json_commands`, `json_data`,
  positionals-first, and valueless flags — all default-off, so git/ccusage stay
  byte-identical.
- **Read-preview track.** Rendering is a read-only server-side shell-out (the same
  convenience track as the git status badges), bypassing the 20 000-char
  wrapper-result cap without touching the governed write path.
- **Surgical, not regenerated.** Every edit is a precise operation on the real OOXML.
  The docx paragraph editor changes only the edited paragraph.

---

## Security ledger

An adversarial audit of the governed write surface found three issues; two were
confirmed exploitable and all are fixed.

1. **File-path traversal — confirmed, fixed ([#1370](https://github.com/perly6185-lab/myagenttool/pull/1370)).**
   The `file` positional was validated for extension, not traversal — so a write
   could escape the worktree.
   `set ../outside.xlsx …` **wrote outside the worktree.**
   Fixed with worktree-safe `office_file` / `csv_file` path types on both allowlists.

2. **Media-source prop traversal + approval gap — confirmed, fixed ([#1383](https://github.com/perly6185-lab/myagenttool/pull/1383)).**
   officecli opens `src` / `path` / `preview` props as *file sources* — unvalidated,
   they read an arbitrary host file into a document.
   `add --type picture --prop src=../secret.png` **embedded a host file.**
   Write approval was also descriptor-controlled, not enforced. Fixed: media sources
   confined to a worktree file or a `data:` URI; approval forced at registration;
   the worktree guard corrected to the real cwd.

3. **Platform: wrapper runner relative path — found by live E2E, fixed ([#1380](https://github.com/perly6185-lab/myagenttool/pull/1380)).**
   The runner's relative script path broke every `invocation_root` wrapper app
   (git *and* officecli) in real execution — the runner launched with the project
   cwd and could not find itself. Latent until the first live end-to-end run. Fixed
   to an absolute path.

---

## In-app markdown editing (L1)

The "markdown-syntax editing done right" that the first pass deferred — built as
**surgical in-app editing, never a lossy round-trip**. The docx stays the source of
truth and is *never regenerated*; a human edits markdown and every change maps to
**one governed `apply.batch`** of precise ops keyed on each paragraph's native OOXML
paraId. Content the projection can't express (tables, images, non-heading styles) is
preserved by never being touched.

| Slice | PR | Commit | What shipped |
| --- | --- | --- | --- |
| L1 · mapper | [#1403](https://github.com/perly6185-lab/myagenttool/pull/1403) | `0fd5498` | Pure-logic core: paragraph↔markdown projection, diff→batch (set/remove/move/add), the ordering algorithm (LIS-minimal moves + reverse-insert of consecutive new blocks). |
| L1 · editor | [#1405](https://github.com/perly6185-lab/myagenttool/pull/1405) | `485d5a6` | `DocxBlockEditor` + the compute route; edit text/headings + add/delete/reorder blocks. |
| L1.5 · inline | [#1407](https://github.com/perly6185-lab/myagenttool/pull/1407) | `94ad0c7` | Inline **bold**/*italic*: runs project to `**`/`*` markdown; a formatted edit rebuilds that paragraph's runs (reverse-remove + append). |
| L1b · whole-doc | [#1411](https://github.com/perly6185-lab/myagenttool/pull/1411) | `c903862` | A Markdown mode: edit the whole document as one textarea. The server re-aligns edited blocks to their original paraIds (exact pass + Dice-similarity pass), then reuses the same mapper. |

**Two editing surfaces, one backend.** *Blocks* mode keeps each paraId in memory
(exact, zero alignment risk) and is the default. *Markdown* mode edits the whole doc
as flowing markdown and re-aligns by content on save — an opt-in convenience whose
worst case is a suboptimal (still governed, still reviewed) diff, never silent
corruption. Both produce one `apply.batch`. Scope: text, headings, structure, inline
bold/italic; links are excluded (officecli has no hyperlink verb) and a brand-new
paragraph is created plain (its paraId isn't known mid-batch).

## Out of scope — deliberate

- **Markdown round-trip editing — declined.** `docx → md → docx` regenerates the
  whole file, loses formatting, makes the diff the entire document, and only works
  for docx. The block/markdown editor delivers the editing feel *surgically* — the
  diff is only what changed.
- **Click-a-cell in-render editing — deferred.** The render is a sandboxed static
  iframe; true click-to-edit needs a non-sandboxed interactive renderer.
- **New-paragraph inline formatting, external-editor round-trip — follow-ups.**
  Formatting a brand-new paragraph (an idempotent second save round) and an
  "export markdown with embedded anchors → edit anywhere → re-import" workflow are
  scoped but not built.

---

## Verification & open items

Every backend path was verified live through the real stack (server + desktop
bridge): reads execute, the worktree-only gate refuses out-of-tree writes, and the
full edit → diff → review → promote loop ran on real `.docx` / `.xlsx` / `.pptx`.

The **markdown editor was re-verified live end-to-end** (server + bridge on a real
worktree): the compute route aligned a whole-document markdown edit, minted a grant,
and the governed `apply.batch` executed through the bridge — the inline-bold +
insert landed in the worktree with the project clone untouched. The mapper's ops
were also proven directly against the officecli binary (set/move/add honour the full
`/body/p[@paraId=..]` path; run-rebuild and reverse-insert land correctly).

Two open items:

- **Web layout not visually QA'd.** The preview pane, visual diff, and the block /
  markdown editors are typecheck-clean with proven data paths, but the CI sandbox
  cannot run a browser. They need a human pass in a real browser.
- **Resident write durability (known gap, fix pending).** officecli auto-spawns a
  `__resident-serve__` process per file (a read triggers it too), after which a
  write's disk save is *deferred* 2–10 s unless `OFFICECLI_RESIDENT_FLUSH=each` is
  set. No shipped code sets it, so a `promote` immediately after an `apply`
  invocation reports success can capture stale on-disk content. The governed write
  path should force a synchronous flush (env on the officecli apply spawn) so a
  worktree write is durable before the invocation completes.
