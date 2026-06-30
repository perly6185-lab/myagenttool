#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const tmpRoot = resolve(repoRoot, ".myagenttool/tmp/loop-routine-github-inputs-smoke");
const routineFile = "docs/examples/loop-routines/morning-triage.json";
const fakeGhPath = resolve(tmpRoot, "fake-gh.mjs");

rmSync(tmpRoot, { recursive: true, force: true });
mkdirSync(resolve(tmpRoot, "docs/engineering"), { recursive: true });
mkdirSync(resolve(tmpRoot, ".myagenttool/runs"), { recursive: true });
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
writeFileSync(resolve(tmpRoot, ".myagenttool/runs/registry.json"), `${JSON.stringify({ version: 1, runs: [] }, null, 2)}\n`, "utf8");
writeFakeGh(fakeGhPath);

const result = aiJson(["loop-routine-run", "--file", resolve(repoRoot, routineFile), "--json"], tmpRoot);
const snapshot = JSON.parse(readFileSync(resolve(tmpRoot, result.routineRun.inputSnapshot), "utf8"));
for (const type of ["github.issues", "github.prs", "github.checks", "github.commits"]) {
  const input = snapshot.inputs.find((item) => item.type === type);
  if (!input || input.status !== "ok" || input.items.length === 0) {
    throw new Error(`Expected collected ${type} input: ${JSON.stringify(input)}`);
  }
}
const findings = JSON.parse(readFileSync(resolve(tmpRoot, result.routineRun.findings), "utf8"));
for (const sourceType of ["github.issues", "github.prs", "github.checks"]) {
  if (!findings.some((finding) => finding.source?.type === sourceType)) {
    throw new Error(`Expected ${sourceType} finding: ${JSON.stringify(findings)}`);
  }
}

console.log(`[loop-routine-github-inputs-smoke] OK findings=${findings.length}`);

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

function writeFakeGh(path) {
  writeFileSync(path, `
const args = process.argv.slice(2);
const out = (value) => process.stdout.write(JSON.stringify(value));
if (args[0] === "issue" && args[1] === "list") {
  out([{ number: 7, title: "Unowned smoke issue", state: "OPEN", labels: [], assignees: [], milestone: null, updatedAt: "2026-06-29T00:00:00Z", url: "https://example.test/issues/7" }]);
} else if (args[0] === "pr" && args[1] === "list") {
  out([{ number: 8, title: "Review smoke PR", state: "OPEN", isDraft: false, headRefName: "feat/smoke", baseRefName: "main", reviewDecision: "REVIEW_REQUIRED", updatedAt: "2026-06-29T00:00:00Z", url: "https://example.test/pull/8" }]);
} else if (args[0] === "run" && args[1] === "list") {
  out([{ databaseId: 9, displayTitle: "CI smoke", headBranch: "main", headSha: "abc123", status: "completed", conclusion: "failure", createdAt: "2026-06-29T00:00:00Z", updatedAt: "2026-06-29T00:01:00Z", url: "https://example.test/actions/runs/9" }]);
} else if (args[0] === "api" && String(args[1] ?? "").startsWith("repos/")) {
  out([{ sha: "abcdef123456", commit: { message: "Smoke commit", author: { name: "Smoke", date: "2026-06-29T00:00:00Z" }, committer: { date: "2026-06-29T00:00:00Z" } }, html_url: "https://example.test/commit/abcdef" }]);
} else {
  console.error("unexpected fake gh args " + JSON.stringify(args));
  process.exit(1);
}
`, "utf8");
}
