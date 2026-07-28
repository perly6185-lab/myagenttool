import { createHash, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { parse } from "parse5";

import { actorCanAccessProject } from "../runtime/auth.mjs";
import { validateExternalWebhookTarget } from "./auto-run-alerts.mjs";

export const ARTICLE_IMPORT_LIMITS = Object.freeze({
  htmlBytes: 5 * 1024 * 1024,
  mediaBytes: 25 * 1024 * 1024,
  totalMediaBytes: 100 * 1024 * 1024,
  mediaCount: 100,
  mediaConcurrency: 4,
  redirects: 5,
  timeoutMs: 20_000,
});

const MEDIA_EXTENSIONS = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/gif", ".gif"],
  ["image/webp", ".webp"],
  ["image/avif", ".avif"],
  ["audio/mpeg", ".mp3"],
  ["audio/mp4", ".m4a"],
  ["audio/ogg", ".ogg"],
  ["audio/wav", ".wav"],
  ["video/mp4", ".mp4"],
  ["video/webm", ".webm"],
  ["video/quicktime", ".mov"],
]);

const SKIPPED_TAGS = new Set(["script", "style", "noscript", "svg", "nav", "button", "form", "input"]);
const TRACKING_PARAMS = new Set(["from", "isappinstalled", "scene", "clicktime", "enterid"]);

export function detectArticleSource(value) {
  const hostname = new URL(value).hostname.toLowerCase();
  if (hostname === "mp.weixin.qq.com" || hostname.endsWith(".weixin.qq.com")) return "wechat";
  if (hostname === "xiaohongshu.com" || hostname.endsWith(".xiaohongshu.com") || hostname === "xhslink.com") {
    return "xiaohongshu";
  }
  return "web";
}

export function canonicalizeArticleUrl(value) {
  const url = new URL(String(value ?? "").trim());
  if (url.protocol !== "https:" || url.username || url.password) throw articleError("article_url_refused");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  url.hostname = url.hostname.toLowerCase();
  return url.toString();
}

export function buildArticleRelativeDirectory({ provider, date, title, canonicalUrl }) {
  const safeProvider = ["wechat", "xiaohongshu", "web"].includes(provider) ? provider : "web";
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10);
  const [year, month] = safeDate.split("-");
  const slug = safeArticleSlug(title);
  const shortHash = createHash("sha256").update(canonicalUrl).digest("hex").slice(0, 8);
  return `docs/imported/${safeProvider}/${year}/${month}/${safeDate}-${slug}-${shortHash}`;
}

export async function inspectArticle({
  url,
  fetchImpl = globalThis.fetch,
  resolveHostname,
  signal,
  limits = ARTICLE_IMPORT_LIMITS,
} = {}) {
  const canonicalUrl = canonicalizeArticleUrl(url);
  const page = await fetchPublicResource(canonicalUrl, {
    fetchImpl,
    resolveHostname,
    signal,
    maxBytes: limits.htmlBytes,
    maxRedirects: limits.redirects,
    timeoutMs: limits.timeoutMs,
    accept: "text/html,application/xhtml+xml",
  });
  const contentType = normalizedMime(page.contentType);
  if (contentType && contentType !== "text/html" && contentType !== "application/xhtml+xml") {
    throw articleError("article_html_mime_mismatch");
  }
  const html = page.bytes.toString("utf8");
  const provider = detectArticleSource(page.url);
  const parsed = parseArticleDocument(html, page.url, provider);
  return {
    sourceUrl: String(url),
    canonicalUrl,
    resolvedUrl: page.url,
    provider,
    contentType: provider === "xiaohongshu" ? "note" : "article",
    title: parsed.title,
    author: parsed.author,
    publishedAt: parsed.publishedAt,
    publishedAtSource: parsed.publishedAt ? "source" : "imported",
    textLength: parsed.plainText.length,
    media: parsed.media.map(({ token, ...item }) => item),
    mediaCounts: countMedia(parsed.media),
    markdownPreview: parsed.markdown.slice(0, 2_000),
    fetchedAt: new Date().toISOString(),
    _document: parsed,
  };
}

export async function importArticleToWorktree({
  url,
  worktreePath,
  workItemId,
  importedAt = new Date().toISOString(),
  fetchImpl = globalThis.fetch,
  resolveHostname,
  signal,
  limits = ARTICLE_IMPORT_LIMITS,
} = {}) {
  const inspection = await inspectArticle({ url, fetchImpl, resolveHostname, signal, limits });
  const publishedAt = inspection.publishedAt ?? importedAt.slice(0, 10);
  const relativeDirectory = buildArticleRelativeDirectory({
    provider: inspection.provider,
    date: publishedAt,
    title: inspection.title,
    canonicalUrl: inspection.canonicalUrl,
  });
  const root = realpathSync(resolve(worktreePath));
  const finalDirectory = resolve(root, relativeDirectory);
  assertConfined(root, finalDirectory);
  await ensureSafeDirectory(root, relative(root, resolve(finalDirectory, "..")));

  if (existsSync(finalDirectory)) {
    if (lstatSync(finalDirectory).isSymbolicLink()) throw articleError("article_output_path_refused");
    const replay = await existingImport(finalDirectory, inspection.canonicalUrl);
    if (replay) return { ...replay, replayed: true, inspection };
    throw articleError("article_output_conflict");
  }

  const parent = resolve(finalDirectory, "..");
  const staging = join(parent, `.${basename(finalDirectory)}.tmp-${randomBytes(6).toString("hex")}`);
  assertConfined(root, staging);
  await mkdir(join(staging, "assets"), { recursive: true });

  try {
    const downloaded = await downloadMedia(inspection._document.media, {
      pageUrl: inspection.resolvedUrl,
      directory: join(staging, "assets"),
      fetchImpl,
      resolveHostname,
      signal,
      limits,
    });
    const markdownBody = substituteMedia(inspection._document.markdown, downloaded);
    const frontMatter = renderFrontMatter({
      title: inspection.title,
      sourceProvider: inspection.provider,
      contentType: inspection.contentType,
      sourceUrl: inspection.sourceUrl,
      canonicalUrl: inspection.canonicalUrl,
      author: inspection.author,
      publishedAt,
      importedAt,
      localIssueId: workItemId,
      urlHash: createHash("sha256").update(inspection.canonicalUrl).digest("hex"),
    });
    const markdown = `${frontMatter}\n${markdownBody.trim()}\n`;
    const manifest = {
      schemaVersion: 1,
      status: "complete",
      title: inspection.title,
      sourceProvider: inspection.provider,
      contentType: inspection.contentType,
      sourceUrl: inspection.sourceUrl,
      canonicalUrl: inspection.canonicalUrl,
      resolvedUrl: inspection.resolvedUrl,
      author: inspection.author,
      publishedAt,
      publishedAtSource: inspection.publishedAt ? "source" : "imported",
      importedAt,
      localIssueId: workItemId,
      media: downloaded.map(({ token, ...entry }) => entry),
      warnings: downloaded.filter((entry) => entry.status !== "downloaded").map((entry) => ({
        code: entry.error,
        sourceUrl: entry.sourceUrl,
      })),
    };
    await writeFile(join(staging, "article.md"), markdown, { encoding: "utf8", flag: "wx" });
    await writeFile(join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    if (signal?.aborted) throw articleError("article_import_canceled");
    await rename(staging, finalDirectory);

    const markdownPath = `${relativeDirectory}/article.md`;
    const manifestPath = `${relativeDirectory}/manifest.json`;
    return {
      replayed: false,
      relativeDirectory,
      markdownPath,
      manifestPath,
      markdownSize: Buffer.byteLength(markdown),
      manifestSize: Buffer.byteLength(JSON.stringify(manifest)),
      mediaCounts: countMedia(downloaded.filter((entry) => entry.status === "downloaded")),
      warnings: manifest.warnings,
      inspection,
    };
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    if (signal?.aborted) throw articleError("article_import_canceled");
    throw error;
  }
}

export function createArticleImportService({
  state,
  now = () => new Date().toISOString(),
  nextId = (prefix) => `${prefix}_${Date.now().toString(36)}`,
  workItemService,
  fetchImpl = globalThis.fetch,
  resolveHostname,
  maxConcurrent = 2,
} = {}) {
  const jobs = new Map();
  const queue = [];
  const activeIssues = new Set();
  let activeCount = 0;

  async function inspect(input = {}, actor = null) {
    const projectId = String(input.projectId ?? "");
    if (!projectId || !actorCanAccessProject(state, actor, projectId)) {
      return { ok: false, status: 404, body: { error: "project_not_found" } };
    }
    try {
      const result = await inspectArticle({ url: input.url, fetchImpl, resolveHostname });
      delete result._document;
      return { ok: true, status: 200, body: { inspection: result } };
    } catch (error) {
      return articleFailure(error);
    }
  }

  function start(input = {}, actor = null) {
    const workItemId = String(input.workItemId ?? "");
    const itemResult = workItemService.getWorkItem({ workItemId }, actor);
    if (!itemResult.ok) return itemResult;
    const item = itemResult.body.workItem;
    if (activeIssues.has(item.id) || [...jobs.values()].some((job) => job.workItemId === item.id && ["queued", "running"].includes(job.state))) {
      return { ok: false, status: 409, body: { error: "article_import_already_active" } };
    }
    let canonicalUrl;
    try {
      canonicalUrl = canonicalizeArticleUrl(input.url);
    } catch (error) {
      return articleFailure(error);
    }
    const worktreeId = String(input.worktreeId ?? "");
    const worktree = (state.worktrees ?? []).find((candidate) => candidate.id === worktreeId);
    if (!worktree
      || worktree.sourceProjectId !== item.projectId
      || worktree.link?.type !== "local_issue"
      || Number(worktree.link?.number) !== Number(item.localNumber)) {
      return { ok: false, status: 400, body: { error: "article_import_worktree_required" } };
    }
    if (!worktree.path && !worktree.worktreePath) {
      return { ok: false, status: 400, body: { error: "article_import_worktree_not_ready" } };
    }
    const job = {
      id: nextId("article_import"),
      workItemId: item.id,
      worktreeId,
      canonicalUrl,
      sourceUrl: String(input.url),
      state: "queued",
      progress: { stage: "queued", completed: 0, total: 1 },
      createdAt: now(),
      startedAt: null,
      completedAt: null,
      error: null,
      result: null,
      controller: new AbortController(),
      actor,
      worktreePath: worktree.path ?? worktree.worktreePath,
    };
    const binding = workItemService.recordExecutionBinding({
      workItemId: item.id,
      kind: "article_import",
      targetId: job.id,
      worktreeId,
    }, actor);
    if (!binding.ok) return binding;
    jobs.set(job.id, job);
    queue.push(job.id);
    trimJobs();
    queueMicrotask(pump);
    return { ok: true, status: 202, body: { job: jobView(job) } };
  }

  function get({ workItemId, jobId } = {}, actor = null) {
    const itemResult = workItemService.getWorkItem({ workItemId: String(workItemId ?? "") }, actor);
    if (!itemResult.ok) return itemResult;
    const job = jobs.get(String(jobId ?? ""));
    if (!job || job.workItemId !== itemResult.body.workItem.id) {
      return { ok: false, status: 404, body: { error: "article_import_not_found" } };
    }
    return { ok: true, status: 200, body: { job: jobView(job) } };
  }

  function cancel({ workItemId, jobId } = {}, actor = null) {
    const found = get({ workItemId, jobId }, actor);
    if (!found.ok) return found;
    const job = jobs.get(String(jobId));
    if (!["queued", "running"].includes(job.state)) return found;
    job.controller.abort();
    if (job.state === "queued") {
      job.state = "canceled";
      job.progress = { stage: "canceled", completed: 0, total: 1 };
      job.completedAt = now();
    }
    return { ok: true, status: 200, body: { job: jobView(job) } };
  }

  async function pump() {
    while (activeCount < maxConcurrent && queue.length) {
      const job = jobs.get(queue.shift());
      if (!job || job.state !== "queued") continue;
      activeCount += 1;
      activeIssues.add(job.workItemId);
      void run(job).finally(() => {
        activeCount -= 1;
        activeIssues.delete(job.workItemId);
        queueMicrotask(pump);
      });
    }
  }

  async function run(job) {
    job.state = "running";
    job.startedAt = now();
    job.progress = { stage: "downloading", completed: 0, total: 1 };
    try {
      const result = await importArticleToWorktree({
        url: job.sourceUrl,
        worktreePath: job.worktreePath,
        workItemId: job.workItemId,
        importedAt: now(),
        fetchImpl,
        resolveHostname,
        signal: job.controller.signal,
      });
      const stored = (state.workItems ?? []).find((candidate) => candidate.id === job.workItemId);
      if (!stored) throw articleError("work_item_not_found");
      const outputAssets = [
        ...(stored.outputAssets ?? []).filter((asset) => ![result.markdownPath, result.manifestPath].includes(asset.path)),
        articleAsset(result.markdownPath, "markdown", result.markdownSize, stored, job.worktreeId),
        articleAsset(result.manifestPath, "unknown", result.manifestSize, stored, job.worktreeId),
      ];
      const providerLabel = `source:${result.inspection.provider}`;
      const contentLabel = `content:${result.inspection.contentType}`;
      const updated = workItemService.updateWorkItem({
        workItemId: stored.id,
        expectedRevision: stored.revision,
        labels: [...new Set([...(stored.labels ?? []), providerLabel, contentLabel])],
        outputAssets,
      }, job.actor);
      if (!updated.ok) throw articleError(updated.body?.error ?? "article_import_asset_binding_failed");
      workItemService.createComment({ workItemId: stored.id, body: [
        `Imported [${result.inspection.title}](${result.inspection.sourceUrl}) to \`${result.markdownPath}\`.`,
        result.warnings.length ? `${result.warnings.length} media item(s) could not be downloaded; see manifest.json.` : "",
      ].filter(Boolean).join("\n\n") }, job.actor);
      job.state = "completed";
      job.result = result;
      delete job.result.inspection._document;
      job.progress = { stage: "completed", completed: 1, total: 1 };
    } catch (error) {
      job.state = job.controller.signal.aborted ? "canceled" : "failed";
      job.error = String(error?.code ?? error?.message ?? error);
      job.progress = { stage: job.state, completed: 0, total: 1 };
    } finally {
      job.completedAt = now();
    }
  }

  function trimJobs() {
    if (jobs.size <= 100) return;
    for (const [id, job] of jobs) {
      if (["completed", "failed", "canceled"].includes(job.state)) jobs.delete(id);
      if (jobs.size <= 100) break;
    }
  }

  return { inspect, start, get, cancel };
}

function parseArticleDocument(html, pageUrl, provider) {
  const document = parse(html);
  const content = provider === "wechat"
    ? findNode(document, (node) => attr(node, "id") === "js_content")
      ?? findNode(document, (node) => hasClass(node, "rich_media_content"))
    : findNode(document, (node) => node.tagName === "article")
      ?? findNode(document, (node) => node.tagName === "main");
  const root = content ?? findNode(document, (node) => node.tagName === "body") ?? document;
  const media = [];
  const markdown = renderMarkdownNode(root, { pageUrl, media }).replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n").trim();
  const title = firstNonEmpty(
    metaContent(document, "property", "og:title"),
    metaContent(document, "name", "twitter:title"),
    provider === "wechat" ? textContent(findNode(document, (node) => hasClass(node, "rich_media_title"))) : "",
    textContent(findNode(document, (node) => node.tagName === "title")),
    "Imported article",
  );
  const author = firstNonEmpty(
    metaContent(document, "name", "author"),
    metaContent(document, "property", "article:author"),
    metaContent(document, "property", "og:article:author"),
    provider === "wechat" ? textContent(findNode(document, (node) => attr(node, "id") === "js_name")) : "",
  ) || null;
  const publishedAt = extractPublishedAt(document, html);
  return {
    title: cleanText(title),
    author: author ? cleanText(author) : null,
    publishedAt,
    media: media.slice(0, ARTICLE_IMPORT_LIMITS.mediaCount),
    markdown,
    plainText: cleanText(textContent(root)),
  };
}

function renderMarkdownNode(node, context) {
  if (!node) return "";
  if (node.nodeName === "#text") return escapeMarkdown(String(node.value ?? "").replace(/\s+/g, " "));
  const tag = node.tagName;
  if (SKIPPED_TAGS.has(tag)) return "";
  if (tag === "img") return renderMedia(node, "image", context);
  if (tag === "audio" || tag === "video") return renderMedia(node, tag, context);
  const children = () => (node.childNodes ?? []).map((child) => renderMarkdownNode(child, context)).join("");
  if (!tag || ["html", "body", "main", "article"].includes(tag)) return children();
  if (tag === "br") return "\n";
  if (/^h[1-6]$/.test(tag)) return `\n\n${"#".repeat(Number(tag[1]))} ${children().trim()}\n\n`;
  if (tag === "p" || tag === "div" || tag === "section" || tag === "figure" || tag === "figcaption") {
    const value = children().trim();
    return value ? `\n\n${value}\n\n` : "";
  }
  if (tag === "strong" || tag === "b") return `**${children().trim()}**`;
  if (tag === "em" || tag === "i") return `*${children().trim()}*`;
  if (tag === "del" || tag === "s") return `~~${children().trim()}~~`;
  if (tag === "code") return `\`${children().replaceAll("`", "\\`").trim()}\``;
  if (tag === "pre") return `\n\n\`\`\`\n${textContent(node).trim()}\n\`\`\`\n\n`;
  if (tag === "blockquote") {
    return `\n\n${children().trim().split("\n").map((line) => `> ${line}`).join("\n")}\n\n`;
  }
  if (tag === "hr") return "\n\n---\n\n";
  if (tag === "a") {
    const label = children().trim() || cleanText(attr(node, "href"));
    const href = resolveHttpUrl(attr(node, "href"), context.pageUrl);
    return href ? `[${label}](${href})` : label;
  }
  if (tag === "ul" || tag === "ol") {
    const ordered = tag === "ol";
    const items = (node.childNodes ?? []).filter((child) => child.tagName === "li");
    return `\n\n${items.map((item, index) => `${ordered ? `${index + 1}.` : "-"} ${renderMarkdownNode(item, context).trim()}`).join("\n")}\n\n`;
  }
  if (tag === "li") return children();
  return children();
}

function renderMedia(node, type, context) {
  const sourceNode = type === "image" ? null : findNode(node, (candidate) => candidate.tagName === "source");
  const rawUrl = firstNonEmpty(
    attr(node, "data-src"),
    attr(node, "data-original"),
    attr(node, "src"),
    sourceNode ? attr(sourceNode, "src") : "",
  );
  const sourceUrl = resolveHttpUrl(rawUrl, context.pageUrl);
  if (!sourceUrl) return "";
  const token = `@@MYAGENTTOOL_MEDIA_${context.media.length}@@`;
  context.media.push({
    token,
    type,
    sourceUrl,
    alt: cleanText(attr(node, "alt") || attr(node, "title") || type),
  });
  return `\n\n${token}\n\n`;
}

async function downloadMedia(media, options) {
  const entries = media.slice(0, options.limits.mediaCount);
  const results = new Array(entries.length);
  const digestFiles = new Map();
  let cursor = 0;
  let totalBytes = 0;
  const workers = Array.from({ length: Math.min(options.limits.mediaConcurrency, entries.length) }, async () => {
    while (cursor < entries.length) {
      const index = cursor++;
      const item = entries[index];
      try {
        const response = await fetchPublicResource(item.sourceUrl, {
          fetchImpl: options.fetchImpl,
          resolveHostname: options.resolveHostname,
          signal: options.signal,
          maxBytes: options.limits.mediaBytes,
          maxRedirects: options.limits.redirects,
          timeoutMs: options.limits.timeoutMs,
          accept: mediaAccept(item.type),
          referer: options.pageUrl,
        });
        totalBytes += response.bytes.length;
        if (totalBytes > options.limits.totalMediaBytes) throw articleError("article_total_media_too_large");
        const mimeType = detectMediaMime(response.bytes, response.contentType, item.type);
        const extension = MEDIA_EXTENSIONS.get(mimeType);
        if (!extension) throw articleError("article_media_type_refused");
        const digest = createHash("sha256").update(response.bytes).digest("hex");
        let filename = digestFiles.get(digest);
        if (!filename) {
          filename = `${String(index + 1).padStart(3, "0")}-${digest.slice(0, 12)}${extension}`;
          await writeFile(join(options.directory, filename), response.bytes, { flag: "wx" });
          digestFiles.set(digest, filename);
        }
        results[index] = {
          ...item,
          status: "downloaded",
          path: `assets/${filename}`,
          mimeType,
          size: response.bytes.length,
          hash: `sha256:${digest}`,
        };
      } catch (error) {
        if (options.signal?.aborted) throw error;
        results[index] = { ...item, status: "failed", path: null, error: String(error?.code ?? error?.message ?? error) };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

async function fetchPublicResource(value, {
  fetchImpl,
  resolveHostname,
  signal,
  maxBytes,
  maxRedirects,
  timeoutMs,
  accept,
  referer,
}) {
  let url = canonicalizeFetchUrl(value);
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const safety = await validateExternalWebhookTarget(url, {
      resolveHostname: resolveHostname ?? ((hostname) => resolveArticleHostname(hostname)),
    });
    if (!safety.ok) throw articleError("article_url_refused");
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept,
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
          ...(referer ? { referer } : {}),
        },
      });
    } catch (error) {
      if (signal?.aborted) throw articleError("article_import_canceled");
      throw articleError(error?.name === "AbortError" ? "article_download_timeout" : "article_download_failed");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirects >= maxRedirects) throw articleError("article_redirect_refused");
      url = canonicalizeFetchUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw articleError(`article_download_http_${response.status}`);
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) throw articleError("article_download_too_large");
    const bytes = await readBoundedBody(response.body, maxBytes, signal);
    return { url, bytes, contentType: response.headers.get("content-type") };
  }
  throw articleError("article_redirect_refused");
}

async function resolveArticleHostname(hostname) {
  const systemResults = await lookup(hostname, { all: true, verbatim: true });
  if (!systemResults.length || !systemResults.every((item) => isSyntheticProxyAddress(item.address))) {
    return systemResults;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const answers = [];
    for (const type of ["A", "AAAA"]) {
      const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`, {
        headers: { accept: "application/dns-json" },
        signal: controller.signal,
      });
      if (!response.ok) continue;
      const payload = await response.json();
      for (const answer of payload.Answer ?? []) {
        if ((answer.type === 1 || answer.type === 28) && isIP(answer.data)) {
          answers.push({ address: answer.data, family: answer.type === 1 ? 4 : 6 });
        }
      }
    }
    return answers.length ? answers : systemResults;
  } catch {
    return systemResults;
  } finally {
    clearTimeout(timer);
  }
}

function isSyntheticProxyAddress(address) {
  const value = String(address).toLowerCase();
  if (value.startsWith("fdfe:dcba:9876:")) return true;
  const parts = value.split(".").map(Number);
  return parts.length === 4 && parts[0] === 198 && (parts[1] === 18 || parts[1] === 19);
}

async function readBoundedBody(body, maxBytes, signal) {
  if (!body?.getReader) throw articleError("article_download_body_unavailable");
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    if (signal?.aborted) {
      await reader.cancel().catch(() => {});
      throw articleError("article_import_canceled");
    }
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw articleError("article_download_too_large");
    }
    chunks.push(Buffer.from(value));
  }
  if (!total) throw articleError("article_download_empty");
  return Buffer.concat(chunks, total);
}

function substituteMedia(markdown, downloaded) {
  let result = markdown;
  for (const item of downloaded) {
    const replacement = item.status === "downloaded"
      ? item.type === "image"
        ? `![${escapeMarkdown(item.alt || "image")}](${item.path})`
        : `[${item.type === "audio" ? "音频" : "视频"}：${escapeMarkdown(item.alt || item.type)}](${item.path})`
      : `*[${item.type === "image" ? "图片" : item.type === "audio" ? "音频" : "视频"}下载失败]*`;
    result = result.replaceAll(item.token, replacement);
  }
  return result.replace(/@@MYAGENTTOOL_MEDIA_\d+@@/g, "");
}

function renderFrontMatter(values) {
  const rows = [
    "---",
    `title: ${yamlString(values.title)}`,
    `source_provider: ${values.sourceProvider}`,
    `content_type: ${values.contentType}`,
    `source_url: ${yamlString(values.sourceUrl)}`,
    `canonical_url: ${yamlString(values.canonicalUrl)}`,
    `author: ${values.author ? yamlString(values.author) : "null"}`,
    `published_at: ${values.publishedAt}`,
    `imported_at: ${yamlString(values.importedAt)}`,
    `local_issue_id: ${yamlString(values.localIssueId)}`,
    `url_hash: ${values.urlHash}`,
    "---",
  ];
  return rows.join("\n");
}

async function existingImport(directory, canonicalUrl) {
  try {
    const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
    if (manifest.status !== "complete" || manifest.canonicalUrl !== canonicalUrl) return null;
    const markdownInfo = await stat(join(directory, "article.md"));
    const manifestInfo = await stat(join(directory, "manifest.json"));
    const relativeDirectory = directory.split(sep).join("/").match(/docs\/imported\/.+$/)?.[0];
    if (!relativeDirectory) return null;
    return {
      relativeDirectory,
      markdownPath: `${relativeDirectory}/article.md`,
      manifestPath: `${relativeDirectory}/manifest.json`,
      markdownSize: markdownInfo.size,
      manifestSize: manifestInfo.size,
      mediaCounts: countMedia((manifest.media ?? []).filter((item) => item.status === "downloaded")),
      warnings: manifest.warnings ?? [],
    };
  } catch {
    return null;
  }
}

async function ensureSafeDirectory(root, relativePath) {
  let current = root;
  for (const segment of String(relativePath).split(sep).filter(Boolean)) {
    current = join(current, segment);
    assertConfined(root, current);
    if (existsSync(current)) {
      if (lstatSync(current).isSymbolicLink()) throw articleError("article_output_path_refused");
    } else {
      await mkdir(current);
    }
  }
}

function assertConfined(root, target) {
  const rel = relative(root, target);
  if (!rel || rel === ".") return;
  if (rel === ".." || rel.startsWith(`..${sep}`) || resolve(root, rel) !== resolve(target)) {
    throw articleError("article_output_path_refused");
  }
}

function articleAsset(path, family, size, item, worktreeId) {
  const digest = createHash("sha256").update(path).digest("hex");
  return {
    id: `asset_${digest.slice(0, 24)}`,
    path,
    family,
    terminalId: item.terminalId,
    size,
    resourceClass: size > 1024 * 1024 ? "medium" : "small",
    hash: null,
    version: digest,
    worktreeId,
    capabilities: [],
    readiness: { state: "ready", reason: "available_on_owning_terminal" },
  };
}

function jobView(job) {
  return {
    id: job.id,
    workItemId: job.workItemId,
    worktreeId: job.worktreeId,
    canonicalUrl: job.canonicalUrl,
    state: job.state,
    progress: job.progress,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    error: job.error,
    result: job.result,
  };
}

function articleFailure(error) {
  const code = String(error?.code ?? error?.message ?? "article_import_failed");
  const status = code === "work_item_not_found" ? 404
    : code.includes("already_active") || code.includes("conflict") ? 409
      : code.includes("timeout") || code.includes("download_http_5") ? 503
        : 400;
  return { ok: false, status, body: { error: code } };
}

function articleError(code) {
  return Object.assign(new Error(code), { code });
}

function canonicalizeFetchUrl(value) {
  const url = new URL(String(value ?? "").trim());
  if (url.protocol !== "https:" || url.username || url.password) throw articleError("article_url_refused");
  return url.toString();
}

function countMedia(media) {
  const counts = { images: 0, audio: 0, video: 0 };
  for (const item of media) {
    if (item.type === "image") counts.images += 1;
    else if (item.type === "audio") counts.audio += 1;
    else if (item.type === "video") counts.video += 1;
  }
  return counts;
}

function findNode(node, predicate) {
  if (!node) return null;
  if (predicate(node)) return node;
  for (const child of node.childNodes ?? []) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return null;
}

function attr(node, name) {
  return node?.attrs?.find((item) => item.name === name)?.value ?? "";
}

function hasClass(node, value) {
  return attr(node, "class").split(/\s+/).includes(value);
}

function textContent(node) {
  if (!node) return "";
  if (node.nodeName === "#text") return String(node.value ?? "");
  return (node.childNodes ?? []).map(textContent).join("");
}

function metaContent(document, attribute, value) {
  return attr(findNode(document, (node) => node.tagName === "meta" && attr(node, attribute).toLowerCase() === value), "content");
}

function extractPublishedAt(document, html) {
  const candidates = [
    metaContent(document, "property", "article:published_time"),
    metaContent(document, "name", "publishdate"),
    metaContent(document, "name", "date"),
  ];
  const epoch = html.match(/(?:publish_time|\bct\b|["']ct["'])\s*[:=]\s*["']?(\d{10})/)?.[1];
  if (epoch) candidates.push(new Date(Number(epoch) * 1000).toISOString());
  for (const value of candidates) {
    if (!value) continue;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    const dateOnly = String(value).match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (dateOnly) return dateOnly;
  }
  return null;
}

function firstNonEmpty(...values) {
  return values.find((value) => String(value ?? "").trim()) ?? "";
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function safeArticleSlug(value) {
  const slug = cleanText(value).normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/[-_.]{2,}/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 60);
  return slug || "article";
}

function escapeMarkdown(value) {
  return String(value ?? "").replace(/([\\`*_[\]<>])/g, "\\$1");
}

function resolveHttpUrl(value, base) {
  if (!value || String(value).startsWith("data:") || String(value).startsWith("blob:")) return null;
  try {
    const url = new URL(String(value), base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizedMime(value) {
  return String(value ?? "").split(";")[0].trim().toLowerCase();
}

function mediaAccept(type) {
  return type === "image" ? "image/avif,image/webp,image/png,image/jpeg,image/gif"
    : type === "audio" ? "audio/mpeg,audio/mp4,audio/ogg,audio/wav"
      : "video/mp4,video/webm,video/quicktime";
}

function detectMediaMime(bytes, declared, expectedType) {
  const mime = normalizedMime(declared);
  let detected = null;
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) detected = "image/png";
  else if (bytes[0] === 0xff && bytes[1] === 0xd8) detected = "image/jpeg";
  else if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) detected = "image/gif";
  else if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") detected = "image/webp";
  else if (bytes.subarray(4, 8).toString("ascii") === "ftyp") {
    detected = expectedType === "audio" ? "audio/mp4" : expectedType === "video" ? "video/mp4" : null;
  } else if (bytes.subarray(0, 3).toString("ascii") === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) {
    detected = "audio/mpeg";
  } else if (bytes.subarray(0, 4).toString("ascii") === "OggS") {
    detected = expectedType === "audio" ? "audio/ogg" : "video/webm";
  }
  if (!detected && MEDIA_EXTENSIONS.has(mime)) detected = mime;
  if (!detected || !detected.startsWith(`${expectedType}/`)) throw articleError("article_media_signature_mismatch");
  if (mime && mime !== "application/octet-stream" && !mime.startsWith(`${expectedType}/`)) {
    throw articleError("article_media_mime_mismatch");
  }
  return detected;
}

function yamlString(value) {
  return JSON.stringify(String(value ?? ""));
}
