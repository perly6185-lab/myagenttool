import { denyForeignProject } from "../runtime/auth.mjs";

const ALLOWED_FILTERS = new Set([
  "projectId",
  "worktreeId",
  "invocationId",
  "source",
  "severity",
]);
const ALLOWED_SOURCES = new Set(["codex", "claude"]);
const ALLOWED_SEVERITIES = new Set(["low", "medium", "high"]);

export function handleReviewFindingRoutes({
  req,
  res,
  url,
  sendJson,
  state,
  actor,
  publicState,
}) {
  if (req.method !== "GET" || url.pathname !== "/api/review-findings") {
    return false;
  }

  const unknown = [...new Set([...url.searchParams.keys()].filter((key) => !ALLOWED_FILTERS.has(key)))];
  if (unknown.length) {
    sendJson(res, 400, { error: "unknown_field", fields: unknown });
    return true;
  }

  const filters = {
    projectId: queryString(url, "projectId"),
    worktreeId: queryString(url, "worktreeId"),
    invocationId: queryString(url, "invocationId"),
    source: queryString(url, "source"),
    severity: queryString(url, "severity"),
  };

  if (denyForeignProject({
    res,
    sendJson,
    state,
    actor,
    projectId: filters.projectId,
    notFound: { error: "project_not_found" },
  })) {
    return true;
  }

  if (filters.source && !ALLOWED_SOURCES.has(filters.source)) {
    sendJson(res, 400, { error: "invalid_source" });
    return true;
  }

  if (filters.severity && !ALLOWED_SEVERITIES.has(filters.severity)) {
    sendJson(res, 400, { error: "invalid_severity" });
    return true;
  }

  const findings = (publicState(actor).reviewFindings ?? []).filter((finding) =>
    matches(filters.projectId, finding.projectId)
    && matches(filters.worktreeId, finding.worktreeId)
    && matches(filters.invocationId, finding.invocationId)
    && matches(filters.source, finding.source)
    && matches(filters.severity, finding.severity)
  );

  sendJson(res, 200, {
    reviewFindings: findings,
    count: findings.length,
    filters,
  });
  return true;
}

function queryString(url, key) {
  const text = String(url.searchParams.get(key) ?? "").trim();
  return text || null;
}

function matches(expected, actual) {
  return !expected || String(actual ?? "") === expected;
}
