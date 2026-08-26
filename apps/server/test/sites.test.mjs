import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { createSiteService } from "../src/services/sites.mjs";
import { SiteDeploymentAdapterError } from "../src/services/site-deployment-adapters.mjs";

const ACTOR_A = { userId: "usr_a", teamId: "team_a", role: "owner" };
const ACTOR_B = { userId: "usr_b", teamId: "team_b", role: "owner" };

function harness({ publishRoot = null, assetRoot = null, resolveCredential, deploymentAdapters, domainTlsAdapter, tlsCertificateAdapter, sshHostConnector } = {}) {
  let id = 0;
  let clock = Date.parse("2026-08-24T00:00:00.000Z");
  const state = {
    sites: [], siteEntries: [], siteEntryRevisions: [], sitePublicationPlans: [],
    sitePublications: [], siteDeploymentTargets: [], siteDomainTlsBindings: [], siteAssets: [], sshTargets: [], hostFileScopes: [], hostTlsActivationProfiles: [],
  };
  const service = createSiteService({
    state,
    now: () => new Date(clock).toISOString(),
    nextId: (prefix) => `${prefix}_${String(++id).padStart(4, "0")}`,
    publishRoot,
    assetRoot,
    ...(resolveCredential ? { resolveCredential } : {}),
    ...(deploymentAdapters ? { deploymentAdapters } : {}),
    ...(domainTlsAdapter ? { domainTlsAdapter } : {}),
    ...(tlsCertificateAdapter ? { tlsCertificateAdapter } : {}),
    ...(sshHostConnector ? { sshHostConnector } : {}),
  });
  return { state, service, tick: () => { clock += 1000; } };
}

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03]);

function responsivePng(width = 1600, height = 900) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#155eef";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  context.fillRect(Math.round(width * 0.7), 0, Math.round(width * 0.3), height);
  return canvas.toBuffer("image/png");
}

function createDefaultSite(service, actor = ACTOR_A) {
  return service.createSite({
    name: "示例官网",
    description: "让复杂工作变得简单",
    audience: "小团队",
    primaryAction: "预约沟通",
    contactEmail: "hello@example.com",
  }, actor).body.site;
}

test("sites are team scoped and setup creates ordinary starter pages", () => {
  const { service } = harness();
  const created = service.createSite({ name: "示例官网", contactEmail: "hello@example.com" }, ACTOR_A);
  assert.equal(created.status, 201);
  assert.equal(created.body.site.entries.length, 5);
  assert.deepEqual(created.body.site.entries.map((entry) => entry.slug), ["home", "about", "services", "articles", "contact"]);
  assert.equal(created.body.site.deploymentTarget.kind, "local_directory");
  assert.equal(service.listSites(ACTOR_B).body.count, 0);
  assert.equal(service.getSite({ siteId: created.body.site.id }, ACTOR_B).status, 404);
  assert.equal(service.createSite({ name: "第二个站点" }, ACTOR_A).status, 409);
});

test("entry edits are revision gated and keep immutable content revisions", () => {
  const { service, state } = harness();
  const site = createDefaultSite(service);
  const home = site.entries.find((entry) => entry.slug === "home");
  const detail = service.getEntry({ siteId: site.id, entryId: home.id }, ACTOR_A).body.entry;
  assert.equal(service.updateEntry({
    siteId: site.id, entryId: home.id, expectedRevision: 99, title: "错误覆盖",
  }, ACTOR_A).status, 409);
  const updated = service.updateEntry({
    siteId: site.id,
    entryId: home.id,
    expectedRevision: detail.revision,
    title: "新的首页",
    blocks: [{ id: "hero", type: "hero", data: { title: "新的首页", subtitle: "已经自动保存" } }],
  }, ACTOR_A);
  assert.equal(updated.status, 200);
  assert.equal(updated.body.entry.revision, detail.revision + 1);
  assert.notEqual(updated.body.entry.draftRevisionId, detail.draftRevisionId);
  assert.equal(state.siteEntryRevisions.filter((revision) => revision.entryId === home.id).length, 2);
  assert.equal(updated.body.entry.hasUnpublishedChanges, true);
});

test("title and summary edits remain unpublished until a new release is confirmed", async () => {
  const { service, state } = harness();
  const created = createDefaultSite(service);
  const firstPlan = service.createPublicationPlan({ siteId: created.id }, ACTOR_A).body.plan;
  const firstPublish = await service.confirmPublicationPlan({ siteId: created.id, planId: firstPlan.id, confirmed: true }, ACTOR_A);
  assert.equal(firstPublish.status, 200);

  const publishedSite = firstPublish.body.site;
  const home = service.getEntry({ siteId: created.id, entryId: publishedSite.entries[0].id }, ACTOR_A).body.entry;
  const updated = service.updateEntry({
    siteId: created.id,
    entryId: home.id,
    expectedRevision: home.revision,
    title: "新的官网标题",
    summary: "新的页面摘要",
  }, ACTOR_A);

  assert.equal(updated.status, 200);
  assert.equal(updated.body.entry.hasUnpublishedChanges, true);
  assert.equal(updated.body.site.unpublishedCount, 1);
  assert.notEqual(updated.body.entry.draftRevisionId, updated.body.entry.publishedRevisionId);
  assert.deepEqual(state.siteEntryRevisions.at(-1).metadata, {
    title: "新的官网标题", summary: "新的页面摘要", slug: "home", status: "published",
  });

  const secondPlan = service.createPublicationPlan({ siteId: created.id }, ACTOR_A).body.plan;
  assert.deepEqual(secondPlan.changes.changed, [home.id]);
  const secondPublish = await service.confirmPublicationPlan({ siteId: created.id, planId: secondPlan.id, confirmed: true }, ACTOR_A);
  assert.equal(secondPublish.status, 200);
  assert.equal(secondPublish.body.site.unpublishedCount, 0);
});

test("site style edits can be published after the first release", async () => {
  const { service } = harness();
  const created = createDefaultSite(service);
  const firstPlan = service.createPublicationPlan({ siteId: created.id }, ACTOR_A).body.plan;
  const firstPublish = await service.confirmPublicationPlan({ siteId: created.id, planId: firstPlan.id, confirmed: true }, ACTOR_A);
  const publishedSite = firstPublish.body.site;

  const updated = service.updateSite({
    siteId: created.id,
    expectedRevision: publishedSite.revision,
    settings: { ...publishedSite.settings, brandColor: "#7a4f9a", footerText: "新的页脚" },
  }, ACTOR_A);
  assert.equal(updated.status, 200);
  assert.equal(updated.body.site.unpublishedCount, 1);

  const stylePlan = service.createPublicationPlan({ siteId: created.id }, ACTOR_A).body.plan;
  assert.equal(stylePlan.changes.siteChanged, true);
  assert.deepEqual(stylePlan.changes.changed, []);
  const secondPublish = await service.confirmPublicationPlan({ siteId: created.id, planId: stylePlan.id, confirmed: true }, ACTOR_A);
  assert.equal(secondPublish.status, 200);
  assert.equal(secondPublish.body.site.unpublishedCount, 0);
});

test("preview escapes untrusted content and refuses executable links", () => {
  const { service } = harness();
  const site = createDefaultSite(service);
  const home = service.getEntry({ siteId: site.id, entryId: site.entries[0].id }, ACTOR_A).body.entry;
  service.updateEntry({
    siteId: site.id,
    entryId: home.id,
    expectedRevision: home.revision,
    blocks: [{
      id: "hero",
      type: "hero",
      data: { title: "<script>alert(1)</script>", primaryLabel: "打开", primaryUrl: "javascript:alert(1)" },
    }],
  }, ACTOR_A);
  const preview = service.previewSite({ siteId: site.id }, ACTOR_A);
  assert.equal(preview.status, 200);
  assert.match(preview.body.preview.styles, /\.hero/);
  assert.match(preview.body.preview.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(preview.body.preview.html, /<script>/);
  assert.doesNotMatch(preview.body.preview.html, /javascript:/);
  assert.match(preview.body.preview.html, /href="\/contact\/"/);
});

test("article list blocks link to created articles so visitors can discover them", () => {
  const { service } = harness();
  const site = createDefaultSite(service);
  const article = service.createEntry({
    siteId: site.id,
    type: "article",
    slug: "first-update",
    title: "第一篇动态",
    summary: "介绍最近完成的工作",
    blocks: [{ id: "body", type: "rich_text", data: { title: "第一篇动态", paragraphs: ["正文"] } }],
  }, ACTOR_A);
  assert.equal(article.status, 201);

  const home = service.previewSite({ siteId: site.id, path: "index.html" }, ACTOR_A).body.preview.html;
  const articles = service.previewSite({ siteId: site.id, path: "articles/index.html" }, ACTOR_A).body.preview.html;
  assert.match(home, /href="\/first-update\/">第一篇动态<\/a>/);
  assert.match(articles, /介绍最近完成的工作/);
  assert.equal(service.previewSite({ siteId: site.id, path: "first-update/index.html" }, ACTOR_A).status, 200);
});

test("case creation adds one discoverable home showcase and publishes the guided story", async () => {
  const { service } = harness();
  const site = createDefaultSite(service);
  const baselinePlan = service.createPublicationPlan({ siteId: site.id }, ACTOR_A).body.plan;
  const baseline = await service.confirmPublicationPlan({ siteId: site.id, planId: baselinePlan.id, confirmed: true }, ACTOR_A);
  assert.equal(baseline.status, 200);
  const homeBefore = baseline.body.site.entries.find((entry) => entry.slug === "home");

  const created = service.createEntry({
    siteId: site.id,
    type: "case",
    slug: "case-mountain-studio",
    title: "山岚品牌咨询转化提升",
    summary: "重新组织官网信息后，访客更容易完成咨询。",
    blocks: [
      { id: "case-hero", type: "hero", data: { eyebrow: "山岚工作室", title: "山岚品牌咨询转化提升", subtitle: "重新组织官网信息后，访客更容易完成咨询。" } },
      { id: "case-background", type: "rich_text", data: { title: "背景与目标", paragraphs: ["原有网站无法清楚说明服务价值。"] } },
      { id: "case-outcome", type: "rich_text", data: { title: "成果", paragraphs: ["咨询路径更清晰。"] } },
    ],
  }, ACTOR_A);
  assert.equal(created.status, 201);
  assert.equal(created.body.entry.type, "case");
  assert.equal(created.body.caseShowcaseAdded, true);
  assert.equal(created.body.site.unpublishedCount, 2, "the new case and its home showcase are both explicit draft changes");

  const home = service.getEntry({ siteId: site.id, entryId: homeBefore.id }, ACTOR_A).body.entry;
  assert.equal(home.revision, homeBefore.revision + 1);
  assert.equal(home.blocks.filter((block) => block.type === "case_cards" && block.data.source === "cases").length, 1);
  const homePreview = service.previewSite({ siteId: site.id }, ACTOR_A).body.preview.html;
  assert.match(homePreview, /href="\/case-mountain-studio\/"/);
  assert.match(homePreview, /山岚品牌咨询转化提升/);
  const casePreview = service.previewSite({ siteId: site.id, path: "case-mountain-studio/index.html" }, ACTOR_A).body.preview.html;
  assert.match(casePreview, /背景与目标/);
  assert.match(casePreview, /咨询路径更清晰/);

  const second = service.createEntry({
    siteId: site.id, type: "case", slug: "case-second", title: "第二个案例", summary: "第二项成果",
    blocks: [{ id: "second", type: "rich_text", data: { title: "成果", paragraphs: ["完成。"] } }],
  }, ACTOR_A);
  assert.equal(second.body.caseShowcaseAdded, false);
  const homeAfterSecond = service.getEntry({ siteId: site.id, entryId: home.id }, ACTOR_A).body.entry;
  assert.equal(homeAfterSecond.blocks.filter((block) => block.type === "case_cards" && block.data.source === "cases").length, 1);
  assert.match(service.previewSite({ siteId: site.id }, ACTOR_A).body.preview.html, /href="\/case-second\/"/);

  const plan = service.createPublicationPlan({ siteId: site.id }, ACTOR_A).body.plan;
  assert.deepEqual(plan.changes.added, [created.body.entry.id, second.body.entry.id]);
  assert.deepEqual(plan.changes.changed, [home.id]);
});

test("bilingual drafts use isolated URLs, navigation, lists, and alternate links", () => {
  const { service } = harness();
  const site = createDefaultSite(service);
  const enabled = service.updateSite({
    siteId: site.id,
    expectedRevision: site.revision,
    settings: { ...site.settings, supportedLocales: ["zh-CN", "en-US"] },
  }, ACTOR_A);
  assert.equal(enabled.status, 200);
  const home = enabled.body.site.entries.find((entry) => entry.slug === "home");
  const translatedHome = service.createEntry({
    siteId: site.id, type: "page", locale: "en-US", translationOf: home.id, slug: "home",
    title: "Home", summary: "A clear English introduction",
    blocks: [
      { id: "hero-en", type: "hero", data: { title: "Clear product stories", subtitle: "For global teams", primaryLabel: "Contact us", primaryUrl: "/contact/" } },
      { id: "services-en", type: "service_cards", data: { items: [] } },
      { id: "articles-en", type: "article_list", data: { title: "Latest articles" } },
      { id: "cta-en", type: "cta", data: { title: "Start a project", label: "Contact us", url: "/contact/" } },
    ],
  }, ACTOR_A);
  assert.equal(translatedHome.status, 201);
  assert.equal(translatedHome.body.entry.translationOf, home.id);
  assert.equal(translatedHome.body.entry.locale, "en-US");

  service.createEntry({
    siteId: site.id, type: "article", locale: "zh-CN", slug: "chinese-news", title: "中文动态", summary: "中文摘要",
    blocks: [{ id: "zh-body", type: "rich_text", data: { title: "中文动态", paragraphs: ["只在中文列表出现。"] } }],
  }, ACTOR_A);
  service.createEntry({
    siteId: site.id, type: "article", locale: "en-US", slug: "english-news", title: "English update", summary: "English summary",
    blocks: [{ id: "en-body", type: "rich_text", data: { title: "English update", paragraphs: ["Only in the English list."] } }],
  }, ACTOR_A);

  const english = service.previewSite({ siteId: site.id, path: "en/index.html" }, ACTOR_A);
  assert.equal(english.status, 200);
  assert.match(english.body.preview.html, /<html lang="en-US">/);
  assert.match(english.body.preview.html, /href="\/en\/english-news\/"/);
  assert.doesNotMatch(english.body.preview.html, /中文动态/);
  assert.match(english.body.preview.html, /hreflang="zh-CN" href="\/"/);
  assert.match(english.body.preview.html, /hreflang="x-default" href="\/"/);
  assert.match(english.body.preview.html, /aria-current="page">English/);
  assert.match(english.body.preview.html, /<h2>Services<\/h2>/);
  assert.doesNotMatch(english.body.preview.html, /<h2>服务<\/h2>/);
  assert.doesNotMatch(english.body.preview.html, />关于<\/a>/, "missing translations are not linked into English navigation");
  assert.doesNotMatch(english.body.preview.html, /href="\/contact\/"/, "internal calls to action do not leak into the default language");

  const chinese = service.previewSite({ siteId: site.id }, ACTOR_A).body.preview.html;
  assert.match(chinese, /href="\/chinese-news\/"/);
  assert.doesNotMatch(chinese, /English update/);
  const sitemap = service.previewSite({ siteId: site.id, path: "sitemap.xml" }, ACTOR_A).body.preview.html;
  assert.match(sitemap, /<loc>\/en\/<\/loc>/);
  assert.match(sitemap, /<loc>\/en\/english-news\/<\/loc>/);

  const duplicate = service.createEntry({
    siteId: site.id, type: "page", locale: "en-US", translationOf: home.id, slug: "home", title: "Duplicate", summary: "Duplicate", blocks: [],
  }, ACTOR_A);
  assert.equal(duplicate.status, 409);
  const unsupported = service.createEntry({ siteId: site.id, type: "article", locale: "fr-FR", slug: "fr", title: "French", blocks: [] }, ACTOR_A);
  assert.equal(unsupported.status, 400);
  const latest = service.getSite({ siteId: site.id }, ACTOR_A).body.site;
  const disabled = service.updateSite({ siteId: site.id, expectedRevision: latest.revision, settings: { ...latest.settings, supportedLocales: ["zh-CN"] } }, ACTOR_A);
  assert.equal(disabled.status, 409);
  assert.equal(disabled.body.error, "site_locale_in_use");
});

test("site style is validated and rendered into the static theme", () => {
  const { service } = harness();
  const site = createDefaultSite(service);
  const updated = service.updateSite({ siteId: site.id, expectedRevision: site.revision, settings: {
    ...site.settings, theme: "warm", brandColor: "#a15c32", footerText: "温暖而清晰",
  } }, ACTOR_A);
  assert.equal(updated.status, 200);
  const css = service.previewSite({ siteId: site.id, path: "assets/site.css" }, ACTOR_A).body.preview.html;
  assert.match(css, /--brand:#a15c32/);
  assert.match(css, /--surface:#fffdf8/);
  const invalid = service.updateSite({ siteId: site.id, expectedRevision: updated.body.site.revision, settings: {
    ...updated.body.site.settings, brandColor: "red;body{display:none}",
  } }, ACTOR_A);
  assert.equal(invalid.status, 400);
});

test("managed images are signature checked, referenced in preview, and locked by publications", async () => {
  const root = mkdtempSync(join(tmpdir(), "myagenttool-site-assets-"));
  const publishRoot = join(root, "releases");
  const assetRoot = join(root, "assets");
  const { service } = harness({ publishRoot, assetRoot });
  try {
    const site = createDefaultSite(service);
    const uploaded = await service.uploadAsset({ siteId: site.id, name: "hero.png", clientFileId: "browser-file-1", contentType: "image/png" }, Readable.from([PNG_BYTES]), ACTOR_A);
    assert.equal(uploaded.status, 201);
    const asset = uploaded.body.asset;
    assert.equal(asset.mimeType, "image/png");
    assert.equal(asset.derivativeStatus, "unavailable", "an undecodable legacy image falls back to its original bytes");
    assert.deepEqual(asset.derivatives, []);
    assert.equal(asset.sha256, undefined, "ordinary asset view hides integrity internals");
    assert.equal((await service.uploadAsset({ siteId: site.id, name: "same.png" }, Readable.from([PNG_BYTES]), ACTOR_A)).body.deduplicated, true);
    const rejected = await service.uploadAsset({ siteId: site.id, name: "unsafe.svg", contentType: "image/svg+xml" }, Readable.from([Buffer.from("<svg><script/></svg>")]), ACTOR_A);
    assert.equal(rejected.status, 415);

    const home = service.getEntry({ siteId: site.id, entryId: site.entries[0].id }, ACTOR_A).body.entry;
    const edited = service.updateEntry({
      siteId: site.id, entryId: home.id, expectedRevision: home.revision,
      blocks: [{ id: "hero", type: "hero", data: { title: "带图片的首页", assetId: asset.id } }],
    }, ACTOR_A);
    assert.equal(edited.status, 200);
    assert.equal(service.updateEntry({ siteId: site.id, entryId: home.id, expectedRevision: edited.body.entry.revision, blocks: [{ id: "bad", type: "hero", data: { assetId: "sat_missing" } }] }, ACTOR_A).body.error, "site_asset_reference_invalid");

    const preview = service.previewSite({ siteId: site.id }, ACTOR_A).body.preview;
    const mediaPath = `/assets/media/${asset.id}.png`;
    assert.match(preview.html, new RegExp(mediaPath));
    assert.equal(preview.assetPaths[mediaPath], asset.id);
    assert.deepEqual(service.getAssetContent({ siteId: site.id, assetId: asset.id }, ACTOR_A).body.bytes, PNG_BYTES);
    assert.equal(service.getAssetContent({ siteId: site.id, assetId: asset.id }, ACTOR_B).status, 404);

    const plan = service.createPublicationPlan({ siteId: site.id }, ACTOR_A).body.plan;
    assert.equal(plan.snapshot.assets[0].id, asset.id);
    const published = await service.confirmPublicationPlan({ siteId: site.id, planId: plan.id, confirmed: true }, ACTOR_A);
    const media = published.body.publication.manifest.find((file) => file.path === mediaPath.slice(1));
    assert.equal(media.bytes, PNG_BYTES.length);
    assert.deepEqual(readFileSync(join(publishRoot, "team_a", site.id, published.body.publication.id, media.path)), PNG_BYTES);
    const blocked = service.deleteAsset({ siteId: site.id, assetId: asset.id, expectedRevision: asset.revision }, ACTOR_A);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error, "site_asset_in_use");
    assert.deepEqual(blocked.body.usedBy.publicationIds, [published.body.publication.id]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("valid images get responsive WebP variants and publish focal-point changes", async () => {
  const root = mkdtempSync(join(tmpdir(), "myagenttool-site-responsive-assets-"));
  const publishRoot = join(root, "releases");
  const assetRoot = join(root, "assets");
  const { service } = harness({ publishRoot, assetRoot });
  try {
    const site = createDefaultSite(service);
    const bytes = responsivePng();
    const uploaded = await service.uploadAsset({ siteId: site.id, name: "wide.png", contentType: "image/png" }, Readable.from([bytes]), ACTOR_A);
    assert.equal(uploaded.status, 201);
    const asset = uploaded.body.asset;
    assert.equal(asset.width, 1600);
    assert.equal(asset.height, 900);
    assert.deepEqual(asset.focalPoint, { x: 50, y: 50 });
    assert.equal(asset.derivativeStatus, "ready");
    assert.deepEqual(asset.derivatives.map((variant) => variant.key), ["w480", "w960", "w1440"]);
    assert.equal(asset.derivatives.some((variant) => "sha256" in variant), false, "ordinary views hide variant integrity details");

    const professional = service.listAssets({ siteId: site.id, professional: true }, ACTOR_A).body.assets[0];
    assert.equal(professional.derivatives.every((variant) => variant.sha256 && !("storageKey" in variant)), true);
    const variant = service.getAssetContent({ siteId: site.id, assetId: asset.id, variant: "w480" }, ACTOR_A);
    assert.equal(variant.status, 200);
    assert.equal(variant.body.asset.mimeType, "image/webp");
    assert.equal(variant.body.bytes.subarray(0, 4).toString("ascii"), "RIFF");
    assert.equal(service.getAssetContent({ siteId: site.id, assetId: asset.id, variant: "missing" }, ACTOR_A).status, 404);

    const home = service.getEntry({ siteId: site.id, entryId: site.entries[0].id }, ACTOR_A).body.entry;
    service.updateEntry({
      siteId: site.id, entryId: home.id, expectedRevision: home.revision,
      blocks: [{ id: "hero", type: "hero", data: { title: "响应式首页", assetId: asset.id } }],
    }, ACTOR_A);
    const preview = service.previewSite({ siteId: site.id }, ACTOR_A).body.preview;
    assert.match(preview.html, /srcset="[^"]*w480\.webp 480w[^"]*w960\.webp 960w[^"]*w1440\.webp 1440w"/);
    assert.match(preview.html, /width="1600" height="900"/);
    assert.match(preview.html, /object-position:50% 50%/);
    assert.deepEqual(preview.assetPaths[`/assets/media/${asset.id}-w480.webp`], { assetId: asset.id, variant: "w480" });

    const firstPlan = service.createPublicationPlan({ siteId: site.id }, ACTOR_A).body.plan;
    const firstPublish = await service.confirmPublicationPlan({ siteId: site.id, planId: firstPlan.id, confirmed: true }, ACTOR_A);
    assert.equal(firstPublish.status, 200);
    assert.equal(firstPublish.body.site.unpublishedCount, 0);
    assert.equal(firstPublish.body.publication.manifest.some((file) => file.path.endsWith(`-${asset.derivatives[0].key}.webp`)), true);

    const invalid = service.updateAsset({ siteId: site.id, assetId: asset.id, expectedRevision: asset.revision, focalPoint: { x: -1, y: 50 } }, ACTOR_A);
    assert.equal(invalid.status, 400);
    const updated = service.updateAsset({ siteId: site.id, assetId: asset.id, expectedRevision: asset.revision, focalPoint: { x: 20, y: 80 } }, ACTOR_A);
    assert.equal(updated.status, 200);
    assert.deepEqual(updated.body.asset.focalPoint, { x: 20, y: 80 });
    assert.equal(service.getSite({ siteId: site.id }, ACTOR_A).body.site.unpublishedCount, 1);
    assert.match(service.previewSite({ siteId: site.id }, ACTOR_A).body.preview.html, /object-position:20% 80%/);
    const focusPlan = service.createPublicationPlan({ siteId: site.id }, ACTOR_A).body.plan;
    assert.deepEqual(focusPlan.changes.assetsChanged, [asset.id]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("publication plans bind revisions, write immutable bundles, and mark content published", async () => {
  const publishRoot = join(tmpdir(), `myagenttool-sites-${Date.now()}`);
  const { service } = harness({ publishRoot });
  try {
    const site = createDefaultSite(service);
    const stale = service.createPublicationPlan({ siteId: site.id }, ACTOR_A).body.plan;
    const home = service.getEntry({ siteId: site.id, entryId: site.entries[0].id }, ACTOR_A).body.entry;
    service.updateEntry({ siteId: site.id, entryId: home.id, expectedRevision: home.revision, title: "已修改" }, ACTOR_A);
    assert.equal((await service.confirmPublicationPlan({ siteId: site.id, planId: stale.id, confirmed: true }, ACTOR_A)).status, 409);

    const plan = service.createPublicationPlan({ siteId: site.id }, ACTOR_A).body.plan;
    const published = await service.confirmPublicationPlan({ siteId: site.id, planId: plan.id, confirmed: true }, ACTOR_A);
    assert.equal(published.status, 200);
    assert.equal(published.body.site.visibility, "private_preview");
    assert.equal(published.body.site.unpublishedCount, 0);
    assert.equal(published.body.publication.verification.status, "healthy");
    const pointer = join(publishRoot, "team_a", site.id, "current.json");
    assert.equal(existsSync(pointer), true);
    assert.equal(JSON.parse(readFileSync(pointer, "utf8")).publicationId, published.body.publication.id);
  } finally {
    rmSync(publishRoot, { recursive: true, force: true });
  }
});

test("ordinary rollback restores the previous healthy release and preserves drafts", async () => {
  const { service } = harness();
  const site = createDefaultSite(service);
  const firstPlan = service.createPublicationPlan({ siteId: site.id }, ACTOR_A).body.plan;
  const first = (await service.confirmPublicationPlan({ siteId: site.id, planId: firstPlan.id, confirmed: true }, ACTOR_A)).body.publication;
  const currentSite = service.getSite({ siteId: site.id }, ACTOR_A).body.site;
  const home = service.getEntry({ siteId: site.id, entryId: currentSite.entries[0].id }, ACTOR_A).body.entry;
  service.updateEntry({
    siteId: site.id, entryId: home.id, expectedRevision: home.revision,
    blocks: [{ id: "new-hero", type: "hero", data: { title: "第二版" } }],
  }, ACTOR_A);
  const secondPlan = service.createPublicationPlan({ siteId: site.id }, ACTOR_A).body.plan;
  const second = (await service.confirmPublicationPlan({ siteId: site.id, planId: secondPlan.id, confirmed: true }, ACTOR_A)).body.publication;
  assert.notEqual(first.id, second.id);

  const rollbackPlan = service.createRollbackPlan({ siteId: site.id }, ACTOR_A).body.plan;
  const restored = await service.confirmRollbackPlan({ siteId: site.id, planId: rollbackPlan.id, confirmed: true }, ACTOR_A);
  assert.equal(restored.status, 200);
  assert.equal(restored.body.site.activePublicationId, first.id);
  const homeAfter = service.getEntry({ siteId: site.id, entryId: home.id }, ACTOR_A).body.entry;
  assert.notEqual(homeAfter.draftRevisionId, homeAfter.publishedRevisionId, "newer draft remains available after rollback");
});

test("rollback plans become stale when deployment settings change", async () => {
  const { service } = harness();
  const site = createDefaultSite(service);
  const firstPlan = service.createPublicationPlan({ siteId: site.id }, ACTOR_A).body.plan;
  await service.confirmPublicationPlan({ siteId: site.id, planId: firstPlan.id, confirmed: true }, ACTOR_A);
  const current = service.getSite({ siteId: site.id }, ACTOR_A).body.site;
  const home = service.getEntry({ siteId: site.id, entryId: current.entries[0].id }, ACTOR_A).body.entry;
  service.updateEntry({ siteId: site.id, entryId: home.id, expectedRevision: home.revision, title: "第二版" }, ACTOR_A);
  const secondPlan = service.createPublicationPlan({ siteId: site.id }, ACTOR_A).body.plan;
  await service.confirmPublicationPlan({ siteId: site.id, planId: secondPlan.id, confirmed: true }, ACTOR_A);
  const rollbackPlan = service.createRollbackPlan({ siteId: site.id }, ACTOR_A).body.plan;
  const target = service.getSite({ siteId: site.id, professional: true }, ACTOR_A).body.site.deploymentTarget;
  assert.equal(service.configureDeploymentTarget({ siteId: site.id, expectedRevision: target.revision, kind: "local_directory", displayName: "Changed local target" }, ACTOR_A).status, 200);
  const stale = await service.confirmRollbackPlan({ siteId: site.id, planId: rollbackPlan.id, confirmed: true }, ACTOR_A);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, "site_rollback_plan_stale");
});

test("deployment provider discovery separates ordinary labels from technical capability", () => {
  const { service } = harness();
  const providers = service.listDeploymentProviders().body.providers;
  assert.equal(providers.find((provider) => provider.kind === "cloudflare_pages").ordinaryLabel, "全球云托管");
  assert.equal(providers.find((provider) => provider.kind === "cloudflare_pages").productionReady, true);
  assert.deepEqual(providers.find((provider) => provider.kind === "cloudflare_pages").setupFlow.slice(0, 2), ["连接 Cloudflare 账号", "选择或创建 Pages 项目"]);
  assert.equal(providers.find((provider) => provider.kind === "ssh_static").professionalOnly, true);
  assert.equal(providers.find((provider) => provider.kind === "ssh_static").productionReady, true);
  assert.equal(providers.find((provider) => provider.kind === "ssh_static").connectionKind, "host_file_scope_reference");
  assert.equal(providers.find((provider) => provider.kind === "aliyun_oss_cdn").productionReady, true);
  assert.equal(providers.find((provider) => provider.kind === "aliyun_oss_cdn").capabilities.atomicActivation, true);
});

test("deployment target stores credential references but rejects pasted secrets", () => {
  const { service } = harness();
  const site = createDefaultSite(service);
  const target = service.getSite({ siteId: site.id, professional: true }, ACTOR_A).body.site.deploymentTarget;
  const pasted = service.configureDeploymentTarget({
    siteId: site.id, expectedRevision: target.revision, kind: "cloudflare_pages",
    displayName: "Cloudflare", credentialRef: "plain-access-token", customDomain: "example.com",
  }, ACTOR_A);
  assert.equal(pasted.status, 400);
  assert.equal(pasted.body.error, "site_deployment_credential_reference_invalid");
  const configured = service.configureDeploymentTarget({
    siteId: site.id, expectedRevision: target.revision, kind: "cloudflare_pages",
    displayName: "Cloudflare", credentialRef: "credential://cloudflare/main", remoteProjectRef: "example-site", customDomain: "www.example.com",
  }, ACTOR_A);
  assert.equal(configured.status, 200);
  assert.equal(configured.body.site.deploymentTarget.credentialRef, "credential://cloudflare/main");
  assert.equal(configured.body.site.deploymentTarget.customDomain, "www.example.com");

  const aliyunMissing = service.configureDeploymentTarget({
    siteId: site.id, expectedRevision: configured.body.site.deploymentTarget.revision, kind: "aliyun_oss_cdn",
    displayName: "阿里云", credentialRef: "credential://aliyun/main", remoteProjectRef: "luna-site",
  }, ACTOR_A);
  assert.equal(aliyunMissing.status, 400);
  assert.equal(aliyunMissing.body.error, "site_deployment_region_required");
});

test("verified Alibaba Cloud target receives the previous publication and keeps credentials out of state", async () => {
  const calls = [];
  const aliyun = {
    verifyConnection: async ({ target, credential }) => {
      calls.push(["verify", target.remoteProjectRef, credential.accessKeyId]);
      return { provider: "aliyun_oss_cdn", bucket: target.remoteProjectRef, versioning: "Enabled", https: true };
    },
    deploy: async ({ credential, publicationId, previousPublication }) => {
      calls.push(["deploy", publicationId, previousPublication?.id ?? null, credential.accessKeyId]);
      return {
        provider: "aliyun_oss_cdn",
        releasePrefix: `_myagenttool/releases/${publicationId}`,
        activationPaths: ["index.html", "404.html"],
        url: "https://www.example.com/",
        verification: { checkedAt: "2026-08-24T00:00:10.000Z", contentHash: "b".repeat(64) },
      };
    },
  };
  const { service, state } = harness({
    resolveCredential: async () => ({ ok: true, credential: { accessKeyId: "LTAI-secret-id", accessKeySecret: "secret-value" } }),
    deploymentAdapters: { aliyun_oss_cdn: aliyun },
  });
  const site = createDefaultSite(service);
  const localPlan = service.createPublicationPlan({ siteId: site.id }, ACTOR_A).body.plan;
  const local = await service.confirmPublicationPlan({ siteId: site.id, planId: localPlan.id, confirmed: true }, ACTOR_A);
  const target = service.getSite({ siteId: site.id, professional: true }, ACTOR_A).body.site.deploymentTarget;
  const configured = service.configureDeploymentTarget({
    siteId: site.id, expectedRevision: target.revision, kind: "aliyun_oss_cdn", displayName: "阿里云",
    credentialRef: "credential://aliyun/main", remoteProjectRef: "luna-site",
    region: "oss-cn-hangzhou", customDomain: "www.example.com",
  }, ACTOR_A);
  assert.equal(configured.status, 200);
  assert.equal((await service.verifyDeploymentTarget({ siteId: site.id }, ACTOR_A)).status, 200);
  const plan = service.createPublicationPlan({ siteId: site.id }, ACTOR_A).body.plan;
  const published = await service.confirmPublicationPlan({ siteId: site.id, planId: plan.id, confirmed: true }, ACTOR_A);
  assert.equal(published.status, 200);
  assert.equal(published.body.site.publicUrl, "https://www.example.com/");
  assert.deepEqual(calls.map((call) => call[0]), ["verify", "deploy"]);
  assert.equal(calls[1][2], local.body.publication.id);
  assert.equal(JSON.stringify(state).includes("secret-value"), false);
  assert.equal(JSON.stringify(state).includes("LTAI-secret-id"), false);
});

test("deployment target verification blocks concurrent reconfiguration", async () => {
  let finishVerification;
  let verificationStarted;
  const verificationGate = new Promise((resolve) => { finishVerification = resolve; });
  const started = new Promise((resolve) => { verificationStarted = resolve; });
  const aliyun = {
    verifyConnection: async () => {
      verificationStarted();
      await verificationGate;
      return { provider: "aliyun_oss_cdn", versioning: "Enabled", https: true };
    },
  };
  const { service } = harness({
    resolveCredential: async () => ({ ok: true, credential: { accessKeyId: "LTAI5exampleKey", accessKeySecret: "secret" } }),
    deploymentAdapters: { aliyun_oss_cdn: aliyun },
  });
  const site = createDefaultSite(service);
  const target = service.getSite({ siteId: site.id, professional: true }, ACTOR_A).body.site.deploymentTarget;
  const configured = service.configureDeploymentTarget({
    siteId: site.id, expectedRevision: target.revision, kind: "aliyun_oss_cdn", displayName: "阿里云",
    credentialRef: "credential://aliyun/main", remoteProjectRef: "luna-site", region: "oss-cn-hangzhou", customDomain: "www.example.com",
  }, ACTOR_A);
  const verifying = service.verifyDeploymentTarget({ siteId: site.id }, ACTOR_A);
  await started;

  const busy = service.configureDeploymentTarget({
    siteId: site.id, expectedRevision: configured.body.site.deploymentTarget.revision, kind: "local_directory", displayName: "本地目录",
  }, ACTOR_A);
  assert.equal(busy.status, 409);
  assert.equal(busy.body.error, "site_deployment_busy");
  assert.equal((await service.verifyDeploymentTarget({ siteId: site.id }, ACTOR_A)).body.error, "site_deployment_busy");

  finishVerification();
  assert.equal((await verifying).status, 200);
});

test("a running cloud publication exposes bounded progress without its snapshot", async () => {
  let releaseDeploy;
  let enteredDeploy;
  const deployGate = new Promise((resolve) => { releaseDeploy = resolve; });
  const entered = new Promise((resolve) => { enteredDeploy = resolve; });
  const aliyun = {
    verifyConnection: async () => ({ provider: "aliyun_oss_cdn", versioning: "Enabled", https: true }),
    deploy: async ({ onProgress, publicationId }) => {
      await onProgress({ stage: "uploading", completed: 1, total: 4, itemsCompleted: 3, itemsTotal: 12 });
      enteredDeploy();
      await deployGate;
      return { provider: "aliyun_oss_cdn", releasePrefix: `_myagenttool/releases/${publicationId}`, activationPaths: ["index.html"], url: "https://www.example.com/", verification: { checkedAt: "2026-08-24T00:00:10.000Z", contentHash: "c".repeat(64) } };
    },
  };
  const { service } = harness({
    resolveCredential: async () => ({ ok: true, credential: { accessKeyId: "LTAI5exampleKey", accessKeySecret: "secret" } }),
    deploymentAdapters: { aliyun_oss_cdn: aliyun },
  });
  const site = createDefaultSite(service);
  const target = service.getSite({ siteId: site.id, professional: true }, ACTOR_A).body.site.deploymentTarget;
  service.configureDeploymentTarget({
    siteId: site.id, expectedRevision: target.revision, kind: "aliyun_oss_cdn", displayName: "阿里云",
    credentialRef: "credential://aliyun/main", remoteProjectRef: "luna-site", region: "oss-cn-hangzhou", customDomain: "www.example.com",
  }, ACTOR_A);
  await service.verifyDeploymentTarget({ siteId: site.id }, ACTOR_A);
  const plan = service.createPublicationPlan({ siteId: site.id }, ACTOR_A).body.plan;
  const competingPlan = service.createPublicationPlan({ siteId: site.id }, ACTOR_A).body.plan;
  const publishing = service.confirmPublicationPlan({ siteId: site.id, planId: plan.id, confirmed: true }, ACTOR_A);
  await entered;

  const progress = service.getPublicationPlan({ siteId: site.id, planId: plan.id }, ACTOR_A);
  assert.equal(progress.body.plan.status, "deploying");
  assert.deepEqual(progress.body.plan.progress, { stage: "uploading", completed: 1, total: 4, itemsCompleted: 3, itemsTotal: 12, updatedAt: "2026-08-24T00:00:00.000Z" });
  assert.equal(progress.body.plan.snapshot, undefined);
  const competing = await service.confirmPublicationPlan({ siteId: site.id, planId: competingPlan.id, confirmed: true }, ACTOR_A);
  assert.equal(competing.status, 409);
  assert.equal(competing.body.error, "site_deployment_busy");
  const currentTarget = service.getSite({ siteId: site.id, professional: true }, ACTOR_A).body.site.deploymentTarget;
  const reconfigured = service.configureDeploymentTarget({
    siteId: site.id, expectedRevision: currentTarget.revision, kind: "local_directory", displayName: "本地目录",
  }, ACTOR_A);
  assert.equal(reconfigured.status, 409);
  assert.equal(reconfigured.body.error, "site_deployment_busy");

  releaseDeploy();
  assert.equal((await publishing).status, 200);
  assert.equal(service.getPublicationPlan({ siteId: site.id, planId: plan.id }, ACTOR_A).body.plan.progress.stage, "completed");
});

test("verified Cloudflare target publishes publicly without exposing credentials", async () => {
  const calls = [];
  const cloudflare = {
    verifyConnection: async ({ credential }) => {
      calls.push(["verify", credential.apiToken]);
      return { provider: "cloudflare_pages", projectName: "example-site", publicUrl: "https://example-site.pages.dev" };
    },
    deploy: async ({ credential, publicationId }) => {
      calls.push(["deploy", credential.apiToken, publicationId]);
      return {
        provider: "cloudflare_pages", deploymentId: "dep_1", url: "https://dep.example-site.pages.dev/",
        verification: { checkedAt: "2026-08-24T00:00:10.000Z", contentHash: "a".repeat(64) },
      };
    },
  };
  const { service, state } = harness({
    resolveCredential: async () => ({ ok: true, credential: { accountId: "0".repeat(32), apiToken: "secret-token" } }),
    deploymentAdapters: { cloudflare_pages: cloudflare },
  });
  const site = createDefaultSite(service);
  const target = service.getSite({ siteId: site.id, professional: true }, ACTOR_A).body.site.deploymentTarget;
  const configured = service.configureDeploymentTarget({
    siteId: site.id, expectedRevision: target.revision, kind: "cloudflare_pages", displayName: "Cloudflare",
    credentialRef: "credential://cloudflare/main", remoteProjectRef: "example-site",
  }, ACTOR_A);
  assert.equal(configured.status, 200);
  const verified = await service.verifyDeploymentTarget({ siteId: site.id }, ACTOR_A);
  assert.equal(verified.status, 200);
  const plan = service.createPublicationPlan({ siteId: site.id }, ACTOR_A).body.plan;
  const published = await service.confirmPublicationPlan({ siteId: site.id, planId: plan.id, confirmed: true }, ACTOR_A);
  assert.equal(published.status, 200);
  assert.equal(published.body.site.visibility, "public");
  assert.equal(published.body.site.publicUrl, "https://dep.example-site.pages.dev/");
  assert.equal(published.body.publication.remoteDeployment, undefined, "ordinary publication view hides provider internals");
  assert.equal(JSON.stringify(state).includes("secret-token"), false);
  assert.deepEqual(calls.map(([kind]) => kind), ["verify", "deploy"]);
});

test("SSH static target reuses a verified host range without a second credential reference", async () => {
  const calls = [];
  const ssh = {
    verifyConnection: async ({ target, credential }) => {
      calls.push(["verify", target.remoteProjectRef, credential]);
      return { provider: "ssh_static", hostId: "ssh_target_1", scopeId: target.remoteProjectRef, atomicActivation: true };
    },
    deploy: async ({ target, credential, publicationId, bundle }) => {
      calls.push(["deploy", publicationId, credential]);
      return {
        provider: "ssh_static", releaseId: publicationId, remoteReleasePath: `/srv/www/site/releases/${publicationId}`,
        activePointerPath: "/srv/www/site/current", bundleHash: bundle.hash, url: `https://${target.customDomain}/`,
        verification: { checkedAt: "2026-08-24T00:00:10.000Z", contentHash: "c".repeat(64) },
      };
    },
    rollback: async ({ credential, publication }) => {
      calls.push(["rollback", publication.id, credential]);
      return { provider: "ssh_static", releaseId: publication.id, url: "https://www.example.com/", verification: { contentHash: "c".repeat(64) } };
    },
  };
  const { service, state } = harness({
    resolveCredential: async () => { throw new Error("site target must not resolve a second credential"); },
    deploymentAdapters: { ssh_static: ssh },
  });
  const site = createDefaultSite(service);
  state.sshTargets.push({ id: "ssh_target_1", ownerTeamId: "team_a", connectionStatus: "ready", purposes: ["site_publish"], capabilities: { sftp: true, posixRename: true, symlink: true } });
  state.hostFileScopes.push({
    id: "hfs_1", ownerTeamId: "team_a", sshTargetId: "ssh_target_1", purpose: "site_publish", status: "ready",
    permissions: ["list", "upload", "download"], resolvedRootPath: "/srv/www/site",
  });
  const target = service.getSite({ siteId: site.id, professional: true }, ACTOR_A).body.site.deploymentTarget;
  const configured = service.configureDeploymentTarget({
    siteId: site.id, expectedRevision: target.revision, kind: "ssh_static", displayName: "我的服务器",
    remoteProjectRef: "hfs_1", customDomain: "www.example.com",
  }, ACTOR_A);
  assert.equal(configured.status, 200);
  assert.equal(configured.body.site.deploymentTarget.credentialRef, null);
  assert.equal((await service.verifyDeploymentTarget({ siteId: site.id }, ACTOR_A)).status, 200);

  const firstPlan = service.createPublicationPlan({ siteId: site.id }, ACTOR_A).body.plan;
  const first = await service.confirmPublicationPlan({ siteId: site.id, planId: firstPlan.id, confirmed: true }, ACTOR_A);
  assert.equal(first.status, 200);
  assert.equal(first.body.site.publicUrl, "https://www.example.com/");
  const current = service.getSite({ siteId: site.id }, ACTOR_A).body.site;
  const home = service.getEntry({ siteId: site.id, entryId: current.entries[0].id }, ACTOR_A).body.entry;
  service.updateEntry({ siteId: site.id, entryId: home.id, expectedRevision: home.revision, title: "SSH 第二版" }, ACTOR_A);
  const secondPlan = service.createPublicationPlan({ siteId: site.id }, ACTOR_A).body.plan;
  assert.equal((await service.confirmPublicationPlan({ siteId: site.id, planId: secondPlan.id, confirmed: true }, ACTOR_A)).status, 200);
  const rollbackPlan = service.createRollbackPlan({ siteId: site.id, targetPublicationId: first.body.publication.id }, ACTOR_A).body.plan;
  assert.equal((await service.confirmRollbackPlan({ siteId: site.id, planId: rollbackPlan.id, confirmed: true }, ACTOR_A)).status, 200);
  assert.deepEqual(calls.map(([kind]) => kind), ["verify", "deploy", "deploy", "rollback"]);
  assert.equal(calls.every((call) => call.at(-1) === null || typeof call.at(-1) === "string"), true);
});

test("domain and TLS setup is team scoped, revision gated, and keeps DNS credentials opaque", () => {
  const { service, state } = harness();
  const site = createDefaultSite(service);
  state.sshTargets.push({
    id: "ssh_target_1", ownerTeamId: "team_a", connectionStatus: "ready", networkPolicy: "public_only",
    purposes: ["site_publish"], capabilities: { sftp: true, posixRename: true, symlink: true },
  });
  state.hostFileScopes.push({
    id: "hfs_1", ownerTeamId: "team_a", sshTargetId: "ssh_target_1", purpose: "site_publish", status: "ready",
    permissions: ["list", "upload", "download"], resolvedRootPath: "/srv/www/site", lastResolvedAddress: "8.8.8.8",
  });
  const target = service.getSite({ siteId: site.id, professional: true }, ACTOR_A).body.site.deploymentTarget;
  const configured = service.configureDeploymentTarget({
    siteId: site.id, expectedRevision: target.revision, kind: "ssh_static", displayName: "我的服务器",
    remoteProjectRef: "hfs_1", customDomain: "lan.mytoolagent.com",
  }, ACTOR_A);
  assert.equal(configured.status, 200);

  state.hostFileScopes[0].status = "error";
  const staleScope = service.configureDomainTlsBinding({
    siteId: site.id, expectedRevision: 0, hostname: "lan.mytoolagent.com", accessMode: "public",
  }, ACTOR_A);
  assert.equal(staleScope.status, 409);
  assert.equal(staleScope.body.error, "site_domain_ssh_target_not_ready");
  state.hostFileScopes[0].status = "ready";

  const blockedPrivate = service.configureDomainTlsBinding({
    siteId: site.id, expectedRevision: 0, hostname: "lan.mytoolagent.com", accessMode: "private_lan",
  }, ACTOR_A);
  assert.equal(blockedPrivate.status, 409);
  assert.equal(blockedPrivate.body.error, "site_domain_private_network_not_allowed");

  state.sshTargets[0].networkPolicy = "allow_private_network";
  const wrongAddress = service.configureDomainTlsBinding({
    siteId: site.id, expectedRevision: 0, hostname: "lan.mytoolagent.com", accessMode: "private_lan",
  }, ACTOR_A);
  assert.equal(wrongAddress.status, 409);
  assert.equal(wrongAddress.body.error, "site_domain_private_address_required");
  state.hostFileScopes[0].lastResolvedAddress = "10.10.10.222";
  const created = service.configureDomainTlsBinding({
    siteId: site.id, expectedRevision: 0, hostname: "LAN.MyToolAgent.com", accessMode: "private_lan",
  }, ACTOR_A);
  assert.equal(created.status, 201);
  assert.equal(created.body.binding.hostname, "lan.mytoolagent.com");
  assert.equal(created.body.binding.dnsCredentialRef, "credential://alidns/main");
  assert.equal(created.body.binding.challenge, "dns-01");
  assert.equal(created.body.binding.status, "setup");
  assert.equal(service.configureDomainTlsBinding({ siteId: site.id, expectedRevision: 0, hostname: "lan.mytoolagent.com", accessMode: "private_lan" }, ACTOR_A).status, 409);
  assert.equal(service.configureDomainTlsBinding({ siteId: site.id, expectedRevision: 1, hostname: "lan.mytoolagent.com", accessMode: "private_lan" }, ACTOR_B).status, 404);

  const ordinary = service.getSite({ siteId: site.id }, ACTOR_A).body.site.domainTlsBinding;
  assert.deepEqual(Object.keys(ordinary).sort(), ["accessMode", "hostname", "lastVerifiedAt", "notAfter", "renewAfter", "status"]);
  assert.equal("dnsCredentialRef" in ordinary, false);
  assert.equal(JSON.stringify(state).includes("AccessKey"), false);
});

test("changing an SSH publishing target marks the domain binding for a fresh HTTPS check", () => {
  const { service, state } = harness();
  const site = createDefaultSite(service);
  state.sshTargets.push({
    id: "ssh_target_1", ownerTeamId: "team_a", connectionStatus: "ready", networkPolicy: "allow_private_network",
    purposes: ["site_publish"], capabilities: { sftp: true, posixRename: true, symlink: true },
  });
  state.hostFileScopes.push({
    id: "hfs_1", ownerTeamId: "team_a", sshTargetId: "ssh_target_1", purpose: "site_publish", status: "ready",
    permissions: ["list", "upload", "download"], resolvedRootPath: "/srv/www/site", lastResolvedAddress: "10.10.10.222",
  });
  let target = service.getSite({ siteId: site.id, professional: true }, ACTOR_A).body.site.deploymentTarget;
  target = service.configureDeploymentTarget({
    siteId: site.id, expectedRevision: target.revision, kind: "ssh_static", displayName: "我的服务器",
    remoteProjectRef: "hfs_1", customDomain: "lan.mytoolagent.com",
  }, ACTOR_A).body.site.deploymentTarget;
  assert.equal(service.configureDomainTlsBinding({
    siteId: site.id, expectedRevision: 0, hostname: "lan.mytoolagent.com", accessMode: "private_lan",
  }, ACTOR_A).status, 201);

  const changed = service.configureDeploymentTarget({
    siteId: site.id, expectedRevision: target.revision, kind: "ssh_static", displayName: "我的服务器",
    remoteProjectRef: "hfs_1", customDomain: "site.mytoolagent.com",
  }, ACTOR_A);
  assert.equal(changed.status, 200);
  assert.equal(changed.body.site.domainTlsBinding.status, "needs_attention");
  assert.equal(changed.body.site.domainTlsBinding.lastFailure.error, "site_domain_target_changed");
  assert.equal(service.getSite({ siteId: site.id }, ACTOR_A).body.site.domainTlsBinding.lastFailure, undefined);
});

test("AliDNS verification and staging issuance expose only certificate summaries", async () => {
  const calls = [];
  let releaseIssue;
  let markIssueStarted;
  const issueGate = new Promise((resolve) => { releaseIssue = resolve; });
  const issueStarted = new Promise((resolve) => { markIssueStarted = resolve; });
  const domainTlsAdapter = {
    verifyDns: async ({ hostname, credential }) => {
      calls.push(["verify", hostname, credential.accessKeyId]);
      assert.equal(credential.accessKeySecret, "dns-secret-value");
      return { provider: "alidns", zone: "mytoolagent.com" };
    },
    issueStaging: async ({ bindingId, hostname, contactEmail, credential }) => {
      calls.push(["issue", bindingId, hostname, contactEmail, credential.accessKeyId]);
      assert.equal(credential.accessKeySecret, "dns-secret-value");
      markIssueStarted();
      await issueGate;
      return {
        environment: "staging",
        fingerprint: "b".repeat(64),
        issuer: "CN=Fake LE Intermediate X1",
        sans: [hostname],
        notBefore: "2026-08-26T00:00:00.000Z",
        notAfter: "2026-11-24T00:00:00.000Z",
        cleanup: { ok: true },
      };
    },
  };
  const { service, state } = harness({
    domainTlsAdapter,
    resolveCredential: async (reference) => {
      assert.equal(reference, "credential://alidns/main");
      return { ok: true, credential: { accessKeyId: "LTAI5dnsExampleKey", accessKeySecret: "dns-secret-value" } };
    },
  });
  const site = createDefaultSite(service);
  state.sshTargets.push({
    id: "ssh_target_1", ownerTeamId: "team_a", connectionStatus: "ready", networkPolicy: "public_only",
    purposes: ["site_publish"], capabilities: { sftp: true, posixRename: true, symlink: true },
  });
  state.hostFileScopes.push({
    id: "hfs_1", ownerTeamId: "team_a", sshTargetId: "ssh_target_1", purpose: "site_publish", status: "ready",
    permissions: ["list", "upload", "download"], resolvedRootPath: "/srv/www/site", lastResolvedAddress: "8.8.8.8",
  });
  const target = service.getSite({ siteId: site.id, professional: true }, ACTOR_A).body.site.deploymentTarget;
  service.configureDeploymentTarget({
    siteId: site.id, expectedRevision: target.revision, kind: "ssh_static", displayName: "我的服务器",
    remoteProjectRef: "hfs_1", customDomain: "lan.mytoolagent.com",
  }, ACTOR_A);
  let binding = service.configureDomainTlsBinding({
    siteId: site.id, expectedRevision: 0, hostname: "lan.mytoolagent.com", accessMode: "public",
  }, ACTOR_A).body.binding;

  const verified = await service.verifyDomainTlsDns({ siteId: site.id, expectedRevision: binding.revision }, ACTOR_A);
  assert.equal(verified.status, 200);
  binding = verified.body.binding;
  assert.equal(binding.status, "dns_ready");
  assert.equal(binding.dnsZone, "mytoolagent.com");
  assert.equal((await service.issueDomainTlsStaging({ siteId: site.id, expectedRevision: binding.revision }, ACTOR_A)).body.error, "site_domain_staging_confirmation_required");

  const issueRequest = service.issueDomainTlsStaging({ siteId: site.id, expectedRevision: binding.revision, confirmed: true }, ACTOR_A);
  await issueStarted;
  assert.equal(service.configureDomainTlsBinding({
    siteId: site.id, expectedRevision: binding.revision, hostname: "lan.mytoolagent.com", accessMode: "public",
  }, ACTOR_A).body.error, "site_domain_tls_busy");
  const currentTarget = service.getSite({ siteId: site.id, professional: true }, ACTOR_A).body.site.deploymentTarget;
  assert.equal(service.configureDeploymentTarget({
    siteId: site.id, expectedRevision: currentTarget.revision, kind: "ssh_static", displayName: "我的服务器",
    remoteProjectRef: "hfs_1", customDomain: "lan.mytoolagent.com",
  }, ACTOR_A).body.error, "site_domain_tls_busy");
  releaseIssue();
  const issued = await issueRequest;
  assert.equal(issued.status, 200);
  assert.equal(issued.body.binding.status, "staging_ready");
  assert.equal(issued.body.binding.certificateEnvironment, "staging");
  assert.equal(issued.body.binding.certificateFingerprint, "b".repeat(64));
  assert.equal(issued.body.binding.notAfter, "2026-11-24T00:00:00.000Z");
  assert.equal(issued.body.binding.renewAfter, "2026-10-25T00:00:00.000Z");
  assert.deepEqual(calls.map(([action]) => action), ["verify", "issue"]);

  const ordinary = service.getSite({ siteId: site.id }, ACTOR_A).body.site.domainTlsBinding;
  assert.equal(ordinary.status, "staging_ready");
  assert.equal("dnsZone" in ordinary, false);
  assert.equal("certificateFingerprint" in ordinary, false);
  assert.equal(JSON.stringify(state).includes("dns-secret-value"), false);
  assert.equal(JSON.stringify(issued.body).includes("dns-secret-value"), false);
});

test("configures and executes staging certificate deployment without exposing key material", async () => {
  const calls = [];
  const artifact = { privateKey: Buffer.from("CERTIFICATE PRIVATE KEY"), certificate: Buffer.from("CERTIFICATE CHAIN"), hostname: "lan.mytoolagent.com", fingerprint: "c".repeat(64) };
  const domainTlsAdapter = {
    hasStagingArtifact: (bindingId, fingerprint) => bindingId.startsWith("stb_") && fingerprint === artifact.fingerprint,
    withStagingArtifact: async (_bindingId, _fingerprint, operation) => operation(artifact),
    discardStagingArtifact: (bindingId) => calls.push(["discard", bindingId]),
  };
  const tlsCertificateAdapter = { deployStaging: async ({ binding, artifact: input }) => {
    assert.equal(input.privateKey.toString(), "CERTIFICATE PRIVATE KEY");
    calls.push(["deploy", binding.id]);
    return { releaseId: `staging-${input.fingerprint.slice(0, 32)}`, activationProfileId: "htp_1" };
  } };
  const { service, state } = harness({ domainTlsAdapter, tlsCertificateAdapter });
  const site = createDefaultSite(service);
  state.sshTargets.push({ id: "ssh_1", ownerTeamId: "team_a", connectionStatus: "ready", networkPolicy: "allow_private_network", purposes: ["site_publish"], capabilities: { sftp: true, posixRename: true, symlink: true } });
  state.hostFileScopes.push(
    { id: "hfs_publish", ownerTeamId: "team_a", sshTargetId: "ssh_1", purpose: "site_publish", status: "ready", permissions: ["list", "upload", "download"], resolvedRootPath: "/srv/www/site", lastResolvedAddress: "10.10.10.222" },
    { id: "hfs_tls", ownerTeamId: "team_a", sshTargetId: "ssh_1", purpose: "tls_certificate", status: "ready", permissions: ["certificate_write"], resolvedRootPath: "/srv/tls/site", lastResolvedAddress: "10.10.10.222" },
  );
  state.hostTlsActivationProfiles.push({ id: "htp_1", ownerTeamId: "team_a", sshTargetId: "ssh_1", certificateScopeId: "hfs_tls", type: "docker_nginx", status: "ready" });
  const initialTarget = service.getSite({ siteId: site.id, professional: true }, ACTOR_A).body.site.deploymentTarget;
  service.configureDeploymentTarget({ siteId: site.id, expectedRevision: initialTarget.revision, kind: "ssh_static", displayName: "LAN", remoteProjectRef: "hfs_publish", customDomain: "lan.mytoolagent.com" }, ACTOR_A);
  const created = service.configureDomainTlsBinding({ siteId: site.id, expectedRevision: 0, hostname: "lan.mytoolagent.com", accessMode: "private_lan" }, ACTOR_A).body.binding;
  const stored = state.siteDomainTlsBindings[0];
  Object.assign(stored, { status: "staging_ready", certificateEnvironment: "staging", certificateFingerprint: artifact.fingerprint, certificateSans: [artifact.hostname], notAfter: "2026-11-24T00:00:00.000Z" });
  const configured = service.configureDomainTlsDeployment({ siteId: site.id, expectedRevision: created.revision, certificateScopeId: "hfs_tls", activationProfileId: "htp_1" }, ACTOR_A);
  assert.equal(configured.status, 200);
  assert.equal((await service.deployDomainTlsStaging({ siteId: site.id, expectedRevision: configured.body.binding.revision }, ACTOR_A)).body.error, "site_tls_staging_deployment_confirmation_required");
  const deployed = await service.deployDomainTlsStaging({ siteId: site.id, expectedRevision: configured.body.binding.revision, confirmed: true }, ACTOR_A);
  assert.equal(deployed.status, 200);
  assert.equal(deployed.body.binding.status, "staging_deployed");
  assert.match(deployed.body.binding.certificateReleaseId, /^staging-c+$/);
  assert.deepEqual(calls.map(([action]) => action), ["deploy", "discard"]);
  assert.equal(JSON.stringify(state).includes("CERTIFICATE PRIVATE KEY"), false);
  assert.equal(JSON.stringify(deployed.body).includes("CERTIFICATE PRIVATE KEY"), false);
  const ordinary = service.getSite({ siteId: site.id }, ACTOR_A).body.site.domainTlsBinding;
  assert.equal(ordinary.status, "staging_deployed");
  assert.equal("certificateReleaseId" in ordinary, false);
});

test("failed cloud deployment keeps the active release and records a sanitized failure", async () => {
  const cloudflare = {
    verifyConnection: async () => ({ provider: "cloudflare_pages", projectName: "example-site" }),
    deploy: async () => { throw new SiteDeploymentAdapterError("site_deployment_auth_failed", "Cloudflare request failed (10000)."); },
  };
  const { service, state } = harness({
    resolveCredential: async () => ({ ok: true, credential: { apiToken: "never-persist-me" } }),
    deploymentAdapters: { cloudflare_pages: cloudflare },
  });
  const site = createDefaultSite(service);
  const localPlan = service.createPublicationPlan({ siteId: site.id }, ACTOR_A).body.plan;
  const local = await service.confirmPublicationPlan({ siteId: site.id, planId: localPlan.id, confirmed: true }, ACTOR_A);
  const activeBefore = local.body.site.activePublicationId;
  const target = service.getSite({ siteId: site.id, professional: true }, ACTOR_A).body.site.deploymentTarget;
  service.configureDeploymentTarget({
    siteId: site.id, expectedRevision: target.revision, kind: "cloudflare_pages", displayName: "Cloudflare",
    credentialRef: "credential://cloudflare/main", remoteProjectRef: "example-site",
  }, ACTOR_A);
  await service.verifyDeploymentTarget({ siteId: site.id }, ACTOR_A);
  const plan = service.createPublicationPlan({ siteId: site.id }, ACTOR_A).body.plan;
  const failed = await service.confirmPublicationPlan({ siteId: site.id, planId: plan.id, confirmed: true }, ACTOR_A);
  assert.equal(failed.status, 502);
  assert.equal(failed.body.error, "site_deployment_auth_failed");
  assert.equal(service.getSite({ siteId: site.id }, ACTOR_A).body.site.activePublicationId, activeBefore);
  assert.equal(state.sitePublicationPlans.find((item) => item.id === plan.id).status, "failed");
  assert.equal(JSON.stringify(state).includes("never-persist-me"), false);
});
