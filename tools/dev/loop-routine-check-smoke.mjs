#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const routineFile = "docs/examples/loop-routines/morning-triage.json";

const result = aiJson(["loop-routine-check", "--file", routineFile, "--json"]);
if (!result.validation?.ok) {
  throw new Error(`Routine check failed: ${JSON.stringify(result.validation)}`);
}
if (result.routine?.metadata?.id !== "morning-triage") {
  throw new Error(`Unexpected routine id: ${result.routine?.metadata?.id}`);
}

console.log(`[loop-routine-check-smoke] OK routine=${result.routine.metadata.id}`);

function aiJson(args) {
  const output = execFileSync("node", ["tools/ai/src/index.mjs", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return JSON.parse(output);
}
