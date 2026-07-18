/*
 * S6 (#1090/ADR 0012 rule 5): in-channel approval. A write invocation parked at
 * waiting_for_local_approval is confirmed only by the ORIGINAL requester's
 * /approve, through the single-use grant chokepoint; replays don't double-start;
 * a stale confirmation is refused; /cancel denies; the console and the channel
 * act on the same pending decision.
 */

import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { createServerState } from "../src/runtime/state-factory.mjs";
import { createChannelConversationService } from "../src/services/channel-conversation.mjs";
import { createChannelService } from "../src/services/channels.mjs";
import { pendingDecisions } from "../src/read-models/pending-decisions.mjs";

const owner = { userId: "usr_local", teamId: "team_local", role: "owner", authenticated: true };

function makeHarness({ approveApplies = true, allowSelfApprove = true } = {}) {
  let clockMs = 1_800_000_000_000;
  const { state } = createServerState({ defaultProjectPath: tmpdir(), now: () => new Date(clockMs).toISOString() });
  const now = () => new Date(clockMs).toISOString();
  const events = [];
  const refusals = [];
  const grants = [];
  const approveCalls = [];
  const denyCalls = [];
  let counter = 0;
  const nextId = (prefix) => `${prefix}_${String(++counter).padStart(4, "0")}`;

  const channelService = createChannelService({
    state, now, nextId, appendEvent: (e) => events.push(e), validateApprovalToken: () => ({ approved: true }),
    refuse: (r) => refusals.push(r),
  });

  // A write-risk capability parks the invocation at waiting_for_local_approval
  // and records a pending approvalRequest — the shape createInvocation produces.
  const conversationService = createChannelConversationService({
    state, now, nextId, appendEvent: (e) => events.push(e), refuse: (r) => refusals.push(r),
    createCapabilityInvocation: (name) => {
      const invocation = {
        id: nextId("inv"), status: "waiting_for_local_approval", createdAt: now(),
        options: { metadata: { capability: name } },
      };
      state.invocations.push(invocation);
      state.approvalRequests.push({
        id: nextId("apr"), invocationId: invocation.id, status: "pending", riskLevel: "high",
        summary: { risk: `${name} is a write` }, createdAt: now(),
      });
      return { status: 202, body: { invocation } };
    },
    cancelInvocation: (invocation) => { invocation.status = "cancelled"; return { status: 200, body: { invocation } }; },
    mintDecisionGrant: ({ action, targetId, sourceDecisionId }) => {
      const token = `grant_${grants.length + 1}`;
      grants.push({ token, action, targetId, sourceDecisionId, consumed: false });
      return token;
    },
    validateApprovalToken: (token, { action, targetId }) => {
      const grant = grants.find((g) => g.token === token && !g.consumed);
      if (!grant || grant.action !== action || grant.targetId !== targetId) return { approved: false, reason: "grant_rejected" };
      grant.consumed = true;
      return { approved: true, mode: "grant" };
    },
    approveInvocation: (approval, invocation, actor) => {
      approveCalls.push({ approvalId: approval.id, invocationId: invocation.id, actor });
      if (!approveApplies) return; // simulate a failed approval that leaves status unchanged
      approval.status = "approved";
      invocation.status = "queued";
    },
    denyInvocation: (approval, invocation, actor) => {
      denyCalls.push({ approvalId: approval.id, invocationId: invocation.id, actor });
      approval.status = "denied";
      invocation.status = "rejected";
    },
  });

  const { body } = channelService.registerChannel({ provider: "wecom", name: "ops" }, owner);
  const channelId = body.channel.id;
  channelService.enableChannel({ channelId, approvalToken: "ok" }, owner);
  channelService.setChannelAllowlist({ channelId, capabilities: ["deploy.app"], approvalToken: "ok" }, owner);
  if (allowSelfApprove) channelService.setChannelApprovalPolicy({ channelId, allowSelfApprove: true, approvalToken: "ok" }, owner);
  channelService.mapChannelIdentity({ channelId, externalUserId: "wx_alice", userId: "usr_local" }, owner);

  let seq = 0;
  function receive(content, { from = "wx_alice" } = {}) {
    const imported = channelService.importChannelEvent({ channelId, providerMessageId: `m_${++seq}`, externalUserId: from, content });
    if (!imported.ok) return { imported, dispatched: null };
    return { imported, dispatched: conversationService.dispatchImportedChannelEvent({ eventId: imported.eventId }) };
  }

  return { state, events, refusals, grants, approveCalls, denyCalls, channelId, channelService, receive, advance: (ms) => { clockMs += ms; } };
}

test("by default (no opt-in) in-channel /approve is refused → the run must be approved in the console", () => {
  const h = makeHarness({ allowSelfApprove: false });
  const { dispatched } = h.receive("/run deploy.app prod");
  const invocation = h.state.invocations.at(-1);
  const approved = h.receive(`/approve ${invocation.id}`).dispatched;
  assert.equal(approved.status, "refused");
  assert.match(approved.reply, /separate operator|console/i);
  assert.equal(h.approveCalls.length, 0, "no approval was applied");
  assert.equal(invocation.status, "waiting_for_local_approval", "still parked");
});

test("a write /run parks for approval and names the exact /approve reply", () => {
  const h = makeHarness();
  const { dispatched } = h.receive("/run deploy.app prod");
  const invocation = h.state.invocations.at(-1);
  assert.equal(invocation.status, "waiting_for_local_approval");
  assert.match(dispatched.reply, new RegExp(`/approve ${invocation.id}`));
});

test("/approve by the original requester mints + consumes a single-use grant and flips the approval", () => {
  const h = makeHarness();
  h.receive("/run deploy.app prod");
  const invocation = h.state.invocations.at(-1);

  const approved = h.receive(`/approve ${invocation.id}`);
  assert.equal(approved.dispatched.ok, true);
  assert.equal(h.approveCalls.length, 1);
  assert.equal(h.approveCalls[0].invocationId, invocation.id);
  assert.equal(invocation.status, "queued");

  // The grant was single-use and sourced from the channel message.
  assert.equal(h.grants.length, 1);
  assert.equal(h.grants[0].consumed, true);
  assert.equal(h.grants[0].action, "invocation.approve");
  assert.equal(h.grants[0].targetId, invocation.id);

  // A replayed /approve does not double-start (no pending approval left).
  const replay = h.receive(`/approve ${invocation.id}`);
  assert.match(replay.dispatched.reply, /no pending approval/i);
  assert.equal(h.approveCalls.length, 1);
});

test("a different mapped user cannot approve someone else's invocation", () => {
  const h = makeHarness();
  h.receive("/run deploy.app prod");
  const invocation = h.state.invocations.at(-1);

  h.channelService.mapChannelIdentity({ channelId: h.channelId, externalUserId: "wx_bob", userId: "usr_local" }, owner);
  const foreign = h.receive(`/approve ${invocation.id}`, { from: "wx_bob" });
  assert.equal(foreign.dispatched.reply, "No such invocation in this conversation.");
  assert.equal(h.approveCalls.length, 0);
  assert.equal(h.refusals.at(-1).code, "action_not_permitted");
});

test("an expired confirmation is refused — resend required", () => {
  const h = makeHarness();
  h.receive("/run deploy.app prod");
  const invocation = h.state.invocations.at(-1);

  h.advance(11 * 60 * 1000); // past the 10-minute TTL
  const stale = h.receive(`/approve ${invocation.id}`);
  assert.match(stale.dispatched.reply, /expired/i);
  assert.equal(h.approveCalls.length, 0);
  assert.equal(h.refusals.at(-1).code, "action_not_permitted");
});

test("/cancel on a pending-approval invocation denies it", () => {
  const h = makeHarness();
  h.receive("/run deploy.app prod");
  const invocation = h.state.invocations.at(-1);

  h.receive(`/cancel ${invocation.id}`);
  assert.equal(h.denyCalls.length, 1);
  assert.equal(invocation.status, "rejected");
});

test("the console Approvals Center and the channel see the SAME pending decision", () => {
  const h = makeHarness();
  h.receive("/run deploy.app prod");
  const invocation = h.state.invocations.at(-1);
  // The channel stamps its correlation onto the invocation metadata (S4).
  invocation.options.metadata.channel = { channelId: h.channelId, conversationId: h.state.channelConversations.at(-1).id, eventId: "chev_x" };

  const rows = pendingDecisions({
    approvalRequests: h.state.approvalRequests,
    invocationsById: new Map(h.state.invocations.map((inv) => [inv.id, inv])),
  });
  const row = rows.find((r) => r.kind === "invocation_approval" && r.targetId === invocation.id);
  assert.ok(row, "the channel-parked approval appears in the Approvals Center");
  assert.equal(row.ref.channel.channelId, h.channelId);

  // Approving in-channel clears that same pending decision.
  h.receive(`/approve ${invocation.id}`);
  const after = pendingDecisions({
    approvalRequests: h.state.approvalRequests,
    invocationsById: new Map(h.state.invocations.map((inv) => [inv.id, inv])),
  });
  assert.ok(!after.some((r) => r.targetId === invocation.id && r.kind === "invocation_approval"));
});

test("hardening (#1126 LOW): /approve fails closed when the approval timestamp is unparseable", () => {
  const h = makeHarness();
  h.receive("/run deploy.app prod");
  const invocation = h.state.invocations.at(-1);
  // Corrupt both timestamps so the TTL can't be established.
  const approval = h.state.approvalRequests.find((a) => a.invocationId === invocation.id);
  approval.createdAt = undefined;
  invocation.createdAt = "not-a-date";

  const r = h.receive(`/approve ${invocation.id}`);
  assert.equal(r.dispatched.status, "refused");
  assert.match(r.dispatched.reply, /expired/i);
  assert.equal(h.approveCalls.length, 0, "no grant consumed / no approve attempted on an undatable confirmation");
});

test("hardening (#1126 LOW): /approve reports the honest state when approveInvocation does not apply", () => {
  const h = makeHarness({ approveApplies: false });
  h.receive("/run deploy.app prod");
  const invocation = h.state.invocations.at(-1);

  const r = h.receive(`/approve ${invocation.id}`);
  // The single-use grant was consumed, but the invocation stayed pending — the
  // reply must not falsely claim success.
  assert.equal(h.approveCalls.length, 1);
  assert.equal(r.dispatched.status, "refused");
  assert.match(r.dispatched.reply, /could not be approved/i);
});
