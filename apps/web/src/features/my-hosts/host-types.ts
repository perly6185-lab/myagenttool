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
  healthSummary?: { status: HostHealthStatus | null; checkedAt: string | null; openIncidentCount: number; monitoringEnabled: boolean };
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

export interface HostOperationsIntentUnderstanding {
  version: 1;
  goal: "inspect" | "restore" | "improve" | "secure";
  domain: "device" | "website" | "performance" | "storage" | "memory" | "network" | "security" | "containers" | "service" | "logs";
  symptom: "unspecified" | "unavailable" | "slow" | "storage_pressure" | "memory_pressure" | "high_load" | "suspicious_access";
  desiredOutcome: "understand_state" | "restore_availability" | "improve_performance" | "free_space" | "verify_security";
  requestedChange: "none" | "restart_service" | "cleanup_storage" | "stop_process" | "change_access" | "other_change";
  handling: "read_only_diagnosis" | "diagnose_before_change";
  confidence: "high" | "medium";
}

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
  id: string;
  version: 1;
  intent: HostDiagnosticRunIntent;
  understanding?: HostOperationsIntentUnderstanding;
  risk: "read_only";
  steps: HostDiagnosticRunStep[];
  summary: HostDiagnosticSummary;
  primaryAction?: HostDiagnosticAction | null;
  resolvedAddress?: string | null;
  targetRevision: number;
  createdAt: string;
}

export type HostOperationsCaseStatus = "checking" | "diagnosed" | "awaiting_confirmation" | "changing" | "recovered" | "unresolved" | "needs_help";

export interface HostOperationsCaseTimelineItem {
  kind: "case_opened" | "diagnosis_completed" | "diagnosis_incomplete" | "device_changed" | "remediation_planned" | "remediation_started" | "remediation_completed" | "remediation_incomplete";
  at: string;
  deviceChanged: boolean;
  diagnosticRunId?: string;
  severity?: HostDiagnosticSeverity;
  error?: string;
  remediationPlanId?: string;
}

export interface HostOperationsCase {
  id: string;
  sshTargetId: string;
  incidentId: string | null;
  version: 1;
  intent: HostDiagnosticRunIntent;
  understanding: HostOperationsIntentUnderstanding;
  status: HostOperationsCaseStatus;
  nextStep: "wait_for_diagnosis" | "check_managed_website" | "review_supported_action" | "describe_remaining_symptom" | "review_incomplete_checks" | "review_findings" | "update_sign_in" | "confirm_device_identity" | "restore_connection" | "try_another_check" | "recheck_device_identity" | "confirm_governed_action" | "wait_for_verification" | "case_complete" | "recheck_outcome" | "review_manual_handoff";
  diagnosticRunId: string | null;
  remediationPlanId: string | null;
  targetRevision: number;
  deviceChanged: boolean;
  lastError: string | null;
  timeline: HostOperationsCaseTimelineItem[];
  latestRun: HostDiagnosticRun | null;
  createdAt: string;
  updatedAt: string;
}

export interface HostOperationsMetrics {
  version: 1;
  generatedAt: string;
  cases: {
    total: number;
    active: number;
    terminal: number;
    recovered: number;
    unresolved: number;
    changed: number;
    manualHandoff: number;
    recoveryRate: number | null;
    changeRate: number | null;
  };
  remediation: {
    total: number;
    terminal: number;
    safeAbort: number;
    unknownOutcome: number;
    completed: number;
    noChangeNeeded: number;
  };
  timing: {
    completedCaseCount: number;
    averageCaseSeconds: number | null;
    latestCaseUpdatedAt: string | null;
  };
}

export interface HostOperationsPilotSummary {
  version: 1;
  generatedAt: string;
  participation: { total: number; active: number; completed: number };
  experience: {
    nextStepClear: { numerator: number; denominator: number; rate: number | null };
    averageEaseRating: number | null;
  };
  operations: HostOperationsMetrics;
  bottlenecks: Array<{ nextStep: HostOperationsCase["nextStep"] | "unknown"; count: number }>;
  privacy: {
    rawInputCollected: false;
    commandOutputCollected: false;
    addressCollected: false;
    credentialsCollected: false;
    freeTextCollected: false;
    participantIdentityExported: false;
  };
}

export interface HostOperationsPilotCampaign {
  id: string;
  label: string;
  inviteCode: string;
  status: "active" | "closed";
  revision: number;
  createdAt: string;
  activatedAt: string;
  updatedAt: string;
  closedAt: string | null;
  summary: HostOperationsPilotSummary;
}

export interface HostOperationsPilotSession {
  id: string;
  campaignId: string;
  sshTargetId: string;
  status: "active" | "completed";
  revision: number;
  startedAt: string;
  completedAt: string | null;
  outcome: { caseId: string; nextStepClear: boolean; easeRating: number } | null;
  latestCase: Pick<HostOperationsCase, "id" | "status" | "nextStep" | "updatedAt"> | null;
}

export interface HostOperationsPilotEvidence {
  evidence: {
    schema: "myagenttool.host-operations-pilot-evidence.v1";
    generatedAt: string;
    campaign: Pick<HostOperationsPilotCampaign, "id" | "label" | "status" | "activatedAt" | "closedAt">;
    summary: HostOperationsPilotSummary;
    samples: Array<{
      caseRef: string;
      hostRef: string;
      intent: HostDiagnosticRunIntent;
      status: HostOperationsCaseStatus;
      nextStep: HostOperationsCase["nextStep"];
      deviceChanged: boolean;
      createdAt: string;
      updatedAt: string;
      timeline: Array<Pick<HostOperationsCaseTimelineItem, "kind" | "at" | "deviceChanged">>;
    }>;
  };
  sha256: string;
}

export type HostRemediationPlanStatus = "planned" | "running" | "not_needed" | "completed" | "completed_unresolved" | "failed" | "outcome_unknown" | "expired";

export interface HostWebsiteHealthSummary {
  status: "healthy" | "unhealthy";
  reason: "website_healthy" | "website_timeout" | "website_unreachable" | "website_certificate_invalid" | "website_certificate_mismatch" | "website_http_error" | "website_content_mismatch";
  statusCodeClass: number | null;
  contentMatched: boolean;
  checkedAt: string;
}

export interface HostRemediationResult {
  outcome: "already_healthy" | "restored" | "not_restored" | "not_changed" | "verification_incomplete";
  changeAttempted: boolean;
  verification: "passed" | "failed" | "not_started" | "incomplete";
  completedChecks: string[];
  websiteHealth?: HostWebsiteHealthSummary;
  error?: string;
}

export interface HostRemediationPlan {
  id: string;
  sshTargetId: string;
  diagnosticRunId: string;
  diagnosticFinding: string;
  profileId: string;
  siteId: string;
  publicationId: string;
  action: "reload_managed_website";
  finding: HostWebsiteHealthSummary["reason"];
  risk: "low";
  status: HostRemediationPlanStatus;
  phase: "awaiting_confirmation" | "preflight" | "change_pending" | "verification" | "finished";
  checks: string[];
  impact: "brief_connections_may_retry";
  filesChanged: false;
  initialHealth: HostWebsiteHealthSummary;
  revision: number;
  expiresAt: string;
  createdAt: string;
  confirmedAt?: string | null;
  completedAt?: string | null;
  lastRecheckedAt?: string | null;
  lastRecheckedHealth?: HostWebsiteHealthSummary | null;
  result: HostRemediationResult | null;
}

export type HostHealthStatus = "healthy" | "needs_attention" | "paused" | "unknown";

export interface HostHealthPolicy {
  enabled: boolean;
  cadence: "every_6_hours" | "daily";
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: HostHealthStatus | null;
  revision: number;
}

export interface HostHealthFinding {
  key: string;
  action: HostDiagnosticAction | "connection";
  severity: "warning" | "critical";
  finding: string;
  impact: string;
  nextAction: string;
}

export interface HostHealthSnapshot {
  id: string;
  version: 1;
  source: "manual" | "scheduled";
  status: HostHealthStatus;
  reason: "sign_in_required" | "setup_required" | "device_unreachable" | "check_incomplete" | "findings_detected" | "no_obvious_issue";
  severity: HostDiagnosticSeverity;
  findings: HostHealthFinding[];
  checkedActions: Array<HostDiagnosticAction | "connection">;
  diagnosticRunId: string | null;
  checkedAt: string;
}

export interface HostHealthIncident extends HostHealthFinding {
  id: string;
  status: "open" | "recovered";
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  openedAt: string | null;
  recoveredAt: string | null;
}

export interface HostHealthOverview {
  policy: HostHealthPolicy;
  latestSnapshot: HostHealthSnapshot | null;
  snapshots: HostHealthSnapshot[];
  incidents: HostHealthIncident[];
  openIncidentCount: number;
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
