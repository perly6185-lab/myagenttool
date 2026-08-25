const TASK_ALIASES = Object.freeze({
  coding_digest: ["编码", "开发总结", "编码成果"],
  content_article: ["文章", "稿件"],
  content_image: ["图片", "配图", "封面"],
  content_comic: ["漫画", "条漫"],
  content_voiceover: ["口播", "配音"],
  content_video: ["视频"],
  software_analysis: ["需求分析", "问题分析"],
  software_implementation: ["开发", "编码", "实现", "修复"],
  software_verification: ["测试", "构建", "验证"],
  software_deployment: ["部署", "上线"],
  business_research: ["调研", "资料整理"],
  business_document: ["方案", "报价", "商务材料"],
  business_communication: ["发送", "邮件", "客户沟通"],
});

function normalized(value) {
  return String(value ?? "").replace(/[。.!！?？]/g, "").replace(/\s+/g, "").toLowerCase();
}

export function rememberChannelFocus(conversation, { goalId = null, taskThreadId = null, materialIds = null, reason = "interaction", at = null } = {}) {
  if (!conversation) return null;
  const previous = conversation.focusMemory ?? {};
  const recentTaskThreadIds = taskThreadId
    ? [taskThreadId, ...(previous.recentTaskThreadIds ?? []).filter((id) => id !== taskThreadId)].slice(0, 10)
    : [...(previous.recentTaskThreadIds ?? [])].slice(0, 10);
  const recentMaterialIds = Array.isArray(materialIds)
    ? [...new Set([...materialIds, ...(previous.recentMaterialIds ?? [])])].slice(0, 10)
    : [...(previous.recentMaterialIds ?? [])].slice(0, 10);
  conversation.focusMemory = {
    schemaVersion: 1,
    goalId: goalId ?? previous.goalId ?? conversation.activeWorkGoalId ?? null,
    taskThreadId: taskThreadId ?? previous.taskThreadId ?? conversation.activeTaskThreadId ?? null,
    recentTaskThreadIds,
    recentMaterialIds,
    reason,
    updatedAt: at ?? previous.updatedAt ?? null,
  };
  if (goalId) conversation.activeWorkGoalId = goalId;
  if (taskThreadId) conversation.activeTaskThreadId = taskThreadId;
  return conversation.focusMemory;
}

export function resolveChannelTaskFocus(conversation, threads = [], text = "") {
  const value = normalized(text);
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const memoryIds = [
    conversation?.focusMemory?.taskThreadId,
    conversation?.activeTaskThreadId,
    ...(conversation?.focusMemory?.recentTaskThreadIds ?? []),
  ].filter(Boolean);
  const contextual = /^(?:这个|那个|它|当前这个|刚才(?:那个|这个)?)(?:任务|工作|结果)?/.test(value);
  if (contextual) {
    const focused = memoryIds.map((id) => byId.get(id)).find(Boolean);
    if (focused) return { thread: focused, reason: "conversation_focus", ambiguous: false };
  }
  const correction = value.match(/(?:不是.+?(?:是|要)|我说的是|指的是|改成)(.+)$/)?.[1] ?? value;
  const matches = threads.filter((thread) => {
    const terms = [thread.taskTitle, thread.summary, thread.platformTarget?.label, ...(TASK_ALIASES[thread.taskKind] ?? [])]
      .map(normalized).filter(Boolean);
    return terms.some((term) => correction.includes(term) || term.includes(correction));
  });
  if (matches.length === 1) return { thread: matches[0], reason: "named_focus", ambiguous: false };
  if (matches.length > 1) return { thread: null, candidates: matches.slice(0, 5), reason: "ambiguous_focus", ambiguous: true };
  return { thread: null, candidates: [], reason: "focus_not_found", ambiguous: false };
}

export function contextualTaskControl(text, conversation, threads = []) {
  const value = String(text ?? "").trim().replace(/[。.!！?？]+$/u, "");
  const actionMatch = value.match(/^(这个|那个|它|当前这个|刚才(?:那个|这个)?)(?:任务|工作)?(?:先)?(暂停|停一下|取消|停止|继续|恢复|重试|再试一次|进度|怎么样)$/u);
  const correctionMatch = value.match(/^(?:不是.+?[，,]\s*)?(?:是|我说的是|指的是)(.+)$/u);
  if (!actionMatch && !correctionMatch) return null;
  const focus = resolveChannelTaskFocus(conversation, threads, actionMatch ? actionMatch[1] : correctionMatch[1]);
  if (focus.ambiguous) return { kind: "focus_clarify", candidates: focus.candidates };
  if (!focus.thread) return { kind: "focus_missing" };
  const actions = { 暂停: "pause", 停一下: "pause", 取消: "cancel", 停止: "cancel", 继续: "resume", 恢复: "resume", 重试: "retry", 再试一次: "retry", 进度: "status", 怎么样: "status" };
  return { kind: actionMatch ? actions[actionMatch[2]] : "select", threadId: focus.thread.id, friendly: true, contextual: true };
}
