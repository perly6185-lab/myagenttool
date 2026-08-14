# ADR 0026: Local content originals stay authoritative; the catalog is derived and rebuildable

- Status: Proposed
- Date: 2026-08-14
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

- `managed`: MyAgentTool owns the original under its application-data root, such as future RFC 822 mail archives and managed task material.
- `referenced`: the original remains below an explicitly registered project or worktree; the catalog stores a root reference plus a confined relative path.
- `snapshot`: a user-authorized immutable copy captures a completed or archived version while the live original may continue to change.
- `state_record`: structured local state, such as a Work Item or the current mail cache, is cataloged without pretending it is already an ordinary file.

The first implementation indexes existing content in place. It does not move, rename, overwrite, or delete originals.

### 2. The catalog has provider-neutral records and typed relationships

Every record has a stable derived ID, owner team, kind, title, bounded summary, storage mode, root reference, relative path or state locator, provenance, timestamps, content fingerprint when available, availability, and indexing status.

Typed relationships represent `has_attachment`, `converted_to_task`, `uses_input`, `produces_output`, `derived_from`, and `same_content`. One original may therefore appear in several logical directory views without byte duplication.

### 3. Physical directories and logical directories are separate

Users browse logical directory facets such as kind, project, task, source, and date. These facets come from indexed metadata rather than duplicated folder trees. Physical paths remain meaningful for ownership and opening the original, but a file has one authoritative location.

Future managed originals use an application-data library root with human-inspectable record directories. Existing article and project/worktree layouts remain valid and are not migrated by this ADR.

### 4. Search is local-first and deterministic

A dedicated SQLite catalog provides indexed metadata and FTS5 full-text search. Title and summary rank above extracted body text. Metadata and bounded substring fallback remain available when FTS cannot satisfy a query. Optional embeddings may rerank a bounded candidate set later, but search must work without a network, model, or embedding index.

The catalog stores only derived, bounded search text. Large originals are read through their existing guarded paths and are never copied into the catalog database wholesale.

### 5. The index is disposable

The catalog database is derived state:

- rebuilding it does not change originals;
- deleting it does not delete originals;
- interrupted rebuilds roll back atomically;
- missing originals are represented explicitly instead of silently dropping history; and
- schema or extraction version changes trigger reindexing, not original-file mutation.

### 6. Existing trust boundaries remain in force

- Only application-data roots and explicitly registered project/worktree roots may be read.
- Relative paths are lexically and physically confined; symlinks are not followed as originals.
- Results are owner-team scoped, and project filters cannot reveal foreign projects.
- Mail, downloaded HTML, documents, OCR text, and extracted text remain untrusted reference data, never executable instructions.
- Search APIs return root references and confined relative paths, not unrestricted absolute host paths.
- Credential material, raw approval tokens, and secret-bearing environment data are excluded.

## Initial content kinds

- `article`
- `mail`
- `task`
- `task_input`
- `task_output`

Additional kinds require an additive schema/version change rather than provider-specific columns in the core contract.

## Initial implementation boundary

Issue #1684 delivers:

1. the catalog schema and migrations;
2. deterministic adapters for existing article jobs, cached mail, Work Items, task inputs, and task outputs;
3. atomic rebuild, stats, and bounded search APIs; and
4. tests for isolation, confinement, missing originals, search, and rebuildability.

It does not yet deliver:

- RFC 822 `.eml` archival or full mail attachment caching;
- moving existing articles or task files into a new managed hierarchy;
- OCR expansion;
- semantic/vector ranking;
- a new Local Library UI; or
- automatic retention/deletion of originals.

## Consequences

### Positive

- Existing local files and Git/worktree behavior remain stable.
- All five content families can share one search and relationship contract.
- Index corruption has a bounded recovery path.
- Future `.eml`, OCR, retention, and semantic search work can be additive.
- Logical directory views do not require duplicate bytes.

### Tradeoffs

- Some first-version records point to structured state rather than an ordinary raw file.
- Referenced project outputs can disappear when a worktree is removed; the catalog reports them as missing until a user creates a snapshot.
- Initial extraction is intentionally bounded and supports fewer formats than the document preview system.
- A separate derived SQLite database adds migration, rebuild, and health-check responsibilities.

## Follow-up decisions

- Managed mail archive and attachment retention/encryption policy (proposed in [ADR 0027](ADR_0027_MANAGED_MAIL_ARCHIVE.md)).
- Snapshot creation and retention UX for completed task outputs.
- Local Library navigation and saved-search product flow.
- OCR and semantic-ranking rollout gates with deterministic evaluation.
