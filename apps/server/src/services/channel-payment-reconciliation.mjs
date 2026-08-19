import { createHash } from "node:crypto";

function text(value, max = 200) {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, max) : null;
}

function key(value) {
  return text(value, 200)?.normalize("NFKC").toLocaleLowerCase() ?? null;
}

function amount(value) {
  const normalized = String(value ?? "").replace(/[\s,，¥￥]/g, "").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function date(value) {
  const normalized = text(value, 40);
  if (!normalized) return null;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : normalized;
}

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function normalizeRow(row, side) {
  const fields = row?.fields ?? {};
  return {
    id: text(row?.id, 200),
    reference: text(fields.reference ?? row?.businessKey ?? row?.label, 200),
    amount: amount(fields.amount),
    date: date(fields.date ?? fields.transaction_date ?? fields.payment_date),
    customer: side === "receivable" ? text(fields.customer ?? fields.name, 200) : null,
  };
}

/**
 * Build a read-only, explainable reconciliation result from already verified
 * local-file objects. No source rows are mutated and no sensitive raw values
 * are copied into the digest or report beyond bounded business fields.
 */
export function buildPaymentReconciliationPreview({ receivables = [], bankTransactions = [], dateToleranceDays = 3 } = {}) {
  const normalizedReceivables = receivables.map((row) => normalizeRow(row, "receivable")).filter((row) => row.reference);
  const normalizedTransactions = bankTransactions.map((row) => normalizeRow(row, "bank_transaction")).filter((row) => row.reference);
  const transactionsByReference = new Map();
  for (const transaction of normalizedTransactions) {
    const bucket = transactionsByReference.get(key(transaction.reference)) ?? [];
    bucket.push(transaction);
    transactionsByReference.set(key(transaction.reference), bucket);
  }
  const matched = [];
  const mismatches = [];
  const consumedTransactions = new Set();
  for (const receivable of normalizedReceivables) {
    const candidates = transactionsByReference.get(key(receivable.reference)) ?? [];
    const available = candidates.filter((candidate) => !consumedTransactions.has(candidate.id));
    const transaction = available[0] ?? null;
    if (!transaction) continue;
    consumedTransactions.add(transaction.id);
    const reasons = [];
    if (receivable.amount == null || transaction.amount == null) reasons.push("金额缺失");
    else if (receivable.amount !== transaction.amount) reasons.push("金额不一致");
    if (receivable.date && transaction.date) {
      const distance = Math.abs(Date.parse(receivable.date) - Date.parse(transaction.date)) / 86_400_000;
      if (Number.isFinite(distance) && distance > dateToleranceDays) reasons.push("日期超出容差");
    }
    const result = {
      receivableId: receivable.id,
      transactionId: transaction.id,
      reference: receivable.reference,
      customer: receivable.customer,
      receivableAmount: receivable.amount,
      transactionAmount: transaction.amount,
      receivableDate: receivable.date,
      transactionDate: transaction.date,
      state: reasons.length ? "mismatch" : "matched",
      reasons,
    };
    if (reasons.length) mismatches.push(result);
    else matched.push(result);
  }
  const matchedReceivableIds = new Set([...matched, ...mismatches].map((row) => row.receivableId));
  const unmatchedReceivables = normalizedReceivables
    .filter((row) => !matchedReceivableIds.has(row.id))
    .map((row) => ({ id: row.id, reference: row.reference, customer: row.customer, amount: row.amount, date: row.date }));
  const unmatchedTransactions = normalizedTransactions
    .filter((row) => !consumedTransactions.has(row.id))
    .map((row) => ({ id: row.id, reference: row.reference, amount: row.amount, date: row.date }));
  const summary = {
    receivableCount: normalizedReceivables.length,
    transactionCount: normalizedTransactions.length,
    matchedCount: matched.length,
    mismatchCount: mismatches.length,
    unmatchedReceivableCount: unmatchedReceivables.length,
    unmatchedTransactionCount: unmatchedTransactions.length,
    differenceCount: mismatches.length + unmatchedReceivables.length + unmatchedTransactions.length,
  };
  const result = {
    schemaVersion: 1,
    mode: "read_only",
    status: summary.differenceCount ? "needs_review" : "ready",
    summary,
    matched,
    mismatches,
    unmatchedReceivables,
    unmatchedTransactions,
  };
  return { ...result, digest: digest(result) };
}
