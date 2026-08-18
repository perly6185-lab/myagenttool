import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const value = process.argv[index];
  if (!value.startsWith("--")) continue;
  const key = value.slice(2);
  const next = process.argv[index + 1];
  if (next && !next.startsWith("--")) {
    args.set(key, next);
    index += 1;
  } else {
    args.set(key, true);
  }
}

const targetPlatform = String(args.get("platform") ?? "").trim();
const targetArch = String(args.get("arch") ?? "").trim();
if (!targetPlatform || !targetArch) fail("usage: desktop-build-preflight.mjs --platform <win32|darwin|linux> --arch <x64|arm64> [--portable-git]");

const expected = {
  win32: {
    x64: { codex: "win32-x64", claudeAgent: "win32-x64", claudeCode: "win32-x64", canvas: "win32-x64-msvc", pty: "win32-x64" },
    arm64: { codex: "win32-arm64", claudeAgent: "win32-arm64", claudeCode: "win32-arm64", canvas: "win32-arm64-msvc", pty: "win32-arm64" },
  },
  darwin: {
    x64: { codex: "darwin-x64", claudeAgent: "darwin-x64", claudeCode: "darwin-x64", canvas: "darwin-x64", pty: "darwin-x64" },
    arm64: { codex: "darwin-arm64", claudeAgent: "darwin-arm64", claudeCode: "darwin-arm64", canvas: "darwin-arm64", pty: "darwin-arm64" },
  },
  linux: {
    x64: { codex: "linux-x64", claudeAgent: "linux-x64", claudeCode: "linux-x64", canvas: "linux-x64-gnu", pty: "linux-x64" },
    arm64: { codex: "linux-arm64", claudeAgent: "linux-arm64", claudeCode: "linux-arm64", canvas: "linux-arm64-gnu", pty: "linux-arm64" },
  },
};
const variant = targetPlatform === "linux" && isMuslLinux()
  ? { ...expected.linux[targetArch], claudeAgent: `${expected.linux[targetArch].claudeAgent}-musl`, claudeCode: `${expected.linux[targetArch].claudeCode}-musl`, canvas: `${expected.linux[targetArch].canvas.replace(/-gnu$/, "")}-musl` }
  : expected[targetPlatform]?.[targetArch];
if (!variant) fail(`unsupported desktop target: ${targetPlatform}/${targetArch}`);

if (process.platform !== targetPlatform || process.arch !== targetArch) {
  fail(`native build required: target ${targetPlatform}/${targetArch}, host ${process.platform}/${process.arch}`);
}

const rootPackage = readJson(join(root, "package.json"));
const genericVersions = {
  codex: rootPackage.dependencies?.["@openai/codex"],
  claudeAgent: rootPackage.dependencies?.["@anthropic-ai/claude-agent-sdk"],
  claudeCode: rootPackage.dependencies?.["@anthropic-ai/claude-code"],
  canvas: readJson(join(root, "apps", "server", "package.json")).dependencies?.["@napi-rs/canvas"],
};

const missing = [];
if (!hasCodexVariant(variant.codex, genericVersions.codex)) missing.push(`@openai/codex ${variant.codex}`);
if (!hasNamedVariant(`@anthropic-ai/claude-agent-sdk-${variant.claudeAgent}`, genericVersions.claudeAgent)) missing.push(`@anthropic-ai/claude-agent-sdk-${variant.claudeAgent}`);
if (!hasNamedVariant(`@anthropic-ai/claude-code-${variant.claudeCode}`, genericVersions.claudeCode)) missing.push(`@anthropic-ai/claude-code-${variant.claudeCode}`);
if (!hasNamedVariant(`@napi-rs/canvas-${variant.canvas}`, genericVersions.canvas)) missing.push(`@napi-rs/canvas-${variant.canvas}`);

const ptyRoot = join(root, "node_modules", "node-pty");
const ptyNative = [
  join(ptyRoot, "build", "Release", "pty.node"),
  join(ptyRoot, "build", "Debug", "pty.node"),
  join(ptyRoot, "prebuilds", variant.pty, "pty.node"),
].some(existsSync);
if (!ptyNative) missing.push(`node-pty native module ${variant.pty}/pty.node`);

if (args.has("portable-git")) {
  const portableRoot = join(root, "apps", "electron", "vendor", "portable-git");
  for (const relative of ["bin/bash.exe", "cmd/git.exe"]) {
    if (!existsSync(join(portableRoot, relative))) missing.push(`PortableGit/${relative}`);
  }
}

if (missing.length) {
  fail(`desktop native dependencies are incomplete for ${targetPlatform}/${targetArch}:\n- ${missing.join("\n- ")}\nRun pnpm install --frozen-lockfile on a native ${targetPlatform}/${targetArch} runner.`);
}

console.log(`[desktop-preflight] native dependencies ready for ${targetPlatform}/${targetArch}`);

function hasCodexVariant(suffix, version) {
  const expectedVersion = `${String(version ?? "").replace(/^\^/, "")}-${suffix}`;
  return findVirtualPackages("@openai/codex", (metadata) => metadata.version === expectedVersion).length > 0;
}

function hasNamedVariant(name, version) {
  const normalizedVersion = String(version ?? "").replace(/^\^/, "");
  return findVirtualPackages(name, (metadata) => metadata.name === name && metadata.version === normalizedVersion).length > 0;
}

function findVirtualPackages(name, predicate) {
  const virtualStore = join(root, "node_modules", ".pnpm");
  if (!existsSync(virtualStore)) return [];
  const [scope, packageName] = name.startsWith("@") ? name.split("/") : [null, name];
  const found = [];
  for (const entry of readdirSync(virtualStore)) {
    const packageJson = scope
      ? join(virtualStore, entry, "node_modules", scope, packageName, "package.json")
      : join(virtualStore, entry, "node_modules", packageName, "package.json");
    if (!existsSync(packageJson)) continue;
    const metadata = readJson(packageJson);
    if (predicate(metadata)) found.push(packageJson);
  }
  return found;
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return {}; }
}

function fail(message) {
  console.error(`[desktop-preflight] ERROR: ${message}`);
  process.exit(1);
}

function isMuslLinux() {
  if (process.platform !== "linux") return false;
  try { return !process.report?.getReport?.().header?.glibcVersionRuntime; } catch { return false; }
}
