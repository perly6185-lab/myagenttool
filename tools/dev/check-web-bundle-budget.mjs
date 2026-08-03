import { appendFile, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import {
  ENTRY_BUNDLE_LIMITS,
  INITIAL_JS_HARD_LIMIT_BYTES,
  calculateInitialJsSize,
  evaluateInitialJsBudget,
  formatKilobytes,
  githubActionsWarning,
  githubStepSummary,
  initialJsFailureMessage,
  initialJsWarningMessage,
} from "./src/web-bundle-budget.mjs";

const root = resolve(import.meta.dirname, "../..");
const dist = resolve(root, "apps/web/dist");
const manifest = JSON.parse(await readFile(resolve(dist, ".vite/manifest.json"), "utf8"));
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
for (const [key, limit] of Object.entries(ENTRY_BUNDLE_LIMITS)) {
  const size = await assetSize(manifestEntry(key));
  console.log(`${key}: ${formatKilobytes(size)} / ${(limit / 1000).toFixed(0)} kB`);
  if (size > limit) failures.push(`${key} exceeds its budget by ${formatKilobytes(size - limit)}`);
}

const initialSize = await calculateInitialJsSize(manifest, assetSize);
const initialBudget = evaluateInitialJsBudget(initialSize);
console.log(`initial JS: ${formatKilobytes(initialSize)} / ${(INITIAL_JS_HARD_LIMIT_BYTES / 1000).toFixed(0)} kB`);
const initialFailure = initialJsFailureMessage(initialBudget);
if (initialFailure) {
  failures.push(initialFailure);
} else {
  const warning = initialJsWarningMessage(initialBudget);
  if (warning) {
    console.warn(`Bundle budget warning:\n- ${warning}`);
    if (process.env.GITHUB_ACTIONS === "true") console.log(githubActionsWarning(warning));
    if (process.env.GITHUB_STEP_SUMMARY) {
      try {
        await appendFile(process.env.GITHUB_STEP_SUMMARY, githubStepSummary(warning), "utf8");
      } catch (error) {
        console.warn(`Unable to append the Web bundle warning to GITHUB_STEP_SUMMARY: ${error instanceof Error ? error.message : error}`);
      }
    }
  }
}

if (failures.length) {
  console.error(`Bundle budget failed:\n- ${failures.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log("Bundle budget passed.");
}
