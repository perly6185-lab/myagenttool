import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(testDir, "../src/static-web-server.mjs");

test("desktop static server prevents stale shells and never serves HTML for missing assets", async (t) => {
  const distDir = await mkdtemp(join(tmpdir(), "myagenttool-static-web-"));
  await mkdir(join(distDir, "assets"));
  await writeFile(join(distDir, "index.html"), "<!doctype html><script type=\"module\" src=\"/assets/app-hash.js\"></script>");
  await writeFile(join(distDir, "assets", "app-hash.js"), "export const ready = true;");

  const child = spawn(process.execPath, [serverEntry], {
    env: { ...process.env, WEB_HOST: "127.0.0.1", WEB_PORT: "0", MYAGENTTOOL_WEB_DIST: distDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    child.kill("SIGTERM");
    await rm(distDir, { recursive: true, force: true });
  });

  const baseUrl = await listeningUrl(child);
  const shell = await fetch(`${baseUrl}/`);
  assert.equal(shell.status, 200);
  assert.equal(shell.headers.get("cache-control"), "no-store");

  const asset = await fetch(`${baseUrl}/assets/app-hash.js`);
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(asset.headers.get("x-content-type-options"), "nosniff");

  const missing = await fetch(`${baseUrl}/assets/old-build.js`);
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get("content-type"), /^text\/plain/);
  assert.equal(await missing.text(), "Not found");

  const route = await fetch(`${baseUrl}/my-hosts`);
  assert.equal(route.status, 200);
  assert.equal(route.headers.get("cache-control"), "no-store");
  assert.match(await route.text(), /^<!doctype html>/);
});

function listeningUrl(child) {
  return new Promise((resolveUrl, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`static server did not start: ${output}`)), 5_000);
    child.once("error", reject);
    child.stderr.on("data", (chunk) => { output += chunk.toString("utf8"); });
    child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8");
      const match = output.match(/\[electron-web\] (http:\/\/127\.0\.0\.1:\d+)/);
      if (!match) return;
      clearTimeout(timer);
      resolveUrl(match[1]);
    });
  });
}
