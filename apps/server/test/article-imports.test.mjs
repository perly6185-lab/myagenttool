import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildArticleRelativeDirectory,
  canonicalizeArticleUrl,
  createArticleImportService,
  detectArticleSource,
  importArticleToWorktree,
  inspectArticle,
} from "../src/services/article-imports.mjs";

const PUBLIC_DNS = async () => [{ address: "93.184.216.34" }];

test("detects source providers and builds deterministic source/date paths", () => {
  assert.equal(detectArticleSource("https://mp.weixin.qq.com/s/example"), "wechat");
  assert.equal(detectArticleSource("https://www.xiaohongshu.com/explore/example"), "xiaohongshu");
  assert.equal(detectArticleSource("https://example.com/post"), "web");
  assert.equal(
    canonicalizeArticleUrl("https://EXAMPLE.com/post?utm_source=test&id=1#part"),
    "https://example.com/post?id=1",
  );
  assert.equal(
    buildArticleRelativeDirectory({
      provider: "wechat",
      date: "2026-07-27",
      title: "一个 / 链接：进去",
      canonicalUrl: "https://mp.weixin.qq.com/s/example",
    }),
    "docs/imported/wechat/2026/07/2026-07-27-一个-链接进去-e9514928",
  );
});

test("inspects WeChat lazy images while preserving content order", async () => {
  const result = await inspectArticle({
    url: "https://mp.weixin.qq.com/s/example",
    resolveHostname: PUBLIC_DNS,
    fetchImpl: async () => htmlResponse(wechatFixture()),
  });
  assert.equal(result.provider, "wechat");
  assert.equal(result.title, "测试公众号文章");
  assert.equal(result.author, "林月半子");
  assert.equal(result.publishedAt, "2026-07-27");
  assert.deepEqual(result.mediaCounts, { images: 3, audio: 0, video: 0 });
  assert.match(result.markdownPreview, /第一段[\s\S]+MYAGENTTOOL_MEDIA_0[\s\S]+第二段/);
});

test("imports Markdown and media atomically under source/date directories", async (t) => {
  const worktreePath = await mkdtemp(join(tmpdir(), "myagenttool-article-"));
  t.after(() => rm(worktreePath, { recursive: true, force: true }));
  const imageBytes = [
    Buffer.from([0xff, 0xd8, 0xff, 0x01]),
    Buffer.from([0xff, 0xd8, 0xff, 0x02]),
    Buffer.from([0xff, 0xd8, 0xff, 0x03]),
  ];
  const result = await importArticleToWorktree({
    url: "https://mp.weixin.qq.com/s/example",
    worktreePath,
    workItemId: "lwi_test",
    importedAt: "2026-07-28T01:02:03.000Z",
    resolveHostname: PUBLIC_DNS,
    fetchImpl: async (url) => {
      if (String(url).includes("mp.weixin.qq.com")) return htmlResponse(wechatFixture());
      const index = Number(String(url).match(/image-(\d)/)?.[1] ?? 1) - 1;
      return new Response(imageBytes[index], { status: 200, headers: { "content-type": "image/jpeg" } });
    },
  });
  assert.match(result.relativeDirectory, /^docs\/imported\/wechat\/2026\/07\/2026-07-27-/);
  const markdown = await readFile(join(worktreePath, result.markdownPath), "utf8");
  const manifest = JSON.parse(await readFile(join(worktreePath, result.manifestPath), "utf8"));
  const assets = await readdir(join(worktreePath, result.relativeDirectory, "assets"));
  assert.equal(assets.length, 3);
  assert.equal(manifest.sourceProvider, "wechat");
  assert.equal(manifest.publishedAtSource, "source");
  assert.equal(manifest.media.length, 3);
  assert.equal(manifest.warnings.length, 0);
  assert.match(markdown, /source_provider: wechat/);
  assert.match(markdown, /第一段[\s\S]+!\[图一\]\(assets\/001-[^)]+\.jpg\)[\s\S]+第二段/);
  assert.doesNotMatch(markdown, /mmbiz\.qpic\.cn/);

  const replay = await importArticleToWorktree({
    url: "https://mp.weixin.qq.com/s/example",
    worktreePath,
    workItemId: "lwi_test",
    resolveHostname: PUBLIC_DNS,
    fetchImpl: async () => htmlResponse(wechatFixture()),
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.markdownPath, result.markdownPath);
});

test("rejects a redirect that resolves to a private address", async () => {
  let calls = 0;
  await assert.rejects(
    inspectArticle({
      url: "https://example.com/article",
      resolveHostname: async (hostname) => hostname === "private.example"
        ? [{ address: "127.0.0.1" }]
        : [{ address: "93.184.216.34" }],
      fetchImpl: async () => {
        calls += 1;
        return new Response(null, { status: 302, headers: { location: "https://private.example/secret" } });
      },
    }),
    (error) => error.code === "article_url_refused",
  );
  assert.equal(calls, 1);
});

test("rejects mixed public/private DNS answers before fetching", async () => {
  let fetched = false;
  await assert.rejects(
    inspectArticle({
      url: "https://mixed.example/article",
      resolveHostname: async () => [{ address: "93.184.216.34" }, { address: "10.0.0.8" }],
      fetchImpl: async () => {
        fetched = true;
        return htmlResponse("<article>unsafe</article>");
      },
    }),
    (error) => error.code === "article_url_refused",
  );
  assert.equal(fetched, false);
});

test("queues an Issue-bound import and attaches generated output assets", async (t) => {
  const worktreePath = await mkdtemp(join(tmpdir(), "myagenttool-article-job-"));
  t.after(() => rm(worktreePath, { recursive: true, force: true }));
  const item = {
    id: "lwi_1", localNumber: 1, projectId: "prj_1", terminalId: "dev_1",
    revision: 1, labels: [], outputAssets: [],
  };
  const updates = [];
  const bindings = [];
  const comments = [];
  const workItemService = {
    getWorkItem: ({ workItemId }) => workItemId === item.id
      ? { ok: true, status: 200, body: { workItem: item } }
      : { ok: false, status: 404, body: { error: "work_item_not_found" } },
    recordExecutionBinding: (input) => {
      bindings.push(input);
      item.revision += 1;
      return { ok: true, status: 200, body: { binding: input } };
    },
    updateWorkItem: (input) => {
      updates.push(input);
      Object.assign(item, input, { revision: item.revision + 1 });
      return { ok: true, status: 200, body: { workItem: item } };
    },
    createComment: (input) => {
      comments.push(input);
      return { ok: true, status: 201, body: { comment: input } };
    },
  };
  const service = createArticleImportService({
    state: {
      workItems: [item],
      projects: [{ id: "prj_1", ownerTeamId: "team_local" }],
      worktrees: [{
        id: "wtr_1", sourceProjectId: "prj_1", path: worktreePath,
        link: { type: "local_issue", number: 1 },
      }],
    },
    nextId: () => "article_import_1",
    workItemService,
    resolveHostname: PUBLIC_DNS,
    fetchImpl: async (url) => String(url).includes("mp.weixin.qq.com")
      ? htmlResponse(wechatFixture())
      : new Response(Buffer.from([0xff, 0xd8, 0xff, Number(String(url).at(-1))]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
  });
  const started = service.start({
    workItemId: "lwi_1",
    worktreeId: "wtr_1",
    url: "https://mp.weixin.qq.com/s/example",
  });
  assert.equal(started.status, 202);
  let job = started.body.job;
  for (let attempts = 0; attempts < 100 && ["queued", "running"].includes(job.state); attempts += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    job = service.get({ workItemId: "lwi_1", jobId: job.id }).body.job;
  }
  assert.equal(job.state, "completed");
  assert.equal(bindings[0].kind, "article_import");
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].labels, ["source:wechat", "content:article"]);
  assert.equal(updates[0].outputAssets.length, 2);
  assert.match(updates[0].outputAssets[0].path, /article\.md$/);
  assert.equal(comments.length, 1);
});

function htmlResponse(html) {
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function wechatFixture() {
  return `<!doctype html>
  <html>
    <head>
      <meta property="og:title" content="测试公众号文章">
      <meta name="author" content="林月半子">
      <meta property="article:published_time" content="2026-07-27T08:30:00+08:00">
    </head>
    <body>
      <div id="js_content">
        <p>第一段</p>
        <img data-src="https://mmbiz.qpic.cn/image-1" alt="图一">
        <p>第二段</p>
        <img data-src="https://mmbiz.qpic.cn/image-2" alt="图二">
        <img data-src="https://mmbiz.qpic.cn/image-3" alt="图三">
      </div>
    </body>
  </html>`;
}
