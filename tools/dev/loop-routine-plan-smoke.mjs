#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const routineFile = "docs/examples/loop-routines/morning-triage.json";

const result = aiJson(["loop-routine-plan", "--file", routineFile, "--json"]);
const plan = result.plan;
if (!plan?.valid) {
  throw new Error(`Routine plan invalid: ${JSON.stringify(plan?.validation)}`);
}
if (plan.routineId !== "morning-triage") {
  throw new Error(`Unexpected routine id: ${plan.routineId}`);
}
if (!plan.inputs.some((input) => input.type === "git.commits" && input.supportedInRun)) {
  throw new Error("Routine plan should include supported git.commits input.");
}
if (!plan.risks.some((risk) => risk.includes("fanout"))) {
  throw new Error(`Routine plan should disclose future fanout risk: ${JSON.stringify(plan.risks)}`);
}

console.log(`[loop-routine-plan-smoke] OK routine=${plan.routineId} inputs=${plan.inputs.length}`);

function aiJson(args) {
  const output = execFileSync("node", ["tools/ai/src/index.mjs", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return JSON.parse(output);
}
