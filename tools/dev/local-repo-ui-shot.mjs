// Capture the Projects list showing where a project pushes, and drive the
// "Create local repo" action for real (#1213).
//
// Nothing is injected: a real git repo with NO remote, a real server, and the
// real endpoint. The claim under test is that a user who never makes an API call
// can go from "nowhere to publish" to a working local origin by clicking once —
// so the click has to be a real click against a real server, not a fixture.
//
// Usage:
//   pnpm --filter @myagenttool/web build
//   node tools/dev/local-repo-ui-shot.mjs [--out <dir>]

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const distDir = resolve(repoRoot, "apps/web/dist");
const outArg = argValue("--out");
const outDir = outArg ? resolve(repoRoot, outArg) : resolve(repoRoot, ".myagenttool/visual-qa/local-repo");

const apiPort = 3351;
const webPort = 3352;
const apiUrl = `http://127.0.0.1:${apiPort}`;
let tempRoot = join(tmpdir(), `myagenttool-local-repo-shot-${Date.now()}`);
let repoPath = join(tempRoot, "source");

const viewports = [
  { name: "1440w", width: 1440, height: 900 },
  { name: "390w", width: 390, height: 900 },
];

main().catch((error) => {
  console.error(`[local-repo-shot] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

async function main() {
  if (!existsSync(resolve(distDir, "index.html"))) throw new Error("No built console. Run `pnpm --filter @myagenttool/web build` first.");
  const { chromium } = await import("playwright");

  mkdirSync(outDir, { recursive: true });
  const web = startWebServer();
  const browser = await chromium.launch();
  try {
    for (const vp of viewports) {
      // A fresh repo + server per viewport. Removing the remote between runs is
      // not enough: project.git is a cache that only re-reads on a tree browse, so
      // the second pass would still read "Local repo" from the first pass's state.
      seedRepo();
      const server = startServer();
      try {
        await waitForApi();
        const state = await api("GET", "/api/state");
        const project = state.currentProject;
        if (project.git?.remoteUrl) throw new Error("the seeded project must start with NO remote");
        console.log(`[local-repo-shot] ${vp.name}: project ${project.id} — remote: ${project.git?.remoteUrl ?? "(none)"}, isRepo: ${project.git?.isRepo}`);
        const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
        const posts = [];
        page.on("request", (req) => {
          if (req.method() === "POST" && req.url().includes("/local-origin")) posts.push(req.url());
        });
        await page.addInitScript(() => window.localStorage.setItem("myagenttool-ui", JSON.stringify({ state: { section: "projects" }, version: 1 })));
        await page.goto(`http://127.0.0.1:${webPort}/?api=${encodeURIComponent(apiUrl)}`, { waitUntil: "networkidle" });

        // Before: the project says it has nowhere to publish, and offers the action.
        await page.getByText("No origin · nowhere to publish yet").first().waitFor({ timeout: 15_000 });
        await page.screenshot({ path: join(outDir, `no-origin-${vp.name}.png`) });

        // The click a non-professional user makes instead of getting an account.
        await page.getByRole("button", { name: "Create local repo" }).first().click();
        await page.getByText("Local repo · publishes on this device").first().waitFor({ timeout: 15_000 });
        await page.screenshot({ path: join(outDir, `local-repo-${vp.name}.png`) });

        console.log(`[local-repo-shot] ${vp.name}: clicked once -> ${posts.length} POST /local-origin -> row reads "Local repo" with no reload`);
        await page.close();
      } finally {
        server.kill();
        await sleep(500);
      }
    }
  } finally {
    await browser.close();
    web.close();
  }
  console.log(`[local-repo-shot] wrote ${viewports.length * 2} screenshots to ${outDir}`);
}

function seedRepo() {
  tempRoot = join(tmpdir(), `myagenttool-local-repo-shot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  repoPath = join(tempRoot, "source");
  mkdirSync(repoPath, { recursive: true });
  git(["init", "-b", "main"]);
  git(["config", "user.email", "shot@example.test"]);
  git(["config", "user.name", "Local Repo Shot"]);
  writeFileSync(join(repoPath, "README.md"), "# Local repo shot\n");
  git(["add", "."]);
  git(["commit", "-m", "initial"]);
}

function git(args) {
  const r = spawnSync("git", args, { cwd: repoPath, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

function startServer() {
  return spawn(process.execPath, ["apps/server/src/index.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SERVER_PORT: String(apiPort),
      MYAGENTTOOL_PROJECT_PATH: repoPath,
      MYAGENTTOOL_STATE_PATH: join(tempRoot, "state.json"),
    },
    stdio: ["ignore", "ignore", "ignore"],
  });
}

function startWebServer() {
  const server = createServer((req, res) => {
    const rel = req.url.split("?")[0];
    const file = resolve(distDir, `.${rel}`);
    if (rel !== "/" && existsSync(file) && extname(file)) {
      res.writeHead(200, { "content-type": contentType(extname(file)) });
      res.end(readFileSync(file));
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(readFileSync(resolve(distDir, "index.html")));
  });
  server.listen(webPort, "127.0.0.1");
  return server;
}

function contentType(ext) {
  return { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" }[ext] ?? "text/plain";
}

async function waitForApi() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      await api("GET", "/api/state");
      return;
    } catch {
      await sleep(200);
    }
  }
  throw new Error("server did not start");
}

async function api(method, path, body) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${method} ${path} -> ${JSON.stringify(data)}`);
  return data;
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}
