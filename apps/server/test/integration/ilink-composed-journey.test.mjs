import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createServerRuntimeServices } from "../../src/runtime/service-composer.mjs";
import { createServerState } from "../../src/runtime/state-factory.mjs";

const NOW = "2026-08-14T00:00:00.000Z";
const OWNER = { userId: "usr_local", teamId: "team_local", role: "owner", authenticated: true };

test("composed iLink journey: poll → import → channel reply queue → provider send", async () => {
  const projectPath = await mkdtemp(join(tmpdir(), "myagenttool-ilink-composed-"));
  const { state, defaultProject } = createServerState({ defaultProjectPath: projectPath, now: () => NOW });
  let firstPoll = true;
  const sent = [];
  const credentials = new Map([["ila_composed", { botToken: "secret", baseUrl: "https://example.test" }]]);
  const fakeClient = {
    notifyStart: async () => {},
    notifyStop: async () => {},
    getUpdates: async () => {
      if (!firstPoll) return new Promise(() => {});
      firstPoll = false;
      setTimeout(() => deps.stopIlink(), 0);
      return {
        ret: 0,
        get_updates_buf: "cursor-1",
        msgs: [{
          message_id: 101,
          from_user_id: "wx-composed",
          message_type: 1,
          context_token: "ctx-composed",
          item_list: [{ type: 1, text_item: { text: "/help" } }],
        }],
      };
    },
    sendMessage: async (payload) => {
      sent.push(payload);
      return { clientId: payload.clientId ?? "provider-receipt-1" };
    },
  };
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
    ilinkCredentialStore: {
      load: (id) => credentials.get(id) ?? null,
      save: (id, value) => credentials.set(id, value),
      remove: (id) => credentials.delete(id),
    },
    ilinkClientFactory: () => fakeClient,
  });

  const channel = {
    id: "chn_composed",
    provider: "wechat_ilink",
    ownerTeamId: "team_local",
    status: "enabled",
    operationMode: "personal",
    taskProjectId: defaultProject.id,
    taskTerminalId: (state.devices ?? [])[0]?.id ?? "dev_local",
  };
  state.channels.push(channel);
  state.ilinkAccounts.push({
    id: "ila_composed",
    channelId: channel.id,
    ownerTeamId: "team_local",
    ownerUserId: OWNER.userId,
    status: "connected",
    cursor: "",
    botId: "bot-composed",
  });
  const mapped = deps.mapChannelIdentity({ channelId: channel.id, externalUserId: "wx-composed", userId: OWNER.userId }, OWNER);
  assert.equal(mapped.ok, true);
  deps.setChannelDeliverySender("wechat_ilink", (payload) => deps.sendIlinkApplicationMessage(payload));

  deps.startIlink();
  await new Promise((resolve) => setTimeout(resolve, 30));
  const imported = state.channelEvents.find((event) => event.providerMessageId === "101");
  assert.ok(imported);
  assert.equal(imported.status, "dispatched");
  assert.match(imported.replyText, /你可以直接发送/);
  assert.equal(state.channelDeliveries.length, 1);
  assert.equal(state.channelDeliveries[0].replyContext.contextToken, "ctx-composed");

  await deps.sweepChannelDeliveries();
  assert.equal(state.channelDeliveries[0].status, "delivered");
  assert.equal(sent.length, 1);
  assert.match(sent[0].content, /你可以直接发送/);
  assert.equal(sent[0].contextToken, "ctx-composed");
  assert.equal(sent[0].clientId, state.channelDeliveries[0].id);
  deps.stopIlink();
});
