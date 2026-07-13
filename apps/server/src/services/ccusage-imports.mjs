import { isGovernedCcusageAgent } from "./ccusage-agent.mjs";
import { CCUSAGE_APPLICATION_ID } from "./ccusage-application.mjs";

const MAX_IMPORTED_USAGE_ESTIMATES = 1000;
const MAX_IMPORTED_ROWS_PER_REPORT = 1000;
const MAX_RAW_BYTES = 4000;

// The row keys the extractor reads for a token/cost signal — used to tell a
// legitimate single-row summary from an unrecognized wrapper object.
const USAGE_SIGNAL_KEYS = [
  "inputTokens", "input_tokens", "outputTokens", "output_tokens",
  "totalTokens", "total_tokens", "tokens",
  "totalCostUsd", "totalCostUSD", "costUsd", "costUSD", "totalCost", "cost",
];

export function createCcusageImportService({
  state,
  now,
  nextId,
  appendEvent,
  persistStateSoon = () => {},
}) {
  function recordCcusageImportedEstimates({ invocation, result, agent }) {
    // Import estimates whether the report arrived via the bespoke governed
    // ccusage agent (source "ccusage") OR the ccusage Application's wrapper
    // capability (#355 Phase 3 — same ccusage `--json` rows, different transport).
    // Additive: the governed-agent path is unchanged, so nothing regresses.
    const viaGovernedAgent = isGovernedCcusageAgent(agent) && isCcusageResult(result);
    const viaApplication = isCcusageApplicationResult(invocation, result);
    if (!viaGovernedAgent && !viaApplication) {
      return [];
    }
    const allRows = normalizeReportRows(result.output.report);
    const droppedRowCount = Math.max(0, allRows.length - MAX_IMPORTED_ROWS_PER_REPORT);
    const report = allRows.slice(0, MAX_IMPORTED_ROWS_PER_REPORT);
    const createdAt = now();
    const reportId = String(result.output.reportId ?? reportIdFromCapability(invocation) ?? "unknown");
    const filters = plainObjectOrNull(result.output.filters);
    const records = report.map((row, rowIndex) => {
      const provider = stringOrNull(row.provider ?? row.source ?? row.service ?? row.platform);
      const model = stringOrNull(row.model ?? row.modelName ?? row.model_name);
      const estimatedCostUsd = firstFiniteNumber([
        row.totalCostUsd,
        row.totalCostUSD,
        row.costUsd,
        row.costUSD,
        row.totalCost,
        row.cost,
      ]);
      return {
        id: nextId("ccu_demo"),
        source: "ccusage",
        reportInvocationId: invocation.id,
        invocationId: invocation.id,
        projectId: invocation.projectId ?? invocation.options?.metadata?.projectId ?? null,
        worktreeId: invocation.worktreeId ?? invocation.options?.metadata?.worktreeId ?? null,
        requestedBy: invocation.requestedBy ?? null,
        agentId: invocation.agentId ?? null,
        reportAgentName: agent?.name ?? null,
        reportId,
        rowIndex,
        periodStart: stringOrNull(row.periodStart ?? row.startDate ?? row.date ?? row.month ?? row.week),
        periodEnd: stringOrNull(row.periodEnd ?? row.endDate),
        date: stringOrNull(row.date),
        month: stringOrNull(row.month),
        week: stringOrNull(row.week),
        sessionId: stringOrNull(row.sessionId ?? row.session_id ?? row.session),
        provider,
        sourceAgent: stringOrNull(row.agent ?? row.agentName ?? row.sourceAgent ?? row.client),
        model,
        inputTokens: nonNegativeNumber(row.inputTokens ?? row.input_tokens),
        outputTokens: nonNegativeNumber(row.outputTokens ?? row.output_tokens),
        totalTokens: nonNegativeNumber(row.totalTokens ?? row.total_tokens ?? row.tokens),
        estimatedCostUsd,
        currency: String(row.currency ?? result.cost?.currency ?? "USD"),
        amountSource: "imported_ccusage_report",
        economicModel: "external_billed",
        authoritative: false,
        offline: result.output.offline === undefined ? null : Boolean(result.output.offline),
        filters,
        droppedRowCount,
        raw: boundRaw(row),
        createdAt,
      };
    });
    // Idempotent upsert (#882): re-running the same report REPLACES its rows
    // instead of duplicating them (which used to inflate the economics external
    // total on every run, and compound under a schedule). Key on the row's
    // semantic identity, so a re-import supersedes matching rows and a changed
    // value updates in place; a new period just adds.
    const incomingKeys = new Set(records.map(estimateKey));
    state.importedUsageEstimates = state.importedUsageEstimates.filter(
      (existing) => !incomingKeys.has(estimateKey(existing)),
    );
    state.importedUsageEstimates.unshift(...records);
    state.importedUsageEstimates = state.importedUsageEstimates.slice(0, MAX_IMPORTED_USAGE_ESTIMATES);
    // Always emit — a 0-row import (#883) must be distinguishable from "never
    // ran", so an operator can tell a report ran and found nothing apart from a
    // wedged/absent schedule.
    appendEvent({
      invocationId: invocation.id,
      type: "ccusage_imported_estimates_recorded",
      // Warn when the report was truncated so the drop is observable, not silent (#886).
      level: droppedRowCount > 0 ? "warn" : "info",
      message: droppedRowCount > 0
        ? `Imported ${records.length} ccusage estimate row(s) from ${reportId}; dropped ${droppedRowCount} over the ${MAX_IMPORTED_ROWS_PER_REPORT}-row cap.`
        : records.length
          ? `Imported ${records.length} ccusage estimate row(s) from ${reportId}.`
          : `Ran ${reportId} ccusage report — no usage rows to import.`,
      data: {
        importedUsageEstimateIds: records.map((record) => record.id),
        reportId,
        importedRecordCount: records.length,
        authoritative: false,
        amountSource: "imported_ccusage_report",
        droppedRowCount,
        importedAt: createdAt,
      },
    });
    persistStateSoon();
    return records;
  }

  return { recordCcusageImportedEstimates };
}

// Stable identity for one imported estimate, so repeated imports of the same
// report are idempotent. Uses the row's semantic bucket (report + period +
// session + model + provider); falls back to the report + row position only when
// a row carries nothing to identify it, so distinct unidentifiable rows are not
// collapsed.
function estimateKey(record) {
  const identity = [record.periodStart, record.sessionId, record.model, record.provider];
  if (identity.every((part) => part == null || part === "")) {
    return `${record.reportId ?? "unknown"}#idx:${record.rowIndex ?? 0}`;
  }
  return [record.reportId ?? "unknown", ...identity.map((part) => part ?? "")].join("::");
}

function isCcusageResult(result) {
  return result?.output?.source === "ccusage" && !result.output.error;
}

// A ccusage report delivered through the ccusage Application's wrapper capability
// (source "application"). Recognized by the invocation's own application metadata
// — not the result body — so a foreign application cannot spoof a ccusage import.
function isCcusageApplicationResult(invocation, result) {
  const metadata = invocation?.options?.metadata;
  return metadata?.providerType === "application"
    && metadata?.applicationId === CCUSAGE_APPLICATION_ID
    && result?.output?.report != null
    && !result.output?.error;
}

// Derive the report id (daily/weekly/...) from the wrapper capability name
// `app.<slug>.wrapper.<reportId>` when the report came via the application path.
function reportIdFromCapability(invocation) {
  return String(invocation?.options?.metadata?.capability ?? "").match(/\.wrapper\.([a-z0-9._-]+)$/)?.[1] ?? null;
}

function normalizeReportRows(report) {
  if (Array.isArray(report)) {
    return report.filter(isPlainObject);
  }
  if (isPlainObject(report)) {
    for (const key of ["data", "daily", "weekly", "monthly", "sessions", "rows", "items"]) {
      if (Array.isArray(report[key])) {
        return report[key].filter(isPlainObject);
      }
    }
    // No recognized array. Keep the object as one row ONLY if it looks like a
    // usage row (#886) — otherwise drop it rather than store an all-null phantom.
    return looksLikeUsageRow(report) ? [report] : [];
  }
  return [];
}

function looksLikeUsageRow(row) {
  return USAGE_SIGNAL_KEYS.some((key) => row[key] != null);
}

// Bound the raw row before it is persisted to the state snapshot (#886) — a large
// session row would otherwise bloat the file. Small rows pass through unchanged.
function boundRaw(row) {
  const json = JSON.stringify(row);
  if (typeof json !== "string" || json.length <= MAX_RAW_BYTES) return row;
  return { truncated: true, byteLength: json.length, preview: json.slice(0, MAX_RAW_BYTES) };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function plainObjectOrNull(value) {
  return isPlainObject(value) ? value : null;
}

function stringOrNull(value) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function nonNegativeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : null;
}

function firstFiniteNumber(values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return Number(Number(numeric).toFixed(6));
    }
  }
  return null;
}
