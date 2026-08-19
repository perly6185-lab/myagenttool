import { createHash } from "node:crypto";

const ACTIVE_STATUSES = new Set(["active", "confirmed", "ready", "enabled", "available", "connected"]);
const INVALID_STATUSES = new Set(["disabled", "inactive", "archived", "revoked", "missing", "deleted", "expired"]);
const CONTACT_ENTITY_TYPES = new Set(["customer"]);
const PUBLISH_WORDS_RE = /(公众号|小红书|抖音|视频号|微博|知乎|网站|博客|发布平台|社媒|社交平台)/i;
const ORDER_RE = /(?:订单|order)\s*(?:号|编号|number|no\.?)?\s*[:：#-]?\s*([a-z0-9][a-z0-9._/-]{2,80})/i;
const FILE_RE = /(?:文件|附件|文档|图片|视频|音频)\s*(?:是|为|叫|名为)?\s*[“"']?([^，,。；;！!？?\s“"']{2,200})/i;
const TARGET_RE = /(?:发给|发送给|发布到|提交给|通知|转给|汇给|付款给)\s*([^，,。；;！!？?]+)/i;
const FINANCIAL_TARGET_RE = /(?:给|转给|汇给|付款给)\s*([^，,。；;！!？?]+?)(?=\s*(?:汇款|付款|支付|金额|[¥￥]?\s*\d)|$)/i;

function bounded(value, max = 300) {
  const text = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

function normalized(value) {
  return bounded(value, 500)?.normalize("NFKC").toLocaleLowerCase() ?? "";
}

function valuesOf(row) {
  const values = [row?.id, row?.label, row?.name, row?.businessKey, row?.relativePath, row?.path];
  for (const value of Object.values(row?.fields ?? {})) values.push(value);
  for (const value of Object.values(row?.metadata ?? {})) values.push(value);
  return values.map(normalized).filter(Boolean);
}

function matches(row, query) {
  const wanted = normalized(query);
  if (!wanted) return true;
  return valuesOf(row).some((value) => value === wanted || value.includes(wanted) || wanted.includes(value));
}

function currentStatus(row) {
  const value = String(row?.status ?? row?.state ?? row?.availability ?? "active").toLowerCase();
  if (INVALID_STATUSES.has(value)) return "stale";
  if (value && !ACTIVE_STATUSES.has(value) && value !== "active") return "stale";
  return "active";
}

function publicMetadata(row, kind) {
  const source = { ...(row?.fields ?? {}), ...(row?.metadata ?? {}) };
  const result = {};
  for (const key of ["email", "phone", "platform", "channel", "currency", "accountName"]) {
    if (source[key] != null) result[key] = bounded(source[key], 160);
  }
  for (const key of ["accountNumber", "number", "iban"]) {
    if (source[key] != null) {
      const raw = String(source[key]).replace(/\s+/g, "");
      result[key] = raw.length > 4 ? `${"*".repeat(Math.min(8, raw.length - 4))}${raw.slice(-4)}` : "****";
    }
  }
  if (source.accountNumberLast4 != null) result.accountNumber = `****${String(source.accountNumberLast4).slice(-4)}`;
  if (kind === "account") delete result.phone;
  return result;
}

function fingerprint(row) {
  return bounded(row?.fingerprint ?? row?.hash ?? row?.version, 200)
    ?? `revision:${Number(row?.revision) || 1}:${bounded(row?.updatedAt, 50) ?? "unknown"}`;
}

function publicObject(kind, row) {
  return {
    kind,
    id: bounded(row?.id, 200),
    label: bounded(row?.label ?? row?.name ?? row?.businessKey ?? row?.relativePath ?? row?.id, 300),
    projectId: bounded(row?.projectId, 200),
    sourceId: bounded(row?.sourceId, 200),
    revision: Number.isInteger(row?.revision) ? row.revision : null,
    fingerprint: fingerprint(row),
    metadata: publicMetadata(row, kind),
  };
}

function entityKind(entity) {
  if (CONTACT_ENTITY_TYPES.has(entity?.entityType)) return "contact";
  if (entity?.entityType === "order") return "order";
  return null;
}

function registryRows(state, kind) {
  return (state?.channelObjectRecords ?? [])
    .filter((row) => row?.kind === kind)
    .map((row) => ({ row, kind }));
}

function businessRows(state, kind) {
  return (state?.businessEntities ?? [])
    .map((row) => ({ row, kind: entityKind(row) }))
    .filter((item) => item.kind === kind);
}

function fileRows(state) {
  return (state?.workflowArtifacts ?? []).map((row) => ({ row, kind: "file" }));
}

function publishRows(state) {
  const configured = (state?.channelObjectRecords ?? [])
    .filter((row) => row?.kind === "publish_target")
    .map((row) => ({ row, kind: "publish_target" }));
  const channels = (state?.channels ?? [])
    .filter((row) => row?.status === "enabled")
    .map((row) => ({
      kind: "publish_target",
      row: {
        ...row,
        label: row.name ?? row.displayName ?? row.provider ?? row.id,
        fields: { platform: row.provider, channel: row.name ?? row.displayName ?? row.id },
        fingerprint: `channel:${row.revision ?? 1}:${row.status}`,
      },
    }));
  return [...configured, ...channels];
}

function rowsFor(state, kind) {
  if (kind === "file") return fileRows(state);
  if (kind === "publish_target") return publishRows(state);
  const registered = registryRows(state, kind);
  const identityKeys = (row) => [
    row?.businessKey, row?.label, row?.fields?.name, row?.fields?.email,
    row?.fields?.phone, row?.fields?.order_number,
  ].map(normalized).filter(Boolean);
  const registeredKeys = new Set(registered.flatMap(({ row }) => identityKeys(row)));
  return [
    ...registered,
    ...businessRows(state, kind).filter(({ row }) =>
      !identityKeys(row).some((key) => registeredKeys.has(key))),
  ];
}

function scopedRows(rows, { projectId, ownerTeamId }) {
  return rows.filter(({ row }) =>
    (row?.ownerTeamId ?? ownerTeamId) === ownerTeamId
    && (!row?.projectId || !projectId || row.projectId === projectId));
}

function resolveRow(kind, query, state, context) {
  const all = rowsFor(state, kind).filter(({ row }) => matches(row, query));
  const scoped = scopedRows(all, context);
  if (!scoped.length && all.length) return { status: "forbidden", candidates: [] };
  const active = scoped.filter(({ row }) => currentStatus(row) === "active");
  const stale = scoped.filter(({ row }) => currentStatus(row) === "stale");
  if (active.length > 1) {
    return { status: "ambiguous", candidates: active.slice(0, 5).map(({ row }) => publicObject(kind, row)) };
  }
  if (active.length === 1) {
    return { status: "verified", object: publicObject(kind, active[0].row), candidates: [] };
  }
  if (stale.length) {
    return { status: "stale", object: publicObject(kind, stale[0].row), candidates: [] };
  }
  return { status: "not_found", candidates: [] };
}

function resolveFileAsset(asset, state, context) {
  if (!asset?.id || asset.projectId !== context.projectId) return { status: "forbidden", candidates: [] };
  if (asset.readiness && asset.readiness.state !== "ready") return { status: "stale", candidates: [] };
  const artifact = (state?.workflowArtifacts ?? []).find((row) =>
    row.id === asset.id || row.id === asset.artifactId || row.relativePath === asset.path);
  if (artifact && (artifact.ownerTeamId ?? context.ownerTeamId) !== context.ownerTeamId) {
    return { status: "forbidden", candidates: [] };
  }
  if (artifact && (artifact.availability === "missing" || artifact.exclusion)) {
    return { status: "stale", object: publicObject("file", artifact), candidates: [] };
  }
  if (artifact && asset.hash && artifact.fingerprint && asset.hash !== artifact.fingerprint) {
    return { status: "stale", object: publicObject("file", artifact), candidates: [] };
  }
  const row = artifact ?? {
    id: asset.id,
    projectId: asset.projectId,
    ownerTeamId: context.ownerTeamId,
    label: asset.originalName ?? asset.name ?? asset.path ?? asset.id,
    name: asset.originalName ?? asset.name,
    relativePath: asset.path,
    family: asset.family,
    hash: asset.hash,
    version: asset.version,
    revision: asset.revision,
  };
  return { status: "verified", object: publicObject("file", row), candidates: [] };
}

function objectRequest(kind, query, required, label) {
  return { kind, query: bounded(query, 300), required, label };
}

export function inferChannelObjectRequests({ text = "", riskLevel = "low", inputAssets = [] } = {}) {
  const value = bounded(text, 4_000) ?? "";
  const requests = [];
  const target = (riskLevel === "financial"
    ? value.match(FINANCIAL_TARGET_RE)?.[1]
    : value.match(TARGET_RE)?.[1])?.trim() ?? null;
  if (["external_communication", "financial"].includes(riskLevel)) {
    if (target) {
      const publish = riskLevel === "external_communication" && PUBLISH_WORDS_RE.test(target);
      requests.push(objectRequest(publish ? "publish_target" : "contact", target, true,
        publish ? "可验证的发布目标" : riskLevel === "financial" ? "可验证的收款方" : "可验证的收件人"));
    }
  }
  const order = value.match(ORDER_RE)?.[1] ?? null;
  if (order) requests.push(objectRequest("order", order, riskLevel !== "low", "可验证的订单"));
  if (riskLevel === "financial") {
    const account = value.match(/(?:付款账户|付款账号|从|使用)\s*([^，,。；;！!？?\s]+)/i)?.[1] ?? null;
    requests.push(objectRequest("account", account, true, "可验证的付款账户"));
  }
  for (const asset of Array.isArray(inputAssets) ? inputAssets.slice(0, 20) : []) {
    requests.push(objectRequest("file", asset?.id ?? asset?.path ?? null, true, "可验证的输入文件"));
  }
  if (!inputAssets.length && /(?:文件|附件|文档|图片|视频|音频)/i.test(value)) {
    requests.push(objectRequest("file", value.match(FILE_RE)?.[1] ?? null, true, "可验证的输入文件"));
  }
  return requests;
}

export function resolveChannelObjectRequests({ state, projectId, ownerTeamId, text, riskLevel, inputAssets = [] } = {}) {
  const context = { projectId, ownerTeamId };
  const requests = inferChannelObjectRequests({ text, riskLevel, inputAssets });
  const results = requests.map((request) => {
    const resolved = request.kind === "file"
      ? (inputAssets.find((asset) => asset?.id === request.query || asset?.path === request.query)
        ? resolveFileAsset(inputAssets.find((asset) => asset?.id === request.query || asset?.path === request.query), state, context)
        : resolveRow("file", request.query, state, context))
      : resolveRow(request.kind, request.query, state, context);
    return { ...request, ...resolved };
  });
  const failures = results.filter((result) => result.status !== "verified");
  const verifiedObjects = results.filter((result) => result.status === "verified").map((result) => result.object);
  const snapshot = verifiedObjects.map((object) => ({
    kind: object.kind,
    id: object.id,
    revision: object.revision,
    fingerprint: object.fingerprint,
  }));
  const stateValue = failures.some((row) => row.status === "ambiguous") ? "ambiguous"
    : failures.some((row) => row.status === "forbidden") ? "forbidden"
      : failures.some((row) => row.status === "stale") ? "stale"
        : failures.length ? "not_found" : "verified";
  const requiredFields = [...new Set(failures.filter((row) => row.required).map((row) => row.label))];
  const digest = createHash("sha256").update(JSON.stringify({ stateValue, snapshot, requiredFields })).digest("hex");
  return {
    schemaVersion: 1,
    state: stateValue,
    requests: results.map((result) => ({
      kind: result.kind,
      query: result.query,
      label: result.label,
      status: result.status,
      object: result.object ?? null,
      candidates: result.candidates ?? [],
    })),
    verifiedObjects,
    snapshot,
    requiredFields,
    digest,
  };
}

export function channelObjectValidationMatches(previous, current) {
  if (!previous || !current || previous.state !== "verified" || current.state !== "verified") return false;
  return JSON.stringify(previous.snapshot ?? []) === JSON.stringify(current.snapshot ?? []);
}

export function channelObjectValidationSummary(validation) {
  return {
    schemaVersion: 1,
    state: validation?.state ?? "not_found",
    verifiedObjects: (validation?.verifiedObjects ?? []).slice(0, 20).map((object) => ({
      kind: object.kind,
      id: object.id,
      label: object.label,
      projectId: object.projectId,
      sourceId: object.sourceId,
      revision: object.revision,
      fingerprint: object.fingerprint,
      metadata: object.metadata,
    })),
    snapshot: (validation?.snapshot ?? []).slice(0, 20),
    requiredFields: (validation?.requiredFields ?? []).slice(0, 10),
    digest: validation?.digest ?? null,
  };
}
