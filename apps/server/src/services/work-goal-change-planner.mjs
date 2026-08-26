import { platformTargetsIn } from "./discrete-task-planner.mjs";

export const WORK_GOAL_CHANGE_TTL_MS = 10 * 60 * 1000;

const TASK_KINDS = [
  { kind: "coding_digest", label: "编码成果整理", domain: "content", aliases: /编码成果|编码整理|开发总结|代码总结/i },
  { kind: "knowledge_analysis", label: "深度分析", domain: "content", aliases: /深度分析|分析报告/i },
  { kind: "content_article", label: "文章创作", domain: "content", aliases: /深度文章|公众号文章|技术文章|长文|博客|文章|稿件/i },
  { kind: "content_image", label: "图片创作", domain: "content", aliases: /封面图|配图|插图|图文图片|图片/i },
  { kind: "content_comic", label: "漫画", domain: "content", aliases: /条漫|漫画|分镜/i },
  { kind: "content_voiceover", label: "口播", domain: "content", aliases: /口播稿|口播|配音|播客/i },
  { kind: "content_video", label: "视频", domain: "content", aliases: /短视频|视频/i },
  { kind: "software_analysis", label: "需求分析", domain: "development", aliases: /需求分析|问题分析|原因分析|技术调研/i },
  { kind: "software_implementation", label: "软件实现", domain: "development", aliases: /软件实现|代码实现|编码|开发|修复/i },
  { kind: "software_verification", label: "软件验证", domain: "development", aliases: /自动化测试|测试|构建|验证|代码审查/i },
  { kind: "software_deployment", label: "部署发布", domain: "development", aliases: /部署|上线|发版/i },
  { kind: "business_research", label: "商务调研", domain: "business", aliases: /付款记录|回款记录|客户记录|客户调研|市场调研|竞品调研|商务调研|资料核对|资料整理/i },
  { kind: "business_document", label: "商务材料", domain: "business", aliases: /客户方案|商务方案|报价|合同草稿|商务材料|方案/i },
  { kind: "business_communication", label: "对外沟通", domain: "business", aliases: /发送邮件|对外发送|回复客户|联系客户|客户沟通|发送/i },
  { kind: "business_scheduling", label: "安排日程", domain: "business", aliases: /安排会议|预约会议|安排日程|日程/i },
];

const PUBLICATION_RE = /发布|发到|发往|发公众号|发小红书|发抖音|发微博|发送到平台/i;
const CHANGE_SIGNAL_RE = /再加|新增|增加|补(?:一个|一项|上)?|另外|此外|顺便|还要|也做|改成|改为|改发|换成|调整|缩短|延长|改短|改长|字数|页数|时长|分辨率|取消|去掉|删除|不要|不用|不做|不发|不发布|暂停|停一下|不动|照旧|保持|还是|继续/i;
const ADD_RE = /再加|新增|增加|补(?:一个|一项|上)?|另外|此外|顺便|还要|也做/i;
const CANCEL_RE = /取消|去掉|删除|不要|不用|不做|不再做|不发|不发布|不要发送/i;
const PAUSE_RE = /暂停|停一下|先不做|先不发|暂不/i;
const PRESERVE_RE = /不动|照旧|保持(?:不变)?|还是|继续(?:做|进行|保留)?/i;
const MODIFY_RE = /改成|改为|调整|缩短|延长|改短|改长|字数|页数|时长|分辨率|语气|结构|格式/i;
const REBIND_RE = /改发|改为.{0,12}(?:发布|发)|换成.{0,12}(?:发布|发)|(?:发布|发).{0,8}改成/i;

function clean(value, max = 2_000) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function splitClauses(text) {
  return clean(text, 4_000).split(/[；;。\n]|，(?=.{0,40}(?:再加|新增|增加|另外|此外|顺便|还要|改|换|调整|取消|去掉|删除|不要|不用|不做|不发|暂停|停一下|不动|照旧|保持|还是|继续))/u)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function kindsIn(text) {
  const value = clean(text);
  return TASK_KINDS.filter((entry) => entry.aliases.test(value));
}

function normalizedTask(task) {
  return {
    id: clean(task?.id, 200),
    workItemId: clean(task?.workItemId, 200) || null,
    kind: clean(task?.kind ?? task?.taskKind, 80),
    title: clean(task?.title ?? task?.taskTitle ?? task?.summary, 160) || "未命名任务",
    status: clean(task?.status, 60) || "unknown",
    platform: task?.platform ?? task?.platformTarget ?? null,
    dependencyIds: [...new Set((task?.dependencyIds ?? []).map((id) => clean(id, 200)).filter(Boolean))],
  };
}

function downstreamTasks(tasks, sourceTasks) {
  const reachedWorkItemIds = new Set(sourceTasks.map((task) => task.workItemId).filter(Boolean));
  const reachedTaskIds = new Set(sourceTasks.map((task) => task.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of tasks) {
      if (reachedTaskIds.has(task.id) || !task.dependencyIds.some((id) => reachedWorkItemIds.has(id))) continue;
      reachedTaskIds.add(task.id);
      if (task.workItemId) reachedWorkItemIds.add(task.workItemId);
      changed = true;
    }
  }
  return tasks.filter((task) => reachedTaskIds.has(task.id) && !sourceTasks.some((source) => source.id === task.id));
}

function publicationTasks(tasks, platforms = []) {
  const platformIds = new Set(platforms.map((platform) => platform.id));
  return tasks.filter((task) => ["platform_adaptation", "wechat_draft_sync", "content_publish"].includes(task.kind)
    && (!platformIds.size || platformIds.has(task.platform?.id)));
}

function matchingTasks(tasks, kinds, clause, platforms = []) {
  const kindSet = new Set(kinds.map((entry) => entry.kind));
  if (PUBLICATION_RE.test(clause) && !kindSet.size) return publicationTasks(tasks, platforms);
  return tasks.filter((task) => kindSet.has(task.kind));
}

function changeKey(change) {
  return [change.action, change.taskKind, change.platform?.id, ...(change.targetIds ?? [])].join(":");
}

function changeLabel(change) {
  if (change.action === "add") return `新增“${change.label}”`;
  if (change.action === "modify") return `调整“${change.label}”：${change.request}`;
  if (change.action === "cancel") return `取消“${change.label}”`;
  if (change.action === "pause") return `暂停“${change.label}”`;
  if (change.action === "rebind") return `${change.platform.label}改用“${change.contentLabel}”发布`;
  return `保持“${change.label}”不变`;
}

/**
 * Classifies an explicit follow-up against one active work goal. It does not
 * mutate tasks and deliberately ignores ordinary questions or vague feedback.
 */
export function planWorkGoalChange({ text, goal = null, tasks = [] } = {}) {
  const requestedText = clean(text, 4_000);
  const currentTasks = (Array.isArray(tasks) ? tasks : []).map(normalizedTask).filter((task) => task.id);
  if (!goal || !requestedText || !currentTasks.length || !CHANGE_SIGNAL_RE.test(requestedText)) {
    return { matched: false, reason: "not_an_explicit_goal_change", changes: [] };
  }

  const changes = [];
  const unresolved = [];
  for (const clause of splitClauses(requestedText)) {
    const kinds = kindsIn(clause);
    const platforms = platformTargetsIn(clause);

    if (REBIND_RE.test(clause) && platforms.length && kinds.some((entry) => entry.kind.startsWith("content_"))) {
      const content = kinds.find((entry) => ["content_article", "content_image", "content_comic", "content_voiceover", "content_video"].includes(entry.kind));
      for (const platform of platforms) {
        const targets = publicationTasks(currentTasks, [platform]);
        changes.push({
          action: "rebind",
          platform,
          taskKind: content.kind,
          contentLabel: content.label,
          label: `${platform.label}发布`,
          targetIds: targets.map((task) => task.id),
          request: clause,
        });
      }
      continue;
    }

    if (PRESERVE_RE.test(clause) && platforms.length && kinds.some((entry) => entry.kind.startsWith("content_"))) {
      const content = kinds.find((entry) => ["content_article", "content_image", "content_comic", "content_voiceover", "content_video"].includes(entry.kind));
      for (const platform of platforms) {
        const targets = publicationTasks(currentTasks, [platform]);
        changes.push({
          action: "preserve",
          platform,
          taskKind: content.kind,
          contentLabel: content.label,
          label: `${platform.label}继续使用${content.label}`,
          targetIds: targets.map((task) => task.id),
          request: clause,
        });
      }
      continue;
    }

    const targets = matchingTasks(currentTasks, kinds, clause, platforms);
    const action = PAUSE_RE.test(clause) ? "pause"
      : CANCEL_RE.test(clause) ? "cancel"
        : PRESERVE_RE.test(clause) ? "preserve"
          : ADD_RE.test(clause) ? "add"
            : MODIFY_RE.test(clause) ? "modify"
              : null;
    if (!action) continue;

    if (action === "add") {
      if (!kinds.length) {
        unresolved.push(clause);
        continue;
      }
      for (const entry of kinds) {
        changes.push({ action, taskKind: entry.kind, domain: entry.domain, label: entry.label, targetIds: [], request: clause });
      }
      continue;
    }

    if (!targets.length) {
      // “不要发送” and similar wording can name an absent optional step. It is
      // a valid preservation constraint, not a request to invent that task.
      if ((action === "cancel" || action === "pause") && (PUBLICATION_RE.test(clause) || kinds.length)) {
        changes.push({ action: "preserve", taskKind: kinds[0]?.kind ?? "content_publish", label: kinds[0]?.label ?? "发布", targetIds: [], request: clause, alreadyAbsent: true });
      } else {
        unresolved.push(clause);
      }
      continue;
    }
    for (const target of targets) {
      changes.push({ action, taskKind: target.kind, label: target.title, targetIds: [target.id], request: clause });
    }
  }

  const unique = [...new Map(changes.map((change) => [changeKey(change), change])).values()];
  const material = unique.filter((change) => change.action !== "preserve");
  if (!unique.length || (!material.length && unresolved.length)) {
    return { matched: false, reason: "change_target_not_resolved", changes: [], unresolved };
  }
  const affectedIds = new Set(material.flatMap((change) => change.targetIds ?? []));
  const impactByTaskId = new Map();
  for (const change of material.filter((candidate) => ["modify", "cancel", "pause", "rebind"].includes(candidate.action))) {
    const sources = currentTasks.filter((task) => (change.targetIds ?? []).includes(task.id));
    for (const task of downstreamTasks(currentTasks, sources)) {
      if (affectedIds.has(task.id)) continue;
      impactByTaskId.set(task.id, task);
    }
  }
  const downstream = [...impactByTaskId.values()];
  const impactedIds = new Set([...affectedIds, ...downstream.map((task) => task.id)]);
  const unchanged = currentTasks.filter((task) => !impactedIds.has(task.id));
  return {
    matched: true,
    goalId: clean(goal.id, 200),
    requestedText,
    changes: unique,
    materialChangeCount: material.length,
    directAffectedCount: affectedIds.size,
    downstream,
    unchanged,
    unresolved,
    previewLines: unique.map(changeLabel),
  };
}

export function workGoalChangeReply(proposal, { revised = false } = {}) {
  const changes = proposal?.changes ?? [];
  const material = changes.filter((change) => change.action !== "preserve");
  const preserved = changes.filter((change) => change.action === "preserve");
  const lines = [
    revised ? "已更新这次调整，当前预览：" : "我理解你要调整当前这件事：",
    ...changes.map((change, index) => `${index + 1}. ${changeLabel(change)}`),
    proposal?.downstream?.length
      ? `连带影响：${proposal.downstream.map((task) => `“${task.title}”`).slice(0, 5).join("、")}等 ${proposal.downstream.length} 个下游任务需要等待、重新确认或处理受阻。`
      : null,
    proposal?.unchanged?.length ? `其余 ${proposal.unchanged.length} 个任务保持不变。` : null,
    preserved.some((change) => change.alreadyAbsent) ? "你明确不要的步骤目前本来就没有，我不会补建。" : null,
    proposal?.unresolved?.length ? `暂未纳入：${proposal.unresolved.join("；")}。` : null,
    material.length
      ? "尚未执行。回复“确认调整”应用这些变化，或回复“取消调整”保持现状。"
      : "当前没有需要实际改动的任务。",
  ];
  return lines.filter(Boolean).join("\n");
}

export function workGoalChangeAction(text) {
  const value = clean(text).replace(/[。.!！?？]+$/u, "");
  if (/^(?:确认调整|确认修改|应用调整|按这个调整|就这样改|确认)$/i.test(value)) return "confirm";
  if (/^(?:取消调整|取消修改|不改了|保持现状|算了)$/i.test(value)) return "cancel";
  return null;
}

export function workGoalChangeExpired(proposal, timestamp = new Date().toISOString()) {
  const createdAt = Date.parse(proposal?.createdAt ?? "");
  const current = Date.parse(timestamp);
  return !Number.isFinite(createdAt) || !Number.isFinite(current) || current - createdAt > WORK_GOAL_CHANGE_TTL_MS;
}

export function taskKindLabel(kind) {
  return TASK_KINDS.find((entry) => entry.kind === kind)?.label ?? kind;
}
