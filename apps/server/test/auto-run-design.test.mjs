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

test("Layer B: an image with a hosted URL is embedded inline; one without is only listed", () => {
  const body = composeDesignIssueComment({
    brief: "Brief text",
    artifacts: ["design/home-desktop.png", "design/home-mobile.png", "design/spec.html"],
    imageUrls: { "design/home-desktop.png": "https://raw.githubusercontent.com/o/r/b/design/home-desktop.png" },
  });
  assert.ok(body.includes("### Mockup preview"), "preview section present");
  assert.ok(
    body.includes("![home-desktop.png](https://raw.githubusercontent.com/o/r/b/design/home-desktop.png)"),
    "hosted image embedded by raw URL, prefix stripped from alt",
  );
  assert.ok(body.includes("`design/home-mobile.png`"), "un-hosted image falls back to the index list");
  assert.ok(body.includes("`design/spec.html`"), "html still only listed");
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
