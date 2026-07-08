import { test } from "node:test";
import assert from "node:assert/strict";
import { composeDesignIssueComment, designArtifactIndex, githubSlugFromRemote, rawGithubUrl, buildDesignImageUrls } from "../src/services/auto-run-design.mjs";
import { resolveDesignRenderCommand, designRenderTimeoutMs } from "../src/services/design-render.mjs";

test("designArtifactIndex splits html vs images and ignores non-design paths", () => {
  const idx = designArtifactIndex(["design/a.html", "design/b.png", "design/notes.md", "src/App.tsx"]);
  assert.deepEqual(idx.html, ["design/a.html"]);
  assert.deepEqual(idx.images, ["design/b.png"]);
  assert.deepEqual(idx.all, ["design/a.html", "design/b.png", "design/notes.md"]);
});

test("Layer A: brief is primary; html mockups are indexed, never embedded", () => {
  const body = composeDesignIssueComment({
    brief: "## Design\n```\n[ header ]\n```\nComponent tree: App>Header",
    artifacts: ["design/home.html", "design/BRIEF.md"],
  });
  assert.ok(body.startsWith("## Design"), "brief leads");
  assert.ok(body.includes("open in the console's design panel"), "mockups indexed");
  assert.ok(body.includes("`design/home.html`"), "html listed");
  assert.ok(!body.includes("!["), "no image embed without a hosted URL");
});

test("Layer B: a hosted image is embedded even though it is NOT in the pre-render artifacts (the real flow)", () => {
  const body = composeDesignIssueComment({
    brief: "Brief text",
    // artifacts = the PRE-render changed list (html mockup + a raw agent-committed
    // image); the rendered PNG is not here — it only appears after the push.
    artifacts: ["design/spec.html", "design/logo.png"],
    // imageUrls = the POST-render hosted preview, keyed by a file NOT in artifacts.
    imageUrls: { "design/about.png": "https://raw.githubusercontent.com/o/r/b/design/about.png" },
  });
  assert.ok(body.includes("### Mockup preview"), "preview section present");
  assert.ok(
    body.includes("![about.png](https://raw.githubusercontent.com/o/r/b/design/about.png)"),
    "hosted image embedded by raw URL even though it isn't in artifacts (regression: the live run embedded nothing)",
  );
  assert.ok(body.includes("`design/spec.html`"), "html mockup still listed");
  assert.ok(body.includes("`design/logo.png`"), "un-hosted artifact image falls to the index list");
  assert.ok(!body.includes("`design/about.png`"), "the embedded image is not also listed in the index");
});

test("empty brief + no artifacts yields an empty string (nothing posted)", () => {
  assert.equal(composeDesignIssueComment({ brief: "", artifacts: [] }), "");
  assert.equal(composeDesignIssueComment({}), "");
});

test("githubSlugFromRemote parses https/ssh/.git forms; null on non-github", () => {
  assert.equal(githubSlugFromRemote("https://github.com/o/r.git"), "o/r");
  assert.equal(githubSlugFromRemote("https://github.com/o/r"), "o/r");
  assert.equal(githubSlugFromRemote("git@github.com:o/r.git"), "o/r");
  assert.equal(githubSlugFromRemote("ssh://git@github.com/o/r"), "o/r");
  assert.equal(githubSlugFromRemote("https://gitlab.com/o/r.git"), null);
  assert.equal(githubSlugFromRemote(""), null);
});

test("rawGithubUrl encodes path segments; buildDesignImageUrls maps only images", () => {
  assert.equal(
    rawGithubUrl("o/r", "feat/x", "design/a b.png"),
    "https://raw.githubusercontent.com/o/r/feat%2Fx/design/a%20b.png",
  );
  const urls = buildDesignImageUrls({
    remoteUrl: "git@github.com:o/r.git",
    branch: "auto/i-1",
    images: ["design/home.png", "design/spec.html", "src/x.png"],
  });
  assert.deepEqual(Object.keys(urls), ["design/home.png"], "only design/ images");
  assert.equal(urls["design/home.png"], "https://raw.githubusercontent.com/o/r/auto%2Fi-1/design/home.png");
  // Non-GitHub remote → no URLs (private/other host won't inline anyway).
  assert.deepEqual(buildDesignImageUrls({ remoteUrl: "https://gitlab.com/o/r", branch: "b", images: ["design/x.png"] }), {});
});

test("resolveDesignRenderCommand: valid argv only; timeout clamps", () => {
  assert.deepEqual(resolveDesignRenderCommand({ MYAGENTTOOL_AUTORUN_DESIGN_RENDER_COMMAND_JSON: '["node","shot.mjs"]' }), ["node", "shot.mjs"]);
  assert.equal(resolveDesignRenderCommand({ MYAGENTTOOL_AUTORUN_DESIGN_RENDER_COMMAND_JSON: '"notarray"' }), null);
  assert.equal(resolveDesignRenderCommand({}), null);
  assert.equal(designRenderTimeoutMs({}), 120_000);
  assert.equal(designRenderTimeoutMs({ MYAGENTTOOL_AUTORUN_DESIGN_RENDER_TIMEOUT_MS: "5000" }), 5000);
  assert.equal(designRenderTimeoutMs({ MYAGENTTOOL_AUTORUN_DESIGN_RENDER_TIMEOUT_MS: "999" }), 120_000);
});
