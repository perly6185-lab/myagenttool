import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { createServerState } from "../src/runtime/state-factory.mjs";
import { createChannelConversationService } from "../src/services/channel-conversation.mjs";
import { createChannelService } from "../src/services/channels.mjs";

const NOW = "2026-08-25T00:00:00.000Z";
const OWNER = { userId: "usr_local", teamId: "team_local", role: "owner", authenticated: true };

function ordinaryUserChannel() {
  const { state } = createServerState({ defaultProjectPath: tmpdir(), now: () => NOW });
  const filed = [];
  let counter = 0;
  let message = 0;
  const nextId = (prefix) => `${prefix}_${++counter}`;
  const channelService = createChannelService({
    state,
    now: () => NOW,
    nextId,
    appendEvent: () => {},
    validateApprovalToken: () => ({ approved: true }),
    refuse: () => {},
  });
  const conversationService = createChannelConversationService({
    state,
    now: () => NOW,
    nextId,
    appendEvent: () => {},
    refuse: () => {},
    createChannelTaskIssue: async (input) => {
      filed.push(input);
      return {
        ok: true,
        number: filed.length,
        workItemId: `wi_blackbox_${filed.length}`,
        autoRoute: input.autoRoute,
        executionPreview: { previewReady: true, requiredFields: [] },
      };
    },
  });
  const registered = channelService.registerChannel({ provider: "wecom", name: "普通用户验收" }, OWNER);
  const channelId = registered.body.channel.id;
  const channel = state.channels.find((candidate) => candidate.id === channelId);
  channel.operationMode = "personal";
  channel.taskAutoRoute = true;
  channel.allowSelfApprove = true;
  channel.taskProjectId = "project_blackbox";
  channel.taskTerminalId = "dev_local";
  channelService.enableChannel({ channelId, approvalToken: "ok" }, OWNER);
  channelService.mapChannelIdentity({ channelId, externalUserId: "wx_user", userId: "usr_local" }, OWNER);

  async function say(content) {
    const imported = channelService.importChannelEvent({
      channelId,
      providerMessageId: `blackbox_message_${++message}`,
      externalUserId: "wx_user",
      content,
    });
    assert.equal(imported.ok, true);
    return conversationService.dispatchImportedChannelEvent({ eventId: imported.eventId });
  }

  return { state, filed, say };
}

function wechatApplication(id, name, accountId) {
  return {
    id,
    name,
    accountId,
    ownerTeamId: "team_local",
    status: "active",
    capabilityFacades: ["draft_sync", "publish"].map((operation) => ({
      id: `${id}_${operation}`,
      directInvocation: true,
      requiresApproval: true,
      siteOperationContract: {
        platformId: "wechat_official",
        operation,
        inputArtifactKinds: ["wechat_article_package"],
        outputArtifactKinds: [`${operation}_receipt`],
      },
    })),
  };
}

test("ordinary-user Channel black box covers understanding, clarification, confirmation, and safe execution admission", async () => {
  const channel = ordinaryUserChannel();

  const multiObject = await channel.say("把北京和上海两份销售数据分别分析一下");
  assert.equal(multiObject.data.previewOnly, true);
  assert.equal(multiObject.data.plannedTaskCount, 2);
  assert.match(multiObject.reply, /北京 · 数据分析/);
  assert.match(multiObject.reply, /上海 · 数据分析/);
  assert.equal(channel.filed.length, 0);

  const confirmedAnalysis = await channel.say("确认执行");
  assert.match(confirmedAnalysis.reply, /创建 2 个独立任务/);
  assert.deepEqual(channel.filed.map((input) => input.taskKind), ["data_analysis", "data_analysis"]);
  assert.equal(new Set(channel.filed.map((input) => input.workGoalId)).size, 1);

  const professionalChannel = ordinaryUserChannel();
  const clarification = await professionalChannel.say("帮我处理一下这批合同");
  assert.equal(clarification.data.clarificationKind, "professional_action");
  assert.equal(professionalChannel.filed.length, 0);
  const clarified = await professionalChannel.say("审查条款风险");
  assert.match(clarified.reply, /创建 1 个独立任务/);
  assert.equal(professionalChannel.filed.at(-1).taskKind, "legal_contract_review");

  const publicationChannel = ordinaryUserChannel();
  const missingAccount = await publicationChannel.say("把现成文章发到公司的第二个公众号");
  assert.equal(missingAccount.data.clarificationKind, "account_choice");
  assert.match(missingAccount.reply, /当前没有找到可用的已连接账号/);
  publicationChannel.state.applications.push(
    wechatApplication("app_personal", "个人公众号", "account_personal"),
    wechatApplication("app_company", "公司公众号", "account_company"),
  );

  const resumed = await publicationChannel.say("已连接");
  assert.equal(resumed.data.previewOnly, true);
  assert.equal(resumed.data.plannedTaskCount, 3);
  const beforePublication = publicationChannel.filed.length;
  const admitted = await publicationChannel.say("确认执行");
  assert.match(admitted.reply, /创建 3 个独立任务/);
  const publication = publicationChannel.filed.slice(beforePublication);
  assert.deepEqual(publication.map((input) => input.taskKind), ["platform_adaptation", "wechat_draft_sync", "content_publish"]);
  assert.ok(publication.every((input) => input.platformTarget.applicationId === "app_company"));
  assert.equal(publication[0].autoRoute, true);
  assert.equal(publication[1].autoRoute, false);
  assert.equal(publication[2].autoRoute, false);
  assert.deepEqual(publication[2].dependencyIds, ["wi_blackbox_1", "wi_blackbox_2"]);
});
