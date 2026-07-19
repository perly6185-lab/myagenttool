import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const VERSION = "2.50.1";
const URL = `https://github.com/git-for-windows/git/releases/download/v${VERSION}.windows.1/PortableGit-${VERSION}-64-bit.7z.exe`;
const SHA256 = "c45a7dfa2bde34059f6dbd85f49a95d73d5aea29305f51b79595e56e4f323a3d";
const here = dirname(fileURLToPath(import.meta.url));
const electronRoot = resolve(here, "..");
const cacheDir = resolve(electronRoot, ".cache");
const archive = resolve(cacheDir, `PortableGit-${VERSION}-64-bit.7z.exe`);
const target = resolve(electronRoot, "vendor", "portable-git");

if (portableGitReady(target)) {
  console.log(`[portable-git] ready at ${target}`);
  process.exit(0);
}

mkdirSync(cacheDir, { recursive: true });
if (!existsSync(archive) || await sha256(archive) !== SHA256) {
  const partial = `${archive}.partial`;
  rmSync(partial, { force: true });
  console.log(`[portable-git] downloading ${URL}`);
  const response = await fetch(URL, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`PortableGit download failed: HTTP ${response.status}`);
  await pipeline(response.body, createWriteStream(partial));
  const actual = await sha256(partial);
  if (actual !== SHA256) {
    rmSync(partial, { force: true });
    throw new Error(`PortableGit SHA-256 mismatch: expected ${SHA256}, got ${actual}`);
  }
  renameSync(partial, archive);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
const extracted = spawnSync(archive, ["-y", `-o${target}`], { stdio: "inherit", windowsHide: true });
if (extracted.status !== 0 || !portableGitReady(target)) {
  rmSync(target, { recursive: true, force: true });
  throw new Error(`PortableGit extraction failed with exit code ${extracted.status ?? "unknown"}`);
}
console.log(`[portable-git] verified ${VERSION} at ${target}`);

function portableGitReady(directory) {
  return existsSync(resolve(directory, "bin", "bash.exe")) && existsSync(resolve(directory, "cmd", "git.exe"));
}

async function sha256(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}
