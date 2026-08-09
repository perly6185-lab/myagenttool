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

const BROWSABLE_DOCUMENT_EXTENSIONS = new Set([
  ".docx", ".xlsx", ".pptx", ".pdf", ".dxf", ".dwg",
  ".md", ".mdx", ".html", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg",
  ".mp3", ".m4a", ".ogg", ".wav", ".mp4", ".webm", ".mov", ".canvas", ".excalidraw",
]);

function normalizedFilePath(value) {
  return String(value ?? "").trim().replaceAll("\\", "/").replace(/\/+$/, "");
}

function portableAbsolutePath(value) {
  return value.startsWith("/") || /^[a-z]:\//i.test(value);
}

function safeRelativePath(value) {
  const normalized = normalizedFilePath(value).replace(/^\.\//, "");
  if (!normalized || portableAbsolutePath(normalized)) return null;
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) return null;
  return normalized;
}

function relativePathInsideRoot(candidate, root) {
  const normalizedCandidate = normalizedFilePath(candidate);
  const normalizedRoot = normalizedFilePath(root);
  if (!normalizedCandidate || !normalizedRoot) return null;
  const windowsPath = /^[a-z]:\//i.test(normalizedCandidate) || /^[a-z]:\//i.test(normalizedRoot);
  const comparableCandidate = windowsPath ? normalizedCandidate.toLowerCase() : normalizedCandidate;
  const comparableRoot = windowsPath ? normalizedRoot.toLowerCase() : normalizedRoot;
  if (!comparableCandidate.startsWith(`${comparableRoot}/`)) return null;
  return safeRelativePath(normalizedCandidate.slice(normalizedRoot.length + 1));
}

function fileName(path) {
  return normalizedFilePath(path).split("/").filter(Boolean).at(-1) ?? "File";
}

function fileExtension(path) {
  const name = fileName(path).toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot) : "";
}

function projectFileEntries({ item, deliveryReport, fullReport, invocationSummary, fileContext }) {
  const defaultWorktreeId = fileContext?.worktreeId ?? null;
  const candidates = [
    ...(item?.outputAssets ?? []).map((asset) => ({
      path: asset?.path,
      worktreeId: asset?.worktreeId ?? defaultWorktreeId,
    })),
    ...(deliveryReport?.changedFiles ?? []).map((path) => ({ path, worktreeId: defaultWorktreeId })),
    ...linkedFilesFrom(fullReport).map((path) => ({ path, worktreeId: defaultWorktreeId })),
    ...linkedFilesFrom(invocationSummary).map((path) => ({ path, worktreeId: defaultWorktreeId })),
  ].filter((candidate) => candidate.path);
  const scopes = (fileContext?.scopes ?? [])
    .filter((scope) => scope?.root)
    .sort((left, right) => normalizedFilePath(right.root).length - normalizedFilePath(left.root).length);
  const entries = [];
  const seen = new Set();

  for (const candidate of candidates) {
    const originalPath = normalizedFilePath(candidate.path);
    let path = safeRelativePath(originalPath);
    let worktreeId = candidate.worktreeId ?? defaultWorktreeId;
    let status = "available";
    let unavailableReason = null;

    if (portableAbsolutePath(originalPath)) {
      const matchingScope = scopes.find((scope) => relativePathInsideRoot(originalPath, scope.root));
      path = matchingScope ? relativePathInsideRoot(originalPath, matchingScope.root) : null;
      worktreeId = matchingScope?.worktreeId ?? null;
      if (!path) {
        status = "unavailable";
        unavailableReason = "outside_registered_project";
      }
    } else if (!path) {
      status = "unavailable";
      unavailableReason = "invalid_relative_path";
    }

    const name = fileName(originalPath);
    const key = `${fileContext?.projectId ?? ""}:${worktreeId ?? "base"}:${path ?? name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const browsable = status === "available" && BROWSABLE_DOCUMENT_EXTENSIONS.has(fileExtension(path ?? name));
    entries.push({
      name,
      path,
      projectId: fileContext?.projectId ?? null,
      worktreeId,
      status,
      preview: browsable ? "document" : "unsupported",
      ...(unavailableReason ? { unavailableReason } : {}),
    });
    if (entries.length >= 50) break;
  }
  return entries;
}

export function projectWorkItemOutcome({
  item,
  latestRun,
  deliveryReport,
  invocationSummary = null,
  fileContext = null,
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
      fileEntries: [],
      verification: null,
      deliveredAt: null,
    };
  }

  const fileEntries = projectFileEntries({ item, deliveryReport, fullReport, invocationSummary, fileContext });

  return {
    status: "available",
    summary: headlineFrom(fullReport),
    fullReport,
    highlights: highlightsFrom(fullReport),
    warnings: warningsFrom(fullReport),
    // Keep the legacy string list for older web clients, but never expose an
    // absolute host path. New clients use fileEntries for scoped browsing.
    files: fileEntries.map((entry) => entry.path ?? entry.name),
    fileEntries,
    verification: deliveryReport?.verification ? { ...deliveryReport.verification } : null,
    deliveredAt: deliveryReport?.completedAt ?? latestRun?.updatedAt ?? null,
  };
}
