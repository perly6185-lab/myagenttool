# Task Material Inbox Experience

Date: 2026-08-05

Status: implemented

## Outcome

An ordinary user can add reference files while creating a tracked task even when no worktree exists. The system stores those files as durable task inputs, prepares them automatically when AI starts, and keeps worktree, storage, routing, and trace concepts out of the ordinary flow.

The ordinary path is:

`Add files → create task → AI prepares a safe workspace → AI reads copied reference files → user reviews the result`

The user must never be asked to create, select, or understand a worktree merely to attach a file.

## Product principles

1. **A file belongs to the task, not to a worktree.** A worktree is an execution detail that may not exist yet and may be replaced on retry.
2. **Task creation remains the primary action.** File upload is progressive disclosure and must not turn the Home composer into a document-management screen.
3. **No silent loss.** A task is never created with a failed file silently omitted. The user must retry or explicitly remove the failed file.
4. **Creation and AI start are separate outcomes.** If workspace preparation fails, the durable task and its materials remain available and the user gets an ordinary-language retry action.
5. **Private source, disposable copy.** The platform keeps one private immutable source copy and materializes a verified, ignored copy into each execution workspace.
6. **Untrusted reference data.** Attachments may contain prompt injection or active content. They are never treated as trusted instructions or executed merely because they were attached.

## Ordinary-user interface

### Home task composer

Keep the entry in the existing progressive area, renamed consistently as **Completion criteria and references**. A small paperclip action may also sit below the task description and open the same area.

When expanded, the order is:

1. Definition of done.
2. Drop zone: **Drop files here or choose files**.
3. File chips with name, size, and one plain-language state: Uploading, Ready, Needs retry, or Removed.
4. A quiet limit note: up to 6 files, 5 MB each.

Do not show worktree, local path, terminal, asset ID, hash, storage provider, or capability terms.

The primary buttons behave as follows:

| State | Create task | Create and let AI work |
| --- | --- | --- |
| No files | Enabled when the task goal and date are valid. | Same. |
| Files uploading | Disabled with “Finishing file upload…” | Same. |
| Every file ready | Enabled. | Enabled. |
| One or more files failed | Disabled; focus the failed chips and offer Retry or Remove. | Same. |
| Server offline | Existing offline guidance; selected browser files remain in the composer until reload. | Same. |

### Task details

Simple details show an always-visible **Reference files** section, separate from Comments:

- name and readable size;
- Ready, Preparing, or Needs attention;
- selecting files uploads and adds them to the task automatically, with no second confirmation;
- add more files when the task is not completed;
- Preview, Download, and Remove use visible text labels rather than icon-only controls;
- removal is immediately reversible with an eight-second Undo action;
- when AI is already running, the section explains before the action that the current run is unchanged and the change applies when the user reruns the task;
- a completed task provides **Reopen task** beside the explanation instead of hiding the only recovery path.

Preview and download remain secondary actions. Technical provenance stays in Expert details.

Existing-task behavior is state-aware:

| Task state | Add or remove | Effect |
| --- | --- | --- |
| Not started | Allowed | Used by the next AI execution. |
| AI running | Allowed with a plain notice | The current private copy is unchanged; the change applies to the next execution. |
| Ready for review | Allowed | Used when the user requests another AI pass. |
| Completed | Read/download only | Reopen the task before changing its reference set. |

### AI working and recovery

The ordinary running card may say **Preparing reference files** briefly before **AI is working**. It must not expose materialization, filesystem paths, or worktree creation.

If preparation fails:

- keep the tracked task and uploaded source files;
- do not start the invocation;
- show: **AI could not prepare one or more reference files. Your task and files are safe.**
- primary action: **Try preparing files again**;
- secondary action: **Review files**;
- retain Technical details as an escalation, not the default recovery path.

## System design

### Storage location

Raw task materials live beside the platform state store, never inside a user repository or a not-yet-created worktree:

```text
<state-dir>/task-materials/
  <team-key>/
    <project-key>/
      <draft-id>/
        <asset-id>--<safe-name>
```

`team-key` and `project-key` are server-derived safe hashes, not raw user input. Directories use owner-only permissions where supported. The state snapshot stores bounded metadata only; raw bytes never enter JSON or SQLite state rows.

When execution begins, verified copies are created under the execution worktree:

```text
<worktree>/.myagenttool/inputs/<work-item-id>/<asset-id>--<safe-name>
```

The inputs directory contains a self-contained `.gitignore`, is path-confined, and is excluded from diffs, commits, delivery, and cleanup promotion. The private source remains immutable so a retry or replacement worktree receives the same bytes.

### Durable metadata

Add a persisted `taskMaterialDrafts` collection. Each record contains only bounded metadata:

```ts
type TaskMaterialDraft = {
  id: string;
  ownerTeamId: string;
  projectId: string;
  terminalId: string;
  createdBy: string;
  status: "draft" | "claimed" | "expired";
  revision: number;
  workItemId: string | null;
  assets: Array<{
    id: string;
    originalName: string;
    storedName: string;
    family: string;
    mimeType: string | null;
    size: number;
    hash: string;
    resourceClass: "small" | "medium" | "large";
    activeContent: boolean;
    readiness: "ready" | "failed";
  }>;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
};
```

The public Work Item continues to expose normalized `inputAssets`, but the server derives their execution-relative paths only after the draft is atomically claimed by the new Work Item. The private storage locator is never returned to the browser.

### API contract

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/projects/:projectId/task-material-drafts` | Create or replay one user-owned draft with a client idempotency key. |
| `PUT` | `/api/projects/:projectId/task-material-drafts/:draftId/files/:clientFileId?name=…` | Stream one bounded file; server classifies, hashes, stores atomically, and advances the draft revision. |
| `DELETE` | `/api/projects/:projectId/task-material-drafts/:draftId/files/:assetId` | Remove one unclaimed material with expected revision. |
| `GET` | `/api/projects/:projectId/task-material-drafts/:draftId` | Recover upload state after a retriable request failure. |
| `POST` | `/api/work-items` | Existing creation API gains `materialDraftId` and `materialDraftRevision`; creation atomically claims the draft. |
| `POST` | `/api/work-items/:id/materials` | Add materials directly to an existing task, subject to execution-state rules. |
| `DELETE` | `/api/work-items/:id/materials/:assetId` | Remove a material when safe, or record that removal applies only to future execution. |
| `POST` | `/api/work-items/:id/materials/:assetId/restore` | Restore a recently removed material from its retained private source. |
| `GET` | `/api/work-items/:id/materials/:assetId/content` | Tenant-checked inline preview for safe formats; `download=1` forces download. |

File upload uses a raw bounded request body rather than base64 JSON. This avoids a 33% size increase and prevents the generic unbounded `readJson` path from receiving large payloads. Upload idempotency is scoped to team, project, draft, and client file ID.

Task creation and draft claiming occur in one server transaction. A duplicate create request returns the same Work Item. A create failure leaves the draft ready for retry.

### Execution preparation

Insert `materializeWorkItemInputs(workItemId, worktreeId)` after Auto-run creates the worktree and before it creates the invocation:

1. Resolve the Work Item, claimed material draft, owning team, project, and terminal.
2. Refuse any ownership or terminal mismatch.
3. Re-read each private source and verify its stored SHA-256 hash.
4. Create the confined ignored input directory without following symlinks.
5. Copy atomically, verify destination hash, and record the execution-relative path.
6. Append a bounded audit event with IDs and hashes, never raw bytes or absolute paths.
7. Add a plain prompt section naming the reference files and explicitly treating them as untrusted data rather than instructions.
8. Only then create and start the invocation.

The same materializer is reused by retries and any future application execution path. A retry into the same worktree is idempotent; a new worktree receives fresh verified copies from the private source.

### Security and lifecycle

- Preserve the current 6-file and 5-MB-per-file limits for the first release.
- Keep the ordinary limits concrete: 6 files per upload set and 5 MB per file.
- Enforce one local material-store ceiling in the background (1 GiB by default, configurable with `MYAGENTTOOL_TASK_MATERIAL_CAP_BYTES`). This is device storage governance, not a team concept in the single-terminal experience.
- Keep team/project keys for isolation and future shared deployment, but do not show team capacity in the ordinary task flow.
- Sanitize display names; server-generated storage names prevent collisions and traversal.
- Reject empty files, filesystem-special files, archives in the first release, and binary executable formats.
- Allow source-code text as reference data but classify active content; never execute it automatically.
- Validate signatures for images and Office files where a reliable signature exists.
- Use create-exclusive writes, temporary files plus atomic rename, symlink checks, and realpath confinement.
- Unclaimed drafts expire after 24 hours and are removed by a bounded startup/interval sweeper.
- Claimed sources remain while the task is active and for the configured retention period after completion. Explicit deletion is audited.
- Record draft creation, upload, claim, materialization, removal, expiry, and integrity failure events.
- Never include material contents in task events, traces, logs, state snapshots, or error responses.

## Failure behavior

| Failure | User experience | System behavior |
| --- | --- | --- |
| One upload fails | Failed chip offers Retry and Remove. Creation stays disabled. | Other successful files remain; the same file ID can be retried idempotently. |
| Connection drops after upload | Show “Checking upload…” then recover draft state. | `GET` draft resolves whether the server committed the file. |
| Task creation fails | Keep the full composer and ready files. | Draft remains unclaimed and reusable. |
| Create succeeds but AI start fails | Show the existing partial-success task receipt. | Work Item and claimed materials remain canonical. |
| Material source hash mismatch | Show safe preparation failure and retry guidance. | Do not start AI; emit a high-severity integrity event. |
| Worktree copy fails | Keep task and files safe; offer retry. | Clean incomplete temporary copy; no invocation is created. |
| User retries AI | No re-upload required. | Re-verify and re-materialize from the immutable private source. |
| Draft expires while composer is open | Explain that files need to be uploaded again; keep the task text. | Expired draft cannot be claimed. |

## Next ordinary-user improvement: reassurance and direct action

### Outcome

The next iteration must answer three questions in the same place where the user acts:

1. **Did my file join the task?**
2. **Will it affect the AI that is running now?**
3. **What should I do next?**

The ordinary path becomes:

`Choose files → see local progress → file joins automatically → see exact effect → take the next valid action in the same section`

Do not add storage, execution, draft, or revision terminology to this flow.

### Reference-section states

| State | Presentation | Primary action | Required explanation |
| --- | --- | --- | --- |
| No files, task open | Compact one-row section with a short purpose sentence | **Add material** | “Give AI background it should use for this task.” |
| Selecting or uploading | Expand in place; show each file and real progress | **Cancel upload** per active file | No task change has happened yet. |
| Added, AI not running | Show the file and a local success banner | **Undo add** for eight seconds | AI uses it when this task is processed. |
| AI running | Keep the list visible and show a calm information banner | No duplicate-run action while a run is active | This run is unchanged; the update is saved for a later rerun. |
| Ready for review with material changes | Place the next action beside the material notice | **Use new material and process again** | The current result remains available and a new AI pass will start. |
| Failed with material changes | Keep the failure recovery local | **Retry with current material** | Existing files do not need uploading again. |
| Completed | Read/download remains available; changes are gated | **Reopen task** | Reopening moves the task to in progress, preserves the result/history, and does not start AI automatically. |
| Format cannot preview | Keep the file healthy and actionable | **Download** | Show “This format supports download only”; do not silently omit Preview. |

Never show a clickable rerun action while another run is active. When the run reaches review or failure, replace the information-only state with the valid contextual action.

### Local feedback

- Addition, removal, restore, retry, and failure feedback live inside the Reference materials section, directly below the affected file.
- Use the concrete filename: **brief.txt added to this task**.
- Follow with the effect: **This AI run is unchanged. Use the new material when you process the task again.**
- Global task notices may mirror the result for screen readers, but must not be the only visible confirmation.
- The eight-second Undo action is a convenience, not the only recovery path; Remove and Add remain available afterward.

### Upload cancellation and reconciliation

The upload client adds one `AbortController` per file and passes its signal through `requestRaw`. Cancel immediately changes the local file state to **Canceled** and leaves the task unchanged.

Because aborting a request does not prove that the server stopped before committing:

1. Re-read the draft after cancellation.
2. If the canceled client file ID was committed, delete that draft asset with its current revision.
3. If reconciliation is temporarily unavailable, show **Checking cancellation…** and retry idempotently.
4. Never claim a draft while a file is uploading, canceled-but-unreconciled, or failed.

### Reopen confirmation

**Reopen task** opens a short confirmation dialog rather than mutating business state immediately:

- heading: **Reopen this task to change its materials?**
- explanation: **The task returns to In progress. Existing results and history stay available. AI will not start until you choose to process the task again.**
- primary: **Reopen task**;
- secondary: **Keep completed**.

After confirmation, preserve scroll position, replace the button with **Add material**, and announce the local result in the section.

### Preview behavior

- Preview safe text, image, JSON, and PDF content in a task-scoped drawer on desktop and a full-screen sheet on small screens.
- Keep the task title and filename in the preview header.
- Escape returns focus to the same Preview button.
- Download remains available inside the preview.
- Formats that cannot render safely show a visible **Download only** label.

### Local storage management

Storage management stays outside the ordinary task details until capacity is exhausted. The capacity error adds a secondary **Manage local space** link to operator settings.

The settings flow separates:

- current usage and configured ceiling;
- space that is safe to reclaim now;
- active-task material that cannot be removed automatically;
- completed-task material past retention, with explicit impact and confirmation.

Cleanup uses preview/execute semantics. It may remove expired unclaimed drafts and completed-task sources past retention, but never active-task sources or current execution copies.

### Implementation batches

#### Improvement batch A — local clarity and business-state safety

- Keep the zero-material state compact while preserving the always-visible heading and Add action.
- Move all material feedback into the section and include the filename and effect.
- Add visible **Download only** treatment.
- Add the Reopen confirmation dialog and preserve results/history.
- Add state-aware contextual actions for review-ready and failed tasks; never offer a duplicate run while active.

Exit gate: a first-time user can state whether a file was added, whether the current run changed, and what valid action comes next without leaving the section.

#### Improvement batch B — cancellation, undo, and contextual preview

- Add abort signals, per-file Cancel, draft reconciliation, and **Checking cancellation…** recovery.
- Add eight-second Undo after automatic attachment, backed by the existing remove/restore services.
- Replace new-tab preview with the task-scoped drawer/sheet and restore keyboard focus on close.
- Cover multiple files, partial failure, cancellation races, narrow screens, keyboard-only use, and screen-reader announcements.

Exit gate: choosing a wrong file is recoverable before or after upload without refresh, route changes, or an ambiguous server state.

#### Improvement batch C — self-service local capacity

- Expose local usage and safely reclaimable bytes to operator settings.
- Add cleanup preview and confirmed execution APIs with audit records.
- Link capacity failures to the management screen without showing team quota concepts.
- Test active-task protection, retention boundaries, interrupted cleanup, and restart recovery.

Exit gate: a local operator can understand and safely recover material capacity without deleting repository files or breaking an active task.

### Implementation status — 2026-08-05

- **A complete:** material feedback is local and filename-specific; completion reopening is confirmed; download-only, review rerun, and failed-run recovery states are explicit.
- **B complete:** upload cancellation reconciles server state, newly added material has an eight-second Undo action, and safe previews stay inside the task detail.
- **C complete:** settings exposes local usage and reclaimable space, cleanup uses preview/confirmed execution, active-task sources are protected, and capacity failures link directly to local storage management.
- **Validation complete:** service and web type checks, complete service unit and HTTP integration suites, complete web tests, production build, and documentation link checks pass.

### Follow-up ordinary-user usability pass — 2026-08-05

- Capacity recovery now stays inside the task: the user previews safe cleanup, confirms it, and the selected file retries automatically without route changes or reselection.
- If no space is safe to reclaim, the explanation distinguishes active/retained materials from a system failure and warns before the user leaves for full storage settings.
- Review-ready actions say **current material** or **updated material** truthfully, and the eight-second attachment Undo window is visible while it is available.

### Second interaction and comprehension pass — 2026-08-05

- The material-specific review rerun is now conditional on a persisted post-execution material change. Ordinary review keeps one clear decision path when nothing changed, while refreshes cannot lose a real pending change.
- Starting a new execution consumes the current material snapshot and clears the pending-change signal; later add, remove, or restore actions set it again.
- Cleanup previews now separate completed tasks past retention from expired unfinished uploads, both inside task recovery and in full local-storage settings, before an irreversible cleanup is confirmed.
- English cleanup counts use scan-friendly labels instead of fragile singular/plural sentences; Chinese scope copy remains explicit about the two deletion sources.

### Completion-flow interaction pass — 2026-08-05

- Completed Simple details now use one completion receipt and one result toggle. The generic progress card and duplicate completion notice are removed after the task closes.
- The detail-dialog description changes from progress guidance to final-result and confirmation guidance once completion is loaded, so the header no longer implies unfinished work.
- A dedicated completed-task browser scenario verifies the receipt, the single result action, the expanded delivery, and no horizontal overflow at desktop and 390-px mobile widths.
- Review-ready tasks only offer a material-specific rerun when a persisted material change is actually waiting; unchanged material no longer creates an unnecessary decision.

### Acceptance and measurement

- No ordinary material action relies only on a global toast or icon-only control.
- No running task offers an invalid or duplicate AI-start action.
- Reopening explicitly states all three effects: status changes, results remain, AI does not auto-start.
- Cancel/reconcile tests prove that a canceled file cannot be claimed silently.
- A 390-px viewport has no horizontal overflow and keeps the next action visible.
- At least 90% of first-time usability participants correctly predict whether a material change affects the current run.
- At least 95% complete add, cancel, remove/undo, and process-again tasks without entering Expert details.

## Initial development plan (implemented)

### Batch 1 — storage and domain foundation

Deliverables:

- Add `taskMaterialDrafts` to the state factory, durable persistence registry, restore/backfill validation, tenancy audit, and snapshot limits.
- Add `services/task-materials.mjs` for draft ownership, local storage capacity, bounded streaming upload, content classification, atomic storage, removal, claim, and cleanup.
- Add the dedicated task-material routes and client API types.
- Reuse platform `stateStorePath` to derive the private material root.
- Add unit and integration tests for traversal, symlinks, duplicate file IDs, hash conflicts, quotas, expiry, tenancy, terminal ownership, and restart persistence.

Exit gate: a project with no worktree can create a material draft, upload files, restart the server, and recover identical metadata and hashes.

### Batch 2 — ordinary task creation

Deliverables:

- Replace the Home composer's worktree-backed attachment state with a dedicated `TaskMaterialPicker` that stores browser `File` objects only until streamed.
- Create the draft lazily when the first file is selected.
- Add upload progress, Retry, Remove, drag/drop, accessible announcements, and clear limits.
- Extend Work Item creation with atomic `materialDraftId` claiming and canonical `inputAssets` projection.
- Remove `worktreeId` and `terminalId` requirements from the ordinary Home composer.
- Preserve the current create-only, create-and-AI, partial-success, and idempotency behavior.

Exit gate: a first-time ordinary user can create a task with files while the project has zero worktrees, without seeing technical terminology.

### Batch 3 — automatic execution preparation and recovery

Deliverables:

- Add the shared confined materializer and call it between worktree creation and invocation creation.
- Bind materialization evidence to the Work Item, Auto-run, invocation, terminal, and worktree.
- Add the untrusted-reference prompt block and active-content handling.
- Make retry idempotently reuse the private source.
- Project preparation failures into ordinary Work Item status and expose Retry preparation from Simple details.
- Ensure no partial material copy can enter a diff, commit, or delivery.

Exit gate: the AI can read every attached file from its generated worktree; deleting that worktree and retrying produces byte-identical inputs without another upload.

### Batch 4 — task-detail lifecycle, cleanup, and release QA

Deliverables:

- Add Reference files management to Simple details and complete provenance to Expert Assets.
- Add safe rules for adding/removing files before, during, and after execution.
- Keep local storage reporting in operator settings and add the unclaimed-draft cleanup sweep; do not add a team-capacity card to ordinary task details.
- Extend browser Visual QA with no-worktree upload, mobile failure recovery, review-ready output, and completed-task retention scenarios.
- Add migration and rollback behavior: old worktree-backed `inputAssets` remain readable; the feature can be disabled for new uploads without breaking existing tasks.
- Update operator documentation and retention configuration.

Exit gate: desktop and 390-px mobile complete upload → create → AI start → review → complete without horizontal overflow, route detours, hidden decisions, or worktree terminology.

## Test matrix

The release suite must cover:

- ordinary create-only and create-and-AI with zero worktrees;
- one, six, empty, oversized, duplicate, renamed, active-content, and invalid-signature files;
- partial upload, lost response, repeated request, repeated task creation, and expired draft;
- different team, project, user, and terminal access attempts;
- server restart between upload and task creation;
- worktree creation failure, copy failure, source/destination hash mismatch, and retry into a new worktree;
- task detail add/remove rules for not-started, running, review-ready, and completed states;
- screen reader status announcements, keyboard file removal, focus restoration, and 390-px layout;
- confirmation that material files never appear in Git diff, PR delivery, event payloads, logs, or state snapshots.

## Success measures

- At least 95% of successfully uploaded drafts create a task without another upload.
- Zero ordinary attachment attempts are blocked solely because no worktree exists.
- Zero material bytes or absolute storage paths appear in durable state, logs, or browser payloads outside the upload/download response.
- Preparation failures preserve 100% of successfully claimed source materials and always provide an ordinary recovery action.
- Median ordinary path adds no more than one extra interaction when files are used and no extra interaction when they are not.

## Recommended sequencing

Implement the four batches in order. Batch 1 and the atomic claim contract are hard prerequisites; beginning with UI alone would preserve the current worktree dependency under a different label. Batch 3 must land before enabling the new upload path by default, because accepting durable files without guaranteed execution materialization would create a misleading success state.
