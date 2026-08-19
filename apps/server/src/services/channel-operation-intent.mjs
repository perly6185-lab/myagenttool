/*
 * One durable interpretation of what a Channel task may do.
 *
 * Natural language is still preserved as the task goal, but downstream risk,
 * mutation and execution layers consume this bounded contract instead of each
 * independently scanning the original sentence. Explicit prohibitions win
 * over matching write words ("不要修改文件" is read-only, not a mutation).
 */

const READ_ACTION_RE = /(?:只读(?:取)?|仅(?:查看|查询|读取|列出|检查)|读取|查看|查询|列出|列举|罗列|显示|查找|找出|检查|统计|分析)/i;
const LIST_ACTION_RE = /(?:列出|列举|罗列|显示|找出)/i;
const FILE_RE = /(?:\.csv\b|\.xlsx?\b|excel|文件|文档|表格|工作簿|sheet|数据表|清单)/i;
const DIRECTORY_RE = /(?:当前项目目录|项目目录|当前目录|文件夹|目录)/i;
const CREATE_OUTPUT_ACTION_RE = /(?:生成|创建|导出|保存|下载|写一份|制作)/gi;
const WRITE_ACTION_RE = /(?:修改|更新|删除|清空|新增|追加|覆盖|替换|回填|写入|写回|移动|重命名|改(?:一下|为|成)|调整|纠正|同步回)/gi;
const NEGATION_RE = /(?:不要|不需要|无需|禁止|不得|不允许|不能|别|勿|避免|不准|严禁|不会|不再|不做|不)[^，,。；;！!？?\n]{0,30}$/i;
const EXPLICIT_READ_ONLY_RE = /(?:只读(?:取)?|仅(?:查看|查询|读取|列出|检查)|只(?:查看|查询|读取|列出|检查)|(?:不要|不再|不做)[^，,。；;！!？?\n]{0,24}(?:修改|更新|删除|清空|新增|追加|覆盖|替换|回填|写入|写回|移动|重命名|改动)|不(?:修改|更新|删除|写入|改动)|不得[^，,。；;！!？?\n]{0,24}(?:修改|写入|删除)|禁止[^，,。；;！!？?\n]{0,24}(?:修改|写入|删除))/i;

const FORBIDDEN_WRITE_ACTIONS = ["create", "modify", "delete", "move", "rename", "write"];
const ACCESS_MODES = new Set(["read_only", "write", "unknown"]);
const ACTIONS = new Set(["list_directory", "list_files", "read_files", "query_data", "mutate_files", "create_output", "unknown"]);
const RESOURCES = new Set(["current_project", "directory", "tabular_files", "files", "unspecified"]);

function bounded(value, max = 300) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function actionEvidence(value, pattern) {
  const positive = [];
  const negated = [];
  for (const match of value.matchAll(pattern)) {
    const before = value.slice(0, match.index ?? 0);
    const clausePrefix = before.split(/[，,。；;！!？?\n]/).at(-1) ?? "";
    if (NEGATION_RE.test(clausePrefix)) negated.push(match[0]);
    else positive.push(match[0]);
  }
  return {
    positive: [...new Set(positive)].slice(0, 10),
    negated: [...new Set(negated)].slice(0, 10),
  };
}

export function analyzeChannelOperationIntent(input) {
  const value = bounded(input, 4_000);
  const writes = actionEvidence(value, WRITE_ACTION_RE);
  const outputs = actionEvidence(value, CREATE_OUTPUT_ACTION_RE);
  const reads = READ_ACTION_RE.test(value);
  const explicitReadOnly = EXPLICIT_READ_ONLY_RE.test(value);
  const createsOutput = outputs.positive.length > 0;
  const mutatesExistingData = writes.positive.length > 0;
  const accessMode = mutatesExistingData || createsOutput
    ? "write"
    : reads || explicitReadOnly || writes.negated.length > 0
      ? "read_only"
      : "unknown";
  const resource = /当前项目(?:目录)?/i.test(value)
    ? "current_project"
    : DIRECTORY_RE.test(value)
      ? "directory"
      : /(?:\.csv\b|\.xlsx?\b|excel|表格|工作簿|sheet|数据表|清单)/i.test(value)
        ? "tabular_files"
        : FILE_RE.test(value)
          ? "files"
          : "unspecified";
  const action = mutatesExistingData
    ? "mutate_files"
    : createsOutput
      ? "create_output"
      : LIST_ACTION_RE.test(value) && DIRECTORY_RE.test(value)
        ? "list_directory"
        : LIST_ACTION_RE.test(value) && FILE_RE.test(value)
          ? "list_files"
          : /(?:读取|查看|检查|只读)/i.test(value) && FILE_RE.test(value)
            ? "read_files"
            : reads
              ? "query_data"
              : "unknown";
  const confidence = accessMode === "read_only" && explicitReadOnly
    ? 0.99
    : accessMode !== "unknown"
      ? 0.9
      : 0.5;
  return {
    schemaVersion: 1,
    accessMode,
    action,
    resource,
    explicitReadOnly,
    mutatesExistingData,
    createsOutput,
    forbiddenActions: accessMode === "read_only" ? [...FORBIDDEN_WRITE_ACTIONS] : [],
    evidence: {
      read: reads,
      positiveWriteTerms: [...new Set([...writes.positive, ...outputs.positive])].slice(0, 10),
      negatedWriteTerms: [...new Set([...writes.negated, ...outputs.negated])].slice(0, 10),
    },
    confidence,
    source: "deterministic_semantics",
  };
}

export function normalizeChannelOperationIntent(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const accessMode = ACCESS_MODES.has(input.accessMode) ? input.accessMode : "unknown";
  const action = ACTIONS.has(input.action) ? input.action : "unknown";
  const resource = RESOURCES.has(input.resource) ? input.resource : "unspecified";
  const explicitReadOnly = accessMode === "read_only" && input.explicitReadOnly === true;
  return {
    schemaVersion: 1,
    accessMode,
    action,
    resource,
    explicitReadOnly,
    mutatesExistingData: accessMode === "write" && input.mutatesExistingData === true,
    createsOutput: accessMode === "write" && input.createsOutput === true,
    forbiddenActions: accessMode === "read_only" ? [...FORBIDDEN_WRITE_ACTIONS] : [],
    evidence: {
      read: input.evidence?.read === true,
      positiveWriteTerms: Array.isArray(input.evidence?.positiveWriteTerms)
        ? input.evidence.positiveWriteTerms.slice(0, 10).map((term) => bounded(term, 40)).filter(Boolean)
        : [],
      negatedWriteTerms: Array.isArray(input.evidence?.negatedWriteTerms)
        ? input.evidence.negatedWriteTerms.slice(0, 10).map((term) => bounded(term, 40)).filter(Boolean)
        : [],
    },
    confidence: Number.isFinite(Number(input.confidence))
      ? Math.max(0, Math.min(1, Number(input.confidence)))
      : 0.5,
    source: bounded(input.source, 40) || "deterministic_semantics",
  };
}
