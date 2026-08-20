import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { createChannelKnowledgeService } from "../src/services/channel-knowledge.mjs";
import { collectLocalContent } from "../src/services/local-content-collector.mjs";

const roots = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function harness({ importArticle, items = [] } = {}) {
  const root = await mkdtemp(join(tmpdir(), "myagenttool-channel-knowledge-"));
  roots.push(root);
  const stateStorePath = join(root, "state.json");
  const state = {
    channels: [{ id: "chn_1", ownerTeamId: "team_1", taskProjectId: "proj_1" }],
    projects: [{ id: "proj_1", ownerTeamId: "team_1", path: join(root, "project") }],
    channelKnowledgeItems: items,
    workItems: [],
    articleImportJobs: [],
  };
  let sequence = 0;
  let persisted = 0;
  const service = createChannelKnowledgeService({
    state,
    stateStorePath,
    now: () => "2026-08-20T12:00:00.000Z",
    nextId: (prefix) => `${prefix}_${++sequence}`,
    persistStateSoon: () => { persisted += 1; },
    importArticle,
  });
  return { root, stateStorePath, state, service, persisted: () => persisted };
}

test("a channel link is saved as managed local knowledge and reused without downloading twice", async () => {
  let imports = 0;
  const h = await harness({
    importArticle: async ({ url, worktreePath }) => {
      imports += 1;
      const directory = join(worktreePath, "docs/imported/wechat/2026/08/article");
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "article.md"), "# 已保存文章\n\n这是可检索正文。\n");
      await writeFile(join(directory, "article.html"), "<h1>已保存文章</h1>");
      await writeFile(join(directory, "manifest.json"), "{}\n");
      return {
        replayed: false,
        markdownPath: "docs/imported/wechat/2026/08/article/article.md",
        htmlPath: "docs/imported/wechat/2026/08/article/article.html",
        manifestPath: "docs/imported/wechat/2026/08/article/manifest.json",
        mediaCounts: { images: 1, audio: 0, video: 0 },
        warnings: [],
        inspection: {
          sourceUrl: url, canonicalUrl: url, provider: "wechat", contentType: "article",
          title: "已保存文章", author: "作者", publishedAt: "2026-08-20", textLength: 20,
          _document: { markdown: "# 已保存文章\n\n这是可检索正文。", media: [] },
        },
      };
    },
  });

  const input = {
    url: "https://mp.weixin.qq.com/s/knowledge-one", channelId: "chn_1",
    conversationId: "conv_1", eventId: "event_1",
  };
  const first = await h.service.capture(input);
  const second = await h.service.capture({ ...input, eventId: "event_2" });

  assert.equal(imports, 1);
  assert.equal(first.knowledge.status, "saved");
  assert.equal(second.knowledge.replayed, true);
  assert.equal(h.state.channelKnowledgeItems.length, 1);
  assert.equal(h.state.channelKnowledgeItems[0].status, "ready");
  assert.match(h.state.channelKnowledgeItems[0].markdownPath, /^knowledge\/channel-articles\//);
  assert.match(second._document.markdown, /可检索正文/);

  const location = h.service.getItemLocation({ itemId: first.knowledge.itemId, ownerTeamId: "team_1" });
  assert.equal(location.title, "已保存文章");
  assert.match(location.contentId, /^lc_[a-f0-9]{32}$/);
  assert.match(location.relativePath, /^knowledge\/channel-articles\//);
  assert.equal(location.absolutePath, join(h.root, location.relativePath));
  assert.equal(h.service.getItemLocation({ itemId: first.knowledge.itemId, ownerTeamId: "team_2" }), null);

  const catalog = await collectLocalContent({
    state: h.state,
    stateStorePath: h.stateStorePath,
    indexedAt: "2026-08-20T12:01:00.000Z",
    sources: ["articles"],
  });
  const record = catalog.records.find((candidate) => candidate.sourceType === "channel_article_import");
  assert.equal(record.title, "已保存文章");
  assert.equal(record.storageMode, "managed");
  assert.equal(record.rootKind, "application_data");
  assert.match(record.searchBody, /可检索正文/);
});

test("a failed save remains auditable and can be retried on the next share", async () => {
  let attempts = 0;
  const h = await harness({
    importArticle: async () => {
      attempts += 1;
      throw Object.assign(new Error("disk unavailable"), { code: "disk_unavailable" });
    },
  });

  await assert.rejects(
    h.service.capture({ url: "https://mp.weixin.qq.com/s/fail", channelId: "chn_1" }),
    /disk unavailable/,
  );
  await assert.rejects(
    h.service.capture({ url: "https://mp.weixin.qq.com/s/fail", channelId: "chn_1" }),
    /disk unavailable/,
  );

  assert.equal(attempts, 2);
  assert.equal(h.state.channelKnowledgeItems.length, 2);
  assert.equal(h.state.channelKnowledgeItems.every((item) => item.status === "failed"), true);
  assert.equal(h.state.channelKnowledgeItems[0].error, "disk_unavailable");
});

test("activating a matching extractor can retry failed original links without resending them", async () => {
  let attempt = 0;
  const h = await harness({
    importArticle: async ({ url, worktreePath, ownerTeamId }) => {
      attempt += 1;
      assert.equal(ownerTeamId, "team_1");
      if (attempt === 1) throw Object.assign(new Error("unsupported page"), { code: "article_content_incomplete" });
      const directory = join(worktreePath, "docs/imported/web/2026/08/plugin-retry");
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "article.md"), "# 插件重试成功\n");
      await writeFile(join(directory, "article.html"), "<h1>插件重试成功</h1>");
      await writeFile(join(directory, "manifest.json"), "{}\n");
      return {
        replayed: false,
        markdownPath: "docs/imported/web/2026/08/plugin-retry/article.md",
        htmlPath: "docs/imported/web/2026/08/plugin-retry/article.html",
        manifestPath: "docs/imported/web/2026/08/plugin-retry/manifest.json",
        mediaCounts: { images: 0, audio: 0, video: 0 },
        warnings: [],
        inspection: {
          sourceUrl: url, canonicalUrl: url, provider: "web", contentType: "article",
          title: "插件重试成功", author: null, publishedAt: null, textLength: 20,
          _document: { markdown: "# 插件重试成功", media: [] },
        },
      };
    },
  });
  await assert.rejects(h.service.capture({
    url: "https://news.example.com/post/1",
    channelId: "chn_1",
    conversationId: "conv_1",
    eventId: "evt_1",
  }), /unsupported page/);

  const retried = await h.service.retryFailedForHosts(["news.example.com"], "team_1");
  assert.equal(retried.length, 1);
  assert.equal(retried[0].ok, true);
  assert.equal(retried[0].result.title, "插件重试成功");
  assert.equal(h.state.channelKnowledgeItems.at(-1).status, "ready");
  assert.equal(attempt, 2);
});

test("restart recovery marks interrupted channel knowledge saves as failed", async () => {
  const h = await harness({
    items: [{ id: "knowledge_old", status: "saving", canonicalUrl: "https://example.com/old" }],
    importArticle: async () => { throw new Error("not called"); },
  });

  assert.equal(h.state.channelKnowledgeItems[0].status, "failed");
  assert.equal(h.state.channelKnowledgeItems[0].error, "channel_knowledge_import_interrupted");
  assert.ok(h.persisted() > 0);
});
