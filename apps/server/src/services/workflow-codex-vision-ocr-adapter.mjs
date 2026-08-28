import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, isAbsolute, join, resolve } from "node:path";

import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const require = createRequire(import.meta.url);
const SUPPORTED_EXTENSIONS = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp"]);
const MAX_PAGES = 300;
const PAGES_PER_REQUEST = 8;
const MAX_PAGE_CHARS = 80_000;
const MAX_PROCESS_OUTPUT_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 8 * 60_000;

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["pages"],
  properties: {
    pages: {
      type: "array",
      minItems: 1,
      maxItems: PAGES_PER_REQUEST,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "text", "confidence"],
        properties: {
          index: { type: "integer", minimum: 1, maximum: MAX_PAGES },
          text: { type: "string", maxLength: MAX_PAGE_CHARS },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
  },
};

function codedError(message, code) {
  return Object.assign(new Error(message), { code });
}

function boundedText(value, max = MAX_PAGE_CHARS) {
  return String(value ?? "").replaceAll("\0", "").slice(0, max);
}

function codexCliPath() {
  try {
    return require.resolve("@openai/codex/bin/codex.js");
  } catch {
    return null;
  }
}

export function resolveCodexVisionOcrConfig({ env = process.env, cliPath = codexCliPath() } = {}) {
  const mode = String(env.MYAGENTTOOL_WORKFLOW_CODEX_OCR ?? "auto").trim().toLowerCase();
  const enabled = mode !== "off" && Boolean(cliPath && existsSync(cliPath));
  return {
    enabled,
    providerId: enabled ? "codex-vision" : null,
    providerVersion: enabled ? "codex-cli" : null,
    reason: enabled
      ? null
      : mode === "off"
        ? "workflow_codex_ocr_disabled"
        : "workflow_codex_ocr_unavailable",
    command: enabled ? process.execPath : null,
    cliPath: enabled ? cliPath : null,
    model: String(env.MYAGENTTOOL_WORKFLOW_CODEX_OCR_MODEL ?? "").trim().slice(0, 200) || null,
    timeoutMs: Math.max(30_000, Math.min(
      15 * 60_000,
      Number(env.MYAGENTTOOL_WORKFLOW_CODEX_OCR_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
    )),
  };
}

export async function renderPdfForVision(path, outputDirectory, {
  maxPages = MAX_PAGES,
  scale = 2,
} = {}) {
  mkdirSync(outputDirectory, { recursive: true });
  const bytes = new Uint8Array(readFileSync(path));
  const loadingTask = getDocument({
    data: bytes,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const document = await loadingTask.promise;
  try {
    if (document.numPages > maxPages) {
      throw codedError(
        `Scanned PDF has ${document.numPages} pages; the Codex OCR limit is ${maxPages}.`,
        "workflow_codex_ocr_page_limit_exceeded",
      );
    }
    const rendered = [];
    for (let index = 1; index <= document.numPages; index += 1) {
      const page = await document.getPage(index);
      const initial = page.getViewport({ scale });
      const reduction = Math.min(1, 2400 / Math.max(initial.width, initial.height));
      const viewport = reduction < 1 ? page.getViewport({ scale: scale * reduction }) : initial;
      const width = Math.max(1, Math.ceil(viewport.width));
      const height = Math.max(1, Math.ceil(viewport.height));
      const canvas = createCanvas(width, height);
      const imagePath = join(outputDirectory, `page-${String(index).padStart(3, "0")}.png`);
      if (!existsSync(imagePath) || statSync(imagePath).size < 8) {
        await page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport }).promise;
        atomicWrite(imagePath, canvas.toBuffer("image/png"));
      }
      rendered.push({ index, path: imagePath, width, height });
      page.cleanup();
    }
    return rendered;
  } finally {
    await loadingTask.destroy();
  }
}

function atomicWrite(path, data) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, data, { mode: 0o600 });
  renameSync(temporaryPath, path);
}

function cachedBatch(path, expectedPages) {
  if (!existsSync(path)) return null;
  try {
    return normalizeCodexPages(JSON.parse(readFileSync(path, "utf8")), expectedPages);
  } catch {
    return null;
  }
}

export function runCodexVisionProcess(command, args, {
  prompt,
  cwd,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal,
} = {}) {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) {
      reject(codedError("Codex OCR was cancelled.", "workflow_ocr_cancelled"));
      return;
    }
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    let outputBytes = 0;
    const stderr = [];
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolvePromise(result);
    };
    const abort = () => {
      child.kill("SIGKILL");
      finish(codedError("Codex OCR was cancelled.", "workflow_ocr_cancelled"));
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(codedError("Codex OCR timed out.", "workflow_codex_ocr_timeout"));
    }, timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_PROCESS_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        finish(codedError("Codex OCR output exceeded its safety limit.", "workflow_codex_ocr_output_too_large"));
      }
    });
    child.stderr.on("data", (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes <= MAX_PROCESS_OUTPUT_BYTES) stderr.push(chunk);
      else {
        child.kill("SIGKILL");
        finish(codedError("Codex OCR output exceeded its safety limit.", "workflow_codex_ocr_output_too_large"));
      }
    });
    child.once("error", (error) => finish(Object.assign(
      codedError("Codex OCR could not start.", "workflow_codex_ocr_unavailable"),
      { cause: error },
    )));
    child.once("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        const detail = boundedText(Buffer.concat(stderr).toString("utf8").trim(), 800);
        const authFailure = /not logged in|authentication|unauthorized|login/i.test(detail);
        finish(codedError(
          detail || "Codex OCR failed.",
          authFailure ? "workflow_codex_ocr_not_authenticated" : "workflow_codex_ocr_failed",
        ));
        return;
      }
      finish(null, { code });
    });
    child.stdin.end(`${prompt}\n`);
  });
}

function normalizeCodexPages(payload, expectedPages) {
  if (!payload || !Array.isArray(payload.pages)) {
    throw codedError("Codex OCR returned an invalid result.", "workflow_codex_ocr_invalid_result");
  }
  const byIndex = new Map(payload.pages.map((page) => [Number(page?.index), page]));
  return expectedPages.map((expected) => {
    const page = byIndex.get(expected.index);
    if (!page || typeof page.text !== "string" || !Number.isFinite(Number(page.confidence))) {
      throw codedError("Codex OCR omitted a required page.", "workflow_codex_ocr_invalid_result");
    }
    const text = boundedText(page.text);
    const evidence = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 2_000)
      .map((line) => ({
        text: boundedText(line, 2_000),
        confidence: Math.max(0, Math.min(1, Number(page.confidence))),
        box: { x: 0, y: 0, width: 1, height: 1 },
      }));
    return {
      index: expected.index,
      text,
      confidence: Math.max(0, Math.min(1, Number(page.confidence))),
      width: expected.width ?? null,
      height: expected.height ?? null,
      evidence,
    };
  });
}

export function createCodexVisionOcrAdapter({
  config = resolveCodexVisionOcrConfig(),
  renderPdf = renderPdfForVision,
  run = runCodexVisionProcess,
} = {}) {
  return {
    providerId: config.providerId,
    readiness() {
      return {
        state: config.enabled ? "ready" : "unavailable",
        providerId: config.providerId,
        providerVersion: config.providerVersion ?? config.model ?? null,
        reason: config.reason,
        localOnly: false,
        requiresCloudConsent: true,
        supportedExtensions: [...SUPPORTED_EXTENSIONS],
      };
    },
    async recognize({ path, signal, onProgress = () => {}, cloudAllowed = false, artifactRoot = null } = {}) {
      if (!cloudAllowed) {
        throw codedError(
          "Codex OCR requires permission to send copied pages for AI recognition.",
          "workflow_ocr_cloud_confirmation_required",
        );
      }
      if (!config.enabled || !config.command || !config.cliPath) {
        throw codedError("Codex OCR is unavailable.", config.reason ?? "workflow_codex_ocr_unavailable");
      }
      const extension = typeof path === "string" ? extname(path).toLowerCase() : "";
      if (typeof path !== "string" || !isAbsolute(path) || !SUPPORTED_EXTENSIONS.has(extension)) {
        throw codedError("Codex OCR requires an absolute PDF or image path.", "workflow_ocr_invalid_input");
      }
      const temporary = !artifactRoot;
      const workingDirectory = temporary
        ? mkdtempSync(join(tmpdir(), "myagenttool-codex-ocr-"))
        : resolve(artifactRoot);
      try {
        mkdirSync(workingDirectory, { recursive: true });
        const pagesDirectory = join(workingDirectory, "pages");
        const recognitionDirectory = join(workingDirectory, "recognition");
        mkdirSync(recognitionDirectory, { recursive: true });
        atomicWrite(join(workingDirectory, "ocr-output.schema.json"), JSON.stringify(OUTPUT_SCHEMA));
        const pages = extension === ".pdf"
          ? await renderPdf(resolve(path), pagesDirectory)
          : [{ index: 1, path: resolve(path), width: null, height: null }];
        const recognized = [];
        for (let offset = 0; offset < pages.length; offset += PAGES_PER_REQUEST) {
          const batch = pages.slice(offset, offset + PAGES_PER_REQUEST);
          const shardName = `pages-${String(batch[0].index).padStart(3, "0")}-${String(batch.at(-1).index).padStart(3, "0")}.json`;
          const shardPath = join(recognitionDirectory, shardName);
          const cached = cachedBatch(shardPath, batch);
          if (cached) {
            recognized.push(...cached);
            onProgress({ completedPages: Math.min(offset + batch.length, pages.length), totalPages: pages.length, resumed: true });
            continue;
          }
          const outputPath = join(workingDirectory, `${shardName}.${process.pid}.pending`);
          const args = [
            config.cliPath,
            "exec",
            "--ephemeral",
            "--ignore-user-config",
            "--ignore-rules",
            "--sandbox", "read-only",
            "--skip-git-repo-check",
            "--output-schema", join(workingDirectory, "ocr-output.schema.json"),
            "--output-last-message", outputPath,
            "-C", workingDirectory,
          ];
          if (config.model) args.push("--model", config.model);
          for (const page of batch) args.push("--image", page.path);
          args.push("-");
          const pageNumbers = batch.map((page) => page.index).join(", ");
          const prompt = [
            "你是文档文字识别器。请逐页忠实抄录附件图片中的全部可见文字。",
            "保留标题、段落、编号和表格行列关系；无法确定的字符使用〔不清楚〕，不要推测或总结。",
            `附件依次对应原文第 ${pageNumbers} 页。返回 pages 数组，每页 index 必须使用原文页码。`,
            "confidence 是该页整体识别可信度（0 到 1）。只返回符合指定 JSON Schema 的结果。",
          ].join("\n");
          await run(config.command, args, {
            prompt,
            cwd: workingDirectory,
            timeoutMs: config.timeoutMs,
            signal,
          });
          let payload;
          try {
            payload = JSON.parse(readFileSync(outputPath, "utf8"));
          } catch {
            throw codedError("Codex OCR returned malformed JSON.", "workflow_codex_ocr_invalid_result");
          }
          const normalized = normalizeCodexPages(payload, batch);
          atomicWrite(shardPath, JSON.stringify({ pages: normalized.map((page) => ({
            index: page.index,
            text: page.text,
            confidence: page.confidence,
          })) }));
          rmSync(outputPath, { force: true });
          recognized.push(...normalized);
          onProgress({ completedPages: Math.min(offset + batch.length, pages.length), totalPages: pages.length });
        }
        return {
          providerId: "codex-vision",
          providerVersion: config.model ?? "codex-default",
          inputKind: extension === ".pdf" ? "pdf" : "image",
          pageCount: recognized.length,
          pages: recognized,
          localOnly: false,
        };
      } finally {
        if (temporary) rmSync(workingDirectory, { recursive: true, force: true });
      }
    },
  };
}

export function createFallbackWorkflowOcrAdapter({ localAdapter, codexAdapter } = {}) {
  const localReadiness = localAdapter?.readiness?.() ?? {
    state: "unavailable", providerId: null, reason: "workflow_ocr_provider_unavailable",
  };
  const codexReadiness = codexAdapter?.readiness?.() ?? {
    state: "unavailable", providerId: null, reason: "workflow_codex_ocr_unavailable",
  };
  return {
    providerId: localReadiness.state === "ready" ? localReadiness.providerId : codexReadiness.providerId,
    readiness() {
      const localReady = localReadiness.state === "ready";
      const codexReady = codexReadiness.state === "ready";
      return {
        state: localReady || codexReady ? "ready" : "unavailable",
        providerId: localReady ? localReadiness.providerId : codexReadiness.providerId,
        providerVersion: localReady ? localReadiness.providerVersion ?? null : codexReadiness.providerVersion ?? null,
        reason: localReady || codexReady ? null : localReadiness.reason ?? codexReadiness.reason,
        localOnly: localReady,
        requiresCloudConsent: !localReady && codexReady,
        supportedExtensions: localReadiness.supportedExtensions ?? codexReadiness.supportedExtensions,
        local: localReadiness,
        cloudFallback: codexReadiness,
      };
    },
    async recognize(input = {}) {
      if (localReadiness.state === "ready" && localAdapter?.recognize) {
        try {
          return await localAdapter.recognize(input);
        } catch (error) {
          if (!["workflow_ocr_provider_unavailable", "workflow_ocr_start_failed"].includes(error?.code)) throw error;
        }
      }
      if (codexReadiness.state !== "ready" || !codexAdapter?.recognize) {
        throw codedError("No OCR provider is available.", codexReadiness.reason ?? localReadiness.reason);
      }
      return codexAdapter.recognize(input);
    },
  };
}
