import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron } from "playwright";

import { createPersistenceRuntime } from "../../apps/server/src/runtime/persistence.mjs";
import { createServerState } from "../../apps/server/src/runtime/state-factory.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const require = createRequire(import.meta.url);
const electronExecutable = require("electron");
const evidenceRoot = join(repoRoot, ".myagenttool", "evidence", "channel-desktop-recovery");
const temporaryRoot = mkdtempSync(join(tmpdir(), "myagenttool-channel-desktop-recovery-"));
const userDataRoot = join(temporaryRoot, "user-data");
const projectRoot = join(temporaryRoot, "project");
const statePath = join(userDataRoot, "state", "local-demo-state.json");
const NOW = "2026-08-31T06:30:00.000Z";
const OWNER_TEAM = "team_local";
const PROJECT_ID = "prj_myagenttool";

mkdirSync(evidenceRoot, { recursive: true });
mkdirSync(projectRoot, { recursive: true });
mkdirSync(dirname(statePath), { recursive: true });

let desktop = null;

try {
  seedRepository();
  seedDesktopState();
  desktop = await launchDesktop();
  const firstWindow = await desktop.firstWindow();
  await openChannel(firstWindow);

  const before = await readEvidence(firstWindow);
  process.stdout.write(`[channel-desktop] before actions: ${JSON.stringify(before.tasks)}\n`);
  await runAiRepair(firstWindow);
  await runVerification(firstWindow);
  await runRedelivery(firstWindow);
  const after = await readEvidence(firstWindow);
  await firstWindow.screenshot({ path: join(evidenceRoot, "after-actions.png"), fullPage: true });

  await desktop.close();
  desktop = null;

  desktop = await launchDesktop();
  const restoredWindow = await desktop.firstWindow();
  await openChannel(restoredWindow);
  const restored = await readEvidence(restoredWindow);
  assertPersistedReceipts(restored);
  await restoredWindow.screenshot({ path: join(evidenceRoot, "after-restart.png"), fullPage: true });

  const report = buildReport({ before, after, restored });
  writeFileSync(join(evidenceRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  if (desktop) await desktop.close().catch(() => {});
  rmSync(temporaryRoot, { recursive: true, force: true });
}

function seedRepository() {
  mkdirSync(join(projectRoot, "test"), { recursive: true });
  writeFileSync(join(projectRoot, "report.md"), "# Channel recovery fixture\n\nThe governed result remains local.\n");
  writeFileSync(join(projectRoot, "test", "verify.test.mjs"), [
    "import assert from \"node:assert/strict\";",
    "import test from \"node:test\";",
    "test(\"the recovered report remains available\", () => {",
    "  assert.equal(1, 1);",
    "});",
    "",
  ].join("\n"));
  execFileSync("git", ["init", "-b", "main", projectRoot], { stdio: "ignore" });
  execFileSync("git", ["-C", projectRoot, "config", "user.email", "channel-e2e@example.test"]);
  execFileSync("git", ["-C", projectRoot, "config", "user.name", "Channel Desktop E2E"]);
  execFileSync("git", ["-C", projectRoot, "add", "."]);
  execFileSync("git", ["-C", projectRoot, "commit", "-m", "seed channel recovery fixture"], { stdio: "ignore" });
}

function failedVerification(summary) {
  return {
    status: "failed",
    summary,
    checks: [{ kind: "report", status: "failed", summary }],
    verificationChecks: [],
    repair: {
      required: true,
      mode: "independent_task",
      reasons: [summary],
      suggestedRequest: `请修复：${summary}`,
    },
  };
}

function seedDesktopState() {
  const { state, defaultProject } = createServerState({ defaultProjectPath: projectRoot, now: () => NOW });
  defaultProject.defaultAgentId = "agt_codex_cli";
  defaultProject.autoExecutionEnabled = true;
  defaultProject.verifyCommandName = "channel-client-e2e";
  defaultProject.path = projectRoot;
  defaultProject.git = { repoPath: projectRoot, remoteUrl: null, defaultBranch: "main", currentBranch: "main" };
  const codex = state.agents.find((agent) => agent.id === "agt_codex_cli");
  codex.status = "available";
  codex.health = { status: "healthy", checkedAt: NOW, message: "Desktop recovery fixture ready." };

  state.channels.push({
    id: "chn_recovery",
    provider: "wechat_ilink",
    name: "真实客户端恢复验收",
    ownerTeamId: OWNER_TEAM,
    status: "enabled",
    operationMode: "personal",
    allowSelfApprove: true,
    taskProjectId: PROJECT_ID,
    taskTerminalId: state.device.id,
    taskAutoRoute: true,
    capabilityAllowlist: [],
    readiness: { account: true, session: true, worker: true },
    createdAt: NOW,
    updatedAt: NOW,
  });
  state.channelConversations.push({
    id: "conv_recovery",
    channelId: "chn_recovery",
    externalUserId: "wx_recovery_e2e",
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
  });

  const scenarios = [
    {
      key: "fix",
      title: "AI 返工任务",
      status: "blocked",
      threadStatus: "needs_attention",
      verification: failedVerification("报告缺少签字确认页"),
    },
    {
      key: "verify",
      title: "补跑验证任务",
      status: "blocked",
      threadStatus: "needs_attention",
      verification: failedVerification("上次验证命令未成功完成"),
    },
    {
      key: "delivery",
      title: "重发结果任务",
      status: "done",
      threadStatus: "succeeded",
      verification: {
        status: "passed",
        summary: "结果检查已通过",
        checks: [{ kind: "report", status: "passed", summary: "报告文件可读取" }],
        verificationChecks: [],
        repair: null,
      },
    },
  ];

  for (const [index, scenario] of scenarios.entries()) {
    const workItemId = `lwi_channel_${scenario.key}`;
    const autoRunId = `aur_channel_${scenario.key}`;
    const invocationId = `inv_channel_${scenario.key}`;
    const worktreeId = `wtr_channel_${scenario.key}`;
    const threadId = `cth_channel_${scenario.key}`;
    state.worktrees.push({
      id: worktreeId,
      projectId: PROJECT_ID,
      path: projectRoot,
      branchName: "main",
      status: "active",
      agentId: codex.id,
      createdAt: NOW,
      updatedAt: NOW,
    });
    state.workItems.push({
      id: workItemId,
      localRef: `LOCAL-CHANNEL-${index + 1}`,
      ownerTeamId: OWNER_TEAM,
      projectId: PROJECT_ID,
      title: scenario.title,
      body: `${scenario.title}，用于真实桌面客户端恢复验收。`,
      status: scenario.status === "done" ? "done" : "blocked",
      state: scenario.status === "done" ? "closed" : "active",
      waitingOn: scenario.status === "done" ? "none" : "system",
      revision: 1,
      channelOrigin: { channelId: "chn_recovery", threadId, conversationId: "conv_recovery" },
      executionBindings: [{ kind: "auto_run", targetId: autoRunId }],
      resultVerificationContract: { checks: [] },
      resultVerification: scenario.verification,
      outputAssets: [{ id: `asset_${scenario.key}`, path: "report.md", family: "markdown", size: 64 }],
      createdAt: NOW,
      updatedAt: NOW,
    });
    state.autoRuns.push({
      id: autoRunId,
      localIssueId: workItemId,
      executionChainId: workItemId,
      teamId: OWNER_TEAM,
      projectId: PROJECT_ID,
      terminalId: state.device.id,
      agentId: codex.id,
      invocationId,
      worktreeId,
      status: scenario.status,
      error: scenario.status === "blocked" ? scenario.verification.summary : null,
      link: { type: "local_issue", number: index + 1, title: scenario.title, url: null, state: "open" },
      issueBody: `${scenario.title}，只处理本次验收范围。`,
      decision: { path: "develop", workKind: "development", confidence: 1, rationale: "Deterministic desktop recovery fixture." },
      verification: scenario.status === "blocked"
        ? { passed: false, verified: true, summary: scenario.verification.summary }
        : { passed: true, verified: true, summary: "Result verified." },
      executionActionReceipts: [],
      createdAt: NOW,
      updatedAt: NOW,
    });
    state.invocations.push({
      id: invocationId,
      agentId: codex.id,
      requestedBy: "usr_local",
      status: scenario.status === "done" ? "succeeded" : "failed",
      worktreeId,
      options: { metadata: { autoRunId, worktreeId, projectId: PROJECT_ID } },
      result: scenario.status === "done"
        ? { summary: "结果已生成" }
        : { error: scenario.verification.summary, errorCode: "verification_failed" },
      createdAt: NOW,
      updatedAt: NOW,
    });
    state.channelTaskThreads.push({
      id: threadId,
      channelId: "chn_recovery",
      conversationId: "conv_recovery",
      sourceEventIds: [],
      messages: [],
      summary: scenario.title,
      status: scenario.threadStatus,
      workItemId,
      autoRunId,
      nextAction: scenario.key === "delivery" ? "重新发送结果" : "按检查结果恢复",
      createdAt: NOW,
      updatedAt: NOW,
    });
    state.channelTaskRequests.push({
      id: `ctr_channel_${scenario.key}`,
      channelId: "chn_recovery",
      conversationId: "conv_recovery",
      projectId: PROJECT_ID,
      issueNumber: index + 1,
      title: scenario.title,
      status: "routed",
      workItemId,
      autoRunId,
      invocationId,
      threadId,
      createdAt: NOW,
      updatedAt: NOW,
    });
  }

  state.channelDeliveries.push({
    id: "chdl_channel_delivery",
    channelId: "chn_recovery",
    conversationId: "conv_recovery",
    invocationId: "inv_channel_delivery",
    status: "failed_terminal",
    attempts: 3,
    resendCount: 0,
    lastErrorCode: "provider_timeout",
    taskContext: {
      threadId: "cth_channel_delivery",
      workItemId: "lwi_channel_delivery",
      autoRunId: "aur_channel_delivery",
      deliveryKind: "result",
    },
    content: "月度报告已完成。",
    createdAt: NOW,
    updatedAt: NOW,
  });

  const persistence = createPersistenceRuntime({
    state,
    enabled: true,
    stateStorePath: statePath,
    schemaVersion: 1,
    now: () => NOW,
    defaultProject,
    sameProjectPath: (left, right) => resolve(left) === resolve(right),
  });
  const saved = persistence.persistStateNow();
  if (!saved.ok || !existsSync(statePath)) throw new Error(`Could not seed desktop state: ${JSON.stringify(saved)}`);
}

async function launchDesktop() {
  const env = {
    ...process.env,
    MYAGENTTOOL_ELECTRON_USER_DATA: userDataRoot,
    MYAGENTTOOL_PROJECT_PATH: projectRoot,
    MYAGENTTOOL_STORE: "memory",
    MYAGENTTOOL_MAIL_QUERY_INDEX: "0",
    MYAGENTTOOL_AUTORUN_VERIFY_AUTO: "0",
    MYAGENTTOOL_AUTORUN_VERIFY_COMMANDS_JSON: JSON.stringify({
      "channel-client-e2e": [process.execPath, "--test", "test/verify.test.mjs"],
    }),
    SERVER_PORT: "15101",
    WEB_PORT: "15100",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  return electron.launch({
    executablePath: electronExecutable,
    args: [join(repoRoot, "apps", "electron", "src", "main.mjs")],
    cwd: repoRoot,
    env,
    timeout: 60_000,
  });
}

async function openChannel(page) {
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate(() => {
    window.localStorage.setItem("myagenttool-ui", JSON.stringify({
      version: 1,
      state: { locale: "zh-CN", section: "channels", experienceMode: "ordinary" },
    }));
  });
  const url = new URL(page.url());
  url.searchParams.set("section", "channels");
  await page.goto(url.href, { waitUntil: "domcontentloaded" });
  await page.getByText("任务对话", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
}

function taskCard(page, title) {
  return page.getByTestId("channel-task-threads")
    .locator("div.rounded-md.border.border-border.p-3.text-xs")
    .filter({ has: page.getByText(title, { exact: true }) })
    .first();
}

async function runAiRepair(page) {
  const card = taskCard(page, "AI 返工任务");
  process.stdout.write(`[channel-desktop] AI card buttons: ${JSON.stringify(await card.getByRole("button").allTextContents())}\n`);
  await card.getByRole("button", { name: "让 AI 按检查返工" }).click();
  await card.getByText("AI 已按检查结果开始返工。", { exact: true }).waitFor({ timeout: 30_000 });
}

async function runVerification(page) {
  const card = taskCard(page, "补跑验证任务");
  await card.getByRole("button", { name: "重新运行验证" }).click();
  await card.getByText("重新验证已经通过。", { exact: true }).waitFor({ timeout: 30_000 });
}

async function runRedelivery(page) {
  const card = taskCard(page, "重发结果任务");
  await card.getByRole("button", { name: "重新发送结果" }).click();
  await card.getByText("结果消息已重新进入发送队列。", { exact: true }).waitFor({ timeout: 30_000 });
}

async function browserJson(page, path) {
  return page.evaluate(async (requestPath) => {
    const server = new URL(window.location.href).searchParams.get("api");
    if (!server) throw new Error("Desktop renderer did not expose its server origin.");
    const response = await fetch(`${server}${requestPath}`);
    const body = await response.json();
    if (!response.ok) throw new Error(`${requestPath} returned ${response.status}: ${JSON.stringify(body)}`);
    return body;
  }, path);
}

async function readEvidence(page) {
  const [state, metrics] = await Promise.all([
    browserJson(page, "/api/state"),
    browserJson(page, "/api/work-items/completion-metrics?origin=channel"),
  ]);
  const taskIds = ["ctr_channel_fix", "ctr_channel_verify", "ctr_channel_delivery"];
  const tasks = Object.fromEntries(taskIds.map((id) => {
    const task = state.channelTaskRequests.find((candidate) => candidate.id === id);
    return [id, task ? {
      workItemId: task.workItemId,
      autoRunId: task.autoRunId,
      invocationId: task.invocationId,
      threadId: task.threadId,
      deliveryStatus: task.deliveryStatus,
      stage: task.journey?.stage ?? task.stage,
      journeyRefs: task.journey?.refs ?? null,
      actions: task.actions,
      resultVerification: task.resultVerification ?? null,
      actionReceipt: task.actionReceipt ?? null,
    } : null];
  }));
  const delivery = state.channelDeliveries.find((candidate) => candidate.id === "chdl_channel_delivery") ?? null;
  return {
    tasks,
    delivery: delivery ? { status: delivery.status, resendCount: delivery.resendCount ?? 0 } : null,
    metrics: metrics.metrics,
  };
}

function assertPersistedReceipts(evidence) {
  const expected = {
    ctr_channel_fix: "fix_with_ai",
    ctr_channel_verify: "rerun_verification",
    ctr_channel_delivery: "retry_channel_delivery",
  };
  for (const [taskId, kind] of Object.entries(expected)) {
    const receipt = evidence.tasks[taskId]?.actionReceipt;
    if (!receipt || receipt.kind !== kind || receipt.status !== "succeeded") {
      throw new Error(`Desktop receipt was not durable for ${taskId}: ${JSON.stringify(receipt)}`);
    }
  }
  if (evidence.delivery?.resendCount !== 1) {
    throw new Error(`Result redelivery was not exactly-once: ${JSON.stringify(evidence.delivery)}`);
  }
}

function buildReport({ before, after, restored }) {
  const receipts = Object.values(restored.tasks).map((task) => task?.actionReceipt).filter(Boolean);
  const recoverySucceeded = receipts.filter((receipt) => receipt.status === "succeeded").length;
  const official = restored.metrics;
  return {
    schemaVersion: 1,
    executedThrough: "electron_desktop_renderer",
    generatedAt: new Date().toISOString(),
    scenarios: {
      fixWithAi: restored.tasks.ctr_channel_fix.actionReceipt,
      rerunVerification: restored.tasks.ctr_channel_verify.actionReceipt,
      retryDelivery: restored.tasks.ctr_channel_delivery.actionReceipt,
    },
    observed: {
      recoverySuccessRate: receipts.length ? recoverySucceeded / receipts.length : null,
      humanInterventionRate: official.humanIntervention.rate,
      duplicateExternalActionCount: official.externalActions.duplicateCount,
      repeatedResultSendCount: Math.max(0, Number(restored.delivery?.resendCount ?? 0) - 1),
      resultResendCount: restored.delivery?.resendCount ?? null,
      receiptsPersistedAfterRestart: receipts.length === 3,
    },
    officialMetrics: official,
    before,
    after,
    restored,
    evidence: {
      afterActionsScreenshot: join(evidenceRoot, "after-actions.png"),
      afterRestartScreenshot: join(evidenceRoot, "after-restart.png"),
      seededStateBytes: readFileSync(statePath).byteLength,
    },
  };
}
