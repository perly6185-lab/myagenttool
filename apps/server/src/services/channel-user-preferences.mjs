const LIST_REQUESTS = new Set(["我的偏好", "查看偏好", "偏好", "我习惯什么"]);

function text(value, max = 300) {
  const result = String(value ?? "").replace(/\s+/g, " ").trim();
  return result ? result.slice(0, max) : null;
}

function keyFor(value) {
  if (/(?:文章|内容).*(?:字数|长短|\d+\s*字)|(?:字数|长短).*(?:文章|内容)/i.test(value)) return "article_length";
  if (/(?:文章|内容).*(?:语气|风格)|(?:语气|风格).*(?:文章|内容)/i.test(value)) return "content_tone";
  if (/(?:配图|图片|插图).*(?:风格|感觉)|(?:风格|感觉).*(?:配图|图片|插图)/i.test(value)) return "image_style";
  if (/(?:口播|视频).*(?:时长|分钟)|(?:时长|分钟).*(?:口播|视频)/i.test(value)) return "voiceover_duration";
  if (/(?:默认|优先).*(?:发布|平台)|(?:发布|平台).*(?:默认|优先)/i.test(value)) return "publication_target";
  return "general";
}

export function parseChannelUserPreferenceRequest(value) {
  const normalized = text(value);
  if (!normalized) return null;
  if (LIST_REQUESTS.has(normalized)) return { kind: "list" };
  const save = normalized.match(/^(?:请|帮我)?记住[：:\s]*(.+)$/i);
  if (save?.[1]) {
    const preference = text(save[1]);
    return { kind: "save", key: keyFor(preference), value: preference };
  }
  const remove = normalized.match(/^(?:忘记|删除)(?:这个|这条)?(?:偏好|记忆)?[：:\s]*(.*)$/i)
    ?? normalized.match(/^取消(?:这个|这条)?(?:偏好|记忆)[：:\s]*(.*)$/i);
  if (remove) return { kind: "remove", key: remove[1] ? keyFor(text(remove[1])) : null, value: text(remove[1]) };
  return null;
}

export function channelPreferenceRows(state, { channelId, conversationId } = {}) {
  return (state?.channelUserPreferences ?? [])
    .filter((row) => row.channelId === channelId && row.conversationId === conversationId && row.status === "active")
    .slice(-20);
}

export function saveChannelUserPreference(state, { channelId, conversationId, externalUserId, key, value, eventId, timestamp } = {}) {
  const rows = state.channelUserPreferences ?? (state.channelUserPreferences = []);
  const existing = rows.find((row) => row.channelId === channelId && row.conversationId === conversationId && row.key === key && row.status === "active");
  if (existing) {
    Object.assign(existing, { value: text(value), sourceEventId: eventId ?? existing.sourceEventId ?? null, updatedAt: timestamp ?? existing.updatedAt ?? null });
    return existing;
  }
  const row = {
    id: `chpref_${channelId}_${conversationId}_${key}`.slice(0, 240),
    channelId,
    conversationId,
    externalUserId: text(externalUserId, 200),
    key: text(key, 80) ?? "general",
    value: text(value),
    status: "active",
    sourceEventId: eventId ?? null,
    createdAt: timestamp ?? null,
    updatedAt: timestamp ?? null,
  };
  state.channelUserPreferences = [...rows, row].slice(-500);
  return row;
}

export function removeChannelUserPreferences(state, { channelId, conversationId, key = null, timestamp } = {}) {
  const rows = state.channelUserPreferences ?? [];
  let removed = 0;
  for (const row of rows) {
    if (row.channelId !== channelId || row.conversationId !== conversationId || row.status !== "active") continue;
    if (key && row.key !== key) continue;
    row.status = "deleted";
    row.updatedAt = timestamp ?? row.updatedAt ?? null;
    removed += 1;
  }
  return removed;
}

export function channelPreferenceReply(rows) {
  if (!rows.length) return "目前还没有保存偏好。比如回复“记住：文章控制在 2000 字左右”，以后我会按这个习惯整理。";
  return `我目前记住了：\n${rows.map((row) => `- ${row.value}`).join("\n")}\n\n如果要修改或删除，直接说“记住：……”或“忘记这个偏好”。`;
}
