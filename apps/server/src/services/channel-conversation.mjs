/*
 * Channel conversation execution (S4, #1090/ADR 0012 rules 2+3): turn one
 * imported ChannelEvent into a governed capability invocation — deterministic
 * command parsing over the closed set, fail-closed identity mapping,
 * channel-side allowlist BEFORE the capability gateway's own gates (two
 * independent gates), untrusted-input taint on the invocation, and
 * conversation ↔ invocation correlation for /result and /cancel.
 *
 * Replies are text staged on the event record (`replyText`); S5 turns staged
 * replies into durable outbound deliveries. No LLM ever reads the message —
 * anything the parser doesn't recognize gets usage help, never interpretation.
 */

import { channelCommands, parseChannelCommand } from "@myagenttool/protocol/channel";
import { UNTRUSTED_INPUT_TAG } from "@myagenttool/protocol/issue-prompt";
import { actorForUser } from "../runtime/auth.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";

const GENERIC_DENIED_REPLY = "Not authorized for this channel. Contact your team administrator.";
const USAGE_REPLY = `Commands: ${channelCommands.join(" ")}`;

// A staged confirmation goes stale after this long — a fresh /run is required
// (mirrors the approval-grant TTL: a confirm-click artifact, not a work queue).
export const CHANNEL_APPROVAL_TTL_MS = 10 * 60 * 1000;

export function createChannelConversationService({
  state,
  now,
  nextId, // reserved for S5 (delivery records); accepted so the composer wiring is uniform
  appendEvent,
  refuse = null,
  persistStateSoon = () => {},
  store,
  createCapabilityInvocation,
  cancelInvocation,
  // S6: the grant chokepoint — /approve mints a single-use grant sourced from
  // the channel message, consumes it, and only then flips the invocation.
  mintDecisionGrant = null,
  validateApprovalToken = null,
  approveInvocation = null,
  denyInvocation = null,
}) {
  const runTx = makeRunTx({ store, persistStateSoon });
  void nextId;

  const findChannel = (channelId) => (state.channels ?? []).find((row) => row.id === channelId) ?? null;
  const findConversation = (conversationId) =>
    (state.channelConversations ?? []).find((row) => row.id === conversationId) ?? null;
  const findInvocation = (invocationId) =>
    (state.invocations ?? []).find((row) => row.id === String(invocationId ?? "")) ?? null;

  function settle(event, { status, reply, invocationId = null, data = {} }) {
    runTx(() => {
      event.status = status;
      event.replyText = reply;
      if (invocationId) event.invocationId = invocationId;
      appendEvent({
        invocationId: invocationId ?? null,
        type: status === "dispatched" ? "channel_event_dispatched" : "channel_event_refused",
        level: status === "dispatched" ? "info" : "warn",
        message: `Channel ${event.channelId}: event ${event.id} ${status}.`,
        data: { channelId: event.channelId, eventId: event.id, conversationId: event.conversationId, ...data },
      });
    });
    return { ok: status === "dispatched", status, reply, invocationId };
  }

  function refuseDispatch(event, { code, summary, evidence = {}, reply = GENERIC_DENIED_REPLY }) {
    // The veto is first-class; the in-channel reply stays generic — capability
    // names and existence never leak to an unauthorized sender (ADR 0012 rule 3).
    refuse?.({
      subject: { kind: "channel_event", id: event.id },
      requester: { kind: "channel_identity", id: event.externalUserId ?? null },
      category: "policy",
      code,
      decidedBy: { kind: "server", id: event.channelId },
      summary,
      evidence: { channelId: event.channelId, eventId: event.id, ...evidence },
      remedy: "",
      event: null, // settle() appends the channel_event_refused audit event
    });
    return settle(event, { status: "refused", reply, data: { reason: code } });
  }

  /** Correlated = the invocation was created BY this conversation. */
  function correlatedInvocation(conversation, invocationId) {
    if (!(conversation?.invocationIds ?? []).includes(String(invocationId ?? ""))) return null;
    return findInvocation(invocationId);
  }

  function describeInvocation(invocation) {
    const lines = [`${invocation.id}: ${invocation.status}`];
    if (invocation.status === "succeeded" && invocation.result != null) {
      const summary = typeof invocation.result === "string"
        ? invocation.result
        : invocation.result?.summary ?? invocation.result?.output ?? JSON.stringify(invocation.result);
      lines.push(String(summary).slice(0, 1500));
    }
    if (invocation.statusReason) lines.push(String(invocation.statusReason).slice(0, 300));
    return lines.join("\n");
  }

  function dispatchRun(event, channel, conversation, actor, capabilityName, args) {
    const name = String(capabilityName ?? "").trim();
    if (!name) {
      return settle(event, { status: "refused", reply: "Usage: /run <capability> [args]", data: { reason: "missing_capability" } });
    }
    // Gate 1 (channel-side): the owner's explicit allowlist. Gate 2 (below):
    // the capability gateway's own tenancy/grant checks. Both must pass.
    if (!(channel.capabilityAllowlist ?? []).includes(name)) {
      return refuseDispatch(event, {
        code: "command_not_allowlisted",
        summary: `Capability ${name} is not on channel ${channel.id}'s allowlist.`,
        evidence: { capability: name },
      });
    }
    const result = createCapabilityInvocation(name, { text: args.join(" "), source: "channel" }, actor);
    const invocation = result?.body?.invocation ?? null;
    if (!invocation) {
      // Opaque downstream refusal (unknown, ungranted, unavailable): same reply.
      return settle(event, {
        status: "refused",
        reply: "That capability is not available right now.",
        data: { reason: "capability_dispatch_failed", capability: name, downstreamStatus: result?.status ?? null },
      });
    }
    runTx(() => {
      // Taint travels (parent AC #5): the invocation carries the shared
      // untrusted-input tag plus the channel correlation for evidence.
      invocation.options = invocation.options ?? {};
      invocation.options.metadata = {
        ...invocation.options.metadata,
        channel: { channelId: channel.id, conversationId: conversation.id, eventId: event.id },
        riskTags: [...new Set([...(invocation.options.metadata?.riskTags ?? []), UNTRUSTED_INPUT_TAG])],
      };
      conversation.invocationIds = [...(conversation.invocationIds ?? []), invocation.id];
      conversation.updatedAt = now();
    });
    const pending = invocation.status === "waiting_for_local_approval";
    return settle(event, {
      status: "dispatched",
      invocationId: invocation.id,
      reply: pending
        ? `${invocation.id} needs approval to run ${name}${args.length ? ` (${args.join(" ").slice(0, 120)})` : ""}. Reply /approve ${invocation.id} to confirm (valid 10 minutes), or /cancel ${invocation.id}.`
        : `${invocation.id} ${invocation.status} (${name}). Reply /result ${invocation.id} for the outcome.`,
      data: { capability: name, invocationStatus: invocation.status, traceId: invocation.traceId ?? null, riskTags: [UNTRUSTED_INPUT_TAG] },
    });
  }

  const pendingApprovalFor = (invocation) =>
    (state.approvalRequests ?? []).find((row) => row.invocationId === invocation.id && row.status === "pending") ?? null;

  /**
   * Dispatch one imported event. Deterministic and total: every path settles
   * the event as dispatched/refused with a staged reply.
   */
  function dispatchImportedChannelEvent({ eventId } = {}) {
    const event = (state.channelEvents ?? []).find((row) => row.id === String(eventId ?? ""));
    if (!event || event.status !== "imported") {
      return { ok: false, status: "not_dispatchable", reply: null };
    }
    const channel = findChannel(event.channelId);
    const conversation = findConversation(event.conversationId);
    if (!channel || channel.status !== "enabled" || !conversation) {
      return settle(event, { status: "refused", reply: GENERIC_DENIED_REPLY, data: { reason: "channel_not_enabled" } });
    }

    // Identity fails closed BEFORE any command semantics (ADR 0012 rule 3).
    const identity = (state.channelIdentities ?? []).find(
      (row) => row.channelId === channel.id && row.externalUserId === event.externalUserId,
    );
    if (!identity) {
      return refuseDispatch(event, {
        code: "action_not_permitted",
        summary: `Unmapped channel identity refused on ${channel.id}.`,
        evidence: { externalUserId: event.externalUserId },
      });
    }
    const actor = actorForUser(state, identity.userId);

    const parsed = parseChannelCommand(event.content);
    if (!parsed.ok) {
      const reply = parsed.reason === "unknown_command"
        ? `Unknown command ${parsed.attempted}. ${USAGE_REPLY}`
        : USAGE_REPLY;
      return settle(event, { status: "dispatched", reply, data: { reason: parsed.reason } });
    }

    switch (parsed.command) {
      case "/help":
        return settle(event, { status: "dispatched", reply: USAGE_REPLY, data: { command: "/help" } });
      case "/apps": {
        const list = channel.capabilityAllowlist ?? [];
        return settle(event, {
          status: "dispatched",
          reply: list.length ? `Available capabilities:\n${list.join("\n")}` : "No capabilities are allowlisted for this channel yet.",
          data: { command: "/apps" },
        });
      }
      case "/status": {
        // /status is sugar for /run of the configured read capability, so it is
        // a GOVERNED invocation (parent AC #4). Without one configured it
        // degrades to a mechanical conversation summary — still no LLM, no leak.
        if (channel.statusCapability) {
          return dispatchRun(event, channel, conversation, actor, channel.statusCapability, parsed.args);
        }
        const rows = (conversation.invocationIds ?? [])
          .map((id) => findInvocation(id))
          .filter(Boolean)
          .slice(-5)
          .map((invocation) => `${invocation.id}: ${invocation.status}`);
        return settle(event, {
          status: "dispatched",
          reply: rows.length ? rows.join("\n") : "No invocations in this conversation yet.",
          data: { command: "/status" },
        });
      }
      case "/run":
        return dispatchRun(event, channel, conversation, actor, parsed.args[0], parsed.args.slice(1));
      case "/result": {
        const invocation = correlatedInvocation(conversation, parsed.args[0]);
        if (!invocation) {
          // Unknown id and someone else's invocation answer identically; a
          // cross-conversation probe of a REAL id additionally leaves a veto.
          if (findInvocation(parsed.args[0])) {
            return refuseDispatch(event, {
              code: "action_not_permitted",
              summary: `Channel /result probe for an uncorrelated invocation.`,
              evidence: { invocationId: String(parsed.args[0] ?? "") },
              reply: "No such invocation in this conversation.",
            });
          }
          return settle(event, { status: "dispatched", reply: "No such invocation in this conversation.", data: { command: "/result" } });
        }
        return settle(event, {
          status: "dispatched",
          reply: describeInvocation(invocation),
          data: { command: "/result", invocationId: invocation.id },
        });
      }
      case "/cancel": {
        const invocation = correlatedInvocation(conversation, parsed.args[0]);
        if (!invocation) {
          if (findInvocation(parsed.args[0])) {
            return refuseDispatch(event, {
              code: "action_not_permitted",
              summary: "Channel /cancel refused: invocation not correlated to this conversation.",
              evidence: { invocationId: String(parsed.args[0] ?? "") },
              reply: "No such invocation in this conversation.",
            });
          }
          return settle(event, { status: "dispatched", reply: "No such invocation in this conversation.", data: { command: "/cancel" } });
        }
        // A pending-approval invocation cancels by DENYING the approval — that
        // path records the veto and settles the policy record (S6).
        const pending = pendingApprovalFor(invocation);
        if (invocation.status === "waiting_for_local_approval" && pending && typeof denyInvocation === "function") {
          denyInvocation(pending, invocation, actor);
          return settle(event, {
            status: "dispatched",
            reply: `${invocation.id}: ${invocation.status}`,
            data: { command: "/cancel", invocationId: invocation.id, approvalId: pending.id },
          });
        }
        const cancelled = cancelInvocation(invocation, actor);
        return settle(event, {
          status: "dispatched",
          reply: `${invocation.id}: ${cancelled?.body?.invocation?.status ?? invocation.status}`,
          data: { command: "/cancel", invocationId: invocation.id },
        });
      }
      case "/approve": {
        // Correlation IS the requester binding: a conversation is keyed by the
        // provider identity, so an uncorrelated (someone else's) invocation
        // answers exactly like an unknown one — plus a first-class veto.
        const invocation = correlatedInvocation(conversation, parsed.args[0]);
        if (!invocation) {
          if (findInvocation(parsed.args[0])) {
            return refuseDispatch(event, {
              code: "action_not_permitted",
              summary: "Channel /approve refused: invocation not correlated to this conversation.",
              evidence: { invocationId: String(parsed.args[0] ?? "") },
              reply: "No such invocation in this conversation.",
            });
          }
          return settle(event, { status: "dispatched", reply: "No such invocation in this conversation.", data: { command: "/approve" } });
        }
        const approval = pendingApprovalFor(invocation);
        if (invocation.status !== "waiting_for_local_approval" || !approval) {
          return settle(event, {
            status: "dispatched",
            reply: `${invocation.id} has no pending approval (status: ${invocation.status}).`,
            data: { command: "/approve", invocationId: invocation.id, reason: "no_pending_approval" },
          });
        }
        // Freshness: a stale confirmation cannot be approved — re-run instead.
        const requestedAt = Date.parse(approval.createdAt ?? invocation.createdAt ?? "");
        if (Number.isFinite(requestedAt) && Date.parse(now()) - requestedAt > CHANNEL_APPROVAL_TTL_MS) {
          return refuseDispatch(event, {
            code: "action_not_permitted",
            summary: `Channel /approve refused: confirmation expired for ${invocation.id}.`,
            evidence: { invocationId: invocation.id, requestedAt: approval.createdAt ?? null },
            reply: `The confirmation for ${invocation.id} has expired. Send the command again.`,
          });
        }
        if (typeof mintDecisionGrant !== "function" || typeof validateApprovalToken !== "function" || typeof approveInvocation !== "function") {
          return settle(event, {
            status: "refused",
            reply: "In-channel approval is not available. Approve from the console Approvals Center.",
            data: { command: "/approve", reason: "approval_flow_unavailable" },
          });
        }
        // The grant chain (ADR 0012 rule 5): channel message → single-use grant
        // → consume → approve. The audit trail records WHICH message decided.
        const token = mintDecisionGrant({
          action: "invocation.approve",
          targetId: invocation.id,
          sourceDecisionId: event.id,
          decidedBy: identity.userId,
          teamId: actor.teamId ?? null,
        });
        const consumed = validateApprovalToken(token, {
          action: "invocation.approve",
          targetId: invocation.id,
          actor,
          allowLegacy: false,
        });
        if (!consumed.approved) {
          return settle(event, {
            status: "refused",
            reply: "Approval could not be confirmed. Try again or use the console.",
            data: { command: "/approve", reason: consumed.reason ?? "grant_rejected" },
          });
        }
        approveInvocation(approval, invocation, actor);
        return settle(event, {
          status: "dispatched",
          invocationId: invocation.id,
          reply: `${invocation.id} approved — now ${invocation.status}. Reply /result ${invocation.id} for the outcome.`,
          data: { command: "/approve", invocationId: invocation.id, approvalId: approval.id, grantSource: event.id },
        });
      }
      default:
        return settle(event, { status: "dispatched", reply: USAGE_REPLY, data: { reason: "unhandled_command" } });
    }
  }

  return { dispatchImportedChannelEvent };
}
