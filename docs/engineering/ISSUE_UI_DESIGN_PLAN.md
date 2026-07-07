# Issue → visual UI design — gap assessment + plan

The decision agent already routes an issue to `design` and produces a **text**
brief (report_posted → issue comment + child implementation issue). What is
missing is the **visual** half: ASCII wireframes a human can actually read,
HTML mockups a human can actually see, and (later) visual acceptance. This doc
records the recon and the slice plan.

## Recon (2026-07-07)

| Layer | Status |
|---|---|
| design routing + text brief | DONE — role prompt (`issue-prompt.mjs` design role), `skl_design_brief` role-scoped skill, no-diff → report_posted → issue comment + spawned child issue (human gate) |
| presenting the design | WEAK — `run.report` renders as a `line-clamp-3` plain-text `<p>` in the Auto-runs card; the web console has **no** markdown renderer, **no** HTML preview (no iframe/srcDoc anywhere) |
| visual design / acceptance | MISSING — no playwright/puppeteer/screenshot tooling anywhere; #169 (visual QA) targets the console's own smoke tests, not this pipeline |
| reusable plumbing | GOOD — `GET /api/worktrees/:id/file?path=…` (≤512KB content), file list/search/diff endpoints already exist; agent-skills support role-scoped instructions; spawn-child-issue flow exists |

## Plan — slices, cheap → expensive (each opt-in / additive)

### D1 — Render the brief properly (web-only, small)
The report card becomes an expandable panel: monospace `<pre>` for ASCII
wireframes, minimal markdown-lite (headings / fenced code / lists — no new
deps, no raw HTML injection). Without this, D2's ASCII wireframes are illegible.
- Acceptance: an ASCII mockup in `run.report` displays aligned and expandable;
  no `dangerouslySetInnerHTML`.

### D2 — UI-design skill: ASCII wireframes in the brief (prompt-level, small)
Seed a role-scoped skill `skl_ui_design` (paths: ["design"]) that, when the
issue is UI-related, requires the brief to include: ASCII wireframes of each
affected screen/state (fenced code blocks), a component hierarchy, and interaction
notes. Pure prompt + seeded skill — no engine change; composes with D1.
- Acceptance: a design run on a UI issue posts a brief whose wireframes render
  legibly in console + issue comment.

### D3 — HTML mockup artifacts + console preview (server+web, medium)
Let a design run WRITE design artifacts (a dedicated `design/` directory:
`mockup-*.html`, self-contained, no external resources) — artifacts are not
product code, so the "do not modify product code" rule narrows to "product code
outside design/". The run publishes the branch; the Auto-runs card gains a
**Design** panel listing `design/*.html` (existing file endpoint) rendered in a
**sandboxed** iframe (`sandbox=""`, srcDoc, scripts stripped) + `.md/.txt` as text.
- Acceptance: a UI design run yields clickable visual mockups viewable in-console;
  iframe is fully sandboxed; non-design paths in the diff still block spawn.

### D4 — Design acceptance → implementation handoff (small-medium)
An **Approve design** action on a report_posted design run: records the approval
(audit event) and spawns the implementation child issue (existing spawn flow)
with the brief + mockup file list embedded, so the develop run receives the
design as its spec. Rejection posts feedback to the issue instead.
- Acceptance: approve → child issue carries the design; the child's develop run
  prompt includes it; reject → comment, no child.

### D5 (DEFERRED) — Visual acceptance / screenshots
Playwright-based screenshot capture of the implemented UI + before/after in the
merge dialog; overlaps #169's browser checks. Heavy new dependency + per-repo
dev-server knowledge — defer until D1–D4 prove the demand.

## Guardrails
- design runs still never modify product code (D3 narrows the rule to allow
  `design/**` only); auto-merge's sensitive-path guard is untouched.
- Mockup preview is sandboxed (no scripts, no network) — an agent-authored HTML
  file must not become an XSS vector in the console.
- All slices default-on only where they are pure additions (D1 rendering);
  anything that changes run behaviour (D3 write-scope, D4 action) ships opt-in.
