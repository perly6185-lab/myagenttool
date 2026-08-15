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
import {
  channelIntentRequiresClarification,
  normalizeChannelIntentResult,
} from "./channel-intent.mjs";

const GENERIC_DENIED_REPLY = "Not authorized for this channel. Contact your team administrator.";
const USAGE_REPLY = `你可以直接发送文字、图片、语音或文件，我会先整理成任务再执行。\n\n常用操作：确认、修改、取消、我的任务、继续第一个任务、重试、暂停、继续、重发结果、转人工。\n高级命令：重试 T-xxxx、暂停 T-xxxx、重发结果 T-xxxx、转人工 T-xxxx、${channelCommands.join("、")}`;

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

// Natural-language intake is deliberately conservative: it groups nearby
// messages, proposes a task, and waits for an explicit confirmation before it
// enters the existing Task/Invocation governance path.
export const CHANNEL_INTAKE_QUIET_MS = 5 * 1000;
const CHANNEL_INTAKE_MAX_MS = 30 * 1000;
const CHANNEL_INTAKE_MAX_EVENTS = 8;
const CHANNEL_THREAD_TTL_MS = 30 * 60 * 1000;
export const CHANNEL_WAITING_USER_TTL_MS = 30 * 60 * 1000;
export const CHANNEL_RUNNING_TTL_MS = 24 * 60 * 60 * 1000;
const THREAD_CONFIRMATIONS = new Set(["确认", "确定", "开始", "执行", "可以", "好的", "好", "yes", "ok"]);
const THREAD_CANCELLATIONS = new Set(["取消", "不要了", "放弃", "cancel", "no"]);
const NEW_TASK_PREFIX = /^(另外|另一个|还有一个|再帮我|除此之外|新任务|另一个任务)(?:\s|$)/i;
const TASK_LIST_REQUESTS = new Set(["我的任务", "查看任务", "任务列表", "有哪些任务", "任务状态"]);
const TASK_PROGRESS_REQUESTS = new Set(["当前进度", "进度怎么样", "现在做到哪了", "现在什么情况", "还有多久", "排队情况", "排队到哪了", "任务进展", "进展如何", "做得怎么样"]);
const TASK_RESULT_RESEND_REQUESTS = new Set(["重发结果", "再发一次", "再发一次结果", "把结果发我", "重新发送结果", "结果再发一次"]);
const HELP_REQUESTS = new Set(["帮助", "怎么用", "如何使用", "我能做什么", "help"]);
const TASK_THREAD_ACTIVE_STATUSES = new Set(["awaiting_confirmation", "waiting_approval", "queued", "running", "waiting_user"]);
export const CHANNEL_INTENT_CONFIDENCE_THRESHOLD = 0.65;

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
  answerClarify = null,
  retryAutoRun = null,
  cancelAutoRun = null,
  classifyIntent = null,
  replySender = null,
  resendDelivery = null,
  notifyHumanTakeover = null,
  intakeQuietMs = CHANNEL_INTAKE_QUIET_MS,
}) {
  const runTx = makeRunTx({ store, persistStateSoon });
  const intakeTimers = new Map();
  const threadLocks = new Set();

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
        data: {
          channelId: event.channelId,
          eventId: event.id,
          conversationId: event.conversationId,
          ...(event.intentDecision ? { intentDecision: event.intentDecision } : {}),
          ...data,
        },
      });
    });
    return { ok: status === "dispatched", status, reply, invocationId, data };
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

  function normalizedText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function threadRef(thread) {
    if (thread?.shortRef) return thread.shortRef;
    const suffix = String(thread?.id ?? "").split("_").pop() || "000";
    return `T-${suffix}`;
  }

  function setThreadStatus(thread, status, reason = null) {
    if (!thread || thread.status === status) return;
    thread.statusHistory = [...(thread.statusHistory ?? []), {
      status,
      reason,
      at: now(),
    }].slice(-30);
    thread.status = status;
    if (["awaiting_confirmation", "waiting_approval", "waiting_user"].includes(status)) {
      thread.expiresAt = new Date(Date.parse(now()) + CHANNEL_WAITING_USER_TTL_MS).toISOString();
    } else if (["queued", "running"].includes(status)) {
      thread.expiresAt = new Date(Date.parse(now()) + CHANNEL_RUNNING_TTL_MS).toISOString();
    } else if (["succeeded", "failed", "cancelled", "paused", "human_takeover"].includes(status)) {
      thread.expiresAt = null;
    }
    thread.nextAction = threadNextAction(status);
    thread.lastProgressAt = now();
    thread.lastProgressSummary = `状态更新：${taskThreadStatus({ status })}`;
    thread.lastActivityAt = now();
  }

  function threadNextAction(status) {
    return ({
      awaiting_confirmation: "回复“确认”开始，或继续补充、回复“取消”",
      waiting_approval: "等待确认后开始执行",
      queued: "等待前面的任务完成，系统会自动开始",
      running: "等待执行完成，系统会自动通知",
      waiting_user: "请直接回复需要补充的信息",
      human_takeover: "等待人工回复",
      succeeded: "查看任务结果或继续描述新的需求",
      failed: "回复“重试”再次执行，或回复“转人工”",
      cancelled: "如需处理，请重新描述任务",
      paused: "回复“继续”恢复任务，或回复“取消”放弃",
    })[status] ?? "查看任务状态";
  }

  function pendingThread(conversation) {
    const preferredId = conversation.activeTaskThreadId ?? null;
    const current = (state.channelTaskThreads ?? [])
      .filter((thread) => thread.conversationId === conversation.id && thread.status === "awaiting_confirmation")
      .sort((left, right) => {
        if (left.id === preferredId) return -1;
        if (right.id === preferredId) return 1;
        return String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? ""));
      })[0] ?? null;
    if (!current) return null;
    const expiresAt = Date.parse(current.expiresAt ?? "");
    if (Number.isFinite(expiresAt) && Date.parse(now()) >= expiresAt) {
      runTx(() => {
        setThreadStatus(current, "cancelled", "expired");
        current.waitingFor = null;
        current.cancelReason = "expired";
        current.updatedAt = now();
      });
      return null;
    }
    return current;
  }

  function isConfirmation(text) {
    return THREAD_CONFIRMATIONS.has(normalizedText(text).toLowerCase());
  }

  function isCancellation(text) {
    return THREAD_CANCELLATIONS.has(normalizedText(text).toLowerCase());
  }

  function isNewTask(text) {
    return NEW_TASK_PREFIX.test(normalizedText(text));
  }

  function recentTaskThreads(conversation) {
    return (state.channelTaskThreads ?? [])
      .filter((thread) => thread.conversationId === conversation?.id)
      .sort((left, right) => String(right.updatedAt ?? right.createdAt ?? "").localeCompare(String(left.updatedAt ?? left.createdAt ?? "")));
  }

  function taskOrdinal(value) {
    const match = value.match(/^(取消|重试|再试一次|转人工|人工处理|人工|继续|选择|切换|查看|看看|状态)?\s*(?:第\s*)?([0-9]+|[一二三四五六七八九十])\s*(?:个|项|条)?(?:的)?(?:任务)?$/i);
    if (!match) return null;
    const numerals = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
    const index = Number.isFinite(Number(match[2])) ? Number(match[2]) : numerals[match[2]];
    return Number.isInteger(index) && index > 0 && index <= 10 ? { action: match[1] ?? "status", index } : null;
  }

  function taskControl(text, conversation = null) {
    const value = normalizedText(text);
    if (HELP_REQUESTS.has(value.toLowerCase())) return { kind: "help", ref: null };
    if (TASK_LIST_REQUESTS.has(value)) return { kind: "list", ref: null };
    const cancel = value.match(/^取消\s+(T-[a-z0-9_-]+)$/i);
    if (cancel) return { kind: "cancel", ref: cancel[1].toUpperCase() };
    const retry = value.match(/^(?:重试|再试一次)\s+(T-[a-z0-9_-]+)$/i);
    if (retry) return { kind: "retry", ref: retry[1].toUpperCase() };
    const resend = value.match(/^(?:重发|重新发送|再发一次)(?:结果|消息)?\s+(T-[a-z0-9_-]+)$/i);
    if (resend) return { kind: "resend", ref: resend[1].toUpperCase() };
    const pause = value.match(/^暂停(?:任务)?(?:\s+(T-[a-z0-9_-]+))?$/i);
    if (pause?.[1]) return { kind: "pause", ref: pause[1].toUpperCase() };
    const resume = value.match(/^(?:继续执行|恢复|恢复任务)(?:\s+(T-[a-z0-9_-]+))?$/i);
    if (resume?.[1]) return { kind: "resume", ref: resume[1].toUpperCase() };
    const handoff = value.match(/^(?:转人工|人工处理|人工)\s+(T-[a-z0-9_-]+)$/i);
    if (handoff) return { kind: "handoff", ref: handoff[1].toUpperCase() };
    const select = value.match(/^(?:继续|选择|切换)\s+(T-[a-z0-9_-]+)$/i);
    if (select) return { kind: "select", ref: select[1].toUpperCase() };
    const status = value.match(/^(?:查看|状态|继续)?\s*(T-[a-z0-9_-]+)$/i);
    if (status) return { kind: "status", ref: status[1].toUpperCase() };
    if (conversation) {
      const recent = recentTaskThreads(conversation);
      const latest = recent[0] ?? null;
      if (TASK_PROGRESS_REQUESTS.has(value)) return { kind: "status", ref: latest ? threadRef(latest) : null, friendly: true };
      if (TASK_RESULT_RESEND_REQUESTS.has(value)) return { kind: "resend", ref: latest ? threadRef(latest) : null, friendly: true };
      if (pause && latest && TASK_THREAD_ACTIVE_STATUSES.has(latest.status)) return { kind: "pause", ref: threadRef(latest), friendly: true };
      if (resume && latest && latest.status === "paused") return { kind: "resume", ref: threadRef(latest), friendly: true };
      const ordinal = taskOrdinal(value);
      if (ordinal) {
        const selected = recent[ordinal.index - 1];
        if (selected) {
          const kind = ordinal.action === "取消" ? "cancel"
            : ["重试", "再试一次"].includes(ordinal.action) ? "retry"
              : ["转人工", "人工处理", "人工"].includes(ordinal.action) ? "handoff"
                : ["继续", "选择", "切换"].includes(ordinal.action) ? "select" : "status";
          return { kind, ref: threadRef(selected), friendly: true };
        }
      }
      if (latest && value === "重试" && ["failed", "cancelled"].includes(latest.status)) return { kind: "retry", ref: threadRef(latest), friendly: true };
      if (latest && ["暂停", "暂停任务"].includes(value) && TASK_THREAD_ACTIVE_STATUSES.has(latest.status)) return { kind: "pause", ref: threadRef(latest), friendly: true };
      if (latest && ["继续执行", "恢复", "恢复任务"].includes(value) && latest.status === "paused") return { kind: "resume", ref: threadRef(latest), friendly: true };
      if (latest && value === "继续" && latest.status === "paused") return { kind: "resume", ref: threadRef(latest), friendly: true };
      if (latest && value === "取消" && TASK_THREAD_ACTIVE_STATUSES.has(latest.status)) return { kind: "cancel", ref: threadRef(latest), friendly: true };
      if (latest && ["转人工", "人工处理", "人工"].includes(value) && TASK_THREAD_ACTIVE_STATUSES.has(latest.status)) return { kind: "handoff", ref: threadRef(latest), friendly: true };
      if (latest && ["查看", "状态"].includes(value)) return { kind: "status", ref: threadRef(latest), friendly: true };
      if (latest && value === "继续") return { kind: "select", ref: threadRef(latest), friendly: true };
      if (latest && /^(?:查看|看看)(?:一下)?(?:刚才|上一个)(?:的)?任务$/i.test(value)) return { kind: "status", ref: threadRef(latest), friendly: true };
      if (latest && /^(?:继续)(?:刚才|上一个)(?:的)?任务$/i.test(value)) return { kind: "select", ref: threadRef(latest), friendly: true };
      if (latest && /^(?:重试)(?:刚才|上一个)(?:失败的)?任务$/i.test(value) && ["failed", "cancelled"].includes(latest.status)) return { kind: "retry", ref: threadRef(latest), friendly: true };
      if (latest && /^(?:取消)(?:刚才|上一个)(?:的)?任务$/i.test(value) && TASK_THREAD_ACTIVE_STATUSES.has(latest.status)) return { kind: "cancel", ref: threadRef(latest), friendly: true };
      if (latest && /^(?:转人工|交给人工)(?:处理)?(?:刚才|上一个)(?:的)?任务$/i.test(value) && TASK_THREAD_ACTIVE_STATUSES.has(latest.status)) return { kind: "handoff", ref: threadRef(latest), friendly: true };
    }
    return null;
  }

  function activeTaskThreads(conversation) {
    return (state.channelTaskThreads ?? [])
      .filter((thread) => thread.conversationId === conversation.id && TASK_THREAD_ACTIVE_STATUSES.has(thread.status))
      .sort((left, right) => String(right.updatedAt ?? right.createdAt ?? "").localeCompare(String(left.updatedAt ?? left.createdAt ?? "")));
  }

  function queueAheadCount(channelId, createdAt, excludeThreadId = null) {
    const cutoff = Date.parse(createdAt ?? now());
    if (!Number.isFinite(cutoff)) return 0;
    return (state.channelTaskThreads ?? []).filter((candidate) => {
      if (candidate.channelId !== channelId || candidate.id === excludeThreadId) return false;
      if (!["queued", "running"].includes(candidate.status)) return false;
      const candidateCreated = Date.parse(candidate.createdAt ?? candidate.updatedAt ?? "");
      if (!Number.isFinite(candidateCreated)) return false;
      // Test clocks and some persisted imports can share a timestamp. The
      // generated id is the stable tie-breaker used by the queue sorter.
      return candidateCreated < cutoff
        || (candidateCreated === cutoff && String(candidate.id).localeCompare(String(excludeThreadId)) < 0);
    }).length;
  }

  function queueMessage(thread) {
    const ahead = Number(thread?.queueAheadCount ?? 0);
    return ahead > 0
      ? `任务已收录，前面还有 ${ahead} 个任务。前面的任务完成后会自动开始，你不需要重复发送。`
      : "任务已收录，即将开始处理。完成后我会通知你。";
  }

  function refreshQueuePositions(channelId, { notify = false } = {}) {
    const queued = (state.channelTaskThreads ?? [])
      .filter((thread) => thread.channelId === channelId && ["queued", "running"].includes(thread.status))
      .sort((left, right) => String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")) || left.id.localeCompare(right.id));
    let ahead = 0;
    const notifications = [];
    runTx(() => {
      for (const thread of queued) {
        const previous = Number.isInteger(thread.queueAheadCount) ? thread.queueAheadCount : null;
        if (thread.status === "running") {
          thread.queueAheadCount = 0;
          thread.queuePosition = 0;
          // A running task still occupies the lane. It is not assigned a
          // queue number itself, but it remains ahead of every queued task.
          ahead += 1;
        } else {
          thread.queueAheadCount = ahead;
          thread.queuePosition = ahead + 1;
          if (notify && previous != null && ahead < previous) {
            notifications.push({
              channelId: thread.channelId,
              conversationId: thread.conversationId,
              threadId: thread.id,
              content: `排队有更新，你的任务前面还有 ${ahead} 个任务，前面的任务完成后会自动开始。`,
            });
          }
          ahead += 1;
        }
      }
    });
    for (const notification of notifications) sendDeferredReply(notification);
    return queued;
  }

  function classifyNaturalIntent(text, conversation) {
    const value = normalizedText(text);
    const control = taskControl(value, conversation);
    const active = activeTaskThreads(conversation);
    const waitingUser = active.filter((thread) => thread.status === "waiting_user");
    const preferredWaitingUser = waitingUser.find((thread) => thread.id === conversation.activeTaskThreadId) ?? null;
    const fallback = control
      ? { intent: control.kind, confidence: 1, ref: control.ref ?? null, source: "deterministic" }
      : isConfirmation(value)
        ? { intent: "confirm", confidence: 1, source: "deterministic" }
        : isCancellation(value)
          ? { intent: "cancel", confidence: 1, source: "deterministic" }
          : isNewTask(value)
            ? { intent: "new_task", confidence: 0.98, source: "deterministic" }
            : preferredWaitingUser
              ? { intent: "supplement", confidence: 0.96, ref: threadRef(preferredWaitingUser), source: "deterministic" }
              : active.length > 1
              ? { intent: "ambiguous", confidence: 0.35, source: "deterministic" }
              : waitingUser.length === 1
                ? { intent: "supplement", confidence: 0.92, ref: threadRef(waitingUser[0]), source: "deterministic" }
                : { intent: "new_task", confidence: 0.78, source: "deterministic" };
    // Explicit controls are already exact and must not be reinterpreted by a
    // model. The adapter is reserved for natural-language messages where the
    // local fallback benefits from context, such as supplement vs new_task.
    if (typeof classifyIntent !== "function" || control || isConfirmation(value) || isCancellation(value) || isNewTask(value)) {
      return normalizeChannelIntentResult(fallback, { fallback, activeRefs: new Set(active.map(threadRef)) });
    }
    try {
      const proposed = classifyIntent({ text: value, conversationId: conversation.id, activeThreads: active.map((thread) => ({ ref: threadRef(thread), status: thread.status, summary: String(thread.summary ?? "").slice(0, 400) })) });
      if (proposed && typeof proposed.then === "function") {
        return proposed
          .then((result) => normalizeChannelIntentResult(result, { fallback, activeRefs: new Set(active.map(threadRef)) }))
          .catch(() => normalizeChannelIntentResult(fallback, { fallback, activeRefs: new Set(active.map(threadRef)) }));
      }
      return normalizeChannelIntentResult(proposed, { fallback, activeRefs: new Set(active.map(threadRef)) });
    } catch {
      return normalizeChannelIntentResult(fallback, { fallback, activeRefs: new Set(active.map(threadRef)) });
    }
  }

  function recordIntentDecision(event, decision, { activeCount = 0, chosenThreadId = null } = {}) {
    const normalized = normalizeChannelIntentResult(decision, { fallback: decision });
    runTx(() => {
      event.intentDecision = {
        intent: normalized.intent,
        confidence: normalized.confidence,
        ref: normalized.ref,
        source: normalized.source,
      };
      const metrics = state.channelIntentMetrics ?? {
        total: 0,
        byIntent: {},
        lowConfidence: 0,
        ambiguous: 0,
        bySource: {},
        updatedAt: null,
      };
      metrics.total = Number(metrics.total ?? 0) + 1;
      metrics.byIntent = { ...(metrics.byIntent ?? {}), [normalized.intent]: Number(metrics.byIntent?.[normalized.intent] ?? 0) + 1 };
      metrics.bySource = { ...(metrics.bySource ?? {}), [normalized.source]: Number(metrics.bySource?.[normalized.source] ?? 0) + 1 };
      if (channelIntentRequiresClarification(normalized, CHANNEL_INTENT_CONFIDENCE_THRESHOLD)) metrics.lowConfidence = Number(metrics.lowConfidence ?? 0) + 1;
      if (normalized.intent === "ambiguous") metrics.ambiguous = Number(metrics.ambiguous ?? 0) + 1;
      metrics.updatedAt = now();
      state.channelIntentMetrics = metrics;
      appendEvent({
        invocationId: null,
        type: "channel_intent_classified",
        level: channelIntentRequiresClarification(normalized, CHANNEL_INTENT_CONFIDENCE_THRESHOLD) ? "warn" : "info",
        message: `Channel ${event.channelId}: natural intent classified.`,
        data: {
          channelId: event.channelId,
          conversationId: event.conversationId,
          eventId: event.id,
          intent: normalized.intent,
          confidence: normalized.confidence,
          source: normalized.source,
          activeCount,
          chosenThreadId,
        },
      });
    });
    return normalized;
  }

  function sendDeferredReply({ channelId, conversationId, content, threadId = null }) {
    if (typeof replySender !== "function" || !content) return;
    try {
      const result = replySender({ channelId, conversationId, content, threadId });
      if (result?.catch) result.catch(() => {});
    } catch {
      // The durable event/thread remains authoritative if the provider is down.
    }
  }

  function threadSummary(thread) {
    const text = (thread.messages ?? []).map((message) => normalizedText(message.content)).filter(Boolean).join(" ");
    const attachmentLabels = (thread.attachmentAssets ?? []).slice(0, 5).map((asset) => {
      const family = String(asset?.family ?? "附件").toLowerCase();
      const familyLabel = ({ image: "图片", audio: "语音", video: "视频", file: "文件", document: "文档" })[family];
      if (familyLabel) return familyLabel;
      const name = String(asset?.name ?? asset?.path?.split(/[\\/]/).at(-1) ?? "").trim();
      return name ? name.slice(0, 120) : "附件";
    });
    const attachmentSummary = attachmentLabels.length
      ? `（附件：${attachmentLabels.join("、")}${(thread.attachmentAssets ?? []).length > attachmentLabels.length ? "等" : ""}）`
      : "";
    if (text) return `${text}${attachmentSummary}`.slice(0, 4000);
    return attachmentLabels.length
      ? `处理${attachmentLabels.join("、")}${(thread.attachmentAssets ?? []).length > attachmentLabels.length ? "等附件" : ""}`.slice(0, 4000)
      : "处理这条消息";
  }

  function appendThreadMessage(thread, event) {
    thread.messages = [...(thread.messages ?? []), {
      eventId: event.id,
      content: normalizedText(event.content),
      receivedAt: now(),
    }].slice(-CHANNEL_INTAKE_MAX_EVENTS);
    thread.sourceEventIds = [...(thread.sourceEventIds ?? []), event.id].slice(-CHANNEL_INTAKE_MAX_EVENTS);
    thread.updatedAt = now();
    thread.lastActivityAt = now();
  }

  function createImmediateTaskThread(event, conversation, { summary, status = "queued", reason = "explicit_command" } = {}) {
    const timestamp = now();
    const normalizedSummary = normalizedText(summary || event.content).slice(0, 4000) || "执行这项任务";
    const thread = {
      id: nextId("cth"),
      shortRef: null,
      channelId: event.channelId,
      conversationId: conversation.id,
      externalUserId: event.externalUserId,
      sourceEventIds: [event.id],
      messages: [{ eventId: event.id, content: normalizedText(event.content), receivedAt: timestamp }],
      attachmentAssets: [...(event.attachmentAssets ?? [])].slice(0, 20),
      injectionSuspicious: Boolean(event.injectionSuspicious),
      status,
      statusHistory: [{ status, reason, at: timestamp }],
      waitingFor: status === "waiting_approval" ? "approval" : null,
      summary: normalizedSummary,
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: null,
      invocationId: null,
      workItemId: null,
      nextAction: threadNextAction(status),
      lastProgressAt: timestamp,
      lastProgressSummary: `任务${status === "queued" ? "已排队" : "已创建"}`,
      lastDeliveryStatus: null,
      lastDeliveryId: null,
      lastDeliveryError: null,
    };
    if (["queued", "running"].includes(status)) {
      thread.expiresAt = new Date(Date.parse(timestamp) + CHANNEL_RUNNING_TTL_MS).toISOString();
    } else if (["awaiting_confirmation", "waiting_approval", "waiting_user"].includes(status)) {
      thread.expiresAt = new Date(Date.parse(timestamp) + CHANNEL_WAITING_USER_TTL_MS).toISOString();
    }
    thread.shortRef = threadRef(thread);
    runTx(() => {
      state.channelTaskThreads = [...(state.channelTaskThreads ?? []), thread].slice(-500);
      conversation.activeTaskThreadId = thread.id;
      conversation.updatedAt = timestamp;
      event.taskThreadId = thread.id;
    });
    return thread;
  }

  function discardImmediateTaskThread(thread, event, conversation) {
    runTx(() => {
      state.channelTaskThreads = (state.channelTaskThreads ?? []).filter((candidate) => candidate.id !== thread.id);
      if (conversation.activeTaskThreadId === thread.id) conversation.activeTaskThreadId = null;
      if (event.taskThreadId === thread.id) event.taskThreadId = undefined;
    });
  }

  function stampThreadInvocation(thread, invocation) {
    if (!invocation?.id) return;
    invocation.options ??= {};
    invocation.options.metadata = {
      ...(invocation.options.metadata ?? {}),
      channel: {
        ...(invocation.options.metadata?.channel ?? {}),
        channelId: thread.channelId,
        conversationId: thread.conversationId,
        threadId: thread.id,
        workItemId: thread.workItemId ?? null,
        autoRunId: thread.autoRunId ?? null,
        traceId: thread.workItemId ?? thread.id,
      },
    };
  }

  function scheduleIntakeGroup(groupId) {
    const group = (state.channelIntakeGroups ?? []).find((row) => row.id === groupId);
    if (!group || group.status !== "collecting") return;
    const dueAt = Date.parse(group.dueAt ?? now());
    const wait = Math.max(0, dueAt - Date.parse(now()));
    const previous = intakeTimers.get(groupId);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      intakeTimers.delete(groupId);
      finalizeIntakeGroup(groupId);
    }, wait);
    timer.unref?.();
    intakeTimers.set(groupId, timer);
  }

  function finalizeIntakeGroup(groupId, { sendProposal = true } = {}) {
    const group = (state.channelIntakeGroups ?? []).find((row) => row.id === groupId);
    if (!group || group.status !== "collecting") return null;
    const conversation = findConversation(group.conversationId);
    if (!conversation) return null;
    const timestamp = now();
    const thread = {
      id: nextId("cth"),
      shortRef: null,
      channelId: group.channelId,
      conversationId: group.conversationId,
      externalUserId: group.externalUserId,
      sourceEventIds: [...group.eventIds],
      messages: [...group.messages],
      attachmentAssets: [...(group.attachmentAssets ?? [])].slice(0, 20),
      injectionSuspicious: Boolean(group.injectionSuspicious),
      status: "awaiting_confirmation",
      statusHistory: [{ status: "awaiting_confirmation", reason: "proposal", at: timestamp }],
      waitingFor: "confirmation",
      summary: "",
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: new Date(Date.parse(timestamp) + CHANNEL_THREAD_TTL_MS).toISOString(),
      nextAction: threadNextAction("awaiting_confirmation"),
      lastProgressAt: timestamp,
      lastProgressSummary: "任务草稿已整理，等待确认",
      lastDeliveryStatus: null,
      lastDeliveryId: null,
      lastDeliveryError: null,
    };
    thread.shortRef = threadRef(thread);
    thread.summary = threadSummary(thread);
    runTx(() => {
      state.channelTaskThreads = [...(state.channelTaskThreads ?? []), thread].slice(-500);
      conversation.activeTaskThreadId = thread.id;
      group.status = "proposed";
      group.threadId = thread.id;
      group.updatedAt = timestamp;
      for (const eventId of group.eventIds) {
        const event = (state.channelEvents ?? []).find((row) => row.id === eventId);
        if (event) {
          event.intakeGroupId = group.id;
          event.taskThreadId = thread.id;
        }
      }
    });
    if (sendProposal) {
      sendDeferredReply({
        channelId: group.channelId,
        conversationId: group.conversationId,
        threadId: thread.id,
          content: `我理解为：${thread.summary}\n\n这是一个新任务。回复“确认”开始，回复“修改 xxx”补充，回复“取消”放弃。`,
      });
    }
    return thread;
  }

  function queueNaturalEvent(event, conversation) {
    const text = normalizedText(event.content);
    const current = !isNewTask(text)
      ? (state.channelIntakeGroups ?? []).find((group) =>
        group.conversationId === conversation.id && group.status === "collecting")
      : null;
    const timestamp = now();
    let group = current;
    let created = false;
    if (group) {
      const startedAt = Date.parse(group.startedAt ?? timestamp);
      const full = group.eventIds.length >= CHANNEL_INTAKE_MAX_EVENTS
        || (Number.isFinite(startedAt) && Date.parse(timestamp) - startedAt >= CHANNEL_INTAKE_MAX_MS);
      if (full) {
        finalizeIntakeGroup(group.id);
        group = null;
      }
    }
    if (!group) {
      created = true;
      group = {
        id: nextId("cig"),
        channelId: event.channelId,
        conversationId: conversation.id,
        externalUserId: event.externalUserId,
        eventIds: [],
        messages: [],
        attachmentAssets: [],
        injectionSuspicious: false,
        status: "collecting",
        startedAt: timestamp,
        updatedAt: timestamp,
        dueAt: new Date(Date.parse(timestamp) + intakeQuietMs).toISOString(),
      };
      runTx(() => {
        state.channelIntakeGroups = [...(state.channelIntakeGroups ?? []), group].slice(-500);
      });
    }
    runTx(() => {
      group.eventIds = [...group.eventIds, event.id].slice(-CHANNEL_INTAKE_MAX_EVENTS);
      group.messages = [...group.messages, { eventId: event.id, content: text, receivedAt: timestamp }].slice(-CHANNEL_INTAKE_MAX_EVENTS);
      group.attachmentAssets = [...(group.attachmentAssets ?? []), ...(event.attachmentAssets ?? [])].slice(-20);
      group.injectionSuspicious = Boolean(group.injectionSuspicious || event.injectionSuspicious);
      group.updatedAt = timestamp;
      group.dueAt = new Date(Date.parse(timestamp) + intakeQuietMs).toISOString();
      event.intakeGroupId = group.id;
    });
    scheduleIntakeGroup(group.id);
    return settle(event, {
      status: "dispatched",
      reply: created ? "已收到，我正在整理你的需求，稍后请确认。" : null,
      data: { intakeGroupId: group.id, status: "collecting" },
    });
  }

  async function confirmTaskThread(event, channel, conversation, thread) {
    if (threadLocks.has(thread.id)) {
      return settle(event, {
        status: "dispatched",
        reply: "任务正在创建，请稍候。",
        data: { taskThreadId: thread.id, status: "processing" },
      });
    }
    threadLocks.add(thread.id);
    runTx(() => {
      event.injectionSuspicious = Boolean(event.injectionSuspicious || thread.injectionSuspicious);
    });
    try {
      const result = await dispatchTask(event, channel, conversation, thread.summary, {
        threadId: thread.id,
        attachmentAssets: thread.attachmentAssets ?? [],
      });
      runTx(() => {
        const autoRoute = Boolean(result.data?.autoRoute);
        setThreadStatus(thread, result.status === "dispatched" ? (autoRoute ? "queued" : "waiting_approval") : "failed", result.status === "dispatched" ? null : "task_create_failed");
        thread.waitingFor = null;
        thread.confirmedByEventId = event.id;
        thread.workItemId = result.data?.workItemId ?? null;
        thread.updatedAt = now();
        thread.lastProgressAt = now();
        thread.lastProgressSummary = result.status === "dispatched"
          ? (autoRoute ? "任务已进入执行队列" : "任务已创建，等待确认")
          : "任务创建失败，等待重试或人工处理";
        thread.nextAction = threadNextAction(thread.status);
        event.taskThreadId = thread.id;
        if (result.status === "dispatched") {
          if (autoRoute) {
            thread.queueAheadCount = queueAheadCount(thread.channelId, thread.createdAt, thread.id);
            thread.queuePosition = thread.queueAheadCount + 1;
            event.replyText = queueMessage(thread);
          } else {
            event.replyText = "任务已收录，等待确认后开始执行。你不需要重复发送。";
          }
        }
      });
      if (result.status === "dispatched") result.reply = event.replyText;
      return result;
    } finally {
      threadLocks.delete(thread.id);
    }
  }

  function waitingUserThread(conversation) {
    const preferredId = conversation.activeTaskThreadId ?? null;
    return (state.channelTaskThreads ?? [])
      .filter((thread) => thread.conversationId === conversation.id && thread.status === "waiting_user")
      .sort((left, right) => {
        if (left.id === preferredId) return -1;
        if (right.id === preferredId) return 1;
        return String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? ""));
      })[0] ?? null;
  }

  async function answerTaskThread(event, conversation, thread, actor) {
    if (typeof answerClarify !== "function" || !thread.autoRunId) {
      return settle(event, { status: "refused", reply: "当前任务无法接收补充信息，请在控制台继续。", data: { taskThreadId: thread.id, reason: "clarification_unavailable" } });
    }
    if (threadLocks.has(thread.id)) return settle(event, { status: "dispatched", reply: "正在处理上一条补充，请稍候。", data: { taskThreadId: thread.id, status: "processing" } });
    threadLocks.add(thread.id);
    try {
      const answer = normalizedText(event.content);
      runTx(() => {
        appendThreadMessage(thread, event);
        thread.attachmentAssets = [...(thread.attachmentAssets ?? []), ...(event.attachmentAssets ?? [])].slice(-20);
        setThreadStatus(thread, "running", "answer_received");
        thread.waitingFor = null;
        thread.updatedAt = now();
        event.taskThreadId = thread.id;
      });
      const result = await answerClarify(thread.autoRunId, {
        actor,
        answers: answer,
        inputAssets: event.attachmentAssets ?? [],
      });
      const resumed = Boolean(result?.resumed);
      const autoRun = result?.autoRun ?? (state.autoRuns ?? []).find((run) => run.id === thread.autoRunId) ?? null;
      const invocation = result?.invocation ?? null;
      runTx(() => {
        thread.autoRunId = autoRun?.id ?? thread.autoRunId;
        thread.invocationId = invocation?.id ?? autoRun?.invocationId ?? thread.invocationId ?? null;
        stampThreadInvocation(thread, invocation);
        if (result?.waitingForInput || autoRun?.status === "needs_input") {
          setThreadStatus(thread, "waiting_user", "clarification_still_needed");
          thread.waitingFor = "user_input";
        } else if (resumed) {
          setThreadStatus(thread, "running", "clarification_resumed");
          thread.waitingFor = null;
        }
        thread.resultSummary = resumed ? "已收到补充，任务继续执行。" : thread.resultSummary ?? null;
        thread.updatedAt = now();
      });
      return settle(event, {
        status: "dispatched",
        reply: thread.status === "waiting_user"
          ? "当前任务仍需要补充信息，请继续回复。"
          : "已收到补充，任务继续执行。完成后我会通知你。",
        data: { taskThreadId: thread.id, status: thread.status, resumed },
      });
    } catch (error) {
      runTx(() => {
        setThreadStatus(thread, "waiting_user", "clarification_failed");
        thread.waitingFor = "user_input";
        thread.resultSummary = String(error?.message ?? error).slice(0, 1000);
        thread.updatedAt = now();
      });
      return settle(event, { status: "refused", reply: `当前任务暂时无法继续：${String(error?.message ?? error).slice(0, 300)}`, data: { taskThreadId: thread.id, reason: "clarification_failed" } });
    } finally {
      threadLocks.delete(thread.id);
    }
  }

  async function retryTaskThread(event, thread, actor, { friendly = false } = {}) {
    if (typeof retryAutoRun !== "function" || !thread.autoRunId) {
      return settle(event, { status: "refused", reply: `${friendly ? "当前任务" : threadRef(thread)} 不能自动重试，请在控制台处理。`, data: { taskThreadId: thread.id, reason: "retry_unavailable" } });
    }
    if (!["failed", "cancelled"].includes(thread.status)) {
      return settle(event, { status: "dispatched", reply: `${friendly ? "当前任务" : threadRef(thread)} 当前${taskThreadStatus(thread)}，不需要重试。`, data: { taskThreadId: thread.id, status: thread.status } });
    }
    if (threadLocks.has(thread.id)) return settle(event, { status: "dispatched", reply: `${friendly ? "当前任务" : threadRef(thread)} 正在处理，请稍候。`, data: { taskThreadId: thread.id, status: "processing" } });
    threadLocks.add(thread.id);
    try {
      const result = await retryAutoRun(thread.autoRunId, { actor });
      const autoRun = result?.autoRun ?? (state.autoRuns ?? []).find((run) => run.id === thread.autoRunId) ?? null;
      const invocation = result?.invocation ?? null;
      runTx(() => {
        thread.autoRunId = autoRun?.id ?? thread.autoRunId;
        thread.invocationId = invocation?.id ?? autoRun?.invocationId ?? null;
        stampThreadInvocation(thread, invocation);
        setThreadStatus(thread, "running", "retry_requested");
        thread.waitingFor = null;
        thread.resultSummary = "已重新开始执行。";
        thread.updatedAt = now();
        event.taskThreadId = thread.id;
      });
      return settle(event, { status: "dispatched", reply: `${friendly ? "已重新开始执行，完成后我会通知你。" : `${threadRef(thread)} 已重新开始执行，完成后我会通知你。`}`, data: { taskThreadId: thread.id, status: thread.status, retried: true } });
    } catch (error) {
      return settle(event, { status: "refused", reply: `${friendly ? "任务重试失败" : `${threadRef(thread)} 重试失败`}：${String(error?.message ?? error).slice(0, 300)}`, data: { taskThreadId: thread.id, reason: "retry_failed" } });
    } finally {
      threadLocks.delete(thread.id);
    }
  }

  async function handoffTaskThread(event, thread, actor, { friendly = false } = {}) {
    if (!thread || !["awaiting_confirmation", "waiting_approval", "queued", "running", "waiting_user"].includes(thread.status)) {
      return settle(event, { status: "dispatched", reply: `${friendly ? "当前任务" : threadRef(thread)} 当前${taskThreadStatus(thread)}，无需转人工。`, data: { taskThreadId: thread?.id ?? null, reason: "not_active" } });
    }
    if (thread.autoRunId && typeof cancelAutoRun === "function") {
      try { await cancelAutoRun(thread.autoRunId, { actor, reason: "channel_human_takeover" }); } catch { /* human takeover remains safe if cancel races */ }
    }
    runTx(() => {
      setThreadStatus(thread, "human_takeover", "user_requested");
      thread.waitingFor = "human";
      thread.handoffRequestedAt = now();
      thread.handoffRequestedBy = actor?.userId ?? null;
      thread.resultSummary = "已转人工跟进。";
      thread.updatedAt = now();
      const request = (state.channelTaskRequests ?? []).find((candidate) =>
        (thread.workItemId && candidate.workItemId === thread.workItemId)
        || (candidate.threadId && candidate.threadId === thread.id));
      if (request && ["pending", "routed"].includes(request.status)) {
        request.status = "human_takeover";
        request.lastAction = "takeover";
        request.lastActionAt = now();
        request.lastActionBy = actor?.userId ?? null;
      }
      event.taskThreadId = thread.id;
    });
    notifyHumanTakeover?.({
      thread,
      request: (state.channelTaskRequests ?? []).find((candidate) =>
        (thread.workItemId && candidate.workItemId === thread.workItemId)
        || (candidate.threadId && candidate.threadId === thread.id)) ?? null,
      actor,
      reason: "user_requested",
    });
    const channel = findChannel(thread.channelId);
    return settle(event, {
      status: "dispatched",
      reply: channel?.operationMode === "team"
        ? `${friendly ? "任务" : threadRef(thread)} 已转人工，已通知管理员，请等待人工回复。`
        : `${friendly ? "任务" : threadRef(thread)} 已转人工处理，自动执行已暂停，请等待人工回复。`,
      data: { taskThreadId: thread.id, status: thread.status, humanTakeover: true },
    });
  }

  function handleNaturalEvent(event, channel, conversation, actor) {
    const classification = classifyNaturalIntent(normalizedText(event.content), conversation);
    if (classification && typeof classification.then === "function") {
      return classification.then((intent) => handleNaturalEventResolved(event, channel, conversation, actor, intent));
    }
    return handleNaturalEventResolved(event, channel, conversation, actor, classification);
  }

  function handleNaturalEventResolved(event, channel, conversation, actor, classifiedIntent) {
    let thread = pendingThread(conversation);
    if (!thread) thread = waitingUserThread(conversation);
    const text = normalizedText(event.content);
    const parsedControl = taskControl(text, conversation);
    const intent = recordIntentDecision(event, classifiedIntent, {
      activeCount: activeTaskThreads(conversation).length,
      chosenThreadId: thread?.id ?? null,
    });
    const inferredControl = !parsedControl && intent.ref && ["cancel", "retry", "pause", "resume", "resend", "select", "status", "handoff"].includes(intent.intent)
      ? { kind: intent.intent, ref: intent.ref }
      : !parsedControl && !intent.ref && ["cancel", "retry", "pause", "resume", "resend", "status", "handoff"].includes(intent.intent) && activeTaskThreads(conversation).length === 1
        ? { kind: intent.intent, ref: threadRef(activeTaskThreads(conversation)[0]), friendly: true }
        : null;
    const control = parsedControl ?? inferredControl;
    const newTaskIntent = isNewTask(text) || (!parsedControl && intent.intent === "new_task");
    const explicitlySelectedWaitingThread = thread?.status === "waiting_user"
      && conversation.activeTaskThreadId === thread.id;
    if (control?.kind === "help") {
      return settle(event, {
        status: "dispatched",
        reply: "你可以直接发送文字、图片、语音或文件，我会先整理成任务再执行。\n\n回复“确认”开始，回复“修改 xxx”补充，回复“取消”放弃；发送“我的任务”查看进度，也可以说“当前进度”“现在做到哪了”“还有多久”“暂停”“继续”“重发结果”“重试”或“转人工”。\n高级操作仍支持：重试 T-xxxx、暂停 T-xxxx、重发结果 T-xxxx、转人工 T-xxxx。",
        data: { help: true },
      });
    }
    if (control?.kind === "status" && !control.ref) {
      const latest = recentTaskThreads(conversation)[0] ?? null;
      return settle(event, {
        status: "dispatched",
        reply: latest ? taskStatusReply(latest, { label: "当前任务" }) : "你还没有任务线程。直接描述要做的事情，我会先帮你整理。",
        data: { taskStatus: true, taskThreadId: latest?.id ?? null },
      });
    }
    if ((control?.kind === "pause" || control?.kind === "resume") && !control.ref) {
      return settle(event, { status: "dispatched", reply: "当前没有可暂停或恢复的任务。直接描述要做的事情，我会先帮你整理。", data: { taskControl: control.kind, reason: "no_task" } });
    }
    if (control?.kind === "resend" && !control.ref) {
      return settle(event, { status: "dispatched", reply: "当前还没有可重发的任务结果。完成任务后可以回复“重发结果”。", data: { taskControl: control.kind, reason: "no_task" } });
    }
    if (control?.kind === "list") {
      const rows = listTaskThreads(conversation);
      const reply = rows.length
        ? rows.map((row, index) => taskListLine(row, index + 1)).join("\n")
        : "你还没有任务线程。";
      return settle(event, { status: "dispatched", reply, data: { taskThreadList: true, count: rows.length } });
    }
    if (!control && intent.intent === "query") {
      const rows = listTaskThreads(conversation);
      const reply = rows.length
        ? rows.map((row, index) => taskListLine(row, index + 1)).join("\n")
        : "你还没有任务线程。";
      return settle(event, { status: "dispatched", reply, data: { taskThreadList: true, count: rows.length, intent: intent.intent, confidence: intent.confidence } });
    }
    // A freshly proposed draft has priority over older queued/running work.
    // This lets a user say “另外……” and then simply “确认” without having
    // to identify the earlier task; ambiguity is reserved for multiple drafts
    // that are simultaneously waiting for a decision.
    const hasPendingDraft = thread?.status === "awaiting_confirmation"
      && ["confirm", "cancel"].includes(intent.intent);
    if (!control && !explicitlySelectedWaitingThread && !hasPendingDraft
      && (intent.intent === "ambiguous" || (activeTaskThreads(conversation).length > 1 && ["confirm", "cancel", "supplement"].includes(intent.intent)))) {
      return settle(event, { status: "dispatched", reply: candidateSelectionReply(activeTaskThreads(conversation)), data: { intent: intent.intent, confidence: intent.confidence, reason: "multiple_task_candidates" } });
    }
    if (!control && channelIntentRequiresClarification(intent, CHANNEL_INTENT_CONFIDENCE_THRESHOLD)) {
      return settle(event, { status: "dispatched", reply: "我还不确定这句话的意图。请明确说“请帮我……”创建任务，或回复“我的任务”查看已有任务。", data: { intent: intent.intent, confidence: intent.confidence, reason: "low_confidence" } });
    }
    if (control?.ref) {
      const referenced = (state.channelTaskThreads ?? []).find((row) => row.conversationId === conversation.id && threadRef(row).toUpperCase() === control.ref);
      if (!referenced) return settle(event, { status: "dispatched", reply: `${control.ref} 不在当前会话的任务中。`, data: { taskThreadRef: control.ref, reason: "not_found" } });
      if (control.kind === "select") {
        runTx(() => {
          conversation.activeTaskThreadId = referenced.id;
          conversation.updatedAt = now();
        });
        const selectionLabel = control.friendly ? "这个任务" : threadRef(referenced);
        const selectionReply = referenced.status === "waiting_user"
          ? `已切换到 ${selectionLabel}（${taskThreadStatus(referenced)}）。请直接回复需要补充的信息。`
          : referenced.status === "running" || referenced.status === "queued"
            ? `已切换到 ${selectionLabel}（${taskThreadStatus(referenced)}）。任务正在执行中，如需新任务请直接描述新的需求。`
            : referenced.status === "human_takeover"
              ? `已切换到 ${selectionLabel}（人工处理中）。请等待人工回复。`
              : `已切换到 ${selectionLabel}（${taskThreadStatus(referenced)}）。如需继续，请直接描述下一步需求。`;
        return settle(event, { status: "dispatched", reply: selectionReply, data: { taskThreadId: referenced.id, selected: true } });
      }
      if (control.kind === "status") {
        const statusLabel = control.friendly ? "当前任务" : threadRef(referenced);
        return settle(event, { status: "dispatched", reply: taskStatusReply(referenced, { label: statusLabel }), data: { taskThreadId: referenced.id, status: referenced.status } });
      }
      if (control.kind === "pause") {
        if (referenced.status === "paused") return settle(event, { status: "dispatched", reply: "这个任务已经暂停。回复“继续”恢复，或回复“取消”放弃。", data: { taskThreadId: referenced.id, status: referenced.status } });
        if (referenced.status !== "queued") {
          const message = referenced.status === "running"
            ? "任务已经开始执行，当前不能安全暂停。回复“取消”可以停止它。"
            : `当前任务${taskThreadStatus(referenced)}，暂时不能暂停。`;
          return settle(event, { status: "dispatched", reply: message, data: { taskThreadId: referenced.id, status: referenced.status, reason: "pause_unavailable" } });
        }
        runTx(() => {
          setThreadStatus(referenced, "paused", "user_paused");
          referenced.waitingFor = "user";
          referenced.pausedAt = now();
          referenced.pausedByEventId = event.id;
          referenced.updatedAt = now();
          event.taskThreadId = referenced.id;
        });
        refreshQueuePositions(referenced.channelId, { notify: true });
        return settle(event, { status: "dispatched", reply: control.friendly ? "任务已暂停。回复“继续”恢复，或回复“取消”放弃。" : `${threadRef(referenced)} 已暂停。回复“继续”恢复。`, data: { taskThreadId: referenced.id, status: "paused" } });
      }
      if (control.kind === "resume") {
        if (referenced.status !== "paused") return settle(event, { status: "dispatched", reply: `当前任务${taskThreadStatus(referenced)}，不需要恢复。`, data: { taskThreadId: referenced.id, status: referenced.status, reason: "resume_unavailable" } });
        runTx(() => {
          setThreadStatus(referenced, "queued", "user_resumed");
          referenced.waitingFor = null;
          referenced.resumedAt = now();
          referenced.updatedAt = now();
          event.taskThreadId = referenced.id;
        });
        refreshQueuePositions(referenced.channelId);
        return settle(event, { status: "dispatched", reply: control.friendly ? "任务已恢复，已重新排队。完成后我会通知你。" : `${threadRef(referenced)} 已恢复，已重新排队。`, data: { taskThreadId: referenced.id, status: "queued" } });
      }
      if (control.kind === "resend") {
        const resent = typeof resendDelivery === "function"
          ? resendDelivery({ channelId: referenced.channelId, conversationId: referenced.conversationId, threadId: referenced.id })
          : { ok: false, reason: "resend_unavailable" };
        if (!resent?.ok) {
          return settle(event, { status: "dispatched", reply: referenced.resultSummary ? "当前还没有可重发的任务结果，请稍后再试。" : "这个任务还没有生成结果，完成后可以回复“重发结果”。", data: { taskThreadId: referenced.id, reason: resent?.reason ?? "resend_failed" } });
        }
        runTx(() => {
          referenced.lastDeliveryId = resent.deliveryId ?? referenced.lastDeliveryId ?? null;
          referenced.lastDeliveryStatus = "queued";
          referenced.lastDeliveryError = null;
          referenced.updatedAt = now();
          event.taskThreadId = referenced.id;
        });
        return settle(event, { status: "dispatched", reply: control.friendly ? "已重新发送任务结果，请稍候查收。" : `${threadRef(referenced)} 的结果已重新发送，请稍候查收。`, data: { taskThreadId: referenced.id, deliveryId: resent.deliveryId, resend: true } });
      }
      if (control.kind === "cancel" && TASK_THREAD_ACTIVE_STATUSES.has(referenced.status)) {
        if (referenced.autoRunId && typeof cancelAutoRun === "function") {
          try { cancelAutoRun(referenced.autoRunId, { actor }); } catch { /* terminal state below remains authoritative */ }
        }
        if (referenced.invocationId) {
          const invocation = findInvocation(referenced.invocationId);
          if (invocation && typeof cancelInvocation === "function") {
            try { cancelInvocation(invocation, actor); } catch { /* best effort */ }
          }
        }
        runTx(() => {
          setThreadStatus(referenced, "cancelled", "user_cancelled");
          referenced.waitingFor = null;
          referenced.cancelledByEventId = event.id;
          referenced.updatedAt = now();
          event.taskThreadId = referenced.id;
        });
        return settle(event, { status: "dispatched", reply: control.friendly ? "这个任务已取消。" : `${threadRef(referenced)} 已取消。`, data: { taskThreadId: referenced.id, status: "cancelled" } });
      }
      if (control.kind === "retry") return retryTaskThread(event, referenced, actor, { friendly: control.friendly });
      if (control.kind === "handoff") return handoffTaskThread(event, referenced, actor, { friendly: control.friendly });
      if (referenced.autoRunId && typeof cancelAutoRun === "function") {
        try {
          cancelAutoRun(referenced.autoRunId, { actor });
          runTx(() => {
            setThreadStatus(referenced, "cancelled", "user_cancelled");
            referenced.waitingFor = null;
            referenced.cancelledByEventId = event.id;
            referenced.updatedAt = now();
            event.taskThreadId = referenced.id;
          });
          return settle(event, { status: "dispatched", reply: control.friendly ? "已请求取消这个任务。" : `${threadRef(referenced)} 已请求取消。`, data: { taskThreadId: referenced.id, status: "cancelled" } });
        } catch {
          // Fall through to the invocation/console recovery paths below.
        }
      }
      if (referenced.invocationId) {
        const invocation = findInvocation(referenced.invocationId);
        if (invocation) {
          cancelInvocation(invocation, actor);
          runTx(() => {
            setThreadStatus(referenced, "cancelled", "user_cancelled");
            referenced.waitingFor = null;
            referenced.cancelledByEventId = event.id;
            referenced.updatedAt = now();
            event.taskThreadId = referenced.id;
          });
          return settle(event, { status: "dispatched", reply: control.friendly ? "已请求取消这个任务。" : `${threadRef(referenced)} 已请求取消。`, data: { taskThreadId: referenced.id, status: "cancelled" } });
        }
      }
      return settle(event, { status: "dispatched", reply: `${control.friendly ? "当前任务" : threadRef(referenced)} 当前${taskThreadStatus(referenced)}，请在控制台任务详情中取消。`, data: { taskThreadId: referenced.id, status: referenced.status, reason: "console_action_required" } });
    }
    if (!thread && isConfirmation(text)) {
      const group = (state.channelIntakeGroups ?? []).find((row) =>
        row.conversationId === conversation.id && row.status === "collecting");
      if (group) thread = finalizeIntakeGroup(group.id, { sendProposal: false });
    }
    if (thread?.status === "waiting_user"
      && !control
      && !newTaskIntent
      && intent.intent !== "confirm"
      && intent.intent !== "cancel"
      && (explicitlySelectedWaitingThread || intent.intent !== "ambiguous")) {
      return answerTaskThread(event, conversation, thread, actor);
    }
    if (!thread && (isCancellation(text) || intent.intent === "cancel")) {
      const group = (state.channelIntakeGroups ?? []).find((row) =>
        row.conversationId === conversation.id && row.status === "collecting");
      if (group) {
        const timer = intakeTimers.get(group.id);
        if (timer) clearTimeout(timer);
        intakeTimers.delete(group.id);
        runTx(() => {
          group.status = "cancelled";
          group.cancelledByEventId = event.id;
          group.updatedAt = now();
        });
        return settle(event, { status: "dispatched", reply: "这条任务已取消。", data: { intakeGroupId: group.id, status: "cancelled" } });
      }
    }
    if (thread && (isConfirmation(text) || intent.intent === "confirm")) return confirmTaskThread(event, channel, conversation, thread);
    if (thread && (isCancellation(text) || intent.intent === "cancel")) {
      if (thread.autoRunId && typeof cancelAutoRun === "function") {
        try { cancelAutoRun(thread.autoRunId, { actor }); } catch { /* console can finish an already-settled run */ }
      }
      runTx(() => {
        setThreadStatus(thread, "cancelled", "user_cancelled");
        thread.waitingFor = null;
        thread.cancelledByEventId = event.id;
        thread.updatedAt = now();
        event.taskThreadId = thread.id;
      });
      return settle(event, { status: "dispatched", reply: "这个任务已取消。", data: { taskThreadId: thread.id, status: "cancelled" } });
    }
    if (thread && !newTaskIntent) {
      runTx(() => {
        thread.messages = [...(thread.messages ?? []), { eventId: event.id, content: text, receivedAt: now() }].slice(-CHANNEL_INTAKE_MAX_EVENTS);
        thread.sourceEventIds = [...(thread.sourceEventIds ?? []), event.id].slice(-CHANNEL_INTAKE_MAX_EVENTS);
        thread.attachmentAssets = [...(thread.attachmentAssets ?? []), ...(event.attachmentAssets ?? [])].slice(-20);
        thread.injectionSuspicious = Boolean(thread.injectionSuspicious || event.injectionSuspicious);
        thread.summary = threadSummary(thread);
        thread.updatedAt = now();
        event.taskThreadId = thread.id;
      });
      return settle(event, {
        status: "dispatched",
        reply: "已补充到当前任务。回复“确认”开始，或继续补充。",
        data: { taskThreadId: thread.id, status: "awaiting_confirmation", supplemented: true },
      });
    }
    return queueNaturalEvent(event, conversation);
  }

  // /task: record free-text work as a TRACKED item. Files a GitHub issue in the
  // channel's bound project with the auto-trigger label — the existing single
  // dispatcher then routes it to a worker and starts an auto-run, so the task
  // shows on the six-state board with a status and work path. The bound project
  // (owner-set) IS the authorization to file from this channel's untrusted input.
  async function dispatchTask(event, channel, conversation, description, { threadId = null, attachmentAssets = event.attachmentAssets } = {}) {
    const text = String(description ?? "").replace(/\s+/g, " ").trim();
    if (!text) {
      return settle(event, { status: "refused", reply: "Usage: /task <what needs doing>", data: { reason: "missing_description" } });
    }
    if (!channel.taskProjectId || typeof createChannelTaskIssue !== "function") {
      return settle(event, {
        status: "refused",
        reply: channel.operationMode === "team"
          ? "当前频道尚未绑定任务项目，请先在控制台绑定任务项目后再试。"
          : "当前频道还没有准备好任务项目，请先在控制台绑定项目和执行设备后再试。",
        data: { reason: "no_task_project" },
      });
    }
    const identity = (state.channelIdentities ?? []).find(
      (row) => row.channelId === channel.id && row.externalUserId === event.externalUserId,
    );
    let taskContext;
    try {
      const taskEvent = attachmentAssets === event.attachmentAssets ? event : { ...event, attachmentAssets };
      taskContext = createChannelTaskContext({
        channel, conversation, event: taskEvent, identity,
        terminalId: channel.taskTerminalId,
        projectId: channel.taskProjectId,
      });
    } catch (error) {
      return settle(event, {
        status: "refused",
        reply: "任务附件或执行环境尚未准备好，请稍后重试。",
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
    // Personal channels route after the user's confirmation. Team channels may
    // opt back into capture/approval semantics explicitly.
    const autoRoute = channel.operationMode !== "team" || Boolean(channel.taskAutoRoute);
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
        threadId,
        autoRoute,
      });
    } catch (error) {
      filed = { ok: false, error: String(error?.message ?? error) };
    }
    if (!filed?.ok || !Number.isFinite(filed.number)) {
      return settle(event, { status: "refused", reply: "暂时无法创建任务，请稍后重试。", data: { reason: filed?.reason ?? "work_item_create_failed" } });
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
          threadId,
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
        ? "任务已创建，正在排队执行。完成后我会通知你。"
        : channel.operationMode === "team"
          ? "任务已创建，等待管理员确认后开始执行。你不需要重复发送。"
          : "任务已收录，等待确认后开始执行。你不需要重复发送。",
      data: {
        command: "/task", issueNumber: filed.number, localRef: filed.localRef ?? null,
        workItemId: filed.workItemId ?? null, projectId: channel.taskProjectId, autoRoute, threadId,
      },
    });
  }

  async function dispatchExplicitTask(event, channel, conversation, description) {
    // Keep configuration errors as command refusals instead of leaving a failed
    // task thread behind when the channel was never bound to an execution project.
    if (!channel.taskProjectId || typeof createChannelTaskIssue !== "function") {
      return dispatchTask(event, channel, conversation, description);
    }
    const thread = createImmediateTaskThread(event, conversation, {
      summary: description,
      status: "queued",
      reason: "explicit_task",
    });
    const result = await dispatchTask(event, channel, conversation, description, { threadId: thread.id });
    if (result.status !== "dispatched") {
      discardImmediateTaskThread(thread, event, conversation);
      return result;
    }
    const autoRoute = Boolean(result.data?.autoRoute);
    runTx(() => {
      thread.workItemId = result.data?.workItemId ?? null;
      setThreadStatus(thread, autoRoute ? "queued" : "waiting_approval", autoRoute ? "task_created" : "awaiting_route");
      thread.waitingFor = autoRoute ? null : "approval";
      thread.updatedAt = now();
      event.replyText = autoRoute
        ? queueMessage(thread)
        : channel.operationMode === "team"
          ? "任务已创建，等待管理员确认后开始执行。你不需要重复发送。"
          : "任务已收录，等待确认后开始执行。你不需要重复发送。";
    });
    if (autoRoute) {
      refreshQueuePositions(thread.channelId);
      result.reply = queueMessage(thread);
    } else {
      result.reply = event.replyText;
    }
    return result;
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
    const thread = createImmediateTaskThread(event, conversation, {
      summary: `执行 ${name}${args.length ? `：${args.join(" ")}` : ""}`,
      status: pending ? "waiting_approval" : invocation.status === "running" ? "running" : "queued",
      reason: "explicit_run",
    });
    runTx(() => {
      thread.invocationId = invocation.id;
      stampThreadInvocation(thread, invocation);
      conversation.activeTaskThreadId = thread.id;
      conversation.updatedAt = now();
    });
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

    if (event.mediaFailure?.failed?.length) {
      const failedNames = event.mediaFailure.failed
        .map((item) => String(item?.filename ?? "附件").slice(0, 80))
        .filter(Boolean)
        .slice(0, 3);
      const suffix = failedNames.length ? `（${failedNames.join("、")}）` : "";
      return settle(event, {
        status: "refused",
        reply: `附件接收不完整${suffix}，任务尚未开始。请重新发送失败的图片、语音或文件。`,
        data: { reason: "media_import_incomplete", failedCount: event.mediaFailure.failed.length },
      });
    }

    const parsed = parseChannelCommand(event.content);
    if (!parsed.ok) {
      if (parsed.reason === "not_command") {
        return handleNaturalEvent(event, channel, conversation, actor);
      }
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
        return dispatchExplicitTask(event, channel, conversation, parsed.args.join(" "));
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

  function resumeIntake() {
    for (const group of state.channelIntakeGroups ?? []) {
      if (group.status === "collecting") scheduleIntakeGroup(group.id);
    }
  }

  function taskThreadStatus(thread) {
    const labels = {
      awaiting_confirmation: "等待确认",
      waiting_approval: "等待确认",
      queued: "排队中",
      running: "执行中",
      waiting_user: "等待你补充信息",
      paused: "已暂停",
      human_takeover: "人工跟进",
      succeeded: "已完成",
      failed: "失败",
      cancelled: "已取消",
    };
    return labels[thread?.status] ?? thread?.status ?? "未知";
  }

  function taskListLine(thread, index) {
    const summary = String(thread?.summary ?? "").slice(0, 100);
    const queueHint = thread?.status === "queued" && Number(thread?.queueAheadCount ?? 0) > 0
      ? `（前面还有 ${thread.queueAheadCount} 个任务）`
      : thread?.status === "queued"
        ? "（即将开始）"
        : "";
    return `${index}. ${taskThreadStatus(thread)}：${summary}${queueHint}`;
  }

  function taskStatusReply(thread, { label = threadRef(thread) } = {}) {
    const summary = String(thread?.summary ?? "").slice(0, 800);
    const status = taskThreadStatus(thread);
    const detail = thread?.resultSummary ? `\n${String(thread.resultSummary).slice(0, 800)}` : "";
    if (thread?.status === "queued") {
      const ahead = Number(thread.queueAheadCount ?? 0);
      const queue = ahead > 0 ? `前面还有 ${ahead} 个任务，完成后会自动开始。` : "即将开始处理。";
      return `${label} ${status}：${summary}\n${queue}你不需要重复发送。${detail}`;
    }
    if (thread?.status === "running") return `${label} ${status}：${summary}\n正在处理中，完成后我会通知你。${detail}`;
    if (thread?.status === "awaiting_confirmation" || thread?.status === "waiting_approval") {
      return `${label} ${status}：${summary}\n回复“确认”开始，或继续补充、回复“取消”。${detail}`;
    }
    if (thread?.status === "waiting_user") return `${label} ${status}：${summary}\n请直接回复需要补充的信息。${detail}`;
    if (thread?.status === "human_takeover") return `${label} ${status}：${summary}\n自动执行已暂停，请等待人工回复。${detail}`;
    if (thread?.status === "paused") return `${label} ${status}：${summary}\n回复“继续”恢复任务，或回复“取消”放弃。${detail}`;
    return `${label} ${status}：${summary}${detail}`;
  }

  function recoveredThreadStatus({ autoRunStatus = null, invocationStatus = null, fallback = "queued" } = {}) {
    if (["needs_input", "plan_proposed", "decomposed"].includes(autoRunStatus)) return "waiting_user";
    if (autoRunStatus === "awaiting_approval" || invocationStatus === "waiting_for_local_approval") return "waiting_approval";
    if (["failed", "blocked", "timed_out"].includes(autoRunStatus)
      || ["failed", "timed_out"].includes(invocationStatus)) return "failed";
    if (["cancelled", "canceled"].includes(autoRunStatus) || invocationStatus === "cancelled") return "cancelled";
    if (["done", "completed", "report_posted", "pr_open", "merged", "succeeded"].includes(autoRunStatus)
      || ["succeeded", "completed", "done"].includes(invocationStatus)) return "succeeded";
    if (["running", "verifying", "publishing"].includes(autoRunStatus) || ["running", "executing"].includes(invocationStatus)) return "running";
    if (["queued", "starting", "materializing", "waiting_capacity"].includes(autoRunStatus)
      || ["queued", "starting", "waiting_capacity"].includes(invocationStatus)) return "queued";
    return fallback;
  }

  function syncTaskThreadFromInvocation(invocation, { notify = true, reason = "invocation_update" } = {}) {
    const channelContext = invocation?.options?.metadata?.channel;
    if (!channelContext?.conversationId) return null;
    const thread = (state.channelTaskThreads ?? []).find((candidate) =>
      (channelContext.threadId && candidate.id === channelContext.threadId)
      || (channelContext.workItemId && candidate.workItemId === channelContext.workItemId));
    if (!thread) return null;
    // Human takeover is an explicit terminal ownership change. A late cancel or
    // completion callback from the old automation must not take the thread back.
    if (thread.status === "human_takeover") return { thread, status: thread.status, label: taskThreadStatus(thread) };
    const autoRunId = channelContext.autoRunId ?? invocation?.options?.metadata?.autoRunId ?? null;
    const autoRun = autoRunId
      ? (state.autoRuns ?? []).find((run) => run.id === autoRunId)
      : (state.autoRuns ?? []).find((run) => run.invocationId === invocation.id);
    const status = autoRun?.status;
    const nextStatus = recoveredThreadStatus({ autoRunStatus: status, invocationStatus: invocation.status, fallback: "running" });
    const summary = autoRun?.report
      ?? autoRun?.error
      ?? (typeof invocation.result === "string" ? invocation.result : invocation.result?.summary ?? null);
    let progressNotification = null;
    runTx(() => {
      thread.autoRunId = autoRun?.id ?? autoRunId ?? thread.autoRunId ?? null;
      thread.invocationId = autoRun?.invocationId ?? invocation.id;
      setThreadStatus(thread, nextStatus, reason);
      thread.waitingFor = nextStatus === "waiting_user" ? "user_input" : nextStatus === "waiting_approval" ? "approval" : null;
      if (summary) thread.resultSummary = String(summary).slice(0, 4000);
      thread.lastProgressAt = now();
      thread.lastProgressSummary = summary
        ? String(summary).slice(0, 4000)
        : `状态更新：${taskThreadStatus({ status: nextStatus })}`;
      thread.nextAction = threadNextAction(nextStatus);
      if (["waiting_user", "waiting_approval"].includes(nextStatus)) {
        thread.expiresAt = new Date(Date.parse(now()) + CHANNEL_WAITING_USER_TTL_MS).toISOString();
      } else if (["queued", "running"].includes(nextStatus)) {
        thread.expiresAt = new Date(Date.parse(now()) + CHANNEL_RUNNING_TTL_MS).toISOString();
      }
      thread.lastActivityAt = now();
      thread.updatedAt = now();
      if (notify && nextStatus === "running") {
        const notificationKey = `${thread.id}:${invocation.id}:running`;
        if (thread.lastProgressNotificationKey !== notificationKey) {
          thread.lastProgressNotificationKey = notificationKey;
          progressNotification = {
            channelId: thread.channelId,
            conversationId: thread.conversationId,
            threadId: thread.id,
            content: "任务已开始执行，完成后我会通知你。",
          };
        }
      }
    });
    if (progressNotification) sendDeferredReply(progressNotification);
    refreshQueuePositions(thread.channelId, { notify: notify && ["succeeded", "failed", "cancelled"].includes(nextStatus) });
    return { thread, status: nextStatus, label: taskThreadStatus(thread) };
  }

  /**
   * Reconcile channel threads after JSON/SQLite hydration. The queue rows are
   * durable, but a process can stop between an invocation completion and its
   * channel callback. Replaying only durable terminal evidence closes that
   * gap; a running row with no durable execution is safely returned to queued
   * so the normal work-item scheduler can claim it once.
   */
  function recoverTaskThreads() {
    let reconciled = 0;
    let requeued = 0;
    const activeStatuses = new Set(["awaiting_confirmation", "waiting_approval", "queued", "running", "waiting_user"]);
    runTx(() => {
      for (const thread of state.channelTaskThreads ?? []) {
        if (!thread.nextAction) thread.nextAction = threadNextAction(thread.status);
        if (!thread.lastProgressAt) thread.lastProgressAt = thread.lastActivityAt ?? thread.updatedAt ?? now();
        if (!thread.lastProgressSummary) thread.lastProgressSummary = `状态更新：${taskThreadStatus(thread)}`;
        if (!Object.prototype.hasOwnProperty.call(thread, "lastDeliveryStatus")) thread.lastDeliveryStatus = null;
        if (!Object.prototype.hasOwnProperty.call(thread, "lastDeliveryId")) thread.lastDeliveryId = null;
        if (!Object.prototype.hasOwnProperty.call(thread, "lastDeliveryError")) thread.lastDeliveryError = null;
      }
    });
    for (const thread of state.channelTaskThreads ?? []) {
      if (!activeStatuses.has(thread.status)) continue;
      const invocation = thread.invocationId
        ? (state.invocations ?? []).find((candidate) => candidate.id === thread.invocationId)
        : (state.invocations ?? []).find((candidate) => {
          const channel = candidate.options?.metadata?.channel;
          return channel?.threadId === thread.id || (channel?.workItemId && channel.workItemId === thread.workItemId);
        });
      const autoRun = thread.autoRunId
        ? (state.autoRuns ?? []).find((candidate) => candidate.id === thread.autoRunId)
        : invocation?.options?.metadata?.autoRunId
          ? (state.autoRuns ?? []).find((candidate) => candidate.id === invocation.options.metadata.autoRunId)
          : null;
      if (invocation) {
        syncTaskThreadFromInvocation(invocation, { notify: false, reason: "restart_recovery" });
        reconciled += 1;
        continue;
      }
      if (autoRun) {
        const nextStatus = recoveredThreadStatus({ autoRunStatus: autoRun.status, fallback: thread.status });
        if (nextStatus !== thread.status) {
          runTx(() => {
            setThreadStatus(thread, nextStatus, "restart_recovery");
            thread.waitingFor = nextStatus === "waiting_user" ? "user_input" : nextStatus === "waiting_approval" ? "approval" : null;
            thread.updatedAt = now();
          });
          reconciled += 1;
        }
        continue;
      }
      if (thread.status === "running") {
        runTx(() => {
          setThreadStatus(thread, "queued", "restart_recovery");
          thread.waitingFor = null;
          thread.updatedAt = now();
        });
        requeued += 1;
      }
    }
    const channelIds = new Set((state.channelTaskThreads ?? []).map((thread) => thread.channelId).filter(Boolean));
    for (const channelId of channelIds) refreshQueuePositions(channelId);
    return { reconciled, requeued };
  }

  function sweepTaskThreads() {
    const currentMs = Date.parse(now());
    if (!Number.isFinite(currentMs)) return { changed: 0, handedOff: 0, expired: 0 };
    let changed = 0;
    let handedOff = 0;
    let expired = 0;
    const notifications = [];
    const cancellations = [];
    const takeovers = [];
    const affectedChannelIds = new Set();
    runTx(() => {
      for (const thread of state.channelTaskThreads ?? []) {
        if (!["awaiting_confirmation", "waiting_approval", "queued", "running", "waiting_user"].includes(thread.status)) continue;
        const expiresMs = Date.parse(thread.expiresAt ?? "");
        if (!Number.isFinite(expiresMs) || expiresMs > currentMs) continue;
        changed += 1;
        if (thread.channelId) affectedChannelIds.add(thread.channelId);
        if (thread.status === "awaiting_confirmation") {
          setThreadStatus(thread, "cancelled", "confirmation_expired");
          thread.waitingFor = null;
          thread.cancelReason = "expired";
          thread.resultSummary = "确认超时，任务草稿已取消。";
          expired += 1;
        } else {
          setThreadStatus(thread, "human_takeover", "timeout_handoff");
          thread.waitingFor = "human";
          thread.timeoutAt = now();
          thread.resultSummary = "任务长时间没有进展，已转人工跟进。";
          const request = (state.channelTaskRequests ?? []).find((candidate) =>
            (thread.workItemId && candidate.workItemId === thread.workItemId)
            || (candidate.threadId && candidate.threadId === thread.id));
          if (request && ["pending", "routed"].includes(request.status)) {
            request.status = "human_takeover";
            request.lastAction = "takeover";
            request.lastActionAt = now();
            request.lastActionBy = "system";
          }
          takeovers.push({ thread, request: request ?? null, reason: "timeout_handoff" });
          handedOff += 1;
          if (thread.autoRunId && typeof cancelAutoRun === "function") cancellations.push(thread.autoRunId);
          const channel = findChannel(thread.channelId);
          notifications.push({
            channelId: thread.channelId,
            conversationId: thread.conversationId,
            threadId: thread.id,
            content: channel?.operationMode === "team"
              ? "任务长时间没有进展，已暂停并转人工处理，请等待管理员回复。"
              : "任务长时间没有进展，已暂停并转人工处理，请稍候。",
          });
        }
        thread.updatedAt = now();
      }
      if (changed > 0) {
        appendEvent({
          invocationId: null,
          type: "channel_task_timeout_sweep",
          level: "warn",
          message: `Channel task timeout sweep changed ${changed} thread(s).`,
          data: { changed, handedOff, expired },
        });
      }
    });
    for (const autoRunId of cancellations) {
      try {
        const result = cancelAutoRun(autoRunId, { reason: "channel_task_timeout_handoff" });
        result?.catch?.(() => {});
      } catch { /* best effort; human takeover remains authoritative */ }
    }
    for (const takeover of takeovers) {
      try { notifyHumanTakeover?.(takeover); } catch { /* best-effort operator notification */ }
    }
    // A timeout can remove a running/queued row from the lane. Recalculate all
    // remaining positions after the transaction so the console and the next
    // channel reply agree on the same queue number.
    for (const channelId of affectedChannelIds) refreshQueuePositions(channelId, { notify: true });
    for (const notification of notifications) sendDeferredReply(notification);
    return { changed, handedOff, expired };
  }

  function listTaskThreads(conversation) {
    return (state.channelTaskThreads ?? [])
      .filter((thread) => thread.conversationId === conversation.id)
      .sort((left, right) => String(right.updatedAt ?? right.createdAt ?? "").localeCompare(String(left.updatedAt ?? left.createdAt ?? "")))
      .slice(0, 10);
  }

  function candidateSelectionReply(threads) {
    const choices = threads.slice(0, 5).map((thread, index) => `${index + 1}. ${taskThreadStatus(thread)}：${String(thread.summary ?? "").slice(0, 80)}`).join("\n");
    return `我不确定这条消息属于哪个任务。请回复“继续第一个任务”选择任务，或回复“另外……”创建新任务。\n${choices}`;
  }

  return {
    dispatchImportedChannelEvent,
    resumeIntake,
    syncTaskThreadFromInvocation,
    recoverTaskThreads,
    sweepTaskThreads,
    listTaskThreads,
    taskThreadStatus,
  };
}
