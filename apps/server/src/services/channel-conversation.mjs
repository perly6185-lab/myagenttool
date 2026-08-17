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

// Keep the fail-closed response generic, but make it actionable for the local
// single-user setup. Do not reveal whether the sender was unmapped, disabled,
// or blocked by an allowlist.
const GENERIC_DENIED_REPLY = "当前消息暂时无法处理。请在桌面端打开“频道”，确认微信已绑定且处于在线状态；首次使用请复制绑定口令，在微信 ClawBot 对话中发送。";
const USAGE_REPLY = `你可以直接发送文字、图片、语音或文件，我会先理解你的需求。\n\n常用操作：\n• 直接描述需求：我会整理后请你确认\n• 我的任务 / 任务：查看任务\n• 当前进度 / 进度：查看最新任务\n• 历史：查看最近记录\n• 确认 / 修改 / 取消：处理待确认任务\n• 暂停 / 继续 / 重试 / 重发结果 / 转人工：管理最新任务\n\n也可以直接说“你好”“我想了解……”或“帮我……”，不需要记命令。\n高级命令：重试 T-xxxx、暂停 T-xxxx、重发结果 T-xxxx、转人工 T-xxxx、${channelCommands.join("、")}`;

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
// Intent classification is optional preflight. It must never make a channel
// message wait as long as a real task or a Bridge invocation.
export const CHANNEL_INTENT_TIMEOUT_MS = 3_500;
export const CHANNEL_INTENT_POLICY_VERSION = "ilink-intent-v2";
const CHANNEL_INTAKE_MAX_MS = 30 * 1000;
const CHANNEL_INTAKE_MAX_EVENTS = 8;
const CHANNEL_THREAD_TTL_MS = 30 * 60 * 1000;
export const CHANNEL_WAITING_USER_TTL_MS = 30 * 60 * 1000;
export const CHANNEL_RUNNING_TTL_MS = 24 * 60 * 60 * 1000;
export const CHANNEL_PROGRESS_HEARTBEAT_AFTER_MS = 5 * 60 * 1000;
export const CHANNEL_PROGRESS_HEARTBEAT_INTERVAL_MS = 10 * 60 * 1000;
export const CHANNEL_ATTENTION_GRACE_MS = 30 * 60 * 1000;
const THREAD_CONFIRMATIONS = new Set([
  "确认", "确定", "开始", "执行", "可以", "好的", "好", "yes", "ok",
  "好呀", "好啊", "没问题", "按这个做", "就这样", "开始吧", "执行吧",
]);
const THREAD_CANCELLATIONS = new Set(["取消", "不要了", "放弃", "cancel", "no"]);
const GREETING_TEXTS = new Set([
  "你好", "您好", "嗨", "嗨嗨", "哈喽", "hello", "hi", "hey",
  "早上好", "上午好", "中午好", "下午好", "晚上好", "晚安",
  "在吗", "在不在", "有人吗", "能听到吗",
]);
// Accept the punctuation people naturally use in WeChat ("另外，请……") as
// well as the compact "再帮我……" form. These phrases are a strong explicit
// new-task signal and should not be attached to a waiting-user thread.
const NEW_TASK_PREFIX = /^(?:(?:另外|另一个|还有一个|除此之外|新任务|另一个任务)(?=\s|[，,：:、。！!？?]|$)|再帮我)/i;
const EXPLICIT_TASK_REQUEST = /^(?:请(?:帮我|协助我|处理|整理|分析|检查|生成|创建|修改|导出|汇总|总结|翻译|写|做|执行|运行|发送|下载|对比|审核|修复|规划|开发|实现)|(?:帮我|麻烦(?:帮我)?|请协助)(?:整理|分析|处理|检查|生成|创建|修改|导出|汇总|总结|翻译|写|做|执行|运行|发送|下载|对比|审核|修复|规划|开发|实现))/i;
const CONSULTATION_REQUEST = /^(?:为什么|为何|怎么|如何|能否|是否|有没有|请问|什么是|有什么区别|你建议|推荐什么|应该怎么)/;
const TASK_LIST_REQUESTS = new Set(["我的任务", "查看任务", "任务", "任务列表", "有哪些任务", "任务状态", "我的任务状态"]);
const TASK_HISTORY_REQUESTS = new Set(["历史", "历史记录", "聊天记录", "最近记录", "最近任务", "我刚才做了什么"]);
const TASK_PROGRESS_REQUESTS = new Set(["进度", "当前进度", "任务进度", "我的进度", "进度怎么样", "现在做到哪了", "现在什么情况", "还有多久", "排队情况", "排队到哪了", "任务进展", "进展如何", "做得怎么样"]);
const TASK_RESULT_RESEND_REQUESTS = new Set(["重发结果", "再发一次", "再发一次结果", "把结果发我", "重新发送结果", "结果再发一次"]);
const HELP_REQUESTS = new Set([
  "帮助", "怎么用", "如何使用", "我能做什么", "你能做什么", "你可以做什么",
  "能帮我什么", "你会做什么", "你能帮我做什么", "help", "what can you do",
]);
const TASK_THREAD_ACTIVE_STATUSES = new Set(["awaiting_confirmation", "waiting_approval", "queued", "running", "waiting_user", "needs_attention"]);
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
  createConsultation = null,
  replySender = null,
  resendDelivery = null,
  notifyHumanTakeover = null,
  intakeQuietMs = CHANNEL_INTAKE_QUIET_MS,
  intentTimeoutMs = CHANNEL_INTENT_TIMEOUT_MS,
}) {
  const runTx = makeRunTx({ store, persistStateSoon });
  const intakeTimers = new Map();
  const threadLocks = new Set();
  // The Bridge classifier is an optional async preflight. Serializing only
  // messages that can reach it preserves the synchronous fast path for
  // commands/greetings while preventing an older classification from winning
  // over a newer message in the same conversation.
  const conversationDispatchTails = new Map();

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
    } else if (status === "needs_attention") {
      thread.expiresAt = new Date(Date.parse(now()) + CHANNEL_ATTENTION_GRACE_MS).toISOString();
    } else if (["succeeded", "failed", "cancelled", "paused", "human_takeover"].includes(status)) {
      thread.expiresAt = null;
    }
    thread.nextAction = threadNextAction(status, thread);
    thread.lastProgressAt = now();
    thread.lastProgressSummary = `状态更新：${taskThreadStatus({ status })}`;
    thread.lastHeartbeatAt = null;
    thread.lastActivityAt = now();
  }

  function threadNextAction(status, thread = null) {
    return ({
      awaiting_confirmation: "回复“确认”开始，或继续补充、回复“取消”",
      waiting_approval: thread?.waitingFor === "approval"
        ? "任务内容已确认，请在桌面端审批中心批准，批准后会自动继续"
        : "等待任务路由确认后开始执行",
      queued: "等待前面的任务完成，系统会自动开始",
      running: "等待执行完成，系统会自动通知",
      waiting_user: "请直接回复需要补充的信息",
      needs_attention: "任务暂时没有新进展，回复“继续”继续观察，或回复“转人工”",
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
    const value = normalizedText(text).toLowerCase().replace(/[!！。.,，?？~～]+$/g, "");
    return THREAD_CONFIRMATIONS.has(value);
  }

  function isCancellation(text) {
    return THREAD_CANCELLATIONS.has(normalizedText(text).toLowerCase());
  }

  function isGreeting(text) {
    const value = normalizedText(text).toLowerCase().replace(/[!！。.,，?？~～]+$/g, "");
    return GREETING_TEXTS.has(value) || /^(?:你好|您好)(?:啊|呀|喽)$/.test(value);
  }

  function isNewTask(text) {
    return NEW_TASK_PREFIX.test(normalizedText(text));
  }

  function isExplicitTaskRequest(text) {
    return EXPLICIT_TASK_REQUEST.test(normalizedText(text));
  }

  function isConsultationRequest(text) {
    const value = normalizedText(text);
    return CONSULTATION_REQUEST.test(value) || /[？?]$/.test(value);
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
    const lower = value.toLowerCase();
    if (HELP_REQUESTS.has(lower) || ["菜单", "操作说明", "使用说明", "指引"].includes(value)
      || /^(?:hello|hi)[,，\s]*(?:what can you do|what do you do)\??$/i.test(value)
      || /^(?:你好|您好)[，,\s]*(?:你能做什么|你可以做什么|能帮我什么|怎么用)[？?！!]?$/.test(value)) {
      return { kind: "help", ref: null };
    }
    if (TASK_LIST_REQUESTS.has(value)) return { kind: "list", ref: null };
    if (TASK_HISTORY_REQUESTS.has(value)) return { kind: "history", ref: null };
    const cancel = value.match(/^取消\s+(T-[a-z0-9_-]+)$/i);
    if (cancel) return { kind: "cancel", ref: cancel[1].toUpperCase() };
    const retry = value.match(/^(?:重试|再试一次)\s+(T-[a-z0-9_-]+)$/i);
    if (retry) return { kind: "retry", ref: retry[1].toUpperCase() };
    const resend = value.match(/^(?:重发|重新发送|再发一次)(?:结果|消息)?\s+(T-[a-z0-9_-]+)$/i);
    if (resend) return { kind: "resend", ref: resend[1].toUpperCase() };
    const pause = value.match(/^暂停(?:任务)?(?:\s+(T-[a-z0-9_-]+))?$/i);
    if (pause?.[1]) return { kind: "pause", ref: pause[1].toUpperCase() };
    const resume = value.match(/^(?:继续|继续执行|恢复|恢复任务)(?:\s+(T-[a-z0-9_-]+))?$/i);
    if (resume?.[1]) {
      const selected = conversation
        ? (state.channelTaskThreads ?? []).find((thread) => thread.conversationId === conversation.id && threadRef(thread).toUpperCase() === resume[1].toUpperCase())
        : null;
      if (selected && !["paused", "needs_attention"].includes(selected.status)) return { kind: "select", ref: resume[1].toUpperCase() };
      return { kind: "resume", ref: resume[1].toUpperCase() };
    }
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
      if (/^(?:取消|停止)(?:当前|现在|刚才|上一个)?(?:的)?任务$/i.test(value)) {
        return { kind: "cancel", ref: latest ? threadRef(latest) : null, friendly: true };
      }
      if (/^(?:暂停)(?:当前|现在|刚才|上一个)?(?:的)?任务$/i.test(value)) {
        return { kind: "pause", ref: latest ? threadRef(latest) : null, friendly: true };
      }
      if (/^(?:重试|再试一次)(?:当前|现在|刚才|上一个)?(?:的)?任务$/i.test(value)) {
        return { kind: "retry", ref: latest ? threadRef(latest) : null, friendly: true };
      }
      if (/^(?:转人工|交给人工)(?:处理)?(?:当前|现在|刚才|上一个)?(?:的)?任务$/i.test(value)) {
        return { kind: "handoff", ref: latest ? threadRef(latest) : null, friendly: true };
      }
      if (pause && latest && TASK_THREAD_ACTIVE_STATUSES.has(latest.status)) return { kind: "pause", ref: threadRef(latest), friendly: true };
      if (resume && latest && ["paused", "needs_attention"].includes(latest.status)) return { kind: "resume", ref: threadRef(latest), friendly: true };
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
      if (latest && ["继续", "继续执行", "恢复", "恢复任务"].includes(value) && ["paused", "needs_attention"].includes(latest.status)) return { kind: "resume", ref: threadRef(latest), friendly: true };
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

  function recordIntentAdapterMetric(kind) {
    runTx(() => {
      const metrics = state.channelIntentMetrics ?? {
        policyVersion: CHANNEL_INTENT_POLICY_VERSION,
        total: 0,
        byIntent: {},
        bySource: {},
        lowConfidence: 0,
        ambiguous: 0,
        adapterCalls: 0,
        adapterTimeouts: 0,
        adapterErrors: 0,
        updatedAt: null,
      };
      metrics.policyVersion = CHANNEL_INTENT_POLICY_VERSION;
      const key = kind === "timeout" ? "adapterTimeouts" : kind === "error" ? "adapterErrors" : "adapterCalls";
      metrics[key] = Number(metrics[key] ?? 0) + 1;
      metrics.updatedAt = now();
      state.channelIntentMetrics = metrics;
    });
  }

  function withIntentTimeout(value, timeoutMs) {
    const boundedTimeout = Math.max(250, Number(timeoutMs) || CHANNEL_INTENT_TIMEOUT_MS);
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error("channel_intent_timeout"), { code: "channel_intent_timeout" })), boundedTimeout);
    });
    return Promise.race([Promise.resolve(value), timeout]).finally(() => clearTimeout(timer));
  }

  function activeTaskThreads(conversation) {
    return (state.channelTaskThreads ?? [])
      .filter((thread) => thread.conversationId === conversation.id && TASK_THREAD_ACTIVE_STATUSES.has(thread.status))
      .sort((left, right) => String(right.updatedAt ?? right.createdAt ?? "").localeCompare(String(left.updatedAt ?? left.createdAt ?? "")));
  }

  function collectingIntakeGroup(conversation) {
    return (state.channelIntakeGroups ?? [])
      .filter((group) => group.conversationId === conversation?.id && group.status === "collecting")
      .sort((left, right) => String(right.updatedAt ?? right.startedAt ?? "").localeCompare(String(left.updatedAt ?? left.startedAt ?? "")))[0] ?? null;
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
              dedupeKey: `channel-queue:${thread.id}:${ahead}`,
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
          : isGreeting(value)
            ? { intent: "greeting", confidence: 1, source: "deterministic" }
          : isExplicitTaskRequest(value)
            ? { intent: "new_task", confidence: 0.96, source: "deterministic" }
          : isNewTask(value)
            ? { intent: "new_task", confidence: 0.98, source: "deterministic" }
            : preferredWaitingUser
              ? { intent: "supplement", confidence: 0.96, ref: threadRef(preferredWaitingUser), source: "deterministic" }
              : isConsultationRequest(value)
                ? { intent: "consultation", confidence: 0.9, source: "deterministic" }
              : active.length > 1
              ? { intent: "ambiguous", confidence: 0.35, source: "deterministic" }
              : waitingUser.length === 1
                ? { intent: "supplement", confidence: 0.92, ref: threadRef(waitingUser[0]), source: "deterministic" }
                : { intent: "new_task", confidence: 0.78, source: "deterministic" };
    // Explicit controls are already exact and must not be reinterpreted by a
    // model. The adapter is reserved for natural-language messages where the
    // local fallback benefits from context, such as supplement vs new_task.
    if (typeof classifyIntent !== "function" || control || isConfirmation(value) || isCancellation(value) || isGreeting(value) || isExplicitTaskRequest(value) || isNewTask(value) || isConsultationRequest(value)) {
      return normalizeChannelIntentResult(fallback, { fallback, activeRefs: new Set(active.map(threadRef)) });
    }
    recordIntentAdapterMetric("call");
    try {
      const proposed = classifyIntent({ text: value, conversationId: conversation.id, activeThreads: active.map((thread) => ({ ref: threadRef(thread), status: thread.status, summary: String(thread.summary ?? "").slice(0, 400) })) });
      if (proposed && typeof proposed.then === "function") {
        return withIntentTimeout(proposed, intentTimeoutMs)
          .then((result) => normalizeChannelIntentResult(result, { fallback, activeRefs: new Set(active.map(threadRef)) }))
          .catch((error) => {
            recordIntentAdapterMetric(error?.code === "channel_intent_timeout" ? "timeout" : "error");
            return normalizeChannelIntentResult(fallback, { fallback, activeRefs: new Set(active.map(threadRef)) });
          });
      }
      return normalizeChannelIntentResult(proposed, { fallback, activeRefs: new Set(active.map(threadRef)) });
    } catch {
      recordIntentAdapterMetric("error");
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
        policyVersion: CHANNEL_INTENT_POLICY_VERSION,
      };
      const metrics = state.channelIntentMetrics ?? {
        policyVersion: CHANNEL_INTENT_POLICY_VERSION,
        total: 0,
        byIntent: {},
        lowConfidence: 0,
        ambiguous: 0,
        bySource: {},
        adapterCalls: 0,
        adapterTimeouts: 0,
        adapterErrors: 0,
        updatedAt: null,
      };
      metrics.policyVersion = CHANNEL_INTENT_POLICY_VERSION;
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

  function sendDeferredReply({ channelId, conversationId, content, threadId = null, invocationId = null, dedupeKey = null }) {
    if (typeof replySender !== "function" || !content) return;
    try {
      const result = replySender({ channelId, conversationId, content, threadId, invocationId, dedupeKey });
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
      attentionReason: null,
      attentionAt: null,
      lastHeartbeatAt: null,
      lastProgressNotificationAt: null,
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
      attentionReason: null,
      attentionAt: null,
      lastHeartbeatAt: null,
      lastProgressNotificationAt: null,
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
        thread.nextAction = threadNextAction(thread.status, thread);
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
      const retryIdempotencyKey = `channel-retry:${thread.id}:${thread.invocationId ?? thread.autoRunId}`;
      const result = await retryAutoRun(thread.autoRunId, { actor, idempotencyKey: retryIdempotencyKey });
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
    if (!thread || !["awaiting_confirmation", "waiting_approval", "queued", "running", "waiting_user", "needs_attention"].includes(thread.status)) {
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

  function consultationAnswer(invocation) {
    const result = invocation?.result;
    const candidates = [
      typeof result === "string" ? result : null,
      result?.summary,
      result?.message,
      result?.text,
      typeof result?.output === "string" ? result.output : null,
      typeof result?.output?.text === "string" ? result.output.text : null,
      typeof result?.output?.summary === "string" ? result.output.summary : null,
    ];
    const answer = candidates.find((value) => String(value ?? "").trim());
    if (answer) return String(answer).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim().slice(0, 6000);
    return "我暂时没有拿到有效答案。你可以换一种方式描述问题，或说“帮我……”让我整理成任务处理。";
  }

  function startConsultation(event, conversation) {
    const existing = (state.invocations ?? []).find((invocation) =>
      invocation.status
      && !["succeeded", "failed", "cancelled", "timed_out"].includes(invocation.status)
      && invocation.options?.metadata?.channelConsultation
      && invocation.options?.metadata?.channel?.eventId === event.id);
    if (existing) {
      runTx(() => {
        event.consultationInvocationId = existing.id;
        event.consultationStatus = "queued";
      });
      return settle(event, {
        status: "dispatched",
        reply: "已收到，正在整理答案，稍后会发给你。",
        invocationId: existing.id,
        data: { consultation: true, status: "queued", deduplicated: true },
      });
    }
    if (typeof createConsultation !== "function") {
      return settle(event, {
        status: "dispatched",
        reply: "这是一个咨询问题。我目前无法直接生成答案；如果希望我实际处理，请说“帮我……”或发送相关图片、语音和文件。",
        data: { consultation: true, suggestedAction: "new_task", reason: "consultation_unavailable" },
      });
    }
    try {
      const history = (state.channelEvents ?? [])
        .filter((candidate) => candidate.conversationId === conversation.id && candidate.id !== event.id)
        .sort((left, right) => String(left.receivedAt ?? "").localeCompare(String(right.receivedAt ?? "")))
        .slice(-6)
        .map((candidate) => ({ content: candidate.content, receivedAt: candidate.receivedAt }));
      const invocation = createConsultation({
        text: event.content,
        channelId: event.channelId,
        conversationId: conversation.id,
        eventId: event.id,
        history,
      });
      runTx(() => {
        event.consultationInvocationId = invocation?.id ?? null;
        event.consultationStatus = "queued";
        event.consultationQueuedAt = now();
      });
      return settle(event, {
        status: "dispatched",
        reply: "已收到，正在回答你的问题，稍后会把答案发回来。\n如果你想让我直接处理，请说“帮我……”；这不会自动创建任务。",
        invocationId: invocation?.id ?? null,
        data: { consultation: true, status: "queued", suggestedAction: "new_task" },
      });
    } catch (error) {
      runTx(() => {
        event.consultationStatus = "fallback";
        event.consultationError = String(error?.message ?? error).slice(0, 160);
      });
      return settle(event, {
        status: "dispatched",
        reply: "这是一个咨询问题，但当前回答服务暂时不可用。你可以稍后再问；如果希望我直接处理，请说“帮我……”或发送相关资料。",
        data: { consultation: true, suggestedAction: "new_task", reason: "consultation_enqueue_failed" },
      });
    }
  }

  function syncConsultationFromInvocation(invocation) {
    const metadata = invocation?.options?.metadata;
    if (!metadata?.channelConsultation) return null;
    const eventId = metadata.channel?.eventId ?? null;
    const event = eventId ? (state.channelEvents ?? []).find((candidate) => candidate.id === eventId) : null;
    if (!event) return null;
    if (["answered", "failed"].includes(event.consultationStatus)) return { event, status: event.consultationStatus };
    const conversation = findConversation(metadata.channel?.conversationId ?? event.conversationId);
    const terminal = ["succeeded", "failed", "cancelled", "timed_out"].includes(invocation.status);
    if (!terminal) return { event, status: "queued" };
    const answer = invocation.status === "succeeded"
      ? consultationAnswer(invocation)
      : "这次咨询暂时没有完成，可能是本地助手正在忙或连接中断。你可以稍后重试，也可以说“帮我……”让我直接整理成任务。";
    runTx(() => {
      event.consultationStatus = invocation.status === "succeeded" ? "answered" : "failed";
      event.consultationAnswer = answer;
      event.consultationCompletedAt = now();
      appendEvent({
        invocationId: invocation.id,
        type: invocation.status === "succeeded" ? "channel_consultation_answered" : "channel_consultation_failed",
        level: invocation.status === "succeeded" ? "info" : "warn",
        message: `Channel ${event.channelId}: consultation ${event.consultationStatus}.`,
        data: {
          channelId: event.channelId,
          conversationId: event.conversationId,
          eventId: event.id,
          consultationStatus: event.consultationStatus,
        },
      });
    });
    if (conversation) {
      sendDeferredReply({
        channelId: event.channelId,
        conversationId: conversation.id,
        content: answer,
        invocationId: invocation.id,
        dedupeKey: `channel-consultation:${event.id}:${invocation.id}:answer`,
      });
    }
    return { event, status: event.consultationStatus, answer };
  }

  function recoverConsultations() {
    let recovered = 0;
    for (const invocation of state.invocations ?? []) {
      if (!invocation?.options?.metadata?.channelConsultation) continue;
      if (!["succeeded", "failed", "cancelled", "timed_out"].includes(invocation.status)) continue;
      const eventId = invocation.options?.metadata?.channel?.eventId ?? null;
      const event = eventId ? (state.channelEvents ?? []).find((candidate) => candidate.id === eventId) : null;
      if (["answered", "failed"].includes(event?.consultationStatus)) continue;
      const result = syncConsultationFromInvocation(invocation);
      if (result && ["answered", "failed"].includes(result.status)) recovered += 1;
    }
    return { recovered };
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
    const collectingGroup = collectingIntakeGroup(conversation);
    // An attachment cannot be answered by the text-only consultation adapter.
    // Treat a media-backed question as work intake so the normal task path can
    // carry the governed attachment assets instead of pretending the Bridge saw
    // the file/image/voice.
    const mediaBackedConsultation = intent.intent === "consultation" && (event.attachmentAssets ?? []).length > 0;
    const newTaskIntent = isNewTask(text) || mediaBackedConsultation || (!parsedControl && intent.intent === "new_task");
    const explicitlySelectedWaitingThread = thread?.status === "waiting_user"
      && conversation.activeTaskThreadId === thread.id;
    const pendingDrafts = activeTaskThreads(conversation)
      .filter((candidate) => candidate.status === "awaiting_confirmation");
    if (control?.kind === "help") {
      return settle(event, {
        status: "dispatched",
        reply: USAGE_REPLY,
        data: { help: true },
      });
    }
    if (!control && intent.intent === "greeting") {
      return settle(event, {
        status: "dispatched",
        reply: "你好！我可以帮你咨询问题、整理任务，也支持处理图片、语音和文件。直接告诉我想做什么即可；如果需要执行，我会先帮你整理并请你确认。",
        data: { greeting: true, intent: intent.intent, confidence: intent.confidence },
      });
    }
    if (!control && intent.intent === "consultation" && !mediaBackedConsultation) {
      const consultation = startConsultation(event, conversation);
      if (consultation && typeof consultation.then === "function") {
        return consultation.then((result) => ({
          ...result,
          data: { ...(result.data ?? {}), intent: intent.intent, confidence: intent.confidence },
        }));
      }
      return {
        ...consultation,
        data: { ...(consultation.data ?? {}), intent: intent.intent, confidence: intent.confidence },
      };
    }
    if (collectingGroup && control && ["list", "history", "status"].includes(control.kind) && !control.ref) {
      const pendingHint = "上一条消息正在整理，稍后会发任务草稿；你可以继续补充，或稍候再问进度。";
      if (control.kind === "status") {
        const latest = recentTaskThreads(conversation)[0] ?? null;
        return settle(event, {
          status: "dispatched",
          reply: latest ? `${taskStatusReply(latest, { label: "当前任务" })}\n\n${pendingHint}` : pendingHint,
          data: { taskStatus: true, intakePending: true, intakeGroupId: collectingGroup.id, taskThreadId: latest?.id ?? null },
        });
      }
      if (control.kind === "list") {
        const rows = listTaskThreads(conversation);
        const reply = rows.length
          ? `${rows.map((row, index) => taskListLine(row, index + 1)).join("\n")}\n\n${pendingHint}`
          : pendingHint;
        return settle(event, { status: "dispatched", reply, data: { taskThreadList: true, intakePending: true, intakeGroupId: collectingGroup.id, count: rows.length } });
      }
      return settle(event, {
        status: "dispatched",
        reply: `${conversationHistoryReply(conversation)}\n\n${pendingHint}`,
        data: { conversationHistory: true, intakePending: true, intakeGroupId: collectingGroup.id },
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
    if (control?.kind === "history") {
      return settle(event, {
        status: "dispatched",
        reply: conversationHistoryReply(conversation),
        data: { conversationHistory: true },
      });
    }
    if (control?.ref == null && ["cancel", "retry", "pause", "resume", "resend", "handoff"].includes(control?.kind)) {
      const messages = {
        cancel: "当前没有可以取消的任务。",
        retry: "当前没有可以重试的失败任务。",
        pause: "当前没有可以暂停的任务。",
        resume: "当前没有已暂停的任务。",
        resend: "当前还没有可重发的任务结果。",
        handoff: "当前没有可以转人工的任务。",
      };
      return settle(event, { status: "dispatched", reply: messages[control.kind], data: { taskControl: control.kind, reason: "no_task" } });
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
    if (!control && pendingDrafts.length > 1
      && ["confirm", "cancel", "supplement"].includes(intent.intent)) {
      return settle(event, {
        status: "dispatched",
        reply: candidateSelectionReply(pendingDrafts),
        data: { intent: intent.intent, confidence: intent.confidence, reason: "multiple_pending_drafts" },
      });
    }
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
        if (!["paused", "needs_attention"].includes(referenced.status)) return settle(event, { status: "dispatched", reply: `当前任务${taskThreadStatus(referenced)}，不需要恢复。`, data: { taskThreadId: referenced.id, status: referenced.status, reason: "resume_unavailable" } });
        const resumeInvocation = referenced.invocationId ? findInvocation(referenced.invocationId) : null;
        const resumeAutoRun = referenced.autoRunId
          ? (state.autoRuns ?? []).find((run) => run.id === referenced.autoRunId)
          : resumeInvocation?.options?.metadata?.autoRunId
            ? (state.autoRuns ?? []).find((run) => run.id === resumeInvocation.options.metadata.autoRunId)
            : null;
        if (referenced.status === "needs_attention" && !resumeAutoRun && !resumeInvocation) {
          return settle(event, { status: "dispatched", reply: "这个任务当前没有可恢复的自动执行。回复“转人工”继续处理，或重新描述需求创建新任务。", data: { taskThreadId: referenced.id, status: referenced.status, reason: "no_resumable_execution" } });
        }
        const resumedStatus = referenced.status === "needs_attention"
          ? recoveredThreadStatus({ autoRunStatus: resumeAutoRun?.status, invocationStatus: resumeInvocation?.status, fallback: "queued" })
          : "queued";
        if (["succeeded", "failed", "cancelled"].includes(resumedStatus)) {
          return settle(event, { status: "dispatched", reply: "这个任务已经没有可恢复的自动执行。回复“重试”再次执行，或回复“转人工”继续处理。", data: { taskThreadId: referenced.id, status: referenced.status, reason: "execution_finished" } });
        }
        runTx(() => {
          setThreadStatus(referenced, resumedStatus, "user_resumed");
          referenced.waitingFor = resumedStatus === "waiting_user" ? "user_input" : resumedStatus === "waiting_approval" ? "approval" : null;
          referenced.attentionReason = null;
          referenced.attentionAt = null;
          referenced.resumedAt = now();
          referenced.updatedAt = now();
          event.taskThreadId = referenced.id;
        });
        refreshQueuePositions(referenced.channelId);
        const resumedReply = resumedStatus === "waiting_user"
          ? "任务已恢复，请补充需要的信息。"
          : resumedStatus === "waiting_approval"
            ? "任务已恢复，等待桌面端审批后继续。"
            : "任务已恢复，继续执行中；完成后我会通知你。";
        return settle(event, { status: "dispatched", reply: control.friendly ? resumedReply : `${threadRef(referenced)} ${resumedReply}`, data: { taskThreadId: referenced.id, status: resumedStatus } });
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
    if (!thread && (isConfirmation(text) || intent.intent === "confirm")) {
      return settle(event, {
        status: "dispatched",
        reply: "当前没有等待确认的任务。请直接告诉我想做什么，我会先帮你整理。",
        data: { intent: "confirm", reason: "no_pending_task" },
      });
    }
    if (!thread && (isCancellation(text) || intent.intent === "cancel")) {
      return settle(event, {
        status: "dispatched",
        reply: "当前没有可以取消的任务。",
        data: { intent: "cancel", reason: "no_active_task" },
      });
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
        idempotencyKey: threadId
          ? `channel-thread:${channel.id}:${threadId}`
          : `channel-event:${channel.id}:${event.id}`,
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
      const idempotencyKey = threadId
        ? `channel-thread:${channel.id}:${threadId}`
        : `channel-event:${channel.id}:${event.id}`;
      const alreadyRecorded = (conversation.taskIssues ?? []).some((issue) =>
        issue.idempotencyKey === idempotencyKey
        || (filed.workItemId && issue.workItemId === filed.workItemId));
      if (!alreadyRecorded) {
        conversation.taskIssues = [...(conversation.taskIssues ?? []), {
          number: filed.number, localRef: filed.localRef ?? null, workItemId: filed.workItemId ?? null,
          url: filed.url ?? null, idempotencyKey, at: now(),
        }].slice(-50);
      }
      // Capture mode: record a request that shows up as a pending decision until a
      // human routes (→ auto-run) or dismisses it. Bounded newest-keeps.
      if (!autoRoute) {
        const existingRequest = (state.channelTaskRequests ?? []).find((request) =>
          (filed.workItemId && request.workItemId === filed.workItemId)
          || (threadId && request.threadId === threadId));
        if (!existingRequest) {
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
  function dispatchImportedChannelEventNow({ eventId } = {}) {
    const event = (state.channelEvents ?? []).find((row) => row.id === String(eventId ?? ""));
    if (!event || event.status !== "imported") {
      return { ok: false, status: "not_dispatchable", reply: null };
    }
    const channel = findChannel(event.channelId);
    const conversation = findConversation(event.conversationId);
    if (!channel || channel.status !== "enabled" || !conversation) {
      return settle(event, { status: "refused", reply: GENERIC_DENIED_REPLY, data: { reason: "channel_not_enabled" } });
    }

    // The provider may deliver several messages while a classifier is still
    // resolving. The dispatcher wrapper normally serializes these, but this
    // durable sequence guard also protects direct/recovery calls and prevents
    // a stale event from mutating a newer conversation state after restart.
    const eventSequence = Number(event.conversationSequence ?? 0);
    const lastDispatchedSequence = Number(conversation.lastDispatchedSequence ?? 0);
    if (eventSequence > 0 && eventSequence < lastDispatchedSequence) {
      return settle(event, {
        status: "dispatched",
        reply: "已收到，这条消息已按后续消息一起处理。回复“进度”可查看当前任务。",
        data: { reason: "stale_conversation_event", conversationSequence: eventSequence, lastDispatchedSequence },
      });
    }
    if (eventSequence > lastDispatchedSequence) {
      runTx(() => {
        conversation.lastDispatchedSequence = eventSequence;
        conversation.updatedAt = now();
      });
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

  function dispatchImportedChannelEvent({ eventId } = {}) {
    const event = (state.channelEvents ?? []).find((row) => row.id === String(eventId ?? ""));
    const conversation = event ? findConversation(event.conversationId) : null;
    const previous = conversation ? conversationDispatchTails.get(conversation.id) : null;
    if (!event || !conversation || previous) {
      if (!previous) return dispatchImportedChannelEventNow({ eventId });
      const current = previous
        .catch(() => null)
        .then(() => dispatchImportedChannelEventNow({ eventId }));
      let tracked;
      tracked = current.finally(() => {
        if (conversationDispatchTails.get(conversation.id) === tracked) conversationDispatchTails.delete(conversation.id);
      });
      conversationDispatchTails.set(conversation.id, tracked);
      return tracked;
    }

    const result = dispatchImportedChannelEventNow({ eventId });
    if (!result || typeof result.then !== "function") return result;
    let tracked;
    tracked = result.finally(() => {
      if (conversationDispatchTails.get(conversation.id) === tracked) conversationDispatchTails.delete(conversation.id);
    });
    conversationDispatchTails.set(conversation.id, tracked);
    return tracked;
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
      needs_attention: "需要关注",
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
    if (thread?.status === "awaiting_confirmation") {
      return `${label} ${status}：${summary}\n回复“确认”开始，或继续补充、回复“取消”。${detail}`;
    }
    if (thread?.status === "waiting_approval") {
      const approvalHint = thread.waitingFor === "approval"
        ? "任务内容已确认，正在等待桌面端审批中心批准；批准后会自动继续。"
        : "任务已创建，等待任务路由确认后开始执行。你不需要重复发送。";
      return `${label} ${status}：${summary}\n${approvalHint}${detail}`;
    }
    if (thread?.status === "waiting_user") return `${label} ${status}：${summary}\n请直接回复需要补充的信息。${detail}`;
    if (thread?.status === "needs_attention") return `${label} ${status}：${summary}\n任务暂时没有新进展，最近状态：${String(thread?.lastProgressSummary ?? "仍在处理中").slice(0, 240)}。回复“继续”继续观察，或回复“转人工”。${detail}`;
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
      thread.lastHeartbeatAt = null;
      thread.nextAction = threadNextAction(nextStatus, thread);
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
            dedupeKey: `channel-task:${notificationKey}`,
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
    const activeStatuses = new Set(["awaiting_confirmation", "waiting_approval", "queued", "running", "waiting_user", "needs_attention"]);
    runTx(() => {
      for (const thread of state.channelTaskThreads ?? []) {
        if (!thread.nextAction) thread.nextAction = threadNextAction(thread.status, thread);
        if (!thread.lastProgressAt) thread.lastProgressAt = thread.lastActivityAt ?? thread.updatedAt ?? now();
        if (!thread.lastProgressSummary) thread.lastProgressSummary = `状态更新：${taskThreadStatus(thread)}`;
        if (!Object.prototype.hasOwnProperty.call(thread, "lastHeartbeatAt")) thread.lastHeartbeatAt = null;
        if (!Object.prototype.hasOwnProperty.call(thread, "lastProgressNotificationAt")) thread.lastProgressNotificationAt = null;
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
    if (!Number.isFinite(currentMs)) return { changed: 0, handedOff: 0, needsAttention: 0, expired: 0 };
    let changed = 0;
    let handedOff = 0;
    let needsAttention = 0;
    let expired = 0;
    const notifications = [];
    const cancellations = [];
    const takeovers = [];
    const affectedChannelIds = new Set();
    runTx(() => {
      for (const thread of state.channelTaskThreads ?? []) {
        if (!["awaiting_confirmation", "waiting_approval", "queued", "running", "waiting_user", "needs_attention"].includes(thread.status)) continue;
        if (thread.status === "running") {
          const lastProgressMs = Date.parse(thread.lastProgressAt ?? thread.updatedAt ?? "");
          const lastHeartbeatMs = Date.parse(thread.lastHeartbeatAt ?? "");
          const progressAge = Number.isFinite(lastProgressMs) ? currentMs - lastProgressMs : Number.POSITIVE_INFINITY;
          const heartbeatAge = Number.isFinite(lastHeartbeatMs) ? currentMs - lastHeartbeatMs : Number.POSITIVE_INFINITY;
          if (progressAge >= CHANNEL_PROGRESS_HEARTBEAT_AFTER_MS && heartbeatAge >= CHANNEL_PROGRESS_HEARTBEAT_INTERVAL_MS) {
            const summary = String(thread.lastProgressSummary ?? "任务仍在执行").replace(/\s+/g, " ").trim().slice(0, 240);
            thread.lastHeartbeatAt = now();
            thread.lastProgressNotificationAt = now();
            notifications.push({
              channelId: thread.channelId,
              conversationId: thread.conversationId,
              threadId: thread.id,
              dedupeKey: `channel-task:${thread.id}:heartbeat:${thread.lastHeartbeatAt}`,
              content: `任务仍在执行，最近进展：${summary || "执行中"}。回复“进度”可随时查看。`,
            });
          }
        }
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
        } else if (thread.status !== "needs_attention") {
          const previousStatus = thread.status;
          setThreadStatus(thread, "needs_attention", "no_progress_timeout");
          thread.waitingFor = "attention";
          thread.attentionReason = previousStatus === "waiting_user"
            ? "user_response_timeout"
            : previousStatus === "waiting_approval"
              ? "approval_timeout"
              : previousStatus === "queued"
                ? "queue_wait_timeout"
                : "no_progress_timeout";
          thread.attentionAt = now();
          thread.resultSummary = "任务暂时没有新进展，仍保留自动执行上下文。";
          notifications.push({
            channelId: thread.channelId,
            conversationId: thread.conversationId,
            threadId: thread.id,
            content: "任务暂时没有新进展，但我还保留着执行状态。回复“进度”查看，回复“继续”继续观察，或回复“转人工”。",
          });
          needsAttention += 1;
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
          data: { changed, handedOff, needsAttention, expired },
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
    return { changed, handedOff, needsAttention, expired };
  }

  function listTaskThreads(conversation) {
    return (state.channelTaskThreads ?? [])
      .filter((thread) => thread.conversationId === conversation.id)
      .sort((left, right) => String(right.updatedAt ?? right.createdAt ?? "").localeCompare(String(left.updatedAt ?? left.createdAt ?? "")))
      .slice(0, 10);
  }

  function conversationHistoryReply(conversation) {
    const tasks = listTaskThreads(conversation).slice(0, 5);
    const consultations = (state.channelEvents ?? [])
      .filter((event) => event.conversationId === conversation.id && event.consultationStatus === "answered")
      .sort((left, right) => String(right.consultationCompletedAt ?? right.receivedAt ?? "").localeCompare(String(left.consultationCompletedAt ?? left.receivedAt ?? "")))
      .slice(0, 3);
    if (!tasks.length && !consultations.length) {
      return "当前还没有历史记录。直接发送问题或描述需求即可开始。";
    }
    const lines = ["最近记录："];
    for (const [index, task] of tasks.entries()) {
      lines.push(`${index + 1}. 任务${taskThreadStatus(task)}：${String(task.summary ?? "").slice(0, 100)}`);
    }
    for (const consultation of consultations) {
      lines.push(`咨询已回答：${String(consultation.content ?? "").slice(0, 80)}`);
    }
    lines.push("回复“进度”查看最新任务，或直接描述新的需求。");
    return lines.join("\n");
  }

  function candidateSelectionReply(threads) {
    const choices = threads.slice(0, 5).map((thread, index) => `${index + 1}. ${taskThreadStatus(thread)}：${String(thread.summary ?? "").slice(0, 80)}`).join("\n");
    return `我发现有多个任务正在等待处理。请回复“继续第一个任务”或“取消第一个任务”选择目标，也可以回复“另外……”创建新任务。\n${choices}`;
  }

  return {
    dispatchImportedChannelEvent,
    resumeIntake,
    recoverConsultations,
    syncConsultationFromInvocation,
    syncTaskThreadFromInvocation,
    recoverTaskThreads,
    sweepTaskThreads,
    listTaskThreads,
    taskThreadStatus,
  };
}
