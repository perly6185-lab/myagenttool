import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ingestChannelAttachmentCandidates } from "../src/services/channel-attachment-ingestion.mjs";

const publicDns = async () => [{ address: "203.0.113.10", family: 4 }];

test("downloads, validates, confines, hashes, and governs a Channel attachment", async () => {
  const root = mkdtempSync(join(tmpdir(), "channel-attachment-"));
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from("safe")]);
  const assets = await ingestChannelAttachmentCandidates({
    candidates: [{ sourceUrl: "https://files.example.test/report.png", filename: "report.png" }],
    projectPath: root, projectId: "project-1", terminalId: "terminal-1",
    resolveHostname: publicDns,
    fetchAttachment: async () => new Response(png, { headers: { "content-type": "image/png" } }),
  });
  assert.equal(assets.length, 1);
  assert.equal(assets[0].projectId, "project-1");
  assert.equal(assets[0].terminalId, "terminal-1");
  assert.equal(assets[0].readiness.state, "ready");
  assert.deepEqual(readFileSync(join(root, assets[0].path)), png);
});

test("refuses active files, private sources, MIME spoofing, bad signatures, and oversize streams", async () => {
  const root = mkdtempSync(join(tmpdir(), "channel-attachment-refuse-"));
  const base = { projectPath: root, projectId: "project-1", terminalId: "terminal-1", resolveHostname: publicDns };
  await assert.rejects(() => ingestChannelAttachmentCandidates({
    ...base, candidates: [{ sourceUrl: "https://files.example.test/x", filename: "x.svg" }],
  }), /active_channel_attachment_refused/);
  await assert.rejects(() => ingestChannelAttachmentCandidates({
    ...base,
    resolveHostname: async () => [{ address: "127.0.0.1", family: 4 }],
    candidates: [{ sourceUrl: "https://localhost/x.png", filename: "x.png" }],
  }), /channel_attachment_source_refused/);
  await assert.rejects(() => ingestChannelAttachmentCandidates({
    ...base, candidates: [{ sourceUrl: "https://files.example.test/x.png", filename: "x.png" }],
    fetchAttachment: async () => new Response("not-png", { headers: { "content-type": "text/plain" } }),
  }), /channel_attachment_mime_mismatch/);
});
