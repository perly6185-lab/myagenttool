import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export function resolveViteBin(webRoot, require) {
  const directBin = join(webRoot, "node_modules", "vite", "bin", "vite.js");
  if (existsSync(directBin)) return directBin;
  return join(dirname(require.resolve("vite/package.json")), "bin", "vite.js");
}
