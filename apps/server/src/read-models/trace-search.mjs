const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const text = (value) => typeof value === "string" ? value : "";
const lower = (value) => text(value).trim().toLowerCase();

function invocationProjectId(invocation) {
  return invocation?.projectId
    ?? invocation?.options?.metadata?.projectId
    ?? invocation?.input?.metadata?.projectId
    ?? null;
}

function visibleToActor(state, actor, invocation) {
  if (!actor?.teamId) return true;
  const projectId = invocationProjectId(invocation);
  if (projectId) {
    return (state.projects ?? []).find((row) => row.id === projectId)?.ownerTeamId === actor.teamId;
  }
  const requester = (state.users ?? []).find((row) => row.id === invocation?.requestedBy);
  return (requester?.teamId ?? "team_local") === actor.teamId;
}

function relatedIds(rows, invocationId, idField) {
  return rows
    .filter((row) => row?.invocationId === invocationId)
    .map((row) => text(row?.[idField] ?? row?.id))
    .filter(Boolean);
}

export function buildTraceSearchRecord(state, invocation) {
  const metadata = invocation?.options?.metadata ?? {};
  const events = (state.events ?? []).filter((row) => row?.invocationId === invocation.id);
  const evidenceIds = relatedIds(state.evidenceLedger ?? [], invocation.id, "id");
  const applicationIds = [
    text(metadata.applicationId),
    ...(state.applicationResults ?? [])
      .filter((row) => row?.invocationId === invocation.id)
      .map((row) => text(row?.applicationId)),
  ].filter(Boolean);
  const channelIds = relatedIds(state.channelDeliveries ?? [], invocation.id, "channelId");
  const fields = {
    invocationId: text(invocation.id),
    task: text(invocation?.input?.task),
    agentId: text(invocation?.agentId),
    projectId: text(invocationProjectId(invocation)),
    worktreeId: text(invocation?.worktreeId),
    traceId: text(invocation?.traceId),
    status: text(invocation?.status),
    eventTypes: [...new Set(events.map((row) => text(row?.type)).filter(Boolean))],
    eventIds: events.map((row) => text(row?.id)).filter(Boolean),
    evidenceIds: [...new Set(evidenceIds)],
    applicationIds: [...new Set(applicationIds)],
    channelIds: [...new Set(channelIds)],
  };
  return {
    ...fields,
    createdAt: text(invocation?.createdAt),
    searchable: Object.values(fields).flat().map(lower).filter(Boolean),
  };
}

function decodeCursor(cursor, query) {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    return parsed?.query === lower(query) && Number.isSafeInteger(parsed?.offset) && parsed.offset >= 0 ? parsed.offset : 0;
  } catch {
    return 0;
  }
}

function encodeCursor(offset, query) {
  return Buffer.from(JSON.stringify({ offset, query: lower(query) }), "utf8").toString("base64url");
}

export function searchTraceRecords({ state, actor, query = "", cursor = null, limit = DEFAULT_LIMIT }) {
  const terms = lower(query).split(/\s+/).filter(Boolean);
  const cap = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(limit, 10) || DEFAULT_LIMIT));
  const offset = decodeCursor(cursor, query);
  const records = (state.invocations ?? [])
    .filter((invocation) => visibleToActor(state, actor, invocation))
    .map((invocation) => buildTraceSearchRecord(state, invocation))
    .filter((record) => terms.every((term) => record.searchable.some((field) => field.includes(term))))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const page = records.slice(offset, offset + cap).map(({ searchable: _searchable, ...record }) => record);
  return {
    records: page,
    nextCursor: offset + cap < records.length ? encodeCursor(offset + cap, query) : null,
    total: records.length,
  };
}
