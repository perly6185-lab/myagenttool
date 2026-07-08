// Compose the GitHub issue comment for a design run.
//
// The text brief (design/BRIEF.md, which the strengthened design role must fill
// with an ASCII wireframe + component hierarchy) is the PRIMARY, issue-visible
// deliverable — a GitHub comment renders it as-is, no hosting needed.
//
// Below the brief we index the richer artifacts so a human knows a visual mockup
// exists and where to open it (the console's design panel). GitHub comments only
// render IMAGES (`![](url)`), never a local/worktree HTML file, so an HTML mockup
// is always listed, never embedded. When Layer B has rasterized a mockup to a PNG
// and pushed it to a branch, we embed that image inline by its raw URL — the only
// way a rendered preview actually appears on the issue.

const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const HTML_RE = /\.html?$/i;

/** Split a design run's changed files into html mockups vs image previews. */
export function designArtifactIndex(artifacts) {
  const files = (Array.isArray(artifacts) ? artifacts : [])
    .map((p) => String(p))
    .filter((p) => p.startsWith("design/"));
  return {
    html: files.filter((p) => HTML_RE.test(p)),
    images: files.filter((p) => IMAGE_RE.test(p)),
    all: files,
  };
}

/**
 * Build the issue comment body for a design run.
 * @param {{ brief?: string, artifacts?: string[], imageUrls?: Record<string,string> }} opts
 *   - brief: the text brief (design/BRIEF.md or the run summary) — the primary content.
 *   - artifacts: the design/ files the run produced.
 *   - imageUrls: filename → raw image URL, for previews pushed to GitHub (Layer B).
 */
export function composeDesignIssueComment({ brief, artifacts, imageUrls } = {}) {
  const body = String(brief ?? "").trim();
  const { html, images } = designArtifactIndex(artifacts);
  const urls = imageUrls && typeof imageUrls === "object" ? imageUrls : {};

  const parts = body ? [body] : [];

  // Inline pixel previews (Layer B): only images we have a real hosted URL for.
  const embedded = images.filter((p) => typeof urls[p] === "string" && urls[p]);
  if (embedded.length) {
    parts.push(
      ["", "---", "", "### Mockup preview", ...embedded.map((p) => `![${stripPrefix(p)}](${urls[p]})`)].join("\n"),
    );
  }

  // Index the rest so the reader knows the richer artifact exists + where to open
  // it: HTML mockups (never embeddable) and any images we couldn't host.
  const indexed = [...html, ...images.filter((p) => !(typeof urls[p] === "string" && urls[p]))];
  if (indexed.length) {
    parts.push(
      ["", "---", "", "Design mockups produced (open in the console's design panel):", ...indexed.map((p) => `- \`${p}\``)].join("\n"),
    );
  }

  return parts.join("\n");
}

function stripPrefix(path) {
  return path.replace(/^design\//, "");
}
