import { createServer } from "node:http";
import { cpSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CadPreviewError, cadRuntimeReadiness, inspectCadDocument, renderCadDocument } from "../../server/src/services/cad-preview.mjs";

const port = Number(process.env.CAD_E2E_PORT || 5011);
const root = mkdtempSync(join(tmpdir(), "myagenttool-cad-real-e2e-"));
const drawings = join(root, "drawings");
mkdirSync(drawings);
cpSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../server/test/fixtures/cad/deterministic.dxf"), join(drawings, "deterministic.dxf"));
writeFileSync(join(drawings, "corrupt.dxf"), "0\nSECTION\n2\nENTITIES\n0\nLINE\n8\n0\n10\nnot-a-number\n0\nEOF\n");
writeFileSync(join(drawings, "over-limit.dxf"), pointDrawing(100_001));
writeFileSync(join(drawings, "timeout.dxf"), pointDrawing(75_000));
writeFileSync(join(drawings, "malicious.dxf"), "0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n");

const documents = ["deterministic", "corrupt", "over-limit", "timeout", "malicious"].map((name) => ({ projectId: "prj_cad", worktreeId: null, name: `${name}.dxf`, path: `drawings/${name}.dxf`, type: "dxf", gitStatus: "clean" }));
const metrics = { cancelled: 0, active: 0 };
const malicious = { ok: true, version: "AC1032", units: 0, extents: null, layoutExtents: { Model: null }, layouts: ["Model"], layers: ["0"], entityCounts: {}, texts: [], warnings: [], audit: { errors: 0, fixes: 0 }, svg: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  cors(res);
  if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }
  if (url.pathname === "/api/state") return json(res, 200, { currentProjectId: "prj_cad", projects: [{ id: "prj_cad", name: "Real CAD E2E", path: root, git: { repoPath: root } }], worktrees: [], device: { id: "e2e", name: "E2E", status: "online" } });
  if (url.pathname === "/api/cad-preview/readiness") return json(res, 200, cadRuntimeReadiness());
  if (url.pathname === "/api/projects/prj_cad/documents") return json(res, 200, { projectId: "prj_cad", worktreeId: null, truncated: false, scanned: documents.length, documents });
  if (url.pathname === "/api/e2e/cad-metrics") return json(res, 200, { ...metrics, privateTemps: readdirSync(tmpdir()).filter((name) => name.startsWith("myagenttool-cad-preview-")).length });
  const match = url.pathname.match(/^\/api\/projects\/prj_cad\/cad-document(\/layout)?$/);
  if (!match) return json(res, 200, {});
  const relativeFile = url.searchParams.get("path") || "";
  const controller = new AbortController();
  const disconnected = () => { if (!res.writableEnded) controller.abort(); };
  res.once("close", disconnected);
  metrics.active += 1;
  try {
    const common = { projectPath: root, relativeFile, signal: controller.signal, ...(relativeFile.endsWith("timeout.dxf") ? { timeoutMs: 1 } : {}) };
    const result = match[1]
      ? await renderCadDocument({ ...common, layout: url.searchParams.get("layout") || "Model", visibleLayers: url.searchParams.getAll("layers"), ...(relativeFile.endsWith("malicious.dxf") ? { run: async () => malicious } : {}) })
      : await inspectCadDocument(common);
    if (!res.destroyed) json(res, 200, result);
  } catch (error) {
    if (error?.code === "cad_processing_cancelled") metrics.cancelled += 1;
    const status = error?.code?.includes("limit_exceeded") ? 413 : error?.code === "cad_processing_timeout" ? 408 : 400;
    if (!res.destroyed) json(res, status, { error: error instanceof CadPreviewError ? error.code : "cad_processing_failed", message: error instanceof Error ? error.message : "CAD preview failed." });
  } finally {
    metrics.active -= 1;
    res.off("close", disconnected);
  }
});

server.listen(port, "127.0.0.1");
const shutdown = () => server.close(() => { rmSync(root, { recursive: true, force: true }); process.exit(0); });
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:4175");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "authorization,content-type,range");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}
function json(res, status, value) { const body = JSON.stringify(value); res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store" }); res.end(body); }
function pointDrawing(count) {
  const parts = ["0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n"];
  for (let index = 0; index < count; index += 1) parts.push(`0\nPOINT\n8\n0\n10\n${index % 1000}\n20\n${Math.floor(index / 1000)}\n30\n0\n`);
  parts.push("0\nENDSEC\n0\nEOF\n");
  return parts.join("");
}
