import { chmodSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "../..");
const serverRequire = createRequire(resolve(repoRoot, "apps/server/package.json"));

try {
  const probePath = serverRequire("@ffprobe-installer/ffprobe").path;
  chmodSync(probePath, 0o755);
  console.log(`Prepared project ffprobe: ${probePath}`);
} catch {
  // Unsupported platforms can rely on a system ffprobe from PATH.
}
