import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const dist = resolve(root, "apps/web/dist");
const manifest = JSON.parse(await readFile(resolve(dist, ".vite/manifest.json"), "utf8"));
const limits = {
  "index.html": 525_000,
  "src/features/tasks/task-view.tsx": 140_000,
  "src/features/auto-runs/auto-runs-view.tsx": 110_000,
};

async function assetSize(entry) {
  if (!entry?.file) throw new Error("Bundle manifest entry is missing");
  return (await stat(resolve(dist, entry.file))).size;
}

function manifestEntry(key) {
  if (manifest[key]) return manifest[key];
  const expectedName = key.split("/").at(-1)?.replace(/\.[^.]+$/, "");
  return Object.values(manifest).find((entry) =>
    entry?.src === key || (expectedName && entry?.name === expectedName),
  );
}

const failures = [];
for (const [key, limit] of Object.entries(limits)) {
  const size = await assetSize(manifestEntry(key));
  console.log(`${key}: ${(size / 1000).toFixed(1)} kB / ${(limit / 1000).toFixed(0)} kB`);
  if (size > limit) failures.push(`${key} exceeds its budget by ${((size - limit) / 1000).toFixed(1)} kB`);
}

const entry = manifest["index.html"];
const initialKeys = [entry, ...(entry.imports ?? []).map((key) => manifest[key])];
const initialSize = (await Promise.all(initialKeys.map(assetSize))).reduce((sum, size) => sum + size, 0);
const initialLimit = 800_000;
console.log(`initial JS: ${(initialSize / 1000).toFixed(1)} kB / ${(initialLimit / 1000).toFixed(0)} kB`);
if (initialSize > initialLimit) {
  failures.push(`initial JS exceeds its budget by ${((initialSize - initialLimit) / 1000).toFixed(1)} kB`);
}

if (failures.length) {
  console.error(`Bundle budget failed:\n- ${failures.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log("Bundle budget passed.");
}
