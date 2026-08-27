import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { createChannelAttachmentKnowledgeService } from "../src/services/channel-attachment-knowledge.mjs";
import { collectLocalContent } from "../src/services/local-content-collector.mjs";

const roots = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "myagenttool-channel-attachment-knowledge-"));
  roots.push(root);
  const projectPath = join(root, "project");
  const attachmentDirectory = join(projectPath, ".myagenttool", "channel-attachments");
  const stateStorePath = join(root, "state", "server.json");
  await mkdir(attachmentDirectory, { recursive: true });
  await mkdir(join(root, "state"), { recursive: true });
  const state = {
    projects: [{ id: "proj_1", ownerTeamId: "team_1", path: projectPath }],
    workItems: [],
    articleImportJobs: [],
    channelKnowledgeItems: [],
    channelAttachmentKnowledgeItems: [],
  };
  let sequence = 0;
  const service = createChannelAttachmentKnowledgeService({
    state,
    stateStorePath,
    now: () => "2026-08-26T10:00:00.000Z",
    nextId: (prefix) => `${prefix}_${++sequence}`,
  });
  return { root, projectPath, attachmentDirectory, stateStorePath, state, service };
}

async function sourceAsset(fx, name = "客户反馈.txt", content = "客户反馈集中在交付速度。\n") {
  const bytes = Buffer.from(content);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const relativePath = `.myagenttool/channel-attachments/${name}`;
  await writeFile(join(fx.projectPath, relativePath), bytes);
  return {
    id: `asset_${digest.slice(0, 24)}`,
    projectId: "proj_1",
    terminalId: "dev_1",
    originalName: name,
    path: relativePath,
    family: "file",
    mimeType: "text/plain",
    size: bytes.length,
    hash: `sha256:${digest}`,
    version: digest,
    readiness: { state: "ready" },
  };
}

test("a Channel attachment becomes managed searchable material and is deduplicated by content", async () => {
  const fx = await fixture();
  const asset = await sourceAsset(fx);
  const input = {
    channelId: "chn_1",
    conversationId: "conv_1",
    ownerTeamId: "team_1",
    projectId: "proj_1",
    projectPath: fx.projectPath,
    assets: [asset],
  };

  const first = await fx.service.capture({ ...input, eventId: "evt_1" });
  const replay = await fx.service.capture({ ...input, eventId: "evt_2" });

  assert.equal(first.ok, true);
  assert.equal(first.items.length, 1);
  assert.equal(replay.items[0].replayed, true);
  assert.equal(fx.state.channelAttachmentKnowledgeItems.length, 1);
  const stored = fx.state.channelAttachmentKnowledgeItems[0];
  assert.match(stored.relativePath, /^knowledge\/channel-attachments\//);
  assert.equal((await readFile(join(fx.root, "state", stored.relativePath), "utf8")).trim(), "客户反馈集中在交付速度。");
  assert.equal(stored.sources.length, 2);

  const catalog = await collectLocalContent({
    state: fx.state,
    stateStorePath: fx.stateStorePath,
    indexedAt: "2026-08-26T10:01:00.000Z",
    sources: ["materials"],
  });
  assert.equal(catalog.records.length, 1);
  assert.equal(catalog.records[0].kind, "material");
  assert.equal(catalog.records[0].sourceType, "channel_attachment_import");
  assert.match(catalog.records[0].searchText, /交付速度/);
  assert.equal(catalog.records[0].originalAvailable, true);
});

test("attachment capture refuses a source whose digest no longer matches the event asset", async () => {
  const fx = await fixture();
  const asset = await sourceAsset(fx);
  await writeFile(join(fx.projectPath, asset.path), "内容已被替换\n");

  const result = await fx.service.capture({
    channelId: "chn_1",
    conversationId: "conv_1",
    eventId: "evt_changed",
    ownerTeamId: "team_1",
    projectId: "proj_1",
    projectPath: fx.projectPath,
    assets: [asset],
  });

  assert.equal(result.ok, false);
  assert.equal(result.items.length, 0);
  assert.equal(result.failures[0].reason, "channel_attachment_knowledge_digest_mismatch");
  assert.equal(fx.state.channelAttachmentKnowledgeItems.length, 0);
});
