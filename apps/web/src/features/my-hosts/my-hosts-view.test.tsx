import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { i18n } from "@/lib/i18n";
import { ApiError } from "@/lib/api/request";
import { useUiStore } from "@/store/ui-store";
import { hostApi } from "./host-api";
import type { HostFileScope, HostOperationsPilotCampaign, HostRemediationPlan, HostTlsActivationProfile, SshHost } from "./host-types";
import { MyHostsView } from "./my-hosts-view";

vi.mock("./host-api", () => ({ MAX_HOST_UPLOAD_BYTES: 10 * 1024 * 1024, MAX_HOST_DOWNLOAD_BYTES: 25 * 1024 * 1024, hostApi: {
  list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), observeFingerprint: vi.fn(), confirmFingerprint: vi.fn(), verify: vi.fn(),
  scopes: vi.fn(), scopeSuggestions: vi.fn(), createScope: vi.fn(), updateScope: vi.fn(), entries: vi.fn(), search: vi.fn(), preview: vi.fn(), transfers: vi.fn(), upload: vi.fn(), download: vi.fn(), diagnose: vi.fn(), planDiagnostic: vi.fn(), diagnoseIssue: vi.fn(), operationCases: vi.fn(), operationMetrics: vi.fn(), diagnoseCase: vi.fn(), planRemediation: vi.fn(), confirmRemediation: vi.fn(), remediationPlans: vi.fn(), remediationPlan: vi.fn(), recheckRemediation: vi.fn(), health: vi.fn(), checkHealth: vi.fn(), setHealthMonitoring: vi.fn(), tlsProfiles: vi.fn(), createTlsProfile: vi.fn(), operationsPilotCampaigns: vi.fn(), createOperationsPilotCampaign: vi.fn(), closeOperationsPilotCampaign: vi.fn(), activeOperationsPilotSession: vi.fn(), startOperationsPilotSession: vi.fn(), completeOperationsPilotSession: vi.fn(), withdrawOperationsPilotSession: vi.fn(), operationsPilotEvidence: vi.fn(),
} }));

const host: SshHost = {
  id: "ssh_target_1", name: "Production website host", host: "host.example", port: 22, user: "deploy",
  authMethod: "private_key_ref", credentialRef: "credential://ssh/ssh_target_1", purposes: ["file_transfer", "site_publish"],
  networkPolicy: "public_only", knownHostFingerprint: "SHA256:abcdefghijklmnopqrstuvwxyz0123456789ABCDE12", observedFingerprint: "SHA256:abcdefghijklmnopqrstuvwxyz0123456789ABCDE12",
  connectionStatus: "ready", capabilities: { sftp: true, sftpVersion: 3, posixRename: true, symlink: true }, lastConnectionError: null,
  verifiedAt: "2026-08-25T00:00:00.000Z", revision: 4,
};
const scope: HostFileScope = {
  id: "hfs_1", sshTargetId: host.id, label: "Website files", purpose: "site_publish", rootPath: "/srv/www/site", resolvedRootPath: "/srv/www/site",
  permissions: ["list"], status: "ready", revision: 1, lastVerifiedAt: "2026-08-25T00:00:00.000Z",
};
const tlsProfile: HostTlsActivationProfile = {
  id: "htp_1", sshTargetId: host.id, certificateScopeId: "hfs_tls", label: "Production website",
  type: "docker_nginx", containerName: "site-nginx", status: "ready", lastVerifiedAt: "2026-08-25T00:00:00.000Z", revision: 2,
};
const remediationPlan: HostRemediationPlan = {
  id: "hrp_1", sshTargetId: host.id, diagnosticRunId: "hdr_website", diagnosticFinding: "host_critical_findings", profileId: tlsProfile.id,
  siteId: "site_1", publicationId: "spb_1", action: "reload_managed_website", finding: "website_unreachable", risk: "low", status: "planned", phase: "awaiting_confirmation",
  checks: ["website_health", "container_running", "configuration_valid", "reload_service", "container_running", "configuration_valid", "website_health"],
  impact: "brief_connections_may_retry", filesChanged: false, initialHealth: { status: "unhealthy", reason: "website_unreachable", statusCodeClass: null, contentMatched: false, checkedAt: "2026-08-29T00:00:00.000Z" },
  revision: 1, createdAt: "2026-08-29T00:00:00.000Z", expiresAt: "2026-08-29T00:10:00.000Z", result: null,
};

const pilotCampaign: HostOperationsPilotCampaign = {
  id: "hopc_1", label: "September operations pilot", inviteCode: "pilot-code", status: "active", revision: 1,
  createdAt: "2026-09-01T00:00:00.000Z", activatedAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:05:00.000Z", closedAt: null,
  summary: {
    version: 1, generatedAt: "2026-09-01T00:05:00.000Z",
    participation: { total: 2, active: 1, completed: 1 },
    experience: { nextStepClear: { numerator: 1, denominator: 1, rate: 1 }, averageEaseRating: 4 },
    operations: { version: 1, generatedAt: "2026-09-01T00:05:00.000Z", cases: { total: 2, active: 1, terminal: 1, recovered: 1, unresolved: 0, changed: 1, manualHandoff: 0, recoveryRate: 1, changeRate: 0.5 }, remediation: { total: 1, terminal: 1, safeAbort: 0, unknownOutcome: 0, completed: 1, noChangeNeeded: 0 }, timing: { completedCaseCount: 1, averageCaseSeconds: 90, latestCaseUpdatedAt: "2026-09-01T00:04:00.000Z" } },
    bottlenecks: [{ nextStep: "check_managed_website", count: 1 }],
    privacy: { rawInputCollected: false, commandOutputCollected: false, addressCollected: false, credentialsCollected: false, freeTextCollected: false, participantIdentityExported: false },
  },
};

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MyHostsView /></QueryClientProvider>);
}

beforeEach(async () => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/?section=myHosts");
  delete window.myagenttoolDesktop;
  await i18n.changeLanguage("en-US");
  useUiStore.setState({ experienceMode: "professional" });
  vi.mocked(hostApi.list).mockResolvedValue({ hosts: [host], count: 1 });
  vi.mocked(hostApi.scopes).mockResolvedValue({ scopes: [scope], count: 1 });
  vi.mocked(hostApi.scopeSuggestions).mockResolvedValue({ suggestions: [{ rootPath: "/srv/myagenttool-sites/server001-lan-e2e", label: "server001 lan e2e", purpose: "site_publish", reason: "managed_site", recommended: true }], count: 1 });
  vi.mocked(hostApi.createScope).mockResolvedValue({ scope });
  vi.mocked(hostApi.entries).mockResolvedValue({ scope, path: "", count: 3, entries: [
    { name: "assets", path: "assets", type: "directory", accessible: true, size: null, modifiedAt: null },
    { name: "index.html", path: "index.html", type: "file", accessible: true, size: 1200, modifiedAt: null },
    { name: "current", path: "current", type: "symlink", accessible: false, size: null, modifiedAt: null },
  ] });
  vi.mocked(hostApi.transfers).mockResolvedValue({ transfers: [], count: 0 });
  vi.mocked(hostApi.tlsProfiles).mockResolvedValue({ profiles: [], count: 0 });
  vi.mocked(hostApi.remediationPlans).mockResolvedValue({ plans: [], count: 0 });
  vi.mocked(hostApi.operationCases).mockResolvedValue({ cases: [], count: 0, activeCase: null });
  vi.mocked(hostApi.operationMetrics).mockResolvedValue({ metrics: { version: 1, generatedAt: "2026-09-01T00:00:00.000Z", cases: { total: 0, active: 0, terminal: 0, recovered: 0, unresolved: 0, changed: 0, manualHandoff: 0, recoveryRate: null, changeRate: null }, remediation: { total: 0, terminal: 0, safeAbort: 0, unknownOutcome: 0, completed: 0, noChangeNeeded: 0 }, timing: { completedCaseCount: 0, averageCaseSeconds: null, latestCaseUpdatedAt: null } } });
  vi.mocked(hostApi.operationsPilotCampaigns).mockResolvedValue({ campaigns: [], count: 0 });
  vi.mocked(hostApi.activeOperationsPilotSession).mockResolvedValue({ campaign: null, session: null });
  vi.mocked(hostApi.remediationPlan).mockResolvedValue({ plan: remediationPlan });
  vi.mocked(hostApi.health).mockResolvedValue({
    policy: { enabled: false, cadence: "daily", nextRunAt: null, lastRunAt: null, lastRunStatus: null, revision: 0 },
    latestSnapshot: null, snapshots: [], incidents: [], openIncidentCount: 0,
  });
  vi.mocked(hostApi.checkHealth).mockResolvedValue({ snapshot: {
    id: "hhs_1", version: 1, source: "manual", status: "healthy", reason: "no_obvious_issue", severity: "healthy",
    findings: [], checkedActions: ["disk_usage"], diagnosticRunId: "hdr_health", checkedAt: "2026-08-29T00:00:00.000Z",
  } });
  vi.mocked(hostApi.setHealthMonitoring).mockResolvedValue({ policy: { enabled: true, cadence: "daily", nextRunAt: "2026-08-30T00:00:00.000Z", lastRunAt: null, lastRunStatus: null, revision: 1 } });
  vi.mocked(hostApi.recheckRemediation).mockResolvedValue({ plan: { ...remediationPlan, status: "outcome_unknown", phase: "finished", lastRecheckedAt: "2026-08-29T00:03:00.000Z", lastRecheckedHealth: { status: "healthy", reason: "website_healthy", statusCodeClass: 2, contentMatched: true, checkedAt: "2026-08-29T00:03:00.000Z" } } });
  vi.mocked(hostApi.planRemediation).mockResolvedValue({ plan: remediationPlan, reused: false });
  vi.mocked(hostApi.confirmRemediation).mockResolvedValue({ plan: { ...remediationPlan, status: "completed", revision: 3, result: { outcome: "restored", changeAttempted: true, verification: "passed", completedChecks: ["preflight_container_running", "preflight_configuration_valid", "service_reloaded", "verification_container_running", "verification_configuration_valid"] } }, reused: false });
  vi.mocked(hostApi.diagnose).mockResolvedValue({ result: { action: "disk_usage", command: "df -h", output: "Filesystem\n/dev/sda1 20G 8G 12G 40% /", summary: { version: 1, severity: "healthy", finding: "disk_capacity_healthy", impact: "no_issue_detected", nextAction: "no_action_needed", facts: [{ key: "disk_used_percent", value: "40%", severity: "healthy" }] } } });
  vi.mocked(hostApi.planDiagnostic).mockResolvedValue({ plan: { action: "disk_usage", command: "df -h", risk: "read_only" } });
  vi.mocked(hostApi.diagnoseIssue).mockResolvedValue({ run: {
    id: "hdr_performance", targetRevision: host.revision, createdAt: "2026-08-29T00:00:00.000Z", version: 1, intent: "performance", risk: "read_only", primaryAction: "disk_usage",
    understanding: { version: 1, goal: "improve", domain: "performance", symptom: "slow", desiredOutcome: "improve_performance", requestedChange: "none", handling: "read_only_diagnosis", confidence: "high" },
    summary: { version: 1, severity: "warning", finding: "host_warnings_found", impact: "host_attention_recommended", nextAction: "review_warning_findings", facts: [
      { key: "diagnostic_completed_count", value: "2", severity: "info" },
      { key: "diagnostic_issue_count", value: "1", severity: "warning" },
      { key: "diagnostic_unavailable_count", value: "0", severity: "healthy" },
    ] },
    steps: [
      { action: "disk_usage", status: "completed", summary: { version: 1, severity: "critical", finding: "disk_capacity_critical", impact: "file_operations_may_fail", nextAction: "free_device_space", facts: [{ key: "disk_used_percent", value: "95%", severity: "critical" }] } },
      { action: "processes", status: "completed", summary: { version: 1, severity: "info", finding: "process_activity_ready", impact: "information_only", nextAction: "review_process_activity", facts: [] } },
    ],
  } });
  vi.mocked(hostApi.diagnoseCase).mockImplementation(async (hostId, input, incidentId) => {
    const response = await hostApi.diagnoseIssue(hostId, input ?? "");
    const understanding = response.run.understanding ?? { version: 1 as const, goal: "inspect" as const, domain: "device" as const, symptom: "unspecified" as const, desiredOutcome: "understand_state" as const, requestedChange: "none" as const, handling: "read_only_diagnosis" as const, confidence: "medium" as const };
    return { case: {
      id: "hoc_1", sshTargetId: hostId, incidentId: incidentId ?? null, version: 1, intent: response.run.intent, understanding,
      status: "diagnosed", nextStep: response.run.intent === "website" ? "check_managed_website" : "review_findings",
      diagnosticRunId: response.run.id, remediationPlanId: null, targetRevision: response.run.targetRevision, deviceChanged: false, lastError: null,
      timeline: [{ kind: "case_opened", at: response.run.createdAt, deviceChanged: false }, { kind: "diagnosis_completed", at: response.run.createdAt, deviceChanged: false, diagnosticRunId: response.run.id, severity: response.run.summary.severity }],
      latestRun: response.run, createdAt: response.run.createdAt, updatedAt: response.run.createdAt,
    }, run: response.run, reused: false };
  });
});
afterEach(() => cleanup());

it("loads owned hosts directly in Ordinary mode while hiding professional metadata", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  renderView();
  expect(await screen.findByRole("heading", { name: "My hosts" })).toBeTruthy();
  expect((await screen.findAllByText("Production website host")).length).toBe(2);
  expect(screen.getByRole("button", { name: "Home" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Files" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Recent activity" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
  expect(screen.queryByText("deploy@host.example:22")).toBeNull();
  expect(screen.queryByText("host.example")).toBeNull();
  expect(screen.getByText("My folders")).toBeTruthy();
  expect(screen.getByText("Ready to check this device")).toBeTruthy();
  expect(hostApi.list).toHaveBeenCalledTimes(1);
  expect(useUiStore.getState().experienceMode).toBe("ordinary");

  fireEvent.click(screen.getByRole("button", { name: "Add device" }));
  expect(await screen.findByRole("heading", { name: "Connect my device" })).toBeTruthy();
  expect((screen.getByLabelText("Device address") as HTMLInputElement).value).toBe("");
});

it("keeps complete connection metadata and settings available in Professional mode", async () => {
  renderView();
  expect(await screen.findByText("deploy@host.example:22")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
  expect(screen.getByText("File ranges")).toBeTruthy();
  expect(screen.getByText("Governed transfers")).toBeTruthy();
});

it("shows the professional operations pilot loop with invitation, bottleneck, and evidence actions", async () => {
  vi.mocked(hostApi.operationsPilotCampaigns).mockResolvedValue({ campaigns: [pilotCampaign], count: 1 });
  renderView();

  expect(await screen.findByText("Operations pilot loop")).toBeTruthy();
  expect(screen.getByText("September operations pilot")).toBeTruthy();
  expect(screen.getByText("100%")).toBeTruthy();
  expect(screen.getByText("4/5")).toBeTruthy();
  expect(screen.getByText(/check the real website/i)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Copy trial link" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Export evidence" })).toBeTruthy();
  expect(screen.getByText(/does not block releases/i)).toBeTruthy();
});

it("collects explicit participant consent and structured feedback after a terminal operations case", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  window.history.replaceState({}, "", "/?section=myHosts&hostPilot=pilot-code");
  const session = {
    id: "hops_1", campaignId: pilotCampaign.id, sshTargetId: host.id, status: "active" as const, revision: 1,
    startedAt: "2026-09-01T00:01:00.000Z", completedAt: null, outcome: null,
    latestCase: { id: "hoc_1", status: "recovered" as const, nextStep: "case_complete" as const, updatedAt: "2026-09-01T00:04:00.000Z" },
  };
  vi.mocked(hostApi.activeOperationsPilotSession).mockResolvedValue({ campaign: { id: pilotCampaign.id, label: pilotCampaign.label, status: "active" }, session });
  vi.mocked(hostApi.completeOperationsPilotSession).mockResolvedValue({ session: { ...session, status: "completed", revision: 2, completedAt: "2026-09-01T00:05:00.000Z", outcome: { caseId: "hoc_1", nextStepClear: true, easeRating: 4 } } });
  renderView();

  expect(await screen.findByText("The operation ended. Complete two feedback items")).toBeTruthy();
  expect(screen.getByText(/does not record the raw issue, device address, command, output, or credential/i)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Clear" }));
  fireEvent.change(screen.getByLabelText("Overall ease"), { target: { value: "5" } });
  fireEvent.click(screen.getByRole("button", { name: "Complete and submit" }));
  await waitFor(() => expect(hostApi.completeOperationsPilotSession).toHaveBeenCalledWith("hops_1", {
    expectedRevision: 1, caseId: "hoc_1", nextStepClear: true, easeRating: 5,
  }));
});

it("gives ordinary users one clear health check and opt-in daily care without technical output", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  renderView();

  expect(await screen.findByText("Device care")).toBeTruthy();
  expect(screen.getByText("No health record yet")).toBeTruthy();
  expect(screen.getByText(/never cleans, restarts, or changes the device automatically/i)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Check now" }));
  await waitFor(() => expect(hostApi.checkHealth).toHaveBeenCalledWith(host.id));
  fireEvent.click(screen.getByRole("button", { name: "Check daily for me" }));
  await waitFor(() => expect(hostApi.setHealthMonitoring).toHaveBeenCalledWith(host.id, { enabled: true, cadence: "daily" }));
  expect(screen.queryByText("df -h")).toBeNull();
});

it("explains an open health incident and continues with the matching read-only diagnosis", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  vi.mocked(hostApi.list).mockResolvedValue({ hosts: [{ ...host, healthSummary: { status: "needs_attention", checkedAt: "2026-08-29T00:00:00.000Z", openIncidentCount: 1, monitoringEnabled: true } }], count: 1 });
  vi.mocked(hostApi.health).mockResolvedValue({
    policy: { enabled: true, cadence: "daily", nextRunAt: "2026-08-30T00:00:00.000Z", lastRunAt: "2026-08-29T00:00:00.000Z", lastRunStatus: "needs_attention", revision: 2 },
    latestSnapshot: {
      id: "hhs_warning", version: 1, source: "scheduled", status: "needs_attention", reason: "findings_detected", severity: "critical",
      findings: [{ key: "disk_usage:disk_capacity_critical", action: "disk_usage", severity: "critical", finding: "disk_capacity_critical", impact: "file_operations_may_fail", nextAction: "free_device_space" }],
      checkedActions: ["connection", "disk_usage"], diagnosticRunId: "hdr_health", checkedAt: "2026-08-29T00:00:00.000Z",
    },
    snapshots: [],
    incidents: [{
      id: "hhi_disk", key: "disk_usage:disk_capacity_critical", action: "disk_usage", severity: "critical", finding: "disk_capacity_critical", impact: "file_operations_may_fail", nextAction: "free_device_space",
      status: "open", occurrenceCount: 2, firstSeenAt: "2026-08-28T18:00:00.000Z", lastSeenAt: "2026-08-29T00:00:00.000Z", openedAt: "2026-08-29T00:00:00.000Z", recoveredAt: null,
    }],
    openIncidentCount: 1,
  });
  renderView();

  expect((await screen.findAllByText("Needs attention")).length).toBeGreaterThan(0);
  expect(await screen.findByText("Device space is critically low")).toBeTruthy();
  expect(screen.getByText("Uploads, saves, or publishing may fail.")).toBeTruthy();
  expect(screen.getByText("Free some device space, then retry the operation.")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Continue checking" }));
  await waitFor(() => expect(hostApi.diagnoseIssue).toHaveBeenCalledWith(host.id, "Check disk space"));
  expect((screen.getByPlaceholderText("For example: who signed in recently?") as HTMLInputElement).value).toBe("Check disk space");
  expect(await screen.findByText("Combined check complete · 2/2")).toBeTruthy();
});

it("restores a stored desktop credential and reconnects after restart without asking for it again", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  const unavailableHost: SshHost = {
    ...host,
    authMethod: "password_ref",
    connectionStatus: "error",
    capabilities: null,
    lastConnectionError: { code: "ssh_credential_unavailable", at: "2026-08-29T00:00:00.000Z" },
  };
  const readyHost: SshHost = { ...host, authMethod: "password_ref" };
  vi.mocked(hostApi.list).mockResolvedValueOnce({ hosts: [unavailableHost], count: 1 }).mockResolvedValue({ hosts: [readyHost], count: 1 });
  vi.mocked(hostApi.verify).mockResolvedValue({ host: readyHost, verification: { capabilities: readyHost.capabilities } });
  const getSshHostCredentialStatus = vi.fn().mockResolvedValue({
    desktop: true, secureStorage: true, stored: true, ready: true,
    reference: readyHost.credentialRef, authMethod: "password_ref",
  });
  const saveSshHostCredential = vi.fn();
  window.myagenttoolDesktop = { getSshHostCredentialStatus, saveSshHostCredential };
  renderView();

  await waitFor(() => expect(getSshHostCredentialStatus).toHaveBeenCalledWith({ hostId: host.id }));
  await waitFor(() => expect(hostApi.verify).toHaveBeenCalledWith(host.id));
  await waitFor(() => expect(screen.getByText("Ready to check this device")).toBeTruthy());
  expect(saveSshHostCredential).not.toHaveBeenCalled();
});

it("gives an ordinary user one plain recovery action for invalid sign-in details", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  vi.mocked(hostApi.list).mockResolvedValue({ hosts: [{
    ...host,
    authMethod: "password_ref",
    connectionStatus: "error",
    lastConnectionError: { code: "ssh_authentication_failed", at: "2026-08-27T00:00:00.000Z" },
  }], count: 1 });
  renderView();

  expect(await screen.findByText("Sign-in details need updating")).toBeTruthy();
  expect(screen.getByText(/The host did not accept the credential.*no files were accessed/)).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Update sign-in details" })).toHaveLength(1);
  expect(screen.queryByText("ssh_authentication_failed")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Update sign-in details" }));
  expect(await screen.findByRole("heading", { name: "Update sign-in details" })).toBeTruthy();
  expect(screen.getByText(/previous check will not run automatically/)).toBeTruthy();
  expect(screen.queryByPlaceholderText("Leave blank to reuse the securely stored password")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Save and reconnect" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Enter the login password");
  expect(hostApi.update).not.toHaveBeenCalled();
});

it("saves repaired credentials, verifies the existing host, and closes without rerunning work", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  const credentialErrorHost: SshHost = {
    ...host,
    authMethod: "password_ref",
    connectionStatus: "error",
    capabilities: null,
    lastConnectionError: { code: "ssh_credential_unavailable", at: "2026-08-28T00:00:00.000Z" },
  };
  const updatedHost: SshHost = { ...credentialErrorHost, connectionStatus: "untested", lastConnectionError: null, revision: 5 };
  const observedHost: SshHost = { ...updatedHost, observedFingerprint: host.knownHostFingerprint, revision: 6 };
  const readyHost: SshHost = { ...host, authMethod: "password_ref", revision: 7 };
  vi.mocked(hostApi.list).mockResolvedValueOnce({ hosts: [credentialErrorHost], count: 1 }).mockResolvedValue({ hosts: [readyHost], count: 1 });
  vi.mocked(hostApi.update).mockResolvedValue({ host: updatedHost });
  vi.mocked(hostApi.observeFingerprint).mockResolvedValue({ host: observedHost, observation: { fingerprint: host.knownHostFingerprint!, resolvedAddress: "203.0.113.10" } });
  vi.mocked(hostApi.verify).mockResolvedValue({ host: readyHost, verification: { capabilities: readyHost.capabilities } });
  const saveSshHostCredential = vi.fn().mockResolvedValue({ ok: true, reference: host.credentialRef, authMethod: "password_ref" });
  const getSshHostCredentialStatus = vi.fn();
  window.myagenttoolDesktop = { saveSshHostCredential, getSshHostCredentialStatus };
  renderView();

  fireEvent.click(await screen.findByRole("button", { name: "Update sign-in details" }));
  expect(getSshHostCredentialStatus).toHaveBeenCalledWith({ hostId: host.id });
  fireEvent.change(screen.getByLabelText("Login password"), { target: { value: "replacement-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Save and reconnect" }));

  await waitFor(() => expect(saveSshHostCredential).toHaveBeenCalledWith(expect.objectContaining({ hostId: host.id, password: "replacement-password" })));
  expect(hostApi.update).toHaveBeenCalledWith(host.id, expect.objectContaining({ expectedRevision: credentialErrorHost.revision }));
  expect(hostApi.observeFingerprint).toHaveBeenCalledWith(host.id);
  expect(hostApi.verify).toHaveBeenCalledWith(host.id);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(hostApi.createScope).not.toHaveBeenCalled();
  expect(hostApi.diagnose).not.toHaveBeenCalled();
});

it("distinguishes an offline device from an unavailable SSH service for ordinary users", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  vi.mocked(hostApi.list).mockResolvedValue({ hosts: [{
    ...host,
    connectionStatus: "error",
    lastConnectionError: { code: "ssh_connection_refused", at: "2026-08-27T00:00:00.000Z" },
  }], count: 1 });
  renderView();

  expect((await screen.findAllByText("Connection service is off")).length).toBeGreaterThan(0);
  expect(screen.getByText("The device is online, but its connection service is off")).toBeTruthy();
  expect(screen.getByText(/No files were accessed.*Remote Login or SSH/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Check connection settings" })).toBeTruthy();
  expect(screen.queryByText("ssh_connection_refused")).toBeNull();
});

it("tells an ordinary user when a device is offline without implying file changes", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  vi.mocked(hostApi.list).mockResolvedValue({ hosts: [{
    ...host,
    connectionStatus: "error",
    lastConnectionError: { code: "ssh_connection_timeout", at: "2026-08-27T00:00:00.000Z" },
  }], count: 1 });
  renderView();

  expect((await screen.findAllByText("Device offline")).length).toBeGreaterThan(0);
  expect(screen.getByText("The device is temporarily offline")).toBeTruthy();
  expect(screen.getByText(/No device files were accessed/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Retry when online" })).toBeTruthy();
});

it("asks ordinary users to confirm the device without fingerprint jargon", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  vi.mocked(hostApi.list).mockResolvedValue({ hosts: [{
    ...host,
    connectionStatus: "fingerprint_pending",
    knownHostFingerprint: null,
    lastConnectionError: null,
  }], count: 1 });
  renderView();

  expect((await screen.findAllByText("Confirm device")).length).toBeGreaterThan(0);
  expect(screen.getByText("Confirm this is your device")).toBeTruthy();
  expect(screen.queryByText("Confirm fingerprint")).toBeNull();
  expect(screen.queryByText("Waiting for fingerprint confirmation")).toBeNull();
});

it("keeps certificate infrastructure out of the ordinary file view", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  vi.mocked(hostApi.scopes).mockResolvedValue({ scopes: [{
    ...scope,
    label: "Website HTTPS",
    purpose: "tls_certificate",
    permissions: ["certificate_write"],
  }], count: 1 });
  renderView();

  fireEvent.click(await screen.findByRole("button", { name: "Files" }));
  expect(await screen.findByText("Managed by My Site")).toBeTruthy();
  expect(screen.getByText("This folder is safely managed by My Site")).toBeTruthy();
  expect(screen.queryByText(/Docker Nginx/i)).toBeNull();
  expect(screen.queryByLabelText("Docker Nginx container name")).toBeNull();
  expect(hostApi.tlsProfiles).not.toHaveBeenCalled();
});

it("replaces raw transfer errors with an ordinary recovery message", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  vi.mocked(hostApi.scopes).mockResolvedValue({ scopes: [{ ...scope, permissions: ["list", "download"] }], count: 1 });
  vi.mocked(hostApi.transfers).mockResolvedValue({ count: 1, transfers: [{
    id: "hft_timeout", sshTargetId: host.id, scopeId: scope.id, direction: "download", status: "failed", remotePath: "reports/summary.pdf", remoteDirectory: "reports", fileName: "summary.pdf",
    bytesTotal: 1200, bytesTransferred: 400, progress: 33, conflictPolicy: null, attempt: 1, maxAttempts: 3, retryOf: null, errorCode: "ssh_connection_timeout", createdAt: "2026-08-27T00:00:00.000Z", completedAt: "2026-08-27T00:00:01.000Z",
  }] });
  renderView();

  fireEvent.click(await screen.findByRole("button", { name: "Recent activity" }));
  expect(await screen.findByText(/The connection timed out.*You can safely retry/)).toBeTruthy();
  expect(screen.queryByText("ssh_connection_timeout")).toBeNull();
  expect(screen.queryByText("/reports/summary.pdf")).toBeNull();
  expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
});

it("never falls back to an unknown API error code in ordinary mode", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  vi.mocked(hostApi.scopes).mockResolvedValue({ scopes: [{ ...scope, permissions: ["list", "download"] }], count: 1 });
  vi.mocked(hostApi.transfers).mockResolvedValue({ count: 1, transfers: [{
    id: "hft_unknown", sshTargetId: host.id, scopeId: scope.id, direction: "download", status: "failed", remotePath: "reports/summary.pdf", remoteDirectory: "reports", fileName: "summary.pdf",
    bytesTotal: 1200, bytesTransferred: 0, progress: 0, conflictPolicy: null, attempt: 1, maxAttempts: 3, retryOf: null, errorCode: "remote_private_detail_123", createdAt: "2026-08-27T00:00:00.000Z", completedAt: "2026-08-27T00:00:01.000Z",
  }] });
  renderView();

  fireEvent.click(await screen.findByRole("button", { name: "Recent activity" }));
  expect(await screen.findByText(/operation could not be completed/i)).toBeTruthy();
  expect(screen.queryByText("remote_private_detail_123")).toBeNull();
});

it("requires inspection before retrying permission, capacity, or interrupted transfer failures", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  vi.mocked(hostApi.scopes).mockResolvedValue({ scopes: [{ ...scope, permissions: ["list", "upload"] }], count: 1 });
  const base = {
    sshTargetId: host.id, scopeId: scope.id, direction: "upload" as const, status: "failed" as const, remoteDirectory: "reports",
    bytesTotal: 1200, bytesTransferred: 400, progress: 33, conflictPolicy: "rename" as const, attempt: 1, maxAttempts: 3, retryOf: null,
    createdAt: "2026-08-27T00:00:00.000Z", completedAt: "2026-08-27T00:00:01.000Z",
  };
  vi.mocked(hostApi.transfers).mockResolvedValue({ count: 4, transfers: [
    { ...base, id: "hft_permission", remotePath: "reports/permission.txt", fileName: "permission.txt", errorCode: "ssh_sftp_permission_denied" },
    { ...base, id: "hft_space", remotePath: "reports/space.txt", fileName: "space.txt", errorCode: "ssh_sftp_no_space" },
    { ...base, id: "hft_interrupted", remotePath: "reports/interrupted.txt", fileName: "interrupted.txt", errorCode: "host_file_transfer_interrupted" },
    { ...base, id: "hft_long", status: "running", remotePath: "reports/long.txt", fileName: "long.txt", errorCode: null, startedAt: new Date(Date.now() - 60_000).toISOString(), completedAt: null },
  ] });
  renderView();

  fireEvent.click(await screen.findByRole("button", { name: "Recent activity" }));
  expect(await screen.findByText(/no longer allows access.*file result may be incomplete/i)).toBeTruthy();
  expect(screen.getByText(/ran out of space.*file result may be incomplete/i)).toBeTruthy();
  expect(screen.getByText(/stopped before confirming.*completion is unknown/i)).toBeTruthy();
  expect(screen.getByText("Taking longer")).toBeTruthy();
  expect(screen.getByText(/taking longer than usual.*file state on the device is unknown/i)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(screen.getByRole("button", { name: "Check folder" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Check device space" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Check file" })).toBeTruthy();
  expect(screen.queryByText("ssh_sftp_permission_denied")).toBeNull();
  expect(screen.queryByText("host_file_transfer_interrupted")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Check device space" }));
  expect(await screen.findByTestId("host-assistant")).toBeTruthy();
});

it("opens host setup from Ordinary mode without changing the experience mode", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  vi.mocked(hostApi.list).mockResolvedValue({ hosts: [], count: 0 });
  renderView();

  fireEvent.click((await screen.findAllByRole("button", { name: "Add device" }))[0]);
  expect(await screen.findByRole("heading", { name: "Connect my device" })).toBeTruthy();
  expect(screen.getByLabelText("Device address")).toBeTruthy();
  expect(screen.getByText("1. Connect device")).toBeTruthy();
  expect(hostApi.list).toHaveBeenCalled();
  expect(useUiStore.getState().experienceMode).toBe("ordinary");
});

it("guides an ordinary user through local permission, device identity, and the recommended folder", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  vi.mocked(hostApi.list).mockResolvedValue({ hosts: [], count: 0 });
  const createdHost = { ...host, host: "10.10.10.222", authMethod: "password_ref" as const, networkPolicy: "allow_private_network" as const, connectionStatus: "untested" as const, knownHostFingerprint: null, observedFingerprint: null, capabilities: null, verifiedAt: null, revision: 1 };
  const observedHost = { ...createdHost, connectionStatus: "fingerprint_pending" as const, observedFingerprint: host.observedFingerprint, revision: 2 };
  const confirmedHost = { ...observedHost, connectionStatus: "untested" as const, knownHostFingerprint: host.observedFingerprint, revision: 3 };
  const readyHost = { ...host, host: "10.10.10.222", authMethod: "password_ref" as const, networkPolicy: "allow_private_network" as const };
  vi.mocked(hostApi.create).mockResolvedValue({ target: createdHost });
  vi.mocked(hostApi.observeFingerprint).mockResolvedValue({ host: observedHost, observation: { fingerprint: host.observedFingerprint!, resolvedAddress: "10.10.10.222" } });
  vi.mocked(hostApi.confirmFingerprint).mockResolvedValue({ host: confirmedHost });
  vi.mocked(hostApi.verify).mockResolvedValue({ host: readyHost, verification: { capabilities: readyHost.capabilities } });
  window.myagenttoolDesktop = { saveSshHostCredential: vi.fn().mockResolvedValue({ ok: true, reference: host.credentialRef, authMethod: "password_ref" }) };
  renderView();

  fireEvent.click((await screen.findAllByRole("button", { name: "Add device" }))[0]);
  fireEvent.change(screen.getByLabelText("Device address"), { target: { value: "10.10.10.222" } });
  fireEvent.change(screen.getByLabelText("Login password"), { target: { value: "test-password" } });
  const localConsent = screen.getByLabelText(/Allow access to my local device/);
  expect((localConsent as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Connect this device" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Confirm that MyAgentTool may connect to this local-network device");
  expect(hostApi.create).not.toHaveBeenCalled();

  fireEvent.click(localConsent);
  fireEvent.click(screen.getByRole("button", { name: "Connect this device" }));
  await waitFor(() => expect(hostApi.create).toHaveBeenCalledWith(expect.objectContaining({ host: "10.10.10.222", networkPolicy: "allow_private_network" })));
  expect(await screen.findByRole("heading", { name: "Confirm this is my device" })).toBeTruthy();
  const fingerprintDetails = screen.getByText("View technical fingerprint").closest("details");
  expect(fingerprintDetails?.open).toBe(false);
  const identityConfirmation = screen.getByLabelText("I confirm this is the device I intend to connect to.");
  const confirmButton = screen.getByRole("button", { name: "Confirm device and continue" }) as HTMLButtonElement;
  expect(confirmButton.disabled).toBe(true);
  fireEvent.click(identityConfirmation);
  fireEvent.click(confirmButton);

  expect(await screen.findByRole("heading", { name: "Choose a folder MyAgentTool may use" })).toBeTruthy();
  const recommended = await screen.findByRole("radio", { name: /server001 lan e2e/ });
  expect((recommended as HTMLInputElement).checked).toBe(true);
  expect(screen.getByText("Folder permissions").closest("details")?.open).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Use this folder and finish" }));
  await waitFor(() => expect(hostApi.createScope).toHaveBeenCalledWith(host.id, expect.objectContaining({ rootPath: "/srv/myagenttool-sites/server001-lan-e2e" })));
});

it("keeps a list-only range read-only and links inaccessible", async () => {
  renderView();
  expect((await screen.findAllByText("Production website host")).length).toBe(2);
  fireEvent.click(screen.getByRole("button", { name: "Remote files" }));
  expect(await screen.findByText("index.html")).toBeTruthy();
  expect(screen.getByText("1.2 KB")).toBeTruthy();
  expect(screen.getByTestId("directory-summary").textContent).toContain("1.2 KB");
  expect(screen.getByText("Shortcut: open the matching real folder")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /upload/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /download/i })).toBeNull();
  expect(hostApi.entries).toHaveBeenCalledWith("hfs_1", "");
  expect(screen.getByText(/allows name search only/i)).toBeTruthy();
});

it("finds approved files for an ordinary user without showing matched text or technical scan details", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  const readableScope = { ...scope, permissions: ["list", "download"] as HostFileScope["permissions"] };
  vi.mocked(hostApi.scopes).mockResolvedValue({ scopes: [readableScope], count: 1 });
  vi.mocked(hostApi.search).mockResolvedValue({
    scopeId: scope.id,
    scopeRevision: scope.revision,
    count: 2,
    contentSearchEnabled: true,
    results: [
      { name: "deployment.md", path: "docs/deployment.md", type: "file", accessible: true, size: 1200, modifiedAt: null, matchKind: "content", previewKind: "text", restricted: false },
      { name: ".env", path: ".env", type: "file", accessible: true, size: 20, modifiedAt: null, matchKind: "name", previewKind: null, restricted: true },
    ],
    boundaries: { scannedEntries: 32, scannedTextFiles: 4, readBytes: 2048, skippedEntries: 1, truncated: false, maxDepth: 5, maxEntries: 500, maxResults: 50 },
  });
  renderView();

  fireEvent.click(await screen.findByRole("button", { name: "Files" }));
  fireEvent.change(await screen.findByPlaceholderText("For example: deployment guide or mytoolagent.com"), { target: { value: "mytoolagent.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Find files" }));

  expect(await screen.findByText("2 files found")).toBeTruthy();
  expect(screen.getByText("deployment.md")).toBeTruthy();
  expect(screen.getByText(/Text match/)).toBeTruthy();
  expect(screen.getByText("Sensitive, restricted")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Safe preview" })).toBeTruthy();
  expect(screen.queryByText(/Scanned 32 entries/)).toBeNull();
  expect(screen.queryByText(/SECRET=/)).toBeNull();
  expect(hostApi.search).toHaveBeenCalledWith(scope.id, "mytoolagent.com", scope.revision);
});

it("keeps manual folder entry open while an ordinary user types an alternative", async () => {
  renderView();
  fireEvent.click(await screen.findByRole("button", { name: "Remote files" }));
  fireEvent.click(await screen.findByRole("button", { name: "Add range" }));
  expect(await screen.findByDisplayValue("/srv/myagenttool-sites/server001-lan-e2e")).toBeTruthy();
  fireEvent.click(screen.getByText("Use another folder"));
  const input = await screen.findByLabelText("Remote directory");
  fireEvent.change(input, { target: { value: "/srv/www/another-site" } });
  expect(screen.getByDisplayValue("/srv/www/another-site")).toBeTruthy();
});

it("turns a plain-language host request into a reviewed read-only diagnostic", async () => {
  renderView();
  const assistant = await screen.findByTestId("host-assistant");
  fireEvent.change(screen.getByPlaceholderText("For example: show remaining disk space"), { target: { value: "show disk space" } });
  fireEvent.click(screen.getByRole("button", { name: "Suggest" }));
  expect(await screen.findByText("df -h")).toBeTruthy();
  expect(hostApi.planDiagnostic).toHaveBeenCalledWith(host.id, "show disk space");
  expect(hostApi.diagnose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm and run" }));
  await waitFor(() => expect(hostApi.diagnose).toHaveBeenCalledWith(host.id, "disk_usage"));
  expect(await screen.findByText(/Filesystem/)).toBeTruthy();
  expect(await screen.findByTestId("diagnostic-summary")).toBeTruthy();
  expect(assistant).toBeTruthy();
});

it("turns the reported Chinese login question into a reviewed audit check", async () => {
  vi.mocked(hostApi.planDiagnostic).mockResolvedValue({ plan: { action: "ssh_login_audit", command: "journalctl --no-pager --quiet --since '-24 hours' -u ssh.service -u sshd.service -n 100 -o short-iso", risk: "read_only" } });
  renderView();
  fireEvent.change(await screen.findByPlaceholderText("For example: show remaining disk space"), { target: { value: "检查登陆情况" } });
  fireEvent.click(screen.getByRole("button", { name: "Suggest" }));

  expect(await screen.findByText("counts of successful, failed, invalid-account, and pre-authentication connection events")).toBeTruthy();
  expect(screen.getByText(/journalctl.*ssh\.service/)).toBeTruthy();
  expect(hostApi.planDiagnostic).toHaveBeenCalledWith(host.id, "检查登陆情况");
  expect(hostApi.diagnose).not.toHaveBeenCalled();
});

it("shows an actionable alert when a host question is not recognized", async () => {
  vi.mocked(hostApi.planDiagnostic).mockRejectedValue(new ApiError("ssh_diagnostic_intent_unsupported", "unsupported", 422));
  renderView();
  fireEvent.change(await screen.findByPlaceholderText("For example: show remaining disk space"), { target: { value: "make it better" } });
  fireEvent.click(screen.getByRole("button", { name: "Suggest" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("show recent sign-ins");
  expect(alert.textContent).toContain("options below");
  expect(screen.getByRole("button", { name: "Check SSH sign-in audit" })).toBeTruthy();
});

it("lets ordinary owners run a check directly and hides technical evidence", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  vi.mocked(hostApi.diagnose).mockResolvedValue({ result: {
    action: "disk_usage",
    command: "df -h",
    output: "Filesystem\n/dev/private-volume 20G 19G 1G 95% /private/path",
    resolvedAddress: "10.10.10.222",
    summary: { version: 1, severity: "critical", finding: "disk_capacity_critical", impact: "file_operations_may_fail", nextAction: "free_device_space", facts: [{ key: "disk_used_percent", value: "95%", severity: "critical" }] },
  } });
  renderView();

  fireEvent.click(await screen.findByRole("button", { name: "Storage" }));
  await waitFor(() => expect(hostApi.diagnose).toHaveBeenCalledWith(host.id, "disk_usage"));
  expect(screen.queryByRole("button", { name: "Confirm check" })).toBeNull();

  expect(await screen.findByText("Device space is critically low")).toBeTruthy();
  expect(screen.getByText(/Uploads, saves, or publishing may fail/)).toBeTruthy();
  expect(screen.getByText(/Free some device space, then retry/)).toBeTruthy();
  expect(screen.getByText("95%")).toBeTruthy();
  expect(screen.queryByText("Technical evidence")).toBeNull();
  expect(screen.queryByText("df -h")).toBeNull();
  expect(screen.queryByText(/private-volume/)).toBeNull();
  expect(screen.queryByText(/10\.10\.10\.222/)).toBeNull();
});

it("turns an ordinary problem description into one combined diagnostic run", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  renderView();

  fireEvent.change(await screen.findByPlaceholderText("For example: who signed in recently?"), { target: { value: "The machine is very slow" } });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));

  await waitFor(() => expect(hostApi.diagnoseCase).toHaveBeenCalledWith(host.id, "The machine is very slow", undefined));
  expect(hostApi.planDiagnostic).not.toHaveBeenCalled();
  expect(await screen.findByText("Combined check complete · 2/2")).toBeTruthy();
  expect(screen.getByText("find why device performance is slow and get it running smoothly")).toBeTruthy();
  expect(screen.getByText("I ran read-only checks for this goal and did not change the device.")).toBeTruthy();
  expect(screen.getByText("Items needing attention were found")).toBeTruthy();
  expect(screen.getByText("First lead to review")).toBeTruthy();
  expect(screen.getByText("Device space is critically low")).toBeTruthy();
  expect(screen.getByText("Resource-use information is available")).toBeTruthy();
  expect(screen.queryByText("df -h")).toBeNull();
  expect(screen.queryByText("/dev/sda1 95% /")).toBeNull();
});

it("restores an unfinished host operations case without running the diagnosis again", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  const restoredRun = {
    id: "hdr_restored", targetRevision: host.revision, createdAt: "2026-08-30T00:00:00.000Z", version: 1 as const, intent: "performance" as const, risk: "read_only" as const, primaryAction: "disk_usage" as const,
    understanding: { version: 1 as const, goal: "improve" as const, domain: "performance" as const, symptom: "slow" as const, desiredOutcome: "improve_performance" as const, requestedChange: "none" as const, handling: "read_only_diagnosis" as const, confidence: "high" as const },
    summary: { version: 1 as const, severity: "warning" as const, finding: "host_warnings_found", impact: "host_attention_recommended", nextAction: "review_warning_findings", facts: [] },
    steps: [{ action: "disk_usage" as const, status: "completed" as const, summary: { version: 1 as const, severity: "warning" as const, finding: "disk_capacity_warning", impact: "storage_pressure_possible", nextAction: "review_storage_use", facts: [] } }],
  };
  const restoredCase = {
    id: "hoc_restored", sshTargetId: host.id, incidentId: null, version: 1 as const, intent: restoredRun.intent, understanding: restoredRun.understanding,
    status: "diagnosed" as const, nextStep: "review_findings" as const, diagnosticRunId: restoredRun.id, remediationPlanId: null, targetRevision: host.revision,
    deviceChanged: false, lastError: null, timeline: [{ kind: "case_opened" as const, at: restoredRun.createdAt, deviceChanged: false }, { kind: "diagnosis_completed" as const, at: restoredRun.createdAt, deviceChanged: false, diagnosticRunId: restoredRun.id, severity: "warning" as const }],
    latestRun: restoredRun, createdAt: restoredRun.createdAt, updatedAt: restoredRun.createdAt,
  };
  vi.mocked(hostApi.operationCases).mockResolvedValue({ cases: [restoredCase], count: 1, activeCase: restoredCase });
  renderView();

  expect(await screen.findByText("Current issue")).toBeTruthy();
  expect(screen.getByText("This issue has a check result")).toBeTruthy();
  expect(screen.getByText("Device unchanged")).toBeTruthy();
  expect(await screen.findByText("Combined check complete · 1/1")).toBeTruthy();
  expect(hostApi.diagnoseCase).not.toHaveBeenCalled();
});

it("offers to resume a host operations case interrupted during diagnosis", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  const interruptedCase = {
    id: "hoc_interrupted", sshTargetId: host.id, incidentId: null, version: 1 as const, intent: "performance" as const, understanding: { version: 1 as const, goal: "improve" as const, domain: "performance" as const, symptom: "slow" as const, desiredOutcome: "improve_performance" as const, requestedChange: "none" as const, handling: "read_only_diagnosis" as const, confidence: "high" as const },
    status: "checking" as const, nextStep: "wait_for_diagnosis" as const, diagnosticRunId: null, remediationPlanId: null, targetRevision: host.revision,
    deviceChanged: false, lastError: null, timeline: [{ kind: "case_opened" as const, at: "2026-08-30T00:00:00.000Z", deviceChanged: false }],
    latestRun: null, createdAt: "2026-08-30T00:00:00.000Z", updatedAt: "2026-08-30T00:00:00.000Z",
  };
  vi.mocked(hostApi.operationCases).mockResolvedValue({ cases: [interruptedCase], count: 1, activeCase: interruptedCase });
  renderView();

  expect(await screen.findByRole("button", { name: "Continue check" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Continue check" }));

  await waitFor(() => expect(hostApi.diagnoseCase).toHaveBeenCalledWith(host.id, undefined, undefined, interruptedCase.id));
});

it("shows historical host operations cases with their phase and full timeline", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  const historyCase = {
    id: "hoc_history", sshTargetId: host.id, incidentId: null, version: 1 as const, intent: "website" as const,
    understanding: { version: 1 as const, goal: "restore" as const, domain: "website" as const, symptom: "unavailable" as const, desiredOutcome: "restore_availability" as const, requestedChange: "none" as const, handling: "read_only_diagnosis" as const, confidence: "high" as const },
    status: "recovered" as const, nextStep: "case_complete" as const, diagnosticRunId: "hdr_history", remediationPlanId: "hrp_history", targetRevision: host.revision,
    deviceChanged: true, lastError: null, timeline: [
      { kind: "case_opened" as const, at: "2026-08-30T00:00:00.000Z", deviceChanged: false },
      { kind: "diagnosis_completed" as const, at: "2026-08-30T00:01:00.000Z", deviceChanged: false, diagnosticRunId: "hdr_history", severity: "warning" as const },
      { kind: "remediation_completed" as const, at: "2026-08-30T00:03:00.000Z", deviceChanged: true, remediationPlanId: "hrp_history" },
    ],
    latestRun: { id: "hdr_history", targetRevision: host.revision, createdAt: "2026-08-30T00:01:00.000Z", version: 1 as const, intent: "website" as const, risk: "read_only" as const, steps: [], summary: { version: 1 as const, severity: "warning" as const, finding: "host_warnings_found", impact: "host_attention_recommended", nextAction: "review_warning_findings", facts: [] } },
    createdAt: "2026-08-30T00:00:00.000Z", updatedAt: "2026-08-30T00:03:00.000Z",
  };
  vi.mocked(hostApi.operationCases).mockResolvedValue({ cases: [historyCase], count: 1, activeCase: null });
  renderView();

  expect(await screen.findByTestId("host-operations-history")).toBeTruthy();
  expect(screen.getByText("Case history")).toBeTruthy();
  fireEvent.click(screen.getByText("Case history"));
  expect(await screen.findByText("This issue is resolved")).toBeTruthy();
  expect(screen.getByText("Recovered")).toBeTruthy();
  fireEvent.click(screen.getByText("This issue is resolved"));
  expect(await screen.findByText("Full timeline · 3 events")).toBeTruthy();
  expect(screen.getByText("Action outcome confirmed")).toBeTruthy();
  expect(screen.getByText("This step confirms that the device changed.")).toBeTruthy();
});

it("routes a sign-in recovery next step to the credential flow", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  const failedHost = { ...host, authMethod: "password_ref" as const, connectionStatus: "error" as const, lastConnectionError: { code: "ssh_authentication_failed", at: "2026-08-30T00:00:00.000Z" } };
  vi.mocked(hostApi.list).mockResolvedValue({ hosts: [failedHost], count: 1 });
  const signInCase = {
    id: "hoc_sign_in", sshTargetId: host.id, incidentId: null, version: 1 as const, intent: "health" as const,
    understanding: { version: 1 as const, goal: "inspect" as const, domain: "device" as const, symptom: "unspecified" as const, desiredOutcome: "understand_state" as const, requestedChange: "none" as const, handling: "read_only_diagnosis" as const, confidence: "medium" as const },
    status: "needs_help" as const, nextStep: "update_sign_in" as const, diagnosticRunId: null, remediationPlanId: null, targetRevision: host.revision,
    deviceChanged: false, lastError: "ssh_authentication_failed", timeline: [{ kind: "diagnosis_incomplete" as const, at: "2026-08-30T00:00:00.000Z", deviceChanged: false, error: "ssh_authentication_failed" }],
    latestRun: null, createdAt: "2026-08-30T00:00:00.000Z", updatedAt: "2026-08-30T00:00:00.000Z",
  };
  vi.mocked(hostApi.operationCases).mockResolvedValue({ cases: [signInCase], count: 1, activeCase: signInCase });
  renderView();

  const recoveryButtons = await screen.findAllByRole("button", { name: "Update sign-in details" });
  expect(recoveryButtons.length).toBeGreaterThan(0);
  fireEvent.click(recoveryButtons[0]);
  expect(await screen.findByRole("heading", { name: "Update sign-in details" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Save and reconnect" })).toBeTruthy();
});

it("acknowledges a requested host change but keeps the ordinary flow diagnosis-first", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  vi.mocked(hostApi.diagnoseIssue).mockResolvedValueOnce({ run: {
    id: "hdr_cleanup", targetRevision: host.revision, createdAt: "2026-08-29T00:00:00.000Z", version: 1, intent: "performance", risk: "read_only", primaryAction: "disk_usage",
    understanding: { version: 1, goal: "restore", domain: "storage", symptom: "storage_pressure", desiredOutcome: "free_space", requestedChange: "cleanup_storage", handling: "diagnose_before_change", confidence: "high" },
    summary: { version: 1, severity: "warning", finding: "host_warnings_found", impact: "host_attention_recommended", nextAction: "review_warning_findings", facts: [] },
    steps: [{ action: "disk_usage", status: "completed", summary: { version: 1, severity: "critical", finding: "disk_capacity_critical", impact: "file_operations_may_fail", nextAction: "free_device_space", facts: [] } }],
  } });
  renderView();

  fireEvent.change(await screen.findByPlaceholderText("For example: who signed in recently?"), { target: { value: "The disk is full, clean it up for me" } });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));

  expect(await screen.findByText("free enough device storage")).toBeTruthy();
  expect(screen.getByText(/You requested a change\. I checked the cause first and did not perform it/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /clean|delete|confirm/i })).toBeNull();
});

it("shows one reviewed website repair and verifies it after a single confirmation", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  vi.mocked(hostApi.tlsProfiles).mockResolvedValue({ profiles: [tlsProfile], count: 1 });
  vi.mocked(hostApi.diagnoseIssue).mockResolvedValue({ run: {
    id: "hdr_website", targetRevision: host.revision, createdAt: "2026-08-29T00:00:00.000Z", version: 1, intent: "website", risk: "read_only", primaryAction: "failed_services",
    summary: { version: 1, severity: "critical", finding: "host_critical_findings", impact: "host_operation_may_be_affected", nextAction: "review_critical_findings", facts: [] },
    steps: [{ action: "failed_services", status: "completed", summary: { version: 1, severity: "critical", finding: "failed_services_found", impact: "service_may_be_unavailable", nextAction: "inspect_failed_services", facts: [{ key: "failed_service_count", value: "1", severity: "critical" }] } }],
  } });
  renderView();

  fireEvent.change(await screen.findByPlaceholderText("For example: who signed in recently?"), { target: { value: "The website is down" } });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));

  expect(await screen.findByText("Check whether the website is actually available")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Check website" }));
  await waitFor(() => expect(hostApi.planRemediation).toHaveBeenCalledWith(host.id, tlsProfile.id, "hdr_website"));
  expect(hostApi.confirmRemediation).not.toHaveBeenCalled();
  expect(await screen.findByText("Reload the verified website service")).toBeTruthy();
  expect(screen.getByText(/Website files are not changed/)).toBeTruthy();
  expect(screen.queryByText("site-nginx")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Confirm and repair" }));
  await waitFor(() => expect(hostApi.confirmRemediation).toHaveBeenCalledWith(host.id, remediationPlan.id, remediationPlan.revision));
  expect(await screen.findByText("The website is available again")).toBeTruthy();
});

it("explains why an unbound website cannot be repaired instead of hiding the next step", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  vi.mocked(hostApi.tlsProfiles).mockResolvedValue({ profiles: [], count: 0 });
  vi.mocked(hostApi.diagnoseIssue).mockResolvedValue({ run: {
    id: "hdr_website_unbound", targetRevision: host.revision, createdAt: "2026-08-29T00:00:00.000Z", version: 1, intent: "website", risk: "read_only", primaryAction: "failed_services",
    summary: { version: 1, severity: "warning", finding: "host_warnings_found", impact: "host_attention_recommended", nextAction: "review_warning_findings", facts: [] },
    steps: [{ action: "failed_services", status: "completed", summary: { version: 1, severity: "warning", finding: "failed_services_found", impact: "service_may_be_unavailable", nextAction: "inspect_failed_services", facts: [] } }],
  } });
  renderView();

  fireEvent.change(await screen.findByPlaceholderText("For example: who signed in recently?"), { target: { value: "The website is down" } });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));

  expect(await screen.findByText("No safely managed website service is configured")).toBeTruthy();
  expect(screen.getByText(/will not guess which service to reload/i)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Confirm and repair" })).toBeNull();
});

it("does not offer an automatic retry when website repair verification is incomplete", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  vi.mocked(hostApi.tlsProfiles).mockResolvedValue({ profiles: [tlsProfile], count: 1 });
  vi.mocked(hostApi.diagnoseIssue).mockResolvedValue({ run: {
    id: "hdr_website", targetRevision: host.revision, createdAt: "2026-08-29T00:00:00.000Z", version: 1, intent: "website", risk: "read_only", primaryAction: "failed_services",
    summary: { version: 1, severity: "warning", finding: "host_warnings_found", impact: "host_attention_recommended", nextAction: "review_warning_findings", facts: [] },
    steps: [{ action: "failed_services", status: "completed", summary: { version: 1, severity: "warning", finding: "service_not_running", impact: "service_may_be_unavailable", nextAction: "inspect_service_setup", facts: [] } }],
  } });
  vi.mocked(hostApi.confirmRemediation).mockResolvedValue({ plan: { ...remediationPlan, status: "outcome_unknown", revision: 3, result: { outcome: "verification_incomplete", changeAttempted: true, verification: "incomplete", completedChecks: ["service_reloaded"] } }, reused: false });
  renderView();

  fireEvent.change(await screen.findByPlaceholderText("For example: who signed in recently?"), { target: { value: "The website is down" } });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  fireEvent.click(await screen.findByRole("button", { name: "Check website" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm and repair" }));

  expect(await screen.findByText("The repair ran, but the final state is not confirmed")).toBeTruthy();
  expect(screen.getByText(/before attempting anything again/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  expect(hostApi.confirmRemediation).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Check website again" }));
  await waitFor(() => expect(hostApi.recheckRemediation).toHaveBeenCalledWith(host.id, remediationPlan.id));
  expect(await screen.findByText("The website is available after a fresh check")).toBeTruthy();
  expect(hostApi.confirmRemediation).toHaveBeenCalledTimes(1);
});

it("stops without confirmation when the real website is already healthy", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  vi.mocked(hostApi.tlsProfiles).mockResolvedValue({ profiles: [tlsProfile], count: 1 });
  vi.mocked(hostApi.diagnoseIssue).mockResolvedValue({ run: {
    id: "hdr_website", targetRevision: host.revision, createdAt: "2026-08-29T00:00:00.000Z", version: 1, intent: "website", risk: "read_only", primaryAction: "recent_logs",
    summary: { version: 1, severity: "info", finding: "host_no_obvious_issue", impact: "host_no_obvious_impact", nextAction: "continue_targeted_diagnosis", facts: [] },
    steps: [{ action: "recent_logs", status: "completed", summary: { version: 1, severity: "info", finding: "recent_logs_ready", impact: "information_only", nextAction: "review_recent_events", facts: [] } }],
  } });
  vi.mocked(hostApi.planRemediation).mockResolvedValue({ plan: {
    ...remediationPlan,
    status: "not_needed",
    phase: "finished",
    finding: "website_healthy",
    initialHealth: { status: "healthy", reason: "website_healthy", statusCodeClass: 2, contentMatched: true, checkedAt: "2026-08-29T00:00:01.000Z" },
    result: { outcome: "already_healthy", changeAttempted: false, verification: "passed", completedChecks: ["preflight_website_healthy"] },
  }, reused: false });
  renderView();

  fireEvent.change(await screen.findByPlaceholderText("For example: who signed in recently?"), { target: { value: "The website is down" } });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  fireEvent.click(await screen.findByRole("button", { name: "Check website" }));

  expect(await screen.findByText("The website is available; no repair is needed")).toBeTruthy();
  expect(hostApi.confirmRemediation).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Confirm and repair" })).toBeNull();
});

it("distinguishes a completed reload from an actually restored website", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  vi.mocked(hostApi.tlsProfiles).mockResolvedValue({ profiles: [tlsProfile], count: 1 });
  vi.mocked(hostApi.diagnoseIssue).mockResolvedValue({ run: {
    id: "hdr_website", targetRevision: host.revision, createdAt: "2026-08-29T00:00:00.000Z", version: 1, intent: "website", risk: "read_only", primaryAction: "failed_services",
    summary: { version: 1, severity: "warning", finding: "host_warnings_found", impact: "host_attention_recommended", nextAction: "review_warning_findings", facts: [] },
    steps: [{ action: "failed_services", status: "completed", summary: { version: 1, severity: "warning", finding: "service_not_running", impact: "service_may_be_unavailable", nextAction: "inspect_service_setup", facts: [] } }],
  } });
  vi.mocked(hostApi.confirmRemediation).mockResolvedValue({ plan: {
    ...remediationPlan,
    status: "completed_unresolved",
    phase: "finished",
    revision: 4,
    result: { outcome: "not_restored", changeAttempted: true, verification: "failed", completedChecks: ["service_reloaded", "verification_website_health"], websiteHealth: { status: "unhealthy", reason: "website_http_error", statusCodeClass: 5, contentMatched: false, checkedAt: "2026-08-29T00:00:02.000Z" } },
  }, reused: false });
  renderView();

  fireEvent.change(await screen.findByPlaceholderText("For example: who signed in recently?"), { target: { value: "The website is down" } });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
  fireEvent.click(await screen.findByRole("button", { name: "Check website" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm and repair" }));

  expect(await screen.findByText("The service was reloaded, but the website is still unavailable")).toBeTruthy();
  expect(screen.getByText(/Do not repeat the repair/)).toBeTruthy();
});

it("shows durable recent repair history after reopening the host", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  vi.mocked(hostApi.remediationPlans).mockResolvedValue({ plans: [{
    ...remediationPlan,
    status: "completed",
    phase: "finished",
    completedAt: "2026-08-29T00:02:00.000Z",
    result: { outcome: "restored", changeAttempted: true, verification: "passed", completedChecks: ["verification_website_health"] },
  }], count: 1 });
  renderView();

  const history = await screen.findByText("Recent repair history");
  fireEvent.click(history);
  expect(await screen.findByText("Website restored")).toBeTruthy();
});

it("shows recent sign-ins as owner-readable activity instead of raw journal output", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  vi.mocked(hostApi.diagnose).mockResolvedValue({ result: {
    action: "ssh_login_audit",
    command: "journalctl --since '-24 hours' -u ssh.service",
    output: [
      "2026-08-28T08:10:00+08:00 server sshd[101]: Accepted password for devagent from 10.10.10.5 port 51000 ssh2",
      "2026-08-28T08:20:00+08:00 server sshd[102]: Failed password for admin from 198.51.100.20 port 42000 ssh2",
    ].join("\n"),
    summary: { version: 1, severity: "warning", finding: "ssh_login_audit_failures_found", impact: "login_attempts_need_review", nextAction: "review_login_audit_evidence", facts: [
      { key: "ssh_login_audit_success_count", value: "1", severity: "info" },
      { key: "ssh_login_audit_failure_count", value: "1", severity: "warning" },
    ] },
  } });
  renderView();

  fireEvent.click(await screen.findByRole("button", { name: "Recent sign-ins" }));

  expect(await screen.findByText("Recent sign-in activity")).toBeTruthy();
  expect(screen.getByText("devagent")).toBeTruthy();
  expect(screen.getByText(/From: 10\.10\.10\.5/)).toBeTruthy();
  expect(screen.getByText("admin")).toBeTruthy();
  expect(screen.getByText(/From: 198\.51\.100\.20/)).toBeTruthy();
  expect(screen.getByText(/Change the password/)).toBeTruthy();
  expect(screen.queryByText(/journalctl/)).toBeNull();
  expect(screen.queryByText("Technical evidence")).toBeNull();
});

it("explains a timed-out read-only check without leaking the error code or implying a device change", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  vi.mocked(hostApi.diagnose).mockRejectedValue(new ApiError("ssh_fixed_command_timeout", "private socket detail", 502));
  renderView();

  fireEvent.click(await screen.findByRole("button", { name: "Memory" }));

  expect(await screen.findByText(/That took too long.*device is online/)).toBeTruthy();
  expect(screen.queryByText("ssh_fixed_command_timeout")).toBeNull();
  expect(screen.queryByText("private socket detail")).toBeNull();
  expect(screen.getByRole("button", { name: "Memory" })).toBeTruthy();
});

it("turns a missing desktop credential into a clear host-assistant recovery message", async () => {
  useUiStore.setState({ experienceMode: "ordinary" });
  const credentialErrorHost: SshHost = {
    ...host,
    authMethod: "password_ref",
    connectionStatus: "error",
    capabilities: null,
    lastConnectionError: { code: "ssh_credential_unavailable", at: "2026-08-28T00:00:00.000Z" },
    revision: host.revision + 1,
  };
  vi.mocked(hostApi.list)
    .mockResolvedValueOnce({ hosts: [host], count: 1 })
    .mockResolvedValue({ hosts: [credentialErrorHost], count: 1 });
  vi.mocked(hostApi.diagnose).mockRejectedValue(new ApiError("ssh_credential_unavailable", "private credential resolver detail", 409));
  renderView();

  fireEvent.click(await screen.findByRole("button", { name: "Recent sign-ins" }));

  expect(await screen.findByText(/Sign in to this device again/)).toBeTruthy();
  expect(screen.queryByText("private credential resolver detail")).toBeNull();
  expect(screen.queryByText("ssh_credential_unavailable")).toBeNull();
  expect(await screen.findByText("Sign-in details need updating")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Update sign-in details" })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Update sign-in details" }));

  expect(await screen.findByRole("heading", { name: "Update sign-in details" })).toBeTruthy();
  expect(screen.getByText(/previous check will not run automatically/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Save and reconnect" })).toBeTruthy();
  expect(screen.queryByLabelText("Connection progress")).toBeNull();
  expect(screen.queryByPlaceholderText("Leave blank to reuse the securely stored password")).toBeNull();
});

it("previews approved text files without executing their contents", async () => {
  const readableScope = { ...scope, permissions: ["list", "download"] as HostFileScope["permissions"] };
  vi.mocked(hostApi.scopes).mockResolvedValue({ scopes: [readableScope], count: 1 });
  vi.mocked(hostApi.preview).mockResolvedValue({ blob: new Blob(["<h1>safe preview</h1>"], { type: "text/plain" }), kind: "text", contentType: "text/plain; charset=utf-8" });
  renderView();
  fireEvent.click(await screen.findByRole("button", { name: "Remote files" }));
  fireEvent.click(await screen.findByRole("button", { name: "Preview" }));
  expect(await screen.findByText("Preview: index.html")).toBeTruthy();
  await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("safe preview"));
  expect(hostApi.preview).toHaveBeenCalledWith("hfs_1", { path: "index.html", expectedRevision: 1 });
  expect(hostApi.download).not.toHaveBeenCalled();
});

it("requires a clear confirmation before an enabled upload starts", async () => {
  const writableScope = { ...scope, permissions: ["list", "upload", "download"] as HostFileScope["permissions"] };
  vi.mocked(hostApi.scopes).mockResolvedValue({ scopes: [writableScope], count: 1 });
  vi.mocked(hostApi.upload).mockResolvedValue({ task: {
    id: "hft_1", sshTargetId: host.id, scopeId: scope.id, direction: "upload", status: "completed", remotePath: "notes.txt", remoteDirectory: "", fileName: "notes.txt",
    bytesTotal: 5, bytesTransferred: 5, progress: 100, conflictPolicy: "rename", attempt: 1, maxAttempts: 3, retryOf: null, errorCode: null, createdAt: "2026-08-25T00:00:00.000Z", completedAt: "2026-08-25T00:00:01.000Z",
  } });
  const rendered = renderView();
  fireEvent.click(await screen.findByRole("button", { name: "Remote files" }));
  fireEvent.click(await screen.findByRole("button", { name: "Upload" }));
  const input = rendered.container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["hello"], "notes.txt", { type: "text/plain" })] } });
  expect(await screen.findByText("Confirm upload")).toBeTruthy();
  expect(hostApi.upload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm and start" }));
  await waitFor(() => expect(hostApi.upload).toHaveBeenCalledWith("hfs_1", expect.any(File), expect.objectContaining({ directory: "", conflictPolicy: "rename", overwriteConfirmed: false })));
});

it("offers a bounded retry from a failed transfer without retaining file bytes", async () => {
  vi.mocked(hostApi.scopes).mockResolvedValue({ scopes: [{ ...scope, permissions: ["list", "download"] }], count: 1 });
  vi.mocked(hostApi.transfers).mockResolvedValue({ count: 1, transfers: [{
    id: "hft_failed", sshTargetId: host.id, scopeId: scope.id, direction: "download", status: "failed", remotePath: "index.html", remoteDirectory: "", fileName: "index.html",
    bytesTotal: 1200, bytesTransferred: 400, progress: 33, conflictPolicy: null, attempt: 1, maxAttempts: 3, retryOf: null, errorCode: "ssh_connection_timeout", createdAt: "2026-08-25T00:00:00.000Z", completedAt: "2026-08-25T00:00:01.000Z",
  }] });
  renderView();
  fireEvent.click(await screen.findByRole("button", { name: "Transfers" }));
  expect(await screen.findByText("Failed")).toBeTruthy();
  expect(screen.getByText(/ssh_connection_timeout/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Confirm download")).toBeTruthy();
  expect(hostApi.download).not.toHaveBeenCalled();
});

it("explains missing connection fields instead of silently disabling connection", async () => {
  vi.mocked(hostApi.list).mockResolvedValue({ hosts: [], count: 0 });
  renderView();

  fireEvent.click((await screen.findAllByRole("button", { name: "Add host" }))[0]);
  const save = screen.getByRole("button", { name: "Connect and verify" }) as HTMLButtonElement;
  expect(save.disabled).toBe(false);

  fireEvent.click(save);
  expect((await screen.findByRole("alert")).textContent).toContain("Enter a host address");
  expect(hostApi.create).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText("Host address"), { target: { value: "10.10.10.222" } });
  fireEvent.change(screen.getByLabelText("Login user"), { target: { value: "" } });
  fireEvent.click(save);
  expect((await screen.findByRole("alert")).textContent).toContain("Enter the login user");

  fireEvent.change(screen.getByLabelText("Login user"), { target: { value: "deploy" } });
  fireEvent.change(screen.getByLabelText("Port"), { target: { value: "0" } });
  fireEvent.click(save);
  expect((await screen.findByRole("alert")).textContent).toContain("Port must be an integer from 1 to 65535");
  expect(hostApi.create).not.toHaveBeenCalled();
});

it("connects from one ordinary form and moves the password into desktop secure storage", async () => {
  vi.mocked(hostApi.list).mockResolvedValue({ hosts: [], count: 0 });
  const createdHost = { ...host, authMethod: "password_ref" as const, connectionStatus: "untested" as const, knownHostFingerprint: null, observedFingerprint: null, capabilities: null, verifiedAt: null, revision: 1 };
  const observedHost = { ...createdHost, connectionStatus: "fingerprint_pending" as const, observedFingerprint: host.observedFingerprint, revision: 2 };
  const confirmedHost = { ...observedHost, connectionStatus: "untested" as const, knownHostFingerprint: host.observedFingerprint, revision: 3 };
  const readyHost = { ...host, authMethod: "password_ref" as const };
  vi.mocked(hostApi.create).mockResolvedValue({ target: createdHost });
  vi.mocked(hostApi.observeFingerprint).mockResolvedValue({ host: observedHost, observation: { fingerprint: host.observedFingerprint!, resolvedAddress: "203.0.113.10" } });
  vi.mocked(hostApi.confirmFingerprint).mockResolvedValue({ host: confirmedHost });
  vi.mocked(hostApi.verify).mockResolvedValue({ host: readyHost, verification: { capabilities: readyHost.capabilities } });
  const saveSshHostCredential = vi.fn().mockResolvedValue({ ok: true, reference: host.credentialRef, authMethod: "password_ref" });
  window.myagenttoolDesktop = { saveSshHostCredential };
  renderView();

  fireEvent.click((await screen.findAllByRole("button", { name: "Add host" }))[0]);
  fireEvent.change(screen.getByLabelText("Host address"), { target: { value: "host.example" } });
  fireEvent.change(screen.getByLabelText("Login password"), { target: { value: "test-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect and verify" }));
  await waitFor(() => expect(hostApi.create).toHaveBeenCalledWith(expect.objectContaining({ host: "host.example", user: "deploy", authMethod: "password_ref", purposes: ["file_transfer"] })));
  expect(saveSshHostCredential).toHaveBeenCalledWith(expect.objectContaining({ hostId: host.id, password: "test-password" }));
  expect(hostApi.observeFingerprint).toHaveBeenCalledWith(host.id);
  expect(await screen.findByRole("button", { name: "Confirm and connect" })).toBeTruthy();
  expect(screen.getByText(host.observedFingerprint!)).toBeTruthy();
  expect(screen.queryByDisplayValue("test-password")).toBeNull();
  fireEvent.click(screen.getByLabelText("I compared the fingerprint and confirmed this is the device I intend to connect to."));
  fireEvent.click(screen.getByRole("button", { name: "Confirm and connect" }));
  await waitFor(() => expect(hostApi.confirmFingerprint).toHaveBeenCalledWith(host.id, host.observedFingerprint, observedHost.revision));
  expect(hostApi.verify).toHaveBeenCalledWith(host.id);
  expect(await screen.findByRole("heading", { name: "Add a file range" })).toBeTruthy();
  expect(await screen.findByDisplayValue("/srv/myagenttool-sites/server001-lan-e2e")).toBeTruthy();
  expect(screen.getByText("3. Choose folder")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Verify range and finish" }));
  await waitFor(() => expect(hostApi.createScope).toHaveBeenCalledWith(host.id, expect.objectContaining({ rootPath: "/srv/myagenttool-sites/server001-lan-e2e" })));
});

it("requires plain-language consent before connecting to a local-network address", async () => {
  vi.mocked(hostApi.list).mockResolvedValue({ hosts: [], count: 0 });
  renderView();

  fireEvent.click((await screen.findAllByRole("button", { name: "Add host" }))[0]);
  fireEvent.change(screen.getByLabelText("Host address"), { target: { value: "10.10.10.222" } });
  fireEvent.change(screen.getByLabelText("Login password"), { target: { value: "test-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect and verify" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Confirm that MyAgentTool may connect to this local-network device");
  expect(hostApi.create).not.toHaveBeenCalled();
});

it("repairs an existing private-network host in place and reuses its saved credential", async () => {
  const blockedHost: SshHost = {
    ...host,
    host: "10.10.10.222",
    authMethod: "password_ref",
    networkPolicy: "public_only",
    connectionStatus: "error",
    knownHostFingerprint: null,
    observedFingerprint: null,
    capabilities: null,
    lastConnectionError: { code: "ssh_host_private_network_blocked", at: "2026-08-26T00:00:00.000Z" },
    verifiedAt: null,
  };
  const updatedHost = { ...blockedHost, networkPolicy: "allow_private_network" as const, connectionStatus: "untested" as const, lastConnectionError: null, revision: 5 };
  const observedHost = { ...updatedHost, connectionStatus: "fingerprint_pending" as const, observedFingerprint: host.observedFingerprint, revision: 6 };
  vi.mocked(hostApi.list).mockResolvedValue({ hosts: [blockedHost], count: 1 });
  vi.mocked(hostApi.update).mockResolvedValue({ host: updatedHost });
  vi.mocked(hostApi.observeFingerprint).mockResolvedValue({ host: observedHost, observation: { fingerprint: host.observedFingerprint!, resolvedAddress: "10.10.10.222" } });
  renderView();

  fireEvent.click(await screen.findByRole("button", { name: "Allow local network and retry" }));
  const privateConsent = await screen.findByLabelText(/Local-network permission/);
  expect((privateConsent as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Connect and verify" }));

  await waitFor(() => expect(hostApi.update).toHaveBeenCalledWith(blockedHost.id, expect.objectContaining({ expectedRevision: blockedHost.revision, networkPolicy: "allow_private_network" })));
  expect(hostApi.create).not.toHaveBeenCalled();
  expect(await screen.findByRole("button", { name: "Confirm and connect" })).toBeTruthy();
});
