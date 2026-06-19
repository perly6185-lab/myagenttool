import http from "node:http";
import { createReadStream, existsSync, readFileSync } from "node:fs";
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

  const html = readFileSync(join(publicDir, "index.html"), "utf8");
  const css = readFileSync(join(publicDir, "styles.css"), "utf8");
  const js = readFileSync(join(publicDir, "app.js"), "utf8");
  const expectations = [
    [html, "What should your computer do?", "task composer"],
    [html, "Run on this computer", "plain-language run action"],
    [html, "Safety", "safety review"],
    [html, "Data", "data review"],
    [html, "Cost", "cost review"],
    [html, "Activity", "activity timeline"],
    [html, "Result", "result panel"],
    [html, "Audit", "audit panel"],
    [css, "@media (max-width: 760px)", "mobile layout guard"],
    [css, "overflow-wrap: anywhere", "long text overflow guard"],
    [js, "readableStatus", "plain-language state mapper"],
    [js, "readableEventType", "plain-language event mapper"]
  ];

  const failed = expectations
    .filter(([content, needle]) => !content.includes(needle))
    .map(([, , label]) => label);

  if (failed.length > 0) {
    console.error(`[web:check] missing UX/visual QA expectations: ${failed.join(", ")}`);
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
