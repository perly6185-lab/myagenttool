const DEFAULT_KEEP_LATEST = 20;
const MAX_KEEP_LATEST = 500;
const MAX_ARCHIVE_AFTER_DAYS = 3650;

export function createApplicationResultRetentionService({
  state,
  now,
  appendEvent,
  persistStateSoon,
}) {
  function getApplicationResultRetention(applicationId) {
    const application = findApplication(applicationId);
    if (!application) return null;
    application.resultRetention = normalizeApplicationResultRetention(application.resultRetention);
    return application.resultRetention;
  }

  function updateApplicationResultRetention(applicationId, body = {}, actor = {}) {
    const application = findApplication(applicationId);
    if (!application) return null;
    const timestamp = now();
    const current = normalizeApplicationResultRetention(application.resultRetention);
    const patch = {};
    if (typeof body?.enabled === "boolean") patch.enabled = body.enabled;
    if (Object.prototype.hasOwnProperty.call(body ?? {}, "keepLatest")) patch.keepLatest = body.keepLatest;
    if (Object.prototype.hasOwnProperty.call(body ?? {}, "archiveAfterDays")) patch.archiveAfterDays = body.archiveAfterDays;
    application.resultRetention = normalizeApplicationResultRetention({
      ...current,
      ...patch,
      updatedAt: timestamp,
      updatedBy: stringOrNull(actor?.userId),
    });
    application.updatedAt = timestamp;
    appendEvent({
      invocationId: null,
      type: "application_result_retention_updated",
      level: "info",
      message: `Application result retention updated for ${application.name ?? applicationId}.`,
      data: {
        applicationId,
        retention: publicApplicationResultRetention(application.resultRetention),
      },
    });
    persistStateSoon();
    return application;
  }

  function runApplicationResultRetention(applicationId, actor = {}, options = {}) {
    const application = findApplication(applicationId);
    if (!application) {
      return {
        ok: false,
        status: 404,
        body: { error: "application_not_found" },
      };
    }
    const retention = normalizeApplicationResultRetention(application.resultRetention);
    application.resultRetention = retention;
    const timestamp = now();
    if (!retention.enabled) {
      const summary = retentionRunSummary({
        applicationId,
        retention,
        reason: options.reason ?? "manual",
        invocationId: options.invocationId ?? null,
        archivedRecords: [],
        skippedPinnedCount: allApplicationResultRecords(state, applicationId)
          .filter((item) => publicResultGovernance(item.record).pinned).length,
        status: "disabled",
        executedAt: timestamp,
      });
      application.resultRetention = normalizeApplicationResultRetention({
        ...retention,
        lastRunAt: timestamp,
        lastArchivedCount: 0,
        lastSummary: summary,
      });
      application.updatedAt = timestamp;
      appendRetentionEvent(application, summary);
      persistStateSoon();
      return { ok: true, status: 200, body: { application, retention: application.resultRetention, summary } };
    }

    const decision = retentionCandidates(applicationId, retention, timestamp);
    const archivedRecords = [];
    for (const item of decision.archive) {
      autoArchiveResult(item.record, {
        timestamp,
        actor,
        reason: item.reason,
      });
      archivedRecords.push(item);
    }
    const summary = retentionRunSummary({
      applicationId,
      retention,
      reason: options.reason ?? "manual",
      invocationId: options.invocationId ?? null,
      archivedRecords,
      skippedPinnedCount: decision.skippedPinnedCount,
      status: "executed",
      executedAt: timestamp,
    });
    application.resultRetention = normalizeApplicationResultRetention({
      ...retention,
      lastRunAt: timestamp,
      lastArchivedCount: archivedRecords.length,
      lastSummary: summary,
    });
    application.updatedAt = timestamp;
    appendRetentionEvent(application, summary);
    if (archivedRecords.length > 0) {
      appendEvent({
        invocationId: options.invocationId ?? null,
        type: "application_result_governance_updated",
        level: "info",
        message: `Application result retention archived ${archivedRecords.length} result(s) for ${application.name ?? applicationId}.`,
        data: {
          applicationId,
          archivedResultIds: archivedRecords.map((item) => item.record.id),
          reason: options.reason ?? "manual",
        },
      });
    }
    persistStateSoon();
    return { ok: true, status: 200, body: { application, retention: application.resultRetention, summary } };
  }

  function runApplicationResultRetentionForInvocation(invocation, actor = {}) {
    const metadata = invocation?.options?.metadata ?? {};
    if (invocation?.status !== "succeeded" || !metadata.applicationId) return null;
    const application = findApplication(metadata.applicationId);
    const retention = normalizeApplicationResultRetention(application?.resultRetention);
    if (!retention.enabled) return null;
    return runApplicationResultRetention(metadata.applicationId, actor, {
      reason: "invocation_completed",
      invocationId: invocation.id,
    });
  }

  function findApplication(applicationId) {
    return (state.applications ?? []).find((item) => item.id === applicationId) ?? null;
  }

  function retentionCandidates(applicationId, retention, timestamp) {
    const records = allApplicationResultRecords(state, applicationId)
      .filter((item) => !publicResultGovernance(item.record).archived)
      .sort(compareResultRecordsNewestFirst);
    const archive = [];
    const seen = new Set();
    let skippedPinnedCount = 0;
    const keepLatest = normalizeKeepLatest(retention.keepLatest);
    let activeNonPinnedIndex = 0;
    for (const item of records) {
      const governance = publicResultGovernance(item.record);
      if (governance.pinned) {
        skippedPinnedCount += 1;
        continue;
      }
      activeNonPinnedIndex += 1;
      if (activeNonPinnedIndex > keepLatest) {
        seen.add(item.record.id);
        archive.push({ ...item, reason: "keep_latest" });
      }
    }
    const archiveAfterDays = normalizeArchiveAfterDays(retention.archiveAfterDays);
    if (archiveAfterDays != null) {
      const cutoff = Date.parse(timestamp) - archiveAfterDays * 24 * 60 * 60 * 1000;
      for (const item of records) {
        if (seen.has(item.record.id)) continue;
        const governance = publicResultGovernance(item.record);
        if (governance.pinned) continue;
        const createdAt = resultTimestamp(item.record);
        if (Number.isFinite(createdAt) && createdAt < cutoff) {
          seen.add(item.record.id);
          archive.push({ ...item, reason: "age" });
        }
      }
    }
    return { archive, skippedPinnedCount };
  }

  function appendRetentionEvent(application, summary) {
    appendEvent({
      invocationId: summary.invocationId ?? null,
      type: "application_result_retention_executed",
      level: "info",
      message: summary.status === "disabled"
        ? `Application result retention is disabled for ${application.name ?? application.id}.`
        : `Application result retention executed for ${application.name ?? application.id}; archived ${summary.archivedCount} result(s).`,
      data: summary,
    });
  }

  return {
    getApplicationResultRetention,
    runApplicationResultRetention,
    runApplicationResultRetentionForInvocation,
    updateApplicationResultRetention,
  };
}

export function normalizeApplicationResultRetention(value = {}) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    enabled: input.enabled === true,
    keepLatest: normalizeKeepLatest(input.keepLatest),
    archiveAfterDays: normalizeArchiveAfterDays(input.archiveAfterDays),
    updatedAt: stringOrNull(input.updatedAt),
    updatedBy: stringOrNull(input.updatedBy),
    lastRunAt: stringOrNull(input.lastRunAt),
    lastArchivedCount: normalizeNonNegativeInteger(input.lastArchivedCount, 0, MAX_KEEP_LATEST * 4),
    lastSummary: normalizeRetentionSummary(input.lastSummary),
  };
}

export function publicApplicationResultRetention(value = {}) {
  return normalizeApplicationResultRetention(value);
}

function allApplicationResultRecords(state, applicationId) {
  const renderRecords = (state.applicationRenderResults ?? [])
    .filter((record) => record.applicationId === applicationId)
    .map((record) => ({ record, collection: "applicationRenderResults", resultType: "render" }));
  const artifactRecords = (state.applicationResultArtifacts ?? [])
    .filter((record) => record.applicationId === applicationId)
    .map((record) => ({ record, collection: "applicationResultArtifacts", resultType: "artifact" }));
  return [...renderRecords, ...artifactRecords];
}

function autoArchiveResult(record, { timestamp, actor, reason }) {
  const current = publicResultGovernance(record);
  record.governance = {
    ...current,
    archived: true,
    archivedAt: current.archivedAt ?? timestamp,
    retentionPolicy: "auto_archive",
    note: retentionArchiveNote(reason),
    updatedAt: timestamp,
    updatedBy: stringOrNull(actor?.userId) ?? "system",
  };
  record.updatedAt = timestamp;
}

function retentionRunSummary({
  applicationId,
  retention,
  reason,
  invocationId,
  archivedRecords,
  skippedPinnedCount,
  status,
  executedAt,
}) {
  return {
    applicationId,
    status,
    reason,
    invocationId,
    enabled: retention.enabled,
    keepLatest: retention.keepLatest,
    archiveAfterDays: retention.archiveAfterDays,
    archivedCount: archivedRecords.length,
    archivedResultIds: archivedRecords.map((item) => item.record.id),
    archivedResults: archivedRecords.slice(0, 20).map((item) => ({
      id: item.record.id,
      resultType: item.resultType,
      collection: item.collection,
      reason: item.reason,
      createdAt: item.record.createdAt ?? item.record.generatedAt ?? null,
    })),
    skippedPinnedCount,
    executedAt,
  };
}

function normalizeRetentionSummary(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  if (!input) return null;
  const archivedResultIds = Array.isArray(input.archivedResultIds)
    ? input.archivedResultIds.map(stringOrNull).filter(Boolean).slice(0, 100)
    : [];
  const archivedResults = Array.isArray(input.archivedResults)
    ? input.archivedResults.slice(0, 20).map((item) => {
        const object = item && typeof item === "object" && !Array.isArray(item) ? item : {};
        return {
          id: stringOrNull(object.id),
          resultType: stringOrNull(object.resultType),
          collection: stringOrNull(object.collection),
          reason: stringOrNull(object.reason),
          createdAt: stringOrNull(object.createdAt),
        };
      }).filter((item) => item.id)
    : [];
  return {
    applicationId: stringOrNull(input.applicationId),
    status: stringOrNull(input.status) ?? "executed",
    reason: stringOrNull(input.reason) ?? "manual",
    invocationId: stringOrNull(input.invocationId),
    enabled: input.enabled === true,
    keepLatest: normalizeKeepLatest(input.keepLatest),
    archiveAfterDays: normalizeArchiveAfterDays(input.archiveAfterDays),
    archivedCount: normalizeNonNegativeInteger(input.archivedCount, archivedResultIds.length, MAX_KEEP_LATEST * 4),
    archivedResultIds,
    archivedResults,
    skippedPinnedCount: normalizeNonNegativeInteger(input.skippedPinnedCount, 0, MAX_KEEP_LATEST * 4),
    executedAt: stringOrNull(input.executedAt),
  };
}

function publicResultGovernance(record) {
  const governance = record?.governance && typeof record.governance === "object" && !Array.isArray(record.governance)
    ? record.governance
    : {};
  return {
    pinned: Boolean(governance.pinned),
    archived: Boolean(governance.archived),
    retentionPolicy: stringOrNull(governance.retentionPolicy) ?? "standard",
    note: stringOrNull(governance.note),
    pinnedAt: stringOrNull(governance.pinnedAt),
    archivedAt: stringOrNull(governance.archivedAt),
    updatedAt: stringOrNull(governance.updatedAt),
    updatedBy: stringOrNull(governance.updatedBy),
  };
}

function compareResultRecordsNewestFirst(left, right) {
  const delta = resultTimestamp(right.record) - resultTimestamp(left.record);
  if (delta !== 0) return delta;
  return String(right.record.id).localeCompare(String(left.record.id));
}

function resultTimestamp(record) {
  const timestamp = Date.parse(record.createdAt ?? record.generatedAt ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function retentionArchiveNote(reason) {
  if (reason === "age") return "Auto-archived by Result Center retention policy (age).";
  return "Auto-archived by Result Center retention policy (keep latest).";
}

function normalizeKeepLatest(value) {
  return normalizeNonNegativeInteger(value, DEFAULT_KEEP_LATEST, MAX_KEEP_LATEST);
}

function normalizeArchiveAfterDays(value) {
  if (value == null || value === "") return null;
  return normalizeNonNegativeInteger(value, null, MAX_ARCHIVE_AFTER_DAYS);
}

function normalizeNonNegativeInteger(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 0), max);
}

function stringOrNull(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
