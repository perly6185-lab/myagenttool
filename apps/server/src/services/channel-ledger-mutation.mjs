const SINGLE_RECORD_OPERATION_RE = /(?:改成|改为|更新为|替换为|设为|写成|调整为|设置为)/i;
const UNSUPPORTED_OPERATION_RE = /(?:删除|清空|移除|新增|追加|批量|多条|全部|所有|多个文件|多文件)/i;
const FILE_NAME_RE = /\b[^\s，,。；;：:]+\.(?:csv|xlsx?)\b/gi;
const VALUE_TRAILING_RE = /(?:即可|就这样|谢谢|感谢)\s*$/i;
const FIELD_ALIAS_MAP = new Map([
  ["customer", ["客户", "客户名称", "customer"]],
  ["contact", ["联系人", "contact"]],
  ["phone", ["手机", "手机号", "电话", "phone"]],
  ["email", ["邮箱", "邮件", "email"]],
  ["amount", ["金额", "报价", "价格", "amount", "price"]],
  ["quantity", ["数量", "件数", "quantity"]],
  ["status", ["状态", "status"]],
  ["delivery_status", ["发货状态", "物流状态", "delivery_status"]],
  ["payment_status", ["回款状态", "汇款状态", "付款状态", "payment_status"]],
  ["address", ["地址", "收货地址", "address"]],
]);

function clean(value, max = 500) {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, max) : null;
}

function comparable(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function fieldCandidates(definition) {
  const mappings = definition?.fieldMappings;
  if (!mappings || typeof mappings !== "object" || Array.isArray(mappings)) return [];
  return Object.entries(mappings).map(([logical, column]) => {
    const aliases = [
      ...(FIELD_ALIAS_MAP.get(logical) ?? []),
      ...(logical === "inquiry_number" ? ["询价单号", "询价编号", "询价单"] : []),
      ...(logical === "order_number" ? ["订单号", "订单编号", "订单"] : []),
      ...(logical === "quotation_number" ? ["报价单号", "报价编号", "报价单"] : []),
    ];
    return {
      logical,
      column: String(column ?? ""),
      names: [...new Set([logical, column, ...aliases].map(comparable).filter(Boolean))],
    };
  }).sort((left, right) => Math.max(...right.names.map((name) => name.length))
    - Math.max(...left.names.map((name) => name.length)));
}

function resolveField(token, definition) {
  const value = comparable(token);
  if (!value) return null;
  return fieldCandidates(definition).find((candidate) => candidate.names.includes(value)) ?? null;
}

function removeFileMentions(value) {
  return String(value ?? "")
    .replace(FILE_NAME_RE, " ")
    .replace(/(?:文件|表格|工作簿|里的|里面|中|内|记录|这一条|这条)\s*/gi, " ")
    .replace(/(?:把|将)\s*/g, " ")
    .replace(/[“”"'「」]/g, " ")
    .replace(/^[\s,，:：-]+|[\s,，:：-]+$/g, "")
    .trim();
}

function resolveBusinessKey(subject, definition) {
  let value = removeFileMentions(subject);
  const explicit = value.match(/(?:编号|订单号|询价单号|报价单号|单号)\s*[:：#]?\s*([^\s，,。；;]+)/i);
  if (explicit?.[1]) value = explicit[1];
  value = value
    .replace(/(?:的|记录|这一条|这条)\s*$/g, "")
    .replace(/^[\s,，:：-]+|[\s,，:：-]+$/g, "")
    .trim();
  if (!value) return null;
  const tokens = value.split(/\s+/).filter(Boolean);
  return clean(tokens.at(-1), 200);
}

function valueFromTail(value) {
  return clean(String(value ?? "")
    .replace(/^[\s:：=]+/, "")
    .replace(/[。；;]+\s*$/g, "")
    .replace(VALUE_TRAILING_RE, ""), 2_000);
}

/**
 * Parse only the deliberately narrow, single-record update form used by the
 * Channel bridge. Raw values stay in the short-lived Ledger preview; this
 * parser never puts them into the Channel mutation digest/scope contract.
 */
export function parseSingleRecordLedgerMutation(text, definition) {
  const value = clean(text, 4_000);
  if (!value) return { ok: false, reason: "empty_request" };
  if (UNSUPPORTED_OPERATION_RE.test(value)) return { ok: false, reason: "single_record_only" };
  const operation = [...value.matchAll(new RegExp(SINGLE_RECORD_OPERATION_RE.source, "gi"))].at(-1) ?? null;
  if (!operation) return { ok: false, reason: "update_operation_required" };

  const before = value.slice(0, operation.index);
  const after = value.slice(operation.index + operation[0].length);
  const candidates = fieldCandidates(definition);
  let selected = null;
  let selectedIndex = -1;
  let selectedEnd = -1;
  let selectedNameLength = -1;
  for (const candidate of candidates) {
    for (const name of candidate.names) {
      const index = comparable(before).lastIndexOf(name);
      const end = index >= 0 ? index + name.length : -1;
      // Prefer the match that consumes the furthest part of the subject, and
      // then the longest name. Without this, a column such as “跟进状态” is
      // captured as the shorter alias “状态”, leaving “跟进” as the record
      // key and turning a valid update into an accidental insert attempt.
      if (index >= 0 && (end > selectedEnd || (end === selectedEnd && name.length > selectedNameLength))) {
        selected = candidate;
        selectedIndex = index;
        selectedEnd = end;
        selectedNameLength = name.length;
      }
    }
  }
  if (!selected || selectedIndex < 0) return { ok: false, reason: "mutable_field_required" };
  const subject = before.slice(0, selectedIndex);
  const newValue = valueFromTail(after);
  const businessKey = resolveBusinessKey(subject, definition);
  if (!businessKey) return { ok: false, reason: "business_key_required" };
  if (!newValue) return { ok: false, reason: "new_value_required" };
  if (selected.logical === definition?.businessKeyField) {
    return { ok: false, reason: "business_key_immutable" };
  }
  return {
    ok: true,
    operation: "update",
    businessKey,
    field: selected.logical,
    column: selected.column,
    fields: { [selected.logical]: newValue },
  };
}

/**
 * Parse an explicitly scoped multi-change request.  Every clause after the
 * first must identify its file when more than one definition is available;
 * this keeps “multiple files” deterministic for a normal user while rejecting
 * a vague batch request instead of guessing.
 */
export function parseLedgerMutationPlan(text, definitions = []) {
  const clauses = String(text ?? "")
    .split(/[；;]/)
    .map((clause) => clean(clause, 4_000))
    .filter(Boolean);
  if (clauses.length < 2) return { ok: false, reason: "batch_clause_required" };
  const available = Array.isArray(definitions) ? definitions.filter(Boolean) : [];
  if (available.length < 1) return { ok: false, reason: "batch_definitions_required" };
  const operations = [];
  const seen = new Set();
  for (const clause of clauses) {
    const matches = [...clause.matchAll(FILE_NAME_RE)].map((match) => match[0]);
    if (matches.length !== 1) return { ok: false, reason: "batch_file_scope_required" };
    const fileName = matches[0];
    const definition = available.find((candidate) =>
      String(candidate.relativePath ?? "").split(/[\\/]/).at(-1).toLocaleLowerCase()
        === fileName.toLocaleLowerCase());
    if (!definition) return { ok: false, reason: "batch_file_not_bound", fileName };
    const parsed = parseSingleRecordLedgerMutation(
      clause.replace(/(?:批量|多条|多个文件|多文件)/gi, " "),
      definition,
    );
    if (!parsed.ok) return { ok: false, reason: parsed.reason, fileName };
    const key = `${definition.id}:${parsed.businessKey}:${parsed.field}`;
    if (seen.has(key)) return { ok: false, reason: "batch_duplicate_mutation_target", fileName };
    seen.add(key);
    operations.push({ fileName, definition, ...parsed });
  }
  return { ok: true, operations };
}

export function channelLedgerMutationFieldHint(definition) {
  return fieldCandidates(definition)
    .map((candidate) => candidate.logical)
    .slice(0, 20);
}
