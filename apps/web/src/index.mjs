import http from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");
const host = process.env.WEB_HOST ?? "127.0.0.1";
const port = Number(process.env.WEB_PORT ?? 3000);

if (process.argv.includes("--check")) {
  const required = ["index.html", "app.js", "styles.css"];
  const missing = required.filter((item) => !existsSync(join(publicDir, item)));
  if (missing.length > 0) {
    console.error(`[web:check] missing files: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log("[web:check] local demo web console check OK");
  process.exit(0);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${host}:${port}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = pathname.replace(/^\/+/, "");
  const filePath = join(publicDir, safePath);

  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  res.writeHead(200, { "Content-Type": contentType(filePath) });
  createReadStream(filePath).pipe(res);
});

server.listen(port, host, () => {
  console.log(`[web] http://${host}:${port}`);
});

function contentType(filePath) {
  switch (extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}
