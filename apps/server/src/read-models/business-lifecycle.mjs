/*
 * Read-only business view over local connector objects.
 *
 * One order is the primary chain, while every surrounding stage is a bounded
 * collection. This is intentional: a quote can be revised, an order can ship
 * in several batches, money can arrive in installments, and support/return
 * cases can recur without overwriting the earlier evidence.
 */

const TRACKED_KINDS = new Set([
  "quotation", "order", "shipment", "receivable", "bank_transaction", "after_sales", "return",
]);

function text(value, max = 200) {
  const result = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return result ? result.slice(0, max) : null;
}

function field(record, ...keys) {
  for (const key of keys) {
    const value = text(record?.fields?.[key]);
    if (value) return value;
  }
  return null;
}

function status(record) {
  return field(record, "status", "delivery_status", "payment_status", "return_status");
}

function number(value) {
  const parsed = Number(String(value ?? "").replace(/[,，￥¥\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function stageName(kind) {
  return {
    quotation: "报价",
    order: "订单",
    shipment: "发货",
    receivable: "应收/回款",
    bank_transaction: "到账流水",
    after_sales: "售后",
    return: "退货",
  }[kind] ?? kind;
}

function sourceName(record, sources) {
  return text(sources.get(record?.sourceId)?.fileName ?? record?.sourceRef, 200);
}

function recordView(record, sources) {
  return {
    id: text(record.id, 200),
    businessKey: text(record.businessKey ?? record.label),
    status: status(record),
    amount: number(field(record, "amount", "return_amount")),
    paidAmount: number(field(record, "paid_amount")),
    quantity: number(field(record, "quantity")),
    source: sourceName(record, sources),
    updatedAt: record.updatedAt ?? record.createdAt ?? null,
  };
}

function makeEntry(record) {
  return {
    projectId: record.projectId,
    orderNumber: field(record, "order_number"),
    customer: field(record, "customer", "company"),
    references: new Set([field(record, "reference")].filter(Boolean)),
    stages: new Map(),
    sources: new Set(),
    warnings: [],
    updatedAt: record.updatedAt ?? record.createdAt ?? null,
  };
}

function hasOrder(entry) { return Boolean(entry.orderNumber); }

function addRecord(entry, record, sources) {
  const rows = entry.stages.get(record.kind) ?? [];
  rows.push(recordView(record, sources));
  entry.stages.set(record.kind, rows);
  const reference = field(record, "reference");
  if (reference) entry.references.add(reference);
  const source = sourceName(record, sources);
  if (source) entry.sources.add(source);
  if (record.updatedAt && String(record.updatedAt) > String(entry.updatedAt ?? "")) entry.updatedAt = record.updatedAt;
}

function customerEntries(entries, customer) {
  return entries.filter((entry) => entry.customer && entry.customer === customer);
}

function findEntry(entries, record) {
  const orderNumber = field(record, "order_number");
  if (orderNumber) return entries.find((entry) => entry.orderNumber === orderNumber) ?? null;
  const reference = field(record, "reference");
  if (reference) {
    const referenced = entries.find((entry) => entry.references.has(reference));
    if (referenced) return referenced;
  }
  const customer = field(record, "customer", "company");
  if (!customer) return null;
  const candidates = customerEntries(entries, customer);
  // A customer-only row is safely attached only when that customer has one
  // order. With multiple orders, guessing would corrupt the business history.
  return candidates.length === 1 ? candidates[0] : null;
}

function ensureEntry(entries, record, sources) {
  let entry = findEntry(entries, record);
  if (!entry && field(record, "order_number")) {
    const customer = field(record, "customer", "company");
    const unbound = customerEntries(entries, customer).filter((candidate) => !candidate.orderNumber);
    if (unbound.length === 1) {
      // A quote/receivable imported before the order can be promoted onto the
      // order once its number arrives. More than one candidate stays separate
      // and visible as ambiguous rather than being guessed together.
      entry = unbound[0];
      entry.orderNumber = field(record, "order_number");
      entry.warnings = entry.warnings.filter((warning) => warning !== "仅有客户信息，无法唯一归属已有订单");
    }
  }
  if (!entry) {
    entry = makeEntry(record);
    const customer = entry.customer;
    if (customer && customerEntries(entries, customer).length > 0 && !entry.orderNumber) {
      entry.warnings.push("仅有客户信息，无法唯一归属已有订单");
    }
    entries.push(entry);
  }
  entry.orderNumber ??= field(record, "order_number");
  entry.customer ??= field(record, "customer", "company");
  addRecord(entry, record, sources);
  return entry;
}

function stageLatest(rows) {
  return [...rows].sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))[0] ?? null;
}

function publicEntry(entry) {
  const stages = Object.fromEntries([...entry.stages.entries()].map(([kind, rows]) => {
    const latest = stageLatest(rows);
    return [kind, {
      label: stageName(kind),
      count: rows.length,
      status: latest?.status ?? null,
      businessKey: latest?.businessKey ?? null,
      source: latest?.source ?? null,
      updatedAt: latest?.updatedAt ?? null,
      records: rows,
    }];
  }));
  const order = stages.order;
  const openAfterSales = (stages.after_sales?.records ?? []).filter((row) => !["已关闭", "已完结", "关闭"].includes(row.status));
  const openReturns = (stages.return?.records ?? []).filter((row) => !["已完成", "已关闭", "已完结", "已退货"].includes(row.status));
  const closed = order?.status === "已完成" && openAfterSales.length === 0 && openReturns.length === 0;
  const all = [...entry.stages.values()].flat();
  const total = (kind) => (stages[kind]?.records ?? []).reduce((sum, row) => sum + (row.amount ?? 0), 0);
  const quantity = (kind) => (stages[kind]?.records ?? []).reduce((sum, row) => sum + (row.quantity ?? 0), 0);
  const paidFromReceivables = (stages.receivable?.records ?? []).reduce((sum, row) => sum + (row.paidAmount ?? 0), 0);
  const collectedFromBank = total("bank_transaction");
  return {
    projectId: entry.projectId,
    orderNumber: entry.orderNumber,
    customer: entry.customer,
    label: entry.orderNumber ?? entry.customer ?? [...entry.references][0] ?? "未命名业务链",
    state: closed ? "closed" : entry.orderNumber ? "active" : "needs_identity",
    stages,
    totals: {
      quotationAmount: total("quotation"),
      orderAmount: total("order"),
      receivableAmount: total("receivable"),
      collectedAmount: collectedFromBank || paidFromReceivables || total("receivable") - (stages.receivable?.records ?? []).filter((row) => row.status !== "已回款").reduce((sum, row) => sum + row.amount, 0),
      returnAmount: total("return"),
      shipmentQuantity: quantity("shipment"),
      returnQuantity: quantity("return"),
    },
    counts: Object.fromEntries([...entry.stages.entries()].map(([kind, rows]) => [kind, rows.length])),
    warnings: [...new Set(entry.warnings)],
    sources: [...entry.sources].sort(),
    updatedAt: all.reduce((latest, row) => String(row.updatedAt ?? "") > String(latest ?? "") ? row.updatedAt : latest, entry.updatedAt),
  };
}

export function businessLifecycleSummaries({ records = [], sources = [], projectId = null, limit = 100 } = {}) {
  const sourceMap = new Map((sources ?? []).map((source) => [source.id, source]));
  const entries = [];
  const rows = (records ?? [])
    .filter((record) => record?.status !== "disabled")
    .filter((record) => TRACKED_KINDS.has(record?.kind))
    .filter((record) => !projectId || record.projectId === projectId)
    .sort((left, right) => String(left.updatedAt ?? "").localeCompare(String(right.updatedAt ?? "")));
  for (const record of rows) ensureEntry(entries, record, sourceMap);
  return entries
    .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))
    .slice(0, Math.max(1, Math.min(500, Number(limit) || 100)))
    .map(publicEntry);
}
