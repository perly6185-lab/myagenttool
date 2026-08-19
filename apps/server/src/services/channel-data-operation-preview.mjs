/*
 * Controlled, read-only operation preview for channel attachment data plans.
 *
 * This is not a general-purpose script runner. It accepts only an already
 * bound attachment plan, re-checks source hashes, reads bounded rows through
 * the project boundary, and never writes the source file.
 */

import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import ExcelJS from "exceljs";

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ROWS = 5_000;
const MAX_COLUMNS = 100;
const MAX_RESULT_ROWS = 20;
const MAX_RESULT_COLUMNS = 20;
const MAX_CELL_CHARS = 240;
const MAX_RESULT_BYTES = 24_000;
const MAX_EXPORT_BYTES = 8 * 1024 * 1024;
const SECRET_FIELD_RE = /password|secret|token|credential|身份证|银行卡|账号密码/i;
const MUTATION_RE = /修改|更改|更新|写入|覆盖|删除|新增|导入|保存|改成|替换/;
const OPERATION_RE = {
  count: /多少|数量|总数|统计|几条|合计/,
  organize: /整理|排序|归类|分组|汇总|按.+排/,
  query: /查询|查找|找出|筛选|列出|显示|看看|有哪些|哪几个/,
};

function clean(value, max = 300) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function key(value) {
  return clean(value, 300).normalize("NFKC").toLocaleLowerCase();
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function csvRows(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (quoted && character === '"' && next === '"') { cell += '"'; index += 1; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (!quoted && character === ",") { row.push(cell); cell = ""; continue; }
    if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((item) => clean(item))) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += character;
  }
  if (cell || row.length) {
    row.push(cell);
    if (row.some((item) => clean(item))) rows.push(row);
  }
  return rows;
}

function normalizeRows(rows) {
  const headers = (Array.isArray(rows?.[0]) ? rows[0] : [])
    .map((value, index) => clean(value, 160) || ("第" + (index + 1) + "列"))
    .slice(0, MAX_COLUMNS);
  const records = (Array.isArray(rows) ? rows.slice(1) : [])
    .slice(0, MAX_ROWS)
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, clean(values?.[index], MAX_CELL_CHARS)])));
  return { headers, records };
}

function normalizeObjectRows(rows) {
  const first = Array.isArray(rows) ? rows[0] : null;
  const headers = first && typeof first === "object" && !Array.isArray(first)
    ? Object.keys(first).slice(0, MAX_COLUMNS).map((header, index) => clean(header, 160) || ("第" + (index + 1) + "列"))
    : [];
  const records = (Array.isArray(rows) ? rows : [])
    .slice(0, MAX_ROWS)
    .filter((row) => row && typeof row === "object" && !Array.isArray(row))
    .map((row) => Object.fromEntries(headers.map((header) => [header, clean(row[header], MAX_CELL_CHARS)])));
  return { headers, records };
}

async function readBoundedSource({ asset, source, projectPath } = {}) {
  if (!asset?.path || !asset?.id || !projectPath) return { ok: false, reason: "channel_data_source_binding_required" };
  if (String(asset.id) !== String(source?.sourceId)) return { ok: false, reason: "channel_data_source_mismatch" };
  const root = resolve(projectPath);
  const candidate = resolve(root, String(asset.path));
  const relativePath = relative(root, candidate);
  if (!relativePath || relativePath === ".." || relativePath.startsWith(".." + sep)) {
    return { ok: false, reason: "channel_data_source_path_refused" };
  }
  try {
    const fileStat = await stat(candidate);
    const linkStat = await lstat(candidate);
    if (!fileStat.isFile() || linkStat.isSymbolicLink() || fileStat.size > MAX_BYTES) {
      return { ok: false, reason: "channel_data_source_file_invalid" };
    }
    const resolved = await realpath(candidate);
    const resolvedRoot = await realpath(root);
    const resolvedRelative = relative(resolvedRoot, resolved);
    if (!resolvedRelative || resolvedRelative === ".." || resolvedRelative.startsWith(".." + sep)) {
      return { ok: false, reason: "channel_data_source_path_refused" };
    }
    const bytes = await readFile(resolved);
    const contentHash = "sha256:" + createHash("sha256").update(bytes).digest("hex");
    if (!source?.fingerprint || contentHash !== source.fingerprint || asset.hash !== contentHash) {
      return { ok: false, reason: "channel_data_source_changed", contentHash };
    }
    const extension = extname(candidate).toLowerCase();
    if (extension === ".csv") return { ok: true, ...normalizeRows(csvRows(bytes.toString("utf8"))), contentHash };
    if (extension === ".json") {
      const parsed = JSON.parse(bytes.toString("utf8"));
      const rows = Array.isArray(parsed) ? parsed : parsed?.records;
      return { ok: true, ...normalizeObjectRows(rows), contentHash };
    }
    if (extension === ".xlsx" || extension === ".xls") {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(bytes);
      const worksheet = workbook.worksheets[0];
      if (!worksheet) return { ok: false, reason: "channel_data_source_sheet_missing" };
      const rows = [];
      worksheet.eachRow((worksheetRow) => {
        const values = [];
        worksheetRow.eachCell({ includeEmpty: true }, (cell, column) => { values[column - 1] = cell.text; });
        if (values.some((value) => clean(value))) rows.push(values);
      });
      return { ok: true, ...normalizeRows(rows), contentHash };
    }
    return { ok: false, reason: "channel_data_source_format_unsupported" };
  } catch (error) {
    return { ok: false, reason: error?.code === "ENOENT" ? "channel_data_source_missing" : "channel_data_source_read_failed" };
  }
}

function operationFor(text) {
  if (OPERATION_RE.count.test(text)) return "count";
  if (OPERATION_RE.organize.test(text)) return "organize";
  if (OPERATION_RE.query.test(text)) return "query";
  return "inspect";
}

function requestedTokens(text) {
  const quoted = [...String(text ?? "").matchAll(/[“「『"]([^”」』"]{1,120})[”」』"]/g)].map((match) => key(match[1]));
  const latin = String(text ?? "").match(/[A-Za-z0-9][A-Za-z0-9_.-]{2,}/g) ?? [];
  return [...new Set([...quoted, ...latin.map(key)].filter(Boolean))].slice(0, 20);
}

function rowMatches(row, text) {
  const tokens = requestedTokens(text);
  if (!tokens.length) return true;
  const values = Object.values(row).map(key).filter(Boolean);
  return tokens.some((token) => values.some((value) => value === token || value.includes(token)));
}

function selectedHeaders(headers, text) {
  const requested = headers.filter((header) => String(text ?? "").includes(header));
  const safe = requested.filter((header) => !SECRET_FIELD_RE.test(header));
  return (safe.length ? safe : headers).slice(0, MAX_RESULT_COLUMNS);
}

function safeCell(header, value) {
  if (SECRET_FIELD_RE.test(header)) return "[已隐藏敏感字段]";
  return clean(value, MAX_CELL_CHARS);
}

function csvCell(value) {
  const text = clean(value, MAX_CELL_CHARS);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function safeOutputName(value) {
  const candidate = String(value ?? "").replaceAll("\\", "/").replace(/^\/+/, "");
  if (!candidate || candidate.split("/").some((part) => !part || part === "." || part === "..")) return null;
  if (!candidate.startsWith("channel-results/") || candidate.split("/").length !== 2 || candidate.length > 240) return null;
  return candidate;
}

function resultSummary({ operation, sources, matchedRows, totalRows } = {}) {
  const sourceText = sources.map((source) => source.fileName).join("、") || "附件";
  if (operation === "count") return "已查询 " + sourceText + "：共 " + matchedRows + " 条匹配记录（文件共 " + totalRows + " 条）。";
  if (operation === "organize") return "已整理 " + sourceText + "：共 " + matchedRows + " 条匹配记录，先展示前 " + Math.min(matchedRows, MAX_RESULT_ROWS) + " 条预览。";
  return "已查询 " + sourceText + "：找到 " + matchedRows + " 条匹配记录，先展示前 " + Math.min(matchedRows, MAX_RESULT_ROWS) + " 条预览。";
}

export async function buildChannelDataOperationPreview({
  text = "",
  plan,
  attachments = [],
  projectPath,
} = {}) {
  const value = clean(text, 4_000);
  if (!plan || plan.origin !== "channel_attachment") return null;
  if (MUTATION_RE.test(value)) {
    return { schemaVersion: 1, status: "blocked", reason: "channel_data_operation_mutation_not_allowed", readOnly: true };
  }
  if (plan.status !== "ready") {
    return { schemaVersion: 1, status: "needs_sources", reason: "channel_data_operation_plan_not_ready", readOnly: true };
  }
  const assetsById = new Map((Array.isArray(attachments) ? attachments : [])
    .filter((asset) => asset?.id)
    .map((asset) => [String(asset.id), asset]));
  const operation = operationFor(value);
  const sourceResults = [];
  const resultRows = [];
  const resultColumns = [];
  let matchedRows = 0;
  let totalRows = 0;
  for (const source of (plan.sources ?? []).slice(0, 10)) {
    const loaded = await readBoundedSource({
      asset: assetsById.get(String(source.sourceId)),
      source,
      projectPath,
    });
    if (!loaded.ok) {
      return {
        schemaVersion: 1,
        status: "stale",
        reason: loaded.reason,
        readOnly: true,
        sourceId: source.sourceId,
        contentHash: loaded.contentHash ?? null,
      };
    }
    const headers = selectedHeaders(loaded.headers, value);
    const matches = loaded.records.filter((row) => rowMatches(row, value));
    totalRows += loaded.records.length;
    matchedRows += matches.length;
    for (const header of headers) if (!resultColumns.includes(header)) resultColumns.push(header);
    if (operation !== "count") {
      for (const row of matches.slice(0, MAX_RESULT_ROWS - resultRows.length)) {
        resultRows.push(Object.fromEntries(headers.map((header) => [header, safeCell(header, row[header])])));
        if (resultRows.length >= MAX_RESULT_ROWS) break;
      }
    }
    sourceResults.push({
      sourceId: source.sourceId,
      fileName: source.fileName,
      contentHash: loaded.contentHash,
      rowCount: loaded.records.length,
      matchedRows: matches.length,
    });
    if (resultRows.length >= MAX_RESULT_ROWS) break;
  }
  const preview = {
    schemaVersion: 1,
    status: "ready",
    operation,
    readOnly: true,
    sources: sourceResults,
    columns: resultColumns.slice(0, MAX_RESULT_COLUMNS),
    totalRows,
    matchedRows,
    sampleRows: resultRows.slice(0, MAX_RESULT_ROWS),
    summary: resultSummary({ operation, sources: sourceResults, matchedRows, totalRows }),
  };
  const serialized = JSON.stringify(preview);
  if (Buffer.byteLength(serialized, "utf8") > MAX_RESULT_BYTES) {
    preview.sampleRows = preview.sampleRows.slice(0, 5);
    preview.truncated = true;
  }
  return { ...preview, digest: digest(preview) };
}

/**
 * Re-read the bound source(s) and materialize a new, bounded CSV result.
 * This is intentionally separate from the preview builder: generating a file
 * is a user-authorized write, while the source remains read-only and is
 * verified again immediately before the write.
 */
export async function exportChannelDataOperationPreview({
  text = "",
  plan,
  attachments = [],
  projectPath,
  outputName,
} = {}) {
  const value = clean(text, 4_000);
  if (!plan || plan.origin !== "channel_attachment") return { ok: false, status: "needs_sources", reason: "channel_data_plan_required" };
  if (MUTATION_RE.test(value)) return { ok: false, status: "blocked", reason: "channel_data_operation_mutation_not_allowed" };
  if (plan.status !== "ready") return { ok: false, status: "needs_sources", reason: "channel_data_operation_plan_not_ready" };
  const relativeOutput = safeOutputName(outputName);
  if (!relativeOutput) return { ok: false, status: "blocked", reason: "channel_data_output_path_refused" };
  const assetsById = new Map((Array.isArray(attachments) ? attachments : [])
    .filter((asset) => asset?.id)
    .map((asset) => [String(asset.id), asset]));
  const operation = operationFor(value);
  const sourceResults = [];
  const rows = [];
  const columns = [];
  let totalRows = 0;
  let matchedRows = 0;
  for (const source of (plan.sources ?? []).slice(0, 10)) {
    const loaded = await readBoundedSource({
      asset: assetsById.get(String(source.sourceId)),
      source,
      projectPath,
    });
    if (!loaded.ok) return { ok: false, status: "stale", reason: loaded.reason, contentHash: loaded.contentHash ?? null };
    const headers = selectedHeaders(loaded.headers, value);
    const matches = loaded.records.filter((row) => rowMatches(row, value));
    totalRows += loaded.records.length;
    matchedRows += matches.length;
    for (const header of headers) if (!columns.includes(header)) columns.push(header);
    if (operation !== "count") {
      for (const row of matches) {
        rows.push({ source: source.fileName, values: Object.fromEntries(headers.map((header) => [header, safeCell(header, row[header])])) });
        if (rows.length >= MAX_ROWS) break;
      }
    }
    sourceResults.push({
      sourceId: source.sourceId,
      fileName: source.fileName,
      contentHash: loaded.contentHash,
      rowCount: loaded.records.length,
      matchedRows: matches.length,
    });
    if (rows.length >= MAX_ROWS) break;
  }
  const outputColumns = columns.slice(0, MAX_RESULT_COLUMNS);
  const includeSource = sourceResults.length > 1;
  const headerLine = [includeSource ? "来源文件" : null, ...outputColumns].filter(Boolean).map(csvCell).join(",");
  const body = operation === "count"
    ? `${headerLine}\n${["统计结果", ...outputColumns.slice(1).map(() => "")].map(csvCell).join(",")}\n`
    : `${headerLine}\n${rows.map((row) => [includeSource ? row.source : null, ...outputColumns.map((header) => row.values[header] ?? "")].filter((value) => value !== null).map(csvCell).join(",")).join("\n")}\n`;
  const bytes = Buffer.from(body, "utf8");
  if (bytes.length > MAX_EXPORT_BYTES) return { ok: false, status: "blocked", reason: "channel_data_output_too_large" };
  const root = resolve(projectPath);
  const candidate = resolve(root, relativeOutput);
  const confined = relative(root, candidate);
  if (!confined || confined === ".." || confined.startsWith(".." + sep)) return { ok: false, status: "blocked", reason: "channel_data_output_path_refused" };
  try {
    const outputDirectory = resolve(root, "channel-results");
    await mkdir(outputDirectory, { recursive: true });
    const directoryStat = await lstat(outputDirectory);
    const resolvedDirectory = await realpath(outputDirectory);
    const directoryRelative = relative(await realpath(root), resolvedDirectory);
    if (directoryStat.isSymbolicLink() || !directoryRelative || directoryRelative === ".." || directoryRelative.startsWith(".." + sep)) {
      return { ok: false, status: "blocked", reason: "channel_data_output_path_refused" };
    }
    await writeFile(candidate, bytes, { flag: "wx" });
  } catch (error) {
    return { ok: false, status: error?.code === "EEXIST" ? "conflict" : "failed", reason: error?.code === "EEXIST" ? "channel_data_output_exists" : "channel_data_output_write_failed" };
  }
  const contentHash = "sha256:" + createHash("sha256").update(bytes).digest("hex");
  return {
    ok: true,
    status: "ready",
    operation,
    relativePath: relativeOutput,
    fileName: relativeOutput.split("/").at(-1),
    size: bytes.length,
    hash: contentHash,
    sources: sourceResults,
    columns: outputColumns,
    totalRows,
    matchedRows,
    exportedRows: rows.length,
  };
}

export function channelDataOperationReply(preview) {
  if (!preview) return null;
  if (preview.status === "stale") return "文件在处理前发生变化，我没有继续读取。请重新上传文件后再试。";
  if (preview.status === "blocked") return "这条请求涉及修改文件，当前只读预览不会写入原文件；请先说明记录范围和修改字段。";
  if (preview.status !== "ready") return "数据来源还没有准备好，请重新上传文件后再试。";
  const rows = preview.operation === "count"
    ? ""
    : preview.sampleRows?.length
      ? "\n预览 " + preview.columns.join("、") + "：\n"
        + preview.sampleRows.slice(0, 5).map((row) => Object.values(row).join(" | ")).join("\n")
      : "\n没有匹配记录。";
  return preview.summary + rows + "\n如需下载整理结果，回复“确认导出”；原文件不会修改。";
}

export function normalizeChannelDataOperationPreview(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const status = ["ready", "stale", "blocked", "needs_sources"].includes(input.status)
    ? input.status : "needs_sources";
  const sources = Array.isArray(input.sources)
    ? input.sources.slice(0, 10).map((source) => ({
      sourceId: clean(source?.sourceId, 200) || null,
      fileName: clean(source?.fileName, 300) || "本地文件",
      contentHash: clean(source?.contentHash, 80) || null,
      rowCount: Number.isInteger(Number(source?.rowCount)) ? Math.max(0, Math.min(MAX_ROWS, Number(source.rowCount))) : null,
      matchedRows: Number.isInteger(Number(source?.matchedRows)) ? Math.max(0, Math.min(MAX_ROWS, Number(source.matchedRows))) : null,
    })).filter((source) => source.sourceId)
    : [];
  const columns = Array.isArray(input.columns)
    ? input.columns.slice(0, MAX_RESULT_COLUMNS).map((column) => clean(column, 160)).filter(Boolean)
    : [];
  const sampleRows = Array.isArray(input.sampleRows)
    ? input.sampleRows.slice(0, MAX_RESULT_ROWS).map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) return {};
      return Object.fromEntries(Object.entries(row).slice(0, MAX_RESULT_COLUMNS).map(([header, value]) => [
        clean(header, 160),
        safeCell(header, value),
      ]).filter(([header]) => header));
    })
    : [];
  return {
    schemaVersion: 1,
    status,
    operation: ["count", "query", "organize", "inspect"].includes(input.operation) ? input.operation : "inspect",
    readOnly: true,
    sources,
    columns,
    totalRows: Number.isInteger(Number(input.totalRows)) ? Math.max(0, Math.min(MAX_ROWS * 10, Number(input.totalRows))) : 0,
    matchedRows: Number.isInteger(Number(input.matchedRows)) ? Math.max(0, Math.min(MAX_ROWS * 10, Number(input.matchedRows))) : 0,
    sampleRows,
    summary: clean(input.summary, 1_000) || null,
    reason: clean(input.reason, 120) || null,
    truncated: input.truncated === true,
    digest: clean(input.digest, 128) || null,
  };
}
