/*
 * Small, deterministic Channel reads that do not need an Agent turn.
 *
 * The operation remains a normal Work Item (the composer records completion
 * and verification), but the execution is delegated to the existing confined
 * project-tree reader.  This keeps the common "show me a few files" journey
 * fast, cheap and auditable without broadening the readable filesystem scope.
 */

const MAX_RESULT_FILES = 20;
const DEFAULT_RESULT_FILES = 10;

function requestedFileCount(text) {
  const value = String(text ?? "");
  const numeric = value.match(/(?:列出|列举|显示|找出|看看|查看)?\s*(\d{1,3})\s*个?\s*(?:文件|文档)/i)?.[1];
  if (numeric) return Math.min(MAX_RESULT_FILES, Math.max(1, Number(numeric)));
  const chinese = value.match(/(?:列出|列举|显示|找出|看看|查看)?\s*([一二三四五六七八九十两]+)\s*个?\s*(?:文件|文档)/i)?.[1];
  if (!chinese) return DEFAULT_RESULT_FILES;
  const digits = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  let parsed = 0;
  if (chinese === "十") parsed = 10;
  else if (chinese.startsWith("十")) parsed = 10 + (digits[chinese[1]] ?? 0);
  else if (chinese.endsWith("十")) parsed = (digits[chinese[0]] ?? 1) * 10;
  else parsed = digits[chinese] ?? 0;
  return Math.min(MAX_RESULT_FILES, Math.max(1, parsed || DEFAULT_RESULT_FILES));
}

function sensitiveFileName(name) {
  const value = String(name ?? "").toLowerCase();
  if (value === ".env") return true;
  if (value.startsWith(".env.") && !/^\.env\.(?:example|sample|template)$/.test(value)) return true;
  return [".npmrc", ".git-credentials", ".netrc"].includes(value)
    || /(?:^|\.)(?:pem|key|p12|pfx)$/.test(value)
    || /^id_(?:rsa|dsa|ed25519|ecdsa)(?:\.pub)?$/.test(value);
}

export function canExecuteChannelReadonlyLocalOperation({ text, operationIntent } = {}) {
  if (operationIntent?.accessMode !== "read_only"
    || operationIntent.explicitReadOnly !== true
    || Number(operationIntent.confidence) < 0.85
    || operationIntent.resource !== "current_project"
    || !["list_directory", "list_files"].includes(operationIntent.action)) return false;
  return /(?:文件|文档)/i.test(String(text ?? ""));
}

export function executeChannelReadonlyLocalOperation({ text, operationIntent, project, readProjectTree, completedAt = null } = {}) {
  if (!canExecuteChannelReadonlyLocalOperation({ text, operationIntent })) return null;
  if (!project?.id || !project?.path || typeof readProjectTree !== "function") return null;
  const tree = readProjectTree(project, { relativePath: "", search: "" });
  const requested = requestedFileCount(text);
  const entries = (tree?.entries ?? [])
    .filter((entry) => entry?.kind === "file")
    .filter((entry) => entry.gitStatus !== "ignored")
    .filter((entry) => !sensitiveFileName(entry.name))
    .slice(0, requested)
    .map((entry) => ({ name: String(entry.name), path: String(entry.path), gitStatus: entry.gitStatus ?? "unknown" }));
  const projectName = String(project.name ?? project.slug ?? "当前项目").replace(/\s+/g, " ").trim().slice(0, 80) || "当前项目";
  const listed = entries.length
    ? [`找到以下 ${entries.length} 个文件：`, ...entries.map((entry, index) => `${index + 1}. ${entry.path}`)].join("\n")
    : "当前项目根目录中没有找到可安全展示的文件。";
  return {
    schemaVersion: 1,
    kind: "project_file_list",
    connector: "local_project_tree",
    readOnly: true,
    projectId: project.id,
    requestedCount: requested,
    resultCount: entries.length,
    files: entries,
    summary: `已按只读方式查看“${projectName}”项目目录，没有修改任何文件。\n\n${listed}`,
    completedAt: completedAt ? String(completedAt) : null,
  };
}
