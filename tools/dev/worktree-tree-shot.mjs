// Capture real-browser screenshots of the Worktree Session file tree (#1200):
// collapsed, then expanded after a click.
//
// Unlike round-telemetry-shot.mjs this injects nothing — the tree's data comes
// from GET /api/worktrees/:id/files, so a real server over a real git worktree
// IS the evidence. Fabricating a snapshot here would prove nothing: the bug was
// that the client never requested the level below, and only a live request path
// can show that it now does.
//
// Usage:
//   pnpm --filter @myagenttool/web build     # once, produces apps/web/dist
//   node tools/dev/worktree-tree-shot.mjs [--out <dir>]
//
// Requires the `playwright` dev dependency and its Chromium browser:
//   pnpm exec playwright install chromium

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const distDir = resolve(repoRoot, "apps/web/dist");
const distIndex = resolve(distDir, "index.html");
const outArg = argValue("--out");
const outDir = outArg ? resolve(repoRoot, outArg) : resolve(repoRoot, ".myagenttool/visual-qa/worktree-tree");

const apiPort = 3341;
const webPort = 3342;
const apiUrl = `http://127.0.0.1:${apiPort}`;
const tempRoot = join(tmpdir(), `myagenttool-tree-shot-${Date.now()}`);
const repoPath = join(tempRoot, "source");

const viewports = [
  { name: "1440w", width: 1440, height: 900 },
  { name: "390w", width: 390, height: 900 },
];

main().catch((error) => {
  console.error(`[tree-shot] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

async function main() {
  if (!existsSync(distIndex)) throw new Error("No built console. Run `pnpm --filter @myagenttool/web build` first.");
  const { chromium } = await import("playwright");

  seedRepo();
  const server = startServer();
  const web = startWebServer();
  try {
    await waitForApi();
    const state = await api("GET", "/api/state");
    const created = await api("POST", "/api/worktrees", {
      name: "tree-shot",
      branchName: `myagenttool/tree-shot-${Date.now().toString(36)}`,
      projectId: state.currentProject.id,
    });
    const worktreeId = created.worktree.id;
    console.log(`[tree-shot] worktree ${worktreeId} over ${repoPath}`);

    mkdirSync(outDir, { recursive: true });
    const browser = await chromium.launch();
    try {
      for (const vp of viewports) {
        const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
        // Count the level-below requests the tree makes, so the screenshot is
        // backed by the thing that was broken: does clicking fetch anything?
        const dirFetches = [];
        page.on("request", (req) => {
          const u = new URL(req.url(), apiUrl);
          if (u.pathname.endsWith("/files") && u.searchParams.get("path")) dirFetches.push(u.searchParams.get("path"));
        });

        // The worktree view is reached by selection state, not a URL route, so
        // seed the persisted ui-store before the app boots.
        await page.addInitScript(
          ([wtId, projectId]) => {
            window.localStorage.setItem(
              "myagenttool-ui",
              JSON.stringify({ state: { section: "projects", selectedProjectId: projectId, selectedWorktreeId: wtId }, version: 1 }),
            );
          },
          [worktreeId, created.project.id],
        );
        // `?api=` is the console's documented API override, so the page talks to
        // this run's server directly — no proxy, no fixture.
        await page.goto(`http://127.0.0.1:${webPort}/?api=${encodeURIComponent(apiUrl)}`, { waitUntil: "networkidle" });
        await page.getByText("apps", { exact: true }).first().waitFor({ timeout: 15_000 });
        await page.screenshot({ path: join(outDir, `tree-collapsed-${vp.name}.png`), fullPage: false });

        const before = dirFetches.length;
        await page.getByText("apps", { exact: true }).first().click();
        await page.getByText("web", { exact: true }).first().waitFor({ timeout: 15_000 });
        await page.screenshot({ path: join(outDir, `tree-expanded-${vp.name}.png`), fullPage: false });

        console.log(
          `[tree-shot] ${vp.name}: clicking "apps" fetched ${dirFetches.length - before} directory listing(s) `
          + `(${dirFetches.slice(before).join(", ") || "none"}) and revealed its children`,
        );
        await page.close();
      }
    } finally {
      await browser.close();
    }
    console.log(`[tree-shot] wrote ${viewports.length * 2} screenshots to ${outDir}`);
  } finally {
    server.kill();
    web.close();
  }
}

function seedRepo() {
  mkdirSync(repoPath, { recursive: true });
  git(["init", "-b", "main"]);
  git(["config", "user.email", "shot@example.test"]);
  git(["config", "user.name", "Tree Shot"]);
  writeFileSync(join(repoPath, "README.md"), "# Tree shot repo\n");
  mkdirSync(join(repoPath, "apps", "web"), { recursive: true });
  mkdirSync(join(repoPath, "docs"), { recursive: true });
  writeFileSync(join(repoPath, "apps", "web", "main.ts"), "export const ok = true;\n");
  writeFileSync(join(repoPath, "docs", "README.md"), "# docs\n");
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

// Serve the built console. The page reaches the API via `?api=`, so this only
// has to hand out static assets.
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
    res.end(readFileSync(distIndex));
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
