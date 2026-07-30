import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_OUTPUT_BYTES = 12 * 1024 * 1024;
const MAX_PAGES = 300;
const MAX_PAGE_CHARS = 80_000;
const MAX_EVIDENCE_PER_PAGE = 2_000;
const SUPPORTED_EXTENSIONS = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp"]);
const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCRIPT = resolve(__dirname, "../../scripts/macos-vision-pdf-ocr.swift");

function boundedText(value, max) {
  return String(value ?? "").replaceAll("\0", "").slice(0, max);
}

function normalizeResult(value) {
  if (!value || value.providerId !== "macos-vision"
    || !Number.isInteger(value.pageCount)
    || value.pageCount < 1
    || value.pageCount > MAX_PAGES
    || !Array.isArray(value.pages)
    || value.pages.length !== value.pageCount) {
    throw Object.assign(new Error("Local OCR returned an invalid result."), {
      code: "workflow_ocr_invalid_result",
    });
  }
  const pages = value.pages.map((page, offset) => {
    if (page?.index !== offset + 1 || !Array.isArray(page.evidence)) {
      throw Object.assign(new Error("Local OCR returned invalid page evidence."), {
        code: "workflow_ocr_invalid_result",
      });
    }
    return {
      index: page.index,
      text: boundedText(page.text, MAX_PAGE_CHARS),
      confidence: Math.max(0, Math.min(1, Number(page.confidence) || 0)),
      width: Number.isInteger(page.width) && page.width > 0 ? page.width : null,
      height: Number.isInteger(page.height) && page.height > 0 ? page.height : null,
      evidence: page.evidence.slice(0, MAX_EVIDENCE_PER_PAGE).map((entry) => ({
        text: boundedText(entry?.text, 2_000),
        confidence: Math.max(0, Math.min(1, Number(entry?.confidence) || 0)),
        box: {
          x: Math.max(0, Math.min(1, Number(entry?.box?.x) || 0)),
          y: Math.max(0, Math.min(1, Number(entry?.box?.y) || 0)),
          width: Math.max(0, Math.min(1, Number(entry?.box?.width) || 0)),
          height: Math.max(0, Math.min(1, Number(entry?.box?.height) || 0)),
        },
      })).filter((entry) => entry.text),
    };
  });
  return {
    providerId: value.providerId,
    providerVersion: boundedText(value.providerVersion, 200),
    inputKind: value.inputKind === "image" ? "image" : "pdf",
    pageCount: value.pageCount,
    pages,
  };
}

export function runWorkflowOcrProcess(command, args, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal,
  onProgress = () => {},
} = {}) {
  return new Promise((resolvePromise, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error("Local OCR was cancelled."), {
        code: "workflow_ocr_cancelled",
      }));
      return;
    }
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        TMPDIR: process.env.TMPDIR ?? "",
        LANG: process.env.LANG ?? "en_US.UTF-8",
      },
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stderrPending = "";
    let settled = false;
    const abort = () => {
      child.kill("SIGKILL");
      finish(Object.assign(new Error("Local OCR was cancelled."), {
        code: "workflow_ocr_cancelled",
      }));
    };
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolvePromise(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(Object.assign(new Error("Local OCR timed out."), {
        code: "workflow_ocr_timeout",
      }));
    }, timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        finish(Object.assign(new Error("Local OCR output exceeded its safety limit."), {
          code: "workflow_ocr_output_too_large",
        }));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 64 * 1024) return;
      stderrPending += chunk.toString("utf8");
      const lines = stderrPending.split(/\r?\n/);
      stderrPending = lines.pop() ?? "";
      for (const line of lines) {
        const progress = line.match(/^MYAGENTTOOL_OCR_PROGRESS (\d+)\/(\d+)$/);
        if (progress) {
          const completedPages = Number(progress[1]);
          const totalPages = Number(progress[2]);
          if (completedPages >= 1 && totalPages >= completedPages && totalPages <= MAX_PAGES) {
            try {
              onProgress({ completedPages, totalPages });
            } catch {
              // Progress reporting must not interrupt the OCR process.
            }
          }
        } else if (line) {
          stderr.push(Buffer.from(`${line}\n`));
        }
      }
    });
    child.once("error", (error) => {
      finish(Object.assign(new Error("Local OCR could not start."), {
        code: error?.code === "ENOENT"
          ? "workflow_ocr_provider_unavailable"
          : "workflow_ocr_start_failed",
      }));
    });
    child.once("close", (code) => {
      if (settled) return;
      if (stderrPending && stderrBytes <= 64 * 1024) {
        stderr.push(Buffer.from(stderrPending));
      }
      if (code !== 0) {
        finish(Object.assign(new Error(
          boundedText(Buffer.concat(stderr).toString("utf8").trim(), 500)
            || "Local OCR failed.",
        ), { code: "workflow_ocr_failed" }));
        return;
      }
      finish(null, Buffer.concat(stdout).toString("utf8"));
    });
  });
}

export function resolveWorkflowOcrConfig({
  platform = process.platform,
  env = process.env,
} = {}) {
  const enabled = String(env.MYAGENTTOOL_WORKFLOW_OCR ?? "auto").trim().toLowerCase();
  const scriptPath = DEFAULT_SCRIPT;
  const available = platform === "darwin"
    && enabled !== "off"
    && existsSync("/usr/bin/swift")
    && existsSync(scriptPath);
  return {
    enabled: available,
    providerId: available ? "macos-vision" : null,
    reason: available
      ? null
      : platform !== "darwin"
        ? "workflow_ocr_platform_unsupported"
        : enabled === "off"
          ? "workflow_ocr_disabled"
          : "workflow_ocr_provider_unavailable",
    command: available ? "/usr/bin/swift" : null,
    scriptPath,
  };
}

export function createLocalWorkflowOcrAdapter({
  config = resolveWorkflowOcrConfig(),
  run = runWorkflowOcrProcess,
} = {}) {
  const recognize = async ({ path, signal, onProgress } = {}) => {
    if (!config.enabled || !config.command) {
      throw Object.assign(new Error("No local OCR provider is available."), {
        code: config.reason ?? "workflow_ocr_provider_unavailable",
      });
    }
    const extension = typeof path === "string" ? extname(path).toLowerCase() : "";
    if (typeof path !== "string" || !isAbsolute(path) || !SUPPORTED_EXTENSIONS.has(extension)) {
      throw Object.assign(new Error("Local OCR requires an absolute PDF or image path."), {
        code: "workflow_ocr_invalid_input",
      });
    }
    const output = await run(
      config.command,
      [config.scriptPath, resolve(path)],
      { signal, onProgress },
    );
    let parsed;
    try {
      parsed = JSON.parse(output);
    } catch {
      throw Object.assign(new Error("Local OCR returned malformed JSON."), {
        code: "workflow_ocr_invalid_result",
      });
    }
    return normalizeResult(parsed);
  };
  return {
    providerId: config.providerId,
    readiness() {
      return {
        state: config.enabled ? "ready" : "unavailable",
        providerId: config.providerId,
        reason: config.reason,
        supportedExtensions: [...SUPPORTED_EXTENSIONS],
      };
    },
    recognize,
    async recognizePdf(input = {}) {
      if (extname(String(input.path ?? "")).toLowerCase() !== ".pdf") {
        throw Object.assign(new Error("Local OCR requires an absolute PDF path."), {
          code: "workflow_ocr_invalid_input",
        });
      }
      return recognize(input);
    },
  };
}
