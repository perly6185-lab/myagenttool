// Shared transport and browser-session runtime for all domain API clients.
const SERVER_PORT = "5001";
const FALLBACK_API_BASE = `http://127.0.0.1:${SERVER_PORT}`;

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function resolveApiBase(): string {
  if (typeof window === "undefined") return FALLBACK_API_BASE;
  const override = new URLSearchParams(window.location.search).get("api");
  if (override) {
    try {
      return new URL(override).origin;
    } catch {
      // Fall through to the location-derived default.
    }
  }
  const { protocol, hostname } = window.location;
  if (!hostname) return FALLBACK_API_BASE;
  return `${protocol}//${hostname}:${SERVER_PORT}`;
}

export const apiBase = resolveApiBase();
export const REQUEST_TIMEOUT_MS = 15_000;
export const SESSION_CHANGED_EVENT = "myagenttool:session-changed";

export interface SessionUser {
  id: string;
  name?: string;
  teamId?: string;
  role?: "owner" | "admin" | "operator" | "viewer";
  privateTutorChildMode?: {
    learnerId: string;
    enteredAt: string | null;
  } | null;
}

let memoryUser: SessionUser | null = null;
let sessionReady = false;
let sessionChecked = false;
let sessionPromise: Promise<boolean> | null = null;

export function setSessionUser(user: SessionUser | null): void {
  memoryUser = user;
  try {
    window.localStorage.removeItem("myagenttool.token");
    window.localStorage.removeItem("myagenttool.user");
  } catch {
    // Legacy storage may be unavailable; it is never read.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(SESSION_CHANGED_EVENT));
}

export function setSessionReady(ready: boolean): void {
  sessionReady = ready;
  sessionChecked = ready;
}

/** Record a completed session check that found no signed-in user. */
export function setSessionAnonymous(): void {
  sessionReady = false;
  sessionChecked = true;
}

export function getSessionUser(): SessionUser | null {
  return memoryUser;
}

function csrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const prefix = "myagenttool_csrf=";
  const value = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return value ? decodeURIComponent(value.slice(prefix.length)) : null;
}

export function csrfHeaders(method: string): Record<string, string> {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase())) return {};
  const token = csrfToken();
  return token ? { "X-CSRF-Token": token } : {};
}

async function discoverSession(): Promise<boolean> {
  try {
    window.localStorage.removeItem("myagenttool.token");
    window.localStorage.removeItem("myagenttool.user");
  } catch {
    // Storage may be unavailable; no browser credential is read either way.
  }
  const current = await fetch(`${apiBase}/api/session`, { credentials: "include" }).catch(() => null);
  if (current?.ok) {
    const data = (await current.json().catch(() => ({}))) as { user?: SessionUser };
    setSessionUser(data.user ?? null);
    sessionReady = true;
    sessionChecked = true;
    return true;
  }
  setSessionUser(null);
  sessionReady = false;
  // A 401 is a valid anonymous state, not a transport failure. Remember it so
  // every public dashboard request does not rediscover the same missing
  // session and flood the server with identical 401s.
  sessionChecked = current?.status === 401;
  return false;
}

export function ensureSession(): Promise<boolean> {
  if (sessionReady) return Promise.resolve(true);
  if (sessionChecked) return Promise.resolve(false);
  if (!sessionPromise) sessionPromise = discoverSession().finally(() => (sessionPromise = null));
  return sessionPromise;
}

export async function request<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  retry = true,
  timeoutMs = REQUEST_TIMEOUT_MS,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const hadSession = await ensureSession();
  const headers: Record<string, string> = { ...csrfHeaders(method), ...extraHeaders };
  if (body) headers["Content-Type"] = "application/json";
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status === 401 && retry && hadSession) {
    sessionReady = false;
    sessionChecked = false;
    await ensureSession();
    return request<T>(method, path, body, false, timeoutMs, extraHeaders);
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const record = data as { message?: string; error?: string };
    throw new ApiError(record.error ?? "request_failed", record.message ?? record.error ?? `${method} ${path} failed.`, response.status, data as Record<string, unknown>);
  }
  return data as T;
}

export async function requestBytes(path: string, retry = true): Promise<ArrayBuffer> {
  const hadSession = await ensureSession();
  const response = await fetch(`${apiBase}${path}`, { method: "GET", credentials: "include" });
  if (response.status === 401 && retry && hadSession) {
    sessionReady = false;
    sessionChecked = false;
    await ensureSession();
    return requestBytes(path, false);
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { message?: string; error?: string };
    throw new ApiError(data.error ?? "request_failed", data.message ?? data.error ?? `GET ${path} failed.`, response.status);
  }
  return response.arrayBuffer();
}

export async function requestRaw<T>(
  method: string,
  path: string,
  body: Blob,
  contentType: string,
  retry = true,
  userSignal?: AbortSignal,
): Promise<T> {
  const hadSession = await ensureSession();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), REQUEST_TIMEOUT_MS);
  const abortFromUser = () => controller.abort(userSignal?.reason);
  if (userSignal?.aborted) abortFromUser();
  else userSignal?.addEventListener("abort", abortFromUser, { once: true });
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      method,
      credentials: "include",
      headers: { ...csrfHeaders(method), "Content-Type": contentType || "application/octet-stream" },
      body,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
    userSignal?.removeEventListener("abort", abortFromUser);
  }
  if (response.status === 401 && retry && hadSession) {
    sessionReady = false;
    sessionChecked = false;
    await ensureSession();
    return requestRaw<T>(method, path, body, contentType, false, userSignal);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const record = data as { message?: string; error?: string };
    throw new ApiError(
      record.error ?? "request_failed",
      record.message ?? record.error ?? `${method} ${path} failed.`,
      response.status,
      data && typeof data === "object" ? data as Record<string, unknown> : undefined,
    );
  }
  return data as T;
}

export async function requestByteRange(
  path: string,
  start: number,
  end: number,
  retry = true,
): Promise<{ data: ArrayBuffer; total: number }> {
  const hadSession = await ensureSession();
  const response = await fetch(`${apiBase}${path}`, {
    method: "GET",
    credentials: "include",
    headers: { Range: `bytes=${start}-${end - 1}` },
  });
  if (response.status === 401 && retry && hadSession) {
    sessionReady = false;
    sessionChecked = false;
    await ensureSession();
    return requestByteRange(path, start, end, false);
  }
  if (response.status !== 206) {
    const detail = await response.json().catch(() => ({})) as { message?: string; error?: string };
    throw new ApiError(detail.error ?? "pdf_range_failed", detail.message ?? "PDF server did not honor the byte-range request.", response.status);
  }
  const match = /\/(\d+)$/.exec(response.headers.get("Content-Range") ?? "");
  if (!match) throw new ApiError("invalid_content_range", "PDF byte-range response omitted its total size.", 502);
  return { data: await response.arrayBuffer(), total: Number(match[1]) };
}

export async function openControlPlaneEventStream(
  onEvent: (event: { id: string | null; event: string; data: Record<string, unknown> }) => void,
  signal: AbortSignal,
  lastEventId?: string | null,
): Promise<void> {
  await ensureSession();
  const response = await fetch(`${apiBase}/api/events/stream`, {
    headers: { ...(lastEventId ? { "Last-Event-ID": lastEventId } : {}) },
    credentials: "include",
    signal,
  });
  if (response.status === 401) {
    sessionReady = false;
    sessionChecked = false;
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
