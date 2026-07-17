import http from "node:http";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join } from "node:path";
import { resolveViteBin } from "./vite-bin.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = join(__dirname, "..");
const distDir = join(webRoot, "dist");
const srcDir = join(webRoot, "src");
const indexHtml = join(distDir, "index.html");
const host = process.env.WEB_HOST ?? "127.0.0.1";
const port = Number(process.env.WEB_PORT ?? 3000);

if (process.argv.includes("--check")) {
  runCheck();
  process.exit(0);
}

ensureBuild();

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${host}:${port}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = pathname.replace(/^\/+/, "");
  const filePath = join(distDir, safePath);

  // Serve the built asset when it exists and stays inside dist; otherwise fall
  // back to index.html so the single-page app can route client-side.
  if (filePath.startsWith(distDir) && existsSync(filePath) && statSync(filePath).isFile()) {
    res.writeHead(200, { "Content-Type": contentType(filePath) });
    createReadStream(filePath).pipe(res);
    return;
  }

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  createReadStream(indexHtml).pipe(res);
});

server.listen(port, host, () => {
  console.log(`[web] http://${host}:${port}`);
});

// Build the SPA on demand so `pnpm dev` / acceptance "just work" after install.
function ensureBuild() {
  if (existsSync(indexHtml)) return;
  console.log("[web] dist not found — building the console (vite build)…");
  const require = createRequire(import.meta.url);
  const viteBin = resolveViteBin(webRoot, require);
  const result = spawnSync(process.execPath, [viteBin, "build"], {
    cwd: webRoot,
    stdio: "inherit",
  });
  if (result.status !== 0 || !existsSync(indexHtml)) {
    throw new Error("[web] vite build failed; run `pnpm --filter @myagenttool/web build`.");
  }
}

function contentType(filePath) {
  switch (extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".ico":
      return "image/x-icon";
    case ".woff2":
      return "font/woff2";
    case ".map":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function runCheck() {
  const requiredFiles = [
    "index.html",
    "vite.config.ts",
    "src/main.tsx",
    "src/app/App.tsx",
    "src/app/routes.tsx",
    "src/assets/main.css",
    "src/components/layout/nav-rail.tsx",
    "src/components/layout/inspector.tsx",
    "src/lib/api-client.ts",
    "src/lib/readable-labels.ts",
  ];
  const missing = requiredFiles.filter((path) => !existsSync(join(webRoot, path)));
  if (missing.length > 0) {
    console.error(`[web:check] missing files: ${missing.join(", ")}`);
    process.exit(1);
  }

  // Product affordances must survive the migration — these strings live in the
  // React source (and therefore the built bundle) and back the M0 acceptance.
  const source = collectSource(srcDir);
  const expectations = [
    ["What should your computer do?", "plain-language task composer"],
    ["Run on this computer", "plain-language run action"],
    ["Safety", "safety review"],
    ["Data", "data review"],
    ["Cost", "cost review"],
    ["Cancellation", "cancellation review"],
    ["Technical details", "progressive disclosure of technical details"],
    ["Find local agents", "conservative discovery surface"],
    ["Connect unsupported agent", "integration builder surface"],
    ["resolveApiBase", "localhost-only API override"],
    ["readableStatus", "plain-language state mapper"],
    ["SECTION_VIEWS", "store-driven section routing"],
  ];
  const failed = expectations
    .filter(([needle]) => !source.includes(needle))
    .map(([, label]) => label);
  if (failed.length > 0) {
    console.error(`[web:check] missing UX/architecture expectations: ${failed.join(", ")}`);
    process.exit(1);
  }

  console.log("[web:check] React control-plane console check OK");
}

function collectSource(dir) {
  let combined = "";
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      combined += collectSource(full);
    } else if (/\.(tsx?|css)$/.test(entry.name)) {
      combined += readFileSync(full, "utf8");
    }
  }
  return combined;
}
