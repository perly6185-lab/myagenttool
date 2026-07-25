/*
 * Typed client for the M0 server API. One unified invocation surface, mirrored
 * from the control-plane gateway: every action goes through `request()` so
 * error wording and the localhost-only API override stay consistent.
 */

import type {
  ApplicationCapability,
  ApplicationInstallPlan,
  ApplicationInstallRun,
  ApplicationOrchestrationRecovery,
  ApplicationOrchestrationRecoveryAgentCandidate,
  ApplicationOrchestrationRun,
  ApplicationOrchestrationRunDetail,
  ApplicationRegisterRequest,
  ApplicationSnapshot,
  ConsoleSnapshot,
  InvocationEventSnapshot,
  KnownApplicationCatalogEntry,
  ProjectTreeResponse,
  ProjectDocumentsResponse,
  RefusalRow,
  ReviewFindingQueryResponse,
  ToolDescriptor,
  ToolInvocationRequest,
  ToolInvocationResponse,
} from "@/lib/console-state";

export interface LoopRefusalsResponse {
  refusals: RefusalRow[];
  scannedRuns: number;
  totalRuns: number;
  truncatedRuns: boolean;
}

export interface InvocationEventsResponse {
  invocationId: string;
  events: InvocationEventSnapshot[];
  nextCursor: string | null;
  hasMore: boolean;
  retentionTruncated: boolean;
}

export interface RefusalSnapshot {
  id: string;
  invocationId?: string;
  at?: string;
  category: string;
  code?: string;
  summary?: string;
  remedy?: string;
  piiRedacted?: boolean;
}

export interface InvocationRefusalsResponse {
  invocationId: string;
  refusals: RefusalSnapshot[];
  truncated: boolean;
}

export interface DispatchQueueItem {
  invocationId: string;
  agentId: string | null;
  agentName: string | null;
  deliveryState: string | null;
  dispatchAttempts: number;
  queuedForMs: number | null;
  blockedReason: string;
}

export interface InvocationDispatchHealthResponse {
  capacity: {
    maxConcurrency: number;
    inFlight: number;
    utilization: number | null;
    atCapacity: boolean;
  };
  queue: {
    depth: number;
    byReason: Record<string, number>;
    items: DispatchQueueItem[];
  };
  stats: {
    sampleSize: number;
    indeterminate: boolean;
    medianMsToDispatch: number | null;
    redeliveryRate: number | null;
    exhaustedCount: number;
  };
  reliability: {
    failover: { attempts: number; recovered: number; exhausted: number; latest: Array<Record<string, unknown>> };
    claims: { active: number; expired: number; nextExpiryAt: string | null };
    intervention: { required: number; items: Array<{ autoRunId: string; invocationId: string | null; reason: string; state: string }> };
  };
}

// The dev server's default port (tools/dev/run-local-demo.mjs SERVER_PORT).
const SERVER_PORT = "5001";
const FALLBACK_API_BASE = `http://127.0.0.1:${SERVER_PORT}`;

export class ApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Resolve the API base. Priority:
 *   1. `?api=<url>` override (any host — LAN / custom setups).
 *   2. Same host the console was loaded from, on the server port — so both
 *      localhost:5000 and <lan-ip>:5000 reach their server with no query param.
 */
export function resolveApiBase(): string {
  if (typeof window === "undefined") return FALLBACK_API_BASE;
  const override = new URLSearchParams(window.location.search).get("api");
  if (override) {
    try {
      return new URL(override).origin;
    } catch {
      /* fall through to the location-derived default */
    }
  }
  const { protocol, hostname } = window.location;
  if (!hostname) return FALLBACK_API_BASE;
  return `${protocol}//${hostname}:${SERVER_PORT}`;
}

export async function openControlPlaneEventStream(
  onEvent: (event: { id: string | null; event: string; data: Record<string, unknown> }) => void,
  signal: AbortSignal,
  lastEventId?: string | null,
): Promise<void> {
  await ensureSession();
  const token = getToken();
  const response = await fetch(`${apiBase}/api/events/stream`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(lastEventId ? { "Last-Event-ID": lastEventId } : {}),
    },
    signal,
  });
  if (response.status === 401) {
    setToken(null);
    throw new ApiError("unauthenticated", "Session expired.", 401);
  }
  if (!response.ok || !response.body) throw new ApiError("stream_unavailable", "Live updates unavailable.", response.status);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (!signal.aborted) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      if (!frame || frame.startsWith(":")) continue;
      let event = "message";
      let id: string | null = null;
      let data = "{}";
      for (const line of frame.split("\n")) {
        if (line.startsWith("id:")) id = line.slice(3).trim();
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) data = line.slice(5).trim();
      }
      onEvent({ id, event, data: JSON.parse(data) as Record<string, unknown> });
    }
  }
}

const apiBase = resolveApiBase();
const REQUEST_TIMEOUT_MS = 15_000;

// --- Identity Phase 2: bearer token (see docs/engineering/IDENTITY_PLAN.md) ---
// The web client carries a token on every call. In local dev there is no
// password yet, so the first request transparently logs in as the seeded user
// (POST /api/session) and stores the token. This is a no-op when the server has
// MYAGENT_REQUIRE_AUTH off, and satisfies the 401 gate when it is on.
const TOKEN_KEY = "myagenttool.token";
const USER_KEY = "myagenttool.user";

export interface SessionUser {
  id: string;
  name?: string;
  teamId?: string;
  role?: "owner" | "admin" | "operator" | "viewer";
}

let memoryToken: string | null = null;
let memoryUser: SessionUser | null = null;
let sessionPromise: Promise<string | null> | null = null;

function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY) ?? memoryToken;
  } catch {
    return memoryToken;
  }
}

function setToken(token: string | null): void {
  memoryToken = token;
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode / storage disabled — memoryToken still holds it this session */
  }
}

function setUser(user: SessionUser | null): void {
  memoryUser = user;
  try {
    if (user) window.localStorage.setItem(USER_KEY, JSON.stringify(user));
    else window.localStorage.removeItem(USER_KEY);
  } catch {
    /* storage disabled — memoryUser still holds it */
  }
}

/** The signed-in user (for display), or null if not logged in yet. */
export function getSessionUser(): SessionUser | null {
  if (memoryUser) return memoryUser;
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    return null;
  }
}

interface SessionResponse {
  token?: string;
  user?: SessionUser;
}

async function postSession(credentials: Record<string, unknown>): Promise<SessionResponse | null> {
  const response = await fetch(`${apiBase}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });
  if (!response.ok) return null;
  return (await response.json().catch(() => ({}))) as SessionResponse;
}

async function login(): Promise<string | null> {
  const data = await postSession({});
  const token = data?.token ?? null;
  if (token) {
    setToken(token);
    setUser(data?.user ?? null);
  }
  return token;
}

/**
 * Sign in as a specific user with a password (9B). Throws on bad credentials so
 * the login form can surface it. On success the token + user are stored and the
 * next state poll reflects the new identity.
 */
export async function loginWithCredentials(userId: string, password: string): Promise<SessionUser | null> {
  const data = await postSession({ userId, password });
  if (!data?.token) {
    throw new Error("Sign in failed — check the user id and password.");
  }
  setToken(data.token);
  setUser(data.user ?? { id: userId });
  return data.user ?? { id: userId };
}

/** Sign out: revoke the token server-side (best effort) and clear local state. */
export async function logout(): Promise<void> {
  const token = getToken();
  if (token) {
    await fetch(`${apiBase}/api/session`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => undefined);
  }
  setToken(null);
  setUser(null);
}

/** Guarantee a token exists, de-duping concurrent first-call logins. */
function ensureSession(): Promise<string | null> {
  const existing = getToken();
  if (existing) return Promise.resolve(existing);
  if (!sessionPromise) sessionPromise = login().finally(() => (sessionPromise = null));
  return sessionPromise;
}

async function request<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  retry = true,
): Promise<T> {
  await ensureSession();
  const token = getToken();
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  // Token rejected/expired: drop it, re-login once, replay the request.
  if (response.status === 401 && retry) {
    setToken(null);
    await ensureSession();
    return request<T>(method, path, body, false);
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const record = data as { message?: string; error?: string };
    throw new ApiError(record.error ?? "request_failed", record.message ?? record.error ?? `${method} ${path} failed.`, response.status);
  }
  return data as T;
}

async function requestBytes(path: string, retry = true): Promise<ArrayBuffer> {
  await ensureSession();
  const token = getToken();
  const response = await fetch(`${apiBase}${path}`, {
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (response.status === 401 && retry) {
    setToken(null);
    await ensureSession();
    return requestBytes(path, false);
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { message?: string; error?: string };
    throw new ApiError(data.error ?? "request_failed", data.message ?? data.error ?? `GET ${path} failed.`, response.status);
  }
  return response.arrayBuffer();
}

async function requestByteRange(path: string, start: number, end: number, retry = true): Promise<{ data: ArrayBuffer; total: number }> {
  await ensureSession();
  const token = getToken();
  const response = await fetch(`${apiBase}${path}`, { method: "GET", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), Range: `bytes=${start}-${end - 1}` } });
  if (response.status === 401 && retry) { setToken(null); await ensureSession(); return requestByteRange(path, start, end, false); }
  if (response.status !== 206) {
    const detail = await response.json().catch(() => ({})) as { message?: string; error?: string };
    throw new ApiError(detail.error ?? "pdf_range_failed", detail.message ?? "PDF server did not honor the byte-range request.", response.status);
  }
  const match = /\/(\d+)$/.exec(response.headers.get("Content-Range") ?? "");
  if (!match) throw new ApiError("invalid_content_range", "PDF byte-range response omitted its total size.", 502);
  return { data: await response.arrayBuffer(), total: Number(match[1]) };
}

export function fetchState(): Promise<ConsoleSnapshot> {
  return request<ConsoleSnapshot>("GET", "/api/state");
}

export interface DiscoveryPayload {
  scope: string[];
  userProvidedPaths?: string[];
  userProvidedEndpoints?: string[];
}

export interface IntegrationPayload {
  targetType: string;
  title: string;
  description: string;
  command?: string;
  baseUrl?: string;
  workingDirectory?: string;
  environmentNeeds?: string;
  cancellation?: string;
  streaming?: boolean;
  costOwner?: string;
  economicModel?: string;
  artifactType?: string;
  reviewState?: string;
  generatedByAi?: boolean;
}

// #1074 (Epic #1070): one block of a persisted run transcript. Payload fields
// (text/input/output) are absent on skeleton blocks (size budget or retention).
export interface RunTranscriptBlock {
  kind: "thinking" | "tool_use" | "tool_result" | "text";
  text?: string;
  input?: string;
  output?: string;
  toolName?: string;
  toolUseId?: string | null;
  description?: string;
  durationMs?: number;
  isError?: boolean;
  truncated?: boolean;
  droppedChars?: number;
  payloadDropped?: boolean;
  chars?: number;
}

export interface RunTranscriptRecord {
  id: string;
  invocationId: string;
  status?: string | null;
  blocks: RunTranscriptBlock[];
  totalChars?: number;
  droppedBlocks: number;
  unparsedLines: number;
  truncated: boolean;
  payloadReaped: boolean;
  reapedAt?: string;
  createdAt: string;
}

export interface ObservabilityDeletionResult {
  deleted: boolean;
  scope: string;
  subjectId: string;
  tier: string;
  invocationCount: number;
  counts: Record<string, number>;
}

// Canvas scenes (#1352 API, surfaced in the Web Canvas by #1354). The list
// returns summaries; the detail carries the full element/file bodies.
export interface CanvasSceneSummary {
  id: string;
  projectId: string | null;
  name: string;
  revision: number;
  elementCount: number;
  fileCount: number;
  createdAt: string;
  updatedAt: string;
  lastModifiedBy: string;
}
export interface CanvasScene extends CanvasSceneSummary {
  elements: unknown[];
  files: Record<string, unknown>;
}
/** A revision-aware save outcome: success, a typed conflict, or another failure. */
export type CanvasSaveResult =
  | { ok: true; scene: CanvasScene }
  | { ok: false; conflict: true; currentRevision: number }
  | { ok: false; conflict: false; error: string };

// Structured variant of `request`: never throws on a non-2xx, so the Canvas save
// path can branch on a 409 revision conflict instead of losing it to an Error.
async function requestResult(
  method: string,
  path: string,
  body?: unknown,
  retry = true,
): Promise<{ status: number; ok: boolean; data: Record<string, unknown> }> {
  await ensureSession();
  const token = getToken();
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 401 && retry) {
    setToken(null);
    await ensureSession();
    return requestResult(method, path, body, false);
  }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, ok: response.ok, data };
}

export const api = {
  updateDevice: (payload: { maxConcurrency?: number }) => request("PATCH", "/api/device", payload),
  reportWebPerformance: (payload: {
    name: "CLS" | "FCP" | "INP" | "LCP";
    value: number;
    rating: "good" | "needs-improvement" | "poor";
    path: string;
    version: string;
  }) => request("POST", "/api/observability/web-performance", payload),
  webPerformanceTrend: (version?: string) =>
    request("GET", `/api/observability/web-performance${version ? `?version=${encodeURIComponent(version)}` : ""}`),
  reportEventStreamReconnect: () =>
    request("POST", "/api/observability/event-stream/reconnect", {}),
  operationalHealth: () =>
    request("GET", "/api/observability/operations"),
  actOnOperationalAlert: (alertId: string, action: "acknowledge" | "silence", silenceMinutes?: number) =>
    request("POST", `/api/observability/operations/alerts/${encodeURIComponent(alertId)}/actions`, { action, silenceMinutes }),
  // ADR 0018: owner/admin-only per-subject observability data deletion. Throws
  // with the server's message on 403 (non-owner) / 400 (invalid request).
  deleteObservabilityData: (payload: { scope: string; subjectId: string; tier: string }) =>
    request<ObservabilityDeletionResult>("POST", "/api/observability/delete", payload),
  fetchInvocationTranscript: (invocationId: string) =>
    request<{ invocationId: string; transcript: RunTranscriptRecord | null }>(
      "GET",
      `/api/invocations/${encodeURIComponent(invocationId)}/transcript`,
    ),
  listTools: () => request<{ tools: ToolDescriptor[] }>("GET", "/api/tools"),
  getTool: (name: string) =>
    request<{ tool: ToolDescriptor }>("GET", `/api/tools/${encodeURIComponent(name)}`),
  createToolInvocation: (name: string, input: ToolInvocationRequest) =>
    request<ToolInvocationResponse>(
      "POST",
      `/api/tools/${encodeURIComponent(name)}/invocations`,
      input,
    ),
  listReviewFindings: (filters: {
    projectId?: string;
    worktreeId?: string;
    invocationId?: string;
    source?: "codex" | "claude";
    severity?: "low" | "medium" | "high";
  } = {}) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) query.set(key, value);
    }
    const suffix = query.toString() ? `?${query}` : "";
    return request<ReviewFindingQueryResponse>("GET", `/api/review-findings${suffix}`);
  },
  listApplicationCapabilities: (id: string) =>
    request<{ applicationId: string; capabilities: ApplicationCapability[] }>(
      "GET",
      `/api/applications/${encodeURIComponent(id)}/capabilities`,
    ),
  /**
   * Run an Application capability as a governed invocation (#800). The body carries
   * only the capability's DECLARED inputs (plus the project it runs in) — the flag
   * and argv each input becomes are decided server-side and never travel from here.
   */
  invokeCapability: (name: string, body: Record<string, string> = {}) =>
    request<{ capability: string; invocationId: string; status: string; agentId?: string }>(
      "POST",
      `/api/capabilities/${encodeURIComponent(name)}/invocations`,
      body,
    ),
  registerApplication: (body: ApplicationRegisterRequest) =>
    request<{ application: ApplicationSnapshot; capabilities: ApplicationCapability[] }>(
      "POST",
      "/api/applications/register",
      body,
    ),
  listKnownApplications: () =>
    request<{ applications: KnownApplicationCatalogEntry[] }>(
      "GET",
      "/api/applications/quick-register/catalog",
    ),
  listKnownRuntimes: () =>
    request<{ runtimes: import("./console-state").RuntimeCatalogEntry[] }>(
      "GET",
      "/api/runtimes/catalog",
    ),
  quickRegisterApplication: (body: { name: string; projectId?: string | null }) =>
    request<{ application: ApplicationSnapshot; capabilities: ApplicationCapability[]; catalog: KnownApplicationCatalogEntry }>(
      "POST",
      "/api/applications/quick-register",
      body,
    ),
  createApplicationInstallPlan: (body: { name: string; projectId?: string | null; deviceId: string }) =>
    request<{ plan: ApplicationInstallPlan }>("POST", "/api/runtimes/install/plan", body),
  queueApplicationInstall: (body: { plan: ApplicationInstallPlan; approvalToken: string }) =>
    request<{ run: ApplicationInstallRun }>("POST", "/api/runtimes/install/runs", body),
  getApplicationInstallRun: (id: string) =>
    request<{ run: ApplicationInstallRun }>("GET", `/api/runtimes/install/runs/${encodeURIComponent(id)}`),
  cancelApplicationInstall: (id: string) =>
    request<{ run: ApplicationInstallRun }>("POST", `/api/runtimes/install/runs/${encodeURIComponent(id)}/cancel`, {}),
  applicationLifecycle: (
    id: string,
    action: "probe" | "online" | "offline" | "archive" | "refresh",
    body: { approvalToken?: string } = {},
  ) => request("POST", `/api/applications/${encodeURIComponent(id)}/${action}`, body),
  /** Mint a single-use, action-scoped approval grant — the real token behind approvalToken (APPROVAL_GRANTS.md). */
  issueApprovalGrant: (action: string, targetId: string) =>
    request<{ grantId: string; token: string; expiresAt: string }>("POST", "/api/approvals/grants", { action, targetId }),
  /** Governed rollback of an applied Claude patch authorization (#914): requires a
   * fresh single-use grant for (rollback_patch, authorizationId). */
  rollbackClaudeApply: (authorizationId: string, approvalToken: string) =>
    request<{ authorizationId: string; status: string; rollbackInvocationId: string }>(
      "POST",
      `/api/claude-apply/authorizations/${encodeURIComponent(authorizationId)}/rollback`,
      { approvalToken },
    ),
  /** Loop promotion refusals (tools/ai), for the console refusal lens (refusal model #758). */
  getLoopRefusals: () => request<LoopRefusalsResponse>("GET", "/api/loop-refusals"),
  getApplicationRecoveryArchive: (id: string, limit = 50) =>
    request<{ applicationId: string; entries: { archivedAt: string | null; row: Record<string, unknown> }[] }>(
      "GET",
      `/api/applications/${encodeURIComponent(id)}/recovery-archive?limit=${encodeURIComponent(limit)}`,
    ),
  setApplicationAutoRecovery: (id: string, body: { enabled?: boolean; maxAttempts?: number; routineId?: string; clearOverride?: boolean; approvalToken?: string }) =>
    request("POST", `/api/applications/${encodeURIComponent(id)}/auto-recovery`, body),
  setApplicationHealthProbe: (id: string, body: { enabled: boolean; intervalMinutes?: number; approvalToken?: string }) =>
    request("POST", `/api/applications/${encodeURIComponent(id)}/health-probe`, body),
  generateApplicationOrchestration: (id: string, body: { approvalToken?: string } = {}) =>
    request("POST", `/api/applications/${encodeURIComponent(id)}/orchestrations/generate`, body),
  runApplicationOrchestration: (
    id: string,
    routineId: string,
    body: { agentId?: string | null; timeoutSeconds?: number; retryOfInvocationId?: string | null; retryReason?: string | null } = {},
  ) =>
    request(
      "POST",
      `/api/applications/${encodeURIComponent(id)}/orchestrations/${encodeURIComponent(routineId)}/run`,
      body,
    ),
  listApplicationOrchestrationRuns: (id: string, routineId: string, limit = 3) =>
    request<{ applicationId: string; routineId: string; runs: ApplicationOrchestrationRun[] }>(
      "GET",
      `/api/applications/${encodeURIComponent(id)}/orchestrations/${encodeURIComponent(routineId)}/runs?limit=${encodeURIComponent(String(limit))}`,
    ),
  getApplicationOrchestrationRun: (id: string, routineId: string, invocationId: string) =>
    request<{ applicationId: string; routineId: string; run: ApplicationOrchestrationRunDetail }>(
      "GET",
      `/api/applications/${encodeURIComponent(id)}/orchestrations/${encodeURIComponent(routineId)}/runs/${encodeURIComponent(invocationId)}`,
    ),
  listApplicationOrchestrationRunEvents: (id: string, routineId: string, invocationId: string) =>
    request<{ applicationId: string; routineId: string; invocationId: string; events: InvocationEventSnapshot[] }>(
      "GET",
      `/api/applications/${encodeURIComponent(id)}/orchestrations/${encodeURIComponent(routineId)}/runs/${encodeURIComponent(invocationId)}/events`,
    ),
  getApplicationOrchestrationRunRecovery: (id: string, routineId: string, invocationId: string) =>
    request<{ applicationId: string; routineId: string; invocationId: string; recovery: ApplicationOrchestrationRecovery }>(
      "GET",
      `/api/applications/${encodeURIComponent(id)}/orchestrations/${encodeURIComponent(routineId)}/runs/${encodeURIComponent(invocationId)}/recovery`,
    ),
  listApplicationOrchestrationRecoveryAgentCandidates: (id: string, routineId: string, invocationId: string) =>
    request<{
      applicationId: string;
      routineId: string;
      invocationId: string;
      recoveryCategory: string;
      sourceAgentId: string | null;
      preferredAgentId: string | null;
      candidates: ApplicationOrchestrationRecoveryAgentCandidate[];
    }>(
      "GET",
      `/api/applications/${encodeURIComponent(id)}/orchestrations/${encodeURIComponent(routineId)}/runs/${encodeURIComponent(invocationId)}/recovery/agent-candidates`,
    ),
  requestApplicationOrchestrationRecoveryAction: (
    id: string,
    routineId: string,
    invocationId: string,
    body: { actionType: string; approvalToken?: string; reason?: string | null; agentId?: string | null } = { actionType: "" },
  ) =>
    request(
      "POST",
      `/api/applications/${encodeURIComponent(id)}/orchestrations/${encodeURIComponent(routineId)}/runs/${encodeURIComponent(invocationId)}/recovery/actions`,
      body,
    ),
  createInvocation: (
    task: string,
    agentId: string | null,
    projectId?: string | null,
    worktreeId?: string | null,
    options?: Record<string, unknown>,
  ) => request("POST", "/api/invocations", { task, agentId, projectId, worktreeId, options }),
  listInvocationEvents: (
    id: string,
    options: { limit?: number; before?: string } = {},
  ) => {
    const query = new URLSearchParams({ limit: String(options.limit ?? 100) });
    if (options.before) query.set("before", options.before);
    return request<InvocationEventsResponse>(
      "GET",
      `/api/invocations/${encodeURIComponent(id)}/events?${query}`,
    );
  },
  // Refusals for one invocation, INCLUDING the ones the 200-row cap evicted to the
  // durable archive (server slice 1/3).
  listInvocationRefusals: (id: string, options: { limit?: number } = {}) => {
    const query = new URLSearchParams({ limit: String(options.limit ?? 200) });
    return request<InvocationRefusalsResponse>(
      "GET",
      `/api/invocations/${encodeURIComponent(id)}/refusals?${query}`,
    );
  },
  uploadWorktreeAttachments: (id: string, files: { name: string; dataBase64: string }[]) =>
    request("POST", `/api/worktrees/${encodeURIComponent(id)}/attachments`, { files }),
  manageOfficeDocument: (id: string, payload: { operation: "rename" | "move" | "copy" | "delete"; source: string; destination?: string }) =>
    request<{ operation: string; source: string; destination?: string }>(
      "POST",
      `/api/worktrees/${encodeURIComponent(id)}/office-document-manage`,
      payload,
    ),
  cancelInvocation: (id: string) =>
    request("POST", `/api/invocations/${encodeURIComponent(id)}/cancel`),
  // #128 Phase 4: run one task on 2+ agents and compare (server fans out + tracks).
  // projectId isolates each agent in its own worktree (P4.2) so diffs can be compared.
  startCompareRun: (task: string, agentIds: string[], projectId?: string | null) =>
    request("POST", "/api/compare-runs", { task, agentIds, projectId: projectId ?? null }),
  // P4.2c: pick the winner, then promote its worktree to a PR.
  setCompareRunPreferred: (id: string, invocationId: string) =>
    request("POST", `/api/compare-runs/${encodeURIComponent(id)}/prefer`, { invocationId }),
  promoteCompareRun: (id: string) =>
    request("POST", `/api/compare-runs/${encodeURIComponent(id)}/promote`),
  troubleshoot: (id: string) =>
    request("POST", `/api/invocations/${encodeURIComponent(id)}/troubleshoot`),

  healthCheckAgent: (id: string) =>
    request("POST", `/api/agents/${encodeURIComponent(id)}/health-check`),
  setAgentEnabled: (id: string, enabled: boolean) =>
    request("POST", `/api/agents/${encodeURIComponent(id)}/${enabled ? "enable" : "disable"}`),

  registerAgent: (payload: Record<string, unknown>) => request("POST", "/api/agents", payload),

  // Pre-flight dry-probe of an unregistered MCP config (#137): queue a bridge
  // handshake + tools/list, then poll the run until it resolves.
  probeAgent: (config: Record<string, unknown>) => request("POST", "/api/agents/probe", config),
  getAgentProbe: (id: string) => request("GET", `/api/agents/probe/${encodeURIComponent(id)}`),

  createDiscovery: (payload: DiscoveryPayload) => request("POST", "/api/discovery", payload),
  registerCandidate: (runId: string, candidateId: string) =>
    request(
      "POST",
      `/api/discovery/${encodeURIComponent(runId)}/candidates/${encodeURIComponent(candidateId)}/register`,
    ),

  createIntegrationArtifact: (payload: IntegrationPayload) =>
    request("POST", "/api/integration-artifacts", payload),
  artifactAction: (id: string, action: string) =>
    request("POST", `/api/integration-artifacts/${encodeURIComponent(id)}/${action}`),
  builderDraft: (payload: IntegrationPayload) =>
    request("POST", "/api/integration-builder/draft", payload),
  updateRetention: (payload: Record<string, number>) =>
    request("PATCH", "/api/integration-retention", payload),
  setBudget: (payload: { projectId: string; limitUsd: number; policy: string }) =>
    request("PUT", "/api/budgets", payload),
  setTeamBudget: (payload: { teamId: string; limitUsd: number; policy: string }) =>
    request("PUT", "/api/budgets", payload),

  createProject: (payload: { name: string; color?: string }) =>
    request("POST", "/api/projects", payload),
  cloneProject: (payload: { repoUrl: string; parentDir: string; name?: string; color?: string }) =>
    request("POST", "/api/projects", payload),
  bindProject: (payload: { repoPath: string; name?: string; color?: string }) =>
    request("POST", "/api/projects", payload),
  updateProject: (id: string, payload: Record<string, unknown>) =>
    request("PATCH", `/api/projects/${encodeURIComponent(id)}`, payload),
  selectProject: (id: string) =>
    request("POST", `/api/projects/${encodeURIComponent(id)}`),
  projectTree: (id: string, opts: { path?: string; search?: string } = {}) => {
    const query = new URLSearchParams();
    if (opts.path) query.set("path", opts.path);
    if (opts.search) query.set("search", opts.search);
    const suffix = query.toString() ? `?${query}` : "";
    return request<ProjectTreeResponse>("GET", `/api/projects/${encodeURIComponent(id)}/tree${suffix}`);
  },
  projectDocuments: (id: string, opts: { type?: "all" | "docx" | "xlsx" | "pptx" | "pdf" | "dxf" | "dwg"; search?: string; limit?: number; worktreeId?: string } = {}) => {
    const query = new URLSearchParams();
    if (opts.type && opts.type !== "all") query.set("type", opts.type);
    if (opts.search) query.set("q", opts.search);
    if (opts.limit) query.set("limit", String(opts.limit));
    if (opts.worktreeId) query.set("worktree", opts.worktreeId);
    const suffix = query.toString() ? `?${query}` : "";
    return request<ProjectDocumentsResponse>("GET", `/api/projects/${encodeURIComponent(id)}/documents${suffix}`);
  },
  projectPdfData: (id: string, path: string, worktreeId?: string) =>
    requestBytes(`/api/projects/${encodeURIComponent(id)}/pdf-document?path=${encodeURIComponent(path)}${worktreeId ? `&worktree=${encodeURIComponent(worktreeId)}` : ""}`),
  projectPdfSource: async (id: string, path: string, worktreeId?: string) => {
    await ensureSession();
    const token = getToken();
    const resource = `/api/projects/${encodeURIComponent(id)}/pdf-document?path=${encodeURIComponent(path)}${worktreeId ? `&worktree=${encodeURIComponent(worktreeId)}` : ""}`;
    return { url: `${apiBase}${resource}`, httpHeaders: token ? { Authorization: `Bearer ${token}` } : undefined };
  },
  projectPdfRange: (id: string, path: string, start: number, end: number, worktreeId?: string) =>
    requestByteRange(`/api/projects/${encodeURIComponent(id)}/pdf-document?path=${encodeURIComponent(path)}${worktreeId ? `&worktree=${encodeURIComponent(worktreeId)}` : ""}`, start, end),
  cadDocumentInfo: (id: string, path: string, worktreeId?: string) =>
    request<{ path: string; size: number; version: string; units: number; extents: { min: number[]; max: number[] } | null; layouts: string[]; layers: string[]; entityCounts: Record<string, number>; texts: Array<{ text: string; type: string; layer: string }>; warnings: string[]; audit: { errors: number; fixes: number } }>(
      "GET",
      `/api/projects/${encodeURIComponent(id)}/cad-document?path=${encodeURIComponent(path)}${worktreeId ? `&worktree=${encodeURIComponent(worktreeId)}` : ""}`,
    ),
  cadDocumentLayout: (id: string, path: string, layout: string, layers: string[], worktreeId?: string) => {
    const query = new URLSearchParams({ path, layout, layersMode: "selected" });
    if (worktreeId) query.set("worktree", worktreeId);
    for (const layer of layers) query.append("layers", layer);
    return request<{ path: string; size: number; svg: string }>("GET", `/api/projects/${encodeURIComponent(id)}/cad-document/layout?${query}`);
  },
  // Content search within a registered project root (Agent Workspace #161).
  projectSearch: (id: string, q: string) =>
    request<{ results: { path: string; line: number; preview: string }[] }>(
      "GET",
      `/api/projects/${encodeURIComponent(id)}/search?q=${encodeURIComponent(q)}`,
    ),
  createWorktree: (
    projectId: string,
    payload: {
      name?: string;
      ref?: string;
      prNumber?: number;
      agentId?: string;
      startPoint?: string;
      link?: { type: "issue" | "pr"; number: number; title: string; url: string | null; state: string };
    },
  ) =>
    request("POST", `/api/projects/${encodeURIComponent(projectId)}/worktrees`, payload),
  // One-click Auto: materialize a worktree from the issue and start an
  // issue-seeded agent run in it. Merge stays human.
  startAutoRun: (
    projectId: string,
    payload: {
      link: { type: "issue" | "pr"; number: number; title: string; url: string | null; state: string };
      agentId?: string;
      name?: string;
      baseBranch?: string;
    },
  ) => request("POST", `/api/projects/${encodeURIComponent(projectId)}/auto-runs`, payload),
  // Creates a platform-managed bare repo and points the project's origin at it —
  // somewhere to push, with no account anywhere (#1210).
  createLocalOrigin: (projectId: string) =>
    request("POST", `/api/projects/${encodeURIComponent(projectId)}/local-origin`),
  removeWorktree: (id: string) => request("DELETE", `/api/worktrees/${encodeURIComponent(id)}`),
  // `path` lists one directory (the route's ?path=); omitted, it lists the root.
  // The tree loads a level at a time — a worktree is too big to walk eagerly.
  listWorktreeFiles: (id: string, path?: string) =>
    request(
      "GET",
      `/api/worktrees/${encodeURIComponent(id)}/files${path ? `?path=${encodeURIComponent(path)}` : ""}`,
    ),
  searchWorktree: (id: string, q: string, mode: "name" | "content") =>
    request("GET", `/api/worktrees/${encodeURIComponent(id)}/search?mode=${mode}&q=${encodeURIComponent(q)}`),
  readWorktreeFile: (id: string, filePath: string) =>
    request("GET", `/api/worktrees/${encodeURIComponent(id)}/file?path=${encodeURIComponent(filePath)}`),
  // OfficeCLI preview (P2b): render a project .docx/.xlsx/.pptx to self-contained
  // HTML, server-side and read-only. Full-fidelity (no 20k cap), never persisted.
  officecliPreview: (projectId: string, filePath: string, worktreeId?: string) =>
    request<{ path: string; content: string; mime: string; encoding: string; bytes: number }>(
      "GET",
      `/api/projects/${encodeURIComponent(projectId)}/officecli-preview?path=${encodeURIComponent(filePath)}${worktreeId ? `&worktree=${encodeURIComponent(worktreeId)}` : ""}`,
    ),
  // A .docx's body paragraphs (path-addressed) for the block editor: each carries
  // its server-computed markdown projection (`md`, heading + inline bold/italic).
  officecliDocOutline: (projectId: string, filePath: string, worktreeId?: string) =>
    request<{ path: string; paragraphs: { path: string; type: string; text: string; style: string | null; md: string; complex?: boolean }[] }>(
      "GET",
      `/api/projects/${encodeURIComponent(projectId)}/officecli-doc-outline?path=${encodeURIComponent(filePath)}${worktreeId ? `&worktree=${encodeURIComponent(worktreeId)}` : ""}`,
    ),
  // L1 block editing: given the edited block list (block editor) OR whole-document
  // markdown text (textarea mode, re-aligned to paraIds server-side), the server
  // re-reads the current .docx outline and returns the batch item list for one
  // governed `apply.batch`.
  officecliBlockOps: (
    projectId: string,
    payload:
      | { file: string; worktree: string; blocks: { path: string | null; md: string }[] }
      | { file: string; worktree: string; text: string },
  ) =>
    request<{ commands: Record<string, unknown>[] }>(
      "POST",
      `/api/projects/${encodeURIComponent(projectId)}/officecli-block-ops`,
      payload,
    ),
  // xlsx grid: read a worksheet as a cell grid (each cell carries `edit` = its
  // editable text, a formula shown as `=…`).
  officecliSheet: (projectId: string, filePath: string, worktreeId?: string, sheet?: string) =>
    request<{
      path: string;
      sheet: string;
      sheets: string[];
      maxRow: number;
      maxCol: number;
      cells: Record<string, { text: string; formula: string | null; type: string | null; edit: string }>;
    }>(
      "GET",
      `/api/projects/${encodeURIComponent(projectId)}/officecli-sheet?path=${encodeURIComponent(filePath)}${worktreeId ? `&worktree=${encodeURIComponent(worktreeId)}` : ""}${sheet ? `&sheet=${encodeURIComponent(sheet)}` : ""}`,
    ),
  // Given the edited cell map, the server re-reads the sheet and returns the batch
  // item list for one governed `apply.batch`.
  officecliSheetOps: (
    projectId: string,
    payload: { file: string; worktree: string; sheet?: string; cells: Record<string, string> },
  ) =>
    request<{ commands: Record<string, unknown>[]; sheet: string }>(
      "POST",
      `/api/projects/${encodeURIComponent(projectId)}/officecli-sheet-ops`,
      payload,
    ),
  // pptx deck: read slides + shapes (text shapes are `editable`).
  officecliDeck: (projectId: string, filePath: string, worktreeId?: string) =>
    request<{
      path: string;
      slides: { path: string; shapes: { path: string; type: string; text: string; editable: boolean }[] }[];
    }>(
      "GET",
      `/api/projects/${encodeURIComponent(projectId)}/officecli-deck?path=${encodeURIComponent(filePath)}${worktreeId ? `&worktree=${encodeURIComponent(worktreeId)}` : ""}`,
    ),
  // Given the edited shape-text map, the server re-reads the deck and returns the
  // batch item list for one governed `apply.batch`.
  officecliDeckOps: (
    projectId: string,
    payload: { file: string; worktree: string; shapes: Record<string, string> },
  ) =>
    request<{ commands: Record<string, unknown>[] }>(
      "POST",
      `/api/projects/${encodeURIComponent(projectId)}/officecli-deck-ops`,
      payload,
    ),
  worktreeGit: (id: string) => request("GET", `/api/worktrees/${encodeURIComponent(id)}/git`),
  worktreeDiff: (id: string) => request("GET", `/api/worktrees/${encodeURIComponent(id)}/diff`),
  reviewWorktree: (id: string, payload: { verdict: "approved" | "changes_requested"; summary?: string; comments?: { path: string | null; body: string }[] }) =>
    request("POST", `/api/worktrees/${encodeURIComponent(id)}/review`, payload),
  publishWorktreeBranch: (id: string) => request("POST", `/api/worktrees/${encodeURIComponent(id)}/push`),
  createWorktreePr: (id: string, payload: { title: string; body: string }) =>
    request("POST", `/api/worktrees/${encodeURIComponent(id)}/pr`, payload),
  listGithubItems: (projectId: string) =>
    request("GET", `/api/projects/${encodeURIComponent(projectId)}/github`),
  listWorkItems: (query: {
    projectId?: string; planningProjectId?: string; status?: string; type?: string; q?: string;
    limit?: string; cursor?: string; updatedSince?: string;
  } = {}) => {
    const params = new URLSearchParams(Object.entries(query).filter(([, value]) => Boolean(value)) as [string, string][]);
    return request("GET", `/api/work-items${params.size ? `?${params}` : ""}`);
  },
  listWorkItemAttention: (query: {
    projectId?: string; kind?: string; severity?: string; sla?: string;
    handler?: "mine" | "unclaimed"; includeResolved?: "1";
    limit?: string; cursor?: string; updatedSince?: string;
  } = {}) => {
    const params = new URLSearchParams(Object.entries(query).filter(([, value]) => Boolean(value)) as [string, string][]);
    return request("GET", `/api/work-items/attention${params.size ? `?${params}` : ""}`);
  },
  updateWorkItemAttention: (
    attentionIds: string[],
    action: "claim" | "renew" | "release" | "resolve" | "reopen",
    note = "",
    options: { leaseSeconds?: number; idempotencyKey?: string } = {},
  ) => request("POST", "/api/work-items/attention/actions", { attentionIds, action, note, ...options }),
  getWorkItemGithubDiagnostics: () =>
    request("GET", "/api/work-items/github/diagnostics"),
  replayWorkItemGithubDelivery: (deliveryId: string) =>
    request("POST", `/api/work-items/github/deliveries/${encodeURIComponent(deliveryId)}/replay`),
  createWorkItem: (payload: {
    projectId: string;
    title: string;
    body?: string;
    type?: "task" | "bug" | "feature" | "initiative";
    priority?: "p0" | "p1" | "p2" | "p3";
    labels?: string[];
    acceptanceCriteria?: string[];
    dueDate?: string | null;
    milestone?: string;
    estimatePoints?: number;
    parentId?: string | null;
    idempotencyKey?: string;
  }) => request("POST", "/api/work-items", payload),
  getWorkItem: (id: string) => request("GET", `/api/work-items/${encodeURIComponent(id)}`),
  suggestWorkItemDraft: (payload: { projectId: string; title: string; body?: string }) =>
    request("POST", "/api/work-items/assist/draft", payload),
  updateWorkItem: (id: string, payload: Record<string, unknown>) =>
    request("PATCH", `/api/work-items/${encodeURIComponent(id)}`, payload),
  claimWorkItem: (id: string, payload: { agentId?: string; leaseMinutes?: number; idempotencyKey?: string } = {}) =>
    request("POST", `/api/work-items/${encodeURIComponent(id)}/claim`, payload),
  releaseWorkItemClaim: (id: string, idempotencyKey?: string) =>
    request("POST", `/api/work-items/${encodeURIComponent(id)}/release-claim`, { idempotencyKey }),
  bindWorkItemGithubIssue: (id: string, payload: Record<string, unknown>) =>
    request("POST", `/api/work-items/${encodeURIComponent(id)}/github/link`, payload),
  listWorkItemExternalProviders: () =>
    request("GET", "/api/work-items/providers"),
  bindWorkItemExternalIssue: (id: string, payload: Record<string, unknown>) =>
    request("POST", `/api/work-items/${encodeURIComponent(id)}/external-bindings`, payload),
  syncWorkItemExternalIssue: (id: string, provider: string, payload: Record<string, unknown>) =>
    request("POST", `/api/work-items/${encodeURIComponent(id)}/external-bindings/${encodeURIComponent(provider)}/sync`, payload),
  syncWorkItemGithubIssue: (id: string, payload: Record<string, unknown>) =>
    request("POST", `/api/work-items/${encodeURIComponent(id)}/github/sync`, payload),
  recordWorkItemVerification: (id: string, payload: Record<string, unknown>) =>
    request("POST", `/api/work-items/${encodeURIComponent(id)}/verifications`, payload),
  bulkUpdateWorkItems: (payload: {
    items: { id: string; expectedRevision: number }[];
    changes: Record<string, unknown>;
  }) => request("PATCH", "/api/work-items/bulk", payload),
  transitionWorkItem: (id: string, action: "close" | "reopen" | "archive" | "restore", expectedRevision: number) =>
    request("POST", `/api/work-items/${encodeURIComponent(id)}/${action}`, { expectedRevision }),
  listWorkItemComments: (id: string) =>
    request("GET", `/api/work-items/${encodeURIComponent(id)}/comments`),
  createWorkItemComment: (id: string, body: string) =>
    request("POST", `/api/work-items/${encodeURIComponent(id)}/comments`, { body }),
  updateWorkItemComment: (workItemId: string, commentId: string, payload: { expectedRevision: number; body: string }) =>
    request("PATCH", `/api/work-items/${encodeURIComponent(workItemId)}/comments/${encodeURIComponent(commentId)}`, payload),
  deleteWorkItemComment: (workItemId: string, commentId: string, expectedRevision: number) =>
    request("DELETE", `/api/work-items/${encodeURIComponent(workItemId)}/comments/${encodeURIComponent(commentId)}`, { expectedRevision }),
  listWorkItemActivity: (id: string) =>
    request("GET", `/api/work-items/${encodeURIComponent(id)}/activity`),
  createWorkItemWorktree: (id: string, payload: { agentId?: string; baseBranch?: string } = {}) =>
    request("POST", `/api/work-items/${encodeURIComponent(id)}/worktrees`, payload),
  startWorkItemAutoRun: (id: string, payload: { agentId?: string; baseBranch?: string } = {}) =>
    request("POST", `/api/work-items/${encodeURIComponent(id)}/auto-runs`, payload),
  retryWorkItemAlert: (workItemId: string, alertId: string) =>
    request("POST", `/api/work-items/${encodeURIComponent(workItemId)}/alerts/${encodeURIComponent(alertId)}/retry`),
  listPlanningProjects: (
    input: boolean | { includeArchived?: boolean; limit?: string; cursor?: string; updatedSince?: string } = false,
  ) => {
    const query = typeof input === "boolean" ? { includeArchived: input } : input;
    const params = new URLSearchParams();
    if (query.includeArchived) params.set("includeArchived", "1");
    if (query.limit) params.set("limit", query.limit);
    if (query.cursor) params.set("cursor", query.cursor);
    if (query.updatedSince) params.set("updatedSince", query.updatedSince);
    return request("GET", `/api/planning-projects${params.size ? `?${params}` : ""}`);
  },
  getPlanningProject: (id: string) =>
    request("GET", `/api/planning-projects/${encodeURIComponent(id)}`),
  createPlanningProject: (payload: {
    name: string;
    description?: string;
    color?: string;
    capacityPoints?: number;
    startDate?: string | null;
    targetDate?: string | null;
    ownerId?: string | null;
    status?: "planned" | "active" | "on_hold" | "completed";
    tags?: string[];
    statusSummary?: string;
    pinned?: boolean;
    watching?: boolean;
    templateProjectId?: string;
    savedViews?: unknown[];
    automationRules?: unknown[];
    autonomyProfile?: "cautious" | "standard" | "high";
  }) =>
    request("POST", "/api/planning-projects", payload),
  updatePlanningProject: (id: string, payload: Record<string, unknown>) =>
    request("PATCH", `/api/planning-projects/${encodeURIComponent(id)}`, payload),
  setPlanningProjectArchived: (id: string, expectedRevision: number, archived: boolean) =>
    request("POST", `/api/planning-projects/${encodeURIComponent(id)}/${archived ? "archive" : "restore"}`, { expectedRevision }),
  addPlanningProjectItem: (planningProjectId: string, workItemId: string) =>
    request("PUT", `/api/planning-projects/${encodeURIComponent(planningProjectId)}/items/${encodeURIComponent(workItemId)}`),
  removePlanningProjectItem: (planningProjectId: string, workItemId: string) =>
    request("DELETE", `/api/planning-projects/${encodeURIComponent(planningProjectId)}/items/${encodeURIComponent(workItemId)}`),
  reorderPlanningProjectItems: (planningProjectId: string, expectedRevision: number, workItemIds: string[]) =>
    request("PUT", `/api/planning-projects/${encodeURIComponent(planningProjectId)}/items`, { expectedRevision, workItemIds }),
  updatePlanningProjectItems: (planningProjectId: string, addWorkItemIds: string[], removeWorkItemIds: string[]) =>
    request("PATCH", `/api/planning-projects/${encodeURIComponent(planningProjectId)}/items`, { addWorkItemIds, removeWorkItemIds }),
  suggestPlanningProjectPlan: (planningProjectId: string) =>
    request("POST", `/api/planning-projects/${encodeURIComponent(planningProjectId)}/assist/plan`, {}),
  executePlanningRecommendedAction: (planningProjectId: string, code: string, payload: Record<string, unknown>) =>
    request("POST", `/api/planning-projects/${encodeURIComponent(planningProjectId)}/recommended-actions/${encodeURIComponent(code)}/execute`, payload),
  decidePlanningRecommendedAction: (
    planningProjectId: string,
    approvalRequestId: string,
    decision: "approve" | "deny",
    payload: { confirmed: boolean; note: string },
  ) => request("POST", `/api/planning-projects/${encodeURIComponent(planningProjectId)}/recommended-action-approvals/${encodeURIComponent(approvalRequestId)}/${decision}`, payload),
  // #1143 issue claims: take/hand back an issue's develop lease. A foreign
  // active develop claim answers 409 with the blocking claim.
  claimIssue: (projectId: string, payload: { issueNumber: number; mode?: "develop" | "review" }) =>
    request("POST", `/api/projects/${encodeURIComponent(projectId)}/issue-claims`, payload),
  releaseIssueClaim: (claimId: string) =>
    request("POST", `/api/issue-claims/${encodeURIComponent(claimId)}/release`),
  // #1151 decision soft-claims: advisory "I'm handling this" on an Approvals row.
  claimDecision: (decisionId: string) =>
    request("POST", `/api/pending-decisions/${encodeURIComponent(decisionId)}/claim`),
  releaseDecisionClaim: (decisionId: string) =>
    request("POST", `/api/pending-decisions/${encodeURIComponent(decisionId)}/release`),
  // Auto-run observability: the records plus an evaluation summary. refresh=true
  // also refreshes PR dispositions (bounded gh reads) for the routing evaluation.
  listAutoRuns: (refresh = false) => request("GET", `/api/auto-runs${refresh ? "?refresh=1" : ""}`),
  recordAutoRunRoutingOverride: (id: string, actualPath: string, reason: string, expectedRevision = 0) =>
    request("POST", `/api/auto-runs/${encodeURIComponent(id)}/routing-override`, {
      actualPath,
      reason,
      expectedRevision,
      idempotencyKey: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    }),
  // U1: can this project run an auto-run, and what's missing?
  autoRunReadiness: (projectId: string) => request("GET", `/api/projects/${encodeURIComponent(projectId)}/auto-run-readiness`),
  // Retry a failed/blocked auto-run on its existing worktree.
  retryAutoRun: (id: string) => request("POST", `/api/auto-runs/${encodeURIComponent(id)}/retry`),
  cancelAutoRun: (id: string) => request("POST", `/api/auto-runs/${encodeURIComponent(id)}/cancel`),
  // Human-triggered PR merge for a pr_open auto-run (merge stays human — a person
  // clicks Merge in the console; runs `gh pr merge` server-side).
  mergeAutoRunPr: (id: string) => request("POST", `/api/auto-runs/${encodeURIComponent(id)}/merge`),
  // Scheduled work-report → channel push: edit the config, or post immediately.
  setReportSchedule: (patch: Record<string, unknown>) => request("PUT", "/api/report-schedule", patch),
  postReportNow: () => request("POST", "/api/report-schedule/post-now"),
  // D4: the human design gate — approve spawns the implementation child issue.
  designApproval: (id: string, action: "approve" | "reject", feedback?: string) =>
    request("POST", `/api/auto-runs/${encodeURIComponent(id)}/design-approval`, { action, feedback }),
  // E3: answer a clarify run's questions (posted back to the issue).
  answerClarify: (id: string, answers: string) =>
    request("POST", `/api/auto-runs/${encodeURIComponent(id)}/clarify-answer`, { answers }),
  // Epic S3: the human decomposition gate — approve spawns the N governed child issues.
  decompositionApproval: (id: string, action: "approve" | "reject", feedback?: string) =>
    request("POST", `/api/auto-runs/${encodeURIComponent(id)}/decomposition-approval`, { action, feedback }),
  // Scheduled real-agent eval trend (#248): read-only view of the local
  // trend.jsonl so capability regressions surface in the console, not just cron.log.
  listEvalTrend: () => request("GET", "/api/eval-trend"),
  maturity: () => request("GET", "/api/maturity"),
  dora: () => request("GET", "/api/dora"),
  dispatchEvaluation: () => request("GET", "/api/dispatch-evaluation"),
  getInvocationDispatchHealth: () => request<InvocationDispatchHealthResponse>("GET", "/api/invocation-dispatch-health"),
  loopRoutineRuns: () => request("GET", "/api/loop-routines"),
  loopRoutineFindings: (runId: string) => request("GET", `/api/loop-routines/${encodeURIComponent(runId)}/findings`),
  // Auto-run effective configuration (safe knobs overlaid on env + per-command
  // configured flags; never the argv). Edits apply on the next server start.
  getAutoRunConfig: () => request("GET", "/api/auto-run-config"),
  updateAutoRunSettings: (patch: Record<string, unknown>) => request("PUT", "/api/auto-run-settings", patch),
  updateTeamAlertWebhook: (teamId: string, alertWebhookUrl: string | null) =>
    request("PATCH", `/api/teams/${encodeURIComponent(teamId)}/alert-webhook`, { alertWebhookUrl }),
  listBranches: (projectId: string) =>
    request("GET", `/api/projects/${encodeURIComponent(projectId)}/branches`),
  gitSummary: (projectId: string) =>
    request("GET", `/api/projects/${encodeURIComponent(projectId)}/git-summary`),
  suggestWorktreeName: (description: string) =>
    request("POST", "/api/worktree-name-suggestion", { description }),

  createAutomation: (payload: Record<string, unknown>) => request("POST", "/api/automations", payload),
  runAutomation: (id: string) => request("POST", `/api/automations/${encodeURIComponent(id)}/run`),
  updateAutomation: (id: string, patch: Record<string, unknown>) =>
    request("PATCH", `/api/automations/${encodeURIComponent(id)}`, patch),
  deleteAutomation: (id: string) => request("DELETE", `/api/automations/${encodeURIComponent(id)}`),

  createAgentSkill: (payload: Record<string, unknown>) => request("POST", "/api/agent-skills", payload),
  updateAgentSkill: (id: string, patch: Record<string, unknown>) =>
    request("PATCH", `/api/agent-skills/${encodeURIComponent(id)}`, patch),
  deleteAgentSkill: (id: string) => request("DELETE", `/api/agent-skills/${encodeURIComponent(id)}`),

  approveApproval: (id: string) =>
    request("POST", `/api/approvals/${encodeURIComponent(id)}/approve`),
  denyApproval: (id: string) => request("POST", `/api/approvals/${encodeURIComponent(id)}/deny`),
  approveLifecycleApproval: (id: string) =>
    request("POST", `/api/m3/lifecycle-approvals/${encodeURIComponent(id)}/approve`),
  denyLifecycleApproval: (id: string) =>
    request("POST", `/api/m3/lifecycle-approvals/${encodeURIComponent(id)}/deny`),
  queueLifecycleRollback: (id: string) =>
    request("POST", `/api/m3/lifecycle-rollbacks/${encodeURIComponent(id)}/queue`),
  approveCodexApproval: (id: string) =>
    request("POST", `/api/codex/approval-broker/${encodeURIComponent(id)}/approve`),
  denyCodexApproval: (id: string) =>
    request("POST", `/api/codex/approval-broker/${encodeURIComponent(id)}/deny`),
  /** Channel lifecycle (#1090). Enable/allowlist/delivery-retry are approval-gated. */
  enableChannel: (id: string, approvalToken: string) =>
    request("POST", `/api/channels/${encodeURIComponent(id)}/enable`, { approvalToken }),
  disableChannel: (id: string) =>
    request("POST", `/api/channels/${encodeURIComponent(id)}/disable`, {}),
  retryChannelDelivery: (channelId: string, deliveryId: string, approvalToken: string) =>
    request<{ deliveryId: string; status: string }>(
      "POST",
      `/api/channels/${encodeURIComponent(channelId)}/deliveries/${encodeURIComponent(deliveryId)}/retry`,
      { approvalToken },
    ),
  // Bind (projectId) or clear (null) the project /task files issues into, and the
  // auto-route mode. Approval-gated.
  setChannelTaskProject: (channelId: string, projectId: string | null, autoRoute: boolean, dailyLimit: number, approvalToken: string) =>
    request("POST", `/api/channels/${encodeURIComponent(channelId)}/task-project`, { projectId, autoRoute, dailyLimit, approvalToken }),
  // Promote a captured /task request into a tracked auto-run, or dismiss it.
  routeChannelTask: (id: string) => request<{ ok: boolean; autoRunId: string | null }>("POST", `/api/channel-tasks/${encodeURIComponent(id)}/route`),
  dismissChannelTask: (id: string) => request("POST", `/api/channel-tasks/${encodeURIComponent(id)}/dismiss`),
  retryChannelTask: (id: string) => request("POST", `/api/channel-tasks/${encodeURIComponent(id)}/retry`),
  rerouteChannelTask: (id: string) => request("POST", `/api/channel-tasks/${encodeURIComponent(id)}/reroute`),
  takeoverChannelTask: (id: string) => request("POST", `/api/channel-tasks/${encodeURIComponent(id)}/takeover`),
  // Opt a channel into in-channel /approve (default off). Approval-gated.
  setChannelApprovalPolicy: (channelId: string, allowSelfApprove: boolean, approvalToken: string) =>
    request("POST", `/api/channels/${encodeURIComponent(channelId)}/approval-policy`, { allowSelfApprove, approvalToken }),

  // Canvas scenes (#1354): server-authoritative, revision-aware.
  listCanvasScenes: () => request<{ scenes: CanvasSceneSummary[]; count: number }>("GET", "/api/canvas/scenes"),
  getCanvasScene: (id: string) =>
    request<{ scene: CanvasScene }>("GET", `/api/canvas/scenes/${encodeURIComponent(id)}`),
  createCanvasScene: (body: { name?: string; projectId?: string | null; elements?: unknown[]; files?: Record<string, unknown> }) =>
    request<{ scene: CanvasScene }>("POST", "/api/canvas/scenes", body),
  deleteCanvasScene: (id: string, expectedRevision: number) =>
    request("DELETE", `/api/canvas/scenes/${encodeURIComponent(id)}`, { expectedRevision }),
  // Revision-aware save: returns a typed conflict on 409 rather than throwing.
  saveCanvasScene: async (
    id: string,
    body: { name?: string; elements?: unknown[]; files?: Record<string, unknown>; expectedRevision: number },
  ): Promise<CanvasSaveResult> => {
    const { status, ok, data } = await requestResult("PUT", `/api/canvas/scenes/${encodeURIComponent(id)}`, body);
    if (ok) return { ok: true, scene: data.scene as CanvasScene };
    if (status === 409 && data.error === "canvas_scene_revision_conflict") {
      return { ok: false, conflict: true, currentRevision: Number(data.currentRevision) };
    }
    return { ok: false, conflict: false, error: String(data.message ?? data.error ?? "Save failed.") };
  },
};
