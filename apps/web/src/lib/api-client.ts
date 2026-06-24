/*
 * Typed client for the M0 server API. One unified invocation surface, mirrored
 * from the control-plane gateway: every action goes through `request()` so
 * error wording and the localhost-only API override stay consistent.
 */

import type { ConsoleSnapshot } from "@/lib/console-state";

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

async function request<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
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
  createInvocation: (task: string, agentId: string | null, projectId?: string | null, worktreeId?: string | null) =>
    request("POST", "/api/invocations", { task, agentId, projectId, worktreeId }),
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

  approveApproval: (id: string) =>
    request("POST", `/api/approvals/${encodeURIComponent(id)}/approve`),
  denyApproval: (id: string) => request("POST", `/api/approvals/${encodeURIComponent(id)}/deny`),
};
