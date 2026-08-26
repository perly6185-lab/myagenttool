import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const DERIVER_WORKER = fileURLToPath(new URL("./site-image-deriver-worker.mjs", import.meta.url));
const MAX_DERIVER_OUTPUT_BYTES = 64 * 1024 * 1024;
const DERIVER_TIMEOUT_MS = 30_000;

const SUPPORTED = Object.freeze({
  png: { mimeType: "image/png", extension: "png" },
  jpeg: { mimeType: "image/jpeg", extension: "jpg" },
  webp: { mimeType: "image/webp", extension: "webp" },
});

function detectedType(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return SUPPORTED.png;
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return SUPPORTED.jpeg;
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return SUPPORTED.webp;
  return null;
}

function pathSegment(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, 24);
}

function runDeriver(bytes) {
  return new Promise((resolveWorker, rejectWorker) => {
    const child = spawn(process.execPath, [DERIVER_WORKER], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (error, output = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) rejectWorker(error);
      else resolveWorker(output);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("site_asset_derivative_worker_timeout"));
    }, DERIVER_TIMEOUT_MS);
    child.on("error", (error) => finish(error));
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_DERIVER_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        finish(new Error("site_asset_derivative_worker_output_too_large"));
        return;
      }
      chunks.push(chunk);
    });
    child.on("close", (code) => finish(code === 0 ? null : new Error("site_asset_derivative_worker_failed"), Buffer.concat(chunks).toString("utf8")));
    child.stdin.on("error", () => { /* a failed decoder may close stdin before all bytes are written */ });
    child.stdin.end(bytes);
  });
}

export function safeSiteAssetName(value) {
  return String(value ?? "image")
    .replace(/[\\/\0\r\n]+/g, " ")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 120) || "image";
}

export function readBoundedSiteAssetBody(req, limit) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (code) => {
      if (settled) return;
      settled = true;
      const error = new Error(code);
      error.code = code;
      reject(error);
    };
    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) return fail("site_asset_too_large");
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolveBody(Buffer.concat(chunks));
    });
    req.on("error", () => fail("site_asset_upload_failed"));
  });
}

export function createSiteAssetStorage({ root = null } = {}) {
  const base = root ? resolve(root) : null;

  function resolveKey(storageKey) {
    if (!base) return null;
    const target = resolve(base, String(storageKey ?? ""));
    if (!target.startsWith(`${base}${sep}`)) throw new Error("site_asset_path_invalid");
    return target;
  }

  function inspect(bytes) {
    const type = detectedType(bytes);
    if (!type) return null;
    return { ...type, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
  }

  async function derive(bytes) {
    try {
      const stdout = await runDeriver(bytes);
      if (!stdout) throw new Error("site_asset_derivative_worker_failed");
      const output = JSON.parse(stdout);
      if (!Number.isInteger(output.width) || !Number.isInteger(output.height) || !Array.isArray(output.variants)) throw new Error("site_asset_derivative_worker_invalid");
      const variants = output.variants.map((candidate) => {
        const variantBytes = Buffer.from(candidate.bytes, "base64");
        const inspected = inspect(variantBytes);
        if (!inspected || inspected.mimeType !== "image/webp") throw new Error("site_asset_derivative_invalid");
        return { key: String(candidate.key), width: Number(candidate.width), height: Number(candidate.height), ...inspected, bytes: variantBytes };
      });
      return { status: variants.length ? "ready" : "unavailable", width: output.width, height: output.height, variants };
    } catch {
      return { status: "unavailable", width: null, height: null, variants: [] };
    }
  }

  function storageKeyFor({ ownerTeamId, siteId, sha256, extension }) {
    return `${pathSegment(ownerTeamId)}/${pathSegment(siteId)}/${sha256}.${extension}`;
  }

  function write(storageKey, bytes) {
    const target = resolveKey(storageKey);
    if (!target) throw new Error("site_asset_storage_unavailable");
    let cursor = base;
    for (const part of storageKey.split("/").slice(0, -1)) {
      cursor = resolve(cursor, part);
      if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw new Error("site_asset_directory_symlink");
      mkdirSync(cursor, { recursive: true, mode: 0o700 });
    }
    if (!existsSync(target)) writeFileSync(target, bytes, { mode: 0o600, flag: "wx" });
    return target;
  }

  function read(storageKey) {
    const target = resolveKey(storageKey);
    if (!target || !existsSync(target) || lstatSync(target).isSymbolicLink()) return null;
    return readFileSync(target);
  }

  function remove(storageKey) {
    const target = resolveKey(storageKey);
    if (target && existsSync(target) && !lstatSync(target).isSymbolicLink()) unlinkSync(target);
  }

  return { available: Boolean(base), inspect, derive, storageKeyFor, write, read, remove };
}
