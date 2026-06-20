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
    [html, "id=\"agentSelect\"", "agent selector"],
    [html, "id=\"healthCheckButton\"", "agent health check action"],
    [html, "id=\"toggleAgentButton\"", "agent enable disable action"],
    [html, "id=\"agentHealth\"", "agent health state"],
    [html, "id=\"agentUsage\"", "agent usage count"],
    [html, "id=\"agentCostOwner\"", "agent cost owner"],
    [html, "id=\"troubleshootButton\"", "invocation troubleshooter action"],
    [html, "id=\"troubleshooterPanel\"", "invocation troubleshooter panel"],
    [html, "id=\"discoverButton\"", "agent discovery action"],
    [html, "id=\"discoveryPaths\"", "user-provided CLI discovery input"],
    [html, "id=\"discoveryEndpoints\"", "user-provided HTTP discovery input"],
    [html, "id=\"candidateList\"", "agent discovery candidates"],
    [html, "id=\"integrationIntent\"", "unsupported agent intent intake"],
    [html, "id=\"createIntegrationButton\"", "integration artifact draft action"],
    [html, "id=\"builderDraftButton\"", "integration builder platform draft action"],
    [html, "id=\"generateIntegrationButton\"", "integration artifact generation action"],
    [html, "id=\"artifactList\"", "integration artifact review list"],
    [html, "id=\"quotaSummary\"", "integration quota summary"],
    [html, "id=\"retentionSummary\"", "integration retention summary"],
    [html, "id=\"approvalPanel\"", "local approval panel"],
    [html, "id=\"approveButton\"", "local approval approve action"],
    [html, "id=\"denyButton\"", "local approval deny action"],
    [html, "Safety", "safety review"],
    [html, "Data", "data review"],
    [html, "Cost", "cost review"],
    [html, "Cancellation", "cancellation review"],
    [html, "Technical details", "collapsed technical details"],
    [html, "Activity", "activity timeline"],
    [html, "Result", "result panel"],
    [html, "Audit", "audit panel"],
    [css, "@media (max-width: 760px)", "mobile layout guard"],
    [css, "overflow-wrap: anywhere", "long text overflow guard"],
    [js, "readableStatus", "plain-language state mapper"],
    [js, "readableEventType", "plain-language event mapper"],
    [js, "readableHealth", "plain-language health mapper"],
    [js, "readableHealthLabel", "agent list health label"],
    [js, "renderDiscovery", "conservative discovery renderer"],
    [js, "renderIntegrationArtifacts", "integration artifact renderer"],
    [js, "/api/integration-artifacts", "integration artifact API action"],
    [js, "/api/integration-builder/draft", "integration builder platform agent API action"],
    [js, "integrationPayload", "unsupported agent structured intake"],
    [js, "selectedIntegrationArtifact", "integration artifact selection state"],
    [js, "quotaSummary", "quota decision display"],
    [js, "retentionSummary", "retention display"],
    [js, "renderApproval", "local approval renderer"],
    [js, "currentApproval", "local approval state lookup"],
    [js, "/api/approvals/", "local approval API action"],
    [js, "renderTroubleshooter", "invocation troubleshooter renderer"],
    [js, "agentUsageSummaries", "agent usage state"],
    [js, "/troubleshoot", "invocation troubleshooter API action"],
    [js, "costOwnerText", "cost owner display"],
    [js, "readableDiscoverySource", "plain-language discovery source"],
    [js, "readableAdapterType", "plain-language candidate adapter type"],
    [js, "runBlockReason", "run blocked explanation"],
    [js, "registrationNotes", "agent review notes"],
    [js, "selectedAgentId", "agent selection state"]
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
