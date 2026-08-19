#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const artifactDir = resolve(repoRoot, ".myagenttool/real-scenarios");

// P0 deliberately maps ordinary business language to existing governed
// journeys. The runner is an acceptance index, not a second implementation of
// file parsing or ledger mutation rules.
const scenarios = [
  {
    id: "quotation-follow-up",
    title: "客户报价跟踪",
    acceptance: "读取本地业务文件，预览单条变更，用户确认后写回并留下审计记录",
    command: ["node", "--test", "--test-name-pattern=^P0 real quotation follow-up uses", "apps/server/test/p0-real-business-scenarios.test.mjs"],
    tests: ["P0 real quotation follow-up uses a quotation ledger and reports a safe business preview"],
  },
  {
    id: "shipping-exception",
    title: "订单发货异常",
    acceptance: "关联订单与客户文件，生成一个多文件批次预览，确认后写回多条记录",
    command: ["node", "--test", "--test-name-pattern=^P0 real shipping exception scopes", "apps/server/test/p0-real-business-scenarios.test.mjs"],
    tests: ["P0 real shipping exception scopes order and shipment changes into one batch"],
  },
  {
    id: "payment-reconciliation",
    title: "汇款对账（只读核对）",
    acceptance: "从 Channel 自然语言触发本地应收与银行流水核对，返回可解释差异，不修改原始文件",
    command: ["node", "--test", "--test-name-pattern=^P0 real payment reconciliation", "apps/server/test/p0-real-business-scenarios.test.mjs"],
    tests: [
      "P0 real payment reconciliation returns an explainable read-only difference report",
      "P0 real payment reconciliation is returned from a natural Channel request without file writeback",
    ],
  },
  {
    id: "quote-to-closure-lifecycle",
    title: "报价到回款、售后、完结全流程",
    acceptance: "在不同时间节点从报价跟进推进到订单、发货、延迟回款对账、售后处理和完结；支持多文件写回、审计和版本漂移保护",
    command: ["node", "--test", "--test-name-pattern=^P0 lifecycle", "apps/server/test/p0-real-business-scenarios.test.mjs"],
    tests: [
      "P0 lifecycle scenario follows one customer from quotation through payment, after-sales, and closure across time",
      "P0 lifecycle rejects stale confirmation and resumes after the latest local file snapshot is imported",
    ],
  },
  {
    id: "ilink-user-loop",
    title: "微信普通用户多轮操作",
    acceptance: "文本/图片/语音/文件进入同一任务，用户补充、确认、等待并收到结果",
    command: ["node", "--test", "--test-name-pattern=iLink|composed iLink", "apps/server/test/channel-user-journey.test.mjs", "apps/server/test/integration/ilink-composed-journey.test.mjs"],
    tests: [
      "iLink ordinary-user journey stays understandable from intake through delivery",
      "iLink ordinary-user journey keeps image, voice, and file inputs in one task",
      "iLink high-risk task pauses before execution and resumes from the same channel confirmation",
      "iLink high-risk task cancellation clears the pending route",
      "iLink high-risk preview is invalidated when the user changes the request",
      "iLink multi-task results stay correlated when tasks complete out of order",
      "iLink failed task can be retried and its retry result is delivered once",
      "iLink restart recovery reconciles completed work and requeues unfinished tasks together",
      "composed iLink journey: poll → import → channel reply queue → provider send",
    ],
  },
];

const startedAt = new Date().toISOString();
const results = [];

for (const scenario of scenarios) {
  const result = await run(scenario.command);
  const observedTests = extractObservedTests(result.output);
  const missingTests = scenario.tests.filter((expected) => !observedTests.includes(expected));
  const passed = result.code === 0 && missingTests.length === 0;
  results.push({
    id: scenario.id,
    title: scenario.title,
    acceptance: scenario.acceptance,
    status: passed ? "passed" : "failed",
    tests: scenario.tests,
    observedTests,
    missingTests,
    limitation: scenario.limitation ?? null,
    command: scenario.command.join(" "),
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    durationMs: result.durationMs,
    output: result.output.slice(-8_000),
  });
  console.log(`[p0-real] ${passed ? "PASS" : "FAIL"} ${scenario.id}`);
  if (!passed) break;
}

const report = {
  schemaVersion: 1,
  gate: "P0-real-scenarios",
  startedAt,
  completedAt: new Date().toISOString(),
  status: results.every((item) => item.status === "passed")
    ? (results.some((item) => item.limitation) ? "passed_with_known_limitations" : "passed")
    : "blocked",
  results,
};
await mkdir(artifactDir, { recursive: true });
await writeFile(resolve(artifactDir, "p0-report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });

if (report.status === "blocked") process.exitCode = 1;
console.log(`[p0-real] ${report.status}: .myagenttool/real-scenarios/p0-report.json`);

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
