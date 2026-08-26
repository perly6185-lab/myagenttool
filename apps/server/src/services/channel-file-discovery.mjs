/*
 * Read-only discovery for user-provided CSV/Excel files.
 *
 * This is deliberately a discovery boundary, not an execution path: it
 * returns schema-level facts (columns, row count, likely keys) and never
 * returns row values or writes a source file. The task layer can use the
 * result to explain what it found before a business operation is selected.
 */

import { createHash } from "node:crypto";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import ExcelJS from "exceljs";

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ROWS = 5_000;
const MAX_COLUMNS = 100;
const SUPPORTED_EXTENSIONS = new Set([".csv", ".xlsx", ".xls", ".json"]);

const FIELD_ALIASES = new Map([
  ["order_number", ["订单号", "订单编号", "order_number", "orderno", "ordernumber"]],
  ["quotation_number", ["报价单号", "报价编号", "quotation_number", "quotationno"]],
  ["case_number", ["售后单号", "服务单号", "工单号", "case_number", "caseno"]],
  ["return_number", ["退货单号", "退货编号", "return_number", "returnno"]],
  ["shipment_number", ["物流单号", "发货单号", "shipment_number", "shipmentno"]],
  ["customer", ["客户", "客户名称", "买家", "customer"]],
  ["name", ["姓名", "联系人", "名称", "name"]],
  ["status", ["状态", "订单状态", "跟进状态", "售后状态", "status"]],
  ["delivery_status", ["发货状态", "物流状态", "delivery_status"]],
  ["payment_status", ["回款状态", "收款状态", "payment_status"]],
  ["amount", ["金额", "报价金额", "收款金额", "付款金额", "amount"]],
  ["date", ["日期", "交易日期", "付款日期", "收款日期", "date"]],
  ["email", ["邮箱", "邮件", "email"]],
  ["phone", ["电话", "手机号", "手机", "phone", "mobile"]],
]);

const KEY_FIELDS = new Set([
  "order_number", "quotation_number", "case_number", "return_number",
  "shipment_number", "email", "phone", "name",
]);

function clean(value, max = 200) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function headerKey(value) {
  return clean(value, 120).normalize("NFKC").replace(/[\s_-]+/g, "").toLocaleLowerCase();
}

function canonicalField(header) {
  const key = headerKey(header);
  for (const [field, aliases] of FIELD_ALIASES) {
    if (aliases.some((alias) => headerKey(alias) === key)) return field;
  }
  return null;
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
      row.push(cell); cell = "";
      if (row.some((item) => clean(item))) rows.push(row);
      row = [];
      continue;
    }
    cell += character;
  }
  if (cell || row.length) { row.push(cell); if (row.some((item) => clean(item))) rows.push(row); }
  return rows;
}

function rowsToHeaders(rows) {
  const headers = Array.isArray(rows?.[0]) ? rows[0] : [];
  return headers.map((header, index) => clean(header, 160) || `第${index + 1}列`).slice(0, MAX_COLUMNS);
}

function discoveryFromHeaders({ headers, rowCount, format, fileName, size, contentHash, assetId }) {
  const columns = headers.map((name, index) => ({
    name,
    index: index + 1,
    field: canonicalField(name),
  }));
  const fields = [...new Set(columns.map((column) => column.field).filter(Boolean))];
  const keyCandidates = columns
    .filter((column) => column.field && KEY_FIELDS.has(column.field))
    .map((column) => ({ name: column.name, field: column.field }));
  const kinds = new Set();
  if (fields.includes("order_number")) kinds.add("订单");
  if (fields.includes("quotation_number")) kinds.add("报价");
  if (fields.includes("case_number")) kinds.add("售后");
  if (fields.includes("shipment_number")) kinds.add("发货");
  if (fields.includes("payment_status") || (fields.includes("amount") && fields.includes("date"))) kinds.add("收款/流水");
  if (fields.includes("customer") || fields.includes("email") || fields.includes("phone")) kinds.add("联系人/客户");
  return {
    status: "ready",
    schemaVersion: 1,
    assetId: clean(assetId, 200) || null,
    fileName: clean(fileName, 300) || "本地文件",
    format,
    size,
    contentHash,
    rowCount,
    columnCount: columns.length,
    columns,
    recognizedFields: fields,
    keyCandidates,
    likelyKinds: [...kinds],
    readOnly: true,
    nextActions: keyCandidates.length
      ? ["可以按记录编号查询或整理", "如需修改，请说明记录编号、字段和新值，系统会先生成预览"]
      : ["可以先查看文件结构", "如需修改，请先说明如何定位记录，系统不会猜测修改对象"],
  };
}

function safeAssetPath({ asset, projectPath } = {}) {
  if (!asset?.path || !projectPath || !asset.projectId) return { error: "file_discovery_binding_required" };
  const root = resolve(projectPath);
  const candidate = resolve(root, String(asset.path));
  const rel = relative(root, candidate);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || rel.includes(`..${sep}`)) {
    return { error: "file_discovery_path_refused" };
  }
  return { root, candidate, relativePath: rel.split(sep).join("/") };
}

export async function discoverChannelFileAsset({ asset, projectPath, projectId = null } = {}) {
  if (projectId && asset?.projectId !== projectId) return { status: "forbidden", reason: "file_discovery_project_scope_mismatch" };
  const scoped = safeAssetPath({ asset, projectPath });
  if (scoped.error) return { status: "forbidden", reason: scoped.error };
  const extension = extname(scoped.candidate).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) return { status: "unsupported", reason: "file_discovery_format_unsupported" };
  try {
    const fileStat = await stat(scoped.candidate);
    const linkStat = await lstat(scoped.candidate);
    if (!fileStat.isFile() || linkStat.isSymbolicLink() || fileStat.size > MAX_BYTES) {
      return { status: "unavailable", reason: "file_discovery_file_invalid" };
    }
    const resolved = await realpath(scoped.candidate);
    const resolvedRoot = await realpath(scoped.root);
    const resolvedRel = relative(resolvedRoot, resolved);
    if (!resolvedRel || resolvedRel === ".." || resolvedRel.startsWith(`..${sep}`)) {
      return { status: "forbidden", reason: "file_discovery_path_refused" };
    }
    const bytes = await readFile(resolved);
    const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (asset.hash && String(asset.hash) !== contentHash) {
      return { status: "stale", reason: "file_discovery_source_changed", contentHash };
    }
    if (extension === ".xls") {
      return {
        status: "unsupported",
        reason: "file_discovery_legacy_xls_unsupported",
        assetId: clean(asset.id, 200) || null,
        fileName: clean(asset.originalName ?? asset.name ?? scoped.relativePath.split("/").at(-1), 300) || "旧版 Excel 文件",
        format: "xls",
        size: fileStat.size,
        contentHash,
        readOnly: true,
        nextActions: ["请在 Excel 或 WPS 中另存为 .xlsx 或 CSV 后重新发送"],
      };
    }
    let headers = [];
    let rowCount = 0;
    let format = extension.slice(1);
    if (extension === ".csv") {
      const rows = csvRows(bytes.toString("utf8"));
      headers = rowsToHeaders(rows);
      rowCount = Math.max(0, rows.length - 1);
    } else if (extension === ".json") {
      const parsed = JSON.parse(bytes.toString("utf8"));
      const rows = Array.isArray(parsed) ? parsed : parsed?.records;
      if (!Array.isArray(rows) || !rows.length || !rows[0] || typeof rows[0] !== "object") {
        return { status: "unavailable", reason: "file_discovery_json_shape_invalid" };
      }
      headers = Object.keys(rows[0]).slice(0, MAX_COLUMNS).map((header) => clean(header, 160));
      rowCount = rows.length;
      format = "json";
    } else {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(bytes);
      const worksheet = workbook.worksheets[0];
      if (!worksheet) return { status: "unavailable", reason: "file_discovery_sheet_missing" };
      worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell, column) => {
        headers[column - 1] = clean(cell.text, 160) || `第${column}列`;
      });
      rowCount = Math.max(0, worksheet.rowCount - 1);
      format = "xlsx";
    }
    if (!headers.length || rowCount > MAX_ROWS) return { status: "unavailable", reason: "file_discovery_shape_invalid" };
    return discoveryFromHeaders({
      headers,
      rowCount,
      format,
      fileName: asset.originalName ?? asset.name ?? scoped.relativePath.split("/").at(-1),
      size: fileStat.size,
      contentHash,
      assetId: asset.id,
    });
  } catch (error) {
    return { status: "unavailable", reason: error?.code === "ENOENT" ? "file_discovery_file_missing" : "file_discovery_read_failed" };
  }
}

export function fileDiscoveryReply(discoveries = []) {
  const rows = Array.isArray(discoveries) ? discoveries : [];
  const ready = rows.filter((row) => row?.status === "ready");
  const messages = ready.slice(0, 3).map((row) => {
    const fields = row.recognizedFields?.slice(0, 8).join("、") || "暂未识别业务字段";
    const kinds = row.likelyKinds?.length ? `，看起来像${row.likelyKinds.join("、")}资料` : "";
    const keys = row.keyCandidates?.length
      ? `可按${row.keyCandidates.map((key) => key.name).slice(0, 3).join("、")}定位记录`
      : "暂未找到明确的记录编号";
    return `已只读检查 ${row.fileName}：${row.rowCount} 条记录、${row.columnCount} 个字段${kinds}。识别到：${fields}；${keys}。`;
  });
  const legacyXls = rows.filter((row) => row?.reason === "file_discovery_legacy_xls_unsupported");
  for (const row of legacyXls.slice(0, 3)) {
    messages.push(`已收到 ${row.fileName ?? "旧版 Excel 文件"}，但它是旧版 .xls 格式，当前不能安全读取。请在 Excel 或 WPS 中另存为 .xlsx 或 CSV 后重新发送；原文件不会被修改。`);
  }
  return messages.length ? messages.join("\n") : null;
}
