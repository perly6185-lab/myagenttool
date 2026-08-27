# Local Content Library Delivery Plan

Status: Phase 0 foundation and the first Phase 3/4 user-to-AI flow are implemented for review under [#1684](https://github.com/perly6185-lab/myagenttool/issues/1684)

Architecture: [ADR 0026](ADR_0026_LOCAL_CONTENT_LIBRARY.md)

AI integration: [Local Content and Local AI Integration Design](LOCAL_CONTENT_AI_INTEGRATION_DESIGN.md)

Next product requirements: [Task Resource Bundle and Hidden Data Capabilities](../design/TASK_RESOURCE_BUNDLE_REQUIREMENTS.md)

Ordinary-user intent-to-action loop: [“我的资料”意图驱动的 AI 工作入口需求与开发规划](../design/LOCAL_PERSONAL_BRAIN_REQUIREMENTS.md)

## Product outcome

An ordinary local user can search previously downloaded articles, cached mail, local tasks, task inputs, and task outputs without remembering which project, mailbox folder, or worktree contains the original. Every result explains its source, related task, availability, and safe next action. Search remains useful offline and never treats external content as instructions.

## Delivery rules

1. Index in place before migrating any original.
2. Original bytes and mutable task state remain authoritative. Provider-delivered attachments whose remote message may expire are retained once in managed application data and become their authoritative local original.
3. Index databases are disposable and rebuildable.
4. A content identity is separate from a physical path.
5. Relationships create logical directory views without duplicating bytes; content-hash deduplication prevents repeated Channel sends from creating repeated managed originals.
6. Metadata/full-text search is mandatory; embeddings are optional reranking.
7. No result exposes an unrestricted absolute host path.
8. One authoritative original may produce disposable execution, preview, and extraction copies.
9. The catalog indexes authoritative originals and retained outputs, never execution copies.
10. Codex and Claude use the existing verified worktree materialization path; MCP is optional and deferred.

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

Implementation note: automatic indexing now provides a durable SQLite source journal/job queue, startup recovery, debounced and merged `articles`/`mail`/`work_items` triggers, serialized rebuild/incremental operations, source-scoped collection, unchanged-file extraction reuse, atomic record deltas, tenant-safe relationship repair, recoverable UI status, and full-rebuild recovery. Known authoritative originals also register confined, non-persistent parent-directory watchers that enqueue narrow refreshes; journal and manual refresh remain the durable fallback. PDF and modern Office text extraction reuse the bounded local workflow parser and record parser/status diagnostics per item. Discovery of entirely new files outside registered state, extraction-version migrations, watcher telemetry, and OCR remain open.

Scope:

- durable indexing queue and per-record extraction version;
- change detection from state revisions, fingerprints, and registered-root scans;
- bounded Markdown, HTML, text, PDF, and Office extraction reuse;
- OCR opt-in for images/scanned PDFs;
- tombstones for missing referenced files;
- repair, resume, and partial-failure diagnostics;
- deterministic summaries first, optional AI summaries with provider/model/version provenance;
- explicit exclusion of `.myagenttool/inputs` and other execution-copy roots from discovery;
- stable content identity when a locator changes but a verified source fingerprint and ownership rule preserve identity.

Exit gate:

- new supported text becomes searchable within 5 seconds after an indexing event;
- one failed parser does not block other records;
- an interrupted run resumes or rolls back without a half-replaced index;
- reindexing unchanged content does not rewrite originals or duplicate records; and
- materializing or deleting an execution copy does not add, remove, or update a catalog content record.

## Phase 3 — Local Library and task references

Implementation note: the review slice now includes the first-level destination, full-text search, type/project/task/source/month/availability/index-state facets, friendly source and related-task labels, match snippets, opaque cursor paging, same-original context grouping, index build/refresh recovery, availability states, mobile navigation, safe bounded native-text, parsed-mail, and PDF/Office extracted-text preview, operating-system file-manager location without path disclosure, add-to-task selection, and task-detail reference health/removal/recovery. Visual/rich document rendering, OCR, tags, and saved searches remain open.

Owner surface: a new first-level `Local Library` / `本地资料库` destination, with related-content entries in Mail and My Tasks.

Primary flow:

```text
Open Local Library
  -> search or choose a directory facet
  -> inspect summary, source, task, and availability
  -> preview safely or reveal the confined original
  -> add a reference to a new or existing task
  -> start AI processing when ready
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
- no heavy document/indexing modules enter the initial Web bundle; and
- adding an item to a task persists only a scoped content reference and does not copy bytes.

## Phase 4 — Codex and Claude context preparation

Scope:

- resolve task content references through the same ownership, availability, and path-confinement rules as catalog preview;
- reuse the existing task-material worktree copy path rather than creating a provider-specific file pipeline;
- verify source and destination hashes and record an invocation-scoped materialization receipt;
- generate a bounded provider-neutral manifest containing content identity, provenance, fingerprint, untrusted-reference labeling, and execution-relative paths;
- feed the same selected material to Codex and Claude through their normal local-file capabilities;
- keep execution copies outside catalog discovery and Git delivery;
- register retained results as new `task_output` originals with `derived_from` relationships; and
- rebuild identical inputs on retry while the authoritative source and selected fingerprint are unchanged.

MCP is not in the critical path. A later adapter may expose bounded dynamic `search` and `read` operations only after ordinary file-based integration is measured in production-like use.

Exit gate:

- a user can search, add a reference, start Codex or Claude, and receive a result without seeing paths, worktrees, indexes, or MCP terminology;
- both providers receive the same manifest semantics and selected bytes;
- changing an execution copy cannot modify its authoritative source;
- execution copies never appear as duplicate Local Library results or Git changes;
- a missing, changed, oversized, or inaccessible source fails before agent launch with an ordinary recovery action; and
- execution evidence identifies the exact source fingerprint and copied-byte hash used by the invocation.

## Phase 5 — Ranking, deduplication, and lifecycle governance

Scope:

- evaluated semantic reranking over a bounded FTS candidate set;
- duplicate and near-duplicate grouping;
- user-confirmed tags and saved searches;
- task completion snapshots and archive policies;
- backup/export/import and catalog health reporting;
- storage cleanup with preview, confirmation, and audit trail; and
- optional dynamic AI retrieval adapter, through MCP or another supported protocol, if usage evidence justifies it.

Vector rollout gate:

- deterministic FTS remains the fallback;
- use a representative local evaluation set;
- top-5 recall and MRR cannot regress from the lexical baseline;
- model/provider changes produce a new index version;
- disabling the embedding provider does not disable search.

## Next program — Actionable personal brain

The catalog, task-reference flow, and guarded retrieval contract are the foundation, not the final ordinary-user product. The next program is defined in [“我的资料”意图驱动的 AI 工作入口需求与开发规划](../design/LOCAL_PERSONAL_BRAIN_REQUIREMENTS.md) and adds the user-facing loop in independently releasable milestones:

1. state a goal, use existing material, verify direct citations, and create a scoped task;
2. summarize, extract, compare, create, and retain versioned results;
3. continue a confirmed result into task, site-draft, or host-operation proposal flows;
4. explicitly add files, folders, text, images, and links, then organize them into user-facing topics;
5. add evaluated OCR and optional semantic reranking without removing lexical fallback; and
6. add explainable review and external read-only AI only after the in-product loop is proven.

This program must reuse `content record`, task references, original resolution, and invocation materialization. It must not introduce a second content identity, silently ingest arbitrary disk locations, or authorize a task to read the whole library.

## Catalog API introduced in Phase 0

```text
GET  /api/local-content?q=&kind=&projectId=&workItemId=&sourceType=&yearMonth=&availability=&indexStatus=&limit=&cursor=
GET  /api/local-content/stats
POST /api/local-content/rebuild
GET  /api/local-content/:contentId/preview
POST /api/local-content/:contentId/reveal
POST /api/local-content/health
POST /api/local-content/:contentId/refresh
POST /api/local-content/:contentId/reveal-container
POST /api/work-items/:workItemId/content-references
DELETE /api/work-items/:workItemId/content-references/:referenceId
```

The catalog API returns content identity, kind, summary, provenance, confined locator, availability, indexing state, and typed relationships. The task-reference API records or removes a logical relationship without copying bytes. Neither surface returns extracted full bodies, content fingerprints as ordinary fields, or unrestricted absolute paths.

## Quality targets

- Search p95 under 300 ms for 50,000 indexed records on the supported local runtime.
- Results are bounded to 100 per request; opaque cursors and a compatibility offset can traverse beyond the former 10,000-record boundary.
- Full rebuild is atomic and reports record/relation counts.
- Search is fully offline-capable.
- 100% of returned records are owner-team scoped.
- Original availability is verified, not assumed.
- An index deletion/rebuild test remains part of CI.

## Planned issue sequence

1. Phase 0 catalog foundation — #1684.
2. Managed `.eml` and attachment archive contract.
3. Incremental indexing queue and extraction adapters.
4. Local Library product flow, task reference contract, prototype, and visual QA.
5. Production Local Library UI and related-content entry points.
6. Codex/Claude context manifest and verified execution materialization.
7. Snapshot, retention, backup, and repair controls.
8. Evidence-gated dynamic retrieval adapter, semantic reranking, and deduplication.
9. Intent-first M0 prototype, terminology, and retrieval/citation evaluation baseline.
10. Material-work session, goal-first UI, citations, and answer-to-task flow.
11. Guided summaries, extraction, comparison, retained outcomes, and action proposals.
12. Explicit local capture and user-facing topics.
13. OCR and evidence-gated hybrid retrieval.
14. Explainable review and external read-only AI adapters.

Each issue must carry its own Project Fields, product-flow binding, risk assessment, rollback plan, and verification evidence. Phase 1 changes the mail data boundary and requires explicit architecture/security review before implementation.
