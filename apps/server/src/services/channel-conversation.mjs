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
import { actorForUser, LOCAL_TEAM_ID } from "../runtime/auth.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";
import { createChannelTaskContext, extendChannelTaskContext } from "./channel-task-context.mjs";

const GENERIC_DENIED_REPLY = "Not authorized for this channel. Contact your team administrator.";
const USAGE_REPLY = `Commands: ${channelCommands.join(" ")}`;

// A staged confirmation goes stale after this long — a fresh /run is required
// (mirrors the approval-grant TTL: a confirm-click artifact, not a work queue).
export const CHANNEL_APPROVAL_TTL_MS = 10 * 60 * 1000;

// Per-conversation /run flow control (#channel-audit): a mapped identity must not
// be able to spawn governed invocations without bound and drain the team budget.
const RUN_RATE_MAX = 10;
const RUN_RATE_WINDOW_MS = 60 * 1000;
// Fallback per-channel/day /task ceiling for a channel record that predates the
// field (mirrors DEFAULT_TASK_DAILY_LIMIT in channels.mjs).
const TASK_DAILY_LIMIT_FALLBACK = 50;

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
  // /task: files a GitHub issue in the channel's bound project (with the
  // auto-trigger label) so the existing dispatcher routes + starts a tracked
  // auto-run. Async (runs `gh`); null → /task unavailable.
  createChannelTaskIssue = null,
  // S6: the grant chokepoint — /approve mints a single-use grant sourced from
  // the channel message, consumes it, and only then flips the invocation.
  mintDecisionGrant = null,
  validateApprovalToken = null,
  approveInvocation = null,
  denyInvocation = null,
}) {
  const runTx = makeRunTx({ store, persistStateSoon });

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

  // Shared sliding-window rate check for work-spawning commands (/run, /task).
  function runRateCheck(conversation) {
    const nowMs = Date.parse(now());
    const recentRuns = (conversation.recentRuns ?? []).filter((t) => nowMs - t < RUN_RATE_WINDOW_MS);
    return { nowMs, recentRuns, limited: recentRuns.length >= RUN_RATE_MAX };
  }

  // /task: record free-text work as a TRACKED item. Files a GitHub issue in the
  // channel's bound project with the auto-trigger label — the existing single
  // dispatcher then routes it to a worker and starts an auto-run, so the task
  // shows on the six-state board with a status and work path. The bound project
  // (owner-set) IS the authorization to file from this channel's untrusted input.
  async function dispatchTask(event, channel, conversation, description) {
    const text = String(description ?? "").replace(/\s+/g, " ").trim();
    if (!text) {
      return settle(event, { status: "refused", reply: "Usage: /task <what needs doing>", data: { reason: "missing_description" } });
    }
    if (!channel.taskProjectId || typeof createChannelTaskIssue !== "function") {
      return settle(event, {
        status: "refused",
        reply: "This channel can't file tasks yet — an admin must bind a task project in the console.",
        data: { reason: "no_task_project" },
      });
    }
    const identity = (state.channelIdentities ?? []).find(
      (row) => row.channelId === channel.id && row.externalUserId === event.externalUserId,
    );
    let taskContext;
    try {
      taskContext = createChannelTaskContext({
        channel, conversation, event, identity,
        terminalId: channel.taskTerminalId ?? "dev_local",
        projectId: channel.taskProjectId,
      });
    } catch (error) {
      return settle(event, {
        status: "refused",
        reply: "The task attachments or local execution binding are not ready.",
        data: { reason: error?.code ?? "channel_task_context_invalid" },
      });
    }
    const rate = runRateCheck(conversation);
    if (rate.limited) {
      return settle(event, { status: "refused", reply: `Too many requests — at most ${RUN_RATE_MAX} per minute. Try again shortly.`, data: { reason: "rate_limited" } });
    }
    // Second limiter: a per-channel/day aggregate ceiling across ALL users (the
    // per-conversation minute limit alone lets many identities flood the repo).
    const today = String(now()).slice(0, 10);
    const dayCount = channel.taskDayDate === today ? (channel.taskDayCount ?? 0) : 0;
    const dailyLimit = Number.isInteger(channel.taskDailyLimit) ? channel.taskDailyLimit : TASK_DAILY_LIMIT_FALLBACK;
    if (dayCount >= dailyLimit) {
      return settle(event, { status: "refused", reply: `This channel has reached its daily task limit (${dailyLimit}). Try again tomorrow.`, data: { reason: "daily_limit_reached" } });
    }
    // Reserve BOTH slots SYNCHRONOUSLY, before the `await` below — otherwise two
    // concurrent /task both read the pre-write windows and both pass (TOCTOU),
    // and the stale-snapshot write would clobber a /run appended during the await.
    runTx(() => {
      conversation.recentRuns = [...rate.recentRuns, rate.nowMs];
      channel.taskDayDate = today;
      channel.taskDayCount = dayCount + 1;
      conversation.updatedAt = now();
    });
    // Trust model: default = CAPTURE (file a tracked request a human promotes);
    // opt-in per channel = auto-route (file with the dispatcher label directly).
    const autoRoute = Boolean(channel.taskAutoRoute);
    const title = text.slice(0, 120);
    let filed;
    try {
      filed = await createChannelTaskIssue({
        projectId: channel.taskProjectId,
        // Use-time tenancy re-check: a binding is validated same-team when SET,
        // but a project's ownerTeamId can change (re-registration) — pass the
        // channel's team so the filer refuses a drifted cross-team binding.
        channelOwnerTeamId: channel.ownerTeamId ?? null,
        title,
        description: text,
        channelId: channel.id,
        externalUserId: event.externalUserId,
        // Taint travels: a message the injection detector flagged files with the
        // untrusted marker so downstream governance sees it (parity with mail).
        injectionSuspicious: Boolean(event.injectionSuspicious),
        inputAssets: taskContext.attachmentAssets,
        terminalId: taskContext.terminalId,
        channelTaskContext: taskContext,
        autoRoute,
      });
    } catch (error) {
      filed = { ok: false, error: String(error?.message ?? error) };
    }
    if (!filed?.ok || !Number.isFinite(filed.number)) {
      return settle(event, { status: "refused", reply: "Could not create the local task right now — please try again.", data: { reason: filed?.reason ?? "work_item_create_failed" } });
    }
    const boundTaskContext = extendChannelTaskContext(taskContext, {
      workItemId: filed.workItemId ?? null,
      traceId: filed.workItemId ?? taskContext.traceId,
    });
    runTx(() => {
      conversation.taskIssues = [...(conversation.taskIssues ?? []), {
        number: filed.number, localRef: filed.localRef ?? null, workItemId: filed.workItemId ?? null,
        url: filed.url ?? null, at: now(),
      }].slice(-50);
      // Capture mode: record a request that shows up as a pending decision until a
      // human routes (→ auto-run) or dismisses it. Bounded newest-keeps.
      if (!autoRoute) {
        const request = {
          id: nextId("ctr"),
          channelId: channel.id,
          conversationId: conversation.id,
          projectId: channel.taskProjectId,
          issueNumber: filed.number,
          localRef: filed.localRef ?? null,
          workItemId: filed.workItemId ?? null,
          issueUrl: filed.url ?? null,
          title,
          externalUserId: event.externalUserId,
          terminalId: taskContext.terminalId,
          inputAssets: taskContext.attachmentAssets,
          channelTaskContext: boundTaskContext,
          status: "pending",
          autoRunId: null,
          createdAt: now(),
        };
        state.channelTaskRequests = [...(state.channelTaskRequests ?? []), request].slice(-500);
      }
      conversation.updatedAt = now();
    });
    return settle(event, {
      status: "dispatched",
      reply: autoRoute
        ? `Created ${filed.localRef ?? `LOCAL-${filed.number}`}${filed.url ? ` (${filed.url})` : ""} — queued on this terminal and tracked.`
        : `Created ${filed.localRef ?? `LOCAL-${filed.number}`}${filed.url ? ` (${filed.url})` : ""} — awaiting a route/dismiss decision in the console.`,
      data: {
        command: "/task", issueNumber: filed.number, localRef: filed.localRef ?? null,
        workItemId: filed.workItemId ?? null, projectId: channel.taskProjectId, autoRoute,
      },
    });
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
    // Flow control: bound how many governed tasks a single conversation can spawn
    // per window. Not a policy veto — rate limiting — so it settles as a refused
    // reply, not a taxonomy refusal.
    const rate = runRateCheck(conversation);
    if (rate.limited) {
      return settle(event, {
        status: "refused",
        reply: `Too many requests — at most ${RUN_RATE_MAX} per minute. Try again shortly.`,
        data: { reason: "rate_limited", capability: name },
      });
    }
    const { nowMs, recentRuns } = rate;
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
      // Record this run for the sliding-window rate limit (pruned to the window).
      conversation.recentRuns = [...recentRuns, nowMs];
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
  // Returns the settled result synchronously for every command EXCEPT /task,
  // which does I/O (files a GitHub issue) and returns a Promise. The composer
  // `await`s the result, which normalizes both; sync-command callers/tests are
  // unaffected (they never hit the /task path).
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
    // Fail CLOSED on identity drift (code-review H1): a stale mapping whose user
    // was deleted or moved teams must NOT dispatch. `actorForUser` silently
    // falls back to usr_local/state.users[0] with role "owner" — so without this
    // check an external sender could act as an owner, possibly cross-team. The
    // mapped user must still exist AND belong to the channel's owning team.
    const mappedUser = (state.users ?? []).find((row) => row.id === identity.userId);
    const channelTeam = channel.ownerTeamId ?? identity.ownerTeamId ?? LOCAL_TEAM_ID;
    if (!mappedUser || (mappedUser.teamId ?? LOCAL_TEAM_ID) !== channelTeam) {
      return refuseDispatch(event, {
        code: "action_not_permitted",
        summary: `Channel identity ${identity.id} no longer maps to a valid same-team user.`,
        evidence: { externalUserId: event.externalUserId, mappedUserId: identity.userId },
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
      case "/task":
        return dispatchTask(event, channel, conversation, parsed.args.join(" "));
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
        // Fail CLOSED when the timestamp can't be established (code-review LOW):
        // an unparseable createdAt must refuse, not skip the TTL gate.
        const requestedAt = Date.parse(approval.createdAt ?? invocation.createdAt ?? "");
        if (!Number.isFinite(requestedAt) || Date.parse(now()) - requestedAt > CHANNEL_APPROVAL_TTL_MS) {
          return refuseDispatch(event, {
            code: "action_not_permitted",
            summary: `Channel /approve refused: confirmation expired or undatable for ${invocation.id}.`,
            evidence: { invocationId: invocation.id, requestedAt: approval.createdAt ?? null },
            reply: `The confirmation for ${invocation.id} has expired. Send the command again.`,
          });
        }
        // Self-approval gate (#channel-audit): a channel conversation IS one
        // external identity, so /approve here is ALWAYS requester == approver —
        // the same person who /run the risky capability would satisfy its own
        // local-approval gate. Unless the owner explicitly opted this channel into
        // self-approval, route the decision to the console (a separate operator),
        // preserving the human gate's separation.
        if (!channel.allowSelfApprove) {
          return refuseDispatch(event, {
            code: "action_not_permitted",
            summary: `Channel /approve refused: self-approval disabled for ${invocation.id}.`,
            evidence: { invocationId: invocation.id, channelId: channel.id },
            reply: `${invocation.id} needs approval by a separate operator — approve it in the console Approvals Center.`,
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
        // Confirm the approval actually took (code-review LOW): the single-use
        // grant is already consumed, so if approveInvocation didn't flip the
        // invocation off waiting_for_local_approval, report the honest state
        // rather than a misleading "approved".
        if (invocation.status === "waiting_for_local_approval") {
          return settle(event, {
            status: "refused",
            invocationId: invocation.id,
            reply: `${invocation.id} could not be approved (still ${invocation.status}). Try the console Approvals Center.`,
            data: { command: "/approve", invocationId: invocation.id, reason: "approve_did_not_apply" },
          });
        }
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
