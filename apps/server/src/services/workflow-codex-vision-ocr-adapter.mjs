import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, isAbsolute, join, resolve } from "node:path";

import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import {
  PRIVATE_TUTOR_MATH_AST_NODE_TYPES,
  PRIVATE_TUTOR_TEXTBOOK_BLOCK_TYPES,
  PRIVATE_TUTOR_TEXTBOOK_PAGE_SCHEMA_VERSION,
  PRIVATE_TUTOR_VERTICAL_MATH_ROW_ROLES,
} from "./private-tutor-textbook-page-schema.mjs";

const require = createRequire(import.meta.url);
const SUPPORTED_EXTENSIONS = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp"]);
const MAX_PAGES = 300;
const PAGES_PER_REQUEST = 8;
const MAX_PAGE_CHARS = 80_000;
const MAX_PROCESS_OUTPUT_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 8 * 60_000;
const TEXTBOOK_BLOCK_TYPES = new Set(PRIVATE_TUTOR_TEXTBOOK_BLOCK_TYPES);
const MATH_AST_NODE_TYPES = new Set(PRIVATE_TUTOR_MATH_AST_NODE_TYPES);
const VERTICAL_MATH_ROW_ROLES = new Set(PRIVATE_TUTOR_VERTICAL_MATH_ROW_ROLES);

const BOX_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["x", "y", "width", "height"],
  properties: {
    x: { type: "number", minimum: 0, maximum: 1 },
    y: { type: "number", minimum: 0, maximum: 1 },
    width: { type: "number", minimum: 0, maximum: 1 },
    height: { type: "number", minimum: 0, maximum: 1 },
  },
};

const MATH_SCHEMA = {
  anyOf: [
    { type: "null" },
    {
      type: "object",
      additionalProperties: false,
      required: ["notation", "confidence", "ast", "vertical"],
      properties: {
        notation: { type: "string", maxLength: 1_000 },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        ast: {
          anyOf: [
            { type: "null" },
            {
              type: "object",
              additionalProperties: false,
              required: ["rootId", "nodes"],
              properties: {
                rootId: { type: "string", maxLength: 40 },
                nodes: {
                  type: "array",
                  maxItems: 200,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["id", "type", "value", "childIds"],
                    properties: {
                      id: { type: "string", maxLength: 40 },
                      type: { type: "string", enum: [...PRIVATE_TUTOR_MATH_AST_NODE_TYPES] },
                      value: { type: "string", maxLength: 200 },
                      childIds: { type: "array", maxItems: 20, items: { type: "string", maxLength: 40 } },
                    },
                  },
                },
              },
            },
          ],
        },
        vertical: {
          anyOf: [
            { type: "null" },
            {
              type: "object",
              additionalProperties: false,
              required: ["operator", "rows"],
              properties: {
                operator: { type: "string", enum: ["add", "subtract", "multiply", "divide", "other"] },
                rows: {
                  type: "array",
                  maxItems: 30,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["role", "text", "indent"],
                    properties: {
                      role: { type: "string", enum: [...PRIVATE_TUTOR_VERTICAL_MATH_ROW_ROLES] },
                      text: { type: "string", maxLength: 200 },
                      indent: { type: "integer", minimum: 0, maximum: 40 },
                    },
                  },
                },
              },
            },
          ],
        },
      },
    },
  ],
};

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
        required: ["index", "printedPageNumber", "text", "confidence", "blocks"],
        properties: {
          index: { type: "integer", minimum: 1, maximum: MAX_PAGES },
          printedPageNumber: { type: "string", maxLength: 40 },
          text: { type: "string", maxLength: MAX_PAGE_CHARS },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          blocks: {
            type: "array",
            maxItems: 2_000,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["order", "type", "text", "confidence", "box", "math"],
              properties: {
                order: { type: "integer", minimum: 1, maximum: 2_000 },
                type: {
                  type: "string",
                  enum: ["heading", "paragraph", "formula", "table", "worked_example", "exercise", "illustration_caption", "other"],
                },
                text: { type: "string", maxLength: 2_000 },
                confidence: { type: "number", minimum: 0, maximum: 1 },
                box: BOX_SCHEMA,
                math: MATH_SCHEMA,
              },
            },
          },
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

function boundedNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function normalizeBox(value) {
  const x = boundedNumber(value?.x);
  const y = boundedNumber(value?.y);
  const width = Math.min(boundedNumber(value?.width, 1), 1 - x);
  const height = Math.min(boundedNumber(value?.height, 1), 1 - y);
  if (width <= 0 || height <= 0) return { x: 0, y: 0, width: 1, height: 1 };
  return { x, y, width, height };
}

function normalizeMath(value, blockConfidence) {
  if (!value || typeof value !== "object") return null;
  const notation = boundedText(value.notation, 1_000).trim();
  const rawNodes = Array.isArray(value.ast?.nodes) ? value.ast.nodes.slice(0, 200) : [];
  const nodes = [];
  const nodeIds = new Set();
  for (const [offset, rawNode] of rawNodes.entries()) {
    let id = boundedText(rawNode?.id, 40).trim() || `node_${offset + 1}`;
    if (nodeIds.has(id)) id = `node_${offset + 1}`;
    nodeIds.add(id);
    nodes.push({
      id,
      type: MATH_AST_NODE_TYPES.has(rawNode?.type) ? rawNode.type : "unknown",
      value: boundedText(rawNode?.value, 200).trim(),
      childIds: Array.isArray(rawNode?.childIds)
        ? rawNode.childIds.slice(0, 20).map((childId) => boundedText(childId, 40).trim()).filter(Boolean)
        : [],
    });
  }
  for (const node of nodes) node.childIds = node.childIds.filter((childId) => nodeIds.has(childId) && childId !== node.id);
  const requestedRootId = boundedText(value.ast?.rootId, 40).trim();
  const rootId = nodeIds.has(requestedRootId) ? requestedRootId : nodes[0]?.id;
  const byNodeId = new Map(nodes.map((node) => [node.id, node]));
  const reachable = new Set();
  const visiting = new Set();
  function visit(nodeId) {
    const node = byNodeId.get(nodeId);
    if (!node || visiting.has(nodeId)) return false;
    if (reachable.has(nodeId)) return true;
    visiting.add(nodeId);
    node.childIds = node.childIds.filter((childId) => visit(childId));
    visiting.delete(nodeId);
    reachable.add(nodeId);
    return true;
  }
  if (rootId) visit(rootId);
  const astNodes = nodes.filter((node) => reachable.has(node.id));
  const ast = rootId && astNodes.length > 0 ? { rootId, nodes: astNodes } : null;
  const rows = Array.isArray(value.vertical?.rows) ? value.vertical.rows.slice(0, 30).map((row) => ({
    role: VERTICAL_MATH_ROW_ROLES.has(row?.role) ? row.role : "operand",
    text: boundedText(row?.text, 200).trim(),
    indent: Math.max(0, Math.min(40, Math.trunc(Number(row?.indent) || 0))),
  })).filter((row) => row.text) : [];
  const vertical = rows.length > 0 ? {
    operator: ["add", "subtract", "multiply", "divide", "other"].includes(value.vertical?.operator)
      ? value.vertical.operator
      : "other",
    rows,
  } : null;
  if (!notation && !ast && !vertical) return null;
  return {
    notation,
    confidence: boundedNumber(value.confidence, blockConfidence),
    ast,
    vertical,
  };
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
    const pageConfidence = Math.max(0, Math.min(1, Number(page.confidence)));
    const suppliedBlocks = Array.isArray(page.blocks) ? page.blocks : [];
    const blocks = suppliedBlocks.length > 0
      ? suppliedBlocks.slice(0, 2_000).map((block, offset) => {
          const confidence = boundedNumber(block?.confidence);
          return {
          order: Number.isInteger(Number(block?.order)) ? Number(block.order) : offset + 1,
          type: TEXTBOOK_BLOCK_TYPES.has(block?.type) ? block.type : "other",
          text: boundedText(block?.text, 2_000).trim(),
          confidence,
          box: normalizeBox(block?.box),
          math: normalizeMath(block?.math, confidence),
        };
        }).filter((block) => block.text)
      : text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 2_000)
        .map((line, offset) => ({ order: offset + 1, type: "paragraph", text: boundedText(line, 2_000), confidence: pageConfidence, box: { x: 0, y: 0, width: 1, height: 1 }, math: null }));
    const evidence = blocks.map((block) => ({
      text: block.text,
      confidence: block.confidence,
      box: block.box,
    }));
    return {
      schemaVersion: PRIVATE_TUTOR_TEXTBOOK_PAGE_SCHEMA_VERSION,
      index: expected.index,
      printedPageNumber: boundedText(page.printedPageNumber, 40).trim() || null,
      text,
      confidence: pageConfidence,
      width: expected.width ?? null,
      height: expected.height ?? null,
      coordinateSystem: "normalized",
      blocks,
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
        const recognitionDirectory = join(workingDirectory, "recognition", PRIVATE_TUTOR_TEXTBOOK_PAGE_SCHEMA_VERSION);
        mkdirSync(recognitionDirectory, { recursive: true });
        const schemaPath = join(workingDirectory, `ocr-output.${PRIVATE_TUTOR_TEXTBOOK_PAGE_SCHEMA_VERSION}.schema.json`);
        atomicWrite(schemaPath, JSON.stringify(OUTPUT_SCHEMA));
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
            "--output-schema", schemaPath,
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
            "把阅读顺序拆成 blocks，并把公式、例题、练习、表格与普通段落分类；printedPageNumber 只填写页面上实际印刷的页码，看不到时返回空字符串。",
            "每个 block 的 box 使用相对整页的归一化坐标 x、y、width、height（左上角为原点，范围 0 到 1）。",
            "数学内容必须填写 math：notation 使用 LaTeX 或忠实的线性表达；ast 用 rootId 和 nodes 表示语法树，childIds 保留运算顺序；竖式另填 vertical，逐行标注 role、原文 text 和右对齐缩进 indent。非数学块的 math 返回 null。",
            `附件依次对应原文第 ${pageNumbers} 页。返回 pages 数组，每页 index 必须使用原文页码。`,
            `schema 版本是 ${PRIVATE_TUTOR_TEXTBOOK_PAGE_SCHEMA_VERSION}。confidence 是页或文字块的识别可信度（0 到 1）。只返回符合指定 JSON Schema 的结果。`,
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
            schemaVersion: page.schemaVersion,
            index: page.index,
            printedPageNumber: page.printedPageNumber ?? "",
            text: page.text,
            confidence: page.confidence,
            blocks: page.blocks,
          })) }));
          rmSync(outputPath, { force: true });
          recognized.push(...normalized);
          onProgress({ completedPages: Math.min(offset + batch.length, pages.length), totalPages: pages.length });
        }
        return {
          providerId: "codex-vision",
          providerVersion: config.model ?? "codex-default",
          schemaVersion: PRIVATE_TUTOR_TEXTBOOK_PAGE_SCHEMA_VERSION,
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
