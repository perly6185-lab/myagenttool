import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  open,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";

import ExcelJS from "exceljs";

import { businessRoutineSchemaVersion } from "@myagenttool/protocol/business-routine";

import { actorCanAccessProject, LOCAL_TEAM_ID, LOCAL_USER_ID } from "../runtime/auth.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";

const MAX_LEDGER_BYTES = 25 * 1024 * 1024;
const MAX_ROWS = 100_000;
const MAX_COLUMNS = 500;
const PREVIEW_TTL_MS = 15 * 60 * 1_000;
const STALE_LOCK_MS = 5 * 60 * 1_000;
const SAFE_FIELD_RE = /^[a-zA-Z][a-zA-Z0-9_.-]{0,119}$/;
const FORMULA_PREFIX_RE = /^[=+\-@]/;

function boundedText(value, max = 500) {
  const text = String(value ?? "").trim();
  return text && text.length <= max ? text : null;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function ledgerContentRevision(value, format) {
  if (format !== "xlsx") return sha256(value);

  // XLSX files are ZIP archives. JSZip gives every entry the current DOS
  // timestamp when ExcelJS serializes a workbook, so two byte-for-byte
  // equivalent preview/commit renders can otherwise have different hashes
  // when they straddle a two-second DOS clock boundary.
  const buffer = Buffer.from(value);
  const minimumEocdSize = 22;
  const maximumCommentSize = 0xffff;
  if (buffer.length < minimumEocdSize) return sha256(buffer);
  const searchStart = Math.max(0, buffer.length - minimumEocdSize - maximumCommentSize);
  let eocdOffset = -1;
  for (let offset = buffer.length - minimumEocdSize; offset >= searchStart; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) return sha256(buffer);

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  for (let entry = 0; entry < entryCount; entry += 1) {
    if (centralOffset + 46 > buffer.length
      || buffer.readUInt32LE(centralOffset) !== 0x02014b50) {
      return sha256(value);
    }
    const localOffset = buffer.readUInt32LE(centralOffset + 42);
    if (localOffset + 30 > buffer.length
      || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      return sha256(value);
    }

    // Normalize only metadata; compressed content and CRCs remain untouched.
    buffer.writeUInt16LE(0, centralOffset + 12);
    buffer.writeUInt16LE(0x21, centralOffset + 14);
    buffer.writeUInt16LE(0, localOffset + 10);
    buffer.writeUInt16LE(0x21, localOffset + 12);

    const nameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }
  return sha256(buffer);
}

function within(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function publicPreview(preview) {
  const {
    fieldValues: _fieldValues,
    previewDigest: _previewDigest,
    targetPath: _targetPath,
    ...result
  } = preview;
  return result;
}

function normalizeCellValue(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if (Object.hasOwn(value, "formula") || Object.hasOwn(value, "sharedFormula")) {
      return normalizeCellValue(value.result);
    }
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text ?? "").join("");
    if (Object.hasOwn(value, "text")) return String(value.text);
    if (Object.hasOwn(value, "error")) return String(value.error);
    return String(value);
  }
  return value;
}

function normalizedFieldValues(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (!entries.length || entries.length > 100) return null;
  const fields = {};
  for (const [field, candidate] of entries) {
    if (!SAFE_FIELD_RE.test(field)) return null;
    if (candidate == null || typeof candidate === "boolean") fields[field] = candidate;
    else if (typeof candidate === "number" && Number.isFinite(candidate)) fields[field] = candidate;
    else if (typeof candidate === "string" && candidate.length <= 2_000) {
      if (FORMULA_PREFIX_RE.test(candidate.trimStart())) return null;
      fields[field] = candidate;
    } else return null;
  }
  return fields;
}

function normalizeEvidence(values, fallbackArtifactIds = []) {
  const input = values == null
    ? fallbackArtifactIds.map((artifactId) => ({ artifactId, field: null }))
    : values;
  if (!Array.isArray(input) || !input.length || input.length > 50) return null;
  const rows = [];
  const seen = new Set();
  for (const item of input) {
    if (!item || typeof item !== "object") return null;
    const artifactId = boundedText(item.artifactId, 200);
    const field = item.field == null ? null : boundedText(item.field, 120);
    if (!artifactId || (item.field != null && (!field || !SAFE_FIELD_RE.test(field)))) return null;
    const key = `${artifactId}:${field ?? ""}`;
    if (!seen.has(key)) rows.push({ artifactId, field });
    seen.add(key);
  }
  return rows;
}

function parseCsv(buffer, delimiter) {
  const hasBom = buffer.length >= 3
    && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
  const text = buffer.toString("utf8", hasBom ? 3 : 0);
  if (text.includes("\0")) throw Object.assign(new Error("invalid_csv"), { code: "invalid_csv" });
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === "\"" && text[index + 1] === "\"") {
        value += "\"";
        index += 1;
      } else if (character === "\"") quoted = false;
      else value += character;
    } else if (character === "\"" && value === "") quoted = true;
    else if (character === delimiter) {
      row.push(value);
      value = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      if (rows.length > MAX_ROWS) throw Object.assign(new Error("ledger_too_many_rows"), { code: "ledger_too_many_rows" });
    } else value += character;
  }
  if (quoted) throw Object.assign(new Error("invalid_csv"), { code: "invalid_csv" });
  if (value !== "" || row.length) {
    row.push(value);
    rows.push(row);
  }
  if (rows.at(-1)?.length === 1 && rows.at(-1)[0] === "") rows.pop();
  if (rows.some((candidate) => candidate.length > MAX_COLUMNS)) {
    throw Object.assign(new Error("ledger_too_many_columns"), { code: "ledger_too_many_columns" });
  }
  return { rows, hasBom, eol };
}

function csvCell(value, delimiter) {
  const text = value == null ? "" : String(value);
  return /["\r\n]/.test(text) || text.includes(delimiter)
    ? `"${text.replaceAll("\"", "\"\"")}"`
    : text;
}

function serializeCsv({ rows, hasBom, eol }, delimiter) {
  const content = rows.map((row) => row.map((value) => csvCell(value, delimiter)).join(delimiter)).join(eol);
  return Buffer.from(`${hasBom ? "\ufeff" : ""}${content}${content ? eol : ""}`, "utf8");
}

function headerIndex(headers) {
  const indexes = new Map();
  for (let index = 0; index < headers.length; index += 1) {
    const header = String(headers[index] ?? "").trim();
    if (!header) continue;
    if (indexes.has(header)) {
      throw Object.assign(new Error("ledger_duplicate_header"), { code: "ledger_duplicate_header" });
    }
    indexes.set(header, index);
  }
  return indexes;
}

function validateMappedHeaders(definition, indexes) {
  const missing = [...new Set(Object.values(definition.fieldMappings))]
    .filter((column) => !indexes.has(column));
  if (missing.length) {
    throw Object.assign(new Error("ledger_headers_missing"), {
      code: "ledger_headers_missing",
      details: { missing },
    });
  }
}

function resolvedBusinessKey(definition, fields, requestedBusinessKey) {
  const primary = boundedText(fields[definition.businessKeyField] ?? requestedBusinessKey, 500);
  if (primary) return primary;
  const fallback = definition.fallbackBusinessKeyFields
    .map((field) => boundedText(fields[field], 200));
  return fallback.length && fallback.every(Boolean) ? fallback.join("::") : null;
}

function compareValues(before, after) {
  return String(before ?? "") === String(after ?? "");
}

function planTabularMutation({ definition, rows, fields, businessKey }) {
  const headerOffset = definition.headerRow - 1;
  const headers = rows[headerOffset];
  if (!headers) throw Object.assign(new Error("ledger_header_row_missing"), { code: "ledger_header_row_missing" });
  const indexes = headerIndex(headers);
  validateMappedHeaders(definition, indexes);
  const keyColumnName = definition.fieldMappings[definition.businessKeyField];
  const keyIndex = indexes.get(keyColumnName);
  const matches = [];
  for (let index = headerOffset + 1; index < rows.length; index += 1) {
    if (String(rows[index][keyIndex] ?? "").trim() === businessKey) matches.push(index);
  }
  if (matches.length > 1) {
    throw Object.assign(new Error("ledger_duplicate_business_key"), { code: "ledger_duplicate_business_key" });
  }
  const rowIndex = matches[0] ?? rows.length;
  const action = matches.length ? "update" : "insert";
  if (action === "insert" && !definition.writePolicy.allowInsert) {
    throw Object.assign(new Error("ledger_insert_not_allowed"), { code: "ledger_insert_not_allowed" });
  }
  if (action === "update" && !definition.writePolicy.allowUpdate) {
    throw Object.assign(new Error("ledger_update_not_allowed"), { code: "ledger_update_not_allowed" });
  }
  const current = rows[rowIndex] ?? [];
  const changedCells = [];
  for (const [field, column] of Object.entries(definition.fieldMappings)) {
    if (!Object.hasOwn(fields, field)) continue;
    const index = indexes.get(column);
    const before = normalizeCellValue(current[index]);
    const after = fields[field];
    if (!compareValues(before, after)) changedCells.push({ field, column, before, after });
  }
  return {
    action: changedCells.length ? action : "no_op",
    rowIndex,
    rowNumber: rowIndex + 1,
    indexes,
    changedCells,
  };
}

async function loadWorkbook(buffer, definition) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw Object.assign(new Error("invalid_or_unsupported_xlsx"), { code: "invalid_or_unsupported_xlsx" });
  }
  const worksheet = workbook.getWorksheet(definition.sheet);
  if (!worksheet) throw Object.assign(new Error("ledger_sheet_missing"), { code: "ledger_sheet_missing" });
  let table = null;
  if (definition.table) {
    try {
      table = worksheet.getTable(definition.table);
    } catch {
      table = null;
    }
    if (!table) throw Object.assign(new Error("ledger_table_missing"), { code: "ledger_table_missing" });
    const restored = loadedTableRows(table, worksheet);
    if (restored.startRow !== definition.headerRow) {
      throw Object.assign(new Error("ledger_table_header_row_mismatch"), {
        code: "ledger_table_header_row_mismatch",
      });
    }
  } else if (worksheet.getTables().length) {
    throw Object.assign(new Error("xlsx_tables_not_supported_for_safe_preservation"), {
      code: "xlsx_tables_not_supported_for_safe_preservation",
    });
  }
  const rows = table
    ? [
        ...Array.from({ length: definition.headerRow - 1 }, () => []),
        table.table.columns.map((column) => column.name),
        ...table.table.rows.map((row) => row.map(normalizeCellValue)),
      ]
    : [];
  if (!table) {
    for (let rowNumber = 1; rowNumber <= Math.max(worksheet.actualRowCount, definition.headerRow); rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const values = [];
      for (let column = 1; column <= Math.min(MAX_COLUMNS, Math.max(worksheet.actualColumnCount, row.cellCount)); column += 1) {
        values.push(normalizeCellValue(row.getCell(column).value));
      }
      rows.push(values);
    }
  }
  if (rows.length > MAX_ROWS || worksheet.actualColumnCount > MAX_COLUMNS) {
    throw Object.assign(new Error("ledger_size_limit_exceeded"), { code: "ledger_size_limit_exceeded" });
  }
  return { workbook, worksheet, table, rows };
}

function cloneStyle(style) {
  return style ? structuredClone(style) : {};
}

function columnNumber(letters) {
  let result = 0;
  for (const character of letters.toUpperCase()) {
    result = result * 26 + character.charCodeAt(0) - 64;
  }
  return result;
}

function loadedTableRows(table, worksheet) {
  const range = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i.exec(table.table.tableRef ?? "");
  if (!range) throw Object.assign(new Error("ledger_table_range_invalid"), { code: "ledger_table_range_invalid" });
  const startColumn = columnNumber(range[1]);
  const startRow = Number(range[2]);
  const endRow = Number(range[4]);
  const dataStart = startRow + (table.table.headerRow ? 1 : 0);
  const dataEnd = endRow - (table.table.totalsRow ? 1 : 0);
  const rows = [];
  for (let rowNumber = dataStart; rowNumber <= dataEnd; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    rows.push(table.table.columns.map((_, index) => row.getCell(startColumn + index).value));
  }
  table.table.ref = `${range[1].toUpperCase()}${startRow}`;
  table.table.rows = rows;
  // ExcelJS 4.4 reconstructs loaded table metadata without the worksheet and
  // row cache required by its mutation methods. Rehydrate those public model
  // inputs from the worksheet before calling addRow/commit.
  table.worksheet = worksheet;
  return { startRow, rows };
}

async function renderMutation(buffer, definition, preview) {
  if (preview.action === "no_op") return buffer;
  if (definition.format === "csv") {
    const parsed = parseCsv(buffer, definition.formattingPolicy.csvDelimiter);
    const plan = planTabularMutation({
      definition,
      rows: parsed.rows,
      fields: preview.fieldValues,
      businessKey: preview.businessKey,
    });
    if (plan.action !== preview.action || plan.rowNumber !== preview.rowNumber) {
      throw Object.assign(new Error("ledger_preview_no_longer_matches"), { code: "ledger_preview_no_longer_matches" });
    }
    const row = parsed.rows[plan.rowIndex] ?? Array.from({ length: parsed.rows[definition.headerRow - 1].length }, () => "");
    for (const change of plan.changedCells) row[plan.indexes.get(change.column)] = change.after ?? "";
    if (plan.rowIndex === parsed.rows.length) parsed.rows.push(row);
    else parsed.rows[plan.rowIndex] = row;
    return serializeCsv(parsed, definition.formattingPolicy.csvDelimiter);
  }

  const loaded = await loadWorkbook(buffer, definition);
  const plan = planTabularMutation({
    definition,
    rows: loaded.rows,
    fields: preview.fieldValues,
    businessKey: preview.businessKey,
  });
  if (plan.action !== preview.action || plan.rowNumber !== preview.rowNumber) {
    throw Object.assign(new Error("ledger_preview_no_longer_matches"), { code: "ledger_preview_no_longer_matches" });
  }
  if (loaded.table) {
    const tableRowIndex = plan.rowIndex - definition.headerRow;
    if (plan.action === "insert") {
      const row = Array.from({ length: loaded.table.table.columns.length }, () => null);
      const template = loaded.table.table.rows.at(-1) ?? [];
      for (let index = 0; index < template.length; index += 1) {
        const value = template[index];
        const mappedColumn = [...plan.indexes.entries()]
          .find(([, columnIndex]) => columnIndex === index)?.[0];
        if (!Object.values(definition.fieldMappings).includes(mappedColumn)
          && value && typeof value === "object"
          && (Object.hasOwn(value, "formula") || Object.hasOwn(value, "sharedFormula"))) {
          throw Object.assign(new Error("xlsx_formula_row_insert_not_supported"), {
            code: "xlsx_formula_row_insert_not_supported",
          });
        }
      }
      for (const change of plan.changedCells) row[plan.indexes.get(change.column)] = change.after;
      loaded.table.addRow(row);
    } else {
      const row = loaded.table.table.rows[tableRowIndex];
      for (const change of plan.changedCells) {
        const index = plan.indexes.get(change.column);
        const existing = row[index];
        if (existing && typeof existing === "object"
          && (Object.hasOwn(existing, "formula") || Object.hasOwn(existing, "sharedFormula"))) {
          throw Object.assign(new Error("xlsx_mapped_formula_cannot_be_replaced"), {
            code: "xlsx_mapped_formula_cannot_be_replaced",
          });
        }
        row[index] = change.after;
      }
    }
    loaded.table.commit();
    return Buffer.from(await loaded.workbook.xlsx.writeBuffer());
  }
  const targetRow = loaded.worksheet.getRow(plan.rowNumber);
  if (plan.action === "insert") {
    const template = loaded.worksheet.getRow(Math.max(definition.headerRow + 1, plan.rowNumber - 1));
    for (let column = 1; column <= loaded.worksheet.actualColumnCount; column += 1) {
      const templateCell = template.getCell(column);
      if (templateCell.value && typeof templateCell.value === "object"
        && (Object.hasOwn(templateCell.value, "formula") || Object.hasOwn(templateCell.value, "sharedFormula"))) {
        throw Object.assign(new Error("xlsx_formula_row_insert_not_supported"), {
          code: "xlsx_formula_row_insert_not_supported",
        });
      }
      targetRow.getCell(column).style = cloneStyle(templateCell.style);
    }
    targetRow.height = template.height;
  }
  for (const change of plan.changedCells) {
    const cell = targetRow.getCell(plan.indexes.get(change.column) + 1);
    if (cell.value && typeof cell.value === "object"
      && (Object.hasOwn(cell.value, "formula") || Object.hasOwn(cell.value, "sharedFormula"))) {
      throw Object.assign(new Error("xlsx_mapped_formula_cannot_be_replaced"), {
        code: "xlsx_mapped_formula_cannot_be_replaced",
      });
    }
    cell.value = change.after;
  }
  targetRow.commit();
  return Buffer.from(await loaded.workbook.xlsx.writeBuffer());
}

async function inspectLedger(buffer, definition, fields = null, businessKey = null) {
  if (definition.format === "csv") {
    const parsed = parseCsv(buffer, definition.formattingPolicy.csvDelimiter);
    if (!fields) {
      const indexes = headerIndex(parsed.rows[definition.headerRow - 1] ?? []);
      validateMappedHeaders(definition, indexes);
      return null;
    }
    return planTabularMutation({ definition, rows: parsed.rows, fields, businessKey });
  }
  const loaded = await loadWorkbook(buffer, definition);
  if (!fields) {
    const indexes = headerIndex(loaded.rows[definition.headerRow - 1] ?? []);
    validateMappedHeaders(definition, indexes);
    return null;
  }
  return planTabularMutation({ definition, rows: loaded.rows, fields, businessKey });
}

async function acquireLock(path, nowMs) {
  const lockPath = `${path}.myagenttool.lock`;
  try {
    const handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: nowMs }));
    await handle.sync();
    await handle.close();
    return lockPath;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    try {
      const lock = JSON.parse(await readFile(lockPath, "utf8"));
      if (Number.isFinite(lock.createdAt) && nowMs - lock.createdAt > STALE_LOCK_MS) {
        await unlink(lockPath);
        return acquireLock(path, nowMs);
      }
    } catch {
      // A malformed or unreadable lock is treated as active; deleting it could
      // allow two writers to mutate the same business ledger.
    }
    throw Object.assign(new Error("ledger_locked"), { code: "ledger_locked" });
  }
}

async function atomicReplace(path, buffer, previewId, mode) {
  const temporary = `${path}.myagenttool-${previewId}.tmp`;
  let handle = null;
  try {
    handle = await open(temporary, "wx", mode & 0o777);
    await handle.writeFile(buffer);
    await handle.sync();
    await handle.close();
    handle = null;
    await chmod(temporary, mode & 0o777);
    await rename(temporary, path);
    try {
      const directory = await open(dirname(path), "r");
      await directory.sync();
      await directory.close();
    } catch {
      // Some platforms do not permit fsync on a directory. The same-directory
      // atomic rename still prevents a partially written target.
    }
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

function serviceError(error) {
  const code = error?.code ?? "ledger_operation_failed";
  if (["EACCES", "EPERM", "EROFS"].includes(code)) {
    return { status: 403, body: { error: "ledger_file_permission_denied" } };
  }
  if (code === "ENOENT") return { status: 404, body: { error: "ledger_file_not_found" } };
  if (code === "ledger_locked") return { status: 423, body: { error: code } };
  const conflict = new Set([
    "ledger_duplicate_business_key",
    "ledger_preview_no_longer_matches",
    "ledger_insert_not_allowed",
    "ledger_update_not_allowed",
    "xlsx_formula_row_insert_not_supported",
    "xlsx_mapped_formula_cannot_be_replaced",
    "xlsx_tables_not_supported_for_safe_preservation",
  ]);
  return { status: conflict.has(code) ? 409 : 400, body: { error: code, ...(error.details ?? {}) } };
}

export function createLedgerUpsertService({
  state,
  now = () => new Date().toISOString(),
  nextId = (prefix) => `${prefix}_${Date.now().toString(36)}`,
  appendEvent = () => {},
  persistStateSoon = () => {},
  store,
  validateRoutineLedgerStep = () => ({ ok: true, routineVersion: null }),
  completeRoutineLedgerStep = () => ({ ok: true }),
} = {}) {
  state.ledgerDefinitions ??= [];
  state.ledgerUpsertPreviews ??= [];
  state.ledgerMutationAudits ??= [];
  const actorTeam = (actor) => actor?.teamId ?? LOCAL_TEAM_ID;
  const actorUser = (actor) => actor?.userId ?? LOCAL_USER_ID;
  const visible = (row, actor) => row?.ownerTeamId === actorTeam(actor);
  const runTx = makeRunTx({ store, persistStateSoon });

  function definitionFor(id, actor) {
    return state.ledgerDefinitions.find((row) => row.id === id && visible(row, actor)) ?? null;
  }

  function contextFor(definition, actor, { requireActive = true } = {}) {
    const project = actorCanAccessProject(state, actor, definition.projectId)
      ? state.projects?.find((row) => row.id === definition.projectId)
      : null;
    const source = state.workflowSources?.find((row) =>
      row.id === definition.sourceId
      && visible(row, actor)
      && row.projectId === definition.projectId) ?? null;
    if (!project || !source) return null;
    if (requireActive && (definition.state !== "active" || source.state !== "active")) return null;
    return { project, source };
  }

  async function targetFor(definition, context) {
    const projectRoot = await realpath(context.project.path);
    const sourceCandidate = resolve(projectRoot, context.source.relativePath || ".");
    const sourceRoot = await realpath(sourceCandidate);
    if (!within(projectRoot, sourceRoot)) {
      throw Object.assign(new Error("ledger_source_outside_project"), { code: "ledger_source_outside_project" });
    }
    const candidate = resolve(sourceRoot, definition.relativePath);
    if (!within(sourceRoot, candidate)) {
      throw Object.assign(new Error("ledger_path_outside_authorized_source"), {
        code: "ledger_path_outside_authorized_source",
      });
    }
    const target = await realpath(candidate);
    if (!within(sourceRoot, target)) {
      throw Object.assign(new Error("ledger_link_escapes_authorized_source"), {
        code: "ledger_link_escapes_authorized_source",
      });
    }
    if ((await lstat(candidate)).isSymbolicLink()) {
      throw Object.assign(new Error("ledger_symbolic_link_not_supported"), {
        code: "ledger_symbolic_link_not_supported",
      });
    }
    if (extname(target).toLowerCase() !== `.${definition.format}`) {
      throw Object.assign(new Error("ledger_file_format_mismatch"), { code: "ledger_file_format_mismatch" });
    }
    const metadata = await stat(target);
    if (!metadata.isFile() || metadata.size > MAX_LEDGER_BYTES) {
      throw Object.assign(new Error("ledger_size_limit_exceeded"), { code: "ledger_size_limit_exceeded" });
    }
    return { target, metadata };
  }

  function event(type, message, row, actor, data = {}) {
    appendEvent({
      invocationId: null,
      type,
      level: type.includes("failed") ? "warning" : "info",
      message,
      data: {
        projectId: row.projectId,
        sourceId: row.sourceId,
        actorTeamId: actorTeam(actor),
        actorId: actorUser(actor),
        ...data,
      },
    });
  }

  function listDefinitions({ sourceId = null } = {}, actor = null) {
    const rows = state.ledgerDefinitions.filter((row) =>
      visible(row, actor)
      && actorCanAccessProject(state, actor, row.projectId)
      && (!sourceId || row.sourceId === sourceId));
    return { status: 200, body: { ledgerDefinitions: rows } };
  }

  async function activateDefinition({ ledgerDefinitionId, expectedRevision } = {}, actor = null) {
    const definition = definitionFor(ledgerDefinitionId, actor);
    if (!definition) return { status: 404, body: { error: "ledger_definition_not_found" } };
    if (definition.revision !== expectedRevision) {
      return {
        status: 409,
        body: { error: "ledger_definition_revision_conflict", currentRevision: definition.revision },
      };
    }
    if (definition.state === "disabled") {
      return { status: 409, body: { error: "disabled_ledger_definition_cannot_activate" } };
    }
    if (definition.state === "active") {
      return { status: 200, body: { ledgerDefinition: definition, replayed: true } };
    }
    const context = contextFor(definition, actor, { requireActive: false });
    if (!context || context.source.state !== "active") {
      return { status: 404, body: { error: "ledger_definition_context_not_found" } };
    }
    try {
      const { target } = await targetFor(definition, context);
      const buffer = await readFile(target);
      await inspectLedger(buffer, definition);
      runTx(() => {
        definition.state = "active";
        definition.revision += 1;
        definition.updatedAt = now();
        definition.updatedBy = actorUser(actor);
        event("ledger_definition_activated", "Ledger definition activated.", definition, actor, {
          ledgerDefinitionId: definition.id,
          targetRevision: ledgerContentRevision(buffer, definition.format),
        });
      });
      return { status: 200, body: { ledgerDefinition: definition, replayed: false } };
    } catch (error) {
      return serviceError(error);
    }
  }

  function disableDefinition({ ledgerDefinitionId, expectedRevision } = {}, actor = null) {
    const definition = definitionFor(ledgerDefinitionId, actor);
    if (!definition) return { status: 404, body: { error: "ledger_definition_not_found" } };
    if (definition.revision !== expectedRevision) {
      return {
        status: 409,
        body: { error: "ledger_definition_revision_conflict", currentRevision: definition.revision },
      };
    }
    if (definition.state === "disabled") {
      return { status: 200, body: { ledgerDefinition: definition, replayed: true } };
    }
    runTx(() => {
      definition.state = "disabled";
      definition.revision += 1;
      definition.updatedAt = now();
      definition.updatedBy = actorUser(actor);
      event("ledger_definition_disabled", "Ledger definition disabled.", definition, actor, {
        ledgerDefinitionId: definition.id,
      });
    });
    return { status: 200, body: { ledgerDefinition: definition, replayed: false } };
  }

  async function previewUpsert({
    ledgerDefinitionId,
    businessKey: requestedBusinessKey,
    fields: inputFields,
    sourceEvidence: inputEvidence,
    routineRunId = null,
    routineStepKey = null,
  } = {}, actor = null) {
    const definition = definitionFor(ledgerDefinitionId, actor);
    if (!definition) return { status: 404, body: { error: "ledger_definition_not_found" } };
    const context = contextFor(definition, actor);
    if (!context) return { status: 409, body: { error: "ledger_definition_not_active" } };
    let routineValidation = { ok: true, routineVersion: null, triggerArtifactIds: [] };
    if (routineRunId || routineStepKey) {
      routineValidation = validateRoutineLedgerStep({
        routineRunId,
        stepKey: routineStepKey,
        ledgerDefinitionId: definition.id,
        businessKey: requestedBusinessKey ?? null,
      }, actor);
      if (!routineValidation.ok) {
        return {
          status: routineValidation.status ?? 409,
          body: { error: routineValidation.error ?? "routine_ledger_step_invalid" },
        };
      }
    }
    let candidateFields = inputFields;
    if (candidateFields == null && routineValidation.businessCaseId) {
      const businessCase = state.businessCases?.find((row) =>
        row.id === routineValidation.businessCaseId
        && row.ownerTeamId === actorTeam(actor));
      candidateFields = Object.assign({}, ...(businessCase?.entityIds ?? [])
        .map((entityId) => state.businessEntities?.find((row) =>
          row.id === entityId && row.ownerTeamId === actorTeam(actor))?.fields ?? {}));
    }
    const fields = normalizedFieldValues(candidateFields);
    if (!fields) return { status: 400, body: { error: "invalid_ledger_fields" } };
    const businessKey = resolvedBusinessKey(
      definition,
      fields,
      requestedBusinessKey
        ?? (definition.businessKeyField === "inquiry_number" ? routineValidation.businessKey : null),
    );
    if (!businessKey) return { status: 400, body: { error: "ledger_business_key_required" } };
    if (definition.businessKeyField === "inquiry_number"
      && routineValidation.businessKey
      && routineValidation.businessKey !== businessKey) {
      return { status: 409, body: { error: "routine_ledger_business_key_mismatch" } };
    }
    fields[definition.businessKeyField] = businessKey;
    const missingRequiredFields = definition.requiredFields.filter((field) =>
      !Object.hasOwn(fields, field) || fields[field] == null || String(fields[field]).trim() === "");
    if (missingRequiredFields.length) {
      return { status: 400, body: { error: "ledger_required_fields_missing", missingRequiredFields } };
    }
    const evidence = normalizeEvidence(inputEvidence, routineValidation.triggerArtifactIds);
    if (!evidence) return { status: 400, body: { error: "ledger_source_evidence_required" } };
    const invalidEvidence = evidence.some((row) => {
      const artifact = state.workflowArtifacts?.find((candidate) =>
        candidate.id === row.artifactId
        && candidate.ownerTeamId === actorTeam(actor)
        && candidate.projectId === definition.projectId
        && candidate.sourceId === definition.sourceId);
      return !artifact || artifact.availability === "missing" || artifact.exclusion;
    });
    if (invalidEvidence) return { status: 404, body: { error: "ledger_source_evidence_not_found" } };
    const routineBusinessCase = routineValidation.businessCaseId
      ? state.businessCases?.find((row) =>
        row.id === routineValidation.businessCaseId
        && row.ownerTeamId === actorTeam(actor))
      : null;
    if (routineValidation.businessCaseId && definition.businessKeyField !== "inquiry_number") {
      const confirmedCaseKeys = new Set((routineBusinessCase?.entityIds ?? [])
        .map((entityId) => state.businessEntities?.find((row) =>
          row.id === entityId && row.ownerTeamId === actorTeam(actor))?.fields?.[definition.businessKeyField])
        .map((value) => boundedText(value, 500))
        .filter(Boolean));
      if (!confirmedCaseKeys.has(businessKey)) {
        return { status: 409, body: { error: "routine_ledger_business_key_not_confirmed_in_case" } };
      }
    }
    if (definition.documentType === "order_ledger") {
      const evidenceIds = new Set(evidence.map((row) => row.artifactId));
      const caseArtifactIds = new Set((routineBusinessCase?.artifactBindings ?? [])
        .filter((binding) => binding.documentType === "order")
        .map((binding) => binding.artifactId));
      const confirmedOrder = state.businessDocumentClassifications?.some((classification) =>
        classification.ownerTeamId === actorTeam(actor)
        && classification.projectId === definition.projectId
        && classification.sourceId === definition.sourceId
        && classification.documentType === "order"
        && ["confirmed", "corrected"].includes(classification.confirmationState)
        && evidenceIds.has(classification.artifactId)
        && (!routineBusinessCase || caseArtifactIds.has(classification.artifactId)));
      if (!confirmedOrder) {
        return { status: 409, body: { error: "confirmed_order_business_event_required" } };
      }
    }

    try {
      const { target } = await targetFor(definition, context);
      const buffer = await readFile(target);
      const targetRevision = ledgerContentRevision(buffer, definition.format);
      const plan = await inspectLedger(buffer, definition, fields, businessKey);
      const proposedBuffer = await renderMutation(buffer, definition, {
        action: plan.action,
        rowNumber: plan.rowNumber,
        fieldValues: fields,
        businessKey,
      });
      const proposedTargetRevision = ledgerContentRevision(proposedBuffer, definition.format);
      const approvalRequired = plan.action !== "no_op"
        && (definition.writePolicy.approval === "always"
          || (definition.writePolicy.approval === "updates_only" && plan.action === "update"));
      const timestamp = now();
      const expiresAt = new Date(Date.parse(timestamp) + PREVIEW_TTL_MS).toISOString();
      const previewDigest = sha256(JSON.stringify({
        ledgerDefinitionId: definition.id,
        businessKey,
        fields,
        targetRevision,
        action: plan.action,
        rowNumber: plan.rowNumber,
      }));
      const replay = state.ledgerUpsertPreviews.find((row) =>
        visible(row, actor) && row.state === "pending" && row.previewDigest === previewDigest
        && Date.parse(row.expiresAt) > Date.parse(timestamp));
      if (replay) return { status: 200, body: { preview: publicPreview(replay), replayed: true } };
      const preview = {
        id: nextId("lup"),
        schemaVersion: businessRoutineSchemaVersion,
        ownerTeamId: actorTeam(actor),
        projectId: definition.projectId,
        sourceId: definition.sourceId,
        ledgerDefinitionId: definition.id,
        routineRunId: routineRunId || null,
        routineStepKey: routineStepKey || null,
        routineRunRevision: routineValidation.routineRunRevision ?? null,
        routineVersion: routineValidation.routineVersion ?? null,
        businessKey,
        action: plan.action,
        rowNumber: plan.rowNumber,
        changedCells: plan.changedCells,
        sourceEvidence: evidence,
        warnings: [],
        targetRevision,
        proposedTargetRevision,
        targetPath: target,
        fieldValues: fields,
        previewDigest,
        approvalRequired,
        state: "pending",
        expiresAt,
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        createdBy: actorUser(actor),
      };
      runTx(() => {
        state.ledgerUpsertPreviews.push(preview);
        event("ledger_upsert_preview_created", "Ledger change preview created.", preview, actor, {
          ledgerDefinitionId: definition.id,
          previewId: preview.id,
          routineRunId: preview.routineRunId,
          routineStepKey: preview.routineStepKey,
          action: preview.action,
        });
      });
      return { status: 201, body: { preview: publicPreview(preview), replayed: false } };
    } catch (error) {
      return serviceError(error);
    }
  }

  async function commitPreview({
    previewId,
    expectedRevision,
    approved = false,
  } = {}, actor = null) {
    const preview = state.ledgerUpsertPreviews.find((row) =>
      row.id === previewId && visible(row, actor)) ?? null;
    if (!preview) return { status: 404, body: { error: "ledger_upsert_preview_not_found" } };
    const existingAudit = state.ledgerMutationAudits.find((row) =>
      row.previewId === preview.id && visible(row, actor));
    if (existingAudit) {
      return {
        status: 200,
        body: { preview: publicPreview(preview), mutation: existingAudit, replayed: true },
      };
    }
    if (preview.revision !== expectedRevision) {
      return {
        status: 409,
        body: { error: "ledger_preview_revision_conflict", currentRevision: preview.revision },
      };
    }
    if (preview.state !== "pending") {
      return { status: 409, body: { error: "ledger_preview_not_committable", currentState: preview.state } };
    }
    if (Date.parse(preview.expiresAt) <= Date.parse(now())) {
      runTx(() => {
        preview.state = "expired";
        preview.revision += 1;
        preview.updatedAt = now();
      });
      return { status: 409, body: { error: "ledger_preview_expired" } };
    }
    if (preview.approvalRequired && approved !== true) {
      return { status: 409, body: { error: "ledger_mutation_approval_required" } };
    }
    const definition = definitionFor(preview.ledgerDefinitionId, actor);
    const context = definition ? contextFor(definition, actor) : null;
    if (!definition || !context) return { status: 409, body: { error: "ledger_definition_not_active" } };
    if (preview.routineRunId) {
      const validation = validateRoutineLedgerStep({
        routineRunId: preview.routineRunId,
        stepKey: preview.routineStepKey,
        ledgerDefinitionId: definition.id,
        businessKey: preview.businessKey,
        expectedRunRevision: preview.routineRunRevision,
      }, actor);
      if (!validation.ok) {
        return {
          status: validation.status ?? 409,
          body: { error: validation.error ?? "routine_ledger_step_changed" },
        };
      }
    }

    let lockPath = null;
    try {
      const { target, metadata } = await targetFor(definition, context);
      if (target !== preview.targetPath) {
        return { status: 409, body: { error: "ledger_target_changed_since_preview" } };
      }
      lockPath = await acquireLock(target, Date.parse(now()));
      const before = await readFile(target);
      const beforeHash = ledgerContentRevision(before, definition.format);
      const recoveredAfterRename = beforeHash === preview.proposedTargetRevision
        && beforeHash !== preview.targetRevision;
      if (beforeHash !== preview.targetRevision && !recoveredAfterRename) {
        return {
          status: 409,
          body: {
            error: "ledger_changed_since_preview",
            expectedTargetRevision: preview.targetRevision,
            currentTargetRevision: beforeHash,
          },
        };
      }
      const after = recoveredAfterRename
        ? before
        : await renderMutation(before, definition, preview);
      const afterHash = ledgerContentRevision(after, definition.format);
      if (preview.action !== "no_op" && !recoveredAfterRename) {
        await atomicReplace(target, after, preview.id, metadata.mode);
      }
      const timestamp = now();
      const mutation = {
        id: nextId("lma"),
        schemaVersion: businessRoutineSchemaVersion,
        ownerTeamId: actorTeam(actor),
        projectId: preview.projectId,
        sourceId: preview.sourceId,
        ledgerDefinitionId: definition.id,
        previewId: preview.id,
        routineRunId: preview.routineRunId,
        routineStepKey: preview.routineStepKey,
        routineVersion: preview.routineVersion,
        businessKey: preview.businessKey,
        action: preview.action,
        approverId: preview.approvalRequired ? actorUser(actor) : null,
        beforeHash: preview.targetRevision,
        afterHash,
        changedFields: preview.changedCells.map((cell) => cell.field),
        sourceArtifactIds: [...new Set(preview.sourceEvidence.map((row) => row.artifactId))],
        createdAt: timestamp,
      };
      runTx(() => {
        state.ledgerMutationAudits.push(mutation);
        preview.state = "committed";
        preview.revision += 1;
        preview.updatedAt = timestamp;
        preview.committedAt = timestamp;
        preview.mutationId = mutation.id;
      });
      let routineCompletion = null;
      if (preview.routineRunId) {
        routineCompletion = completeRoutineLedgerStep({
          routineRunId: preview.routineRunId,
          stepKey: preview.routineStepKey,
          ledgerDefinitionId: definition.id,
          mutation,
          expectedRunRevision: preview.routineRunRevision,
        }, actor);
        if (!routineCompletion?.ok) {
          event("ledger_routine_step_sync_failed",
            "Ledger changed but its routine step needs recovery synchronization.",
            preview, actor, {
              previewId: preview.id,
              mutationId: mutation.id,
              error: routineCompletion?.error ?? "routine_step_sync_failed",
            });
        }
      }
      event("ledger_mutation_committed", "Ledger mutation committed.", preview, actor, {
        ledgerDefinitionId: definition.id,
        previewId: preview.id,
        mutationId: mutation.id,
        action: mutation.action,
        beforeHash: mutation.beforeHash,
        afterHash,
        recoveredAfterRename,
        changedFields: mutation.changedFields,
        routineRunId: mutation.routineRunId,
        routineVersion: mutation.routineVersion,
        sourceArtifactIds: mutation.sourceArtifactIds,
      });
      return {
        status: 200,
        body: {
          preview: publicPreview(preview),
          mutation,
          execution: routineCompletion?.execution ?? null,
          replayed: false,
        },
      };
    } catch (error) {
      event("ledger_mutation_failed", "Ledger mutation failed safely.", preview, actor, {
        previewId: preview.id,
        error: error?.code ?? "ledger_operation_failed",
      });
      return serviceError(error);
    } finally {
      if (lockPath) await unlink(lockPath).catch(() => {});
    }
  }

  function listMutations({ ledgerDefinitionId = null, routineRunId = null } = {}, actor = null) {
    const mutations = state.ledgerMutationAudits.filter((row) =>
      visible(row, actor)
      && actorCanAccessProject(state, actor, row.projectId)
      && (!ledgerDefinitionId || row.ledgerDefinitionId === ledgerDefinitionId)
      && (!routineRunId || row.routineRunId === routineRunId));
    return { status: 200, body: { mutations } };
  }

  return {
    listDefinitions,
    activateDefinition,
    disableDefinition,
    previewUpsert,
    commitPreview,
    listMutations,
  };
}
