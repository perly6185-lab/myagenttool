export const TASK_BASKET_TTL_MS = 10 * 60 * 1000;

const REMOVE_PATTERNS = [
  { kinds: ["content_image"], pattern: /(?:去掉|删掉|取消|不要|不做|先不做).{0,4}(?:配图|插图|封面|图片)/i },
  { kinds: ["content_comic"], pattern: /(?:去掉|删掉|取消|不要|不做|先不做).{0,4}(?:漫画|条漫)/i },
  { kinds: ["content_voiceover"], pattern: /(?:去掉|删掉|取消|不要|不做|先不做).{0,4}(?:口播|配音|播客)/i },
  { kinds: ["content_video"], pattern: /(?:去掉|删掉|取消|不要|不做|先不做).{0,4}(?:短视频|视频)/i },
  { kinds: ["content_article"], pattern: /(?:去掉|删掉|取消|不要|不做|先不做).{0,4}(?:文章|长文|博客)/i },
  { kinds: ["knowledge_analysis"], pattern: /(?:去掉|删掉|取消|不要|不做|先不做).{0,4}(?:深度分析|分析|研究)/i },
  {
    kinds: ["content_publish", "platform_adaptation", "wechat_draft_sync"],
    pattern: /(?:去掉|删掉|取消|不要|不做|先不|先不做|暂不).{0,6}(?:发布|投放|发到|同步到|平台适配)/i,
  },
];

function normalized(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 4_000);
}

export function taskBasketPreviewRequested(text) {
  const value = normalized(text);
  return /(?:先(?:帮我)?(?:规划|列(?:一下)?步骤|看看(?:怎么做|计划)|整理(?:一下)?步骤)|先不要(?:创建|执行|开始)|暂不(?:创建|执行)|先确认(?:一下)?(?:步骤|计划)|让我先看看)/i.test(value);
}

export function taskBasketAction(text) {
  const value = normalized(text).replace(/[!！。.,，?？~～]+$/g, "");
  if (/^(?:取消|算了|不用了|放弃)(?:这次)?(?:规划|计划|任务篮)?$/i.test(value)) return { kind: "cancel" };
  if (/^(?:确认|确定|开始|执行|按这个做|按这个来|可以开始|开始吧|确认执行)$/i.test(value)) return { kind: "confirm" };
  const match = REMOVE_PATTERNS.find((candidate) => candidate.pattern.test(value));
  return match ? { kind: "remove", kinds: match.kinds } : null;
}

export function taskBasketExpired(basket, currentTime) {
  const createdAt = Date.parse(String(basket?.createdAt ?? ""));
  const currentAt = Date.parse(String(currentTime ?? ""));
  return !Number.isFinite(createdAt) || !Number.isFinite(currentAt) || currentAt - createdAt > TASK_BASKET_TTL_MS;
}

export function snapshotTaskBasket(plan, { id, originalText, createdAt, excludedKinds = [] } = {}) {
  return {
    id: String(id ?? "").slice(0, 200),
    originalText: normalized(originalText),
    intentId: plan?.intent?.id ?? plan?.goal?.id ?? null,
    domain: plan?.goal?.domains?.length === 1 ? plan.goal.domains[0] : null,
    excludedKinds: [...new Set(excludedKinds.map((kind) => String(kind).slice(0, 80)))].slice(0, 20),
    goal: plan?.goal ?? null,
    tasks: (Array.isArray(plan?.tasks) ? plan.tasks : []).map((task) => ({
      key: task.key,
      kind: task.kind,
      title: task.title,
      outcome: task.outcome,
      requires: task.requires ?? [],
      approvalRequired: task.approvalRequired === true,
      platform: task.platform ?? null,
      artifactContract: task.artifactContract ?? null,
    })),
    createdAt: createdAt ?? new Date().toISOString(),
    updatedAt: createdAt ?? new Date().toISOString(),
  };
}

export function taskBasketReply(basket, { revised = false } = {}) {
  const tasks = Array.isArray(basket?.tasks) ? basket.tasks : [];
  const lines = [
    revised ? "已按你的调整重新整理任务篮：" : "我先帮你整理成一组独立任务，暂不创建或执行：",
    !revised && basket?.goal?.title ? `这件事：${String(basket.goal.title).slice(0, 160)}` : null,
    ...tasks.map((task, index) => `${index + 1}. ${task.title}${task.platform?.label ? `（${task.platform.label}）` : ""}${task.approvalRequired ? "｜发布前需要你确认" : ""}`),
    tasks.length ? "回复“确认执行”开始；也可以说“去掉图片”“先不发布”，或回复“取消规划”。" : "当前没有可执行步骤，请重新描述想要的结果。",
  ].filter(Boolean);
  return lines.join("\n");
}
