export type HostAuthMethod = "private_key_ref" | "managed_identity" | "password_ref" | "ssh_agent";
export type HostPurpose = "runtime" | "file_transfer" | "site_publish" | "tls_certificate";
export type HostConnectionStatus = "untested" | "fingerprint_pending" | "ready" | "error" | "disabled";

export interface SshHost {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  authMethod: HostAuthMethod;
  credentialRef: string;
  purposes: HostPurpose[];
  networkPolicy: "public_only" | "allow_private_network";
  knownHostFingerprint: string | null;
  observedFingerprint: string | null;
  connectionStatus: HostConnectionStatus;
  capabilities: { sftp: boolean; sftpVersion?: number | null; posixRename?: boolean; symlink?: boolean } | null;
  lastConnectionError: { code: string; at: string } | null;
  verifiedAt: string | null;
  revision: number;
}

export type HostFileScopePurpose = "general_files" | "site_publish" | "backup" | "tls_certificate";

export interface HostFileScopeSuggestion {
  rootPath: string;
  label: string;
  purpose: "general_files" | "site_publish";
  reason: "managed_site" | "managed_content" | "website_directory";
  recommended: boolean;
}

export interface HostFileScope {
  id: string;
  sshTargetId: string;
  label: string;
  purpose: HostFileScopePurpose;
  rootPath: string;
  resolvedRootPath: string;
  permissions: Array<"list" | "upload" | "download" | "certificate_write">;
  status: "ready" | "disabled" | "error";
  revision: number;
  lastVerifiedAt: string;
}

export interface HostFileScopeOption extends HostFileScope {
  host: Pick<SshHost, "id" | "name" | "host" | "connectionStatus" | "capabilities">;
}

export interface HostTlsActivationProfile {
  id: string;
  sshTargetId: string;
  certificateScopeId: string;
  label: string;
  type: "docker_nginx";
  containerName: string;
  status: "ready" | "disabled" | "error";
  lastVerifiedAt: string;
  revision: number;
}

export interface HostFileEntry {
  name: string;
  path: string;
  type: "directory" | "file" | "symlink" | "special";
  accessible: boolean;
  size: number | null;
  modifiedAt: string | null;
}

export interface HostFileSearchResult extends HostFileEntry {
  matchKind: "name" | "content";
  previewKind: "text" | "image" | "pdf" | null;
  restricted: boolean;
}

export interface HostFileSearchBoundaries {
  scannedEntries: number;
  scannedTextFiles: number;
  readBytes: number;
  skippedEntries: number;
  truncated: boolean;
  maxDepth: number;
  maxEntries: number;
  maxResults: number;
}

export interface HostFileSearchResponse {
  scopeId: string;
  scopeRevision: number;
  results: HostFileSearchResult[];
  count: number;
  contentSearchEnabled: boolean;
  boundaries: HostFileSearchBoundaries;
}

export type HostDiagnosticAction = "disk_usage" | "memory_usage" | "system_info" | "uptime" | "login_sessions" | "ssh_login_audit" | "failed_services" | "processes" | "listening_ports" | "docker_status" | "service_status" | "recent_logs" | "network_info";

export interface HostDiagnosticParameters {
  serviceName?: string;
}

export type HostDiagnosticSeverity = "healthy" | "info" | "warning" | "critical" | "unknown";

export interface HostDiagnosticFact {
  key: string;
  value: string;
  severity: HostDiagnosticSeverity;
}

export interface HostDiagnosticSummary {
  version: 1;
  severity: HostDiagnosticSeverity;
  finding: string;
  impact: string;
  nextAction: string;
  facts: HostDiagnosticFact[];
}

export interface HostDiagnosticResult {
  action: HostDiagnosticAction;
  command: string;
  output: string;
  summary: HostDiagnosticSummary;
  parameters?: HostDiagnosticParameters;
  resolvedAddress?: string;
}

export interface HostDiagnosticPlan {
  action: HostDiagnosticAction;
  command: string;
  risk: "read_only";
  parameters?: HostDiagnosticParameters;
}

export type HostDiagnosticRunIntent = "health" | "performance" | "website" | "security" | "containers" | "targeted";

export interface HostDiagnosticRunStep {
  action: HostDiagnosticAction;
  parameters?: HostDiagnosticParameters;
  status: "completed" | "unavailable";
  command?: string;
  output?: string;
  summary?: HostDiagnosticSummary;
  error?: string;
}

export interface HostDiagnosticRun {
  version: 1;
  intent: HostDiagnosticRunIntent;
  risk: "read_only";
  steps: HostDiagnosticRunStep[];
  summary: HostDiagnosticSummary;
  primaryAction?: HostDiagnosticAction | null;
  resolvedAddress?: string | null;
}

export type HostFileConflictPolicy = "deny" | "rename" | "replace";

export interface HostFileTransfer {
  id: string;
  sshTargetId: string;
  scopeId: string;
  direction: "upload" | "download";
  status: "running" | "completed" | "failed";
  remotePath: string;
  remoteDirectory: string;
  fileName: string;
  bytesTotal: number;
  bytesTransferred: number;
  progress: number;
  conflictPolicy: HostFileConflictPolicy | null;
  sha256?: string | null;
  attempt: number;
  maxAttempts: number;
  retryOf: string | null;
  errorCode: string | null;
  createdAt: string;
  startedAt?: string;
  updatedAt?: string;
  completedAt: string | null;
}
