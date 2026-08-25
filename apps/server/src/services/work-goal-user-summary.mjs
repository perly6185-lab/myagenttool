const ACTIVE = new Set(["queued", "running", "in_progress", "ready", "backlog"]);
const WAITING = new Set(["waiting_upstream"]);
const NEEDS_USER = new Set(["awaiting_confirmation", "waiting_approval", "waiting_user", "needs_attention", "failed", "human_takeover", "review", "blocked"]);

function bounded(value, limit = 160) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function taskStatus(task) {
  if (task?.state === "closed" || task?.status === "done" || task?.status === "succeeded") return "succeeded";
  if (task?.status === "in_progress") return "running";
  return String(task?.status ?? "unknown");
}

function taskTitle(task) {
  return bounded(task?.taskTitle ?? task?.title ?? task?.summary ?? "未命名任务", 100);
}

function qualityStatus(task, workItem) {
  const status = taskStatus(task);
  const verification = workItem?.resultVerification ?? task?.resultVerification ?? null;
  if (verification?.status === "failed" && (NEEDS_USER.has(status) || status === "succeeded")) return "failed";
  if (verification?.status === "passed" && (NEEDS_USER.has(status) || status === "succeeded")) return "passed";
  if (status !== "succeeded") return "pending";
  if (!verification || verification.status === "not_required") return "unchecked";
  return verification.status === "passed" ? "passed" : "failed";
}

function changeSummary(change) {
  if (!change) return null;
  const actions = { add: "新增", modify: "修改", cancel: "取消", pause: "暂停", preserve: "保持", rebind: "改换发布安排" };
  const counts = new Map();
  for (const entry of change.changes ?? []) counts.set(entry.action, (counts.get(entry.action) ?? 0) + 1);
  const detail = [...counts].map(([action, count]) => `${actions[action] ?? action} ${count} 项`).join("、");
  const status = String(change.status ?? "");
  const statusText = status === "applied" ? "已应用" : status === "awaiting_confirmation" ? "等待确认" : status === "stale" ? "已重新整理" : status === "failed_rolled_back" ? "已撤回未完成调整" : "处理中";
  return detail ? `${statusText}：${detail}` : statusText;
}

export function buildWorkGoalUserSummary({ goal, tasks = [], workItems = [], latestChange = null } = {}) {
  if (!goal) return null;
  const itemById = new Map(workItems.map((item) => [item.id, item]));
  const normalized = tasks.map((task) => {
    const status = taskStatus(task);
    return {
      id: task.id,
      workItemId: task.workItemId ?? task.id,
      title: taskTitle(task),
      status,
      quality: qualityStatus(task, itemById.get(task.workItemId ?? task.id)),
    };
  });
  const completed = normalized.filter((task) => task.status === "succeeded");
  const cancelled = normalized.filter((task) => task.status === "cancelled");
  const failed = normalized.filter((task) => task.status === "failed");
  const running = normalized.filter((task) => ACTIVE.has(task.status));
  const waiting = normalized.filter((task) => WAITING.has(task.status));
  const needsUser = normalized.filter((task) => NEEDS_USER.has(task.status));
  const qualityFailed = normalized.filter((task) => task.quality === "failed");
  const qualityPassed = normalized.filter((task) => task.quality === "passed");
  const total = normalized.length + (goal.failedSteps?.length ?? 0);
  let nextStep = "可以继续告诉我新的要求。";
  let nextAction = { kind: "none", workItemId: null, label: "暂无需操作" };
  if (qualityFailed.length) {
    nextStep = `请先处理“${qualityFailed.slice(0, 3).map((task) => task.title).join("、")}”的结果检查问题。`;
    nextAction = { kind: "repair_result", workItemId: qualityFailed[0].workItemId, label: "查看并返工" };
  } else if (needsUser.length) {
    nextStep = `需要你处理：${needsUser.slice(0, 3).map((task) => task.title).join("、")}。`;
    nextAction = { kind: "open_task", workItemId: needsUser[0].workItemId, label: "去处理" };
  } else if (running.length) {
    nextStep = `正在处理：${running.slice(0, 3).map((task) => task.title).join("、")}；完成后会通知你。`;
    nextAction = { kind: "view_progress", workItemId: running[0].workItemId, label: "查看进度" };
  } else if (waiting.length) {
    nextStep = `正在等待前置成品：${waiting.slice(0, 3).map((task) => task.title).join("、")}。`;
    nextAction = { kind: "view_waiting", workItemId: waiting[0].workItemId, label: "查看等待原因" };
  } else if (completed.length < total) {
    nextStep = "还有任务尚未开始或需要修复，可以查看任务列表继续处理。";
    const remaining = normalized.find((task) => task.status !== "succeeded" && task.status !== "cancelled");
    nextAction = { kind: "open_task", workItemId: remaining?.workItemId ?? null, label: "查看任务" };
  }

  return {
    schemaVersion: 1,
    goalId: goal.id,
    title: bounded(goal.title ?? goal.statement ?? "待完成的工作"),
    outcome: bounded(goal.outcome ?? goal.statement ?? "", 300),
    status: goal.status ?? "active",
    progress: {
      total,
      completed: completed.length,
      cancelled: cancelled.length,
      failed: failed.length + (goal.failedSteps?.length ?? 0),
      running: running.length,
      waiting: waiting.length,
      needsUser: needsUser.length,
      percent: total ? Math.round((completed.length / total) * 100) : 0,
    },
    quality: {
      passed: qualityPassed.length,
      failed: qualityFailed.length,
      unchecked: normalized.filter((task) => task.quality === "unchecked").length,
    },
    needsUser: needsUser.slice(0, 10),
    nextStep,
    nextAction,
    latestChange: latestChange ? {
      id: latestChange.id,
      status: latestChange.status,
      summary: changeSummary(latestChange),
      updatedAt: latestChange.appliedAt ?? latestChange.updatedAt ?? latestChange.createdAt ?? null,
    } : null,
  };
}

export function workGoalUserSummaryReply(summary, { tasks = [] } = {}) {
  if (!summary) return "这件事还没有可执行任务。请补充你希望得到的结果。";
  const lines = [
    `这件事：${summary.title}`,
    `整体进度：已完成 ${summary.progress.completed}/${summary.progress.total} 项（${summary.progress.percent}%）${summary.progress.cancelled ? `，已取消 ${summary.progress.cancelled} 项` : ""}${summary.progress.failed ? `，有 ${summary.progress.failed} 项未完成` : ""}。`,
    summary.latestChange?.summary ? `最近调整：${summary.latestChange.summary}。` : null,
    summary.quality.failed
      ? `结果检查：${summary.quality.failed} 项未通过，不能当作合格交付。`
      : summary.quality.passed ? `结果检查：${summary.quality.passed} 项已通过。` : null,
    `下一步：${summary.nextStep}`,
    tasks.length ? "任务：" : null,
    ...tasks.slice(0, 10).map((task, index) => `${index + 1}. ${taskTitle(task)}：${bounded(task.userStatus ?? task.status, 40)}`),
  ].filter(Boolean);
  return lines.join("\n");
}
