// Capture real-browser screenshots of the "Rounds · this run" console lens
// (Epic #805) by rendering the built web console against an injected state
// snapshot.
//
// The demo seeds no invocations and per-round records only arrive from a live
// bridge run, so this renders the card against a fabricated-but-valid snapshot:
// it boots the server to obtain a real, complete `GET /api/state` base (every
// read-model array present), injects one succeeded invocation plus three rounds,
// then drives headless Chromium — intercepting `/api/state` — at two viewports.
//
// Usage:
//   pnpm --filter @myagenttool/web build      # once, produces apps/web/dist
//   node tools/dev/round-telemetry-shot.mjs [--out <dir>]
//   # or: pnpm visual:qa:rounds [-- --out <dir>]
//
// Requires the `playwright` dev dependency and its Chromium browser:
//   pnpm exec playwright install chromium
//
// Output (default .myagenttool/visual-qa/round-telemetry/, gitignored):
//   rounds-1440w.png, rounds-390w.png — pass `--out docs/engineering/visual-qa/
//   round-telemetry` to regenerate the committed evidence in place.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const distDir = resolve(repoRoot, "apps/web/dist");
const distIndex = resolve(distDir, "index.html");

const outArg = argValue("--out");
const outDir = outArg ? resolve(repoRoot, outArg) : resolve(repoRoot, ".myagenttool/visual-qa/round-telemetry");

const viewports = [
  { file: "rounds-1440w.png", width: 1440, height: 900 },
  { file: "rounds-390w.png", width: 390, height: 900 },
];

main().catch((error) => {
  console.error(`[round-shot] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

async function main() {
  if (!existsSync(distIndex)) {
    throw new Error("No built console. Run `pnpm --filter @myagenttool/web build` first.");
  }
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error("playwright is not installed. Run `pnpm add -D -w playwright`.");
  }

  const snapshot = injectRounds(await fetchBaseSnapshot());
  mkdirSync(outDir, { recursive: true });

  const fileServer = await serveDist();
  const browser = await launchChromium(chromium);
  try {
    for (const vp of viewports) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 });
      const page = await context.newPage();
      // Register the catch-all FIRST and the specific /api/state LAST: Playwright
      // runs the last-registered matching route first, so this order lets the
      // snapshot win while every other API call is answered harmlessly.
      await page.route("**/api/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
      await page.route("**/api/state", (route) => route.fulfill({ status: 200, contentType: "application/json", body: snapshot }));
      await page.goto(`${fileServer.url}/?section=invocations&invocation=inv_demo`, { waitUntil: "networkidle" });
      const visible = await page.waitForSelector("text=Rounds · this run", { timeout: 15000 }).then(() => true).catch(() => false);
      await page.waitForTimeout(500);
      const outPath = resolve(outDir, vp.file);
      await page.screenshot({ path: outPath, fullPage: true });
      console.log(`[round-shot] ${vp.width}x${vp.height} -> ${outPath}${visible ? "" : "  (WARNING: Rounds card not found)"}`);
      await context.close();
    }
  } finally {
    await browser.close();
    fileServer.close();
  }
}

// --- base snapshot from a throwaway server ----------------------------------

async function fetchBaseSnapshot() {
  const port = await freePort();
  const stateStorePath = resolve(repoRoot, `.myagenttool/tmp-round-shot-${port}.json`);
  const child = spawn(process.execPath, ["apps/server/src/index.mjs"], {
    cwd: repoRoot,
    env: { ...process.env, SERVER_PORT: String(port), STATE_STORE_PATH: stateStorePath },
    stdio: ["ignore", "ignore", "ignore"],
  });
  try {
    const base = `http://127.0.0.1:${port}`;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const res = await fetch(`${base}/api/state`);
        if (res.ok) return await res.json();
      } catch {
        // server not up yet
      }
      await sleep(250);
    }
    throw new Error("server did not answer /api/state in time");
  } finally {
    child.kill("SIGTERM");
  }
}

// The demo invocation + its rounds. Deterministic so screenshots are stable.
function injectRounds(base) {
  const agentId = base.agents?.[0]?.id ?? "agt_demo";
  base.invocations = [{
    id: "inv_demo", status: "succeeded", input: { task: "Refactor the auth module and add tests" },
    agentId, projectId: base.currentProjectId ?? base.projects?.[0]?.id ?? null,
    traceId: "trc_demo", rootSpanId: "spn_demo_root",
    delivery: { state: "acknowledged", dispatchAttempts: 1 }, cancellation: { state: "none" },
    result: { summary: "Done: refactored auth, added 6 tests.", touchedUserFiles: true },
    createdAt: "2026-07-13T09:00:00.000Z",
  }];
  const round = (i, over) => ({
    id: `rnd_${i}`, invocationId: "inv_demo", traceId: "trc_demo", spanId: `spn_${i}`, roundIndex: i,
    kind: "model_turn", provider: "anthropic", model: "claude-opus-4-8", status: "succeeded",
    inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0,
    filesRead: [], toolCallIds: [], errorCode: null, usageRecordId: "aiu_demo",
    createdAt: "2026-07-13T09:00:06.000Z", ...over,
  });
  base.invocationRounds = [
    round(0, { durationMs: 5000, inputTokens: 12450, outputTokens: 820, cachedTokens: 9600, filesRead: ["apps/server/src/services/auth.mjs", "apps/server/src/routes/auth.mjs"], toolCallIds: ["tiv_0", "tiv_1"], responseDigest: "Reading the auth module to map the login flow." }),
    round(1, { durationMs: 14000, inputTokens: 13200, outputTokens: 2100, cachedTokens: 11800, filesRead: ["apps/server/src/services/auth.mjs"], toolCallIds: ["tiv_2"], responseDigest: "Refactoring: extract token verification into verifyToken()." }),
    round(2, { durationMs: 3400, inputTokens: 8100, outputTokens: 640, cachedTokens: 7900, responseDigest: "Added 6 tests; all green." }),
  ];
  return JSON.stringify(base);
}

// --- static file server for the built console -------------------------------

function serveDist() {
  const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2", ".png": "image/png", ".ico": "image/x-icon" };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    let filePath = resolve(distDir, `.${url.pathname}`);
    if (!filePath.startsWith(distDir) || !existsSync(filePath) || url.pathname === "/") filePath = distIndex;
    try {
      res.writeHead(200, { "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream" });
      res.end(readFileSync(filePath));
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  return new Promise((resolveServer) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolveServer({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

async function launchChromium(chromium) {
  try {
    return await chromium.launch();
  } catch (error) {
    throw new Error(`could not launch Chromium (${error instanceof Error ? error.message : error}). Run \`pnpm exec playwright install chromium\`.`);
  }
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}
