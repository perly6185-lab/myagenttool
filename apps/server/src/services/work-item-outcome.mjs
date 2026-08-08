function cleanInlineMarkdown(value) {
  return String(value ?? "")
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, "")
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .replace(/[*_`]+/g, "")
    .trim();
}

function meaningfulLines(markdown) {
  return String(markdown ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line !== "---");
}

function headlineFrom(markdown) {
  const lines = meaningfulLines(markdown);
  const preferredHeading = lines.findIndex((line) =>
    /^#{1,6}\s*(?:核心主题|一句话|结论|summary|result|outcome)/i.test(line));
  if (preferredHeading >= 0) {
    const candidate = lines.slice(preferredHeading + 1).find((line) => !line.startsWith("#"));
    if (candidate) return cleanInlineMarkdown(candidate).slice(0, 600);
  }
  const candidate = lines.find((line) => !line.startsWith("#") && !/^(?:来源|作者|发布日期|原文链接|source|author|published)/i.test(line));
  return candidate ? cleanInlineMarkdown(candidate).slice(0, 600) : null;
}

function highlightsFrom(markdown) {
  const lines = meaningfulLines(markdown);
  const headings = lines
    .filter((line) => /^#{3,6}\s+/.test(line))
    .map(cleanInlineMarkdown)
    .filter(Boolean);
  if (headings.length) return [...new Set(headings)].slice(0, 5);
  return [...new Set(lines
    .filter((line) => /^(?:[-*+]\s+|\d+[.)]\s+)/.test(line))
    .map(cleanInlineMarkdown)
    .filter(Boolean))].slice(0, 5);
}

function warningsFrom(markdown) {
  const lines = meaningfulLines(markdown);
  const warnings = lines
    .filter((line) => /未(?:独立)?核验|尚未核验|风险|注意|warning|remaining risk|unverified/i.test(line))
    .filter((line) => !/^#{1,6}\s*(?:风险|注意|warning|remaining risk)/i.test(line))
    .map(cleanInlineMarkdown)
    .filter(Boolean);
  return [...new Set(warnings)].slice(0, 4);
}

function linkedFilesFrom(markdown) {
  const files = [];
  const pattern = /\[[^\]]*\]\(([^\)]+)\)/g;
  for (const match of String(markdown ?? "").matchAll(pattern)) {
    const target = match[1].trim();
    if (!target || /^(?:https?:|mailto:|#)/i.test(target)) continue;
    files.push(target.replaceAll("\\", "/"));
  }
  return files;
}

export function projectWorkItemOutcome({
  item,
  latestRun,
  deliveryReport,
  invocationSummary = null,
} = {}) {
  const fullReport = latestRun?.report ?? deliveryReport?.summary ?? null;
  if (!fullReport) {
    return {
      status: latestRun && ["done", "pr_open", "report_posted"].includes(latestRun.status) ? "missing" : "pending",
      summary: null,
      fullReport: null,
      highlights: [],
      warnings: [],
      files: [],
      verification: null,
      deliveredAt: null,
    };
  }

  const fileCandidates = [
    ...(item?.outputAssets ?? []).map((asset) => asset?.path),
    ...(deliveryReport?.changedFiles ?? []),
    ...linkedFilesFrom(fullReport),
    ...linkedFilesFrom(invocationSummary),
  ].filter(Boolean).map((path) => String(path).replaceAll("\\", "/"));

  return {
    status: "available",
    summary: headlineFrom(fullReport),
    fullReport,
    highlights: highlightsFrom(fullReport),
    warnings: warningsFrom(fullReport),
    files: [...new Set(fileCandidates)].slice(0, 50),
    verification: deliveryReport?.verification ? { ...deliveryReport.verification } : null,
    deliveredAt: deliveryReport?.completedAt ?? latestRun?.updatedAt ?? null,
  };
}
