#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";

const options = parseArgs(process.argv.slice(2));
if (options.mode !== "apply-patch") fail(`Unsupported Codex apply patch mode: ${options.mode}`);
if (!options.cwd || !isAbsolute(options.cwd) || !existsSync(options.cwd)) {
  fail("--cwd must be an absolute path to an existing worktree.");
}
if (!options.patchFile || !isAbsolute(options.patchFile) || !existsSync(options.patchFile)) {
  fail("--patch-file must be an absolute path to a server-created patch file.");
}
if (!options.proposalId) {
  fail("--proposal-id is required.");
}
if (!/^[a-f0-9]{64}$/i.test(options.patchSha256 ?? "")) {
  fail("--patch-sha256 must be a 64-character SHA-256 hex digest.");
}

console.log(`Codex apply patch started: ${options.proposalId}`);

let patchText = "";
try {
  patchText = readFileSync(options.patchFile, "utf8");
  const normalized = normalizePatchText(patchText);
  if (!normalized) {
    fail("Patch file is empty.");
  }
  const actualHash = sha256(normalized);
  if (actualHash !== options.patchSha256.toLowerCase()) {
    fail("Patch file hash does not match the approved proposal.", { expected: options.patchSha256.toLowerCase(), actual: actualHash });
  }
  runGitApply(["apply", "--check", "--whitespace=nowarn", options.patchFile], "git apply --check failed");
  runGitApply(["apply", "--whitespace=nowarn", options.patchFile], "git apply failed");
  const files = filesFromDiff(normalized);
  result({
    summary: `Applied approved Codex patch proposal ${options.proposalId}.`,
    touchedUserFiles: true,
    output: {
      source: "codex",
      tool: "codex.apply.patch",
      mode: "apply-patch",
      proposalId: options.proposalId,
      patchSha256: options.patchSha256.toLowerCase(),
      applied: true,
      files,
    },
  });
} finally {
  try {
    rmSync(options.patchFile, { force: true });
  } catch {
    // Best-effort cleanup; the apply result should not fail because temp cleanup did.
  }
}

function parseArgs(args) {
  const parsed = {
    mode: "",
    cwd: "",
    patchFile: "",
    proposalId: "",
    patchSha256: "",
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--mode") {
      parsed.mode = valueAt(args, ++index, arg);
    } else if (arg === "--cwd") {
      parsed.cwd = valueAt(args, ++index, arg);
    } else if (arg === "--patch-file") {
      parsed.patchFile = valueAt(args, ++index, arg);
    } else if (arg === "--proposal-id") {
      parsed.proposalId = safeToken(valueAt(args, ++index, arg), "proposal id");
    } else if (arg === "--patch-sha256") {
      parsed.patchSha256 = valueAt(args, ++index, arg).toLowerCase();
    } else {
      fail(`Unsupported Codex apply patch wrapper argument: ${arg}`);
    }
  }
  return parsed;
}

function valueAt(args, index, flag) {
  const value = args[index];
  if (typeof value !== "string" || !value.trim()) {
    fail(`${flag} requires a value.`);
  }
  if (value.includes("\0")) {
    fail(`${flag} contains a NUL byte.`);
  }
  return value;
}

function safeToken(value, label) {
  const text = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(text)) {
    fail(`Invalid ${label}.`);
  }
  return text;
}

function runGitApply(args, label) {
  const proc = spawnSync("git", args, {
    cwd: options.cwd,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 5 * 1024 * 1024,
  });
  if (proc.status !== 0) {
    fail(label, {
      status: proc.status,
      stdout: preview(proc.stdout),
      stderr: preview(proc.stderr),
    });
  }
}

function filesFromDiff(diff) {
  const files = [];
  const seen = new Set();
  for (const line of diff.split("\n")) {
    const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (!match) continue;
    const file = match[2] || match[1];
    if (!seen.has(file)) {
      seen.add(file);
      files.push(file);
    }
  }
  return files.slice(0, 100);
}

function normalizePatchText(value) {
  const text = String(value ?? "").replace(/\r\n/g, "\n").trim();
  return text || null;
}

function sha256(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

function preview(value) {
  const text = String(value ?? "").trim();
  return text.length <= 1000 ? text : `${text.slice(0, 997)}...`;
}

function result(payload) {
  console.log(`RESULT ${JSON.stringify(payload)}`);
}

function fail(message, output = {}) {
  result({
    summary: message,
    touchedUserFiles: false,
    output: {
      source: "codex",
      tool: "codex.apply.patch",
      error: message,
      ...output,
    },
  });
  process.exit(1);
}
