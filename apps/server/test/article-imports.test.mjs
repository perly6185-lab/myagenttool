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
  resolveArticleImportConfig,
} from "../src/services/article-imports.mjs";

const PUBLIC_DNS = async () => [{ address: "93.184.216.34" }];

test("detects source providers and builds deterministic source/date paths", () => {
  assert.equal(detectArticleSource("https://mp.weixin.qq.com/s/example"), "wechat");
  assert.equal(detectArticleSource("https://www.xiaohongshu.com/explore/example"), "xiaohongshu");
  assert.equal(detectArticleSource("https://zhuanlan.zhihu.com/p/123"), "zhihu");
  assert.equal(detectArticleSource("https://juejin.cn/post/123"), "juejin");
  assert.equal(detectArticleSource("https://www.jianshu.com/p/123"), "jianshu");
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

test("resolves bounded runtime concurrency settings", () => {
  const configured = resolveArticleImportConfig({
    MYAGENTTOOL_ARTICLE_IMPORT_MAX_CONCURRENT: "6",
    MYAGENTTOOL_ARTICLE_MEDIA_CONCURRENCY: "12",
  });
  assert.equal(configured.maxConcurrent, 6);
  assert.equal(configured.limits.mediaConcurrency, 12);
  assert.equal(resolveArticleImportConfig({
    MYAGENTTOOL_ARTICLE_IMPORT_MAX_CONCURRENT: "0",
    MYAGENTTOOL_ARTICLE_MEDIA_CONCURRENCY: "99",
  }).maxConcurrent, 2);
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

test("recovers Xiaohongshu note metadata and direct media from hydration data", async () => {
  const result = await inspectArticle({
    url: "https://www.xiaohongshu.com/explore/note-1",
    resolveHostname: PUBLIC_DNS,
    fetchImpl: async () => htmlResponse(`<!doctype html><html><body>
      <div class="note-content"><p>页面正文</p><img data-src="https://sns-img.example/note.jpg"></div>
      <script>window.__INITIAL_STATE__ = ${JSON.stringify({
        note: {
          title: "结构化笔记",
          desc: "结构化说明",
          user: { nickname: "红薯作者" },
          publishTime: Date.parse("2026-07-20T10:00:00+08:00"),
          imageList: [{ urlDefault: "https://sns-img.example/note.jpg" }],
          video: { videoUrl: "https://sns-video.example/note.mp4" },
        },
        recommendations: [{
          title: "不应导入的推荐笔记",
          desc: "推荐内容",
          imageList: [{ urlDefault: "https://sns-img.example/unrelated.jpg" }],
        }],
      })};</script>
    </body></html>`),
  });
  assert.equal(result.provider, "xiaohongshu");
  assert.equal(result.contentType, "note");
  assert.equal(result.title, "结构化笔记");
  assert.equal(result.author, "红薯作者");
  assert.equal(result.publishedAt, "2026-07-20");
  assert.deepEqual(result.mediaCounts, { images: 1, audio: 0, video: 1 });
});

test("uses provider-specific article roots and metadata for Juejin", async () => {
  const result = await inspectArticle({
    url: "https://juejin.cn/post/123",
    resolveHostname: PUBLIC_DNS,
    fetchImpl: async () => htmlResponse(`
      <title>long SEO description - 掘金</title>
      <meta itemprop="datePublished" content="2026-06-18T10:30:00+08:00">
      <h1 class="article-title">准确标题</h1>
      <div class="author-name"><span>掘金作者</span></div>
      <div class="article-content"><p>只保留正文</p></div>
      <aside><p>推荐内容</p></aside>
    `),
  });
  assert.equal(result.provider, "juejin");
  assert.equal(result.title, "准确标题");
  assert.equal(result.author, "掘金作者");
  assert.equal(result.publishedAt, "2026-06-18");
  assert.match(result.markdownPreview, /只保留正文/);
  assert.doesNotMatch(result.markdownPreview, /推荐内容/);
});

test("writes sanitized standalone HTML with localized audio, video, and poster", async (t) => {
  const worktreePath = await mkdtemp(join(tmpdir(), "myagenttool-article-html-"));
  t.after(() => rm(worktreePath, { recursive: true, force: true }));
  const result = await importArticleToWorktree({
    url: "https://example.com/media",
    worktreePath,
    workItemId: "lwi_media_html",
    importedAt: "2026-07-28T01:02:03.000Z",
    resolveHostname: PUBLIC_DNS,
    fetchImpl: async (url) => {
      if (String(url).endsWith("/media")) return htmlResponse(`
        <article>
          <script>alert("no")</script><iframe src="https://evil.example"></iframe>
          <p onclick="alert(1)">正文</p>
          <audio data-audio-url="https://cdn.example/sound.mp3" title="讲解"></audio>
          <video data-video-url="https://cdn.example/movie.mp4" poster="https://cdn.example/poster.jpg" onerror="bad()"></video>
        </article>`);
      if (String(url).endsWith(".jpg")) return new Response(Buffer.from([0xff, 0xd8, 0xff, 0x01]), { headers: { "content-type": "image/jpeg" } });
      if (String(url).endsWith(".mp3")) return new Response(Buffer.from("ID3audio"), { headers: { "content-type": "audio/mpeg" } });
      return new Response(Buffer.concat([Buffer.alloc(4), Buffer.from("ftyp"), Buffer.from("video")]), { headers: { "content-type": "video/mp4" } });
    },
  });
  const html = await readFile(join(worktreePath, result.htmlPath), "utf8");
  const markdown = await readFile(join(worktreePath, result.markdownPath), "utf8");
  const manifest = JSON.parse(await readFile(join(worktreePath, result.manifestPath), "utf8"));
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.outputs.html, "article.html");
  assert.deepEqual(result.mediaCounts, { images: 1, audio: 1, video: 1 });
  assert.match(html, /<audio controls[^>]+src="assets\//);
  assert.match(html, /<video controls[^>]+src="assets\//);
  assert.match(html, /<img src="assets\//);
  assert.doesNotMatch(html, /<script|<iframe|onclick=|onerror=|https:\/\/cdn\.example/);
  assert.match(markdown, /音频.*assets\/.*\.mp3/);
  assert.match(markdown, /视频.*assets\/.*\.mp4/);
});

test("marks an in-flight durable job as interrupted after service restart", () => {
  let persisted = 0;
  const state = {
    articleImportJobs: [{
      id: "article_import_old",
      workItemId: "lwi_1",
      worktreeId: "wtr_1",
      sourceUrl: "https://example.com/article",
      canonicalUrl: "https://example.com/article",
      state: "running",
      progress: { stage: "downloading", completed: 0, total: 1 },
      createdAt: "2026-07-28T00:00:00.000Z",
      startedAt: "2026-07-28T00:00:01.000Z",
      completedAt: null,
      error: null,
      result: null,
    }],
  };
  const service = createArticleImportService({
    state,
    now: () => "2026-07-28T00:01:00.000Z",
    persistStateSoon: () => { persisted += 1; },
    workItemService: {
      getWorkItem: () => ({ ok: true, status: 200, body: { workItem: { id: "lwi_1" } } }),
    },
  });
  const recovered = service.get({ workItemId: "lwi_1", jobId: "article_import_old" });
  assert.equal(recovered.body.job.state, "failed");
  assert.equal(recovered.body.job.error, "article_import_interrupted");
  assert.equal(state.articleImportJobs[0].state, "failed");
  assert.equal(persisted, 1);
});

test("preserves the source calendar date instead of shifting it to UTC", async () => {
  const offsetResult = await inspectArticle({
    url: "https://mp.weixin.qq.com/s/offset",
    resolveHostname: PUBLIC_DNS,
    fetchImpl: async () => htmlResponse(`
      <meta property="article:published_time" content="2026-07-27T00:30:00+08:00">
      <article>offset</article>
    `),
  });
  assert.equal(offsetResult.publishedAt, "2026-07-27");

  const epoch = Math.floor(Date.parse("2026-07-27T00:30:00+08:00") / 1000);
  const epochResult = await inspectArticle({
    url: "https://mp.weixin.qq.com/s/epoch",
    resolveHostname: PUBLIC_DNS,
    fetchImpl: async () => htmlResponse(`<article>epoch</article><script>var publish_time = "${epoch}";</script>`),
  });
  assert.equal(epochResult.publishedAt, "2026-07-27");
});

test("applies the download timeout while the response body is streaming", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("<article>partial"));
    },
  });
  await assert.rejects(
    inspectArticle({
      url: "https://example.com/slow",
      resolveHostname: PUBLIC_DNS,
      fetchImpl: async () => new Response(stream, { headers: { "content-type": "text/html" } }),
      limits: { ...resolveArticleImportConfig().limits, timeoutMs: 20 },
    }),
    (error) => error.code === "article_download_timeout",
  );
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

test("falls back to the import date and keeps same-title URLs distinct", async (t) => {
  const worktreePath = await mkdtemp(join(tmpdir(), "myagenttool-article-fallback-"));
  t.after(() => rm(worktreePath, { recursive: true, force: true }));
  const importOne = (url) => importArticleToWorktree({
    url,
    worktreePath,
    workItemId: "lwi_fallback",
    importedAt: "2026-07-28T03:00:00.000Z",
    resolveHostname: PUBLIC_DNS,
    fetchImpl: async () => htmlResponse("<title>Same title</title><article>Text</article>"),
  });
  const first = await importOne("https://example.com/one");
  const second = await importOne("https://example.com/two");
  const manifest = JSON.parse(await readFile(join(worktreePath, first.manifestPath), "utf8"));
  assert.match(first.relativeDirectory, /\/2026\/07\/2026-07-28-/);
  assert.equal(manifest.publishedAtSource, "imported");
  assert.notEqual(first.relativeDirectory, second.relativeDirectory);
});

test("keeps usable Markdown and records a warning when one media download fails", async (t) => {
  const worktreePath = await mkdtemp(join(tmpdir(), "myagenttool-article-partial-"));
  t.after(() => rm(worktreePath, { recursive: true, force: true }));
  const result = await importArticleToWorktree({
    url: "https://example.com/partial",
    worktreePath,
    workItemId: "lwi_partial",
    resolveHostname: PUBLIC_DNS,
    fetchImpl: async (url) => {
      if (String(url).endsWith("/partial")) {
        return htmlResponse('<article>Before<img src="https://media.example/good.jpg" alt="good">After<img src="https://media.example/bad.jpg" alt="bad"></article>');
      }
      if (String(url).includes("bad.jpg")) return new Response("failed", { status: 503 });
      return new Response(Buffer.from([0xff, 0xd8, 0xff, 0x01]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    },
  });
  const markdown = await readFile(join(worktreePath, result.markdownPath), "utf8");
  const manifest = JSON.parse(await readFile(join(worktreePath, result.manifestPath), "utf8"));
  assert.match(markdown, /Before[\s\S]+!\[good\]\(assets\//);
  assert.match(markdown, /图片下载失败/);
  assert.doesNotMatch(markdown, /media\.example/);
  assert.equal(manifest.warnings.length, 1);
  assert.equal(manifest.warnings[0].code, "article_download_http_503");
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
    fetchImpl: async (url) => {
      if (String(url).includes("mp.weixin.qq.com")) return htmlResponse(wechatFixture());
      if (String(url).endsWith("image-3")) return new Response("unavailable", { status: 503 });
      return new Response(Buffer.from([0xff, 0xd8, 0xff, Number(String(url).at(-1))]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    },
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
  assert.equal(updates[0].outputAssets.length, 3);
  assert.match(updates[0].outputAssets[0].path, /article\.md$/);
  assert.match(updates[0].outputAssets[1].path, /article\.html$/);
  assert.equal(comments.length, 1);
  assert.match(comments[0].body, /1 media item\(s\) could not be downloaded/);
});

test("caps one article to four concurrent media downloads", async (t) => {
  const worktreePath = await mkdtemp(join(tmpdir(), "myagenttool-article-media-cap-"));
  t.after(() => rm(worktreePath, { recursive: true, force: true }));
  let active = 0;
  let maximum = 0;
  const html = `<article>${Array.from({ length: 7 }, (_, index) =>
    `<img src="https://media.example/image-${index}.jpg" alt="${index}">`).join("")}</article>`;
  await importArticleToWorktree({
    url: "https://example.com/article",
    worktreePath,
    workItemId: "lwi_media",
    resolveHostname: PUBLIC_DNS,
    fetchImpl: async (url) => {
      if (String(url) === "https://example.com/article") return htmlResponse(html);
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      const suffix = Number(String(url).match(/image-(\d+)/)?.[1] ?? 0);
      return new Response(Buffer.from([0xff, 0xd8, 0xff, suffix]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    },
  });
  assert.equal(maximum, 4);
});

test("enforces the global queue, rejects duplicate Issue work, and cleans canceled output", async (t) => {
  const firstRoot = await mkdtemp(join(tmpdir(), "myagenttool-article-cancel-"));
  const secondRoot = await mkdtemp(join(tmpdir(), "myagenttool-article-next-"));
  t.after(() => Promise.all([
    rm(firstRoot, { recursive: true, force: true }),
    rm(secondRoot, { recursive: true, force: true }),
  ]));
  const items = [
    { id: "lwi_1", localNumber: 1, projectId: "prj_1", terminalId: "dev_1", revision: 1, labels: [], outputAssets: [] },
    { id: "lwi_2", localNumber: 2, projectId: "prj_1", terminalId: "dev_1", revision: 1, labels: [], outputAssets: [] },
  ];
  const workItemService = {
    getWorkItem: ({ workItemId }) => {
      const item = items.find((candidate) => candidate.id === workItemId);
      return item
        ? { ok: true, status: 200, body: { workItem: item } }
        : { ok: false, status: 404, body: { error: "work_item_not_found" } };
    },
    recordExecutionBinding: ({ workItemId }) => {
      items.find((item) => item.id === workItemId).revision += 1;
      return { ok: true, status: 200, body: {} };
    },
    updateWorkItem: ({ workItemId, ...changes }) => {
      const item = items.find((candidate) => candidate.id === workItemId);
      Object.assign(item, changes, { revision: item.revision + 1 });
      return { ok: true, status: 200, body: { workItem: item } };
    },
    createComment: () => ({ ok: true, status: 201, body: {} }),
  };
  let id = 0;
  const service = createArticleImportService({
    state: {
      workItems: items,
      worktrees: [
        { id: "wtr_1", sourceProjectId: "prj_1", path: firstRoot, link: { type: "local_issue", number: 1 } },
        { id: "wtr_2", sourceProjectId: "prj_1", path: secondRoot, link: { type: "local_issue", number: 2 } },
      ],
    },
    nextId: () => `article_import_${++id}`,
    workItemService,
    resolveHostname: PUBLIC_DNS,
    maxConcurrent: 1,
    fetchImpl: async (url, options) => {
      if (String(url).includes("/first")) {
        return htmlResponse('<article><img src="https://media.example/hold.jpg"></article>');
      }
      if (String(url).includes("/second")) return htmlResponse("<article>second</article>");
      if (String(url).includes("hold.jpg")) {
        return new Promise((resolve, reject) => {
          options.signal.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          }, { once: true });
        });
      }
      throw new Error(`unexpected URL: ${url}`);
    },
  });
  const first = service.start({ workItemId: "lwi_1", worktreeId: "wtr_1", url: "https://example.com/first" });
  const duplicate = service.start({ workItemId: "lwi_1", worktreeId: "wtr_1", url: "https://example.com/first" });
  const second = service.start({ workItemId: "lwi_2", worktreeId: "wtr_2", url: "https://example.com/second" });
  assert.equal(first.status, 202);
  assert.equal(duplicate.status, 409);
  assert.equal(second.body.job.state, "queued");
  await waitForJobState(service, "lwi_1", first.body.job.id, "running");
  assert.equal(service.get({ workItemId: "lwi_2", jobId: second.body.job.id }).body.job.state, "queued");
  service.cancel({ workItemId: "lwi_1", jobId: first.body.job.id });
  await waitForJobState(service, "lwi_1", first.body.job.id, "canceled");
  await waitForJobState(service, "lwi_2", second.body.job.id, "completed");
  const firstFiles = await readdir(firstRoot, { recursive: true });
  assert.equal(firstFiles.some((entry) => String(entry).endsWith("article.md")), false);
});

async function waitForJobState(service, workItemId, jobId, expected) {
  let lastState = "unknown";
  for (let attempts = 0; attempts < 1_000; attempts += 1) {
    const job = service.get({ workItemId, jobId }).body.job;
    lastState = job.state;
    if (job.state === expected) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`job ${jobId} did not reach ${expected}; last state: ${lastState}`);
}

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
