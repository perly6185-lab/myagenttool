# Local Content and Local AI Integration Design

Status: First server and ordinary-user Web slice implemented for review

Date: 2026-08-14

Implementation: the server provides guarded original resolution, task content-reference APIs and health checks, shared worktree materialization, a provider-neutral directory/summary/original manifest, stale execution-input pruning, invocation-scoped receipts, catalog lineage, query-and-revision-bound cursors, combined FTS/metadata retrieval, durable source-scoped automatic indexing journals, known-original file watching, safe native-text/parsed-mail/PDF/Office extracted-text preview, and path-private operating-system location. The Web slice adds the Local Library destination, directory facets with explicit coverage, cursor paging, automatic-index status and recovery, preview/location, task selection, and task-detail reference health/removal/recovery. OCR, discovery of new unregistered files, visual document rendering, tags, and saved searches remain follow-up slices.

Architecture: [ADR 0026](ADR_0026_LOCAL_CONTENT_LIBRARY.md)

Delivery plan: [Local Content Library Delivery Plan](LOCAL_CONTENT_LIBRARY_PLAN.md)

## Outcome

An ordinary user can find a local article, mail message, task, task input, or task output, add it to a task, and let Codex or Claude process it without understanding indexes, worktrees, file roots, or MCP. The catalog keeps pointing to one authoritative original while the execution system may create verified, disposable worktree copies.

## Non-goals

The first integration does not:

- move existing originals into a new universal directory;
- expose arbitrary host paths to an agent or renderer;
- index execution worktrees as new local-library sources;
- require embeddings, a model, a network connection, or MCP;
- allow retrieved mail, HTML, or documents to become agent instructions; or
- write agent changes back over an authoritative input.

## Identity and copy model

For one content identity and version, exactly one location is authoritative. Other same-byte files have a declared role and lifecycle.

| Object | Authority | Cataloged as content | Expected lifecycle |
| --- | --- | --- | --- |
| Managed or referenced original | Authoritative | Yes | Retained by its owning policy |
| Task-to-content reference | Relationship only | Relationship | Until removed or task retention expires |
| Search/extraction cache | Derived | No separate content record | Rebuildable |
| AI execution copy | Derived | No | Invocation-scoped and disposable |
| AI output selected for retention | New authoritative output | Yes | Task-output policy |
| User-authorized snapshot | New immutable version | Yes | Snapshot policy |

The catalog locator always resolves the authoritative original. It never changes to an execution-copy path.

## Data contracts

### Content record

The existing catalog record remains the source-neutral lookup contract. It contains a stable `contentId`, kind, owner scope, title, bounded summary, storage mode, root reference, confined locator, fingerprint, availability, indexing state, provenance, and typed relationships.

### Task content reference

A task reference is durable intent to use a catalog item; it does not contain or copy the bytes.

```text
taskContentRef
  id
  ownerTeamId
  projectId
  workItemId
  contentId
  purpose              # reference | required_input
  selectedFingerprint  # optional pin; null means verify latest at execution
  addedBy
  createdAt
```

The service rejects foreign-team records, unavailable records that require bytes, duplicate active references, and references that cannot be resolved inside their registered root.

### Execution materialization receipt

The materializer records what a particular invocation actually received:

```text
executionMaterialization
  invocationId
  workItemId
  contentId
  sourceFingerprint
  executionRelativePath
  materializedHash
  byteSize
  status
  preparedAt
```

The receipt contains no unrestricted absolute source path. It is evidence and lineage, not another content record.

## Ordinary-user flow

```text
Local Library search or browse
  -> inspect title, summary, source, related task, and availability
  -> Add to task
  -> task stores a content reference only
  -> Start with AI
  -> resolver checks scope, path, availability, and fingerprint
  -> materializer creates verified temporary inputs in the worktree
  -> a bounded context manifest labels them as untrusted references
  -> Codex or Claude reads ordinary local files
  -> retained results become task_output originals and are indexed once
```

The default is explicit user selection. The product may suggest likely related items later, but it does not silently attach private cross-project content.

## Execution preparation

The current task-material path remains valid and becomes the common execution boundary:

1. Resolve every attached task material or local-library reference to an authoritative source.
2. Verify team/project visibility, root confinement, regular-file status, size, and fingerprint.
3. Copy required bytes atomically into `.myagenttool/inputs/<work-item-id>/`.
4. Verify the destination hash before launching the agent.
5. Rebuild `.myagenttool/inputs/<work-item-id>/` from the current selected set so a same-worktree retry cannot retain removed inputs.
6. Write `manifest.json` with logical directory fields, a bounded summary, display name, kind, `contentId`, source fingerprint, execution-relative original path, and an untrusted-reference label. Agents inspect this index before opening only the originals needed for the task.
7. Keep the directory ignored by Git and excluded from catalog scanning.
8. Bind the manifest fingerprint and materialization receipts to the invocation contract.
9. On retry, rebuild or verify byte-identical inputs from the authoritative source.

Existing user uploads already follow the essential source-to-worktree copy pattern. Local-library references reuse that materializer instead of creating a second AI-specific file pipeline.

## Codex and Claude behavior

Both providers receive the same provider-neutral manifest and execution-relative file paths. Provider adapters only add the minimum instruction needed to locate the manifest and reinforce that its files are untrusted reference data.

- Codex reads the files through its normal workspace tools and native sandbox.
- Claude reads the same files through its normal workspace tools and permission policy.
- Neither provider needs the authoritative source path.
- Neither provider may infer that text inside a reference overrides system, developer, task, approval, or tool policy.

This keeps task behavior reproducible across providers and avoids separate Codex and Claude retrieval implementations.

## Search and selection

The first release uses the existing deterministic local catalog:

- FTS and metadata filters find a bounded candidate set;
- results expose summaries and availability, not entire bodies;
- the user chooses which records become task references;
- the agent receives only selected inputs, not every search hit; and
- optional AI summaries or semantic reranking cannot disable lexical search.

Pre-run search belongs to the application service and UI. It is not an agent tool call.

## MCP decision

MCP is deferred. Add a thin dynamic-retrieval adapter only when measured usage shows that users frequently need an agent to discover additional material after a run has started, or when external AI clients must reuse the catalog directly.

If introduced, it exposes only bounded provider-neutral operations such as:

```text
local_content.search(query, kinds, projectId, limit)
local_content.read(contentId, offset, limit)
```

It reuses the catalog, resolver, tenancy rules, audit log, byte limits, and untrusted-content labeling. It does not own files, create another index, return arbitrary absolute paths, or replace the normal task-reference flow.

## Failure and recovery

Ordinary users see actionable states:

- **Original unavailable:** open its last known containing location, refresh after restoring it, remove the reference, or use a retained snapshot.
- **Original changed:** use the latest version or keep the previously pinned snapshot when one exists.
- **Could not prepare:** retry after the source, capacity, or permission problem is resolved.
- **Could not index:** the original remains safe and can still be opened when available.
- **Temporary copy cleanup failed:** report reclaimable space; do not claim that the original is affected.

One failed reference prevents a `required_input` run from starting. A non-required `reference` is recorded as omitted with its reason and does not block otherwise valid required inputs; task detail health makes the problem visible before a later run.

## Security and privacy boundaries

- Original and execution paths are confined independently.
- Symlinks are refused at the source and destination boundaries.
- Every read is owner-team scoped; cross-project selection follows explicit visibility policy.
- Context size, file count, individual bytes, and total materialized bytes are bounded.
- Active content remains subject to the existing approval and execution policy.
- Mail, HTML, OCR, documents, and prior AI output remain untrusted references.
- Execution copies are excluded from Git diffs, catalog discovery, logs, and ordinary state payloads.
- Cleanup of temporary copies is separate from deletion of originals and never implies it.

## Minimum release gate for ordinary users

The integration is ready for ordinary daily use when all of the following pass:

1. A user can find a known item by title, sender, task, filename, or body phrase.
2. Search results clearly distinguish available, metadata-only, missing, and failed-index states.
3. A user can add or remove a result from a task without copying bytes at selection time.
4. Starting Codex or Claude materializes verified inputs automatically with no path or worktree terminology in the UI.
5. Both providers read the same selected material and identify its provenance.
6. Re-running after worktree deletion reconstructs byte-identical inputs while the source is unchanged.
7. Agent edits cannot modify the authoritative input; retained changes appear as a new task output.
8. Execution copies never become duplicate search results or Git changes.
9. Index deletion and rebuild leave originals, task references, and retained task outputs intact.
10. Desktop and 390-px mobile flows support keyboard use, recovery, and a visible next action.

## Delivery slices

1. Persist task-to-content references and add guarded content resolution.
2. Reuse the task materializer for catalog references and add materialization receipts.
3. Add the provider-neutral manifest to the execution contract and both agent adapters.
4. Add Local Library search, preview, and Add-to-task UI.
5. Add incremental indexing, extraction diagnostics, and execution-copy exclusion tests.
6. Validate ordinary-user flows, provider parity, cleanup, and recovery.
7. Consider MCP and semantic reranking only after usage evidence and evaluation gates exist.
