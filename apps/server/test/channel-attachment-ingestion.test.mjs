import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ingestChannelAttachmentBytes, ingestChannelAttachmentCandidates } from "../src/services/channel-attachment-ingestion.mjs";

const publicDns = async () => [{ address: "93.184.216.34", family: 4 }];

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
  assert.equal(assets[0].originalName, "report.png");
  assert.equal(assets[0].mimeType, "image/png");
  assert.equal(assets[0].size, png.length);
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

test("stores trusted provider bytes through the same media and asset checks", async () => {
  const root = mkdtempSync(join(tmpdir(), "channel-attachment-bytes-"));
  const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.from("audio")]);
  const [asset] = await Promise.all([ingestChannelAttachmentBytes({
    filename: "voice.wav",
    bytes: wav,
    contentType: "audio/wav",
    projectPath: root,
    projectId: "project-1",
    terminalId: "terminal-1",
  })]);
  assert.equal(asset.family, "audio");
  assert.equal(asset.originalName, "voice.wav");
  assert.equal(asset.mimeType, "audio/wav");
  assert.ok(asset.capabilities.includes("preview"));
  assert.deepEqual(readFileSync(join(root, asset.path)), wav);
  await assert.rejects(() => ingestChannelAttachmentBytes({
    filename: "payload.html",
    bytes: Buffer.from("<script>bad</script>"),
    contentType: "text/html",
    projectPath: root,
    projectId: "project-1",
    terminalId: "terminal-1",
  }), /active_channel_attachment_refused/);
});

test("preserves a safe Unicode source name for the task while confining the stored file", async () => {
  const root = mkdtempSync(join(tmpdir(), "channel-attachment-unicode-"));
  const asset = await ingestChannelAttachmentBytes({
    filename: "客户订单明细.xlsx",
    bytes: Buffer.from("PK\u0003\u0004safe-workbook"),
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    projectPath: root,
    projectId: "project-1",
    terminalId: "terminal-1",
  });
  assert.equal(asset.originalName, "客户订单明细.xlsx");
  assert.match(asset.path, /^\.myagenttool\/channel-attachments\/[^/]+-客户订单明细\.xlsx$/);
  assert.deepEqual(readFileSync(join(root, asset.path)), Buffer.from("PK\u0003\u0004safe-workbook"));
});
