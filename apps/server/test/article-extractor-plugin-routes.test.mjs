import assert from "node:assert/strict";
import test from "node:test";

import { handleArticleExtractorPluginRoutes } from "../src/routes/article-extractor-plugins.mjs";

function routeHarness({ method, pathname, body = {} }) {
  let response = null;
  const calls = [];
  const dependencies = {
    req: { method },
    res: {},
    url: new URL(`http://localhost${pathname}`),
    sendJson: (_res, status, payload) => { response = { status, payload }; },
    readJson: async () => body,
    actor: { userId: "usr_1", teamId: "team_1" },
    listPlugins: (_input, actor) => { calls.push(["list", actor]); return { status: 200, body: { plugins: [] } }; },
    planInstall: (input, actor) => { calls.push(["plan", input, actor]); return { status: 200, body: { approval: {} } }; },
    installPlugin: async (input, actor) => { calls.push(["install", input, actor]); return { status: 201, body: { plugin: {} } }; },
    disablePlugin: (input, actor) => { calls.push(["disable", input, actor]); return { status: 200, body: { plugin: {} } }; },
    activatePlugin: (input, actor) => { calls.push(["activate", input, actor]); return { status: 200, body: { plugin: {} } }; },
  };
  return { calls, dependencies, response: () => response };
}

test("article extractor routes preserve decoded ids, bodies, actors, and service statuses", async () => {
  const install = routeHarness({ method: "POST", pathname: "/api/article-extractor-plugins", body: { manifest: { id: "demo" }, approvalToken: "grant" } });
  assert.equal(await handleArticleExtractorPluginRoutes(install.dependencies), true);
  assert.deepEqual(install.calls[0].slice(0, 2), ["install", { manifest: { id: "demo" }, approvalToken: "grant" }]);
  assert.equal(install.response().status, 201);

  const activate = routeHarness({ method: "POST", pathname: "/api/article-extractor-plugins/site.example/versions/1.0.0/activate", body: { approvalToken: "grant" } });
  assert.equal(await handleArticleExtractorPluginRoutes(activate.dependencies), true);
  assert.deepEqual(activate.calls[0][1], { approvalToken: "grant", pluginId: "site.example", version: "1.0.0" });

  const unrelated = routeHarness({ method: "GET", pathname: "/api/other" });
  assert.equal(await handleArticleExtractorPluginRoutes(unrelated.dependencies), false);
  assert.equal(unrelated.response(), null);
});
