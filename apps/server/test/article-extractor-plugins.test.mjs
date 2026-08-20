import assert from "node:assert/strict";
import test from "node:test";

import {
  ARTICLE_EXTRACTOR_PLUGIN_ACTIONS,
  articleExtractorInstallApprovalTarget,
  articleExtractorManifestChecksum,
  createArticleExtractorPluginService,
  normalizeArticleExtractorManifest,
} from "../src/services/article-extractor-plugins.mjs";

const MANIFEST = {
  schemaVersion: 1,
  id: "example.article",
  name: "Example articles",
  version: "1.0.0",
  kind: "article_extractor",
  hosts: ["news.example.com"],
  extraction: {
    content: ["article.post"],
    title: ["h1.title"],
    author: [".author"],
    publishedAt: ["time.published"],
  },
  minimumTextLength: 80,
};

function harness() {
  const state = { articleExtractorPlugins: [] };
  const approvals = [];
  let id = 0;
  const service = createArticleExtractorPluginService({
    state,
    now: () => "2026-08-20T12:00:00.000Z",
    nextId: (prefix) => `${prefix}_${++id}`,
    appendEvent: () => {},
    persistStateSoon: () => {},
    validateApprovalToken: (token, scope) => {
      approvals.push(scope);
      return token === "approved" ? { approved: true, mode: "grant", grantId: "apg_1" } : { approved: false, reason: "grant_required" };
    },
  });
  return { approvals, service, state };
}

test("normalizes a declarative extractor and rejects executable or broad selector input", () => {
  const normalized = normalizeArticleExtractorManifest(MANIFEST);
  assert.equal(normalized.hosts[0], "news.example.com");
  assert.equal(normalized.extraction.content[0], "article.post");
  assert.equal(articleExtractorManifestChecksum(normalized).length, 64);
  assert.throws(
    () => normalizeArticleExtractorManifest({ ...MANIFEST, extraction: { ...MANIFEST.extraction, content: ["article .post"] } }),
    (error) => error.code === "invalid_article_extractor_selectors",
  );
  assert.throws(
    () => normalizeArticleExtractorManifest({ ...MANIFEST, hosts: ["*.example.com"] }),
    (error) => error.code === "invalid_article_extractor_hosts",
  );
  // Unknown fields are dropped, so they can never become executable runtime
  // behavior; the normalized output is the complete capability boundary.
  assert.equal("run" in normalizeArticleExtractorManifest({ ...MANIFEST, run: "ignored" }), false);
});

test("installation is approval-bound, team-scoped, hot-resolvable, disableable, and rollbackable", () => {
  const { approvals, service } = harness();
  const actor = { userId: "usr_a", teamId: "team_a" };
  const denied = service.install({ manifest: MANIFEST }, actor);
  assert.equal(denied.status, 403);

  const installed = service.install({ manifest: MANIFEST, approvalToken: "approved" }, actor);
  assert.equal(installed.status, 201);
  assert.equal(installed.body.plugin.activeVersion, "1.0.0");
  assert.deepEqual(approvals.at(-1), {
    action: ARTICLE_EXTRACTOR_PLUGIN_ACTIONS.install,
    targetId: articleExtractorInstallApprovalTarget("team_a", MANIFEST.id, MANIFEST.version),
    actor,
    allowLegacy: false,
  });
  assert.equal(service.resolveForUrl("https://news.example.com/post/1", "team_a")?.pluginId, MANIFEST.id);
  assert.equal(service.resolveForUrl("https://other.example.com/post/1", "team_a"), null);
  assert.equal(service.resolveForUrl("https://news.example.com/post/1", "team_b"), null);

  const next = { ...MANIFEST, version: "1.1.0", extraction: { ...MANIFEST.extraction, content: ["main.article"] } };
  assert.equal(service.install({ manifest: next, approvalToken: "approved" }, actor).body.plugin.activeVersion, "1.1.0");
  const row = service.list({}, actor).body.plugins[0];
  assert.deepEqual(row.versions.map((item) => item.version), ["1.1.0", "1.0.0"]);

  const activated = service.activate({ pluginId: MANIFEST.id, version: "1.0.0", approvalToken: "approved" }, actor);
  assert.equal(activated.body.plugin.activeVersion, "1.0.0");
  assert.equal(service.resolveForUrl("https://news.example.com/post/1", "team_a")?.manifest.version, "1.0.0");

  assert.equal(service.disable({ pluginId: MANIFEST.id, approvalToken: "approved" }, actor).body.plugin.enabled, false);
  assert.equal(service.resolveForUrl("https://news.example.com/post/1", "team_a"), null);
  assert.deepEqual(service.list({}, { userId: "usr_b", teamId: "team_b" }).body.plugins, []);
});

test("a version cannot be silently replaced by different extraction rules", () => {
  const { service } = harness();
  const actor = { userId: "usr_a", teamId: "team_a" };
  assert.equal(service.install({ manifest: MANIFEST, approvalToken: "approved" }, actor).status, 201);
  const conflict = service.install({
    manifest: { ...MANIFEST, extraction: { ...MANIFEST.extraction, content: ["main.changed"] } },
    approvalToken: "approved",
  }, actor);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, "article_extractor_version_conflict");
});

test("two active plugins cannot claim the same host and tampered persisted manifests fail closed", () => {
  const { service, state } = harness();
  const actor = { userId: "usr_a", teamId: "team_a" };
  assert.equal(service.install({ manifest: MANIFEST, approvalToken: "approved" }, actor).status, 201);
  const overlapping = service.install({
    manifest: { ...MANIFEST, id: "example.other", version: "2.0.0" },
    approvalToken: "approved",
  }, actor);
  assert.equal(overlapping.status, 409);
  assert.equal(overlapping.body.error, "article_extractor_host_conflict");

  const restored = structuredClone(state.articleExtractorPlugins[0].versions[0].manifest);
  restored.extraction.content = ["main.tampered"];
  state.articleExtractorPlugins[0].versions[0].manifest = restored;
  assert.equal(service.resolveForUrl("https://news.example.com/post/1", "team_a"), null);
});
