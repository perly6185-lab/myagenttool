#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const contextFile = process.env.MYAGENTTOOL_WORK_CONTEXT;
const evidenceDir = process.env.MYAGENTTOOL_WORK_EVIDENCE_DIR;
const adapter = process.env.MYAGENTTOOL_CODING_ADAPTER ?? "command";

if (!existsSync(resolve(process.cwd(), "package.json")) || !existsSync(resolve(process.cwd(), "tools/ai/src/index.mjs"))) {
  fail("Coding wrapper must run from the MyAgentTool repository root.");
}

if (!contextFile || !existsSync(contextFile)) {
  fail("MYAGENTTOOL_WORK_CONTEXT is required and must point to an existing file.");
}

if (!evidenceDir) {
  fail("MYAGENTTOOL_WORK_EVIDENCE_DIR is required.");
}

mkdirSync(evidenceDir, { recursive: true });

const context = JSON.parse(readFileSync(contextFile, "utf8"));
if (!context.issue || !context.branch || !context.plan) {
  fail("Work context must include issue, branch, and plan.");
}

const result = {
  adapter,
  contractVersion: context.contractVersion ?? "unknown",
  status: "completed",
  summary: "Coding wrapper contract validation completed. No model or shell command was executed.",
  changedFiles: [],
  commandsRun: [],
  risks: ["This wrapper validates the production adapter contract but does not perform edits."],
  completedAt: new Date().toISOString(),
};

writeFileSync(resolve(evidenceDir, "adapter-result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
writeFileSync(resolve(evidenceDir, "stdout.txt"), "Coding wrapper contract validation completed.\n", "utf8");
writeFileSync(resolve(evidenceDir, "stderr.txt"), "", "utf8");

function fail(message) {
  if (evidenceDir) {
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(resolve(evidenceDir, "stderr.txt"), `${message}\n`, "utf8");
  }
  console.error(message);
  process.exit(1);
}
