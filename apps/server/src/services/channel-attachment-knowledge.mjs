import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";

import { LOCAL_TEAM_ID } from "../runtime/auth.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";
import { contentId, safeRelativePath, storageKey } from "./local-content-records.mjs";

const MAX_ITEMS = 5_000;
const MAX_ATTACHMENTS = 20;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/**
 * Preserve a user-sent Channel attachment as a managed local material.
 *
 * Inbound media first lands in the channel's bound project through the
 * existing ingestion boundary. This service verifies that confined source and
 * copies it into application data, so the library does not depend on a later
 * task or on the temporary project attachment path remaining available.
 */
export function createChannelAttachmentKnowledgeService({
  state,
  stateStorePath,
  now = () => new Date().toISOString(),
  nextId = (prefix) => `${prefix}_${Date.now().toString(36)}`,
  persistStateSoon = () => {},
  store,
} = {}) {
  const runTx = makeRunTx({ store, persistStateSoon });
  const dataRoot = resolve(dirname(stateStorePath));
  state.channelAttachmentKnowledgeItems ??= [];

  async function capture({
    channelId,
    conversationId,
    eventId,
    ownerTeamId = LOCAL_TEAM_ID,
    projectId,
    projectPath,
    assets = [],
  } = {}) {
    const list = (Array.isArray(assets) ? assets : []).slice(0, MAX_ATTACHMENTS);
    if (!channelId || !conversationId || !eventId || !projectId || !projectPath || !list.length) {
      return { ok: false, reason: "channel_attachment_knowledge_context_required", items: [], failures: [] };
    }
    const items = [];
    const failures = [];
    for (const asset of list) {
      try {
        items.push(await captureOne({
          channelId,
          conversationId,
          eventId,
          ownerTeamId,
          projectId,
          projectPath,
          asset,
        }));
      } catch (error) {
        failures.push({
          assetId: String(asset?.id ?? "").slice(0, 200) || null,
          name: safeOriginalName(asset?.originalName),
          reason: String(error?.code ?? error?.message ?? error).slice(0, 120),
        });
      }
    }
    return { ok: items.length > 0, items, failures };
  }

  async function captureOne({ channelId, conversationId, eventId, ownerTeamId, projectId, projectPath, asset }) {
    if (!asset?.id || asset.projectId !== projectId || asset.readiness?.state !== "ready") {
      throw knowledgeError("channel_attachment_knowledge_scope_mismatch");
    }
    const source = await verifiedSource({ asset, projectPath });
    const digest = createHash("sha256").update(source.bytes).digest("hex");
    if (normalizedDigest(asset.hash) && normalizedDigest(asset.hash) !== digest) {
      throw knowledgeError("channel_attachment_knowledge_digest_mismatch");
    }

    const existing = [...state.channelAttachmentKnowledgeItems].reverse().find((item) =>
      item.status === "ready"
      && (item.ownerTeamId ?? LOCAL_TEAM_ID) === ownerTeamId
      && item.sha256 === digest);
    if (existing) {
      runTx(() => {
        existing.archivedAt = null;
        existing.lastUsedAt = now();
        existing.updatedAt = now();
        existing.sources = appendSource(existing.sources, { channelId, conversationId, eventId, assetId: asset.id, at: now() });
      });
      return receipt(existing, true);
    }
    if (state.channelAttachmentKnowledgeItems.length >= MAX_ITEMS) {
      throw knowledgeError("channel_attachment_knowledge_capacity_reached");
    }

    const extension = safeExtension(asset.originalName);
    const relativePath = safeRelativePath(join(
      "knowledge",
      "channel-attachments",
      storageKey(ownerTeamId),
      storageKey(projectId),
      digest.slice(0, 2),
      `${digest}${extension}`,
    ));
    if (!relativePath) throw knowledgeError("channel_attachment_knowledge_path_refused");
    const target = resolve(dataRoot, relativePath);
    const targetRel = relative(dataRoot, target);
    if (!targetRel || targetRel === ".." || targetRel.startsWith(`..${sep}`)) {
      throw knowledgeError("channel_attachment_knowledge_path_refused");
    }
    await mkdir(dirname(target), { recursive: true });
    const resolvedDataRoot = await realpath(dataRoot);
    const resolvedTargetDirectory = await realpath(dirname(target));
    const directoryRel = relative(resolvedDataRoot, resolvedTargetDirectory);
    if (!directoryRel || directoryRel === ".." || directoryRel.startsWith(`..${sep}`)) {
      throw knowledgeError("channel_attachment_knowledge_path_refused");
    }
    if (existsSync(target) && (await lstat(target)).isSymbolicLink()) {
      throw knowledgeError("channel_attachment_knowledge_path_refused");
    }
    if (!existsSync(target)) {
      try {
        await writeFile(target, source.bytes, { flag: "wx", mode: 0o600 });
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
    }
    const storedInfo = await stat(target);
    if (!storedInfo.isFile() || storedInfo.size !== source.bytes.length) {
      throw knowledgeError("channel_attachment_knowledge_stored_file_invalid");
    }
    const storedBytes = await readFile(target);
    if (createHash("sha256").update(storedBytes).digest("hex") !== digest) {
      throw knowledgeError("channel_attachment_knowledge_stored_digest_mismatch");
    }

    const timestamp = now();
    const item = {
      id: nextId("channel_attachment_knowledge"),
      ownerTeamId,
      projectId,
      channelId,
      conversationId,
      eventId,
      assetId: String(asset.id).slice(0, 200),
      originalName: safeOriginalName(asset.originalName),
      family: String(asset.family ?? "file").slice(0, 80),
      mimeType: asset.mimeType ? String(asset.mimeType).slice(0, 160) : null,
      size: source.bytes.length,
      sha256: digest,
      relativePath,
      status: "ready",
      error: null,
      sources: [{ channelId, conversationId, eventId, assetId: asset.id, at: timestamp }],
      createdAt: timestamp,
      completedAt: timestamp,
      lastUsedAt: timestamp,
      updatedAt: timestamp,
      archivedAt: null,
    };
    runTx(() => {
      state.channelAttachmentKnowledgeItems = [...state.channelAttachmentKnowledgeItems, item];
    });
    return receipt(item, false);
  }

  function getItemLocation({ itemId, ownerTeamId = LOCAL_TEAM_ID } = {}) {
    const item = (state.channelAttachmentKnowledgeItems ?? []).find((candidate) =>
      candidate.id === itemId
      && candidate.status === "ready"
      && !candidate.archivedAt
      && (candidate.ownerTeamId ?? LOCAL_TEAM_ID) === ownerTeamId) ?? null;
    if (!item?.relativePath) return null;
    return {
      itemId: item.id,
      contentId: contentId("material", ownerTeamId, item.id),
      title: item.originalName ?? "Channel 资料",
      relativePath: item.relativePath,
      mimeType: item.mimeType ?? null,
      size: item.size ?? null,
      sourceKind: "channel_attachment",
    };
  }

  return { capture, getItemLocation };
}

async function verifiedSource({ asset, projectPath }) {
  const root = await realpath(resolve(projectPath));
  const candidate = resolve(root, String(asset.path ?? ""));
  const lexical = relative(root, candidate);
  if (!lexical || lexical === ".." || lexical.startsWith(`..${sep}`)) {
    throw knowledgeError("channel_attachment_knowledge_path_refused");
  }
  const linkInfo = await lstat(candidate);
  const fileInfo = await stat(candidate);
  if (linkInfo.isSymbolicLink() || !fileInfo.isFile() || fileInfo.size <= 0 || fileInfo.size > MAX_ATTACHMENT_BYTES) {
    throw knowledgeError("channel_attachment_knowledge_source_invalid");
  }
  const resolvedSource = await realpath(candidate);
  const resolvedRelative = relative(root, resolvedSource);
  if (!resolvedRelative || resolvedRelative === ".." || resolvedRelative.startsWith(`..${sep}`)) {
    throw knowledgeError("channel_attachment_knowledge_path_refused");
  }
  return { bytes: await readFile(resolvedSource) };
}

function receipt(item, replayed) {
  return {
    itemId: item.id,
    contentId: contentId("material", item.ownerTeamId ?? LOCAL_TEAM_ID, item.id),
    title: item.originalName ?? "Channel 资料",
    family: item.family ?? "file",
    mimeType: item.mimeType ?? null,
    size: item.size ?? null,
    replayed,
  };
}

function appendSource(sources, source) {
  const rows = Array.isArray(sources) ? sources : [];
  if (rows.some((row) => row.eventId === source.eventId && row.assetId === source.assetId)) return rows;
  return [...rows, source].slice(-50);
}

function safeOriginalName(value) {
  const name = String(value ?? "Channel 资料").replace(/[\r\n\t]/g, " ").trim().slice(0, 240);
  return name || "Channel 资料";
}

function safeExtension(value) {
  const extension = extname(safeOriginalName(value)).toLowerCase();
  return /^\.[a-z0-9]{1,12}$/.test(extension) ? extension : "";
}

function normalizedDigest(value) {
  const digest = String(value ?? "").toLowerCase().replace(/^sha256:/, "");
  return /^[a-f0-9]{64}$/.test(digest) ? digest : null;
}

function knowledgeError(code) {
  return Object.assign(new Error(code), { code });
}
