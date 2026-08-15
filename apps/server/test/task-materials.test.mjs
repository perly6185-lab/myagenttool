import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

import {
  MAX_TASK_MATERIAL_BYTES,
  createTaskMaterialService,
} from "../src/services/task-materials.mjs";

function fixture({ resolveLocalContentReference = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), "myagenttool-task-materials-"));
  const stateStorePath = join(root, "state", "snapshot.json");
  const state = { taskMaterialDrafts: [] };
  let sequence = 0;
  const events = [];
  const service = createTaskMaterialService({
    state,
    stateStorePath,
    now: () => "2026-08-05T10:00:00.000Z",
    nextId: (prefix) => `${prefix}_${++sequence}`,
    persistStateSoon: () => {},
    appendEvent: (event) => events.push(event),
    resolveLocalContentReference,
  });
  return { root, stateStorePath, state, service, events, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const actor = { userId: "usr_1", teamId: "team_1", deviceId: "device_1" };

test("task materials survive draft creation, claim, and verified worktree materialization", async () => {
  const fx = fixture();
  try {
    const created = fx.service.createDraft({ projectId: "project_1" }, actor);
    assert.equal(created.status, 201);
    const draftId = created.body.draft.id;
    const uploaded = await fx.service.uploadFile({
      draftId,
      fileId: "browser-file-1",
      name: "客户 反馈.md",
      contentType: "text/markdown",
    }, Readable.from(Buffer.from("safe reference")), actor);
    assert.equal(uploaded.status, 201);
    assert.equal(uploaded.body.draft.assets[0].originalName, "客户 反馈.md");
    assert.equal(uploaded.body.draft.assets[0].size, 14);

    const claimed = fx.service.claimDraft({
      draftId,
      expectedRevision: uploaded.body.draft.revision,
      workItemId: "work_1",
      terminalId: "device_1",
    }, actor);
    assert.equal(claimed.ok, true);
    assert.match(claimed.assets[0].path, /^\.myagenttool\/inputs\/work_1\//);
    assert.equal(claimed.assets[0].mimeType, "text/markdown");
    fx.state.workItems = [{ id: "work_1", ownerTeamId: "team_1", inputAssets: claimed.assets }];

    const restorable = fx.service.resolveClaimedAsset({ workItemId: "work_1", assetId: claimed.assets[0].id, terminalId: "device_1" }, actor);
    assert.equal(restorable.ok, true);
    assert.equal(restorable.asset.originalName, "客户 反馈.md");
    assert.equal(fx.service.resolveClaimedAsset({ workItemId: "work_1", assetId: claimed.assets[0].id }, { ...actor, teamId: "team_2" }).ok, false);

    const readable = fx.service.readContent({ workItemId: "work_1", assetId: claimed.assets[0].id }, actor);
    assert.equal(readable.status, 200);
    assert.equal(readable.bytes.toString("utf8"), "safe reference");
    assert.equal(fx.service.readContent({ workItemId: "work_1", assetId: claimed.assets[0].id }, { ...actor, teamId: "team_2" }).status, 404);

    const worktreePath = join(fx.root, "worktree");
    mkdirSync(worktreePath, { recursive: true });
    const prepared = await fx.service.materialize({ workItemId: "work_1", worktree: { id: "wt_1", path: worktreePath } });
    assert.equal(prepared.ok, true);
    assert.equal(readFileSync(join(worktreePath, prepared.assets[0].path), "utf8"), "safe reference");
    assert.equal(readFileSync(join(worktreePath, ".myagenttool", "inputs", "work_1", ".gitignore"), "utf8"), "*\n!.gitignore\n");

    // Removing a reference from the work item keeps the private source available,
    // while preventing future executions from copying it into a new worktree.
    fx.state.workItems[0].inputAssets = [];
    const nextWorktreePath = join(fx.root, "next-worktree");
    mkdirSync(nextWorktreePath, { recursive: true });
    const preparedAfterRemoval = await fx.service.materialize({ workItemId: "work_1", worktree: { id: "wt_2", path: nextWorktreePath } });
    assert.equal(preparedAfterRemoval.ok, true);
    assert.deepEqual(preparedAfterRemoval.assets, []);
    assert.equal(existsSync(join(nextWorktreePath, claimed.assets[0].path)), false);
  } finally {
    fx.cleanup();
  }
});

test("local content references reuse the task materializer and produce a provider-neutral manifest", async () => {
  const bytes = Buffer.from("authoritative local content", "utf8");
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const fx = fixture({
    resolveLocalContentReference: async ({ contentId, projectId }) => ({
      ok: true,
      sourceType: "bytes",
      bytes,
      size: bytes.length,
      sha256: digest,
      originalName: "source.md",
      record: { id: contentId, kind: "article", title: "Source", projectId, workItemId: "source_task", mimeType: "text/markdown", storageMode: "referenced" },
    }),
  });
  try {
    fx.state.workItems = [{
      id: "work_refs",
      ownerTeamId: "team_1",
      projectId: "project_1",
      terminalId: "device_1",
      inputAssets: [],
      localContentRefs: [{ id: "wcr_1", contentId: `lc_${"a".repeat(32)}`, purpose: "required_input", selectedFingerprint: digest }],
    }];
    const worktreePath = join(fx.root, "reference-worktree");
    mkdirSync(worktreePath, { recursive: true });
    const prepared = await fx.service.materialize({ workItemId: "work_refs", worktree: { id: "wt_refs", path: worktreePath }, actor });
    assert.equal(prepared.ok, true);
    assert.equal(prepared.assets.length, 1);
    assert.equal(prepared.assets[0].contentId, `lc_${"a".repeat(32)}`);
    assert.equal(readFileSync(join(worktreePath, prepared.assets[0].path), "utf8"), bytes.toString("utf8"));
    assert.equal(prepared.receipts[0].sourceFingerprint, digest);
    assert.match(prepared.manifest.fingerprint, /^sha256:[a-f0-9]{64}$/);
    const manifest = JSON.parse(readFileSync(join(worktreePath, prepared.manifest.path), "utf8"));
    assert.equal(manifest.entries[0].trust, "untrusted_reference");
    assert.equal(JSON.stringify(manifest).includes(fx.root), false);
  } finally {
    fx.cleanup();
  }
});

test("an unavailable optional library reference is reported and omitted without blocking required inputs", async () => {
  const bytes = Buffer.from("required content", "utf8");
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const fx = fixture({
    resolveLocalContentReference: async ({ contentId }) => contentId.endsWith("b".repeat(32))
      ? { ok: false, error: "local_content_original_missing" }
      : {
          ok: true,
          sourceType: "bytes",
          bytes,
          size: bytes.length,
          sha256: digest,
          originalName: "required.txt",
          record: { id: contentId, kind: "task_input", title: "Required", mimeType: "text/plain", storageMode: "managed" },
        },
  });
  try {
    fx.state.workItems = [{
      id: "work_optional",
      ownerTeamId: "team_1",
      inputAssets: [],
      localContentRefs: [
        { id: "required", contentId: `lc_${"a".repeat(32)}`, purpose: "required_input", title: "Required" },
        { id: "optional", contentId: `lc_${"b".repeat(32)}`, purpose: "reference", title: "Optional" },
      ],
    }];
    const worktreePath = join(fx.root, "optional-worktree");
    mkdirSync(worktreePath, { recursive: true });
    const prepared = await fx.service.materialize({ workItemId: "work_optional", worktree: { id: "wt_optional", path: worktreePath }, actor });
    assert.equal(prepared.ok, true);
    assert.equal(prepared.assets.length, 1);
    assert.deepEqual(prepared.skippedReferences, [{
      referenceId: "optional",
      contentId: `lc_${"b".repeat(32)}`,
      title: "Optional",
      reason: "local_content_original_missing",
    }]);
  } finally {
    fx.cleanup();
  }
});

test("task material upload is bounded and a file id is idempotent", async () => {
  const fx = fixture();
  try {
    const draft = fx.service.createDraft({ projectId: "project_1" }, actor).body.draft;
    const first = await fx.service.uploadFile({ draftId: draft.id, fileId: "same", name: "one.txt" }, Readable.from(Buffer.from("one")), actor);
    const replay = await fx.service.uploadFile({ draftId: draft.id, fileId: "same", name: "one.txt" }, Readable.from(Buffer.from("one")), actor);
    assert.equal(first.status, 201);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.draft.assets.length, 1);
    const conflict = await fx.service.uploadFile({ draftId: draft.id, fileId: "same", name: "changed.txt" }, Readable.from(Buffer.from("changed")), actor);
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error, "task_material_file_id_conflict");

    const other = fx.service.createDraft({ projectId: "project_1" }, actor).body.draft;
    const oversized = await fx.service.uploadFile({ draftId: other.id, fileId: "large", name: "large.txt" }, Readable.from(Buffer.alloc(MAX_TASK_MATERIAL_BYTES + 1)), actor);
    assert.equal(oversized.status, 413);
    assert.equal(oversized.body.error, "task_material_file_too_large");
  } finally {
    fx.cleanup();
  }
});

test("task material drafts are team isolated and revision guarded", async () => {
  const fx = fixture();
  try {
    const draft = fx.service.createDraft({ projectId: "project_1" }, actor).body.draft;
    assert.equal(fx.service.getDraft({ draftId: draft.id }, { ...actor, teamId: "team_2" }).status, 404);
    const upload = await fx.service.uploadFile({ draftId: draft.id, fileId: "file", name: "one.txt" }, Readable.from(Buffer.from("one")), actor);
    const assetId = upload.body.draft.assets[0].id;
    const conflict = fx.service.removeFile({ draftId: draft.id, assetId, expectedRevision: 0 }, actor);
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error, "task_material_revision_conflict");
  } finally {
    fx.cleanup();
  }
});

test("local material cleanup is preview guarded and protects active task materials", async () => {
  const fx = fixture();
  try {
    const completedDraft = fx.service.createDraft({ projectId: "project_1" }, actor).body.draft;
    const completedUpload = await fx.service.uploadFile({
      draftId: completedDraft.id,
      fileId: "completed-file",
      name: "completed.txt",
    }, Readable.from(Buffer.from("completed material")), actor);
    const completedClaim = fx.service.claimDraft({
      draftId: completedDraft.id,
      expectedRevision: completedUpload.body.draft.revision,
      workItemId: "work_completed",
      terminalId: "device_1",
    }, actor);

    const activeDraft = fx.service.createDraft({ projectId: "project_1" }, actor).body.draft;
    const activeUpload = await fx.service.uploadFile({
      draftId: activeDraft.id,
      fileId: "active-file",
      name: "active.txt",
    }, Readable.from(Buffer.from("active material")), actor);
    const activeClaim = fx.service.claimDraft({
      draftId: activeDraft.id,
      expectedRevision: activeUpload.body.draft.revision,
      workItemId: "work_active",
      terminalId: "device_1",
    }, actor);

    fx.state.workItems = [
      {
        id: "work_completed",
        ownerTeamId: "team_1",
        state: "closed",
        status: "done",
        updatedAt: "2026-06-01T10:00:00.000Z",
        inputAssets: completedClaim.assets,
      },
      {
        id: "work_active",
        ownerTeamId: "team_1",
        state: "open",
        status: "running",
        updatedAt: "2026-08-05T09:00:00.000Z",
        inputAssets: activeClaim.assets,
      },
    ];

    const preview = fx.service.cleanupPreview(actor);
    assert.equal(preview.reclaimableBytes, Buffer.byteLength("completed material"));
    assert.equal(preview.fileCount, 1);
    assert.equal(preview.draftCount, 1);
    assert.equal(preview.completedTaskCount, 1);
    assert.equal(preview.expiredDraftCount, 0);
    assert.equal(fx.service.cleanupPreview({ ...actor, teamId: "team_2" }).reclaimableBytes, 0);

    fx.state.taskMaterialDrafts.find((draft) => draft.id === completedDraft.id).revision += 1;
    const stale = fx.service.executeCleanup({ previewToken: preview.previewToken }, actor);
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error, "task_material_cleanup_preview_stale");
    assert.equal(fx.service.readContent({ workItemId: "work_completed", assetId: completedClaim.assets[0].id }, actor).status, 200);

    const cleaned = fx.service.executeCleanup({ previewToken: stale.body.preview.previewToken }, actor);
    assert.equal(cleaned.status, 200);
    assert.equal(cleaned.body.reclaimedBytes, Buffer.byteLength("completed material"));
    assert.equal(cleaned.body.fileCount, 1);
    assert.equal(cleaned.body.draftCount, 1);
    assert.equal(cleaned.body.usage.reclaimableBytes, 0);
    assert.equal(cleaned.body.usage.usedBytes, Buffer.byteLength("active material"));
    assert.equal(fx.state.taskMaterialDrafts.find((draft) => draft.id === completedDraft.id)?.status, "purged");
    assert.equal(fx.service.readContent({ workItemId: "work_completed", assetId: completedClaim.assets[0].id }, actor).status, 404);
    assert.equal(fx.service.readContent({ workItemId: "work_active", assetId: activeClaim.assets[0].id }, actor).status, 200);

    const restarted = createTaskMaterialService({
      state: fx.state,
      stateStorePath: fx.stateStorePath,
      now: () => "2026-08-05T10:00:00.000Z",
      nextId: (prefix) => `${prefix}_after_restart`,
    });
    assert.equal(restarted.cleanupPreview(actor).reclaimableBytes, 0);
    assert.equal(restarted.readContent({ workItemId: "work_active", assetId: activeClaim.assets[0].id }, actor).status, 200);
  } finally {
    fx.cleanup();
  }
});
