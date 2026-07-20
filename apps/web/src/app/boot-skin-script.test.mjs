import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_MODE, DEFAULT_SKIN } from "../lib/skins.ts";
import { UI_STORE_PERSIST_KEY } from "../store/ui-store.ts";

// The no-flash boot script in index.html duplicates the persist key and the
// skin/mode defaults (it must paint before any module loads). Kept as .mjs so it
// can read index.html off disk. Pins the duplication so a change to the key or
// the defaults that forgets the boot script fails loudly instead of silently
// reintroducing the startup flash (#1360).

// vitest runs with the package root (apps/web) as cwd, where index.html lives.
const html = readFileSync(join(process.cwd(), "index.html"), "utf8");

describe("index.html no-flash boot script", () => {
  it("reads the same localStorage key as the persisted store", () => {
    expect(html).toContain(`localStorage.getItem("${UI_STORE_PERSIST_KEY}")`);
  });

  it("falls back to the store's default skin and mode", () => {
    expect(html).toContain(`|| "${DEFAULT_SKIN}"`);
    expect(html).toContain(`|| "${DEFAULT_MODE}"`);
  });
});
