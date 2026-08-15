# ADR 0026: Local content originals stay authoritative; the catalog is derived and rebuildable

- Status: Proposed
- Date: 2026-08-14
- Revised: 2026-08-14
- Issue: [#1684](https://github.com/perly6185-lab/myagenttool/issues/1684)

## Context

MyAgentTool already keeps useful local material in several shapes:

- imported articles are stored below a registered project or worktree with Markdown, safe HTML, a manifest, and downloaded media;
- task input bytes are kept in private application storage and materialized into an execution worktree;
- task outputs remain in their registered project or worktree and are referenced by a local Work Item;
- mail bodies are currently durable application-result data while attachment bytes remain provider-backed and are read on demand; and
- workflow memory can scan explicitly registered directories, fingerprint files, extract supported text, and optionally build embeddings.

Those surfaces do not share one content identity, relationship model, or search contract. Moving all existing files into a new directory would break project-relative paths, duplicate task material, interfere with Git/worktrees, and make rollback unsafe. Treating an index as authoritative would also make index corruption a user-data-loss event.

## Decision

### 1. Original content remains authoritative

The catalog never becomes the source of truth for original bytes or mutable task state.

"One original" means one authoritative original for a content identity and version. It does not prohibit bounded, disposable copies created for preview, extraction, backup, or an AI execution. Those derivatives never become an additional authoritative original merely because they contain the same bytes.

- `managed`: MyAgentTool owns the original under its application-data root, such as retained RFC 822 mail archives and managed task material.
- `referenced`: the original remains below an explicitly registered project or worktree; the catalog stores a root reference plus a confined relative path.
- `snapshot`: a user-authorized immutable copy captures a completed or archived version while the live original may continue to change.
- `state_record`: structured local state, such as a Work Item or the current mail cache, is cataloged without pretending it is already an ordinary file.

The first implementation indexes existing content in place. It does not move, rename, overwrite, or delete originals.

### 2. Derived copies have an explicit lifecycle

The system distinguishes authoritative originals from derived artifacts:

- `execution_copy`: a byte-verified copy materialized below the invocation worktree so a sandboxed Codex or Claude run can process it;
- `extraction_cache`: bounded text or metadata derived for search;
- `preview_cache`: safely rendered content that may be discarded and recreated; and
- `backup_copy`: a copy governed by an explicit backup policy, not by the search catalog.

Execution copies are allowed and expected. They are excluded from catalog source discovery, ignored by Git delivery, scoped to one task/invocation, and disposable after the execution retention period. Materialization records the source content identity, source fingerprint, invocation, confined destination, and copied-byte hash. A modified execution copy never overwrites its source; a result that must be retained becomes a new `task_output` original with a `derived_from` relationship.

### 3. The catalog has provider-neutral records and typed relationships

Every record has a stable derived ID, owner team, kind, title, bounded summary, storage mode, root reference, relative path or state locator, provenance, timestamps, content fingerprint when available, availability, and indexing status.

Typed relationships represent `has_attachment`, `converted_to_task`, `uses_input`, `produces_output`, `derived_from`, and `same_content`. `same_content` is based on one confined physical locator, not merely equal hashes, so equal bytes at different authoritative locations remain separate originals. One original may therefore appear in several logical directory views without byte duplication.

### 4. Physical directories and logical directories are separate

Users browse logical directory facets such as kind, project, task, source, and date. These facets come from indexed metadata rather than duplicated folder trees. Physical paths remain meaningful for ownership and opening the original, but a file has one authoritative location.

Future managed originals use an application-data library root with human-inspectable record directories. Existing article and project/worktree layouts remain valid and are not migrated by this ADR.

### 5. Search is local-first and deterministic

A dedicated SQLite catalog provides indexed metadata and FTS5 full-text search. Title and summary rank above extracted body text. Metadata and bounded substring fallback remain available when FTS cannot satisfy a query. Optional embeddings may rerank a bounded candidate set later, but search must work without a network, model, or embedding index.

The catalog stores only derived, bounded search text. Large originals are read through their existing guarded paths and are never copied into the catalog database wholesale.

### 6. The index is disposable

The catalog database is derived state:

- rebuilding it does not change originals;
- deleting it does not delete originals;
- interrupted rebuilds roll back atomically;
- missing originals are represented explicitly instead of silently dropping history; and
- schema or extraction version changes trigger reindexing, not original-file mutation.

Incremental updates use a durable SQLite source journal and job queue. Related state changes enqueue one or more bounded source families (`articles`, `mail`, and `work_items`); up to 512 known authoritative-file parent directories also use non-persistent operating-system change watchers to enqueue a narrow source refresh. The journal, startup recovery, and manual per-record refresh remain the fallback when watcher capacity is exceeded, a watcher is unavailable, or an event is missed. Pending jobs merge source families, and an interrupted `running` job is returned to `queued` when the catalog reopens. Full rebuilds and incremental passes share one serialized operation chain, and events queued during a rebuild remain queued for a successor pass. A pass reads records owned by the requested families, reuses extraction when file size, modification time, and parser version are unchanged, applies only added, changed, or removed records, and refreshes relationships touching those records. Lightweight cross-source relationship topology and same-content links are recalculated without rereading unrelated original files. A failed pass leaves the last valid index readable; a newer successful pass clears older failure health, and a full rebuild remains the repair path.

### 6a. Preview and original location preserve the same boundary

Full-text preview resolves the original through the same tenant, project, root-confinement, symlink, availability, size, and fingerprint checks used for AI materialization. Native text is bounded to 1 MiB and returned as plain text. HTML scripts/styles/tags are neutralized server-side while link and image targets remain visible as inert text; the Web view never injects returned content as HTML and does not load remote resources. Archived `.eml` preview uses the verified original for integrity but presents parsed sender, subject, body, and attachment names rather than raw MIME. PDF and modern Office (`.docx`, `.xlsx`, `.pptx`) originals reuse the bounded local workflow parser and expose extracted text only. Office macros are never executed; actual file size, ZIP entry bounds, stored/expanded byte counts, page/cell/character limits are enforced; and scanned PDFs fail closed with an explicit OCR-required state.

Locating an original is a server-side action that passes the verified local path directly to the operating-system file manager. The response returns only a display name, never the absolute host path. Structured `state_record` content can be previewed but has no physical file to locate.

### 7. Local AI uses selected references and ordinary files by default

The first Codex and Claude integration does not require MCP. A user searches or browses the Local Library, adds content references to a task, and starts an execution. The existing execution preparation path resolves each reference, verifies availability and identity, materializes a temporary worktree copy when required by the agent sandbox, and generates a bounded context manifest. Both agents then use their normal local file-reading capabilities.

The durable task relationship points to the authoritative content identity. The invocation contract points to the execution-relative path and pins the fingerprint used for that run. Re-running a task creates or verifies a fresh execution copy from the selected authoritative version; it does not search or ingest previous execution copies.

Dynamic agent-initiated retrieval is an optional later adapter. It may expose bounded `search` and `read` operations through MCP or another supported tool protocol, but it must wrap the same provider-neutral catalog and guarded resolver. MCP is not a storage layer, an indexing prerequisite, or an ordinary-user dependency.

### 8. Existing trust boundaries remain in force

- Only application-data roots and explicitly registered project/worktree roots may be read.
- Relative paths are lexically and physically confined; symlinks are not followed as originals.
- Results are owner-team scoped, and project filters cannot reveal foreign projects.
- Mail, downloaded HTML, documents, OCR text, and extracted text remain untrusted reference data, never executable instructions.
- Search APIs return root references and confined relative paths, not unrestricted absolute host paths.
- Credential material, raw approval tokens, and secret-bearing environment data are excluded.
- Execution copies remain untrusted reference data, even when their source was selected by the user.
- The materializer rejects a missing or changed source when it cannot prove the exact bytes supplied to an invocation.
- Generated context manifests contain content identities and confined execution-relative paths, never unrestricted source paths.

## Initial content kinds

- `article`
- `mail`
- `task`
- `task_input`
- `task_output`

Additional kinds require an additive schema/version change rather than provider-specific columns in the core contract.

## Implemented review boundary

Issue #1684 and its follow-up slices deliver:

1. the catalog schema and migrations;
2. deterministic adapters for existing article jobs, cached mail, Work Items, task inputs, and task outputs;
3. atomic rebuild, durable source-scoped incremental journals/jobs, known-original file watching, per-record health/refresh, delta application, stats, directory facets, opaque paging cursors, and bounded search APIs;
4. safe plain-text and PDF/Office extracted-text preview plus operating-system file-manager location without path disclosure;
5. Local Library navigation, search/filtering, task references, and verified AI materialization; and
6. tests for isolation, confinement, missing/changed originals, preview neutralization, Office extraction, source-journal and file-event refresh, restart recovery, same-original grouping, 50,000-record search/paging, and rebuildability.

It does not yet deliver:

- standalone extracted attachment originals outside the retained RFC 822 message;
- moving existing articles or task files into a new managed hierarchy;
- OCR expansion;
- semantic/vector ranking;
- automatic retention/deletion of originals; or
- semantic/vector ranking and agent-initiated dynamic retrieval.

## Consequences

### Positive

- Existing local files and Git/worktree behavior remain stable.
- Sandboxed agents can continue using ordinary worktree files without duplicating catalog identities.
- All five content families can share one search and relationship contract.
- Index corruption has a bounded recovery path.
- Future OCR, retention, and semantic search work can be additive.
- Logical directory views do not require duplicate bytes.

### Tradeoffs

- Some first-version records point to structured state rather than an ordinary raw file.
- Referenced project outputs can disappear when a worktree is removed; the catalog reports them as missing until a user creates a snapshot.
- Extraction is intentionally bounded; image-only PDFs require the separate, still-optional OCR path, and legacy binary Office formats are metadata-only.
- A separate derived SQLite database adds migration, rebuild, and health-check responsibilities.
- Execution copies consume temporary disk space and require cleanup, but they do not change original ownership or catalog identity.

## Follow-up decisions

- Managed mail archive and attachment retention/encryption policy (proposed in [ADR 0027](ADR_0027_MANAGED_MAIL_ARCHIVE.md)).
- Snapshot creation and retention UX for completed task outputs.
- Saved searches, user-defined tags, and reusable directory views.
- OCR and semantic-ranking rollout gates with deterministic evaluation.
- The evidence threshold for adding dynamic MCP search/read after the file-based integration ships.
