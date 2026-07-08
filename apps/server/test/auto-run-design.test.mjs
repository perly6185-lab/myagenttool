import { test } from "node:test";
import assert from "node:assert/strict";
import { composeDesignIssueComment, designArtifactIndex } from "../src/services/auto-run-design.mjs";

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
