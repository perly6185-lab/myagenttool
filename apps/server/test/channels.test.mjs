/*
 * Channel Registry (S2, #1090/ADR 0012): lifecycle, approval-gated enable,
 * fail-closed identity mapping, tenancy opaqueness, and the no-secrets
 * invariant (readiness is booleans; a probed secret value never lands in
 * state, events, or responses).
 */

import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { createServerState } from "../src/runtime/state-factory.mjs";
import { CHANNEL_ENABLE_ACTION, createChannelService, wecomEnvReadiness } from "../src/services/channels.mjs";

const NOW = "2026-07-15T00:00:00.000Z";
const SECRET = "corp-secret-value-must-never-leak";

function makeService({ readinessProbe, validateApprovalToken } = {}) {
  const { state } = createServerState({ defaultProjectPath: tmpdir(), now: () => NOW });
  state.users.push({ id: "usr_b", name: "B", teamId: "team_b", createdAt: NOW });
  state.teams.push({ id: "team_b", name: "Team B", createdAt: NOW });
  const events = [];
  let counter = 0;
  const service = createChannelService({
    state,
    now: () => NOW,
    nextId: (prefix) => `${prefix}_${String(++counter).padStart(4, "0")}`,
    appendEvent: (event) => events.push(event),
    validateApprovalToken:
      validateApprovalToken ?? ((token) => (token === "ok" ? { approved: true } : { approved: false, reason: token ? "unknown_token" : "missing_token" })),
    readinessProbe,
  });
  return { state, events, service };
}

const owner = { userId: "usr_local", teamId: "team_local", role: "owner", authenticated: true };
const foreign = { userId: "usr_b", teamId: "team_b", role: "owner", authenticated: true };

test("register validates provider and name, stamps the owner team, and audits", () => {
  const { state, events, service } = makeService();
  assert.equal(service.registerChannel({ provider: "slack", name: "x" }, owner).status, 400);
  assert.equal(service.registerChannel({ provider: "wecom", name: "  " }, owner).status, 400);

  const created = service.registerChannel({ provider: "wecom", name: "ops" }, owner);
  assert.equal(created.status, 201);
  assert.equal(created.body.channel.status, "registered");
  assert.equal(created.body.channel.ownerTeamId, "team_local");
  assert.equal(state.channels.length, 1);
  assert.equal(events.at(-1).type, "channel_registered");

  // Same provider+name+team is a conflict, not a silent duplicate.
  assert.equal(service.registerChannel({ provider: "wecom", name: "ops" }, owner).status, 409);
  // ...but another team may reuse the name.
  assert.equal(service.registerChannel({ provider: "wecom", name: "ops" }, foreign).status, 201);
});

test("enable is approval-gated; disable is not; both audit", () => {
  const { events, service } = makeService();
  const { body } = service.registerChannel({ provider: "wecom", name: "ops" }, owner);
  const channelId = body.channel.id;

  const refused = service.enableChannel({ channelId }, owner);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, "approval_required");
  assert.equal(refused.body.action, CHANNEL_ENABLE_ACTION);

  const enabled = service.enableChannel({ channelId, approvalToken: "ok" }, owner);
  assert.equal(enabled.status, 200);
  assert.equal(enabled.body.channel.status, "enabled");
  assert.equal(events.at(-1).type, "channel_enabled");

  // Idempotent re-enable consumes nothing.
  assert.equal(service.enableChannel({ channelId }, owner).body.status, "noop");

  const disabled = service.disableChannel({ channelId }, owner);
  assert.equal(disabled.body.channel.status, "disabled");
  assert.equal(events.at(-1).type, "channel_disabled");
});

test("a foreign team's channel is opaque: 404 on every route, never 403", () => {
  const { service } = makeService();
  const { body } = service.registerChannel({ provider: "wecom", name: "ops" }, owner);
  const channelId = body.channel.id;

  for (const result of [
    service.enableChannel({ channelId, approvalToken: "ok" }, foreign),
    service.disableChannel({ channelId }, foreign),
    service.channelHealth({ channelId }, foreign),
    service.mapChannelIdentity({ channelId, externalUserId: "wx_1", userId: "usr_b" }, foreign),
    service.listChannelIdentities({ channelId }, foreign),
  ]) {
    assert.equal(result.status, 404);
    assert.equal(result.body.error, "channel_not_found");
  }
  assert.equal(service.listChannels(foreign).body.count, 0);
});

test("identity mapping fails closed: user must exist and belong to the channel's team", () => {
  const { events, service } = makeService();
  const { body } = service.registerChannel({ provider: "wecom", name: "ops" }, owner);
  const channelId = body.channel.id;

  assert.equal(service.mapChannelIdentity({ channelId, externalUserId: "", userId: "usr_local" }, owner).status, 400);
  assert.equal(service.mapChannelIdentity({ channelId, externalUserId: "wx_1", userId: "usr_ghost" }, owner).status, 404);
  // A cross-team mapping would let a WeCom sender act across the tenancy boundary.
  assert.equal(service.mapChannelIdentity({ channelId, externalUserId: "wx_1", userId: "usr_b" }, owner).status, 404);

  const mapped = service.mapChannelIdentity({ channelId, externalUserId: "wx_1", userId: "usr_local" }, owner);
  assert.equal(mapped.status, 201);
  assert.equal(events.at(-1).type, "channel_identity_mapped");
  assert.equal(service.mapChannelIdentity({ channelId, externalUserId: "wx_1", userId: "usr_local" }, owner).status, 409);

  const removed = service.removeChannelIdentity({ channelId, identityId: mapped.body.identity.id }, owner);
  assert.equal(removed.status, 200);
  assert.equal(events.at(-1).type, "channel_identity_removed");
  assert.equal(service.listChannelIdentities({ channelId }, owner).body.count, 0);
});

test("readiness reports booleans only; a probed secret never reaches state, events, or responses", () => {
  const probe = () => ({ callback_token: true, encoding_aes_key: true, corp_secret: Boolean(SECRET) });
  const { state, events, service } = makeService({ readinessProbe: probe });
  const { body } = service.registerChannel({ provider: "wecom", name: "ops" }, owner);

  const health = service.channelHealth({ channelId: body.channel.id }, owner);
  assert.equal(health.status, 200);
  assert.deepEqual(health.body.readiness, { callback_token: true, encoding_aes_key: true, corp_secret: true });
  assert.equal(health.body.ready, true);

  for (const surface of [state, events, body, health.body]) {
    assert.ok(!JSON.stringify(surface).includes(SECRET), "secret value leaked");
  }
});

test("wecomEnvReadiness reads presence, not values", () => {
  assert.deepEqual(wecomEnvReadiness({}), { callback_token: false, encoding_aes_key: false, corp_secret: false });
  const ready = wecomEnvReadiness({ WECOM_CALLBACK_TOKEN: "t", WECOM_ENCODING_AES_KEY: "k", WECOM_CORP_SECRET: SECRET });
  assert.deepEqual(ready, { callback_token: true, encoding_aes_key: true, corp_secret: true });
  assert.ok(!JSON.stringify(ready).includes(SECRET));
});

test("health counts channel child rows and terminal delivery failures", () => {
  const { state, service } = makeService();
  const { body } = service.registerChannel({ provider: "wecom", name: "ops" }, owner);
  const channelId = body.channel.id;
  state.channelEvents.push({ id: "chev_x", channelId }, { id: "chev_y", channelId: "chn_other" });
  state.channelConversations.push({ id: "chcv_x", channelId });
  state.channelDeliveries.push(
    { id: "chdl_a", channelId, status: "delivered" },
    { id: "chdl_b", channelId, status: "failed_terminal" },
  );
  const health = service.channelHealth({ channelId }, owner);
  assert.deepEqual(health.body.counts, { events: 1, conversations: 1, deliveries: 2, failedDeliveries: 1 });
});
