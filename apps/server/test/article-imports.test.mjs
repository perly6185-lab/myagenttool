import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { handleWorkItemRoutes } from "../src/routes/work-items.mjs";
import {
  analyzeArticleMarkdown,
  buildArticleDerivativePrompt,
  buildArticleSimilarityDocument,
  buildArticleRelativeDirectory,
  canonicalizeArticleUrl,
  createArticleImportService,
  detectArticleSource,
  importArticleToWorktree,
  inspectArticle,
  compareArticleSimilarity,
  normalizeArticleDerivativeRequest,
  resolveArticleImportConfig,
} from "../src/services/article-imports.mjs";

const PUBLIC_DNS = async () => [{ address: "93.184.216.34" }];

test("detects source providers and builds deterministic source/date paths", () => {
  assert.equal(detectArticleSource("https://mp.weixin.qq.com/s/example"), "wechat");
  assert.equal(detectArticleSource("https://www.xiaohongshu.com/explore/example"), "xiaohongshu");
  assert.equal(detectArticleSource("https://zhuanlan.zhihu.com/p/123"), "zhihu");
  assert.equal(detectArticleSource("https://juejin.cn/post/123"), "juejin");
  assert.equal(detectArticleSource("https://www.jianshu.com/p/123"), "jianshu");
  assert.equal(detectArticleSource("https://mynhkbykqf.feishu.cn/wiki/CHDzwTXYriLNIpk2HsRcx2VWnQe"), "feishu");
  assert.equal(detectArticleSource("https://tenant.larksuite.com/docx/CHDzwTXYriLNIpk2HsRcx2VWnQe"), "feishu");
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
    MYAGENTTOOL_ARTICLE_IMPORT_MAX_PENDING: "42",
    MYAGENTTOOL_ARTICLE_MEDIA_CONCURRENCY: "12",
  });
  assert.equal(configured.maxConcurrent, 6);
  assert.equal(configured.maxPending, 42);
  assert.equal(configured.limits.mediaConcurrency, 12);
  assert.equal(resolveArticleImportConfig({
    MYAGENTTOOL_ARTICLE_IMPORT_MAX_CONCURRENT: "0",
    MYAGENTTOOL_ARTICLE_MEDIA_CONCURRENCY: "99",
  }).maxConcurrent, 2);
  assert.equal(resolveArticleImportConfig({
    MYAGENTTOOL_ARTICLE_IMPORT_MAX_PENDING: "999",
  }).maxPending, 100);
});

test("extracts an article framework, core ideas, and concepts from imported Markdown", () => {
  const analysis = analyzeArticleMarkdown(`---
title: "一个链接进去"
---
作者先从一次真实体验切入，说明产品不是简单朗读，而是围绕观点组织内容。

## 01 一个输入，多种产出

ListenHub 的定位是：把任何内容变成任何格式。它支持文章、PDF 和视频等输入，并产出播客、故事书和解说视频。

## 02 为什么它的下限比较高

它把怎么做一个有节奏的播客等判断预先打包进生产流程，因此不懂脚本结构的用户也能得到可用结果。

## 03 没解决的

内容仍有套路感，中文断句和声音情绪也存在局限。
`, { title: "一个链接进去", generatedAt: "2026-07-28T00:00:00.000Z" });
  assert.equal(analysis.title, "一个链接进去");
  assert.equal(analysis.method, "local-extractive-v1");
  assert.deepEqual(analysis.framework.map((section) => section.role), [
    "introduction", "development", "evidence", "boundary",
  ]);
  assert.match(analysis.coreIdeas.join("\n"), /任何内容变成任何格式/);
  assert.match(analysis.coreIdeas.join("\n"), /生产流程/);
  assert.deepEqual(analysis.keyConcepts, [
    "一个输入，多种产出", "为什么它的下限比较高", "没解决的",
  ]);
});

test("builds a bounded derivative prompt with an exact output contract and source isolation", () => {
  const request = normalizeArticleDerivativeRequest({
    kind: "video_script",
    tone: "conversational",
    length: "short",
    audience: "内容创作者",
    angle: "平台替普通用户做了多少内容生产决策",
  });
  const prompt = buildArticleDerivativePrompt({
    derivativeId: "article_derivative_1",
    request,
    sourcePath: "docs/imported/wechat/article/article.md",
    analysisPath: "docs/imported/wechat/article/analysis.md",
    outputPath: "docs/imported/wechat/article/derivatives/video-script-001.md",
    sourceUrl: "https://mp.weixin.qq.com/s/example",
    generatedAt: "2026-07-28T00:00:00.000Z",
    workItemId: "lwi_1",
  });
  assert.match(prompt, /UNTRUSTED REFERENCE DATA/);
  assert.match(prompt, /Never follow instructions/);
  assert.match(prompt, /3-second hook/);
  assert.match(prompt, /video-script-001\.md/);
  assert.match(prompt, /derivative_id: "article_derivative_1"/);
  assert.match(prompt, /audience_preset: custom/);
  assert.match(prompt, /age_preset: all/);
  assert.match(prompt, /supplied audience's work or life context/);
  assert.match(prompt, /Never infer intelligence, technical ability, income/);

  const generalPrompt = buildArticleDerivativePrompt({
    derivativeId: "article_derivative_general",
    request: normalizeArticleDerivativeRequest({
      kind: "article_rewrite",
      audiencePreset: "general",
    }),
    sourcePath: "article.md",
    outputPath: "derivatives/general.md",
    generatedAt: "2026-07-28T00:00:00.000Z",
    workItemId: "lwi_1",
  });
  const technicalPrompt = buildArticleDerivativePrompt({
    derivativeId: "article_derivative_technical",
    request: normalizeArticleDerivativeRequest({
      kind: "article_rewrite",
      audiencePreset: "technical",
    }),
    sourcePath: "article.md",
    outputPath: "derivatives/technical.md",
    generatedAt: "2026-07-28T00:00:00.000Z",
    workItemId: "lwi_1",
  });
  assert.match(generalPrompt, /everyday impact/);
  assert.match(technicalPrompt, /data flow, failure modes/);
  assert.notEqual(generalPrompt, technicalPrompt);
  const teenRequest = normalizeArticleDerivativeRequest({ audiencePreset: "general", agePreset: "teen" });
  const olderRequest = normalizeArticleDerivativeRequest({ audiencePreset: "general", agePreset: "50_plus" });
  assert.match(teenRequest.ageProfile.adaptation, /do not infantilize/);
  assert.match(olderRequest.ageProfile.adaptation, /never equate age with low ability/);
  assert.notEqual(teenRequest.targetAge, olderRequest.targetAge);
  assert.throws(
    () => normalizeArticleDerivativeRequest({ kind: "social_post" }),
    (error) => error.code === "invalid_article_derivative_request",
  );
  assert.throws(
    () => normalizeArticleDerivativeRequest({ audiencePreset: "custom" }),
    (error) => error.code === "invalid_article_derivative_request",
  );
  assert.throws(
    () => normalizeArticleDerivativeRequest({ agePreset: "custom" }),
    (error) => error.code === "invalid_article_derivative_request",
  );
});

test("ranks related local articles above unrelated content with explainable signals", () => {
  const source = buildArticleSimilarityDocument(`
# 一个输入，多种产出
ListenHub 把文章、PDF 和视频转成播客、故事书和解说视频。
# 为什么下限高
平台把脚本结构和内容生产方法预先封装进工作流，普通用户也能稳定产出。
`, { title: "AI 内容生产工作流", provider: "wechat", author: "作者甲" });
  const related = buildArticleSimilarityDocument(`
# AI 内容复用
把一篇文章转换成播客、短视频和幻灯片，关键是将脚本、配音和剪辑封装成标准流程。
# 使用门槛
内容创作者无需学习复杂提示词，也能获得稳定的多媒体结果。
`, { title: "一篇文章生成多种内容", provider: "wechat", author: "作者乙" });
  const unrelated = buildArticleSimilarityDocument(`
# 准备材料
低筋面粉、黄油和鸡蛋需要提前回温。
# 烘焙
将面团放入烤箱，控制温度并观察表面颜色。
`, { title: "家庭饼干烘焙指南", provider: "wechat", author: "厨师", publishedAt: "2026-07-21" });
  const relatedScore = compareArticleSimilarity(source, related);
  const unrelatedScore = compareArticleSimilarity(source, unrelated);
  assert.ok(relatedScore.score > unrelatedScore.score);
  assert.ok(relatedScore.score >= 0.12);
  assert.ok(unrelatedScore.score < 0.12);
  assert.ok(relatedScore.reasons.includes("body") || relatedScore.reasons.includes("core_ideas"));
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

test("extracts a real WeChat page shape: js_name author, ct epoch date, tolerated mp media", async () => {
  const result = await inspectArticle({
    url: "https://mp.weixin.qq.com/s/realistic",
    resolveHostname: PUBLIC_DNS,
    fetchImpl: async () => htmlResponse(wechatRealisticFixture()),
  });
  assert.equal(result.provider, "wechat");
  // No og:title / meta author on real pages: title comes from the
  // rich_media_title h1 and the author (公众号名) from #js_name.
  assert.equal(result.title, "看不见的砷污染");
  assert.equal(result.author, "引领未来的");
  // var ct = "1722967200" is 2024-08-07T02:00+08:00 — the Shanghai date is
  // Aug 7 while UTC is still Aug 6, so this pins the Asia/Shanghai rendering
  // (a naive UTC parse would yield 2024-08-06).
  assert.equal(result.publishedAt, "2024-08-07");
  // mmbiz lazy images register; the v.qq.com iframe is a skipped tag and the
  // mpvoice file id is not an http URL, so both degrade to nothing instead of
  // crashing or emitting a media token.
  assert.deepEqual(result.mediaCounts, { images: 2, audio: 0, video: 0 });
  assert.match(result.markdownPreview, /第一段正文[\s\S]+MYAGENTTOOL_MEDIA_0[\s\S]+第二段正文/);
});

test("canonicalizes WeChat share variants while keeping the __biz identity form", () => {
  const bare = canonicalizeArticleUrl("https://mp.weixin.qq.com/s/q36Efhy47_23x4aGIDp2NA");
  assert.equal(
    canonicalizeArticleUrl(
      "https://mp.weixin.qq.com/s/q36Efhy47_23x4aGIDp2NA?src=timeline&scene=1&from=timeline&isappinstalled=0&clicktime=1710000000&enterid=1710000000",
    ),
    bare,
  );
  assert.equal(
    canonicalizeArticleUrl(
      "https://mp.weixin.qq.com/s?__biz=MzA1MjIzNDA1NF8w&mid=2651234567&idx=1&sn=abcdef0123&src=singlemsg&scene=126#rd",
    ),
    "https://mp.weixin.qq.com/s?__biz=MzA1MjIzNDA1NF8w&mid=2651234567&idx=1&sn=abcdef0123",
  );
  // src is only share metadata on mp.weixin hosts; elsewhere it may carry
  // meaning and must survive canonicalization.
  assert.equal(
    canonicalizeArticleUrl("https://example.com/gallery?src=timeline"),
    "https://example.com/gallery?src=timeline",
  );
});

test("rejects a WeChat verification challenge instead of importing an empty article", async () => {
  await assert.rejects(
    inspectArticle({
      url: "https://mp.weixin.qq.com/s/challenged",
      resolveHostname: PUBLIC_DNS,
      fetchImpl: async () => htmlResponse(`<!doctype html><html><body>
        <form action="/mp/wappoc_appmsgcaptcha"><input name="poc_token"></form>
        <p>完成验证后即可继续访问</p>
      </body></html>`),
    }),
    (error) => error.code === "article_download_challenge",
  );
});

test("rejects an incomplete WeChat shell without the real article body", async () => {
  await assert.rejects(
    inspectArticle({
      url: "https://mp.weixin.qq.com/s/incomplete",
      resolveHostname: PUBLIC_DNS,
      fetchImpl: async () => htmlResponse("<!doctype html><html><body><p>微信文章加载中</p></body></html>"),
    }),
    (error) => error.code === "article_content_incomplete",
  );
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

test("uses Xiaohongshu hydration description when the page has no visible article body", async () => {
  const result = await inspectArticle({
    url: "https://www.xiaohongshu.com/explore/note-hydrated",
    resolveHostname: PUBLIC_DNS,
    fetchImpl: async () => htmlResponse(`<html><body><script>window.__INITIAL_STATE__ = ${JSON.stringify({
      note: { title: "仅结构化笔记", desc: "这是结构化正文", user: { nickname: "作者" } },
    })};</script></body></html>`),
  });
  assert.equal(result.title, "仅结构化笔记");
  assert.equal(result.textLength, "这是结构化正文".length);
  assert.match(result.markdownPreview, /这是结构化正文/);
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
          <table><caption>数据</caption><thead><tr><th>名称</th></tr></thead><tbody><tr><td>示例</td></tr></tbody></table>
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
  assert.match(html, /<table><caption>数据<\/caption><thead><tr><th>名称<\/th><\/tr><\/thead><tbody><tr><td>示例<\/td><\/tr><\/tbody><\/table>/);
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
  const listed = service.list({ workItemId: "lwi_1" });
  assert.equal(listed.body.latest.id, "article_import_old");
  assert.equal(listed.body.jobs.length, 1);
});

test("finds similar completed imports only within the current project", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "myagenttool-article-similar-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const records = [
    {
      item: { id: "lwi_target", localRef: "LOCAL-1", projectId: "prj_1" },
      jobId: "article_import_target",
      worktreeId: "wtr_target",
      slug: "target",
      markdown: `---
title: "AI 内容生产工作流"
source_provider: wechat
author: "作者甲"
published_at: 2026-07-20
---
# 多种产出
把文章和 PDF 转换成播客、故事书和视频。
# 工作流
平台把脚本结构与内容生产方法预先封装，降低普通用户的使用门槛。`,
    },
    {
      item: { id: "lwi_related", localRef: "LOCAL-2", projectId: "prj_1" },
      jobId: "article_import_related",
      worktreeId: "wtr_related",
      slug: "related",
      markdown: `---
title: "一篇文章生成多种内容"
source_provider: wechat
author: "作者乙"
published_at: 2026-07-22
---
# 内容复用
一篇文章可以生成播客、短视频和幻灯片。
# 标准流程
将脚本、配音和剪辑封装进工作流，让创作者稳定产出。`,
    },
    {
      item: { id: "lwi_foreign", localRef: "LOCAL-9", projectId: "prj_2" },
      jobId: "article_import_foreign",
      worktreeId: "wtr_foreign",
      slug: "foreign",
      markdown: `---
title: "完全相同但属于其他项目"
source_provider: wechat
---
# 工作流
把文章转换成播客、故事书和视频，并封装内容生产方法。`,
    },
  ];
  const state = {
    projects: [{ id: "prj_1", path: root }],
    workItems: records.map((record) => record.item),
    worktrees: [],
    articleImportJobs: [],
  };
  for (const record of records) {
    const worktreePath = join(root, record.worktreeId);
    const relativeDirectory = `docs/imported/wechat/2026/07/${record.slug}`;
    await mkdir(join(worktreePath, relativeDirectory), { recursive: true });
    await writeFile(join(worktreePath, relativeDirectory, "article.md"), record.markdown);
    record.item.outputAssets = [{
      id: `asset_${record.slug}`,
      path: `${relativeDirectory}/article.md`,
      family: "markdown",
      worktreeId: record.worktreeId,
    }];
    state.worktrees.push({
      id: record.worktreeId,
      sourceProjectId: record.item.projectId,
      path: worktreePath,
    });
    state.articleImportJobs.push({
      id: record.jobId,
      workItemId: record.item.id,
      worktreeId: record.worktreeId,
      canonicalUrl: `https://example.com/${record.slug}`,
      state: "completed",
      progress: { stage: "completed", completed: 1, total: 1 },
      createdAt: "2026-07-28T00:00:00.000Z",
      completedAt: "2026-07-28T00:01:00.000Z",
      error: null,
      result: {
        relativeDirectory,
        markdownPath: `${relativeDirectory}/article.md`,
      },
    });
  }
  let currentTime = "2026-07-28T00:02:00.000Z";
  const createService = () => createArticleImportService({
    state,
    now: () => currentTime,
    workItemService: {
      getWorkItem: ({ workItemId }) => {
        const item = state.workItems.find((candidate) => candidate.id === workItemId);
        return item
          ? { ok: true, status: 200, body: { workItem: item } }
          : { ok: false, status: 404, body: { error: "work_item_not_found" } };
      },
    },
  });
  const request = {
    workItemId: "lwi_target",
    jobId: "article_import_target",
  };
  const service = createService();
  const result = await service.findSimilar({
    ...request,
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.indexedCount, 1);
  assert.equal(result.body.matches.length, 1);
  assert.equal(result.body.matches[0].workItemId, "lwi_related");
  assert.equal(result.body.matches[0].worktreeId, "wtr_related");
  assert.ok(result.body.matches[0].score >= 0.12);
  assert.equal(result.body.reindexedCount, 2);
  assert.equal(result.body.reusedCount, 0);

  const indexPath = join(root, ".myagenttool", "indexes", "article-similarity-v1.json");
  const initialIndex = JSON.parse(await readFile(indexPath, "utf8"));
  assert.equal(initialIndex.schemaVersion, 1);
  assert.equal(initialIndex.entries.length, 2);
  assert.ok(initialIndex.entries.every((entry) => /^sha256:[a-f0-9]{64}$/.test(entry.fingerprint)));
  assert.ok(initialIndex.entries.every((entry) => entry.analyzedAt === currentTime));

  currentTime = "2026-07-28T00:03:00.000Z";
  const reused = await createService().findSimilar(request);
  assert.equal(reused.status, 200);
  assert.equal(reused.body.reindexedCount, 0);
  assert.equal(reused.body.reusedCount, 2);
  assert.deepEqual(
    JSON.parse(await readFile(indexPath, "utf8")).entries.map((entry) => entry.analyzedAt).sort(),
    initialIndex.entries.map((entry) => entry.analyzedAt).sort(),
  );

  const related = records.find((record) => record.worktreeId === "wtr_related");
  const relatedPath = join(
    root,
    related.worktreeId,
    `docs/imported/wechat/2026/07/${related.slug}/article.md`,
  );
  await writeFile(relatedPath, `${related.markdown}\n\n# 新增案例\n只重建这篇文章的特征。\n`);
  currentTime = "2026-07-28T00:04:00.000Z";
  const changed = await createService().findSimilar(request);
  assert.equal(changed.status, 200);
  assert.equal(changed.body.reindexedCount, 1);
  assert.equal(changed.body.reusedCount, 1);
  const changedIndex = JSON.parse(await readFile(indexPath, "utf8"));
  assert.equal(
    changedIndex.entries.find((entry) => entry.worktreeId === "wtr_related").analyzedAt,
    currentTime,
  );
  assert.equal(
    changedIndex.entries.find((entry) => entry.worktreeId === "wtr_target").analyzedAt,
    "2026-07-28T00:02:00.000Z",
  );

  await rm(relatedPath);
  const deleted = await createService().findSimilar(request);
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.indexedCount, 0);
  assert.equal(deleted.body.skippedCount, 1);
  assert.equal(deleted.body.removedCount, 1);
  const prunedIndex = JSON.parse(await readFile(indexPath, "utf8"));
  assert.deepEqual(prunedIndex.entries.map((entry) => entry.worktreeId), ["wtr_target"]);

  await writeFile(indexPath, "{ damaged index");
  currentTime = "2026-07-28T00:05:00.000Z";
  const rebuilt = await createService().findSimilar(request);
  assert.equal(rebuilt.status, 200);
  assert.equal(rebuilt.body.indexRebuilt, true);
  assert.equal(rebuilt.body.reindexedCount, 1);
  const recoveredIndex = JSON.parse(await readFile(indexPath, "utf8"));
  assert.equal(recoveredIndex.schemaVersion, 1);
  assert.deepEqual(recoveredIndex.entries.map((entry) => entry.worktreeId), ["wtr_target"]);
});

test("creates a governed derivative invocation and attaches only its validated Markdown output", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "myagenttool-article-derivative-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const relativeDirectory = "docs/imported/wechat/2026/07/source";
  await mkdir(join(root, relativeDirectory), { recursive: true });
  await writeFile(join(root, relativeDirectory, "article.md"), "# 原文\n\n平台把内容生产方法打包进流程。\n");
  await writeFile(join(root, relativeDirectory, "analysis.md"), "# 核心思想\n\n降低普通用户门槛。\n");
  const item = {
    id: "lwi_1",
    localNumber: 1,
    localRef: "LOCAL-1",
    projectId: "prj_1",
    ownerTeamId: "team_1",
    terminalId: "dev_1",
    revision: 1,
    outputAssets: [],
  };
  const state = {
    projects: [{ id: "prj_1", defaultAgentId: "agt_codex_cli" }],
    agents: [{
      id: "agt_codex_cli",
      status: "available",
      health: { status: "healthy" },
      location: { type: "local_device", deviceId: "dev_1" },
      adapter: { type: "cli", command: "codex", timeoutSeconds: 600 },
    }],
    devices: [{ id: "dev_1", unlinkState: "linked" }],
    workItems: [item],
    worktrees: [{ id: "wtr_1", sourceProjectId: "prj_1", path: root }],
    invocations: [],
    articleImportJobs: [{
      id: "article_import_1",
      workItemId: "lwi_1",
      worktreeId: "wtr_1",
      canonicalUrl: "https://mp.weixin.qq.com/s/example",
      state: "completed",
      progress: { stage: "completed", completed: 1, total: 1 },
      createdAt: "2026-07-28T00:00:00.000Z",
      completedAt: "2026-07-28T00:01:00.000Z",
      error: null,
      result: {
        markdownPath: `${relativeDirectory}/article.md`,
        analysisPath: `${relativeDirectory}/analysis.md`,
      },
    }],
  };
  const bindings = [];
  const comments = [];
  let capturedPrompt = "";
  let capturedOptions;
  const workItemService = {
    getWorkItem: ({ workItemId }) => workItemId === item.id
      ? { ok: true, status: 200, body: { workItem: item } }
      : { ok: false, status: 404, body: { error: "work_item_not_found" } },
    recordExecutionBinding: (binding) => {
      bindings.push(binding);
      item.revision += 1;
      return { ok: true, status: 200, body: { binding } };
    },
    updateWorkItem: ({ expectedRevision, outputAssets }) => {
      assert.equal(expectedRevision, item.revision);
      item.outputAssets = outputAssets;
      item.revision += 1;
      return { ok: true, status: 200, body: { workItem: item } };
    },
    createComment: (input) => {
      comments.push(input);
      return { ok: true, status: 201, body: {} };
    },
  };
  const service = createArticleImportService({
    state,
    now: () => "2026-07-28T00:05:00.000Z",
    nextId: () => "article_derivative_1",
    workItemService,
    createInvocation: (prompt, agent, options) => {
      capturedPrompt = prompt;
      capturedOptions = options;
      const invocation = {
        id: "inv_1",
        idempotencyKey: options.idempotencyKey,
        requestedBy: "usr_1",
        agentId: agent.id,
        worktreeId: options.metadata.worktreeId,
        status: "queued",
        createdAt: "2026-07-28T00:05:00.000Z",
        options,
      };
      state.invocations.push(invocation);
      return invocation;
    },
    startInvocationIfAllowed: () => {},
  });
  const derivativeRequest = {
    workItemId: "lwi_1",
    jobId: "article_import_1",
    kind: "article_rewrite",
    tone: "insightful",
    length: "medium",
    angle: "真正的竞争是平台替用户做了多少决策",
    audience: "普通读者",
    idempotencyKey: "idem-article-derivative-1",
  };
  const actor = { userId: "usr_1", teamId: "team_1" };
  const created = await service.createDerivative(derivativeRequest, actor);
  assert.equal(created.status, 202);
  assert.equal(created.body.derivative.state, "queued");
  assert.equal(created.body.derivative.outputPath, `${relativeDirectory}/derivatives/article-rewrite-001.md`);
  assert.equal(bindings[0].kind, "article_derivative");
  assert.equal(capturedOptions.metadata.projectId, "prj_1");
  assert.match(capturedPrompt, /modify any file except the exact output path/);
  assert.match(capturedPrompt, /article-rewrite-001\.md/);

  const replayed = await service.createDerivative(derivativeRequest, actor);
  assert.equal(replayed.status, 200);
  assert.equal(replayed.body.derivative.id, created.body.derivative.id);
  assert.equal(state.invocations.length, 1);
  assert.equal(bindings.length, 1);
  const conflict = await service.createDerivative({
    ...derivativeRequest,
    agePreset: "teen",
  }, actor);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, "article_derivative_idempotency_conflict");

  await writeFile(join(root, created.body.derivative.outputPath), [
    "---",
    'derivative_id: "article_derivative_1"',
    "derivative_type: article_rewrite",
    "audience_preset: custom",
    'target_audience: "普通读者"',
    "age_preset: all",
    'target_age: "错误年龄"',
    `source_article: "${relativeDirectory}/article.md"`,
    'local_issue_id: "lwi_1"',
    "---",
    "",
    "# 新文章",
    "",
    "完整正文。",
    "",
  ].join("\n"));
  state.invocations[0].status = "succeeded";
  state.invocations[0].completedAt = "2026-07-28T00:06:00.000Z";
  const invalid = await service.getDerivative({
    workItemId: "lwi_1",
    jobId: "article_import_1",
    derivativeId: "article_derivative_1",
  }, actor);
  assert.equal(invalid.body.derivative.state, "failed");
  assert.equal(invalid.body.derivative.error, "article_derivative_output_invalid");
  assert.equal(item.outputAssets.length, 0);
  assert.equal(comments.length, 0);

  await writeFile(join(root, created.body.derivative.outputPath), [
    "---",
    'derivative_id: "article_derivative_1"',
    "derivative_type: article_rewrite",
    "audience_preset: custom",
    'target_audience: "普通读者"',
    "age_preset: all",
    'target_age: "不限年龄"',
    `source_article: "${relativeDirectory}/article.md"`,
    'local_issue_id: "lwi_1"',
    "---",
    "",
    "# 新文章",
    "",
    "完整正文。",
    "",
  ].join("\n"));
  const [completed, concurrent] = await Promise.all([
    service.getDerivative({
      workItemId: "lwi_1",
      jobId: "article_import_1",
      derivativeId: "article_derivative_1",
    }, actor),
    service.getDerivative({
      workItemId: "lwi_1",
      jobId: "article_import_1",
      derivativeId: "article_derivative_1",
    }, actor),
  ]);
  assert.equal(completed.body.derivative.state, "completed");
  assert.equal(concurrent.body.derivative.state, "completed");
  assert.equal(item.outputAssets.length, 1);
  assert.equal(item.outputAssets[0].path, created.body.derivative.outputPath);
  assert.equal(item.outputAssets[0].family, "markdown");
  assert.equal(comments.length, 1);
});

test("routes a scoped similar-article request to the local search service", async () => {
  const actor = { userId: "usr_1", teamId: "team_1" };
  let sent;
  let received;
  const handled = await handleWorkItemRoutes({
    req: { method: "GET" },
    res: {},
    url: new URL("http://localhost/api/work-items/lwi%201/article-imports/job%201/similar"),
    sendJson: (_res, status, body) => { sent = { status, body }; },
    actor,
    findSimilarArticleImports: (input, requestActor) => {
      received = { input, requestActor };
      return { status: 200, body: { method: "local-lexical-v1", matches: [] } };
    },
  });
  assert.equal(handled, true);
  assert.deepEqual(received, {
    input: { workItemId: "lwi 1", jobId: "job 1" },
    requestActor: actor,
  });
  assert.deepEqual(sent, {
    status: 200,
    body: { method: "local-lexical-v1", matches: [] },
  });
});

test("routes a scoped derivative request with decoded ids and creation preferences", async () => {
  const actor = { userId: "usr_1", teamId: "team_1" };
  let sent;
  let received;
  const handled = await handleWorkItemRoutes({
    req: { method: "POST" },
    res: {},
    url: new URL("http://localhost/api/work-items/lwi%201/article-imports/job%201/derivatives"),
    readJson: async () => ({
      kind: "video_script",
      tone: "conversational",
      length: "short",
      audience: "内容创作者",
    }),
    sendJson: (_res, status, body) => { sent = { status, body }; },
    actor,
    createArticleDerivative: (input, requestActor) => {
      received = { input, requestActor };
      return { status: 202, body: { derivative: { id: "article_derivative_1" } } };
    },
  });
  assert.equal(handled, true);
  assert.deepEqual(received, {
    input: {
      workItemId: "lwi 1",
      jobId: "job 1",
      kind: "video_script",
      tone: "conversational",
      length: "short",
      audience: "内容创作者",
    },
    requestActor: actor,
  });
  assert.deepEqual(sent, {
    status: 202,
    body: { derivative: { id: "article_derivative_1" } },
  });
});

test("rejects new work before the durable article-import queue grows without bound", () => {
  const items = [
    { id: "lwi_1", localNumber: 1, projectId: "prj_1" },
    { id: "lwi_2", localNumber: 2, projectId: "prj_1" },
  ];
  const state = {
    workItems: items,
    worktrees: items.map((item, index) => ({
      id: `wtr_${index + 1}`,
      sourceProjectId: "prj_1",
      path: `/tmp/article-import-${index + 1}`,
      link: { type: "local_issue", number: item.localNumber },
    })),
  };
  const service = createArticleImportService({
    state,
    maxConcurrent: 1,
    maxPending: 1,
    nextId: (prefix) => `${prefix}_${state.articleImportJobs?.length ?? 0}`,
    workItemService: {
      getWorkItem: ({ workItemId }) => {
        const item = items.find((candidate) => candidate.id === workItemId);
        return item
          ? { ok: true, status: 200, body: { workItem: item } }
          : { ok: false, status: 404, body: { error: "work_item_not_found" } };
      },
      recordExecutionBinding: () => ({ ok: true, status: 200, body: {} }),
    },
    fetchImpl: async () => htmlResponse("<article>queued</article>"),
  });
  const first = service.start({ workItemId: "lwi_1", worktreeId: "wtr_1", url: "https://example.com/one" });
  const second = service.start({ workItemId: "lwi_2", worktreeId: "wtr_2", url: "https://example.com/two" });
  assert.equal(first.status, 202);
  assert.equal(second.status, 429);
  assert.equal(second.body.error, "article_import_queue_full");
  assert.equal(state.articleImportJobs.length, 1);
});

test("preserves the source calendar date instead of shifting it to UTC", async () => {
  const offsetResult = await inspectArticle({
    url: "https://mp.weixin.qq.com/s/offset",
    resolveHostname: PUBLIC_DNS,
    fetchImpl: async () => htmlResponse(`
      <meta property="article:published_time" content="2026-07-27T00:30:00+08:00">
      <div id="js_content">offset</div>
    `),
  });
  assert.equal(offsetResult.publishedAt, "2026-07-27");

  const epoch = Math.floor(Date.parse("2026-07-27T00:30:00+08:00") / 1000);
  const epochResult = await inspectArticle({
    url: "https://mp.weixin.qq.com/s/epoch",
    resolveHostname: PUBLIC_DNS,
    fetchImpl: async () => htmlResponse(`<div id="js_content">epoch</div><script>var publish_time = "${epoch}";</script>`),
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
    revision: 1, status: "backlog", waitingOn: "none", labels: [], outputAssets: [],
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
  assert.equal(updates[0].status, "review");
  assert.equal(updates[0].waitingOn, "me");
  assert.equal(updates[0].outputAssets.length, 3);
  assert.match(updates[0].outputAssets[0].path, /article\.md$/);
  assert.match(updates[0].outputAssets[1].path, /article\.html$/);
  assert.equal(comments.length, 1);
  assert.match(comments[0].body, /1 media item\(s\) could not be downloaded/);
  const analyzed = await service.analyze({ workItemId: "lwi_1", jobId: job.id });
  assert.equal(analyzed.status, 200);
  assert.equal(analyzed.body.analysis.method, "local-extractive-v1");
  assert.match(analyzed.body.analysisPath, /analysis\.md$/);
  assert.equal(updates.length, 2);
  assert.equal(updates[1].outputAssets.length, 4);
  const analysisMarkdown = await readFile(join(worktreePath, analyzed.body.analysisPath), "utf8");
  assert.match(analysisMarkdown, /# 核心思想/);
  assert.match(analysisMarkdown, /# 框架体系/);
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

// Shape captured from a real mp.weixin.qq.com article page (2026-08 live
// verification, issue #1696): no og:title / meta author / meta published_time —
// title lives in the rich_media_title h1, the 公众号名 in #js_name, the date in
// `var ct = "<epoch>"`, images are data-src lazy mmbiz assets, and embedded
// media arrive as a v.qq.com iframe inside js_mp_video_container plus mpvoice
// elements whose file ids are not http URLs.
function wechatRealisticFixture() {
  return `<!doctype html>
  <html lang="zh_CN">
    <head>
      <meta charset="utf-8">
      <title>看不见的砷污染</title>
      <script>var ct = "1722967200";</script>
    </head>
    <body>
      <div class="rich_media_area_primary">
        <h1 class="rich_media_title" id="activity-name">
          看不见的砷污染
        </h1>
        <div class="rich_media_meta_list">
          <a id="js_name" href="javascript:void(0);">引领未来的</a>
        </div>
        <div class="rich_media_content" id="js_content">
          <p>第一段正文。</p>
          <img data-src="https://mmbiz.qpic.cn/mmbiz_jpg/realistic-1.jpeg" alt="图一">
          <span class="js_mp_video_container">
            <iframe class="video_iframe" data-src="https://v.qq.com/iframe/player.html?vid=realistic"></iframe>
          </span>
          <mpvoice voice_encode_fileid="MzA1MjIzNDA1NF81MDA0" name="语音介绍"></mpvoice>
          <p>第二段正文。</p>
          <img data-src="https://mmbiz.qpic.cn/mmbiz_png/realistic-2.png" alt="图二">
        </div>
      </div>
    </body>
  </html>`;
}
