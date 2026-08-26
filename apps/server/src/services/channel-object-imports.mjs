import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { makeRunTx } from "../runtime/store/run-tx.mjs";
import { LOCAL_TEAM_ID } from "../runtime/auth.mjs";
import { createLocalFileConnector } from "./channel-object-local-file-connector.mjs";

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ROWS = 1_000;
const PREVIEW_ROWS = 20;
const TTL_MS = 30 * 60 * 1000;
const KINDS = new Set(["contact", "order", "quotation", "shipment", "after_sales", "return", "account", "receivable", "bank_transaction", "publish_target"]);
const FIELDS = new Set([
  "name", "email", "phone", "company", "order_number", "quotation_number", "case_number", "return_number", "shipment_number", "receivable_number", "payment_number", "transaction_number", "customer", "issue", "resolution", "return_reason", "platform", "channel",
  "accountName", "accountNumber", "accountNumberLast4", "currency", "reference", "amount", "date", "transaction_date",
  "status", "delivery_status", "payment_status", "payment_date", "return_status", "return_amount", "paid_amount", "quantity",
]);

const HEADER_ALIASES = {
  label: ["label", "name", "title", "名称", "姓名", "称呼", "标题", "对象"],
  name: ["name", "姓名", "联系人", "contact", "名称"],
  email: ["email", "邮箱", "邮件", "电子邮箱"],
  phone: ["phone", "mobile", "电话", "手机号", "手机", "联系电话"],
  company: ["company", "公司", "单位", "客户公司"],
  order_number: ["order_number", "orderNo", "orderNumber", "订单号", "订单编号"],
  quotation_number: ["quotation_number", "quotationNo", "quotationNumber", "报价单号", "报价编号"],
  case_number: ["case_number", "caseNo", "caseNumber", "售后单号", "服务单号", "工单号"],
  return_number: ["return_number", "returnNo", "returnNumber", "退货单号", "退货编号"],
  shipment_number: ["shipment_number", "shipmentNo", "shipmentNumber", "物流单号", "发货单号"],
  receivable_number: ["receivable_number", "receivableNo", "receivableNumber", "应收单号", "应收编号", "收款单号", "回款单号"],
  payment_number: ["payment_number", "paymentNo", "paymentNumber", "付款单号", "付款编号"],
  transaction_number: ["transaction_number", "transactionNo", "transactionNumber", "流水号", "交易流水号", "银行流水号"],
  customer: ["customer", "客户", "客户名称", "买家"],
  issue: ["issue", "问题", "问题描述", "故障描述", "售后问题"],
  resolution: ["resolution", "处理结果", "解决方案", "售后结论"],
  return_reason: ["return_reason", "退货原因", "退货说明"],
  platform: ["platform", "平台", "发布平台"],
  channel: ["channel", "账号", "频道", "账号/频道", "发布账号"],
  accountName: ["accountName", "account_name", "账户名称", "账户名", "付款账户"],
  accountNumber: ["accountNumber", "account_number", "账号", "银行卡号", "账户号码"],
  accountNumberLast4: ["accountNumberLast4", "账号后四位", "账户后四位"],
  currency: ["currency", "币种", "货币"],
  reference: ["reference", "备注", "说明", "链接", "地址"],
  amount: ["amount", "金额", "报价金额", "收款金额", "付款金额"],
  date: ["date", "日期", "交易日期", "付款日期", "收款日期"],
  transaction_date: ["transaction_date", "交易日期", "流水日期"],
  status: ["status", "状态", "订单状态", "跟进状态", "售后状态"],
  delivery_status: ["delivery_status", "发货状态", "物流状态"],
  payment_status: ["payment_status", "回款状态", "收款状态"],
  payment_date: ["payment_date", "回款日期", "收款日期"],
  return_status: ["return_status", "退货状态"],
  return_amount: ["return_amount", "退货金额"],
  paid_amount: ["paid_amount", "已回款金额", "已收款金额"],
  quantity: ["quantity", "数量", "件数", "发货数量", "退货数量"],
};

function teamOf(actor) { return actor?.teamId ?? LOCAL_TEAM_ID; }

function clean(value, max = 300) {
  const result = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return result ? result.slice(0, max) : null;
}

function headerKey(value) {
  return clean(value, 80)?.normalize("NFKC").replace(/[\s_-]+/g, "").toLocaleLowerCase() ?? "";
}

function aliasToField(value, kind = null) {
  const normalized = headerKey(value);
  const matches = Object.entries(HEADER_ALIASES)
    .filter(([, aliases]) => aliases.some((alias) => headerKey(alias) === normalized))
    .map(([field]) => field);
  if (kind === "account" && matches.includes("accountNumber")) return "accountNumber";
  if (kind === "publish_target" && matches.includes("channel")) return "channel";
  if (kind === "shipment" && matches.includes("delivery_status")) return "delivery_status";
  if (kind === "receivable" && matches.includes("payment_status")) return "payment_status";
  if (kind === "receivable" && matches.includes("payment_date")) return "payment_date";
  if (kind === "return" && matches.includes("return_status")) return "return_status";
  if (kind === "return" && matches.includes("return_amount")) return "return_amount";
  if (kind === "return" && matches.includes("return_number")) return "return_number";
  if (kind === "receivable" && matches.includes("receivable_number")) return "receivable_number";
  if (kind === "receivable" && matches.includes("payment_number")) return "payment_number";
  if (kind === "bank_transaction" && matches.includes("transaction_number")) return "transaction_number";
  return matches[0] ?? null;
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

function objectRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  if (Array.isArray(rows[0])) {
    const headers = rows[0];
    return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]])));
  }
  return rows.filter((row) => row && typeof row === "object" && !Array.isArray(row));
}

function asImportedRow(raw, kind, rowNumber) {
  const mapped = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    const field = aliasToField(key, kind) ?? (FIELDS.has(key) ? key : null);
    if (field && clean(value)) mapped[field] = clean(value, field === "reference" ? 500 : 200);
  }
  const fields = {};
  for (const [key, value] of Object.entries(mapped)) {
    if (key !== "label" && FIELDS.has(key)) fields[key] = value;
  }
  if (kind === "account") {
    const accountNumber = fields.accountNumber;
    if (accountNumber) {
      const compact = accountNumber.replace(/\s+/g, "");
      if (compact.length < 4) return { rowNumber, error: "账号至少需要四位，且不会保存完整账号" };
      fields.accountNumberLast4 = compact.slice(-4);
      delete fields.accountNumber;
    }
  }
  const label = mapped.label
    ?? fields.name
    ?? fields.order_number
    ?? fields.quotation_number
    ?? fields.case_number
    ?? fields.return_number
    ?? fields.shipment_number
    ?? fields.receivable_number
    ?? fields.payment_number
    ?? fields.transaction_number
    ?? fields.reference
    ?? fields.accountName
    ?? fields.channel
    ?? fields.platform;
  if (!label) return { rowNumber, error: "缺少名称/姓名/订单号等可识别名称" };
  const explicitKey = mapped.businessKey
    ?? (kind === "quotation" ? fields.quotation_number : null)
    ?? (kind === "shipment" ? fields.shipment_number : null)
    ?? (kind === "after_sales" ? fields.case_number : null)
    ?? (kind === "return" ? fields.return_number : null)
    ?? (kind === "receivable" ? (fields.receivable_number ?? fields.payment_number) : null)
    ?? (kind === "bank_transaction" ? fields.transaction_number : null);
  const compositeKey = kind === "receivable"
    ? [fields.order_number, fields.payment_date, fields.amount, fields.paid_amount].filter(Boolean).join("/")
    : kind === "bank_transaction"
      ? [fields.order_number, fields.transaction_date, fields.date, fields.amount, fields.reference].filter(Boolean).join("/")
      : null;
  const fallbackKey = explicitKey ?? compositeKey ?? fields.order_number ?? fields.reference ?? fields.email ?? label;
  const multiRecordFallback = new Set(["quotation", "shipment", "receivable", "bank_transaction", "after_sales", "return"]).has(kind)
    && !explicitKey && !compositeKey;
  const businessKey = clean(`${fallbackKey}${multiRecordFallback ? `#row-${rowNumber}` : ""}`, 300);
  return { rowNumber, label, businessKey, fields };
}

async function decodeRows({ bytes, format, fileName }) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_BYTES) {
    return { error: "channel_object_import_file_size_invalid" };
  }
  const resolvedFormat = format ?? String(fileName ?? "").split(".").pop()?.toLowerCase();
  if (resolvedFormat === "csv") {
    return { rows: objectRows(csvRows(bytes.toString("utf8"))), format: "csv" };
  }
  if (resolvedFormat === "json") {
    try {
      const parsed = JSON.parse(bytes.toString("utf8"));
      return { rows: objectRows(Array.isArray(parsed) ? parsed : parsed?.records), format: "json" };
    } catch {
      return { error: "channel_object_import_json_invalid" };
    }
  }
  if (resolvedFormat === "xlsx" || resolvedFormat === "xls") {
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(bytes);
      const worksheet = workbook.worksheets[0];
      if (!worksheet) return { error: "channel_object_import_sheet_missing" };
      const rows = [];
      const headers = [];
      worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell, column) => { headers[column - 1] = cell.text; });
      worksheet.eachRow((worksheetRow, rowNumber) => {
        if (rowNumber === 1) return;
        const values = [];
        worksheetRow.eachCell({ includeEmpty: true }, (cell, column) => { values[column - 1] = cell.text; });
        if (values.some((value) => clean(value))) rows.push(Object.fromEntries(headers.map((header, index) => [header, values[index]])));
      });
      return { rows, format: "xlsx" };
    } catch {
      return { error: "channel_object_import_excel_invalid" };
    }
  }
  return { error: "channel_object_import_format_unsupported" };
}

function publicImport(record) {
  return {
    id: record.id,
    projectId: record.projectId,
    kind: record.kind,
    sourceKind: record.sourceKind ?? "local_file",
    sourceId: record.sourceId,
    format: record.format,
    fileName: record.fileName,
    status: record.status,
    totalRows: record.totalRows,
    acceptedRows: record.acceptedRows,
    errorRows: record.errorRows,
    errors: record.errors,
    previewRows: record.previewRows,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    confirmedAt: record.confirmedAt ?? null,
    diff: record.diff,
  };
}

function publicFileSource(source) {
  return {
    id: source.id,
    projectId: source.projectId,
    kind: source.kind,
    fileName: source.fileName,
    sourceKind: source.sourceKind,
    status: source.status,
    rowCount: source.rowCount,
    contentHash: source.contentHash,
    revision: source.revision,
    lastImportId: source.lastImportId,
    lastImportedAt: source.lastImportedAt,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}

export function createChannelObjectImportService({
  state, now, nextId, appendEvent, persistStateSoon, store, upsertChannelObject, setChannelObjectStatus,
  onFileSourceConfirmed = null, validateApprovalToken,
} = {}) {
  state.channelObjectImports ??= [];
  state.channelObjectFileSources ??= [];
  const runTx = makeRunTx({ store, persistStateSoon });
  const localFileConnector = createLocalFileConnector({ decodeRows, normalizeRow: asImportedRow, maxRows: MAX_ROWS });

  function projectVisible(projectId, actor) {
    return (state.projects ?? []).some((project) => project.id === projectId
      && (project.ownerTeamId ?? LOCAL_TEAM_ID) === teamOf(actor));
  }

  async function previewChannelObjectImport(input = {}, actor = null) {
    const kind = clean(input.kind, 60);
    const projectId = clean(input.projectId, 200);
    if (!KINDS.has(kind) || !projectId || !projectVisible(projectId, actor)) {
      return { status: 404, body: { error: "channel_object_import_project_not_found" } };
    }
    const content = clean(input.content, MAX_BYTES * 2);
    let bytes;
    try { bytes = Buffer.from(content ?? "", "base64"); } catch { return { status: 400, body: { error: "channel_object_import_content_invalid" } }; }
    const decoded = await localFileConnector.read({ bytes, format: input.format, fileName: input.fileName, kind });
    if (decoded.error) return { status: decoded.error === "channel_object_import_row_limit" ? 413 : 400, body: { error: decoded.error, ...(decoded.maxRows ? { maxRows: decoded.maxRows } : {}) } };
    const parsed = decoded.rows;
    const errors = parsed.filter((row) => row.error).map(({ rowNumber, error }) => ({ rowNumber, error }));
    const valid = parsed.filter((row) => !row.error);
    const keys = new Set();
    for (const row of valid) {
      if (keys.has(row.businessKey)) errors.push({ rowNumber: row.rowNumber, error: "文件内存在重复业务标识，请合并后再导入" });
      keys.add(row.businessKey);
    }
    const accepted = valid.filter((row) => !errors.some((error) => error.rowNumber === row.rowNumber));
    const teamId = teamOf(actor);
    const existingSource = state.channelObjectFileSources.find((source) => source.ownerTeamId === teamId
      && source.projectId === projectId && source.kind === kind
      && (input.sourceId ? source.id === input.sourceId : source.fileName === (clean(input.fileName, 200) ?? `import.${decoded.format}`)));
    const sourceId = existingSource?.id ?? nextId("csrc");
    const existingObjects = state.channelObjectRecords.filter((object) => object.ownerTeamId === teamId
      && object.projectId === projectId && object.kind === kind);
    const incomingKeys = new Set(accepted.map((row) => row.businessKey));
    let created = 0; let updated = 0; let unchanged = 0;
    const rowsWithChanges = accepted.map((row) => {
      const existing = existingObjects.find((object) => object.sourceId === sourceId && object.businessKey === row.businessKey)
        ?? existingObjects.find((object) => object.businessKey === row.businessKey);
      if (!existing) { created += 1; return { ...row, change: "create" }; }
      const changed = existing.label !== row.label || JSON.stringify(existing.fields ?? {}) !== JSON.stringify(row.fields) || existing.status !== "active";
      if (changed) { updated += 1; return { ...row, change: "update", existingId: existing.id }; }
      unchanged += 1;
      return { ...row, change: "unchanged", existingId: existing.id };
    });
    const removed = existingObjects.filter((object) => object.sourceId === sourceId && !incomingKeys.has(object.businessKey));
    const timestamp = now();
    const id = nextId("cimport");
    const record = {
      id, schemaVersion: 1, ownerTeamId: teamOf(actor), projectId, kind,
      sourceKind: localFileConnector.id,
      sourceId,
      format: decoded.format, fileName: clean(input.fileName, 200) ?? `import.${decoded.format}`,
      status: "preview", totalRows: decoded.rows.length, acceptedRows: accepted.length,
      errorRows: errors.length, errors: errors.slice(0, 100),
      rows: rowsWithChanges, previewRows: rowsWithChanges.slice(0, PREVIEW_ROWS),
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      createdAt: timestamp, expiresAt: new Date(new Date(timestamp).getTime() + TTL_MS).toISOString(),
      confirmedAt: null, confirmedCount: 0,
      diff: { created, updated, unchanged, removed: removed.length },
    };
    runTx(() => state.channelObjectImports.push(record));
    return { status: 201, body: { import: publicImport(record), canConfirm: errors.length === 0 && accepted.length > 0 } };
  }

  function confirmChannelObjectImport(input = {}, actor = null) {
    const record = state.channelObjectImports.find((candidate) => candidate.id === input.importId
      && candidate.ownerTeamId === teamOf(actor));
    if (!record) return { status: 404, body: { error: "channel_object_import_not_found" } };
    if (record.status === "confirmed") return { status: 200, body: { import: publicImport(record), replayed: true } };
    if (record.status !== "preview") return { status: 409, body: { error: "channel_object_import_not_confirmable" } };
    if (new Date(record.expiresAt).getTime() <= new Date(now()).getTime()) {
      record.status = "expired";
      persistStateSoon?.();
      return { status: 409, body: { error: "channel_object_import_expired" } };
    }
    if (record.errors.length) return { status: 400, body: { error: "channel_object_import_has_errors", errors: record.errors } };
    const approval = validateApprovalToken?.(input.approvalToken, {
      action: "channel_object_import_confirm",
      targetId: record.id,
      actor,
      allowLegacy: false,
    });
    if (!approval?.approved) {
      return { status: 409, body: { error: "channel_object_import_approval_required", reason: approval?.reason ?? "approval_validator_unavailable" } };
    }
    const imported = [];
    for (const row of record.rows.filter((candidate) => candidate.change !== "unchanged")) {
      const result = upsertChannelObject({
        kind: record.kind, projectId: record.projectId, label: row.label,
        businessKey: row.businessKey, fields: row.fields, source: record.sourceKind, sourceId: record.sourceId, sourceRef: record.id, status: "active",
      }, actor);
      if (result.status >= 400) return { status: 409, body: { error: "channel_object_import_write_failed", rowNumber: row.rowNumber, detail: result.body?.error } };
      imported.push(result.body.object);
    }
    const stale = state.channelObjectRecords.filter((object) => object.ownerTeamId === teamOf(actor)
      && object.projectId === record.projectId && object.kind === record.kind && object.sourceId === record.sourceId
      && !record.rows.some((row) => row.businessKey === object.businessKey));
    for (const object of stale) {
      const result = setChannelObjectStatus?.(object.id, { status: "disabled", expectedRevision: object.revision }, actor);
      if (result && result.status >= 400) return { status: 409, body: { error: "channel_object_import_stale_revision", objectId: object.id } };
    }
    const timestamp = now();
    runTx(() => {
      const source = state.channelObjectFileSources.find((candidate) => candidate.id === record.sourceId);
      if (source) {
        Object.assign(source, { fileName: record.fileName, contentHash: record.contentHash, rowCount: record.rows.length, status: "active", revision: source.revision + 1, lastImportId: record.id, lastImportedAt: timestamp, updatedAt: timestamp });
      } else {
        state.channelObjectFileSources.push({ id: record.sourceId, schemaVersion: 1, ownerTeamId: teamOf(actor), projectId: record.projectId, kind: record.kind, fileName: record.fileName, sourceKind: record.sourceKind, status: "active", rowCount: record.rows.length, contentHash: record.contentHash, revision: 1, lastImportId: record.id, lastImportedAt: timestamp, createdAt: timestamp, updatedAt: timestamp });
      }
      record.status = "confirmed";
      record.confirmedAt = timestamp;
      record.confirmedCount = imported.length;
      appendEvent?.({ invocationId: null, type: "channel_object_import_confirmed", level: "info", message: `Channel object import ${record.id} confirmed.`, data: { importId: record.id, count: imported.length, approvalGrantId: approval.grantId ?? null } });
    });
    onFileSourceConfirmed?.({
      fileSourceId: record.sourceId,
      contentHash: record.contentHash,
      rowCount: record.rows.length,
    }, actor);
    return { status: 200, body: { import: publicImport(record), objects: imported, replayed: false } };
  }

  function listChannelObjectImports({ projectId = null } = {}, actor = null) {
    const rows = state.channelObjectImports.filter((record) => record.ownerTeamId === teamOf(actor)
      && (!projectId || record.projectId === projectId)).slice(-50).reverse();
    return { status: 200, body: { imports: rows.map(publicImport), count: rows.length } };
  }

  function listChannelObjectFileSources({ projectId = null, kind = null } = {}, actor = null) {
    const rows = state.channelObjectFileSources.filter((source) => source.ownerTeamId === teamOf(actor)
      && (!projectId || source.projectId === projectId) && (!kind || source.kind === kind)).slice(-100).reverse();
    return { status: 200, body: { sources: rows.map(publicFileSource), count: rows.length } };
  }

  return { previewChannelObjectImport, confirmChannelObjectImport, listChannelObjectImports, listChannelObjectFileSources };
}

export { csvRows, objectRows, asImportedRow };
