/*
 * Channel notification policy (P0-P3).
 *
 * Notifications are application messages, not task executions.  This service
 * decides whether a task event should be sent, aggregates low-value progress
 * updates, and hands the final message to the existing durable delivery queue.
 * It never starts a Bridge invocation and never owns provider credentials.
 */

import { makeRunTx } from "../runtime/store/run-tx.mjs";

export const CHANNEL_NOTIFICATION_MODES = Object.freeze(["important", "progress", "digest", "off"]);
export const CHANNEL_NOTIFICATION_EVENTS = Object.freeze([
  "queued", "started", "progress", "waiting_user", "waiting_approval",
  "needs_attention", "succeeded", "failed", "cancelled", "human_takeover",
]);

const IMPORTANT_EVENTS = new Set([
  "queued", "started", "waiting_user", "waiting_approval", "needs_attention",
  "succeeded", "failed", "cancelled", "human_takeover",
]);
const DEFAULT_EVENTS = Object.freeze({
  queued: true,
  started: true,
  progress: true,
  waiting_user: true,
  waiting_approval: true,
  needs_attention: true,
  succeeded: true,
  failed: true,
  cancelled: false,
  human_takeover: true,
});
const DEFAULT_QUIET_HOURS = Object.freeze({ enabled: false, start: "22:00", end: "08:00", timezone: "local" });
const MAX_LOG_ROWS = 2_000;

function timestamp(now) {
  const value = now?.();
  return typeof value === "string" && value ? value : new Date().toISOString();
}

function validTime(value, fallback) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value ?? "")) ? String(value) : fallback;
}

function validTimezone(value, fallback = "local") {
  const candidate = String(value ?? "").trim() || fallback;
  if (candidate === "local") return candidate;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format();
    return candidate;
  } catch {
    return fallback;
  }
}

function minutesOfDay(value) {
  const [hour, minute] = String(value).split(":").map(Number);
  return hour * 60 + minute;
}

function normalizeEvents(value, mode) {
  const events = { ...DEFAULT_EVENTS, ...(value && typeof value === "object" ? value : {}) };
  for (const event of CHANNEL_NOTIFICATION_EVENTS) events[event] = Boolean(events[event]);
  if (mode === "off") for (const event of CHANNEL_NOTIFICATION_EVENTS) events[event] = false;
  return events;
}

export function normalizeChannelNotificationPolicy(input = {}, base = {}) {
  // A first-time personal user should not need to discover a hidden setting to
  // learn that a long local task is alive. Progress remains rate-limited and
  // starts only after five minutes; an explicit "important" policy still opts
  // back out of periodic updates.
  const mode = CHANNEL_NOTIFICATION_MODES.includes(input.mode) ? input.mode : (base.mode ?? "progress");
  const quiet = { ...DEFAULT_QUIET_HOURS, ...(base.quietHours ?? {}), ...(input.quietHours ?? {}) };
  return {
    mode,
    progressIntervalMinutes: Math.min(240, Math.max(5, Number(input.progressIntervalMinutes ?? base.progressIntervalMinutes ?? 10) || 10)),
    progressStartAfterMinutes: Math.min(120, Math.max(0, Number(input.progressStartAfterMinutes ?? base.progressStartAfterMinutes ?? 5) || 0)),
    maxPerHour: Math.min(60, Math.max(1, Number(input.maxPerHour ?? base.maxPerHour ?? 12) || 12)),
    digestWindowSeconds: Math.min(300, Math.max(10, Number(input.digestWindowSeconds ?? base.digestWindowSeconds ?? 30) || 30)),
    events: normalizeEvents(input.events ?? base.events, mode),
    quietHours: {
      enabled: Boolean(input.quietHours?.enabled ?? base.quietHours?.enabled ?? quiet.enabled),
      start: validTime(input.quietHours?.start ?? base.quietHours?.start, quiet.start),
      end: validTime(input.quietHours?.end ?? base.quietHours?.end, quiet.end),
      timezone: validTimezone(input.quietHours?.timezone ?? base.quietHours?.timezone, quiet.timezone),
    },
  };
}

function quietEndAt(nowValue, quietHours) {
  if (!quietHours?.enabled) return null;
  const date = new Date(nowValue);
  if (Number.isNaN(date.getTime())) return null;
  const timezone = quietHours.timezone === "local" ? undefined : quietHours.timezone;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const current = hour * 60 + minute;
  const start = minutesOfDay(quietHours.start);
  const end = minutesOfDay(quietHours.end);
  const inQuiet = start === end ? true : start < end ? current >= start && current < end : current >= start || current < end;
  if (!inQuiet) return null;
  // Calculate a safe wall-clock target, then use a bounded delay.  The exact
  // DST transition is intentionally delegated to the next sweep.
  let minutesUntil = end - current;
  if (minutesUntil <= 0) minutesUntil += 24 * 60;
  return new Date(date.getTime() + minutesUntil * 60_000).toISOString();
}

function eventIsImportant(event) {
  return IMPORTANT_EVENTS.has(event);
}

function taskLabel(thread) {
  const summary = String(thread?.summary ?? "").replace(/\s+/g, " ").trim();
  return summary ? `【${summary.slice(0, 36)}${summary.length > 36 ? "…" : ""}】` : "【当前任务】";
}

function chineseHour(value) {
  const text = String(value ?? "");
  if (/^\d{1,2}$/.test(text)) return Number(text);
  const map = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  if (text === "十") return 10;
  if (text.startsWith("十")) return 10 + (map[text[1]] ?? 0);
  if (text.endsWith("十")) return (map[text[0]] ?? 0) * 10;
  if (text.length === 2 && map[text[0]] != null && map[text[1]] != null) return map[text[0]] * 10 + map[text[1]];
  return map[text] ?? null;
}

export function parseChannelNotificationPolicyRequest(text) {
  const value = String(text ?? "").trim().replace(/[。！!]+$/, "");
  if (!value) return null;
  if (/^(?:停止|关闭|不要|别再|取消).{0,8}(?:提醒|通知|进展|汇报)|^(?:不需要|不用)提醒/.test(value)) {
    return { patch: { mode: "off" }, reply: "好的，已停止这个会话的主动提醒。任务仍会继续执行，需要时可回复“进度”查看。" };
  }
  if (/^(?:恢复|打开|开启|继续).{0,8}(?:提醒|通知|进展|汇报)/.test(value)) {
    return { patch: { mode: "important" }, reply: "好的，已恢复重要节点提醒：排队、开始、等待、完成、失败和需要关注时通知你。" };
  }
  if (/只在(?:任务)?(?:完成|成功)和失败|只告诉我完成和失败|只要完成和失败/.test(value)) {
    return {
      patch: { mode: "important", events: { ...DEFAULT_EVENTS, progress: false, queued: false, started: false, waiting_user: true, waiting_approval: true, needs_attention: true, succeeded: true, failed: true, human_takeover: true } },
      reply: "已调整为重要结果提醒：完成、失败、等待你处理或需要关注时通知；普通进展不主动打扰。",
    };
  }
  const interval = value.match(/每\s*(\d+(?:\.\d+)?)\s*(分钟|分|小时|时)(?:提醒|通知|汇报|告诉我)/);
  const halfHour = /每\s*半小时(?:提醒|通知|汇报|告诉我)/.test(value);
  const oneHour = /每\s小时(?:提醒|通知|汇报|告诉我)/.test(value);
  if (interval || halfHour || oneHour || /有进展就告诉我|有进展通知我|主动告诉我进展/.test(value)) {
    const raw = interval ? Number(interval[1]) * (/(小时|时)/.test(interval[2]) ? 60 : 1) : halfHour ? 30 : oneHour ? 60 : 10;
    const progressIntervalMinutes = Math.min(240, Math.max(5, Math.round(raw)));
    return {
      patch: { mode: "progress", progressIntervalMinutes, events: { ...DEFAULT_EVENTS, progress: true } },
      reply: `已设置为进展提醒，约每 ${progressIntervalMinutes} 分钟最多通知一次；完成、失败和需要你处理时会立即通知。`,
    };
  }
  const quiet = value.match(/晚上\s*(\d{1,2}|[零〇一二两三四五六七八九十]+)\s*点(?:后|到)?(?:不要|不发|不提醒|不通知)/);
  if (quiet) {
    const parsedHour = chineseHour(quiet[1]) ?? 10;
    const hour = parsedHour < 12 ? parsedHour + 12 : parsedHour;
    const start = `${String(Math.min(23, hour)).padStart(2, "0")}:00`;
    const timezone = /北京时间|中国时间|上海时间/.test(value) ? "Asia/Shanghai" : "local";
    const timezoneLabel = timezone === "Asia/Shanghai" ? "（北京时间）" : "（跟随这台电脑时间）";
    return { patch: { quietHours: { enabled: true, start, end: "08:00", timezone } }, reply: `已设置免打扰时段：${start} 至次日 08:00${timezoneLabel}。重要消息会在免打扰结束后补发。` };
  }
  return null;
}

export function createChannelNotificationService({ state, now, nextId, appendEvent, persistStateSoon = () => {}, store, enqueueChannelDelivery }) {
  const runTx = makeRunTx({ store, persistStateSoon });
  const validScope = ({ channelId, conversationId }) => {
    const channel = (state.channels ?? []).find((row) => row.id === channelId);
    const conversation = (state.channelConversations ?? []).find((row) => row.id === conversationId);
    return Boolean(channel && conversation && conversation.channelId === channel.id);
  };
  const findPolicy = ({ channelId, conversationId, threadId = null }) => {
    const rows = state.channelNotificationPolicies ?? [];
    if (threadId) {
      const exact = rows.find((row) => row.channelId === channelId && row.conversationId === conversationId && row.threadId === threadId);
      if (exact) return exact;
    }
    return rows.find((row) => row.channelId === channelId && row.conversationId === conversationId && !row.threadId) ?? null;
  };

  function effectivePolicy(scope) {
    const saved = findPolicy(scope);
    return { ...normalizeChannelNotificationPolicy(saved ?? {}), ...(saved ? { id: saved.id, source: saved.threadId ? "task" : "conversation", updatedAt: saved.updatedAt } : { source: "default" }) };
  }

  function getPolicy(scope) {
    if (!validScope(scope)) return { policy: null };
    return { policy: effectivePolicy(scope) };
  }

  function listPolicies({ channelId, conversationId = null } = {}) {
    return { policies: (state.channelNotificationPolicies ?? []).filter((row) => row.channelId === channelId && (!conversationId || row.conversationId === conversationId)) };
  }

  function setPolicy({ channelId, conversationId, threadId = null, patch = {}, actorId = null } = {}) {
    if (!channelId || !conversationId) return { ok: false, reason: "scope_required" };
    if (!validScope({ channelId, conversationId })) return { ok: false, reason: "conversation_not_found" };
    const existing = findPolicy({ channelId, conversationId, threadId });
    const normalized = normalizeChannelNotificationPolicy(patch, existing ?? {});
    const at = timestamp(now);
    const row = existing ?? { id: nextId("cnp"), channelId, conversationId, threadId: threadId ?? null, createdAt: at };
    runTx(() => {
      Object.assign(row, normalized, { channelId, conversationId, threadId: threadId ?? null, updatedAt: at, updatedBy: actorId ?? null });
      if (!existing) state.channelNotificationPolicies = [...(state.channelNotificationPolicies ?? []), row].slice(-2_000);
      appendEvent?.({ invocationId: null, type: "channel_notification_policy_updated", level: "info", message: `Channel notification policy updated for ${conversationId}.`, data: { channelId, conversationId, threadId: threadId ?? null, mode: row.mode } });
    });
    return { ok: true, policy: effectivePolicy({ channelId, conversationId, threadId }) };
  }

  function recordLog({ channelId, conversationId, threadId, event, deliveryId, dedupeKey }) {
    const at = timestamp(now);
    runTx(() => {
      state.channelNotificationLog = [...(state.channelNotificationLog ?? []), { id: nextId("cnl"), channelId, conversationId, threadId: threadId ?? null, event, deliveryId: deliveryId ?? null, deliveryStatus: "queued", dedupeKey: dedupeKey ?? null, createdAt: at, updatedAt: at }].slice(-MAX_LOG_ROWS);
    });
  }

  function recentCount(channelId, conversationId, atMs) {
    return (state.channelNotificationLog ?? []).filter((row) => row.channelId === channelId && row.conversationId === conversationId && Date.parse(row.createdAt ?? "") >= atMs - 60 * 60_000).length;
  }

  function enqueueImmediate({ channelId, conversationId, threadId, invocationId, content, mediaAssets, dedupeKey, event }) {
    const result = enqueueChannelDelivery?.({
      channelId, conversationId, invocationId, content, mediaAssets, dedupeKey,
      taskContext: {
        channelId,
        conversationId,
        threadId: threadId ?? null,
        notificationEvent: event,
        deliveryKind: event === "succeeded" ? "result" : "status_notification",
      },
    }) ?? { ok: false, reason: "delivery_unavailable" };
    if (result?.ok && !result.deduplicated) recordLog({ channelId, conversationId, threadId, event, deliveryId: result.deliveryId, dedupeKey });
    return result;
  }

  function queueBatch({ channelId, conversationId, threadId, invocationId, content, mediaAssets, event, dueAt, dedupeKey }) {
    const at = timestamp(now);
    const existing = (state.channelNotificationBatches ?? []).find((row) => row.status === "pending" && row.channelId === channelId && row.conversationId === conversationId);
    runTx(() => {
      if (existing) {
        existing.items = [...(existing.items ?? []), { threadId: threadId ?? null, invocationId: invocationId ?? null, content: String(content).slice(0, 1_500), mediaAssets: mediaAssets ?? [], event }].slice(-20);
        existing.dueAt = dueAt < existing.dueAt ? dueAt : existing.dueAt;
        existing.updatedAt = at;
      } else {
        state.channelNotificationBatches = [...(state.channelNotificationBatches ?? []), { id: nextId("cnb"), channelId, conversationId, threadIds: threadId ? [threadId] : [], items: [{ threadId: threadId ?? null, invocationId: invocationId ?? null, content: String(content).slice(0, 1_500), mediaAssets: mediaAssets ?? [], event }], dueAt, dedupeKey, status: "pending", createdAt: at, updatedAt: at }].slice(-500);
      }
    });
    return { ok: true, batched: true };
  }

  function notifyTaskEvent({ channelId, conversationId, threadId = null, invocationId = null, event = "progress", content, mediaAssets = [], dedupeKey = null, force = false } = {}) {
    if (!channelId || !conversationId || !String(content ?? "").trim()) return { ok: false, reason: "invalid_notification" };
    if (!validScope({ channelId, conversationId })) return { ok: false, reason: "conversation_not_found" };
    const policy = effectivePolicy({ channelId, conversationId, threadId });
    if (!force && (!policy.events[event] || policy.mode === "off")) return { ok: true, suppressed: true, reason: "policy_disabled" };
    if (!force && policy.mode === "important" && !eventIsImportant(event)) {
      return { ok: true, suppressed: true, reason: "important_only" };
    }
    const currentMs = Date.parse(timestamp(now));
    const quietDueAt = !force ? quietEndAt(timestamp(now), policy.quietHours) : null;
    const thread = threadId ? (state.channelTaskThreads ?? []).find((row) => row.id === threadId) : null;
    if (!force && event === "progress") {
      const last = Date.parse(thread?.lastProgressNotificationAt ?? "");
      const started = Date.parse(thread?.createdAt ?? "");
      const startAfter = policy.progressStartAfterMinutes * 60_000;
      if (Number.isFinite(last) && Number.isFinite(currentMs) && currentMs - last < policy.progressIntervalMinutes * 60_000) return { ok: true, suppressed: true, reason: "progress_throttled" };
      if (Number.isFinite(started) && Number.isFinite(currentMs) && currentMs - started < startAfter) return { ok: true, suppressed: true, reason: "progress_start_delay" };
    }
    const activeRows = (state.channelTaskThreads ?? []).filter((row) => row.channelId === channelId && row.conversationId === conversationId && ["queued", "running"].includes(row.status));
    const activeTaskCount = activeRows.length;
    if (!force && !eventIsImportant(event) && (policy.mode === "digest" || (event === "progress" && activeTaskCount > 1))) {
      const dueAt = quietDueAt ?? new Date(currentMs + policy.digestWindowSeconds * 1_000).toISOString();
      const result = queueBatch({ channelId, conversationId, threadId, invocationId, content: `${taskLabel(thread)} ${content}`, mediaAssets, event, dueAt, dedupeKey });
      if (result?.ok && thread && event === "progress") runTx(() => { thread.lastProgressNotificationAt = timestamp(now); thread.updatedAt = timestamp(now); });
      return result;
    }
    if (!force && quietDueAt) {
      const result = queueBatch({ channelId, conversationId, threadId, invocationId, content: `${taskLabel(thread)} ${content}`, mediaAssets, event, dueAt: quietDueAt, dedupeKey });
      if (result?.ok && thread && event === "progress") runTx(() => { thread.lastProgressNotificationAt = timestamp(now); thread.updatedAt = timestamp(now); });
      return result;
    }
    if (!force && !eventIsImportant(event) && Number.isFinite(currentMs) && recentCount(channelId, conversationId, currentMs) >= policy.maxPerHour) return { ok: true, suppressed: true, reason: "hourly_limit" };
    const relevantTaskCount = activeTaskCount + (thread && !activeRows.some((row) => row.id === thread.id) ? 1 : 0);
    const labeled = content.startsWith("【") || relevantTaskCount <= 1 ? content : `${taskLabel(thread)} ${content}`;
    const result = enqueueImmediate({ channelId, conversationId, threadId, invocationId, content: labeled, mediaAssets, dedupeKey: dedupeKey ?? `channel-notify:${threadId ?? conversationId}:${event}:${Math.floor(currentMs / 60_000)}`, event });
    if (result?.ok && thread && event === "progress") {
      runTx(() => { thread.lastProgressNotificationAt = timestamp(now); thread.updatedAt = timestamp(now); });
    }
    return result;
  }

  function sweep() {
    const currentMs = Date.parse(timestamp(now));
    if (!Number.isFinite(currentMs)) return { processed: 0 };
    const due = (state.channelNotificationBatches ?? []).filter((row) => row.status === "pending" && Date.parse(row.dueAt ?? "") <= currentMs);
    let processed = 0;
    for (const batch of due) {
      const content = [`进展汇总（${batch.items.length} 条）：`, ...batch.items.map((item) => `• ${item.content}`), "如需查看单个任务，回复“进度”。"].join("\n");
      const result = enqueueImmediate({ channelId: batch.channelId, conversationId: batch.conversationId, threadId: batch.items[0]?.threadId ?? null, invocationId: batch.items[0]?.invocationId ?? null, content, mediaAssets: batch.items.flatMap((item) => item.mediaAssets ?? []).slice(0, 5), dedupeKey: `channel-batch:${batch.id}`, event: "progress" });
      if (result?.ok) { runTx(() => { batch.status = "sent"; batch.sentAt = timestamp(now); batch.updatedAt = timestamp(now); }); processed += 1; }
    }
    return { processed };
  }

  return { getPolicy, listPolicies, setPolicy, notifyTaskEvent, sweep, parseChannelNotificationPolicyRequest };
}
