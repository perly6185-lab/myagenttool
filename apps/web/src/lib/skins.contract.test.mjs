import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SKINS } from "./skins.ts";

// Kept as .mjs so it can read the CSS files off disk with node:fs (the web
// tsconfig has no node types). It guards the skin token contract from
// docs/design/SKIN_SYSTEM.md against registry/stylesheet drift.

const REQUIRED_TOKENS = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--destructive-foreground",
  "--success",
  "--success-foreground",
  "--warning",
  "--warning-foreground",
  "--border",
  "--input",
  "--ring",
  "--sidebar",
  "--sidebar-foreground",
  "--sidebar-accent",
  "--sidebar-accent-foreground",
  "--sidebar-border",
  "--sidebar-ring",
];

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/** Custom-prop names declared in the first block whose head contains `selector`. */
function tokensInBlock(css, selector) {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`selector not found: ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const body = css.slice(open + 1, close);
  const names = new Set();
  for (const match of body.matchAll(/(--[\w-]+)\s*:/g)) names.add(match[1]);
  return names;
}

function expectComplete(tokens, label) {
  const missing = REQUIRED_TOKENS.filter((token) => !tokens.has(token));
  expect(missing, `${label} is missing tokens`).toEqual([]);
}

describe("skin token contract", () => {
  const mainCss = read("../assets/main.css");

  it("the default skin (main.css) defines every required token, light + dark", () => {
    expectComplete(tokensInBlock(mainCss, ":root {"), "default light (:root)");
    expectComplete(tokensInBlock(mainCss, ".dark {"), "default dark (.dark)");
  });

  it("every non-default skin has a file and defines every token, light + dark", () => {
    for (const skin of SKINS) {
      if (skin.id === "default") continue;
      const css = read(`../assets/skins/${skin.id}.css`);
      expect(css, `${skin.id}.css must scope to its data-skin`).toContain(`data-skin="${skin.id}"`);
      expectComplete(tokensInBlock(css, `:root[data-skin="${skin.id}"]:not(.dark)`), `${skin.id} light`);
      expectComplete(tokensInBlock(css, `:root[data-skin="${skin.id}"].dark`), `${skin.id} dark`);
    }
  });

  it("main.css imports every non-default skin file (no orphaned skin)", () => {
    for (const skin of SKINS) {
      if (skin.id === "default") continue;
      expect(mainCss, `main.css must @import skins/${skin.id}.css`).toContain(`skins/${skin.id}.css`);
    }
  });
});
