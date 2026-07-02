const MAX_IMPORTED_USAGE_ESTIMATES = 1000;

export function createCcusageImportService({
  state,
  now,
  nextId,
  appendEvent,
}) {
  function recordCcusageImportedEstimates({ invocation, result, agent }) {
    if (!isCcusageResult(result)) {
      return [];
    }
    const report = normalizeReportRows(result.output.report);
    if (!report.length) {
      return [];
    }
    const createdAt = now();
    const reportId = String(result.output.reportId ?? "unknown");
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
        projectId: invocation.projectId ?? invocation.input?.metadata?.projectId ?? null,
        worktreeId: invocation.worktreeId ?? invocation.input?.metadata?.worktreeId ?? null,
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
        raw: row,
        createdAt,
      };
    });
    state.importedUsageEstimates.unshift(...records);
    state.importedUsageEstimates = state.importedUsageEstimates.slice(0, MAX_IMPORTED_USAGE_ESTIMATES);
    appendEvent({
      invocationId: invocation.id,
      type: "ccusage_imported_estimates_recorded",
      level: "info",
      message: `Imported ${records.length} ccusage estimate row(s) from ${reportId}.`,
      data: {
        importedUsageEstimateIds: records.map((record) => record.id),
        reportId,
        authoritative: false,
        amountSource: "imported_ccusage_report",
      },
    });
    return records;
  }

  return { recordCcusageImportedEstimates };
}

function isCcusageResult(result) {
  return result?.output?.source === "ccusage" && !result.output.error;
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
    return [report];
  }
  return [];
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
