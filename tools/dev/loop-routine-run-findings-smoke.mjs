#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const tmpRoot = resolve(repoRoot, ".myagenttool/tmp/loop-routine-run-findings-smoke");
const routineFile = "docs/examples/loop-routines/morning-triage.json";
const fakeGhPath = resolve(tmpRoot, "fake-gh-empty.mjs");

rmSync(tmpRoot, { recursive: true, force: true });
mkdirSync(resolve(tmpRoot, ".myagenttool/runs"), { recursive: true });
mkdirSync(resolve(tmpRoot, "docs/engineering"), { recursive: true });
execFileSync("git", ["init"], { cwd: tmpRoot, stdio: ["ignore", "ignore", "pipe"] });
writeFileSync(resolve(tmpRoot, "docs/engineering/example.md"), "# Example\n", "utf8");
execFileSync("git", ["add", "docs/engineering/example.md"], { cwd: tmpRoot, stdio: ["ignore", "ignore", "pipe"] });
execFileSync("git", ["commit", "-m", "seed"], {
  cwd: tmpRoot,
  env: {
    ...process.env,
    GIT_AUTHOR_NAME: "Loop Smoke",
    GIT_AUTHOR_EMAIL: "loop-smoke@example.test",
    GIT_COMMITTER_NAME: "Loop Smoke",
    GIT_COMMITTER_EMAIL: "loop-smoke@example.test",
  },
  stdio: ["ignore", "ignore", "pipe"],
});
const failedRunId = "routine-smoke-issue-123";
const failedRunDir = resolve(tmpRoot, ".myagenttool/runs", failedRunId);
mkdirSync(failedRunDir, { recursive: true });
writeFileSync(resolve(failedRunDir, "events.jsonl"), [
  JSON.stringify({
    id: "routine-smoke-created",
    runId: failedRunId,
    type: "loop_run_created",
    state: "created",
    createdAt: "2026-06-29T00:00:00.000Z",
    message: "Loop run registered.",
    data: {
      adapter: "mock",
      apply: false,
      verify: false,
      openPr: false,
      repo: null,
      branch: "feat/routine-smoke",
    },
  }),
  JSON.stringify({
    id: "routine-smoke-failed",
    runId: failedRunId,
    type: "loop_failed",
    state: "failed",
    createdAt: "2026-06-29T00:00:01.000Z",
    message: "Routine smoke failure",
    data: {
      error: "Routine smoke failure",
    },
  }),
].join("\n") + "\n", "utf8");
writeFileSync(resolve(tmpRoot, ".myagenttool/runs/registry.json"), `${JSON.stringify({
  version: 1,
  runs: [
    {
      runId: failedRunId,
      state: "failed",
      issue: "123",
      repo: null,
      branch: "feat/routine-smoke",
      adapter: "mock",
      runDir: `.myagenttool/runs/${failedRunId}`,
      eventLog: `.myagenttool/runs/${failedRunId}/events.jsonl`,
      createdAt: "2026-06-29T00:00:00.000Z",
      updatedAt: "2026-06-29T00:00:00.000Z",
      humanApproval: null,
      workerId: null,
      heartbeatAt: null,
      leaseExpiresAt: null,
      timeoutAt: null,
      queuePriority: null,
      evidence: {},
      lastError: "Routine smoke failure",
    },
  ],
}, null, 2)}\n`, "utf8");
writeFileSync(fakeGhPath, "process.stdout.write('[]');\n", "utf8");

const result = aiJson(["loop-routine-run", "--file", resolve(repoRoot, routineFile), "--json"], tmpRoot);
if (result.routineRun?.status !== "completed") {
  throw new Error(`Routine run should complete: ${JSON.stringify(result.routineRun)}`);
}
if (!result.routineRun?.checksResult || !existsSync(resolve(tmpRoot, result.routineRun.checksResult))) {
  throw new Error("Routine run should write checks-result.json.");
}
if (!result.routineRun?.skillSnapshot || !existsSync(resolve(tmpRoot, result.routineRun.skillSnapshot))) {
  throw new Error("Routine run should write skill-snapshot.json.");
}
const skillSnapshot = JSON.parse(readFileSync(resolve(tmpRoot, result.routineRun.skillSnapshot), "utf8"));
if (!skillSnapshot.skills.some((skill) => skill.id === "triage" && skill.status === "found" && skill.acceptance.length > 0)) {
  throw new Error(`Routine skill snapshot should bind triage skill: ${JSON.stringify(skillSnapshot)}`);
}
const findings = JSON.parse(readFileSync(resolve(tmpRoot, result.routineRun.findings), "utf8"));
if (!findings.some((finding) => finding.source?.type === "loop.registry" && finding.source?.runId === failedRunId)) {
  throw new Error(`Routine findings should include failed loop run: ${JSON.stringify(findings)}`);
}
if (!findings.some((finding) => finding.skillBindings?.some((skill) => skill.id === "triage"))) {
  throw new Error(`Routine findings should include triage skill binding: ${JSON.stringify(findings)}`);
}

console.log(`[loop-routine-run-findings-smoke] OK routine=${result.routineRun.routineId} findings=${findings.length}`);

function aiJson(args, cwd) {
  const output = execFileSync("node", [resolve(repoRoot, "tools/ai/src/index.mjs"), ...args], {
    cwd,
    env: {
      ...process.env,
      GH_PATH: fakeGhPath,
      MYAGENTTOOL_REPO_ROOT: cwd,
    },
    encoding: "utf8",
  });
  return JSON.parse(output);
}
