# P4 Evidence Detail Owner Surface

Status: P4-3 design slice.

Objective: make Evidence Center a first-class Web owner surface with stable
selection, URL navigation, and operator-safe open/copy actions, instead of
treating evidence rows as incidental data inside other cards.

## Current Facts

- The server already builds scoped `evidenceCenterRecords` in
  `apps/server/src/read-models/evidence-center.mjs`.
- `/api/state` already includes the scoped evidence center read model from
  `apps/server/src/read-models/state.mjs`.
- Web currently renders evidence-adjacent data through owner-specific surfaces:
  Audit, Review, Economics imported usage, Applications result panels,
  Invocations, and the context inspector.
- Web does not yet type `evidenceCenterRecords`, does not have a selected
  evidence id, and does not have a detail owner surface.

## Navigation Contract

Add one URL-backed selection key:

| Query parameter | UI state | Meaning |
| --- | --- | --- |
| `evidence` | `selectedEvidenceId` | Selected Evidence Center record id. |

Evidence detail links should use:

```text
?section=audit&evidence=ev_123
```

The selected evidence id should be independent of `invocation` and application
run selection. Evidence rows may carry invocation/session/app context, but the
selected evidence row is the owner target.

## Web State Contract

Extend the UI store with:

```ts
selectedEvidenceId: string | null;
setSelectedEvidenceId(id: string | null): void;
```

Persist it with the other navigation selections. URL navigation should:

- Hydrate `selectedEvidenceId` from `?evidence=...`.
- Clear stale persisted evidence selection when any navigation parameter is
  present and `evidence` is absent.
- Include `evidence` when generating shareable Evidence Center links.

## Read Model Contract

Add Web/protocol typing for:

```ts
interface EvidenceCenterRecord {
  id: string;
  type: string;
  source: string;
  redactionState?: string | null;
  invocationId?: string | null;
  codexSessionRegistryId?: string | null;
  agentId?: string | null;
  repoPath?: string | null;
  summary: string;
  detail?: string | null;
  marker?: string | null;
  createdAt?: string | null;
}
```

The server read model stays summary-first. Do not expose raw terminal output,
raw Codex JSONL, raw review payloads, or unredacted external reports in this
P4 slice.

## Owner Surface

Use the existing `audit` section as the first owner surface and add an Evidence
Center band/detail pane there.

The first screen should support:

- List recent scoped evidence records.
- Filter by `source`, `type`, and redaction/marker state when useful.
- Select a row and show a detail panel in the same section.
- Copy a stable Evidence detail link.
- Open related invocation when `invocationId` is loaded in the current state.

The detail panel should show:

- Summary.
- Detail.
- Source/type/marker/redaction state.
- Invocation id and Codex session id when present.
- Repository path when present.
- Created-at timestamp.
- An explicit note when the related invocation is not loaded.

## Openable Record Matrix

| Evidence type/source | Detail owner | Related action | Status for first implementation |
| --- | --- | --- | --- |
| Managed Codex JSONL summaries | Evidence detail | Open related invocation when loaded | Include |
| Managed Codex hook events | Evidence detail | Open related invocation when loaded | Include |
| Codex approval broker requests | Evidence detail | Open related invocation when loaded | Include |
| Managed Codex change reviews | Evidence detail | Open related invocation when loaded | Include |
| Imported ccusage usage estimates | Evidence detail | Open report/source invocation when loaded | Include |
| Codex runtime warnings | Evidence detail | Open related invocation when loaded | Include |
| Managed terminal evidence summaries | Evidence detail | Open related invocation when not manual | Include |
| Imported Codex evidence | Evidence detail | No invocation action unless a linked session can be resolved later | Include as read-only |

## Non-Goals

- A route framework or path-based routing.
- Full browser history entries for every evidence selection change.
- Raw evidence download or raw payload rendering.
- New server routes for evidence detail. The first implementation should use
  the existing scoped `/api/state` read model.
- Evidence mutation, deletion, export, or retention controls.
- Dedicated evidence detail surfaces for auto-run, compare-run, or tool detail
  before those owner surfaces have stable selected ids.

## Implementation Sequence

1. Add Web/protocol `EvidenceCenterRecord` type and `evidenceCenterRecords` to
   the Web snapshot type.
2. Extend `ui-store` URL navigation with `selectedEvidenceId` and `evidence`.
3. Add `evidenceDeepLink` helper and tests alongside existing deep-link
   helpers.
4. Build an Evidence Center panel in `AuditView`, backed by
   `state.evidenceCenterRecords`.
5. Add select/open/copy behavior:
   - select row -> `selectedEvidenceId`
   - copy -> `?section=audit&evidence=...`
   - open invocation -> `section=invocations&invocation=...` only when loaded
6. Add Web tests for URL hydration, link generation, row selection, missing
   related invocation handling, and copy behavior.
7. Keep server scoped evidence-center tests green.

## Acceptance

- A copied Evidence Center link refreshes back to the Audit section with the
  same evidence row selected.
- Evidence detail is useful without opening raw JSON.
- A row with a loaded `invocationId` offers an explicit invocation jump.
- A row without a loaded invocation explains that the target is not loaded.
- Existing P4 invocation/application/troubleshooting links still pass.

## Verification

Expected implementation checks:

```text
pnpm --filter @myagenttool/web test -- ui-store deep-links url-navigation-sync audit
pnpm --filter @myagenttool/web typecheck
pnpm --filter @myagenttool/server exec node --test test/public-state-codex-scope.test.mjs test/persistence.test.mjs
git diff --check
```

Run broader Web tests when the UI surface lands:

```text
pnpm --filter @myagenttool/web test
```
