#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const routineFile = "docs/examples/loop-routines/morning-triage.json";

const result = aiJson(["loop-routine-run", "--file", routineFile, "--dry-run", "--json"]);
if (result.dryRun !== true) {
  throw new Error("Routine dry run should report dryRun=true.");
}
if (result.routineRun !== null) {
  throw new Error("Routine dry run should not create routine-run evidence.");
}
if (!result.plan?.execution?.canRunNow) {
  throw new Error(`Routine dry run should be runnable now: ${JSON.stringify(result.plan?.execution)}`);
}

console.log(`[loop-routine-run-dry-smoke] OK routine=${result.plan.routineId}`);

function aiJson(args) {
  const output = execFileSync("node", ["tools/ai/src/index.mjs", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return JSON.parse(output);
}
