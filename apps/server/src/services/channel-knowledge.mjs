import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { LOCAL_TEAM_ID } from "../runtime/auth.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";
import { canonicalizeArticleUrl, importArticleToWorktree } from "./article-imports.mjs";
import { contentId } from "./local-content-records.mjs";

const MAX_ITEMS = 5_000;
const MAX_PENDING = 50;
const MAX_CONCURRENT = 2;
const CACHED_EXCERPT_CHARS = 4_000;

export function createChannelKnowledgeService({
  state,
  stateStorePath,
  now = () => new Date().toISOString(),
  nextId = (prefix) => `${prefix}_${Date.now().toString(36)}`,
  persistStateSoon = () => {},
  store,
  importArticle = importArticleToWorktree,
  maxPending = MAX_PENDING,
  maxConcurrent = MAX_CONCURRENT,
} = {}) {
  const runTx = makeRunTx({ store, persistStateSoon });
  const dataRoot = resolve(dirname(stateStorePath));
  const queue = [];
  const inFlight = new Map();
  let activeCount = 0;

  state.channelKnowledgeItems ??= [];
  const interrupted = state.channelKnowledgeItems.filter((item) => ["queued", "saving"].includes(item?.status));
  if (interrupted.length) {
    runTx(() => {
      for (const item of interrupted) {
        item.status = "failed";
        item.error = "channel_knowledge_import_interrupted";
        item.completedAt = now();
        item.updatedAt = now();
      }
    });
  }

  function capture(input = {}) {
    let canonicalUrl;
    try {
      canonicalUrl = canonicalizeArticleUrl(input.url);
    } catch (error) {
      return Promise.reject(error);
    }
    const channel = (state.channels ?? []).find((candidate) => candidate.id === input.channelId) ?? null;
    const ownerTeamId = input.ownerTeamId ?? channel?.ownerTeamId ?? LOCAL_TEAM_ID;
    const projectId = input.projectId ?? channel?.taskProjectId ?? null;
    const key = captureKey(ownerTeamId, projectId, canonicalUrl);
    const pending = inFlight.get(key);
    if (pending) return pending;

    const cached = cachedItem(ownerTeamId, projectId, canonicalUrl);
    if (cached) {
      return readCached(cached).catch(() => {
        runTx(() => {
          cached.status = "failed";
          cached.error = "channel_knowledge_cached_original_unreadable";
          cached.updatedAt = now();
        });
        return capture(input);
      });
    }
    if (queue.length + activeCount >= maxPending) {
      return Promise.reject(Object.assign(new Error("channel_knowledge_queue_full"), { code: "channel_knowledge_queue_full" }));
    }
    if (state.channelKnowledgeItems.length >= MAX_ITEMS) {
      return Promise.reject(Object.assign(new Error("channel_knowledge_capacity_reached"), { code: "channel_knowledge_capacity_reached" }));
    }

    const item = createQueuedItem({ ...input, canonicalUrl, ownerTeamId, projectId });
    const promise = new Promise((resolveCapture, rejectCapture) => {
      queue.push({ item, input: { ...input, canonicalUrl, ownerTeamId, projectId }, resolveCapture, rejectCapture, key });
      pump();
    });
    inFlight.set(key, promise);
    void promise.finally(() => inFlight.delete(key)).catch(() => {});
    return promise;
  }

  function cachedItem(ownerTeamId, projectId, canonicalUrl) {
    return [...state.channelKnowledgeItems]
      .reverse()
      .find((item) => item.ownerTeamId === ownerTeamId
        && (item.projectId ?? null) === (projectId ?? null)
        && item.canonicalUrl === canonicalUrl
        && item.status === "ready"
        && confinedManagedPath(item.markdownPath)
        && existsSync(resolve(dataRoot, item.markdownPath)));
  }

  async function readCached(item) {
    const markdown = await readFile(resolve(dataRoot, item.markdownPath), "utf8");
    runTx(() => {
      item.lastUsedAt = now();
      item.updatedAt = now();
    });
    return {
      sourceUrl: item.sourceUrl,
      canonicalUrl: item.canonicalUrl,
      resolvedUrl: item.canonicalUrl,
      provider: item.provider,
      contentType: item.contentType,
      title: item.title,
      author: item.author,
      publishedAt: item.publishedAt,
      textLength: item.textLength,
      mediaCounts: item.mediaCounts,
      _document: { markdown: markdown.slice(0, CACHED_EXCERPT_CHARS), media: [] },
      knowledge: knowledgeReceipt(item, true),
    };
  }

  function createQueuedItem(input) {
    const timestamp = now();
    const item = {
      id: nextId("channel_knowledge"),
      ownerTeamId: input.ownerTeamId,
      projectId: input.projectId ?? null,
      channelId: input.channelId ?? null,
      conversationId: input.conversationId ?? null,
      eventId: input.eventId ?? null,
      sourceUrl: String(input.url),
      canonicalUrl: input.canonicalUrl,
      status: "queued",
      error: null,
      provider: null,
      contentType: null,
      title: null,
      author: null,
      publishedAt: null,
      textLength: null,
      mediaCounts: null,
      knowledgeRoot: null,
      markdownPath: null,
      htmlPath: null,
      manifestPath: null,
      warnings: [],
      replayed: false,
      createdAt: timestamp,
      startedAt: null,
      completedAt: null,
      lastUsedAt: timestamp,
      updatedAt: timestamp,
    };
    runTx(() => {
      state.channelKnowledgeItems = [...(state.channelKnowledgeItems ?? []), item];
    });
    return item;
  }

  function pump() {
    while (activeCount < maxConcurrent && queue.length) {
      const entry = queue.shift();
      activeCount += 1;
      void run(entry)
        .then(entry.resolveCapture, entry.rejectCapture)
        .finally(() => {
          activeCount -= 1;
          queueMicrotask(pump);
        });
    }
  }

  async function run({ item, input }) {
    runTx(() => {
      item.status = "saving";
      item.startedAt = now();
      item.updatedAt = now();
    });
    try {
      const knowledgeRoot = knowledgeRootFor(input.ownerTeamId, input.projectId);
      const absoluteRoot = resolve(dataRoot, knowledgeRoot);
      await mkdir(absoluteRoot, { recursive: true });
      const result = await importArticle({
        url: input.url,
        worktreePath: absoluteRoot,
        workItemId: null,
        importedAt: now(),
        ownerTeamId: input.ownerTeamId,
      });
      const inspection = result.inspection ?? {};
      const markdownPath = managedResultPath(knowledgeRoot, result.markdownPath);
      const htmlPath = managedResultPath(knowledgeRoot, result.htmlPath);
      const manifestPath = managedResultPath(knowledgeRoot, result.manifestPath);
      runTx(() => {
        Object.assign(item, {
          status: "ready",
          error: null,
          provider: inspection.provider ?? null,
          contentType: inspection.contentType ?? null,
          title: inspection.title ?? "未命名资料",
          author: inspection.author ?? null,
          publishedAt: inspection.publishedAt ?? null,
          textLength: inspection.textLength ?? null,
          mediaCounts: result.mediaCounts ?? inspection.mediaCounts ?? null,
          knowledgeRoot,
          markdownPath,
          htmlPath,
          manifestPath,
          warnings: Array.isArray(result.warnings) ? result.warnings.slice(0, 20) : [],
          replayed: Boolean(result.replayed),
          completedAt: now(),
          lastUsedAt: now(),
          updatedAt: now(),
        });
      });
      return { ...inspection, knowledge: knowledgeReceipt(item, Boolean(result.replayed)) };
    } catch (error) {
      runTx(() => {
        item.status = "failed";
        item.error = String(error?.code ?? error?.message ?? error).slice(0, 160);
        item.completedAt = now();
        item.updatedAt = now();
      });
      throw error;
    }
  }

  function knowledgeRootFor(ownerTeamId, projectId) {
    return join(
      "knowledge",
      "channel-articles",
      stableSegment(ownerTeamId),
      stableSegment(projectId ?? "general"),
    );
  }

  function managedResultPath(root, path) {
    if (!path) return null;
    const candidate = join(root, path);
    if (!confinedManagedPath(candidate)) throw Object.assign(new Error("channel_knowledge_output_refused"), { code: "channel_knowledge_output_refused" });
    return candidate;
  }

  function confinedManagedPath(path) {
    if (!path || isAbsolute(path)) return false;
    const candidate = resolve(dataRoot, path);
    const lexical = relative(dataRoot, candidate);
    return Boolean(lexical) && !lexical.startsWith("..") && !isAbsolute(lexical);
  }

  async function retryFailedForHosts(hosts, ownerTeamId = LOCAL_TEAM_ID, retryKey = null) {
    const allowed = new Set((hosts ?? []).map((host) => String(host).toLowerCase()));
    const candidates = (state.channelKnowledgeItems ?? [])
      .filter((item) => item.ownerTeamId === ownerTeamId
        && item.status === "failed"
        && allowed.has(hostnameOf(item.canonicalUrl))
        && (!retryKey || item.lastPluginRetryKey !== retryKey))
      .slice(-10);
    return Promise.all(candidates.map(async (item) => {
      if (retryKey) runTx(() => {
        item.lastPluginRetryKey = retryKey;
        item.updatedAt = now();
      });
      try {
        const result = await capture({
          url: item.sourceUrl,
          ownerTeamId: item.ownerTeamId,
          projectId: item.projectId,
          channelId: item.channelId,
          conversationId: item.conversationId,
          eventId: item.eventId,
        });
        return { ok: true, item, result };
      } catch (error) {
        return { ok: false, item, error: String(error?.code ?? error?.message ?? error).slice(0, 120) };
      }
    }));
  }

  function getItemLocation({ itemId, ownerTeamId = LOCAL_TEAM_ID } = {}) {
    const item = (state.channelKnowledgeItems ?? []).find((candidate) =>
      candidate.id === itemId
      && candidate.ownerTeamId === ownerTeamId
      && candidate.status === "ready") ?? null;
    if (!item || !confinedManagedPath(item.markdownPath)) return null;
    const absolutePath = resolve(dataRoot, item.markdownPath);
    if (!existsSync(absolutePath)) return null;
    return {
      itemId: item.id,
      contentId: contentId("article", item.ownerTeamId ?? LOCAL_TEAM_ID, item.id),
      title: item.title ?? "未命名资料",
      relativePath: item.markdownPath,
      absolutePath,
      htmlPath: item.htmlPath && confinedManagedPath(item.htmlPath)
        ? resolve(dataRoot, item.htmlPath)
        : null,
      manifestPath: item.manifestPath && confinedManagedPath(item.manifestPath)
        ? resolve(dataRoot, item.manifestPath)
        : null,
    };
  }

  return { capture, retryFailedForHosts, getItemLocation };
}

function captureKey(ownerTeamId, projectId, canonicalUrl) {
  return `${ownerTeamId}\u0000${projectId ?? "general"}\u0000${canonicalUrl}`;
}

function stableSegment(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

function hostnameOf(value) {
  try {
    return new URL(String(value)).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function knowledgeReceipt(item, replayed) {
  return {
    status: "saved",
    itemId: item.id,
    replayed,
    warningCount: item.warnings?.length ?? 0,
    savedAt: item.completedAt,
  };
}
