import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createServerRuntimeServices } from "../src/runtime/service-composer.mjs";
import { createServerState } from "../src/runtime/state-factory.mjs";
import { artifactApprovalSnapshot, publicationApprovalSnapshot } from "../src/services/work-goal-artifacts.mjs";
import {
  createWechatOfficialApplicationRegistration,
  WECHAT_OFFICIAL_AGENT_ID,
} from "../src/services/wechat-official-application.mjs";
import { createWechatArticlePackage } from "../../../tools/wechat-official-site/src/article-package.mjs";

const NOW = "2026-08-14T00:00:00.000Z";
const OWNER = { userId: "usr_local", teamId: "team_local", role: "owner", authenticated: true };

test("a direct content task registers real output files before unlocking its dependent", async () => {
  const projectPath = mkdtempSync(join(tmpdir(), "direct-content-lifecycle-"));
  try {
    const { state, defaultProject } = createServerState({ defaultProjectPath: projectPath, now: () => NOW });
    const { httpDependencies: deps } = createServerRuntimeServices({
      namespace: "test", protocolVersion: "0.0.0", state, defaultProject,
      defaultProjectPath: projectPath, persistenceEnabled: false,
      stateStorePath: join(projectPath, "state.json"), stateSchemaVersion: 1,
      dispatchLeaseMs: 30_000, now: () => NOW,
    });
    state.device.status = "online";
    const agent = state.agents.find((candidate) => candidate.id === "agt_codex_cli");
    agent.status = "available";
    agent.health = { status: "healthy", checkedAt: NOW };
    state.workGoals.push({
      id: "goal_direct_content", ownerTeamId: "team_local", projectId: defaultProject.id,
      title: "文章并适配", statement: "先写文章再适配", outcome: "得到平台内容包",
      status: "active", planVersion: 1, taskIds: [], artifacts: [], platforms: [],
    });
    const article = deps.createWorkItem({
      projectId: defaultProject.id, title: "文章创作", body: "形成可审阅文章",
      status: "ready", executionPolicy: "auto", plannedDate: NOW.slice(0, 10),
      intentId: "goal_direct_content", intentStatement: "先写文章再适配",
      taskKind: "content_article", workGoalId: "goal_direct_content",
      artifactContract: {
        consumes: [], produces: ["article_draft"],
        requirements: [{ kind: "article_draft", minCount: 1, extensions: [".md"], quality: { minChars: 800, minSections: 3 } }],
      },
    }, OWNER).body.workItem;
    const adaptation = deps.createWorkItem({
      projectId: defaultProject.id, title: "平台适配", body: "基于文章形成平台内容包",
      status: "ready", executionPolicy: "auto", plannedDate: NOW.slice(0, 10),
      intentId: "goal_direct_content", intentStatement: "先写文章再适配",
      taskKind: "platform_adaptation", workGoalId: "goal_direct_content",
      dependencyIds: [article.id],
      artifactContract: { consumes: ["article_draft"], produces: ["platform_package"], requirements: [{ kind: "platform_package", minCount: 1, extensions: [".md"] }] },
    }, OWNER).body.workItem;
    state.workGoals[0].taskIds = [article.id, adaptation.id];

    const sweep = await deps.sweepWorkItemAutoScheduler();
    const invocation = state.invocations.find((candidate) => candidate.id === sweep.starts[0].invocationId);
    assert.ok(invocation);
    const outputDirectory = invocation.options.metadata.directWorkItem.outputDirectory;
    mkdirSync(join(projectPath, ...outputDirectory.split("/")), { recursive: true });
    writeFileSync(join(projectPath, ...outputDirectory.split("/"), "article.md"), [
      "# 标题", "", "## 第一部分", "", "内容".repeat(500), "", "## 第二部分", "", "结论".repeat(30),
    ].join("\n"));

    deps.completeInvocation(invocation, {
      status: "succeeded",
      summary: "文章已生成",
      result: { latestMessage: "文章已生成并保存。" },
    });

    const storedArticle = state.workItems.find((item) => item.id === article.id);
    assert.equal(storedArticle.status, "review");
    assert.equal(storedArticle.outputAssets.length, 1);
    assert.equal(storedArticle.outputAssets[0].path, `${outputDirectory}/article.md`);
    assert.equal(storedArticle.outputAssets[0].contentMetrics.charCount >= 800, true);
    assert.equal(storedArticle.outputAssets[0].contentMetrics.sectionCount >= 3, true);

    const completed = deps.updateWorkItem({
      workItemId: article.id, expectedRevision: storedArticle.revision, status: "done",
    }, OWNER);
    assert.equal(completed.status, 200, JSON.stringify(completed.body));
    const storedAdaptation = state.workItems.find((item) => item.id === adaptation.id);
    assert.equal(storedAdaptation.inputAssets[0].path, `${outputDirectory}/article.md`);
    assert.equal(storedAdaptation.artifactHandoffs[0].status, "attached");
  } finally {
    rmSync(projectPath, { recursive: true, force: true });
  }
});

test("direct execution blocks missing and invalid outputs instead of presenting them for review", async () => {
  for (const scenario of ["missing", "invalid"]) {
    const projectPath = mkdtempSync(join(tmpdir(), `direct-content-${scenario}-`));
    try {
      const { state, defaultProject } = createServerState({ defaultProjectPath: projectPath, now: () => NOW });
      const { httpDependencies: deps } = createServerRuntimeServices({
        namespace: "test", protocolVersion: "0.0.0", state, defaultProject,
        defaultProjectPath: projectPath, persistenceEnabled: false,
        stateStorePath: join(projectPath, "state.json"), stateSchemaVersion: 1,
        dispatchLeaseMs: 30_000, now: () => NOW,
      });
      state.device.status = "online";
      const agent = state.agents.find((candidate) => candidate.id === "agt_codex_cli");
      agent.status = "available";
      agent.health = { status: "healthy", checkedAt: NOW };
      const article = deps.createWorkItem({
        projectId: defaultProject.id, title: "文章创作", body: "形成可审阅文章",
        status: "ready", executionPolicy: "auto", plannedDate: NOW.slice(0, 10),
        acceptanceCriteria: ["文章至少 800 字并包含三个章节"],
        verificationSop: ["检查文章字数和结构"],
        taskKind: "content_article",
        artifactContract: {
          consumes: [], produces: ["article_draft"],
          requirements: [{ kind: "article_draft", minCount: 1, extensions: [".md"], quality: { minChars: 800, minSections: 3 } }],
        },
      }, OWNER).body.workItem;
      const sweep = await deps.sweepWorkItemAutoScheduler();
      const invocation = state.invocations.find((candidate) => candidate.id === sweep.starts[0].invocationId);
      assert.ok(invocation, scenario);
      if (scenario === "invalid") {
        const outputDirectory = invocation.options.metadata.directWorkItem.outputDirectory;
        mkdirSync(join(projectPath, ...outputDirectory.split("/")), { recursive: true });
        writeFileSync(join(projectPath, ...outputDirectory.split("/"), "article.md"), "# 标题\n\n内容太短");
      }
      deps.completeInvocation(invocation, {
        status: "succeeded", summary: "处理完成", result: { latestMessage: "结果已经保存。" },
      });
      const stored = state.workItems.find((item) => item.id === article.id);
      assert.equal(stored.status, "blocked", scenario);
      assert.equal(state.events.some((event) => event.invocationId === invocation.id
        && event.type === (scenario === "missing"
          ? "work_item_direct_execution_missing_outputs"
          : "work_item_direct_execution_invalid_outputs")), true, scenario);
      if (scenario === "invalid") {
        assert.equal(stored.outputAssets.length, 1);
        assert.equal(stored.outputAssets[0].contentMetrics.charCount < 800, true);
        assert.match(stored.lastProgressSummary, /结果检查未通过|需要至少/);
      }
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  }
});

test("dismissing a channel task sends a plain-language reply with thread correlation", async () => {
  const projectPath = mkdtempSync(join(tmpdir(), "channel-task-lifecycle-"));
  try {
    const { state, defaultProject } = createServerState({ defaultProjectPath: projectPath, now: () => NOW });
    const { httpDependencies: deps } = createServerRuntimeServices({
      namespace: "test",
      protocolVersion: "0.0.0",
      state,
      defaultProject,
      defaultProjectPath: projectPath,
      persistenceEnabled: false,
      stateStorePath: join(projectPath, "state.json"),
      stateSchemaVersion: 1,
      dispatchLeaseMs: 30_000,
      now: () => NOW,
    });

    state.channels.push({ id: "chn_review", provider: "wechat_ilink", ownerTeamId: "team_local" });
    state.channelConversations.push({
      id: "conv_review",
      channelId: "chn_review",
      externalUserId: "wx_review",
      ownerTeamId: "team_local",
    });
    state.channelTaskThreads.push({
      id: "cth_review",
      shortRef: "T-REVIEW",
      channelId: "chn_review",
      conversationId: "conv_review",
      status: "queued",
      workItemId: null,
      statusHistory: [],
    });
    state.channelTaskRequests.push({
      id: "ctr_review",
      channelId: "chn_review",
      conversationId: "conv_review",
      threadId: "cth_review",
      status: "pending",
      issueNumber: null,
    });

    const result = await deps.dismissChannelTask("ctr_review", OWNER);
    assert.equal(result.status, 200);
    const delivery = state.channelDeliveries.at(-1);
    assert.equal(delivery.content, "任务已被管理员忽略，未开始执行。");
    assert.doesNotMatch(delivery.content, /T-REVIEW|cth_review|Trace:/);
    assert.equal(delivery.taskContext.threadId, "cth_review");
  } finally {
    rmSync(projectPath, { recursive: true, force: true });
  }
});

test("routing a publication task fails closed until a governed platform connection exists", async () => {
  const projectPath = mkdtempSync(join(tmpdir(), "channel-publication-gate-"));
  try {
    const { state, defaultProject } = createServerState({ defaultProjectPath: projectPath, now: () => NOW });
    const { httpDependencies: deps } = createServerRuntimeServices({
      namespace: "test",
      protocolVersion: "0.0.0",
      state,
      defaultProject,
      defaultProjectPath: projectPath,
      persistenceEnabled: false,
      stateStorePath: join(projectPath, "state.json"),
      stateSchemaVersion: 1,
      dispatchLeaseMs: 30_000,
      now: () => NOW,
    });
    state.channels.push({ id: "chn_publish", provider: "wechat_ilink", ownerTeamId: "team_local" });
    const publishItem = {
      id: "wi_publish", ownerTeamId: "team_local", projectId: defaultProject.id,
      taskKind: "content_publish", platformTarget: { id: "wechat_official", label: "公众号" },
      inputAssets: [{
        id: "asset_final", path: "outputs/wechat-final.md", family: "markdown",
        hash: "final-hash", version: "v1",
      }],
    };
    state.workItems.push(publishItem);
    state.channelTaskRequests.push({
      id: "ctr_publish", channelId: "chn_publish", conversationId: "conv_publish",
      status: "pending", workItemId: "wi_publish",
      approvalSnapshot: publicationApprovalSnapshot(publishItem),
    });
    const result = await deps.routeChannelTask("ctr_publish", OWNER);
    assert.equal(result.status, 409);
    assert.equal(result.body.error, "channel_publish_adapter_unavailable");
    assert.equal(result.body.publicationReadiness.reason, "publication_connection_missing");
    assert.equal(state.channelTaskRequests[0].status, "pending");
  } finally {
    rmSync(projectPath, { recursive: true, force: true });
  }
});

test("routing a WeChat draft task fails closed until a governed draft connection exists", async () => {
  const projectPath = mkdtempSync(join(tmpdir(), "channel-wechat-draft-gate-"));
  try {
    const { state, defaultProject } = createServerState({ defaultProjectPath: projectPath, now: () => NOW });
    const { httpDependencies: deps } = createServerRuntimeServices({
      namespace: "test", protocolVersion: "0.0.0", state, defaultProject,
      defaultProjectPath: projectPath, persistenceEnabled: false,
      stateStorePath: join(projectPath, "state.json"), stateSchemaVersion: 1,
      dispatchLeaseMs: 30_000, now: () => NOW,
    });
    state.channels.push({ id: "chn_draft", provider: "wechat_ilink", ownerTeamId: "team_local" });
    const item = {
      id: "wi_draft", ownerTeamId: "team_local", projectId: defaultProject.id,
      taskKind: "wechat_draft_sync", platformTarget: { id: "wechat_official", label: "公众号" },
      inputAssets: [{ id: "asset_package", path: "outputs/wechat-package.json", family: "json", hash: "v1", version: "1" }],
    };
    state.workItems.push(item);
    state.channelTaskRequests.push({
      id: "ctr_draft", channelId: "chn_draft", status: "pending", workItemId: item.id,
      approvalSnapshot: artifactApprovalSnapshot(item),
    });
    const result = await deps.routeChannelTask("ctr_draft", OWNER);
    assert.equal(result.status, 409);
    assert.equal(result.body.error, "channel_wechat_draft_adapter_unavailable");
    assert.equal(result.body.draftSyncReadiness.reason, "draft_sync_connection_missing");
    assert.equal(state.channelTaskRequests[0].status, "pending");
  } finally {
    rmSync(projectPath, { recursive: true, force: true });
  }
});

test("connecting WeChat once auto-registers the bundled agent and active Application", async () => {
  const projectPath = mkdtempSync(join(tmpdir(), "wechat-one-click-connect-"));
  try {
    const { state, defaultProject } = createServerState({ defaultProjectPath: projectPath, now: () => NOW });
    const { httpDependencies: deps } = createServerRuntimeServices({
      namespace: "test", protocolVersion: "0.0.0", state, defaultProject,
      defaultProjectPath: projectPath, persistenceEnabled: false,
      stateStorePath: join(projectPath, "state.json"), stateSchemaVersion: 1,
      dispatchLeaseMs: 30_000, now: () => NOW,
    });
    const shimPath = join(projectPath, "login-shim.mjs");
    writeFileSync(shimPath, "process.exit(0);\n");
    const env = {
      ...process.env,
      MYAGENTTOOL_SESSION_WECHAT_OFFICIAL_COMMAND_JSON: JSON.stringify([process.execPath, shimPath]),
    };

    const connected = await deps.reseedSessionSite("wechat_official", { env }, OWNER);
    assert.equal(connected.ok, true);
    assert.equal(connected.connection.ready, true);
    assert.ok(state.agents.some((candidate) => candidate.id === WECHAT_OFFICIAL_AGENT_ID));
    assert.equal(state.applications.find((candidate) => candidate.id === "app_wechat_official").status, "active");
    const session = deps.listSessions().find((candidate) => candidate.site === "wechat_official");
    assert.equal(session.status, "active");
    assert.equal(session.connection.ready, true);
  } finally {
    rmSync(projectPath, { recursive: true, force: true });
  }
});

test("routing a confirmed WeChat draft task dispatches the exact governed draft capability", async () => {
  const projectPath = mkdtempSync(join(tmpdir(), "channel-wechat-draft-dispatch-"));
  try {
    const { state, defaultProject } = createServerState({ defaultProjectPath: projectPath, now: () => NOW });
    const { httpDependencies: deps } = createServerRuntimeServices({
      namespace: "test", protocolVersion: "0.0.0", state, defaultProject,
      defaultProjectPath: projectPath, persistenceEnabled: false,
      stateStorePath: join(projectPath, "state.json"), stateSchemaVersion: 1,
      dispatchLeaseMs: 30_000, now: () => NOW,
    });
    deps.registerAgent({
      id: WECHAT_OFFICIAL_AGENT_ID,
      name: "微信公众号测试执行器",
      type: "mcp",
      transport: "stdio",
      command: process.execPath,
      args: ["unused.mjs"],
      allowedTools: ["wechat_official_probe", "wechat_official_draft_sync"],
    }, OWNER);
    deps.registerApplication(createWechatOfficialApplicationRegistration({ autoOnline: true }), OWNER);
    state.channels.push({ id: "chn_draft", provider: "wechat_ilink", ownerTeamId: "team_local" });
    mkdirSync(join(projectPath, "outputs"));
    const articlePackage = createWechatArticlePackage({ title: "测试文章", contentHtml: "<p>正文</p>" });
    const packageBytes = `${JSON.stringify(articlePackage)}\n`;
    writeFileSync(join(projectPath, "outputs", "wechat-package.json"), packageBytes);
    const item = {
      id: "wi_draft", ownerTeamId: "team_local", projectId: defaultProject.id,
      terminalId: state.device.id, revision: 1, status: "ready", state: "open",
      taskKind: "wechat_draft_sync", platformTarget: { id: "wechat_official", label: "公众号" },
      inputAssets: [{
        id: "asset_package", path: "outputs/wechat-package.json", family: "text",
        hash: `sha256:${createHash("sha256").update(packageBytes).digest("hex")}`, version: "1",
        terminalId: state.device.id, originalName: "wechat-package.json", mimeType: "application/json",
        size: Buffer.byteLength(packageBytes), resourceClass: "small", worktreeId: null,
        capabilities: ["discover", "preview", "inspect", "attach_evidence"],
        readiness: { state: "ready", reason: "test_package" },
      }],
      executionBindings: [],
    };
    state.workItems.push(item);
    state.channelTaskRequests.push({
      id: "ctr_draft", channelId: "chn_draft", conversationId: "conv_draft",
      status: "pending", workItemId: item.id,
      approvalSnapshot: artifactApprovalSnapshot(item),
    });
    const result = await deps.routeChannelTask("ctr_draft", OWNER);
    assert.equal(result.status, 200);
    assert.equal(result.body.capability, "app.app_wechat_official.draft_sync");
    assert.equal(result.body.draftOnly, true);
    assert.equal(state.channelTaskRequests[0].status, "routed");
    assert.equal(state.autoRuns.length, 0);
    const invocation = state.invocations.find((candidate) => candidate.id === result.body.invocationId);
    assert.equal(invocation.options.toolName, "wechat_official_draft_sync");
    assert.equal(invocation.options.metadata.wechatDraftTask.workItemId, item.id);
    assert.equal(invocation.options.metadata.wechatDraftTask.articlePackageDigest, articlePackage.packageDigest);
    assert.equal(invocation.options.metadata.wechatDraftTask.articlePackageTitle, articlePackage.title);
    assert.equal(item.executionBindings.at(-1).kind, "application_invocation");
    const replay = await deps.routeChannelTask("ctr_draft", OWNER, { idempotencyKey: "channel-route:ctr_draft" });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.invocationId, invocation.id);
    assert.equal(state.invocations.filter((candidate) => candidate.options?.toolName === "wechat_official_draft_sync").length, 1);
    deps.completeInvocation(invocation, {
      status: "succeeded",
      summary: "login expired",
      result: {
        toolName: "wechat_official_draft_sync",
        output: JSON.stringify({
          status: "session_expired",
          sideEffectState: "not_started",
          summary: "公众号登录已失效。",
          retryable: true,
          userAction: { kind: "login", message: "请扫码登录" },
        }),
      },
    });
    assert.equal(item.status, "blocked");
    assert.equal(state.sessions.find((candidate) => candidate.site === "wechat_official").status, "needs_login");
    const beforeLogin = await deps.retryChannelTask("ctr_draft", OWNER);
    assert.equal(beforeLogin.status, 409);
    assert.equal(beforeLogin.body.error, "channel_wechat_login_required");
    state.sessions.find((candidate) => candidate.site === "wechat_official").status = "active";
    state.sessions.find((candidate) => candidate.site === "wechat_official").lastReauthAt = "2026-08-24T00:00:01.000Z";
    const retried = await deps.retryChannelTask("ctr_draft", OWNER, { sourceDecisionId: "evt_retry" });
    assert.equal(retried.status, 200);
    assert.equal(retried.body.retried, true);
    assert.notEqual(retried.body.invocationId, invocation.id);
    assert.equal(state.invocations.filter((candidate) => candidate.options?.toolName === "wechat_official_draft_sync").length, 2);
    const retryInvocation = state.invocations.find((candidate) => candidate.id === retried.body.invocationId);
    deps.completeInvocation(retryInvocation, {
      status: "succeeded",
      summary: "draft saved",
      result: {
        toolName: "wechat_official_draft_sync",
        output: JSON.stringify({
          status: "succeeded",
          sideEffectState: "confirmed",
          summary: "公众号草稿已保存。",
          receipt: {
            title: "测试文章",
            packageDigest: articlePackage.packageDigest,
            editorUrl: "https://mp.weixin.qq.com/cgi-bin/appmsg",
            pageContractVersion: "wechat-official-draft-v1",
          },
        }),
      },
    });
    assert.equal(item.status, "done");
    assert.equal(item.outputAssets.at(-1).family, "text");
    assert.equal(existsSync(join(projectPath, item.outputAssets.at(-1).path)), true);
    assert.equal(state.channelTaskRequests[0].invocationId, retryInvocation.id);
    assert.equal(state.applicationResults[0].source, "wechat_official_draft");

    const mismatchItem = {
      ...item,
      id: "wi_draft_receipt_mismatch",
      revision: 1,
      status: "ready",
      state: "open",
      outputAssets: [],
      executionBindings: [],
      verificationRecords: [],
      acceptanceResults: [],
    };
    state.workItems.push(mismatchItem);
    state.channelTaskThreads.push({
      id: "cth_draft_receipt_mismatch",
      shortRef: "T-MISMATCH",
      channelId: "chn_draft",
      conversationId: "conv_draft",
      status: "queued",
      workItemId: mismatchItem.id,
      statusHistory: [],
    });
    state.channelTaskRequests.push({
      id: "ctr_draft_receipt_mismatch", channelId: "chn_draft", conversationId: "conv_draft",
      threadId: "cth_draft_receipt_mismatch", status: "pending", workItemId: mismatchItem.id,
      approvalSnapshot: artifactApprovalSnapshot(mismatchItem),
    });
    const mismatchRoute = await deps.routeChannelTask("ctr_draft_receipt_mismatch", OWNER);
    assert.equal(mismatchRoute.status, 200);
    const mismatchInvocation = state.invocations.find((candidate) => candidate.id === mismatchRoute.body.invocationId);
    deps.completeInvocation(mismatchInvocation, {
      status: "succeeded",
      result: {
        toolName: "wechat_official_draft_sync",
        output: JSON.stringify({
          status: "succeeded",
          sideEffectState: "confirmed",
          summary: "公众号返回保存成功，但回执来自另一篇文章。",
          receipt: {
            title: "另一篇文章",
            packageDigest: `sha256:${"f".repeat(64)}`,
            pageContractVersion: "wechat-official-draft-v1",
          },
        }),
      },
    });
    assert.equal(mismatchItem.status, "blocked");
    assert.equal(mismatchItem.verificationRecords[0].status, "failed");
    assert.equal(state.channelTaskThreads.find((thread) => thread.id === "cth_draft_receipt_mismatch").status, "needs_attention");

    const uncertainItem = {
      ...item,
      id: "wi_draft_uncertain",
      revision: 1,
      status: "ready",
      state: "open",
      outputAssets: [],
      executionBindings: [],
      verificationRecords: [],
      acceptanceResults: [],
    };
    state.workItems.push(uncertainItem);
    state.channelTaskRequests.push({
      id: "ctr_draft_uncertain", channelId: "chn_draft", conversationId: "conv_draft",
      status: "pending", workItemId: uncertainItem.id,
      approvalSnapshot: artifactApprovalSnapshot(uncertainItem),
    });
    const uncertainRoute = await deps.routeChannelTask("ctr_draft_uncertain", OWNER);
    assert.equal(uncertainRoute.status, 200);
    const uncertainInvocation = state.invocations.find((candidate) => candidate.id === uncertainRoute.body.invocationId);
    deps.completeInvocation(uncertainInvocation, {
      status: "failed",
      summary: "draft outcome unknown",
      result: {
        toolName: "wechat_official_draft_sync",
        output: JSON.stringify({
          status: "unconfirmed",
          sideEffectState: "unknown",
          summary: "提交后未能确认草稿箱结果。",
          retryable: false,
        }),
      },
    });
    const blindRetry = await deps.retryChannelTask("ctr_draft_uncertain", OWNER);
    assert.equal(blindRetry.status, 409);
    assert.equal(blindRetry.body.error, "channel_wechat_draft_reconcile_required");
    const reconciled = await deps.reconcileWechatDraftChannelTask("ctr_draft_uncertain", "confirmed_saved", OWNER, { sourceDecisionId: "evt_confirmed_saved" });
    assert.equal(reconciled.status, 200);
    assert.equal(uncertainItem.status, "done");
    assert.equal(uncertainItem.verificationRecords[0].kind, "manual");
    assert.match(readFileSync(join(projectPath, uncertainItem.outputAssets.at(-1).path), "utf8"), /user_draft_box_reconciliation/);
    const replayedReconciliation = await deps.reconcileWechatDraftChannelTask("ctr_draft_uncertain", "confirmed_saved", OWNER, { sourceDecisionId: "evt_duplicate_delivery" });
    assert.equal(replayedReconciliation.body.replayed, true);
    assert.equal(uncertainItem.verificationRecords.length, 1);
  } finally {
    rmSync(projectPath, { recursive: true, force: true });
  }
});

test("routing a publication task rejects a missing or stale final-output approval", async () => {
  const projectPath = mkdtempSync(join(tmpdir(), "channel-publication-preview-"));
  try {
    const { state, defaultProject } = createServerState({ defaultProjectPath: projectPath, now: () => NOW });
    const { httpDependencies: deps } = createServerRuntimeServices({
      namespace: "test", protocolVersion: "0.0.0", state, defaultProject,
      defaultProjectPath: projectPath, persistenceEnabled: false,
      stateStorePath: join(projectPath, "state.json"), stateSchemaVersion: 1,
      dispatchLeaseMs: 30_000, now: () => NOW,
    });
    state.channels.push({ id: "chn_publish", provider: "wechat_ilink", ownerTeamId: "team_local" });
    const item = {
      id: "wi_publish", ownerTeamId: "team_local", projectId: defaultProject.id,
      taskKind: "content_publish", platformTarget: { id: "wechat_official", label: "公众号" },
      inputAssets: [{ id: "asset_final", path: "outputs/final.md", family: "markdown", hash: "v1", version: "1" }],
    };
    state.workItems.push(item);
    state.channelTaskRequests.push({
      id: "ctr_publish", channelId: "chn_publish", status: "pending", workItemId: item.id,
    });
    const missing = await deps.routeChannelTask("ctr_publish", OWNER);
    assert.equal(missing.body.error, "channel_publish_preview_required");

    state.channelTaskRequests[0].approvalSnapshot = publicationApprovalSnapshot(item);
    item.inputAssets[0].hash = "v2";
    const stale = await deps.routeChannelTask("ctr_publish", OWNER);
    assert.equal(stale.body.error, "channel_publish_preview_changed");
    assert.equal(state.channelTaskRequests[0].status, "pending");
  } finally {
    rmSync(projectPath, { recursive: true, force: true });
  }
});
