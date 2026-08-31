import { ApiError, apiBase, csrfHeaders, ensureSession, request } from "@/lib/api/request";
import type { HostAuthMethod, HostDiagnosticAction, HostDiagnosticParameters, HostDiagnosticPlan, HostDiagnosticResult, HostDiagnosticRun, HostFileConflictPolicy, HostFileEntry, HostFileScope, HostFileScopeOption, HostFileScopePurpose, HostFileScopeSuggestion, HostFileSearchResponse, HostFileTransfer, HostHealthOverview, HostHealthPolicy, HostHealthSnapshot, HostPurpose, HostRemediationPlan, HostTlsActivationProfile, SshHost } from "./host-types";

export const MAX_HOST_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_HOST_DOWNLOAD_BYTES = 25 * 1024 * 1024;

export const hostApi = {
  list: () => request<{ hosts: SshHost[]; count: number }>("GET", "/api/hosts"),
  get: (hostId: string) => request<{ host: SshHost }>("GET", `/api/hosts/${encodeURIComponent(hostId)}`),
  create: (input: { name: string; host: string; port: number; user: string; authMethod: HostAuthMethod; purposes: HostPurpose[]; networkPolicy: "public_only" | "allow_private_network" }) =>
    request<{ target: SshHost }>("POST", "/api/hosts", input),
  update: (hostId: string, input: { expectedRevision: number; name?: string; host?: string; port?: number; user?: string; authMethod?: HostAuthMethod; purposes?: HostPurpose[]; networkPolicy?: "public_only" | "allow_private_network" }) =>
    request<{ host: SshHost }>("PATCH", `/api/hosts/${encodeURIComponent(hostId)}`, input),
  observeFingerprint: (hostId: string) =>
    request<{ host: SshHost; observation: { fingerprint: string; resolvedAddress: string } }>("POST", `/api/hosts/${encodeURIComponent(hostId)}/observe-fingerprint`, {}, true, 30_000),
  confirmFingerprint: (hostId: string, fingerprint: string, expectedRevision: number) =>
    request<{ host: SshHost }>("POST", `/api/hosts/${encodeURIComponent(hostId)}/confirm-fingerprint`, { fingerprint, expectedRevision }),
  verify: (hostId: string) =>
    request<{ host: SshHost; verification: { capabilities: SshHost["capabilities"] } }>("POST", `/api/hosts/${encodeURIComponent(hostId)}/verify`, {}, true, 30_000),
  diagnose: (hostId: string, action: HostDiagnosticAction, parameters: HostDiagnosticParameters = {}) =>
    request<{ result: HostDiagnosticResult }>("POST", `/api/hosts/${encodeURIComponent(hostId)}/diagnostics`, { action, parameters, confirmed: true }, true, 120_000),
  planDiagnostic: (hostId: string, input: string) =>
    request<{ plan: HostDiagnosticPlan }>("POST", `/api/hosts/${encodeURIComponent(hostId)}/assistant/plan`, { input }, true, 30_000),
  diagnoseIssue: (hostId: string, input: string) =>
    request<{ run: HostDiagnosticRun }>("POST", `/api/hosts/${encodeURIComponent(hostId)}/assistant/diagnose`, { input, confirmed: true }, true, 180_000),
  planRemediation: (hostId: string, profileId: string, diagnosticRunId: string) =>
    request<{ plan: HostRemediationPlan; reused: boolean }>("POST", `/api/hosts/${encodeURIComponent(hostId)}/assistant/remediation-plan`, { profileId, diagnosticRunId }, true, 30_000),
  confirmRemediation: (hostId: string, planId: string, expectedRevision: number) =>
    request<{ plan: HostRemediationPlan; reused: boolean }>("POST", `/api/hosts/${encodeURIComponent(hostId)}/assistant/remediation-plans/${encodeURIComponent(planId)}/confirm`, { confirmed: true, expectedRevision }, true, 180_000),
  remediationPlans: (hostId: string) =>
    request<{ plans: HostRemediationPlan[]; count: number }>("GET", `/api/hosts/${encodeURIComponent(hostId)}/assistant/remediation-plans`),
  remediationPlan: (hostId: string, planId: string) =>
    request<{ plan: HostRemediationPlan }>("GET", `/api/hosts/${encodeURIComponent(hostId)}/assistant/remediation-plans/${encodeURIComponent(planId)}`),
  recheckRemediation: (hostId: string, planId: string) =>
    request<{ plan: HostRemediationPlan }>("POST", `/api/hosts/${encodeURIComponent(hostId)}/assistant/remediation-plans/${encodeURIComponent(planId)}/recheck`, {}, true, 30_000),
  health: (hostId: string) =>
    request<HostHealthOverview>("GET", `/api/hosts/${encodeURIComponent(hostId)}/health`),
  checkHealth: (hostId: string) =>
    request<{ snapshot: HostHealthSnapshot }>("POST", `/api/hosts/${encodeURIComponent(hostId)}/health/check`, {}, true, 180_000),
  setHealthMonitoring: (hostId: string, input: { enabled: boolean; cadence: HostHealthPolicy["cadence"] }) =>
    request<{ policy: HostHealthPolicy }>("PATCH", `/api/hosts/${encodeURIComponent(hostId)}/health/monitoring`, input),
  scopes: (hostId: string) =>
    request<{ scopes: HostFileScope[]; count: number }>("GET", `/api/hosts/${encodeURIComponent(hostId)}/file-scopes`),
  scopeSuggestions: (hostId: string) =>
    request<{ suggestions: HostFileScopeSuggestion[]; count: number }>("GET", `/api/hosts/${encodeURIComponent(hostId)}/file-scope-suggestions`, undefined, true, 30_000),
  publishScopes: () =>
    request<{ scopes: HostFileScopeOption[]; count: number }>("GET", "/api/host-file-scopes?purpose=site_publish"),
  certificateScopes: () =>
    request<{ scopes: HostFileScopeOption[]; count: number }>("GET", "/api/host-file-scopes?purpose=tls_certificate"),
  createScope: (hostId: string, input: { label: string; purpose: HostFileScopePurpose; rootPath: string; permissions?: Array<"list" | "upload" | "download"> }) =>
    request<{ scope: HostFileScope }>("POST", `/api/hosts/${encodeURIComponent(hostId)}/file-scopes`, input, true, 30_000),
  updateScope: (hostId: string, scopeId: string, input: { expectedRevision: number; label?: string; rootPath?: string; purpose?: HostFileScopePurpose; status?: "ready" | "disabled"; permissions?: Array<"list" | "upload" | "download"> }) =>
    request<{ scope: HostFileScope }>("PATCH", `/api/hosts/${encodeURIComponent(hostId)}/file-scopes/${encodeURIComponent(scopeId)}`, input, true, 30_000),
  tlsProfiles: (hostId: string) =>
    request<{ profiles: HostTlsActivationProfile[]; count: number }>("GET", `/api/hosts/${encodeURIComponent(hostId)}/tls-activation-profiles`),
  createTlsProfile: (hostId: string, input: { label: string; certificateScopeId: string; containerName: string }) =>
    request<{ profile: HostTlsActivationProfile }>("POST", `/api/hosts/${encodeURIComponent(hostId)}/tls-activation-profiles`, { ...input, type: "docker_nginx" }, true, 30_000),
  entries: (scopeId: string, path = "") =>
    request<{ scope: HostFileScope; path: string; entries: HostFileEntry[]; count: number }>("GET", `/api/host-file-scopes/${encodeURIComponent(scopeId)}/entries?path=${encodeURIComponent(path)}`, undefined, true, 30_000),
  search: (scopeId: string, query: string, expectedRevision: number) =>
    request<HostFileSearchResponse>("POST", `/api/host-file-scopes/${encodeURIComponent(scopeId)}/search`, { query, expectedRevision }, true, 30_000),
  preview: previewHostFile,
  transfers: (hostId: string) =>
    request<{ transfers: HostFileTransfer[]; count: number }>("GET", `/api/hosts/${encodeURIComponent(hostId)}/file-transfers`),
  upload: uploadHostFile,
  download: downloadHostFile,
};

async function previewHostFile(scopeId: string, options: { path: string; expectedRevision: number }): Promise<{ blob: Blob; kind: "text" | "image" | "pdf"; contentType: string }> {
  await ensureSession();
  const response = await fetch(`${apiBase}/api/host-file-scopes/${encodeURIComponent(scopeId)}/preview`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders("POST") },
    body: JSON.stringify(options),
  });
  if (!response.ok) throw apiError(await response.json().catch(() => ({})), response.status);
  const kind = response.headers.get("X-Host-Preview-Kind");
  if (!kind || !["text", "image", "pdf"].includes(kind)) throw new ApiError("host_file_preview_invalid", "The preview response was invalid.", 502);
  const contentType = response.headers.get("Content-Type") || "application/octet-stream";
  return { blob: await response.blob(), kind: kind as "text" | "image" | "pdf", contentType };
}

async function uploadHostFile(scopeId: string, file: File, options: { directory: string; conflictPolicy: HostFileConflictPolicy; overwriteConfirmed: boolean; retryOf?: string | null; onProgress?: (progress: number) => void }): Promise<{ task: HostFileTransfer }> {
  await ensureSession();
  const query = new URLSearchParams({ directory: options.directory, filename: file.name, conflictPolicy: options.conflictPolicy });
  if (options.retryOf) query.set("retryOf", options.retryOf);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${apiBase}/api/host-file-scopes/${encodeURIComponent(scopeId)}/transfers/upload?${query}`);
    xhr.withCredentials = true;
    xhr.timeout = 120_000;
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("X-Transfer-Confirmed", "true");
    if (options.overwriteConfirmed) xhr.setRequestHeader("X-Overwrite-Confirmed", "true");
    for (const [key, value] of Object.entries(csrfHeaders("POST"))) xhr.setRequestHeader(key, value);
    xhr.upload.onprogress = (event) => options.onProgress?.(event.lengthComputable ? Math.round((event.loaded / event.total) * 80) : 20);
    xhr.onload = () => {
      const data = parseJson(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) { options.onProgress?.(100); resolve(data as { task: HostFileTransfer }); }
      else reject(apiError(data, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError("host_file_transfer_network_error", "The upload connection failed.", 0));
    xhr.ontimeout = () => reject(new ApiError("host_file_transfer_timeout", "The upload timed out.", 408));
    xhr.send(file);
  });
}

async function downloadHostFile(scopeId: string, options: { path: string; retryOf?: string | null; onProgress?: (progress: number) => void }): Promise<{ blob: Blob; fileName: string; transferId: string | null }> {
  await ensureSession();
  const response = await fetch(`${apiBase}/api/host-file-scopes/${encodeURIComponent(scopeId)}/transfers/download`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeaders("POST") },
    body: JSON.stringify({ path: options.path, confirmed: true, retryOf: options.retryOf ?? null }),
  });
  if (!response.ok) throw apiError(await response.json().catch(() => ({})), response.status);
  const total = Number(response.headers.get("Content-Length") ?? 0);
  const reader = response.body?.getReader();
  const chunks: BlobPart[] = [];
  let received = 0;
  if (reader) {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const copy = new Uint8Array(value.length);
      copy.set(value);
      chunks.push(copy.buffer);
      received += value.length;
      options.onProgress?.(total ? Math.round((received / total) * 100) : 50);
    }
  }
  options.onProgress?.(100);
  const fileName = options.path.split("/").pop() || "download";
  return { blob: new Blob(chunks, { type: "application/octet-stream" }), fileName, transferId: response.headers.get("X-Host-Transfer-Id") };
}

function parseJson(value: string): unknown {
  try { return value ? JSON.parse(value) : {}; } catch { return {}; }
}

function apiError(value: unknown, status: number) {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const code = typeof data.error === "string" ? data.error : "host_file_transfer_failed";
  return new ApiError(code, code, status, data);
}
