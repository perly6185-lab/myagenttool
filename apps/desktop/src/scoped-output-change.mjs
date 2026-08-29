import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export function directWorkItemOutputPath(work, cwd) {
  const configured = String(work?.options?.metadata?.directWorkItem?.outputDirectory ?? "").trim();
  if (!configured || isAbsolute(configured) || !cwd || !isAbsolute(cwd)) return null;
  const candidate = resolve(cwd, configured);
  const confined = relative(cwd, candidate);
  if (!confined || confined === "." || confined.startsWith("..") || isAbsolute(confined)) return null;
  return candidate;
}

function entrySignature(path, relativePath, signatures) {
  const stat = lstatSync(path);
  const kind = stat.isSymbolicLink() ? "link" : stat.isDirectory() ? "dir" : stat.isFile() ? "file" : "other";
  signatures.push(`${relativePath}\0${kind}\0${stat.size}\0${stat.mtimeMs}`);
  if (!stat.isDirectory()) return;
  for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    entrySignature(resolve(path, entry.name), `${relativePath}/${entry.name}`, signatures);
  }
}

export function snapshotDirectWorkItemOutput(work, cwd) {
  const path = directWorkItemOutputPath(work, cwd);
  if (!path) return null;
  if (!existsSync(path)) return { path, exists: false, fingerprint: null, entries: 0 };
  try {
    const signatures = [];
    entrySignature(path, ".", signatures);
    return {
      path,
      exists: true,
      fingerprint: createHash("sha256").update(signatures.join("\n")).digest("hex"),
      entries: signatures.length,
    };
  } catch {
    return { path, exists: true, fingerprint: null, entries: null };
  }
}

export function directWorkItemOutputChanged(before, after) {
  if (!before || !after || before.path !== after.path) return false;
  if (before.exists !== after.exists) return true;
  if (!before.exists && !after.exists) return false;
  if (!before.fingerprint || !after.fingerprint) return false;
  return before.fingerprint !== after.fingerprint;
}
