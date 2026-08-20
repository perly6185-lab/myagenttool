/* Plain-language projection of execution output for messaging channels. */

function cleanText(value, max = 4_000) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/\[([^\]]+)\]\((?:file:\/\/)?(?:\/Users\/|[A-Za-z]:\\)[^)]+\)/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

function markdownSections(value) {
  const sections = new Map();
  let current = "";
  for (const line of String(value ?? "").replace(/\r/g, "").split("\n")) {
    const heading = line.match(/^#{1,4}\s+(.+?)\s*$/)?.[1]?.trim().toLowerCase();
    if (heading) {
      current = heading;
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    if (!sections.has(current)) sections.set(current, []);
    sections.get(current).push(line);
  }
  return sections;
}

export function channelResultCopy(value, { readOnly = false } = {}) {
  const original = String(value ?? "").trim();
  if (!original) return null;
  const sections = markdownSections(original);
  const result = sections.get("result") ?? sections.get("结果") ?? null;
  if (result) {
    const lines = [cleanText(result.join("\n"), 2_400)];
    if (readOnly) {
      const changed = sections.get("what changed") ?? sections.get("处理说明") ?? sections.get("变更") ?? [];
      const safety = cleanText(changed.join("\n"), 500);
      if (safety && /(?:没有|未)(?:创建|修改|删除|移动|写入|更改)/.test(safety)) lines.push(safety);
    }
    return lines.filter(Boolean).join("\n\n").slice(0, 2_800);
  }
  return cleanText(original
    .replace(/^#{1,4}\s+Result\s*$/gim, "结果")
    .replace(/^#{1,4}\s+What changed\s*$/gim, "处理说明")
    .replace(/^#{1,4}\s+Checks performed\s*$/gim, "检查")
    .replace(/^#{1,4}\s+Remaining risks\s*$/gim, "注意")
    .replace(/^#{1,4}\s+Recommended next step\s*$/gim, "下一步"), 2_800);
}

function failureCode({ invocation = null, autoRun = null } = {}) {
  return String(
    invocation?.result?.errorCode
    ?? autoRun?.errorCode
    ?? invocation?.statusReason?.code
    ?? "",
  ).trim().toLowerCase();
}

export function channelFailureCopy({ invocation = null, autoRun = null, summary = null } = {}) {
  const code = failureCode({ invocation, autoRun });
  if (code === "policy_blocked") {
    return "安全检查发现执行要求存在冲突，已停止本次执行，没有修改文件。";
  }
  if (["dispatch_timeout", "agent_unavailable"].includes(code)) {
    return "执行设备暂时不可用，任务没有丢失。设备恢复后可回复“重试”。";
  }
  if (["execution_timeout", "timeout_no_progress", "timeout_budget_exhausted", "timeout_retries_exhausted"].includes(code)) {
    return "本次执行等待时间过长，系统已安全停止，没有应用未确认的更改。";
  }
  if (code === "approval_timeout") {
    return "等待授权超时，本次执行已安全停止。重新开始后会再次向你确认。";
  }
  const cleaned = cleanText(summary, 1_000)
    .replace(/^任务没有完成[：:]\s*/i, "")
    .replace(/^Agent run failed\.?$/i, "")
    .trim();
  return cleaned
    ? `执行没有正常完成：${cleaned}`
    : "执行环境没有正常完成本次任务，没有应用任何未确认的更改。";
}
