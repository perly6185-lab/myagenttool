import { existsSync } from "node:fs";
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

const platform = String(args.get("platform") ?? "");
const arch = String(args.get("arch") ?? "");
if (process.platform !== platform || process.arch !== arch) fail(`native package verification required: target ${platform}/${arch}, host ${process.platform}/${process.arch}`);
const outputRoot = join(root, "apps", "electron", "release");
const appDir = platform === "darwin"
  ? join(outputRoot, `mac-${arch}`, "MyAgentTool.app")
  : join(outputRoot, platform === "win32" ? "win-unpacked" : `linux-${arch}-unpacked`);
const resourcesRoot = platform === "darwin" ? join(appDir, "Contents", "Resources") : join(appDir, "resources");
const appRoot = join(resourcesRoot, "app");

const variants = {
  win32: { codex: "win32-x64", claudeAgent: "win32-x64", claudeCode: "win32-x64", canvas: "win32-x64-msvc", pty: "win32-x64" },
  darwin: { codex: "darwin-arm64", claudeAgent: "darwin-arm64", claudeCode: "darwin-arm64", canvas: "darwin-arm64", pty: "darwin-arm64" },
  linux: linuxVariant(arch),
}[platform];
if (!variants || !["x64", "arm64"].includes(arch)) fail(`unsupported package target: ${platform}/${arch}`);

const required = [
  join(appRoot, "apps", "server", "src", "index.mjs"),
  join(appRoot, "apps", "desktop", "src", "index.mjs"),
  join(appRoot, "apps", "web", "dist", "index.html"),
  join(appRoot, "node_modules", "@openai", `codex-${variants.codex}`),
  join(appRoot, "node_modules", "@anthropic-ai", `claude-agent-sdk-${variants.claudeAgent}`),
  join(appRoot, "node_modules", "@anthropic-ai", `claude-code-${variants.claudeCode}`),
  join(appRoot, "node_modules", "@napi-rs", `canvas-${variants.canvas}`),
  join(appRoot, "node_modules", "node-pty", "prebuilds", variants.pty, "pty.node"),
];
if (platform === "win32") {
  required.push(join(resourcesRoot, "portable-git", "bin", "bash.exe"));
  required.push(join(resourcesRoot, "portable-git", "cmd", "git.exe"));
}

const missing = required.filter((path) => !existsSync(path));
if (missing.length) {
  fail(`packaged ${platform}/${arch} app is incomplete:\n- ${missing.join("\n- ")}`);
}

console.log(`[desktop-package-verify] packaged ${platform}/${arch} app contains runtime and native dependencies`);

function fail(message) {
  console.error(`[desktop-package-verify] ERROR: ${message}`);
  process.exit(1);
}

function linuxVariant(targetArch) {
  const suffix = targetArch === "arm64" ? "linux-arm64" : "linux-x64";
  const musl = !process.report?.getReport?.().header?.glibcVersionRuntime;
  return {
    codex: suffix,
    claudeAgent: `${suffix}${musl ? "-musl" : ""}`,
    claudeCode: `${suffix}${musl ? "-musl" : ""}`,
    canvas: `${suffix}-${musl ? "musl" : "gnu"}`,
    pty: suffix,
  };
}
