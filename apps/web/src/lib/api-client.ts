/*
 * Typed client for the M0 server API. One unified invocation surface, mirrored
 * from the control-plane gateway: every action goes through `request()` so
 * error wording and the localhost-only API override stay consistent.
 */

import type {
  ConsoleSnapshot,
  ToolDescriptor,
  ToolInvocationRequest,
  ToolInvocationResponse,
} from "@/lib/console-state";

const DEFAULT_API_BASE = "http://127.0.0.1:3001";

/** Localhost-only API override (via `?api=`) for local visual QA. */
export function resolveApiBase(): string {
  if (typeof window === "undefined") return DEFAULT_API_BASE;
  const override = new URLSearchParams(window.location.search).get("api");
  if (!override) return DEFAULT_API_BASE;
  try {
    const url = new URL(override);
    if (url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname)) {
      return url.origin;
    }
  } catch {
    return DEFAULT_API_BASE;
  }
  return DEFAULT_API_BASE;
}

const apiBase = resolveApiBase();

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
    throw new Error(record.message ?? record.error ?? `${method} ${path} failed.`);
  }
  return data as T;
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

export const api = {
  updateDevice: (payload: { maxConcurrency?: number }) => request("PATCH", "/api/device", payload),
  listTools: () => request<{ tools: ToolDescriptor[] }>("GET", "/api/tools"),
  getTool: (name: string) =>
    request<{ tool: ToolDescriptor }>("GET", `/api/tools/${encodeURIComponent(name)}`),
  createToolInvocation: (name: string, input: ToolInvocationRequest) =>
    request<ToolInvocationResponse>(
      "POST",
      `/api/tools/${encodeURIComponent(name)}/invocations`,
      input,
    ),
  createInvocation: (
    task: string,
    agentId: string | null,
    projectId?: string | null,
    worktreeId?: string | null,
    options?: Record<string, unknown>,
  ) => request("POST", "/api/invocations", { task, agentId, projectId, worktreeId, options }),
  uploadWorktreeAttachments: (id: string, files: { name: string; dataBase64: string }[]) =>
    request("POST", `/api/worktrees/${encodeURIComponent(id)}/attachments`, { files }),
  cancelInvocation: (id: string) =>
    request("POST", `/api/invocations/${encodeURIComponent(id)}/cancel`),
  troubleshoot: (id: string) =>
    request("POST", `/api/invocations/${encodeURIComponent(id)}/troubleshoot`),

  healthCheckAgent: (id: string) =>
    request("POST", `/api/agents/${encodeURIComponent(id)}/health-check`),
  setAgentEnabled: (id: string, enabled: boolean) =>
    request("POST", `/api/agents/${encodeURIComponent(id)}/${enabled ? "enable" : "disable"}`),

  registerAgent: (payload: Record<string, unknown>) => request("POST", "/api/agents", payload),

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
  removeWorktree: (id: string) => request("DELETE", `/api/worktrees/${encodeURIComponent(id)}`),
  listWorktreeFiles: (id: string) => request("GET", `/api/worktrees/${encodeURIComponent(id)}/files`),
  searchWorktree: (id: string, q: string, mode: "name" | "content") =>
    request("GET", `/api/worktrees/${encodeURIComponent(id)}/search?mode=${mode}&q=${encodeURIComponent(q)}`),
  readWorktreeFile: (id: string, filePath: string) =>
    request("GET", `/api/worktrees/${encodeURIComponent(id)}/file?path=${encodeURIComponent(filePath)}`),
  worktreeGit: (id: string) => request("GET", `/api/worktrees/${encodeURIComponent(id)}/git`),
  worktreeDiff: (id: string) => request("GET", `/api/worktrees/${encodeURIComponent(id)}/diff`),
  publishWorktreeBranch: (id: string) => request("POST", `/api/worktrees/${encodeURIComponent(id)}/push`),
  createWorktreePr: (id: string, payload: { title: string; body: string }) =>
    request("POST", `/api/worktrees/${encodeURIComponent(id)}/pr`, payload),
  listGithubItems: (projectId: string) =>
    request("GET", `/api/projects/${encodeURIComponent(projectId)}/github`),
  listBranches: (projectId: string) =>
    request("GET", `/api/projects/${encodeURIComponent(projectId)}/branches`),
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
};
