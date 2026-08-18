#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const artifactDir = resolve(repoRoot, ".myagenttool/real-scenarios");
const scenarios = [
  {
    id: "development-long-task",
    title: "开发类长任务：同一工作区修改、反馈、重跑和审批",
    acceptance: "代码 Agent 在受治理 worktree 执行，结果可审查，用户反馈后继续同一任务，批准后才允许后续动作",
    command: ["node", "tools/dev/codex-exec-caller-smoke.mjs"],
  },
  {
    id: "governed-code-review",
    title: "开发结果复核：Claude 受治理审查",
    acceptance: "Claude 作为能力服务被调用，审查结果进入统一 Evidence Center，不暴露原始命令参数",
    command: ["node", "tools/dev/claude-tool-smoke.mjs"],
  },
  {
    id: "content-material-review",
    title: "自媒体/文档素材处理：文件发现、预览和结果复核",
    acceptance: "本地文档可发现、预览和创建，UI 不上传或复制源文件，结果可复核",
    command: ["pnpm", "exec", "playwright", "test", "-c", "apps/web/playwright.config.ts", "apps/web/e2e/documents.spec.ts"],
  },
  {
    id: "content-material-delivery",
    title: "自媒体/文档素材结果回传：本地素材与出站媒体",
    acceptance: "本地素材结果保持项目边界，任务完成后可带出站媒体回传到消息通道",
    command: ["node", "--test", "--test-name-pattern=^iLink ordinary-user journey stays", "apps/server/test/channel-user-journey.test.mjs"],
    tests: ["iLink ordinary-user journey stays understandable from intake through delivery"],
  },
  {
    id: "same-task-revision-loop",
    title: "结果不满意：同一任务继续修改并复核",
    acceptance: "用户可以在同一任务中查看结果、提出修改、继续执行并保持历史与审计关联",
    command: ["pnpm", "exec", "playwright", "test", "-c", "apps/web/playwright.config.ts", "apps/web/e2e/workflow-memory-routine.spec.ts"],
  },
];

const startedAt = new Date().toISOString();
const results = [];
for (const scenario of scenarios) {
  const result = await run(scenario.command);
  const observedTests = extractObservedTests(result.output);
  const missingTests = (scenario.tests ?? []).filter((expected) => !observedTests.includes(expected));
  const passed = result.code === 0 && missingTests.length === 0;
  results.push({
    id: scenario.id,
    title: scenario.title,
    acceptance: scenario.acceptance,
    status: passed ? "passed" : "failed",
    command: scenario.command.join(" "),
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    durationMs: result.durationMs,
    ...(scenario.tests ? { tests: scenario.tests, observedTests, missingTests } : {}),
    output: result.output.slice(-8_000),
  });
  console.log(`[p1-real] ${passed ? "PASS" : "FAIL"} ${scenario.id}`);
  if (!passed) break;
}

const report = {
  schemaVersion: 1,
  gate: "P1-real-scenarios",
  startedAt,
  completedAt: new Date().toISOString(),
  status: results.every((item) => item.status === "passed") ? "passed" : "blocked",
  results,
};
await mkdir(artifactDir, { recursive: true });
await writeFile(resolve(artifactDir, "p1-report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
if (report.status === "blocked") process.exitCode = 1;
console.log(`[p1-real] ${report.status}: .myagenttool/real-scenarios/p1-report.json`);

function run(command) {
  return new Promise((resolveResult) => {
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const child = spawn(command[0], command.slice(1), { cwd: repoRoot, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("close", (code, signal) => resolveResult({
      code: code ?? 1,
      signal,
      output,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
    }));
  });
}

function extractObservedTests(output) {
  return [...String(output ?? "").matchAll(/[✔✖]\s(.+?)\s\(\d+(?:\.\d+)?ms\)/g)]
    .map((match) => match[1].trim());
}
