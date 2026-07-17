import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveViteBin } from "./vite-bin.mjs";

const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("resolveViteBin", () => {
  it("prefers an app-local Vite binary", () => {
    const webRoot = makeTemporaryRoot();
    const directBin = join(webRoot, "node_modules", "vite", "bin", "vite.js");
    mkdirSync(join(webRoot, "node_modules", "vite", "bin"), { recursive: true });
    writeFileSync(directBin, "");

    const require = {
      resolve() {
        throw new Error("package fallback should not be used");
      },
    };

    expect(resolveViteBin(webRoot, require)).toBe(directBin);
  });

  it("resolves from the package root when Vite is hoisted", () => {
    const webRoot = makeTemporaryRoot();
    const packageJson = join(webRoot, "hoisted", "vite", "package.json");
    const require = {
      resolve(specifier) {
        expect(specifier).toBe("vite/package.json");
        return packageJson;
      },
    };

    expect(resolveViteBin(webRoot, require)).toBe(join(webRoot, "hoisted", "vite", "bin", "vite.js"));
  });
});

function makeTemporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), "myagenttool-vite-bin-"));
  temporaryRoots.push(root);
  return root;
}
