import {
  createHash,
  randomUUID,
} from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { LOCAL_TEAM_ID } from "../runtime/auth.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";

export const MAX_TASK_MATERIALS = 6;
export const MAX_TASK_MATERIAL_BYTES = 5 * 1024 * 1024;
export const MAX_TASK_MATERIAL_TOTAL_BYTES = 30 * 1024 * 1024;
const DRAFT_TTL_MS = 24 * 60 * 60 * 1_000;
const SAFE_NAME_FALLBACK = "reference-file";
const DEFAULT_LOCAL_STORE_CAP_BYTES = 1024 * 1024 * 1024;
const DEFAULT_COMPLETED_RETENTION_DAYS = 30;

const MIME_FAMILIES = new Map([
  [".txt", "text"], [".md", "text"], [".csv", "text"], [".json", "text"],
  [".js", "code"], [".ts", "code"], [".tsx", "code"], [".jsx", "code"],
  [".py", "code"], [".java", "code"], [".go", "code"], [".rs", "code"],
  [".png", "image"], [".jpg", "image"], [".jpeg", "image"], [".webp", "image"],
  [".pdf", "document"], [".docx", "document"], [".xlsx", "document"],
]);

function safeName(value) {
  const normalized = String(value ?? "")
    .replace(/[\\/\0\r\n]+/g, " ")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 120);
  return normalized || SAFE_NAME_FALLBACK;
}

function safeKey(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, 24);
}

function familyFor(name, contentType) {
  const extension = extname(name).toLowerCase();
  if (MIME_FAMILIES.has(extension)) return MIME_FAMILIES.get(extension);
  if (String(contentType ?? "").startsWith("text/")) return "text";
  if (String(contentType ?? "").startsWith("image/")) return "image";
  return "unknown";
}

function resourceClassFor(size) {
  if (size <= 256 * 1024) return "small";
  if (size <= 2 * 1024 * 1024) return "medium";
  return "large";
}

function actorTeam(actor) {
  return actor?.teamId ?? LOCAL_TEAM_ID;
}

function publicDraft(draft) {
  return {
    id: draft.id,
    ownerTeamId: draft.ownerTeamId,
    projectId: draft.projectId,
    status: draft.status,
    revision: draft.revision,
    workItemId: draft.workItemId ?? null,
    assets: (draft.assets ?? []).map((asset) => ({
      id: asset.id,
      clientFileId: asset.clientFileId,
      originalName: asset.originalName,
      family: asset.family,
      mimeType: asset.mimeType,
      size: asset.size,
      hash: asset.hash,
      resourceClass: asset.resourceClass,
      activeContent: asset.activeContent,
      readiness: asset.readiness,
    })),
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    expiresAt: draft.expiresAt,
  };
}

function materialRoot(stateStorePath) {
  return resolve(dirname(stateStorePath), "task-materials");
}

function ensurePrivateDirectory(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (lstatSync(path).isSymbolicLink()) throw new Error("task_material_directory_symlink");
}

function ensureDirectoryChain(base, parts) {
  ensurePrivateDirectory(base);
  let cursor = base;
  for (const part of parts) {
    cursor = join(cursor, part);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new Error("task_material_directory_symlink");
    ensurePrivateDirectory(cursor);
  }
  return cursor;
}

function bodyBuffer(req, limit) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        const error = new Error("task_material_file_too_large");
        error.code = "task_material_file_too_large";
        fail(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolveBody(Buffer.concat(chunks));
    });
    req.on("error", fail);
  });
}

export function createTaskMaterialService({ state, stateStorePath, now, nextId, persistStateSoon = () => {}, appendEvent = () => {}, store }) {
  const root = materialRoot(stateStorePath);
  const runTx = makeRunTx({ store, persistStateSoon });
  const configuredCap = Math.floor(Number(process.env.MYAGENTTOOL_TASK_MATERIAL_CAP_BYTES));
  const localStoreCapBytes = Number.isFinite(configuredCap) && configuredCap > 0
    ? configuredCap
    : DEFAULT_LOCAL_STORE_CAP_BYTES;
  const configuredRetentionDays = Math.floor(Number(process.env.MYAGENTTOOL_TASK_MATERIAL_RETENTION_DAYS));
  const completedRetentionDays = Number.isFinite(configuredRetentionDays) && configuredRetentionDays >= 0
    ? configuredRetentionDays
    : DEFAULT_COMPLETED_RETENTION_DAYS;

  function localUsageBytes() {
    return (state.taskMaterialDrafts ?? []).reduce((total, draft) => total + (draft.assets ?? []).reduce((sum, asset) => {
      const path = sourcePath(draft, asset);
      return sum + (existsSync(path) && statSync(path).isFile() ? statSync(path).size : 0);
    }, 0), 0);
  }

  function findDraft(draftId, actor, projectId = null) {
    const teamId = actorTeam(actor);
    return (state.taskMaterialDrafts ?? []).find((draft) => draft.id === String(draftId)
      && draft.ownerTeamId === teamId
      && (projectId == null || draft.projectId === String(projectId))) ?? null;
  }

  function createDraft({ projectId }, actor) {
    const teamId = actorTeam(actor);
    const id = nextId("tmd") || `tmd_${randomUUID()}`;
    const timestamp = now();
    const draft = {
      id,
      ownerTeamId: teamId,
      projectId: String(projectId ?? ""),
      terminalId: actor?.deviceId ?? null,
      createdBy: actor?.userId ?? "usr_local",
      status: "draft",
      revision: 0,
      workItemId: null,
      assets: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: new Date(Date.parse(timestamp) + DRAFT_TTL_MS).toISOString(),
    };
    ensureDirectoryChain(root, [safeKey(teamId), safeKey(draft.projectId), safeKey(id)]);
    runTx(() => (state.taskMaterialDrafts ??= []).unshift(draft));
    appendEvent({
      invocationId: null,
      type: "task_material_draft_created",
      level: "info",
      message: `Task material draft ${id} created.`,
      data: { draftId: id, projectId: draft.projectId, actorTeamId: teamId },
    });
    return { status: 201, body: { draft: publicDraft(draft) } };
  }

  function getDraft({ projectId, draftId }, actor) {
    const draft = findDraft(draftId, actor, projectId);
    if (!draft) return { status: 404, body: { error: "task_material_draft_not_found" } };
    if (draft.status === "draft" && Date.parse(draft.expiresAt) <= Date.parse(now())) {
      expireDraft(draft);
      return { status: 410, body: { error: "task_material_draft_expired" } };
    }
    return { status: 200, body: { draft: publicDraft(draft) } };
  }

  async function uploadFile({ projectId, draftId, fileId, name, contentType }, req, actor) {
    const draft = findDraft(draftId, actor, projectId);
    if (!draft) return { status: 404, body: { error: "task_material_draft_not_found" } };
    if (draft.status !== "draft") return { status: 409, body: { error: "task_material_draft_not_editable" } };
    if (Date.parse(draft.expiresAt) <= Date.parse(now())) {
      expireDraft(draft);
      return { status: 410, body: { error: "task_material_draft_expired" } };
    }
    const clientFileId = String(fileId ?? "").trim().slice(0, 120);
    if (!clientFileId) return { status: 400, body: { error: "task_material_file_id_required" } };
    const existing = draft.assets.find((asset) => asset.clientFileId === clientFileId);
    if (existing) {
      let replayBytes;
      try {
        replayBytes = await bodyBuffer(req, MAX_TASK_MATERIAL_BYTES);
      } catch (error) {
        return { status: error?.code === "task_material_file_too_large" ? 413 : 400, body: { error: error?.code ?? "task_material_upload_failed" } };
      }
      const replayHash = createHash("sha256").update(replayBytes).digest("hex");
      if (replayHash !== existing.hash) return { status: 409, body: { error: "task_material_file_id_conflict" } };
      return { status: 200, body: { draft: publicDraft(draft), asset: publicDraft({ assets: [existing] }).assets[0], replayed: true } };
    }
    if (draft.assets.length >= MAX_TASK_MATERIALS) return { status: 413, body: { error: "task_material_file_limit_exceeded" } };
    let bytes;
    try {
      bytes = await bodyBuffer(req, MAX_TASK_MATERIAL_BYTES);
    } catch (error) {
      return { status: error?.code === "task_material_file_too_large" ? 413 : 400, body: { error: error?.code ?? "task_material_upload_failed" } };
    }
    if (bytes.length === 0) return { status: 400, body: { error: "task_material_empty_file" } };
    const total = draft.assets.reduce((sum, asset) => sum + asset.size, 0) + bytes.length;
    if (total > MAX_TASK_MATERIAL_TOTAL_BYTES) return { status: 413, body: { error: "task_material_total_limit_exceeded" } };
    const usedBytes = localUsageBytes();
    if (usedBytes + bytes.length > localStoreCapBytes) {
      return { status: 507, body: { error: "task_material_local_capacity_exceeded", usedBytes, limitBytes: localStoreCapBytes } };
    }
    const originalName = safeName(name);
    const assetId = nextId("tma") || `tma_${randomUUID()}`;
    const storedName = `${assetId}--${originalName}`;
    const directory = ensureDirectoryChain(root, [safeKey(draft.ownerTeamId), safeKey(draft.projectId), safeKey(draft.id)]);
    const target = join(directory, storedName);
    const temporary = `${target}.uploading`;
    const hash = createHash("sha256").update(bytes).digest("hex");
    try {
      writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 });
      renameSync(temporary, target);
    } catch (error) {
      try { unlinkSync(temporary); } catch { /* best effort */ }
      return { status: 500, body: { error: "task_material_storage_failed", message: String(error?.message ?? error) } };
    }
    const asset = {
      id: assetId,
      clientFileId,
      originalName,
      storedName,
      family: familyFor(originalName, contentType),
      mimeType: contentType ? String(contentType).slice(0, 120) : null,
      size: bytes.length,
      hash,
      resourceClass: resourceClassFor(bytes.length),
      activeContent: ["code", "document"].includes(familyFor(originalName, contentType)),
      readiness: { state: "ready", reason: "stored" },
    };
    runTx(() => {
      draft.assets.push(asset);
      draft.revision += 1;
      draft.updatedAt = now();
    });
    appendEvent({ invocationId: null, type: "task_material_uploaded", level: "info", message: `Task material ${assetId} uploaded.`, data: { draftId: draft.id, assetId, size: asset.size, hash } });
    return { status: 201, body: { draft: publicDraft(draft), asset: publicDraft({ assets: [asset] }).assets[0] } };
  }

  function removeFile({ projectId, draftId, assetId, expectedRevision }, actor) {
    const draft = findDraft(draftId, actor, projectId);
    if (!draft) return { status: 404, body: { error: "task_material_draft_not_found" } };
    if (draft.status !== "draft") return { status: 409, body: { error: "task_material_draft_not_editable" } };
    if (Number(expectedRevision) !== draft.revision) return { status: 409, body: { error: "task_material_revision_conflict", currentRevision: draft.revision } };
    const index = draft.assets.findIndex((asset) => asset.id === String(assetId));
    if (index < 0) return { status: 404, body: { error: "task_material_not_found" } };
    let asset;
    runTx(() => {
      [asset] = draft.assets.splice(index, 1);
      draft.revision += 1;
      draft.updatedAt = now();
      runTx.afterCommit(() => {
        try { unlinkSync(sourcePath(draft, asset)); } catch { /* metadata removal is still safe */ }
      });
    });
    appendEvent({ invocationId: null, type: "task_material_removed", level: "info", message: `Task material ${asset.id} removed.`, data: { draftId: draft.id, assetId: asset.id } });
    return { status: 200, body: { draft: publicDraft(draft) } };
  }

  function claimDraft({ projectId, draftId, expectedRevision, workItemId, terminalId, deferPersist = false }, actor) {
    const draft = findDraft(draftId, actor, projectId);
    if (!draft) return { ok: false, status: 404, error: "task_material_draft_not_found" };
    if (draft.status === "claimed" && draft.workItemId === String(workItemId)) return { ok: true, assets: executionAssets(draft, workItemId, terminalId) };
    if (draft.status !== "draft") return { ok: false, status: 409, error: "task_material_draft_not_editable" };
    if (Number(expectedRevision) !== draft.revision) return { ok: false, status: 409, error: "task_material_revision_conflict" };
    if (!draft.assets.length) return { ok: false, status: 400, error: "task_material_draft_empty" };
    const claim = () => {
      draft.status = "claimed";
      draft.workItemId = String(workItemId);
      draft.revision += 1;
      draft.updatedAt = now();
    };
    if (deferPersist) claim();
    else runTx(claim);
    appendEvent({ invocationId: null, type: "task_material_claimed", level: "info", message: `Task material draft ${draft.id} claimed.`, data: { draftId: draft.id, workItemId: draft.workItemId } });
    return { ok: true, assets: executionAssets(draft, workItemId, terminalId) };
  }

  function sourcePath(draft, asset) {
    const path = resolve(root, safeKey(draft.ownerTeamId), safeKey(draft.projectId), safeKey(draft.id), asset.storedName);
    const expectedRoot = resolve(root, safeKey(draft.ownerTeamId), safeKey(draft.projectId), safeKey(draft.id));
    const child = relative(expectedRoot, path);
    if (!child || child.startsWith("..") || isAbsolute(child)) throw new Error("task_material_path_escape");
    return path;
  }

  function executionAssets(draft, workItemId, terminalId) {
    return draft.assets.map((asset) => ({
      id: asset.id,
      path: `.myagenttool/inputs/${String(workItemId).replace(/[^a-zA-Z0-9_-]/g, "_")}/${asset.storedName}`,
      family: asset.family,
      mimeType: asset.mimeType,
      terminalId: terminalId ?? draft.terminalId ?? "local",
      size: asset.size,
      resourceClass: asset.resourceClass,
      hash: asset.hash,
      version: null,
      worktreeId: null,
      capabilities: [],
      readiness: { state: "ready", reason: "task_material_claimed" },
      originalName: asset.originalName,
    }));
  }

  async function materialize({ workItemId, worktree }) {
    const drafts = (state.taskMaterialDrafts ?? []).filter((candidate) => candidate.workItemId === String(workItemId) && candidate.status === "claimed");
    if (!drafts.length) return { ok: true, assets: [] };
    if (!worktree?.path) return { ok: false, error: "task_material_worktree_missing" };
    const workItem = (state.workItems ?? []).find((candidate) => candidate.id === String(workItemId));
    const activeAssetIds = new Set(workItem
      ? (workItem.inputAssets ?? []).map((asset) => asset.id).filter(Boolean)
      : drafts.flatMap((draft) => (draft.assets ?? []).map((asset) => asset.id)));
    const worktreeRoot = resolve(worktree.path);
    const inputRoot = resolve(worktreeRoot, ".myagenttool", "inputs", String(workItemId).replace(/[^a-zA-Z0-9_-]/g, "_"));
    if (!inputRoot.startsWith(`${worktreeRoot}\\`) && !inputRoot.startsWith(`${worktreeRoot}/`)) return { ok: false, error: "task_material_worktree_path_escape" };
    ensureDirectoryChain(worktreeRoot, [".myagenttool", "inputs", String(workItemId).replace(/[^a-zA-Z0-9_-]/g, "_")]);
    writeFileSync(join(inputRoot, ".gitignore"), "*\n!.gitignore\n", { flag: "w", mode: 0o600 });
    const materialized = [];
    for (const draft of drafts) {
      for (const asset of draft.assets) {
        if (!activeAssetIds.has(asset.id)) continue;
        const source = sourcePath(draft, asset);
        if (!existsSync(source) || !statSync(source).isFile()) return { ok: false, error: "task_material_source_missing", assetId: asset.id };
        const sourceHash = createHash("sha256").update(readFileSync(source)).digest("hex");
        if (sourceHash !== asset.hash) return { ok: false, error: "task_material_integrity_mismatch", assetId: asset.id };
        const destination = resolve(inputRoot, asset.storedName);
        const temp = `${destination}.copying`;
        writeFileSync(temp, readFileSync(source), { flag: "w", mode: 0o600 });
        renameSync(temp, destination);
        const destinationHash = createHash("sha256").update(readFileSync(destination)).digest("hex");
        if (destinationHash !== asset.hash) return { ok: false, error: "task_material_destination_mismatch", assetId: asset.id };
        materialized.push(...executionAssets({ ...draft, assets: [asset] }, workItemId, worktree.id));
      }
    }
    return { ok: true, assets: materialized };
  }

  function readContent({ workItemId, assetId }, actor) {
    const teamId = actorTeam(actor);
    const workItem = (state.workItems ?? []).find((candidate) => candidate.id === String(workItemId) && candidate.ownerTeamId === teamId);
    if (!workItem) return { status: 404, error: "work_item_not_found" };
    if (!(workItem.inputAssets ?? []).some((asset) => asset.id === String(assetId))) {
      return { status: 404, error: "task_material_not_found" };
    }
    for (const draft of state.taskMaterialDrafts ?? []) {
      if (draft.ownerTeamId !== teamId || draft.workItemId !== workItem.id || draft.status !== "claimed") continue;
      const asset = (draft.assets ?? []).find((candidate) => candidate.id === String(assetId));
      if (!asset) continue;
      const path = sourcePath(draft, asset);
      if (!existsSync(path) || !statSync(path).isFile()) return { status: 410, error: "task_material_source_missing" };
      const bytes = readFileSync(path);
      if (createHash("sha256").update(bytes).digest("hex") !== asset.hash) {
        return { status: 409, error: "task_material_integrity_mismatch" };
      }
      return { status: 200, asset: publicDraft({ assets: [asset] }).assets[0], bytes };
    }
    return { status: 404, error: "task_material_not_found" };
  }

  function usage() {
    return { usedBytes: localUsageBytes(), limitBytes: localStoreCapBytes };
  }

  function cleanupCandidates(actor) {
    const teamId = actorTeam(actor);
    const cutoff = Date.parse(now()) - completedRetentionDays * 24 * 60 * 60 * 1_000;
    const completedIds = new Set((state.workItems ?? [])
      .filter((item) => item.ownerTeamId === teamId && (item.state === "closed" || item.status === "done") && Date.parse(item.completedAt ?? item.updatedAt ?? item.createdAt ?? 0) <= cutoff)
      .map((item) => item.id));
    const rows = [];
    for (const draft of state.taskMaterialDrafts ?? []) {
      if (draft.ownerTeamId !== teamId || draft.status === "purged") continue;
      const expiredDraft = draft.status === "expired" || (draft.status === "draft" && Date.parse(draft.expiresAt) <= Date.parse(now()));
      const retainedCompleted = draft.status === "claimed" && completedIds.has(draft.workItemId);
      if (!expiredDraft && !retainedCompleted) continue;
      const assets = [];
      for (const asset of draft.assets ?? []) {
        const path = sourcePath(draft, asset);
        if (!existsSync(path) || !statSync(path).isFile()) continue;
        assets.push({ id: asset.id, size: statSync(path).size });
      }
      if (assets.length) rows.push({ draft, assets, reason: expiredDraft ? "expired_draft" : "completed_retention" });
    }
    return rows;
  }

  function cleanupPreview(actor) {
    const rows = cleanupCandidates(actor);
    const signature = rows.map((row) => ({ id: row.draft.id, revision: row.draft.revision, assets: row.assets })).sort((a, b) => a.id.localeCompare(b.id));
    const previewToken = createHash("sha256").update(JSON.stringify(signature)).digest("hex");
    return {
      usedBytes: localUsageBytes(),
      limitBytes: localStoreCapBytes,
      reclaimableBytes: rows.reduce((sum, row) => sum + row.assets.reduce((assetSum, asset) => assetSum + asset.size, 0), 0),
      draftCount: rows.length,
      fileCount: rows.reduce((sum, row) => sum + row.assets.length, 0),
      completedTaskCount: rows.filter((row) => row.reason === "completed_retention").length,
      expiredDraftCount: rows.filter((row) => row.reason === "expired_draft").length,
      retentionDays: completedRetentionDays,
      previewToken,
    };
  }

  function executeCleanup({ previewToken }, actor) {
    const preview = cleanupPreview(actor);
    if (!previewToken || String(previewToken) !== preview.previewToken) {
      return { status: 409, body: { error: "task_material_cleanup_preview_stale", preview } };
    }
    const rows = cleanupCandidates(actor);
    let reclaimedBytes = 0;
    let fileCount = 0;
    let draftCount = 0;
    runTx(() => {
      for (const row of rows) {
        for (const asset of row.assets) {
          const sourceAsset = (row.draft.assets ?? []).find((candidate) => candidate.id === asset.id);
          if (!sourceAsset) continue;
          try {
            unlinkSync(sourcePath(row.draft, sourceAsset));
            reclaimedBytes += asset.size;
            fileCount += 1;
          } catch {
            // Leave the draft unpurged so a later preview can retry safely.
          }
        }
        const remaining = (row.draft.assets ?? []).some((asset) => existsSync(sourcePath(row.draft, asset)));
        if (!remaining) {
          row.draft.status = "purged";
          row.draft.purgedAt = now();
          row.draft.updatedAt = now();
          draftCount += 1;
        }
      }
    });
    appendEvent({ invocationId: null, type: "task_material_cleanup_completed", level: "info", message: `Reclaimed ${reclaimedBytes} bytes from local task materials.`, data: { reclaimedBytes, fileCount, draftCount } });
    return { status: 200, body: { reclaimedBytes, fileCount, draftCount, usage: cleanupPreview(actor) } };
  }

  function resolveClaimedAsset({ workItemId, assetId, terminalId }, actor) {
    const teamId = actorTeam(actor);
    for (const draft of state.taskMaterialDrafts ?? []) {
      if (draft.ownerTeamId !== teamId || draft.workItemId !== String(workItemId) || draft.status !== "claimed") continue;
      const asset = (draft.assets ?? []).find((candidate) => candidate.id === String(assetId));
      if (!asset) continue;
      return { ok: true, asset: executionAssets({ ...draft, assets: [asset] }, workItemId, terminalId)[0] };
    }
    return { ok: false, status: 404, error: "task_material_not_found" };
  }

  function expireDraft(draft) {
    runTx(() => {
      draft.status = "expired";
      draft.updatedAt = now();
      for (const asset of draft.assets ?? []) {
        try { unlinkSync(sourcePath(draft, asset)); } catch { /* bounded cleanup */ }
      }
    });
  }

  function sweepExpired() {
    let count = 0;
    for (const draft of state.taskMaterialDrafts ?? []) {
      if (draft.status === "draft" && Date.parse(draft.expiresAt) <= Date.parse(now())) {
        expireDraft(draft);
        count += 1;
      }
    }
    return count;
  }

  return { createDraft, getDraft, uploadFile, removeFile, claimDraft, resolveClaimedAsset, materialize, readContent, usage, cleanupPreview, executeCleanup, sweepExpired, root };
}
