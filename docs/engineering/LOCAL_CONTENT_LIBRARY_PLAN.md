# Local Content Library Delivery Plan

Status: Phase 0 implementation in progress under [#1684](https://github.com/perly6185-lab/myagenttool/issues/1684)

Architecture: [ADR 0026](ADR_0026_LOCAL_CONTENT_LIBRARY.md)

## Product outcome

An ordinary local user can search previously downloaded articles, cached mail, local tasks, task inputs, and task outputs without remembering which project, mailbox folder, or worktree contains the original. Every result explains its source, related task, availability, and safe next action. Search remains useful offline and never treats external content as instructions.

## Delivery rules

1. Index in place before migrating any original.
2. Original bytes and mutable task state remain authoritative.
3. Index databases are disposable and rebuildable.
4. A content identity is separate from a physical path.
5. Relationships create logical directory views without duplicating bytes.
6. Metadata/full-text search is mandatory; embeddings are optional reranking.
7. No result exposes an unrestricted absolute host path.

## Phase 0 — Unified catalog foundation

Tracking: #1684

Scope:

- provider-neutral content records and typed relationships;
- separate SQLite catalog with metadata indexes and FTS5;
- atomic full rebuild;
- initial adapters for articles, current mail cache, tasks, task inputs, and task outputs;
- team/project-scoped search, stats, and rebuild APIs;
- explicit missing, partial, metadata-only, and ready states.

Exit gate:

- all five initial kinds are discoverable;
- deleting and rebuilding the catalog does not change an original;
- path traversal and symlinked originals are refused;
- foreign-team and foreign-project records remain opaque;
- search works with no network or model.

## Phase 1 — Managed mail originals (implemented for review in #1686)

Problem: current mailbox results contain bounded parsed bodies, while attachment bytes remain provider-backed and the RFC 822 original is not archived.

Scope:

- save a verified `message.eml` under application-managed storage when a user explicitly fetches/opens the message; keep background folder sync header-only;
- derive displayed body and attachment metadata from the archived original;
- retain attachment bytes once inside that message's RFC 822 original, without duplicate per-attachment copies;
- relate mail, attachments, replies, and converted tasks;
- apply a 50 MiB/message and 2 GiB/archive fail-closed quota; retain indefinitely in this slice and require preview-plus-confirmation for future cleanup;
- treat archives as sensitive mailbox backup data, retain them when credentials are removed, and rely on OS profile/volume protection until an application-layer encryption ADR is accepted;
- preserve remote-image blocking and the untrusted-input boundary.

Exit gate:

- a fetched mail result can be reconstructed byte-for-byte from the local `.eml` while retained;
- attachment availability is explicit and never inferred from metadata alone;
- removing derived indexes cannot remove mail originals;
- retention previews name exactly what will be removed before confirmation.

## Phase 2 — Incremental indexing and richer extraction

Scope:

- durable indexing queue and per-record extraction version;
- change detection from state revisions, fingerprints, and registered-root scans;
- bounded Markdown, HTML, text, PDF, and Office extraction reuse;
- OCR opt-in for images/scanned PDFs;
- tombstones for missing referenced files;
- repair, resume, and partial-failure diagnostics;
- deterministic summaries first, optional AI summaries with provider/model/version provenance.

Exit gate:

- new supported text becomes searchable within 5 seconds after an indexing event;
- one failed parser does not block other records;
- an interrupted run resumes or rolls back without a half-replaced index;
- reindexing unchanged content does not rewrite originals or duplicate records.

## Phase 3 — Local Library user experience

Owner surface: a new first-level `Local Library` / `本地资料库` destination, with related-content entries in Mail and My Tasks.

Primary flow:

```text
Open Local Library
  -> search or choose a directory facet
  -> inspect summary, source, task, and availability
  -> preview safely or reveal the confined original
  -> create/follow a related local task
```

Logical directories:

- kind: articles, mail, tasks, inputs, outputs;
- project and local task;
- source/provider/account;
- year/month;
- tags and saved searches;
- availability/index state.

What ordinary users should not see:

- SQLite/FTS/embedding terminology;
- raw hashes or root IDs as primary labels;
- absolute paths outside a registered root;
- provider protocol errors;
- unsafe HTML execution or hidden remote-image loading.

Exit gate:

- a user can find a known item by title, sender, task reference, filename, or body phrase;
- every result distinguishes original available, metadata only, missing, and indexing failed;
- keyboard and 390 px mobile flows remain usable;
- no heavy document/indexing modules enter the initial Web bundle.

## Phase 4 — Ranking, deduplication, and lifecycle governance

Scope:

- evaluated semantic reranking over a bounded FTS candidate set;
- duplicate and near-duplicate grouping;
- user-confirmed tags and saved searches;
- task completion snapshots and archive policies;
- backup/export/import and catalog health reporting;
- storage cleanup with preview, confirmation, and audit trail.

Vector rollout gate:

- deterministic FTS remains the fallback;
- use a representative local evaluation set;
- top-5 recall and MRR cannot regress from the lexical baseline;
- model/provider changes produce a new index version;
- disabling the embedding provider does not disable search.

## Catalog API introduced in Phase 0

```text
GET  /api/local-content?q=&kind=&projectId=&limit=&offset=
GET  /api/local-content/stats
POST /api/local-content/rebuild
```

The API returns content identity, kind, summary, provenance, confined locator, availability, indexing state, and typed relationships. It does not return extracted full bodies or unrestricted absolute paths.

## Quality targets

- Search p95 under 300 ms for 50,000 indexed records on the supported local runtime.
- Results bounded to 100 per request and offset bounded to 10,000.
- Full rebuild is atomic and reports record/relation counts.
- Search is fully offline-capable.
- 100% of returned records are owner-team scoped.
- Original availability is verified, not assumed.
- An index deletion/rebuild test remains part of CI.

## Planned issue sequence

1. Phase 0 catalog foundation — #1684.
2. Managed `.eml` and attachment archive contract.
3. Incremental indexing queue and extraction adapters.
4. Local Library product flow, prototype, and visual QA.
5. Production Local Library UI and related-content entry points.
6. Snapshot, retention, backup, and repair controls.
7. Evaluated semantic reranking and deduplication.

Each issue must carry its own Project Fields, product-flow binding, risk assessment, rollback plan, and verification evidence. Phase 1 changes the mail data boundary and requires explicit architecture/security review before implementation.
