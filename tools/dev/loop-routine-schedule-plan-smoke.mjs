#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const tmpRoot = resolve(repoRoot, ".myagenttool/tmp/loop-routine-schedule-plan-smoke");
const fakeGhPath = resolve(tmpRoot, "fake-gh-empty.mjs");

prepareTmpRepo();
const result = aiJson(["loop-routine-schedule-plan", "--no-examples", "--json"], tmpRoot);
if (result.routineCount !== 1 || result.dueCount !== 1) {
  throw new Error(`Schedule plan should find one due routine: ${JSON.stringify(result)}`);
}
const routine = result.routines[0];
if (routine.routineId !== "smoke-triage" || routine.reason !== "due") {
  throw new Error(`Unexpected schedule routine decision: ${JSON.stringify(routine)}`);
}
if (!existsSync(resolve(tmpRoot, ".myagenttool/state/routine-schedule-plan.json"))) {
  throw new Error("Schedule plan should write .myagenttool/state/routine-schedule-plan.json.");
}

console.log(`[loop-routine-schedule-plan-smoke] OK routines=${result.routineCount} due=${result.dueCount}`);

function prepareTmpRepo() {
  rmSync(tmpRoot, { recursive: true, force: true });
  mkdirSync(resolve(tmpRoot, ".myagenttool/routines"), { recursive: true });
  mkdirSync(resolve(tmpRoot, "skills/morning-triage"), { recursive: true });
  mkdirSync(resolve(tmpRoot, "docs/engineering"), { recursive: true });
  execFileSync("git", ["init"], { cwd: tmpRoot, stdio: ["ignore", "ignore", "pipe"] });
  writeFileSync(resolve(tmpRoot, ".gitignore"), ".myagenttool/state/\n.myagenttool/routine-runs/\n.myagenttool/runs/\n", "utf8");
  writeFileSync(resolve(tmpRoot, "docs/engineering/example.md"), "# Example\n", "utf8");
  writeFileSync(resolve(tmpRoot, "skills/morning-triage/SKILL.md"), readFileSync(resolve(repoRoot, "skills/morning-triage/SKILL.md"), "utf8"), "utf8");
  writeFileSync(resolve(tmpRoot, ".myagenttool/routines/smoke-triage.json"), routineJson(), "utf8");
  execFileSync("git", ["add", ".gitignore", "docs/engineering/example.md", "skills/morning-triage/SKILL.md"], { cwd: tmpRoot, stdio: ["ignore", "ignore", "pipe"] });
  execFileSync("git", ["commit", "-m", "seed"], {
    cwd: tmpRoot,
    env: gitEnv(),
    stdio: ["ignore", "ignore", "pipe"],
  });
  mkdirSync(resolve(tmpRoot, ".myagenttool/runs"), { recursive: true });
  writeFileSync(resolve(tmpRoot, ".myagenttool/runs/registry.json"), `${JSON.stringify({ version: 1, runs: [] }, null, 2)}\n`, "utf8");
  writeFileSync(fakeGhPath, "process.stdout.write('[]');\n", "utf8");
}

function routineJson() {
  const source = JSON.parse(readFileSync(resolve(repoRoot, "docs/examples/loop-routines/morning-triage.json"), "utf8"));
  source.metadata.id = "smoke-triage";
  source.metadata.name = "Smoke Triage";
  source.schedule.cooldownMs = 60000;
  source.inputs = source.inputs.filter((input) => !String(input.type).startsWith("github."));
  source.outputs.summary = ".myagenttool/state/smoke-triage.md";
  source.outputs.findings = ".myagenttool/state/smoke-triage-findings.json";
  return `${JSON.stringify(source, null, 2)}\n`;
}

function aiJson(args, cwd) {
  const output = execFileSync("node", [resolve(repoRoot, "tools/ai/src/index.mjs"), ...args], {
    cwd,
    env: { ...process.env, GH_PATH: fakeGhPath, MYAGENTTOOL_REPO_ROOT: cwd },
    encoding: "utf8",
  });
  return JSON.parse(output);
}

function gitEnv() {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: "Loop Smoke",
    GIT_AUTHOR_EMAIL: "loop-smoke@example.test",
    GIT_COMMITTER_NAME: "Loop Smoke",
    GIT_COMMITTER_EMAIL: "loop-smoke@example.test",
  };
}
