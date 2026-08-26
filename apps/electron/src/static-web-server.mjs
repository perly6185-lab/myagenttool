import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import { extname, resolve, sep } from "node:path";

const host = process.env.WEB_HOST ?? "127.0.0.1";
const port = Number(process.env.WEB_PORT ?? 5000);
const distDir = resolve(process.env.MYAGENTTOOL_WEB_DIST ?? "apps/web/dist");
const indexHtml = resolve(distDir, "index.html");

if (process.argv.includes("--check")) {
  console.log("[electron-web:check] static web server check OK");
  process.exit(0);
}

if (!existsSync(indexHtml)) {
  console.error(`[electron-web] missing ${indexHtml}; run pnpm --filter @myagenttool/web build first.`);
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${host}:${port}`);
  const pathname = url.pathname === "/" ? "/index.html" : safeDecode(url.pathname);
  const filePath = resolve(distDir, `.${pathname}`);

  if (isInsideDist(filePath) && existsSync(filePath) && statSync(filePath).isFile()) {
    res.writeHead(200, responseHeaders(filePath, pathname));
    createReadStream(filePath).pipe(res);
    return;
  }

  if (pathname.startsWith("/assets/") || extname(pathname)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end("Not found");
    return;
  }

  res.writeHead(200, responseHeaders(indexHtml, "/index.html"));
  createReadStream(indexHtml).pipe(res);
});

server.listen(port, host, () => {
  const address = server.address();
  const listeningPort = typeof address === "object" && address ? address.port : port;
  console.log(`[electron-web] http://${host}:${listeningPort}`);
});

function safeDecode(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return "/";
  }
}

function isInsideDist(filePath) {
  return filePath === distDir || filePath.startsWith(`${distDir}${sep}`);
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
    case ".map":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".ico":
      return "image/x-icon";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

function responseHeaders(filePath, pathname) {
  return {
    "Content-Type": contentType(filePath),
    "Cache-Control": pathname === "/index.html"
      ? "no-store"
      : pathname.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    "X-Content-Type-Options": "nosniff",
  };
}
