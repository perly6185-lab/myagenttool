import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, CalendarClock, CheckCircle2, Circle, Clipboard, ExternalLink, ListChecks, Pause, Pencil, Pin, Play, RefreshCw, RotateCcw, Search, Square, Trash2, WandSparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { FactList } from "@/components/common/fact-list";
import { ConfirmModal } from "@/components/common/confirm-modal";
import { Field } from "@/components/common/field";
import { applicationRecoveryDeepLink, applicationResultDeepLink, applicationRunDeepLink } from "@/app/deep-links";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/cn";
import { DescriptorFeedbackList, DescriptorRiskPreviewPanel, WrapperCapabilityImpactPanel } from "@/features/applications/descriptor-feedback";
import { descriptorRiskPreview, parseOptionalJsonObjectAllowNull, prettyJson, wrapperCapabilityImpact } from "@/features/applications/descriptor-utils";
import { NpmWrapperCommandBuilder } from "@/features/applications/wrapper-command-builder";
import { generateApplicationIntegrationDrafts } from "@/features/applications/application-draft-generator";
import { applicationOnboardingGuide, type ApplicationOnboardingStep } from "@/features/applications/application-onboarding-guide";
import { applicationPostSaveActions, type ApplicationPostSaveAction } from "@/features/applications/application-post-save-actions";
import { applicationOperationIssues, sourceSummary, type ApplicationOperationIssue } from "@/features/applications/application-health";
import { Transcript } from "@/features/invocations/transcript";
import {
  isExecutableRecoveryAction,
  latestRecoveryActionRequest,
  readableRecoveryActionAvailabilityReason,
  readableRecoveryActionRequestStatus,
  readableRecoveryActionType,
  readableRecoveryAgentReason,
  readableRecoveryCategory,
  readableRecoveryExplanationReason,
  readableRecoveryExplanationState,
  readableRecoveryOutcome,
  readableRecoveryOutcomeReason,
  readableRecoveryTimelineStatus,
  recoveryActionRequestTone,
  recoveryAgentChoiceLabel,
  recoveryExplanationReasonTone,
  recoveryExplanationTone,
  recoveryOutcomeSeverityTone,
  recoveryOutcomeTone,
  recoveryResultOrchestrationLabel,
  recoveryTimelineTone,
  recoveryTone,
  sortedRecoveryActionRequests,
} from "@/features/recovery/application-recovery-ui";
import { readableStatus, statusTone, type Tone } from "@/lib/readable-labels";
import type {
  ApplicationEventSnapshot,
  ApprovalSnapshot,
  ApplicationOrchestration,
  ApplicationOrchestrationRecoveryAction,
  ApplicationOrchestrationRecoveryAgentCandidate,
  ApplicationProbeDiff,
  ApplicationProbeMcpServer,
  ApplicationRecoveryExplanation,
  ApplicationRecoveryActionRequest,
  ApplicationRecoveryTimelineEntry,
  ApplicationOrchestrationRun,
  ApplicationCapability,
  ApplicationResultDetail,
  ApplicationResultSummaryItem,
  ApplicationSnapshot,
  ApplicationResultRef,
  AuditSnapshot,
  AutomationSnapshot,
  NpmWrapperArgInputSnapshot,
  InvocationSnapshot,
} from "@/lib/console-state";
import type { ApplicationEventLevelSelection } from "@/store/ui-store";

type ApplicationResultRecord = ApplicationResultSummaryItem | ApplicationResultDetail;

function riskTone(risk?: string): "neutral" | "warning" | "danger" {
  if (risk === "high" || risk === "critical") return "danger";
  if (risk === "medium") return "warning";
  return "neutral";
}

function readinessTone(state?: string): "neutral" | "success" | "warning" | "danger" {
  if (state === "ready") return "success";
  if (state === "needs_setup") return "warning";
  if (state === "disabled") return "danger";
  return "neutral";
}

function confidenceTone(confidence?: string): "neutral" | "success" | "warning" | "danger" {
  if (confidence === "high") return "success";
  if (confidence === "medium") return "warning";
  if (confidence === "low") return "danger";
  return "neutral";
}

function mcpLiveProbeTone(state?: string | null): "neutral" | "success" | "warning" | "danger" {
  if (state === "succeeded") return "success";
  if (state === "failed" || state === "blocked") return "danger";
  if (state === "not_run") return "warning";
  return "neutral";
}

function mcpLiveProbeLabel(state?: string | null): string {
  if (state === "succeeded") return "live probe passed";
  if (state === "failed") return "live probe failed";
  if (state === "blocked") return "live probe blocked";
  if (state === "not_run") return "live probe needed";
  return state ? `live probe ${state}` : "live probe unknown";
}

function mcpHttpLiveProbeRequired(candidate: ApplicationProbeMcpServer): boolean {
  return candidate.transport === "http" && candidate.review?.liveProbe?.requiredBeforeExecution === true;
}

function mcpCandidateReadyToConfirm(candidate: ApplicationProbeMcpServer): boolean {
  return !mcpHttpLiveProbeRequired(candidate) || candidate.review?.liveProbe?.state === "succeeded";
}

function mcpProbeActionLabel(candidate: ApplicationProbeMcpServer): string {
  return candidate.review?.liveProbe?.state === "failed" || candidate.review?.liveProbe?.state === "blocked"
    ? "Retry endpoint probe"
    : "Probe endpoint";
}

function mcpLiveProbeFacts(candidate: ApplicationProbeMcpServer) {
  const liveProbe = candidate.review?.liveProbe;
  if (!liveProbe) return [];
  return [
    { term: "Live probe", value: mcpLiveProbeLabel(liveProbe.state) },
    { term: "Probe checked", value: liveProbe.checkedAt ? shortTime(liveProbe.checkedAt) : "Not run" },
    { term: "Probe evidence", value: liveProbe.evidence ?? "—" },
    { term: "Probe endpoint", value: liveProbe.endpointUrl ?? liveProbe.endpointOrigin ?? "—" },
    { term: "Matched tools", value: (liveProbe.matchedAllowedTools ?? []).join(", ") || "—" },
    { term: "Missing tools", value: (liveProbe.missingAllowedTools ?? []).join(", ") || "None" },
  ];
}

function probeDiffGroups(diff?: ApplicationProbeDiff | null) {
  if (!diff) return [];
  return [
    { label: "Added capabilities", values: diff.addedCapabilityNames ?? [], tone: "success" as const },
    { label: "Removed capabilities", values: diff.removedCapabilityNames ?? [], tone: "danger" as const },
    { label: "Changed capabilities", values: diff.changedCapabilityNames ?? [], tone: "warning" as const },
    { label: "Added MCP candidates", values: diff.addedMcpServerIds ?? [], tone: "success" as const },
    { label: "Removed MCP candidates", values: diff.removedMcpServerIds ?? [], tone: "danger" as const },
    { label: "Changed MCP candidates", values: diff.changedMcpServerIds ?? [], tone: "warning" as const },
  ].filter((group) => group.values.length > 0);
}

function shortProbeDiffName(value: string) {
  const parts = String(value).split(".").filter(Boolean);
  return parts.slice(-2).join(".") || value;
}

function isWrapperCapability(capability: ApplicationCapability) {
  return capability.kind === "npm_wrapper" || Boolean(capability.metadata?.wrapper?.commandId);
}

function capabilityAutomations(
  automations: AutomationSnapshot[],
  application: ApplicationSnapshot,
  capability: ApplicationCapability,
) {
  return automations
    .filter((automation) =>
      automation.kind === "application_capability"
      && automation.target?.type === "application_capability"
      && automation.target.applicationId === application.id
      && automation.target.capabilityName === capability.name
    )
    .sort((left, right) => {
      const priority = automationHealthPriority(left.healthSummary?.status) - automationHealthPriority(right.healthSummary?.status);
      if (priority !== 0) return priority;
      return String(left.name).localeCompare(String(right.name));
    });
}

function automationHealthPriority(status?: string | null) {
  if (status === "failing") return 0;
  if (status === "waiting_for_approval") return 1;
  if (status === "running") return 2;
  if (status === "paused") return 3;
  if (status === "scheduled") return 4;
  if (status === "healthy") return 5;
  return 6;
}

function capabilityResultMessage(result: Record<string, unknown> | null): string | null {
  if (!result) return null;
  const status = typeof result.status === "string" ? result.status : null;
  const invocationId = typeof result.invocationId === "string" ? result.invocationId : null;
  const error = typeof result.error === "string" ? result.error : null;
  const reason = typeof result.reason === "string" ? result.reason : null;
  const approvalRequestId = typeof result.approvalRequestId === "string" ? result.approvalRequestId : null;
  const consentEndpoint = typeof result.consentEndpoint === "string" ? result.consentEndpoint : null;
  const consent = result.consent && typeof result.consent === "object" ? result.consent as { state?: unknown } : null;
  if (invocationId) return `Queued ${invocationId}.`;
  if (consent?.state === "granted") return "Policy consent granted.";
  if (consent?.state === "revoked") return "Policy consent revoked.";
  if (approvalRequestId) return `Approval requested: ${approvalRequestId}.`;
  if (consentEndpoint) return `Policy consent required before this command can run.`;
  if (error || reason) return [error, reason].filter(Boolean).join(": ");
  return status ? `Request status: ${status}.` : null;
}

function readableWebEditorStatus(status?: string | null) {
  if (status === "not_running") return "Not running";
  if (status === "starting") return "Starting";
  if (status === "stopping") return "Stopping";
  if (status === "ready") return "Ready";
  if (status === "failed") return "Failed";
  if (status === "unsupported") return "Unsupported";
  return readableStatus(status ?? "unknown");
}

function webEditorTone(status?: string | null): Tone {
  if (status === "ready") return "success";
  if (status === "starting" || status === "stopping") return "warning";
  if (status === "failed") return "danger";
  return "neutral";
}

function webEditorFailureNextStep(reason?: string | null) {
  if (reason === "bridge_start_failed")
    return "Check the editor log, then retry Start editor after the local Vite URL is free.";
  if (reason === "desktop_bridge_unavailable")
    return "Start Desktop Bridge, then retry Start editor.";
  if (reason === "bridge_reconnected_process_unverified")
    return "Restart the editor so this Desktop Bridge owns the process.";
  return "Retry Start editor after checking the local bridge and application path.";
}

function webEditorDiagnosticHints(editor?: ApplicationSnapshot["webEditor"] | null): string[] {
  const reason = editor?.reason ?? "";
  const lastError = editor?.lastError ?? "";
  const text = `${reason} ${lastError} ${(editor?.lastLogs ?? []).join(" ")}`.toLowerCase();
  const hints: string[] = [];
  if (text.includes("5173") || text.includes("eaddrinuse") || text.includes("port")) {
    hints.push("Port 5173 may be occupied. Stop the existing dev server or retry after it exits.");
  }
  if (text.includes("pnpm") || text.includes("enoent")) {
    hints.push("Confirm pnpm is available in the Desktop Bridge environment.");
  }
  if (text.includes("unsupported engine") || text.includes("node")) {
    hints.push("Confirm the local Node version satisfies the doocs/md package engine.");
  }
  if (reason === "application_path_not_found" || text.includes("path does not exist")) {
    hints.push("Re-register or update the Application path to the local doocs/md checkout.");
  }
  return hints.slice(0, 3);
}

function formStringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function boundedIntegerInput(value: string, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function wrapperArgInputPayload(argInputs: NpmWrapperArgInputSnapshot[], values: Record<string, string | boolean>) {
  const payload: Record<string, unknown> = {};
  for (const input of argInputs) {
    const value = values[input.key];
    if (input.type === "boolean-flag") {
      if (value === true) payload[input.key] = true;
      continue;
    }
    if (typeof value === "string" && value.trim()) payload[input.key] = value.trim();
  }
  return payload;
}

function wrapperInputSummary(input?: Record<string, unknown> | null) {
  const entries = Object.entries(input ?? {}).filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (!entries.length) return "Inputs default";
  return entries
    .map(([key, value]) => `${key}=${value === true ? "true" : String(value)}`)
    .join(" · ");
}

interface ApplicationRunRecord {
  invocation: InvocationSnapshot;
  capability: string | null;
  routineId: string | null;
  kind: "wrapper" | "mcp" | "orchestration" | "application" | "unknown";
  audit: AuditSnapshot | null;
}

function applicationRuns(
  application: ApplicationSnapshot,
  invocations: InvocationSnapshot[],
  audits: AuditSnapshot[],
): ApplicationRunRecord[] {
  const auditsByInvocation = new Map(audits.map((audit) => [audit.invocationId, audit]));
  return invocations
    .filter((invocation) => invocationApplicationId(invocation) === application.id)
    .map((invocation) => ({
      invocation,
      capability: invocationCapability(invocation),
      routineId: invocationRoutineId(invocation),
      kind: invocationApplicationKind(invocation),
      audit: auditsByInvocation.get(invocation.id) ?? null,
    }))
    .sort((left, right) => timestampValue(right.invocation.createdAt) - timestampValue(left.invocation.createdAt));
}

function invocationApplicationId(invocation: InvocationSnapshot): string | null {
  const metadata = invocation.options?.metadata ?? {};
  return stringValue(metadata.applicationId) ?? invocation.explanation?.source?.applicationId ?? null;
}

function invocationCapability(invocation: InvocationSnapshot): string | null {
  const metadata = invocation.options?.metadata ?? {};
  return stringValue(metadata.capability)
    ?? stringValue(metadata.applicationAction)
    ?? invocation.explanation?.source?.toolName
    ?? null;
}

function invocationRoutineId(invocation: InvocationSnapshot): string | null {
  const metadata = invocation.options?.metadata ?? {};
  return stringValue(metadata.routineId) ?? invocation.explanation?.source?.routineId ?? null;
}

function invocationApplicationKind(invocation: InvocationSnapshot): ApplicationRunRecord["kind"] {
  const metadata = invocation.options?.metadata ?? {};
  if (metadata.source === "application_orchestration" || metadata.routineId) return "orchestration";
  if (metadata.providerType === "mcp" || metadata.mcpToolName) return "mcp";
  if (metadata.applicationWrapper) return "wrapper";
  if (metadata.providerType === "application" || metadata.applicationAction) return "application";
  return "unknown";
}

function capabilityRuns(runs: ApplicationRunRecord[], capabilityName: string, limit = 3) {
  return runs
    .filter((run) => run.capability === capabilityName)
    .slice(0, limit);
}

function invocationAutomationId(invocation: InvocationSnapshot): string | null {
  const metadata = invocation.options?.metadata ?? {};
  return stringValue(metadata.automationId) ?? invocation.explanation?.source?.automationId ?? null;
}

function automationRuns(runs: ApplicationRunRecord[], automation: AutomationSnapshot) {
  return runs.filter((run) => invocationAutomationId(run.invocation) === automation.id);
}

function automationDiagnostics(
  automation: AutomationSnapshot,
  runs: ApplicationRunRecord[],
  capability?: ApplicationCapability | null,
): { title: string; detail: string; tone: "neutral" | "success" | "warning" | "danger"; nextAction: string; consecutiveFailures: number } {
  const health = automation.healthSummary;
  if (health) {
    const latest = health.latestRun;
    const failureStreak = health.failureStreak ?? 0;
    return {
      title: automationHealthTitle(health.status, failureStreak),
      detail: health.lastErrorSummary
        ?? latest?.errorSummary
        ?? latest?.resultSummary
        ?? (automation.enabled ? `Next run ${automation.nextRunAt ? shortTime(automation.nextRunAt) : "not scheduled"}.` : "This schedule is paused."),
      tone: automationHealthTone(health.status),
      nextAction: health.nextAction ?? "Wait for the next scheduled run or use Run now.",
      consecutiveFailures: failureStreak,
    };
  }
  const latest = runs[0] ?? null;
  if (!latest) {
    return {
      title: automation.enabled ? "Scheduled" : "Paused",
      detail: automation.enabled
        ? `Next run ${automation.nextRunAt ? shortTime(automation.nextRunAt) : "not scheduled"}.`
        : "This schedule is paused.",
      tone: automation.enabled ? "neutral" : "warning",
      nextAction: automation.enabled ? "Wait for the next scheduled run or use Run now." : "Resume the schedule when you want it to run again.",
      consecutiveFailures: 0,
    };
  }
  const base = runDiagnostics(latest, capability);
  const consecutiveFailures = runs.findIndex((run) => !["failed", "rejected"].includes(run.invocation.status ?? ""));
  const failureCount = consecutiveFailures === -1 ? runs.length : consecutiveFailures;
  if (failureCount > 0) {
    return {
      ...base,
      title: failureCount > 1 ? `${failureCount} consecutive failures` : base.title,
      nextAction: failureCount > 1
        ? "Pause the schedule if it is noisy, then inspect the latest invocation before retrying."
        : base.nextAction,
      consecutiveFailures: failureCount,
    };
  }
  if (latest.invocation.status === "succeeded") {
    return {
      ...base,
      title: "Healthy",
      detail: base.detail,
      consecutiveFailures: 0,
    };
  }
  return { ...base, consecutiveFailures: 0 };
}

function automationHealthTitle(status?: string | null, failureStreak = 0) {
  if (status === "failing" && failureStreak > 1) return `${failureStreak} consecutive failures`;
  if (status === "failing") return "Failed";
  if (status === "waiting_for_approval") return "Approval";
  if (status === "running") return "Running";
  if (status === "healthy") return "Healthy";
  if (status === "paused") return "Paused";
  return "Scheduled";
}

function automationHealthTone(status?: string | null): "neutral" | "success" | "warning" | "danger" {
  if (status === "healthy") return "success";
  if (status === "failing") return "danger";
  if (status === "waiting_for_approval" || status === "paused") return "warning";
  return "neutral";
}

function latestAutomationInvocationId(automation: AutomationSnapshot) {
  return automation.healthSummary?.latestRun?.invocationId ?? automation.lastInvocationId ?? null;
}

function focusedAutomationActionLabel(automation: AutomationSnapshot) {
  const status = automation.healthSummary?.status ?? (!automation.enabled ? "paused" : "scheduled");
  if (status === "waiting_for_approval") return "Review approval";
  if (status === "paused") return "Resume schedule";
  return "View latest run";
}

function automationNeedsAttention(automation: AutomationSnapshot) {
  const status = automation.healthSummary?.status ?? (!automation.enabled ? "paused" : "scheduled");
  return status === "failing" || status === "waiting_for_approval" || status === "paused";
}

function scrollAutomationIntoView(automationId: string) {
  const element = Array.from(document.querySelectorAll<HTMLElement>("[data-application-automation-id]"))
    .find((item) => item.dataset.applicationAutomationId === automationId);
  element?.scrollIntoView({ block: "center", behavior: "smooth" });
}

function scrollApplicationPanel(panel: string) {
  document.querySelector<HTMLElement>(`[data-application-panel="${panel}"]`)?.scrollIntoView({
    block: "center",
    behavior: "smooth",
  });
}

function runDiagnostics(
  run: ApplicationRunRecord,
  capability?: ApplicationCapability | null,
): { title: string; detail: string; tone: "neutral" | "success" | "warning" | "danger"; nextAction: string } {
  const status = run.invocation.status ?? "unknown";
  const readiness = capability?.metadata?.readiness;
  const auditText = [run.audit?.errorSummary, run.invocation.result?.summary, run.invocation.explanation?.summary]
    .filter(Boolean)
    .join(" ");
  if (readiness?.state === "needs_setup") {
    return {
      title: "Wrapper setup blocked",
      detail: readiness.reason ?? "Wrapper readiness check is not passing.",
      tone: "warning",
      nextAction: "Run probe and fix the wrapper descriptor or install path before retrying.",
    };
  }
  if (readiness?.state === "needs_consent") {
    return {
      title: "Policy consent needed",
      detail: readiness.reason ?? "This wrapper command needs policy consent.",
      tone: "warning",
      nextAction: "Use the Run control to grant policy consent, then retry.",
    };
  }
  if (run.invocation.approvalRequestId || run.invocation.explanation?.approval?.requestId) {
    return {
      title: "Waiting on approval",
      detail: run.invocation.approvalRequestId ?? run.invocation.explanation?.approval?.requestId ?? "Approval required.",
      tone: "warning",
      nextAction: "Approve or deny the linked request from the invocation details.",
    };
  }
  if (status === "succeeded") {
    return {
      title: "Completed",
      detail: run.invocation.result?.summary ?? run.audit?.errorSummary ?? "Run completed successfully.",
      tone: "success",
      nextAction: "Inspect the result if you need the output details.",
    };
  }
  if (status === "failed" || status === "rejected") {
    const agentUnavailable = /agent_not_available|agent unavailable|not available/i.test(auditText);
    const approval = /approval/i.test(auditText);
    const policy = /policy|consent/i.test(auditText);
    const title = agentUnavailable ? "Agent unavailable" : approval ? "Approval blocked" : policy ? "Policy blocked" : "Run failed";
    const nextAction = agentUnavailable
      ? "Register or enable the required application runner, then retry."
      : approval
        ? "Resolve the approval request and retry the capability."
        : policy
          ? "Grant wrapper policy consent from the Run control and retry."
          : "Open the invocation and review the audit summary before retrying.";
    return {
      title,
      detail: run.audit?.errorSummary ?? run.invocation.result?.summary ?? run.invocation.explanation?.summary ?? "No failure summary recorded.",
      tone: "danger",
      nextAction,
    };
  }
  return {
    title: readableStatus(status),
    detail: run.invocation.explanation?.summary ?? run.audit?.errorSummary ?? "Run is still in progress or awaiting dispatch.",
    tone: status === "queued" || status === "running" ? "warning" : "neutral",
    nextAction: run.invocation.explanation?.nextAction ?? "Wait for the run to finish, then inspect the result.",
  };
}

function timestampValue(value?: string | null): number {
  const timestamp = Date.parse(value ?? "");
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

interface PendingConfirm {
  title: string;
  description: string;
  confirmLabel: string;
  destructive: boolean;
  run: () => Promise<unknown>;
}

async function runWithApplicationApproval<T>(
  request: (approvalRequestId?: string) => Promise<T>,
): Promise<T> {
  const initial = await request();
  const approvalRequestId = applicationApprovalRequestId(initial);
  if (!approvalRequestId) return initial;
  await api.approveApproval(approvalRequestId);
  return request(approvalRequestId);
}

function applicationApprovalRequestId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as { approvalRequestId?: unknown; approvalRequest?: unknown };
  if (typeof record.approvalRequestId === "string" && record.approvalRequestId.trim()) {
    return record.approvalRequestId;
  }
  if (typeof record.approvalRequest === "string" && record.approvalRequest.trim()) {
    return record.approvalRequest;
  }
  if (record.approvalRequest && typeof record.approvalRequest === "object" && !Array.isArray(record.approvalRequest)) {
    const nested = record.approvalRequest as { id?: unknown };
    return typeof nested.id === "string" && nested.id.trim() ? nested.id : null;
  }
  return null;
}

function ApplicationActions({
  application,
  onViewResult,
}: {
  application: ApplicationSnapshot;
  onViewResult?: (applicationId: string, resultId?: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const { execute, pending, error } = useAsyncAction();
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [editorMarkdown, setEditorMarkdown] = useState("");
  const [editorHtml, setEditorHtml] = useState("");
  const [editorTheme, setEditorTheme] = useState("default");
  const [editorImportedResultId, setEditorImportedResultId] = useState<string | null>(null);
  const status = application.status;
  const editor = application.webEditor;
  const editorStatus = editor?.status ?? "not_running";
  const editorVisible = Boolean(editor?.available || (editor?.status && editor.status !== "unsupported"));
  const editorBusy = editorStatus === "starting" || editorStatus === "stopping";
  const canStartEditor = Boolean(editor?.available && !["starting", "ready", "stopping"].includes(editorStatus));
  const canStopEditor = Boolean(editor?.available && ["starting", "ready", "failed"].includes(editorStatus));
  const editorUrl = editor?.url ?? null;
  const editorResult = applicationEditorHandoffResult(application);
  const editorResultMeta = applicationEditorHandoffMeta(editorResult);
  const editorResultId = editorResult?.resultRef?.id ?? editorResult?.id ?? null;

  const lifecycle = (action: "probe" | "online" | "offline" | "archive" | "refresh") =>
    runWithApplicationApproval((approvalRequestId) =>
      api.applicationLifecycle(application.id, action, approvalRequestId ? { approvalRequestId } : {}),
    );

  function openEditor() {
    if (!editorUrl) return;
    window.open(editorUrl, "_blank", "noopener,noreferrer");
  }

  useEffect(() => {
    setEditorImportedResultId(null);
  }, [application.id]);

  async function saveEditorResult() {
    const html = editorHtml.trim();
    if (!html) return;
    const ok = await execute(async () => {
      const response = await api.importApplicationEditorResult(application.id, {
        markdown: editorMarkdown.trim() || null,
        html,
        theme: editorTheme.trim() || "default",
        sourceUrl: editorUrl,
      });
      setEditorImportedResultId(response.result?.id ?? response.latestResult?.resultRef?.id ?? null);
      return response;
    });
    if (ok) {
      setEditorHtml("");
      void queryClient.invalidateQueries({ queryKey: ["application-results", application.id] });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lifecycle</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => void execute(() => api.applicationLifecycle(application.id, "probe"))}>
            Probe
          </Button>
          {status !== "active" && status !== "archived" ? (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => setConfirm({
              title: `Bring "${application.name}" online?`,
              description: "Re-enables the application's execution-like capabilities.",
              confirmLabel: "Bring online",
              destructive: false,
              run: () => lifecycle("online"),
            })}>
              Bring online
            </Button>
          ) : null}
          {status === "active" ? (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => setConfirm({
              title: `Take "${application.name}" offline?`,
              description: "Disables its execution-like capabilities until brought back online.",
              confirmLabel: "Take offline",
              destructive: true,
              run: () => lifecycle("offline"),
            })}>
              Take offline
            </Button>
          ) : null}
          {status !== "archived" ? (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => setConfirm({
              title: `Archive "${application.name}"?`,
              description: "Archived applications can no longer be invoked.",
              confirmLabel: "Archive",
              destructive: true,
              run: () => lifecycle("archive"),
            })}>
              Archive
            </Button>
          ) : null}
          {status === "active" ? (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => setConfirm({
              title: `Refresh "${application.name}"?`,
              description: "Re-records the application source state.",
              confirmLabel: "Refresh",
              destructive: false,
              run: () => lifecycle("refresh"),
            })}>
              Refresh
            </Button>
          ) : null}
          {status !== "archived" && status !== "offline" ? (
            <Button size="sm" disabled={pending} onClick={() => setConfirm({
              title: `Generate orchestration for "${application.name}"?`,
              description: "Writes a governed LoopRoutine draft into the managed application directory.",
              confirmLabel: "Generate",
              destructive: false,
              run: () => runWithApplicationApproval((approvalRequestId) =>
                api.generateApplicationOrchestration(application.id, approvalRequestId ? { approvalRequestId } : {}),
              ),
            })}>
              Generate orchestration
            </Button>
          ) : null}
        </div>
        {editorVisible ? (
          <div className="space-y-2 border-t pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">Web editor</p>
                <p className="truncate text-xs text-muted-foreground">
                  {editor?.summary ?? editor?.commandLabel ?? "doocs/md editor"}
                </p>
              </div>
              <Badge tone={webEditorTone(editorStatus)}>{readableWebEditorStatus(editorStatus)}</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" disabled={pending || !canStartEditor} onClick={() => void execute(() => api.applicationWebEditor(application.id, "start"))}>
                <Play />
                {editorBusy && editorStatus === "starting" ? "Starting..." : "Start editor"}
              </Button>
              <Button size="sm" variant="secondary" disabled={!editorUrl} onClick={openEditor}>
                <ExternalLink />
                Open editor
              </Button>
              {editorResultId && onViewResult ? (
                <Button size="sm" variant="secondary" onClick={() => onViewResult(application.id, editorResultId)}>
                  <ExternalLink />
                  View latest editor result
                </Button>
              ) : null}
              <Button size="sm" variant="secondary" disabled={pending || !canStopEditor} onClick={() => void execute(() => api.applicationWebEditor(application.id, "stop"))}>
                <Square />
                {editorBusy && editorStatus === "stopping" ? "Stopping..." : "Stop"}
              </Button>
            </div>
            {editorStatus === "failed" ? (
              <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="danger">editor failed</Badge>
                  {editor?.reason ? <Badge tone="neutral">{editor.reason}</Badge> : null}
                </div>
                <FactList
                  facts={[
                    { term: "Status", value: readableWebEditorStatus(editorStatus) },
                    { term: "Last error", value: editor?.lastError ?? editor?.summary ?? "Not recorded" },
                    { term: "Next step", value: webEditorFailureNextStep(editor?.reason) },
                  ]}
                />
                {webEditorDiagnosticHints(editor).length ? (
                  <ul className="list-inside list-disc text-xs text-muted-foreground">
                    {webEditorDiagnosticHints(editor).map((hint) => (
                      <li key={hint}>{hint}</li>
                    ))}
                  </ul>
                ) : null}
                {editor?.lastLogs?.length ? (
                  <div className="space-y-1 rounded-md border border-border bg-background p-2">
                    <p className="text-xs font-medium text-muted-foreground">Bridge log</p>
                    <div className="space-y-1">
                      {editor.lastLogs.slice(-4).map((line, index) => (
                        <p key={`${index}-${line}`} className="[overflow-wrap:anywhere] font-mono text-xs text-muted-foreground">
                          {line}
                        </p>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            {editorResultMeta ? (
              <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="success">latest handoff</Badge>
                  {editorResultMeta.theme ? <Badge tone="neutral">{editorResultMeta.theme}</Badge> : null}
                  {editorResult?.generatedAt || editorResult?.createdAt ? (
                    <span className="text-xs text-muted-foreground">{shortTime(editorResult.generatedAt ?? editorResult.createdAt)}</span>
                  ) : null}
                </div>
                <FactList
                  facts={[
                    { term: "Post title", value: editorResultMeta.postTitle ?? "—" },
                    { term: "Result", value: editorResultId ?? "—" },
                    { term: "Markdown", value: editorResultMeta.markdownLength == null ? "—" : `${editorResultMeta.markdownLength} chars` },
                    { term: "HTML", value: editorResultMeta.htmlByteLength == null ? "—" : `${editorResultMeta.htmlByteLength} bytes` },
                  ]}
                />
              </div>
            ) : editorStatus === "ready" ? (
              <p className="text-xs text-muted-foreground">
                Edit in doocs/md, then use the header handoff button to send the rendered result back here.
              </p>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Editor Markdown" className="sm:col-span-2">
                <Textarea
                  rows={3}
                  value={editorMarkdown}
                  onChange={(event) => setEditorMarkdown(event.target.value)}
                />
              </Field>
              <Field label="Editor HTML" className="sm:col-span-2">
                <Textarea
                  rows={4}
                  value={editorHtml}
                  onChange={(event) => setEditorHtml(event.target.value)}
                />
              </Field>
              <Field label="Editor Theme">
                <Input
                  value={editorTheme}
                  onChange={(event) => setEditorTheme(event.target.value)}
                />
              </Field>
              <div className="flex items-end gap-2">
                <Button size="sm" disabled={pending || !editorHtml.trim()} onClick={() => void saveEditorResult()}>
                  <CheckCircle2 />
                  Save editor result
                </Button>
                {editorImportedResultId && onViewResult ? (
                  <Button size="sm" variant="secondary" onClick={() => onViewResult(application.id, editorImportedResultId)}>
                    <ExternalLink />
                    View result
                  </Button>
                ) : null}
              </div>
            </div>
            {editor?.lastError && editorStatus !== "failed" ? <p className="text-xs text-destructive">{editor.lastError}</p> : null}
          </div>
        ) : null}
        {error && !confirm ? <p className="text-xs text-destructive">{error}</p> : null}
        <ConfirmModal
          open={Boolean(confirm)}
          title={confirm?.title ?? ""}
          description={confirm?.description}
          confirmLabel={confirm?.confirmLabel}
          destructive={confirm?.destructive}
          pending={pending}
          error={error}
          onConfirm={() => {
            if (!confirm) return;
            const run = confirm.run;
            void execute(run).then((ok) => {
              if (ok) setConfirm(null);
            });
          }}
          onClose={() => setConfirm(null)}
        />
      </CardContent>
    </Card>
  );
}

function ApplicationActionRequired({
  application,
  recoveryActions,
  onViewInvocation,
}: {
  application: ApplicationSnapshot;
  recoveryActions: ApplicationRecoveryActionRequest[];
  onViewInvocation: (invocationId: string) => void;
}) {
  const { execute, pending, error } = useAsyncAction();
  const setSelectedApplicationRun = useUiStore((s) => s.setSelectedApplicationRun);
  const setSelectedApplicationEventLevel = useUiStore((s) => s.setSelectedApplicationEventLevel);
  const setSelectedApplicationAutomationId = useUiStore((s) => s.setSelectedApplicationAutomationId);
  const issues = applicationOperationIssues(application, recoveryActions).slice(0, 4);
  if (!issues.length) return null;

  function runIssueAction(issue: ApplicationOperationIssue) {
    if (issue.action === "probe") {
      void execute(() => api.applicationLifecycle(application.id, "probe"));
      return;
    }
    if (issue.action === "online") {
      void execute(() => runWithApplicationApproval((approvalRequestId) =>
        api.applicationLifecycle(application.id, "online", approvalRequestId ? { approvalRequestId } : {})));
      return;
    }
    if (issue.action === "timeline") {
      setSelectedApplicationEventLevel(issue.eventLevel ?? "all");
      scrollApplicationPanel("timeline");
      return;
    }
    if (issue.action === "automation") {
      if (issue.invocationId) {
        onViewInvocation(issue.invocationId);
        return;
      }
      setSelectedApplicationAutomationId(issue.automationId ?? null);
      if (issue.automationId) scrollAutomationIntoView(issue.automationId);
      return;
    }
    if (issue.action === "recovery" && issue.routineId && issue.invocationId) {
      setSelectedApplicationRun({ applicationId: application.id, routineId: issue.routineId, invocationId: issue.invocationId });
      scrollApplicationPanel("orchestrations");
      return;
    }
    if (issue.action === "descriptors") {
      scrollApplicationPanel("descriptors");
      return;
    }
    if (issue.action === "mcp_probe") {
      if (issue.mcpCandidateId) {
        void execute(() => api.probeApplicationMcpCandidate(application.id, issue.mcpCandidateId!));
        return;
      }
      scrollApplicationPanel("mcp");
      return;
    }
    if (issue.action === "mcp") {
      scrollApplicationPanel("mcp");
      return;
    }
    if (issue.action === "orchestration") {
      scrollApplicationPanel("lifecycle");
      return;
    }
    if (issue.action === "inspect") {
      scrollApplicationPanel("summary");
    }
  }

  return (
    <Card data-application-panel="lifecycle">
      <CardHeader>
        <CardTitle>Action required</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {issues.map((issue) => (
          <div key={issue.id} className="rounded-md border border-border bg-muted/20 p-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={issue.tone}>{issue.title}</Badge>
                  <span className="[overflow-wrap:anywhere] text-xs text-muted-foreground">{issue.detail}</span>
                </div>
              </div>
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => runIssueAction(issue)}>
                {issue.action === "probe" || issue.action === "online" || issue.action === "automation" || issue.action === "recovery" || issue.action === "mcp_probe" ? <Play /> : <Search />}
                {issue.actionLabel}
              </Button>
            </div>
          </div>
        ))}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

function ApplicationRecoveryOperations({
  application,
  recoveryActions,
  onViewInvocation,
}: {
  application: ApplicationSnapshot;
  recoveryActions: ApplicationRecoveryActionRequest[];
  onViewInvocation: (invocationId: string) => void;
}) {
  const { execute, pending, error } = useAsyncAction();
  const setSelectedApplicationRun = useUiStore((s) => s.setSelectedApplicationRun);
  const setSelectedApplicationRecoveryId = useUiStore((s) => s.setSelectedApplicationRecoveryId);
  const [approvedRequestId, setApprovedRequestId] = useState<string | null>(null);
  const [copiedRecoveryId, setCopiedRecoveryId] = useState<string | null>(null);
  const requests = sortedRecoveryActionRequests(
    recoveryActions.filter((request) => request.applicationId === application.id),
  );
  const latest = requests[0] ?? application.healthSummary?.latestRecoveryAction ?? null;
  if (!requests.length && !latest) return null;

  const approvalCount = requests.filter((request) => recoveryActionApprovalPending(request)).length;
  const executedCount = requests.filter((request) => request.executedAt || request.resultInvocationId || request.resultInvocation?.id).length;
  const recoveredCount = requests.filter((request) => request.outcome?.state === "recovered").length;
  const attentionCount = requests.filter((request) => recoveryActionNeedsAttention(request)).length;

  function openRun(request: ApplicationRecoveryActionRequest) {
    setSelectedApplicationRun({
      applicationId: request.applicationId,
      routineId: request.routineId,
      invocationId: request.invocationId,
    });
    setSelectedApplicationRecoveryId(request.id);
    scrollApplicationPanel("orchestrations");
  }

  function copyRecoveryLink(request: ApplicationRecoveryActionRequest) {
    void navigator.clipboard?.writeText(applicationRecoveryDeepLink({
      applicationId: request.applicationId,
      routineId: request.routineId,
      invocationId: request.invocationId,
    }, request.id));
    setCopiedRecoveryId(request.id);
  }

  async function approveRecovery(request: ApplicationRecoveryActionRequest) {
    if (!request.approvalRequestId) return;
    const ok = await execute(async () => {
      await api.approveApproval(request.approvalRequestId!);
      setApprovedRequestId(request.approvalRequestId ?? null);
    });
    if (!ok) setApprovedRequestId(null);
  }

  return (
    <Card data-application-panel="recovery-operations">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Recovery operations</CardTitle>
          {latest ? <Badge tone={recoveryActionRequestTone(latest.status)}>{readableRecoveryActionRequestStatus(latest.status)}</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-4">
          <OperationMetric label="Pending approval" value={approvalCount} tone={approvalCount ? "warning" : "neutral"} />
          <OperationMetric label="Executed" value={executedCount} tone={executedCount ? "success" : "neutral"} />
          <OperationMetric label="Recovered" value={recoveredCount} tone={recoveredCount ? "success" : "neutral"} />
          <OperationMetric label="Needs attention" value={attentionCount} tone={attentionCount ? "danger" : "neutral"} />
        </div>
        {latest ? (
          <div className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral">{readableRecoveryActionType(latest.actionType)}</Badge>
              <Badge tone={recoveryActionRequestTone(latest.status)}>{readableRecoveryActionRequestStatus(latest.status)}</Badge>
              {latest.outcome ? <Badge tone={recoveryOutcomeTone(latest.outcome.state)}>{readableRecoveryOutcome(latest.outcome.state)}</Badge> : null}
              {latest.approvalRequestId ? <Badge tone="warning">approval {latest.approvalRequestId}</Badge> : null}
            </div>
            <p className="[overflow-wrap:anywhere] text-xs text-muted-foreground">
              {latest.explanation?.summary ?? latest.outcome?.summary ?? latest.reason ?? "Recovery action is recorded for this Application."}
            </p>
            {latest.explanation?.nextStep || latest.outcome?.nextStep ? (
              <p className="[overflow-wrap:anywhere] rounded bg-background px-2 py-1 text-xs">
                <span className="font-medium">Next step: </span>
                <span className="text-muted-foreground">{latest.explanation?.nextStep ?? latest.outcome?.nextStep}</span>
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => openRun(latest)}>
                <Search />
                Open recovery run
              </Button>
              <Button size="sm" variant="secondary" onClick={() => copyRecoveryLink(latest)}>
                <Clipboard />
                Copy recovery link
              </Button>
              {latest.resultInvocationId || latest.resultInvocation?.id ? (
                <Button size="sm" variant="secondary" onClick={() => onViewInvocation((latest.resultInvocationId ?? latest.resultInvocation?.id)!)}>
                  <ExternalLink />
                  View result invocation
                </Button>
              ) : null}
              {latest.approvalRequestId ? (
                <Button size="sm" disabled={pending} onClick={() => void approveRecovery(latest)}>
                  <CheckCircle2 />
                  Approve recovery
                </Button>
              ) : null}
            </div>
            {copiedRecoveryId === latest.id ? <p className="text-xs text-success">Copied recovery link.</p> : null}
          </div>
        ) : null}
        {approvedRequestId ? <p className="text-xs text-success">Approved recovery request {approvedRequestId}.</p> : null}
        {requests.length > 1 ? (
          <div className="flex flex-wrap gap-1.5">
            {requests.slice(1, 4).map((request) => (
              <Badge key={request.id} tone={recoveryActionRequestTone(request.status)}>
                {readableRecoveryActionType(request.actionType)} · {readableRecoveryActionRequestStatus(request.status)}
              </Badge>
            ))}
          </div>
        ) : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

function ApplicationApprovalQueue({
  application,
  approvalRequests,
  recoveryActions,
  invocations,
  onViewInvocation,
}: {
  application: ApplicationSnapshot;
  approvalRequests: ApprovalSnapshot[];
  recoveryActions: ApplicationRecoveryActionRequest[];
  invocations: InvocationSnapshot[];
  onViewInvocation: (invocationId: string) => void;
}) {
  const { execute, pending, error } = useAsyncAction();
  const [approvedId, setApprovedId] = useState<string | null>(null);
  const setSelectedApplicationRun = useUiStore((s) => s.setSelectedApplicationRun);
  const setSelectedApplicationRecoveryId = useUiStore((s) => s.setSelectedApplicationRecoveryId);
  const applicationInvocationIds = new Set(
    invocations
      .filter((invocation) => invocationApplicationId(invocation) === application.id)
      .map((invocation) => invocation.id),
  );
  const applicationRecoveryActions = recoveryActions.filter((request) => request.applicationId === application.id);
  const recoveryByApprovalId = new Map(
    applicationRecoveryActions
      .filter((request) => request.approvalRequestId)
      .map((request) => [request.approvalRequestId as string, request]),
  );
  const rows = approvalRequests
    .filter((approval) => {
      if (recoveryByApprovalId.has(approval.id)) return true;
      return approval.invocationId ? applicationInvocationIds.has(approval.invocationId) : false;
    })
    .sort((a, b) => approvalSortRank(a.status) - approvalSortRank(b.status) || a.id.localeCompare(b.id));

  if (rows.length === 0) return null;

  async function approve(approval: ApprovalSnapshot) {
    const ok = await execute(async () => {
      await api.approveApproval(approval.id);
      setApprovedId(approval.id);
    });
    if (!ok) setApprovedId(null);
  }

  function openRecovery(request: ApplicationRecoveryActionRequest) {
    setSelectedApplicationRun({
      applicationId: request.applicationId,
      routineId: request.routineId,
      invocationId: request.invocationId,
    });
    setSelectedApplicationRecoveryId(request.id);
    scrollApplicationPanel("orchestrations");
  }

  return (
    <Card data-application-panel="approval-queue">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Approval queue</CardTitle>
          <Badge tone={rows.some((approval) => isPendingApproval(approval.status)) ? "warning" : "neutral"}>
            {rows.filter((approval) => isPendingApproval(approval.status)).length} pending
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((approval) => {
          const recovery = recoveryByApprovalId.get(approval.id) ?? null;
          const resultInvocationId = recovery?.resultInvocationId ?? recovery?.resultInvocation?.id ?? null;
          return (
            <div key={approval.id} className="space-y-2 rounded-md border border-border bg-muted/20 p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={approvalStatusTone(approval.status)}>{approval.status}</Badge>
                    {approval.riskLevel ? <Badge tone={riskTone(approval.riskLevel)}>Risk {approval.riskLevel}</Badge> : null}
                    {recovery ? <Badge tone="neutral">{readableRecoveryActionType(recovery.actionType)}</Badge> : null}
                    {recovery?.explanation?.blockedReason ? (
                      <Badge tone="warning">{readableRecoveryActionAvailabilityReason(recovery.explanation.blockedReason)}</Badge>
                    ) : null}
                  </div>
                  <p className="[overflow-wrap:anywhere] font-mono text-xs text-muted-foreground">{approval.id}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {approval.invocationId ? (
                    <Button size="sm" variant="secondary" onClick={() => onViewInvocation(approval.invocationId!)}>
                      <ExternalLink />
                      View invocation
                    </Button>
                  ) : null}
                  {recovery ? (
                    <Button size="sm" variant="secondary" onClick={() => openRecovery(recovery)}>
                      <Search />
                      View recovery
                    </Button>
                  ) : null}
                  {resultInvocationId ? (
                    <Button size="sm" variant="secondary" onClick={() => onViewInvocation(resultInvocationId)}>
                      <ExternalLink />
                      View result
                    </Button>
                  ) : null}
                  {isPendingApproval(approval.status) ? (
                    <Button size="sm" disabled={pending} onClick={() => void approve(approval)}>
                      <CheckCircle2 />
                      Approve
                    </Button>
                  ) : null}
                </div>
              </div>
              <FactList
                facts={[
                  { term: "Target", value: recovery ? `Recovery ${recovery.id}` : approval.invocationId ?? "Application approval" },
                  { term: "Requester", value: recovery?.requestedBy ?? "Not recorded" },
                  { term: "Summary", value: approvalSummaryText(approval) ?? recovery?.explanation?.summary ?? recovery?.reason ?? "Not recorded" },
                  { term: "Duplicate guard", value: recovery?.explanation?.blockedReason ? readableRecoveryActionAvailabilityReason(recovery.explanation.blockedReason) : "Clear" },
                  { term: "Latest request", value: recovery?.explanation?.latestRequestId ?? recovery?.explanation?.recoveryActionRequestId ?? recovery?.id ?? "Not recorded" },
                  { term: "Result", value: resultInvocationId ?? "Not linked" },
                ]}
              />
            </div>
          );
        })}
        {approvedId ? <p className="text-xs text-success">Approved request {approvedId}.</p> : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

function isPendingApproval(status: string): boolean {
  return ["pending", "requested", "approval_pending", "waiting_for_approval"].includes(status);
}

function approvalSortRank(status: string): number {
  return isPendingApproval(status) ? 0 : 1;
}

function approvalStatusTone(status: string): Tone {
  if (isPendingApproval(status)) return "warning";
  if (status === "approved" || status === "granted") return "success";
  if (status === "denied" || status === "rejected" || status === "failed") return "danger";
  return "neutral";
}

function approvalSummaryText(approval: ApprovalSnapshot): string | null {
  const summary = approval.summary;
  if (!summary) return null;
  return [summary.risk, summary.data, summary.cost, summary.cancellation].filter(Boolean).join(" · ") || null;
}

function OperationMetric({ label, value, tone }: { label: string; value: number | string; tone: Tone }) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/20 p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">{label}</span>
        <Badge tone={tone}>{value}</Badge>
      </div>
    </div>
  );
}

function recoveryActionApprovalPending(request: ApplicationRecoveryActionRequest): boolean {
  if (!request.approvalRequestId) return false;
  const status = request.status ?? "";
  return !["approved", "completed", "executed", "succeeded", "failed", "cancelled"].includes(status);
}

function recoveryActionNeedsAttention(request: ApplicationRecoveryActionRequest): boolean {
  const state = request.outcome?.state ?? "";
  if (["still_failed", "needs_attention"].includes(state)) return true;
  return ["failed", "blocked", "rejected"].includes(request.status ?? "");
}

function ApplicationDescriptorNextActions({ application }: { application: ApplicationSnapshot }) {
  const { execute, pending, error } = useAsyncAction();
  const setSelectedEvidenceId = useUiStore((s) => s.setSelectedEvidenceId);
  const setSection = useUiStore((s) => s.setSection);
  const [smokeDone, setSmokeDone] = useState<Record<string, boolean>>({});
  const [smokeNotes, setSmokeNotes] = useState<Record<string, string>>({});
  const [copiedEvidenceDraft, setCopiedEvidenceDraft] = useState(false);
  const [savedEvidenceId, setSavedEvidenceId] = useState<string | null>(null);
  const actions = applicationPostSaveActions(application).slice(0, 4);
  useEffect(() => {
    setSmokeDone({});
    setSmokeNotes({});
    setCopiedEvidenceDraft(false);
    setSavedEvidenceId(null);
  }, [application.id, application.lifecycle?.lastOperationAt]);
  if (!actions.length) return null;

  function runAction(action: ApplicationPostSaveAction) {
    if (action.kind === "probe") {
      void execute(() => api.applicationLifecycle(application.id, "probe"));
      return;
    }
    if (action.kind === "orchestration") {
      void execute(() => runWithApplicationApproval((approvalRequestId) =>
        api.generateApplicationOrchestration(application.id, approvalRequestId ? { approvalRequestId } : {}),
      ));
      return;
    }
    if (action.kind === "consent") {
      scrollApplicationPanel("capabilities");
      return;
    }
    if (action.kind === "smoke_plan") {
      scrollApplicationPanel("descriptors");
    }
  }

  function toggleSmokeStep(step: string) {
    setSmokeDone((current) => ({
      ...current,
      [step]: !current[step],
    }));
  }

  function updateSmokeNote(step: string, note: string) {
    setSmokeNotes((current) => ({
      ...current,
      [step]: note,
    }));
  }

  function smokeEvidenceDraft(steps: string[]) {
    const completed = steps.filter((step) => smokeDone[step]);
    return {
      type: "application_smoke_evidence_draft",
      applicationId: application.id,
      applicationName: application.name,
      descriptorOperationAt: application.lifecycle?.lastOperationAt ?? null,
      completedCount: completed.length,
      stepCount: steps.length,
      steps: steps.map((step, index) => ({
        index: index + 1,
        step,
        completed: Boolean(smokeDone[step]),
        note: smokeNotes[step]?.trim() || null,
      })),
    };
  }

  function copySmokeEvidenceDraft(steps: string[]) {
    void navigator.clipboard?.writeText(JSON.stringify(smokeEvidenceDraft(steps), null, 2));
    setCopiedEvidenceDraft(true);
  }

  async function saveSmokeEvidenceDraft(steps: string[]) {
    const draft = smokeEvidenceDraft(steps);
    const summary = [
      `Application smoke evidence for ${application.name}`,
      `${draft.completedCount}/${draft.stepCount} checks complete`,
      draft.steps
        .filter((step) => step.completed)
        .map((step) => step.step)
        .join(", "),
    ].filter(Boolean).join(" · ");
    const ok = await execute(async () => {
      const response = await api.saveApplicationSmokeEvidence(application.id, {
        ...draft,
        repoPath: application.path ?? null,
        summary,
      });
      const id = typeof response.evidence?.id === "string" ? response.evidence.id : null;
      setSavedEvidenceId(id);
      if (id) setSelectedEvidenceId(id);
      return response;
    });
    if (!ok) setSavedEvidenceId(null);
  }

  function viewSavedEvidence() {
    if (!savedEvidenceId) return;
    setSelectedEvidenceId(savedEvidenceId);
    setSection("audit");
  }

  return (
    <Card data-application-panel="descriptor-next-actions">
      <CardHeader>
        <CardTitle>Descriptor next actions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {actions.map((action) => (
          <div key={action.id} className="rounded-md border border-border bg-muted/20 p-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={action.tone}>{action.title}</Badge>
                  <span className="[overflow-wrap:anywhere] text-xs text-muted-foreground">{action.detail}</span>
                </div>
              </div>
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => runAction(action)}>
                {action.kind === "probe" || action.kind === "orchestration" ? <Play /> : <Search />}
                {action.actionLabel}
              </Button>
            </div>
            {action.kind === "smoke_plan" && action.steps?.length ? (
              <div className="mt-3 space-y-2 rounded-md border border-border/70 bg-card/60 p-3 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">Smoke path checklist</span>
                  <Badge tone={action.steps.every((step) => smokeDone[step]) ? "success" : "neutral"}>
                    {action.steps.filter((step) => smokeDone[step]).length}/{action.steps.length} done
                  </Badge>
                </div>
                <ul className="space-y-1" aria-label="Smoke path checklist">
                  {action.steps.map((step, index) => {
                    const done = Boolean(smokeDone[step]);
                    return (
                      <li key={`${step}-${index}`} className="space-y-1 rounded-md border border-border/60 p-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant={done ? "secondary" : "ghost"}
                            className="h-7 px-2 text-xs"
                            aria-pressed={done}
                            onClick={() => toggleSmokeStep(step)}
                          >
                            {done ? <CheckCircle2 /> : <Circle />}
                            {done ? `Done ${step}` : `Mark ${step} done`}
                          </Button>
                          <span className="[overflow-wrap:anywhere] text-muted-foreground">
                            {index + 1}. {step}
                          </span>
                        </div>
                        <Input
                          className="h-8 text-xs"
                          value={smokeNotes[step] ?? ""}
                          onChange={(event) => updateSmokeNote(step, event.target.value)}
                          placeholder={`Evidence note for ${step}`}
                          aria-label={`Evidence note for ${step}`}
                        />
                      </li>
                    );
                  })}
                </ul>
                <div className="space-y-2 rounded-md border border-border/70 bg-background p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">Evidence draft preview</span>
                    <Badge tone={savedEvidenceId ? "success" : "neutral"}>{savedEvidenceId ? "saved" : "draft"}</Badge>
                    <Button type="button" size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={() => copySmokeEvidenceDraft(action.steps!)}>
                      <Clipboard />
                      Copy draft
                    </Button>
                    <Button type="button" size="sm" variant="secondary" className="h-7 px-2 text-xs" disabled={pending} onClick={() => void saveSmokeEvidenceDraft(action.steps!)}>
                      <CheckCircle2 />
                      {pending ? "Saving..." : "Save evidence"}
                    </Button>
                    {copiedEvidenceDraft ? <span className="text-success">Copied evidence draft.</span> : null}
                    {savedEvidenceId ? (
                      <>
                        <span className="text-success">Saved {savedEvidenceId}.</span>
                        <Button type="button" size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={viewSavedEvidence}>
                          <ExternalLink />
                          View evidence
                        </Button>
                      </>
                    ) : null}
                  </div>
                  <pre className="max-h-56 overflow-auto rounded-md bg-muted p-2 text-[11px] text-muted-foreground">
                    {JSON.stringify(smokeEvidenceDraft(action.steps), null, 2)}
                  </pre>
                </div>
              </div>
            ) : null}
          </div>
        ))}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

function ApplicationOnboardingContinuity({ application }: { application: ApplicationSnapshot }) {
  const integrationDrafts = useMemo(() => generateApplicationIntegrationDrafts(application), [application]);
  const postSaveActions = applicationPostSaveActions(application);
  const guide = applicationOnboardingGuide({
    sourceType: application.source.type,
    sourceReady: true,
    hasIntegrationBrief: Boolean(application.integrationBrief),
    hasDescriptorDraft: Boolean(application.mcpAgent || application.wrapper?.commands?.length || application.source.type === "manual"),
    smokeTests: application.integrationBrief?.smokeTests ?? [],
    autoProbeAfterRegister: false,
  });
  const shouldShow = Boolean(application.integrationBrief || integrationDrafts.available || postSaveActions.length);
  if (!shouldShow) return null;

  return (
    <Card data-application-panel="onboarding-continuity">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Onboarding continuity</CardTitle>
          <Badge tone={guide.readinessTone}>{guide.readinessLabel}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          {guide.steps.map((step) => (
            <ApplicationOnboardingStepCard key={step.id} step={step} />
          ))}
        </div>
        {integrationDrafts.available ? (
          <div className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <WandSparkles />
              <span className="font-medium">Descriptor drafts available</span>
              {integrationDrafts.mcpDescriptor ? <Badge tone="neutral">MCP draft</Badge> : null}
              {integrationDrafts.npmWrapper ? <Badge tone="neutral">npm wrapper draft</Badge> : null}
              {integrationDrafts.manualManifest ? <Badge tone="neutral">manual manifest draft</Badge> : null}
            </div>
            <p className="[overflow-wrap:anywhere] text-muted-foreground">{integrationDrafts.summary}</p>
          </div>
        ) : null}
        {postSaveActions.length ? (
          <div className="space-y-2 rounded-md border border-border/70 bg-muted/20 p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <ListChecks />
              <span className="font-medium">Post-save next actions</span>
              <Badge tone="warning">{postSaveActions.length} open</Badge>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {postSaveActions.slice(0, 4).map((action) => (
                <Badge key={action.id} tone={action.tone}>{action.title}</Badge>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ApplicationOnboardingStepCard({ step }: { step: ApplicationOnboardingStep }) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/20 p-3 text-xs">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        {step.status === "done" ? (
          <CheckCircle2 className="size-3.5 text-success" aria-hidden />
        ) : (
          <Circle className={step.status === "current" ? "size-3.5 text-warning" : "size-3.5 text-muted-foreground"} aria-hidden />
        )}
        <span className="font-medium">{step.title}</span>
        <Badge tone={step.tone}>{step.status}</Badge>
      </div>
      <p className="[overflow-wrap:anywhere] text-muted-foreground">{step.detail}</p>
    </div>
  );
}

function ApplicationDescriptorEditor({ application }: { application: ApplicationSnapshot }) {
  const { execute, pending, error, errorDetail } = useAsyncAction();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(application.name);
  const [mcpDescriptor, setMcpDescriptor] = useState("");
  const [wrapperDescriptor, setWrapperDescriptor] = useState("");
  const [manualManifest, setManualManifest] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const descriptorsQuery = useQuery({
    queryKey: ["application-descriptors", application.id],
    queryFn: () => api.getApplicationDescriptors(application.id),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    setName(application.name);
  }, [application.name, open]);

  useEffect(() => {
    if (!open || !descriptorsQuery.data?.descriptors) return;
    const descriptors = descriptorsQuery.data.descriptors;
    setMcpDescriptor(prettyJson(descriptors.mcpAgent));
    setWrapperDescriptor(prettyJson(descriptors.npmWrapper));
    setManualManifest(prettyJson(descriptors.manualManifest));
  }, [descriptorsQuery.data, open]);

  const descriptorDirty = Boolean(descriptorsQuery.data?.descriptors) && (
    name.trim() !== application.name
    || mcpDescriptor !== prettyJson(descriptorsQuery.data?.descriptors.mcpAgent)
    || wrapperDescriptor !== prettyJson(descriptorsQuery.data?.descriptors.npmWrapper)
    || manualManifest !== prettyJson(descriptorsQuery.data?.descriptors.manualManifest)
  );
  const wrapperImpact = useMemo(
    () => application.source.type === "npm" ? wrapperCapabilityImpact(application.id, application.wrapper, wrapperDescriptor) : null,
    [application.id, application.source.type, application.wrapper, wrapperDescriptor],
  );
  const riskPreview = useMemo(
    () => descriptorRiskPreview(application, { mcpDescriptor, wrapperDescriptor, manualManifest }),
    [application, manualManifest, mcpDescriptor, wrapperDescriptor],
  );
  const integrationDrafts = useMemo(() => generateApplicationIntegrationDrafts(application), [application]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    const update: Record<string, unknown> = {};
    if (name.trim() && name.trim() !== application.name) update.name = name.trim();

    const mcpCleared = mcpDescriptor.trim() === "null";
    const mcp = parseOptionalJsonObjectAllowNull(mcpDescriptor, "MCP descriptor");
    if (mcp.error) {
      setFormError(mcp.error);
      return;
    }
    if (mcpCleared) update.mcpAgent = null;
    else if (mcp.value) update.mcpAgent = mcp.value;

    if (application.source.type === "npm") {
      const wrapperCleared = wrapperDescriptor.trim() === "null";
      const wrapper = parseOptionalJsonObjectAllowNull(wrapperDescriptor, "npm wrapper descriptor");
      if (wrapper.error) {
        setFormError(wrapper.error);
        return;
      }
      if (wrapperCleared) update.npmWrapper = null;
      else if (wrapper.value) update.npmWrapper = wrapper.value;
    }

    if (application.source.type === "manual") {
      const manifestCleared = manualManifest.trim() === "null";
      const manifest = parseOptionalJsonObjectAllowNull(manualManifest, "Manual manifest");
      if (manifest.error) {
        setFormError(manifest.error);
        return;
      }
      if (manifestCleared) update.manualManifest = null;
      else if (manifest.value) update.manualManifest = manifest.value;
    }

    void execute(() => api.updateApplicationDescriptors(application.id, update)).then((ok) => {
      if (ok) setOpen(false);
    });
  }

  return (
    <Card data-application-panel="descriptors">
      <CardHeader>
        <CardTitle>Descriptors</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <FactList
          facts={[
            { term: "MCP descriptor", value: application.mcpAgent ? application.mcpAgent.agentId ?? "registered" : "Not configured" },
            { term: "npm wrapper", value: application.source.type === "npm" ? `${application.wrapper?.mode ?? "metadata-only"} · ${application.wrapper?.commands?.length ?? 0} command(s)` : "Not an npm Application" },
            { term: "Wrapper install", value: application.source.type === "npm" ? application.wrapper?.installState ?? "not_installed" : "Not an npm Application" },
            { term: "Wrapper readiness", value: application.source.type === "npm" ? application.wrapper?.readiness?.state ?? "Not checked" : "Not an npm Application" },
            { term: "Wrapper checked", value: application.source.type === "npm" ? shortTime(application.wrapper?.readiness?.checkedAt) : "Not an npm Application" },
            { term: "Capabilities version", value: application.capabilitiesVersion ?? "Not recorded" },
            { term: "Last descriptor edit", value: application.lifecycle?.lastOperation === "update_descriptors" ? shortTime(application.lifecycle.lastOperationAt) : "Not recorded" },
            { term: "Manual manifest", value: application.source.type === "manual" ? "Editable" : "Not a manual Application" },
          ]}
        />
        {application.wrapper?.readiness ? (
          <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={readinessTone(application.wrapper.readiness.state)}>
                {application.wrapper.readiness.reason ?? application.wrapper.readiness.state}
              </Badge>
              <span className="text-muted-foreground">
                {application.wrapper.readiness.readyCommandIds?.length ?? 0} ready · {application.wrapper.readiness.blockedCommandIds?.length ?? 0} blocked
              </span>
            </div>
            {application.wrapper.readiness.blockedCommandIds?.length ? (
              <div className="flex flex-wrap gap-1.5">
                {application.wrapper.readiness.blockedCommandIds.map((commandId) => (
                  <Badge key={commandId} tone="warning">{commandId}</Badge>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {application.integrationBrief ? (
          <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="success">{application.integrationBrief.version ?? "application-intake.v1"}</Badge>
              <Badge tone="neutral">{application.integrationBrief.status ?? "draft"}</Badge>
              <span className="text-muted-foreground">Codex draft inputs saved</span>
            </div>
            {application.integrationBrief.intent ? (
              <p className="[overflow-wrap:anywhere] text-muted-foreground">{application.integrationBrief.intent}</p>
            ) : null}
            <div className="flex flex-wrap gap-1.5">
              {integrationDrafts.mcpDescriptor ? <Badge tone="neutral">MCP draft</Badge> : null}
              {integrationDrafts.npmWrapper ? <Badge tone="neutral">npm wrapper draft</Badge> : null}
              {integrationDrafts.manualManifest ? <Badge tone="neutral">manual manifest draft</Badge> : null}
            </div>
          </div>
        ) : null}
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          <Pencil />
          Edit descriptors
        </Button>
        <Modal open={open} onClose={() => setOpen(false)} title="Edit application descriptors" description="Update the reviewed descriptor JSON for this Application." size="lg">
          <form className="space-y-3" onSubmit={submit}>
            {integrationDrafts.available ? (
              <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <WandSparkles />
                  <span className="font-medium">Codex descriptor drafts</span>
                  <Badge tone="warning">review before save</Badge>
                </div>
                <p className="[overflow-wrap:anywhere] text-muted-foreground">{integrationDrafts.summary}</p>
                <div className="flex flex-wrap gap-2">
                  {integrationDrafts.mcpDescriptor ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={descriptorsQuery.isLoading}
                      onClick={() => setMcpDescriptor(prettyJson(integrationDrafts.mcpDescriptor))}
                    >
                      Apply MCP draft
                    </Button>
                  ) : null}
                  {integrationDrafts.npmWrapper ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={descriptorsQuery.isLoading}
                      onClick={() => setWrapperDescriptor(prettyJson(integrationDrafts.npmWrapper))}
                    >
                      Apply npm wrapper draft
                    </Button>
                  ) : null}
                  {integrationDrafts.manualManifest ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={descriptorsQuery.isLoading}
                      onClick={() => setManualManifest(prettyJson(integrationDrafts.manualManifest))}
                    >
                      Apply manual manifest draft
                    </Button>
                  ) : null}
                </div>
                <ul className="space-y-1 text-muted-foreground">
                  {integrationDrafts.notes.map((note) => (
                    <li key={note} className="[overflow-wrap:anywhere]">{note}</li>
                  ))}
                </ul>
                {integrationDrafts.reviewChecklist.length || integrationDrafts.smokePlan.length ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    {integrationDrafts.reviewChecklist.length ? (
                      <div className="space-y-2 rounded-md border border-border/70 bg-card/60 p-3">
                        <div className="font-medium">Review checklist</div>
                        <ul className="space-y-1 text-muted-foreground">
                          {integrationDrafts.reviewChecklist.map((item) => (
                            <li key={item} className="[overflow-wrap:anywhere]">{item}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {integrationDrafts.smokePlan.length ? (
                      <div className="space-y-2 rounded-md border border-border/70 bg-card/60 p-3">
                        <div className="font-medium">Smoke test plan</div>
                        <ul className="space-y-1 text-muted-foreground">
                          {integrationDrafts.smokePlan.map((item) => (
                            <li key={item} className="[overflow-wrap:anywhere]">{item}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
            <Field label="Name">
              <Input value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label="MCP descriptor JSON">
              <Textarea
                rows={7}
                value={mcpDescriptor}
                onChange={(event) => setMcpDescriptor(event.target.value)}
                placeholder='{"transport":"stdio","command":"node","args":["server.mjs"],"allowedTools":["render"]}'
              />
            </Field>
            {application.mcpAgent ? (
              <Button type="button" size="sm" variant="secondary" onClick={() => setMcpDescriptor("null")}>
                Remove MCP descriptor
              </Button>
            ) : null}
            {application.source.type === "npm" ? (
              <>
                <NpmWrapperCommandBuilder
                  descriptorText={wrapperDescriptor}
                  onDescriptorTextChange={setWrapperDescriptor}
                />
                <Field label="npm wrapper descriptor JSON">
                  <Textarea
                    rows={9}
                    value={wrapperDescriptor}
                    onChange={(event) => setWrapperDescriptor(event.target.value)}
                    placeholder='{"mode":"installed-wrapper","installState":"installed","packageManager":"npm","commands":[{"id":"lint","commandType":"npm_script","command":"lint","status":"approved"}]}'
                  />
                </Field>
                {application.wrapper ? (
                  <Button type="button" size="sm" variant="secondary" onClick={() => setWrapperDescriptor("null")}>
                    Clear npm wrapper
                  </Button>
                ) : null}
              </>
            ) : null}
            {application.source.type === "manual" ? (
              <>
                <Field label="Manual manifest JSON">
                  <Textarea
                    rows={6}
                    value={manualManifest}
                    onChange={(event) => setManualManifest(event.target.value)}
                    placeholder='{"capabilities":[]}'
                  />
                </Field>
                <Button type="button" size="sm" variant="secondary" onClick={() => setManualManifest("null")}>
                  Reset manual manifest
                </Button>
              </>
            ) : null}
            {descriptorsQuery.isLoading ? <p className="text-xs text-muted-foreground">Loading descriptors...</p> : null}
            {descriptorsQuery.isError ? <p className="text-xs text-destructive">Could not load descriptors.</p> : null}
            {descriptorDirty ? <p className="text-xs text-muted-foreground">Unsaved descriptor changes</p> : null}
            <WrapperCapabilityImpactPanel impact={wrapperImpact} />
            <DescriptorRiskPreviewPanel preview={riskPreview} />
            <DescriptorFeedbackList message={formError ?? error} error={formError ? null : errorDetail} />
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={pending || descriptorsQuery.isLoading}>
                {pending ? "Saving..." : "Save descriptors"}
              </Button>
            </div>
          </form>
        </Modal>
      </CardContent>
    </Card>
  );
}

function ApplicationResultSummary({
  result,
  onViewInvocation,
  onViewResult,
}: {
  result?: ApplicationResultRef | null;
  onViewInvocation: (invocationId: string) => void;
  onViewResult: (applicationId: string, resultId?: string | null) => void;
}) {
  if (!result) return null;
  const importedCount = result.importedRecordCount ?? result.importedRecordIds?.length ?? 0;
  const resultRecord = result.renderResult ?? result.artifactResult ?? null;
  const resultSummary = applicationResultSummary(resultRecord);
  const theme = applicationResultTheme(resultRecord);
  const hash = applicationResultPrimaryHash(resultRecord);
  const isRender = applicationResultIsRender(resultRecord);
  const source = applicationResultSource(resultRecord);
  const postTitle = applicationResultPostTitle(resultRecord);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Latest result</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={statusTone(result.status ?? "unknown")}>{readableStatus(result.status ?? "unknown")}</Badge>
          {result.outputCollection ? <Badge tone="neutral">{result.outputCollection}</Badge> : null}
          {importedCount > 0 ? <Badge tone="success">{importedCount} imported</Badge> : null}
          {source === "application_web_editor" ? <Badge tone="success">Web editor</Badge> : null}
        </div>
        <FactList
          facts={[
            { term: "Capability", value: result.capability ?? result.applicationAction ?? "—" },
            { term: "Source", value: source === "application_web_editor" ? "Web editor handoff" : source ?? "—" },
            { term: "Post title", value: postTitle ?? "—" },
            { term: "MCP tool", value: result.mcpToolName ?? "—" },
            { term: "Invocation", value: result.invocationId ?? "—" },
            { term: "Completed", value: shortTime(result.completedAt) },
            { term: "Result ref", value: result.resultRef?.id ?? resultRecord?.id ?? "—" },
            { term: "Result type", value: isRender ? "Rendered HTML" : resultRecord?.artifactType ?? "Artifact" },
            { term: "Theme", value: theme ?? "—" },
            { term: isRender ? "Markdown hash" : "Data hash", value: hash ? hash.slice(0, 12) : "—" },
            {
              term: "Imported records",
              value: importedCount > 0 ? (result.importedRecordIds ?? []).join(", ") || String(importedCount) : "None",
            },
          ]}
        />
        {resultSummary ? (
          <p className="[overflow-wrap:anywhere] rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            {resultSummary}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {result.resultRef?.id ? (
            <Button size="sm" variant="secondary" onClick={() => onViewResult(result.applicationId, result.resultRef?.id)}>
              <ExternalLink />
              View result
            </Button>
          ) : null}
          {result.invocationId ? (
          <Button size="sm" variant="secondary" onClick={() => onViewInvocation(result.invocationId!)}>
            <ExternalLink />
            View invocation
          </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function ApplicationResultsHistory({
  application,
  currentProjectId,
  invocations,
  onViewInvocation,
  onViewResult,
}: {
  application: ApplicationSnapshot;
  currentProjectId?: string | null;
  invocations: InvocationSnapshot[];
  onViewInvocation: (invocationId: string) => void;
  onViewResult: (applicationId: string, resultId?: string | null) => void;
}) {
  const { execute, pending, error } = useAsyncAction();
  const [rerunningResultId, setRerunningResultId] = useState<string | null>(null);
  const [resultSearch, setResultSearch] = useState("");
  const [resultType, setResultType] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [artifactType, setArtifactType] = useState("");
  const [governanceFilter, setGovernanceFilter] = useState("active");
  const [compareResultIds, setCompareResultIds] = useState<string[]>([]);
  const [copiedResultId, setCopiedResultId] = useState<string | null>(null);
  const [savedEvidenceResultId, setSavedEvidenceResultId] = useState<string | null>(null);
  const retention = application.resultRetention ?? {
    enabled: false,
    keepLatest: 20,
    archiveAfterDays: null,
    lastRunAt: null,
    lastArchivedCount: 0,
    lastSummary: null,
  };
  const [retentionEnabled, setRetentionEnabled] = useState(Boolean(retention.enabled));
  const [keepLatestInput, setKeepLatestInput] = useState(String(retention.keepLatest ?? 20));
  const [archiveAfterDaysInput, setArchiveAfterDaysInput] = useState(
    retention.archiveAfterDays == null ? "" : String(retention.archiveAfterDays),
  );
  useEffect(() => {
    setRetentionEnabled(Boolean(retention.enabled));
    setKeepLatestInput(String(retention.keepLatest ?? 20));
    setArchiveAfterDaysInput(retention.archiveAfterDays == null ? "" : String(retention.archiveAfterDays));
  }, [application.id, retention.archiveAfterDays, retention.enabled, retention.keepLatest, retention.updatedAt]);
  const resultFilters = useMemo(() => {
    const filters: {
      limit: number;
      q?: string;
      resultType?: string;
      source?: string;
      artifactType?: string;
      pinned?: boolean;
      archived?: boolean;
      includeArchived?: boolean;
    } = { limit: 10 };
    const q = resultSearch.trim();
    if (q) filters.q = q;
    if (resultType !== "all") filters.resultType = resultType;
    if (sourceFilter !== "all") filters.source = sourceFilter;
    if (artifactType) filters.artifactType = artifactType;
    if (governanceFilter === "pinned") {
      filters.pinned = true;
      filters.includeArchived = true;
    } else if (governanceFilter === "archived") {
      filters.archived = true;
    } else if (governanceFilter === "all") {
      filters.includeArchived = true;
    }
    return filters;
  }, [artifactType, governanceFilter, resultSearch, resultType, sourceFilter]);
  const resultsQuery = useQuery({
    queryKey: ["application-results", application.id, resultFilters],
    queryFn: () => api.listApplicationResults(application.id, resultFilters),
    enabled: Boolean(application.id),
    refetchInterval: 3000,
  });
  const results = resultsQuery.data?.results ?? [];
  const totalCount = resultsQuery.data?.count ?? results.length;

  async function rerunResult(result: ApplicationResultRecord) {
    const toolName = toolNameForApplicationResult(application, result);
    const invocation = invocationForApplicationResult(invocations, result);
    const toolArguments = invocation?.options?.toolArguments ?? null;
    if (!toolName || !toolArguments) return;
    const projectId = application.projectId ?? currentProjectId ?? null;
    const payload = {
      ...toolArguments,
      ...(projectId && !Object.prototype.hasOwnProperty.call(toolArguments, "projectId") ? { projectId } : {}),
    };
    setRerunningResultId(result.id);
    const ok = await execute(() => api.createToolInvocation(toolName, payload));
    setRerunningResultId(null);
    if (ok) void resultsQuery.refetch();
  }

  async function copyResultExport(result: ApplicationResultRecord) {
    await navigator.clipboard?.writeText(JSON.stringify(applicationResultExportPayload(application, result), null, 2));
    setCopiedResultId(result.id);
  }

  async function saveResultEvidence(result: ApplicationResultRecord) {
    setSavedEvidenceResultId(null);
    const ok = await execute(() => api.saveImportedEvidence({
      source: "application_result_center",
      repoPath: applicationSourcePath(application),
      summary: applicationResultEvidenceSummary(application, result),
    }));
    if (ok) setSavedEvidenceResultId(result.id);
  }

  async function updateResultGovernance(result: ApplicationResultRecord, body: Parameters<typeof api.updateApplicationResult>[2]) {
    const ok = await execute(() => api.updateApplicationResult(application.id, result.id, body));
    if (ok) void resultsQuery.refetch();
  }

  async function saveRetentionPolicy() {
    const ok = await execute(() => api.updateApplicationResultRetention(application.id, {
      enabled: retentionEnabled,
      keepLatest: boundedIntegerInput(keepLatestInput, 20, 0, 500),
      archiveAfterDays: archiveAfterDaysInput.trim()
        ? boundedIntegerInput(archiveAfterDaysInput, 30, 0, 3650)
        : null,
    }));
    if (ok) void resultsQuery.refetch();
  }

  async function runRetentionPolicy() {
    const ok = await execute(() => api.runApplicationResultRetention(application.id));
    if (ok) void resultsQuery.refetch();
  }

  function toggleCompareResult(resultId: string) {
    setCompareResultIds((current) => {
      if (current.includes(resultId)) return current.filter((id) => id !== resultId);
      return [...current.slice(-1), resultId];
    });
  }

  const compareResults = compareResultIds
    .map((id) => results.find((result) => result.id === id))
    .filter(Boolean) as ApplicationResultSummaryItem[];
  const resultMetrics = applicationResultOperationMetrics(application, results, invocations);

  return (
    <Card data-application-panel="results-history">
      <CardHeader>
        <CardTitle>Results</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ApplicationResultOperations metrics={resultMetrics} totalCount={totalCount} fetching={resultsQuery.isFetching} />
        <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="space-y-1">
              <p className="text-sm font-medium">Retention</p>
              <p className="text-xs text-muted-foreground">
                {retention.lastRunAt
                  ? `Last run ${shortTime(retention.lastRunAt)} · archived ${retention.lastArchivedCount ?? 0} result(s)`
                  : "No retention run yet"}
                {retention.lastSummary?.skippedPinnedCount
                  ? ` · skipped ${retention.lastSummary.skippedPinnedCount} pinned`
                  : ""}
              </p>
            </div>
            <Badge tone={retention.enabled ? "success" : "neutral"}>
              {retention.enabled ? "auto enabled" : "manual only"}
            </Badge>
          </div>
          <div className="grid gap-2 md:grid-cols-[minmax(120px,160px)_140px_170px_auto]">
            <label className="flex h-10 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm">
              <input
                type="checkbox"
                className="size-4"
                aria-label="Auto retention enabled"
                checked={retentionEnabled}
                onChange={(event) => setRetentionEnabled(event.target.checked)}
              />
              Auto archive
            </label>
            <Field label="Keep latest">
              <Input
                aria-label="Keep latest results"
                type="number"
                min={0}
                max={500}
                value={keepLatestInput}
                onChange={(event) => setKeepLatestInput(event.target.value)}
              />
            </Field>
            <Field label="Archive after days">
              <Input
                aria-label="Archive results after days"
                type="number"
                min={0}
                max={3650}
                value={archiveAfterDaysInput}
                onChange={(event) => setArchiveAfterDaysInput(event.target.value)}
                placeholder="Never"
              />
            </Field>
            <div className="flex flex-wrap items-end gap-2">
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => void saveRetentionPolicy()}>
                <CheckCircle2 />
                Save policy
              </Button>
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => void runRetentionPolicy()}>
                <CalendarClock />
                Run now
              </Button>
            </div>
          </div>
          {retention.lastSummary?.archivedResultIds?.length ? (
            <p className="text-xs text-muted-foreground">
              Recent archive: {retention.lastSummary.archivedResultIds.slice(0, 3).join(", ")}
              {retention.lastSummary.archivedResultIds.length > 3 ? "..." : ""}
            </p>
          ) : null}
        </div>
        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_150px_170px_170px_150px]">
          <Field label="Search results">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search results"
                className="pl-8"
                value={resultSearch}
                onChange={(event) => setResultSearch(event.target.value)}
                placeholder="Tool, hash, summary"
              />
            </div>
          </Field>
          <Field label="Result type">
            <Select aria-label="Result type" value={resultType} onChange={(event) => setResultType(event.target.value)}>
              <option value="all">All</option>
              <option value="render">Rendered HTML</option>
              <option value="artifact">Artifacts</option>
            </Select>
          </Field>
          <Field label="Source">
            <Select aria-label="Result source" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
              <option value="all">All sources</option>
              <option value="application_web_editor">Web editor</option>
              <option value="application_mcp_result">MCP result</option>
              <option value="application_orchestration">Orchestration</option>
            </Select>
          </Field>
          <Field label="Artifact type">
            <Select aria-label="Artifact type" value={artifactType} onChange={(event) => setArtifactType(event.target.value)}>
              <option value="">All artifacts</option>
              <option value="html">HTML</option>
              <option value="option_catalog">Option catalog</option>
              <option value="json_summary">JSON summary</option>
              <option value="evidence_record">Evidence record</option>
            </Select>
          </Field>
          <Field label="Governance">
            <Select aria-label="Governance" value={governanceFilter} onChange={(event) => setGovernanceFilter(event.target.value)}>
              <option value="active">Active</option>
              <option value="pinned">Pinned</option>
              <option value="archived">Archived</option>
              <option value="all">All</option>
            </Select>
          </Field>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{resultsQuery.isFetching ? "Refreshing results..." : `Showing ${results.length} of ${totalCount} result(s)`}</span>
          {(resultSearch || resultType !== "all" || sourceFilter !== "all" || artifactType || governanceFilter !== "active") ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setResultSearch("");
                setResultType("all");
                setSourceFilter("all");
                setArtifactType("");
                setGovernanceFilter("active");
              }}
            >
              Clear filters
            </Button>
          ) : null}
        </div>
        {resultsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading results...</p>
        ) : resultsQuery.isError ? (
          <p className="text-sm text-destructive">Could not load results.</p>
        ) : results.length ? (
          <div className="space-y-2">
            {results.map((result) => {
              const invocation = invocationForApplicationResult(invocations, result);
              const toolName = toolNameForApplicationResult(application, result);
              const canRerun = Boolean(toolName && invocation?.options?.toolArguments);
              const rerunning = pending && rerunningResultId === result.id;
              const theme = applicationResultTheme(result);
              const bytes = applicationResultBytes(result);
              const hash = applicationResultPrimaryHash(result);
              const summary = applicationResultSummary(result);
              const governance = applicationResultGovernance(result);
              const selectedForCompare = compareResultIds.includes(result.id);
              const source = applicationResultSource(result);
              const postTitle = applicationResultPostTitle(result);
              return (
                <div key={result.id} className="space-y-2 rounded-md border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone="success">succeeded</Badge>
                        {governance.pinned ? <Badge tone="success">pinned</Badge> : null}
                        {governance.archived ? <Badge tone="warning">archived</Badge> : null}
                        {result.artifactType ? <Badge tone="neutral">{result.artifactType}</Badge> : null}
                        {result.evidenceType ? <Badge tone="neutral">{result.evidenceType}</Badge> : null}
                        {theme ? <Badge tone="neutral">{theme}</Badge> : null}
                        {source === "application_web_editor" ? <Badge tone="success">Web editor</Badge> : null}
                      </div>
                      <p className="min-w-0 [overflow-wrap:anywhere] text-xs font-medium">
                        {postTitle ? `${postTitle} · ${result.id}` : result.id}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{shortTime(result.generatedAt ?? result.createdAt)}</span>
                  </div>
                  <FactList
                    facts={[
                      { term: "Capability", value: result.capability ?? toolName ?? "—" },
                      { term: "Source", value: source === "application_web_editor" ? "Web editor handoff" : source ?? "—" },
                      { term: "MCP tool", value: result.mcpToolName ?? "—" },
                      { term: "Invocation", value: result.invocationId ?? "—" },
                      { term: applicationResultIsRender(result) ? "HTML bytes" : "Artifact bytes", value: bytes == null ? "—" : String(bytes) },
                      { term: applicationResultIsRender(result) ? "Markdown hash" : "Data hash", value: hash ? hash.slice(0, 12) : "—" },
                    ]}
                  />
                  {summary ? (
                    <p className="[overflow-wrap:anywhere] rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                      {summary}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <label className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-xs">
                      <input
                        type="checkbox"
                        className="size-4"
                        aria-label={`Compare ${result.id}`}
                        checked={selectedForCompare}
                        onChange={() => toggleCompareResult(result.id)}
                      />
                      Compare
                    </label>
                    <ApplicationResultActionBar
                      applicationId={application.id}
                      result={result}
                      pending={pending}
                      rerunning={rerunning}
                      canRerun={canRerun}
                      onViewResult={onViewResult}
                      onUpdateGovernance={updateResultGovernance}
                      onCopyExport={copyResultExport}
                      onSaveEvidence={saveResultEvidence}
                      onViewInvocation={onViewInvocation}
                      onRerun={rerunResult}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {resultSearch || resultType !== "all" || sourceFilter !== "all" || artifactType || governanceFilter !== "active" ? "No matching results." : "No results recorded yet."}
          </p>
        )}
        <ApplicationResultCompare
          applicationId={application.id}
          results={compareResults}
          onClear={() => setCompareResultIds([])}
          onViewResult={onViewResult}
        />
        {copiedResultId ? <p className="text-xs text-success">Copied export for {copiedResultId}.</p> : null}
        {savedEvidenceResultId ? <p className="text-xs text-success">Saved evidence for {savedEvidenceResultId}.</p> : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

function ApplicationResultOperations({
  metrics,
  totalCount,
  fetching,
}: {
  metrics: ApplicationResultOperationMetrics;
  totalCount: number;
  fetching: boolean;
}) {
  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <p className="text-sm font-medium">Result operations</p>
          <p className="text-xs text-muted-foreground">
            {fetching ? "Refreshing result state..." : `${metrics.visibleCount} visible · ${totalCount} total`}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {metrics.latestStatus ? <Badge tone={statusTone(metrics.latestStatus)}>{readableStatus(metrics.latestStatus)}</Badge> : null}
          {metrics.latestResultId ? <Badge tone="neutral">{metrics.latestResultId}</Badge> : null}
          {metrics.latestImportedCount > 0 ? <Badge tone="success">{metrics.latestImportedCount} imported</Badge> : null}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <OperationMetric label="Active results" value={metrics.activeCount} tone={metrics.activeCount ? "success" : "neutral"} />
        <OperationMetric label="Pinned" value={metrics.pinnedCount} tone={metrics.pinnedCount ? "success" : "neutral"} />
        <OperationMetric label="Archived" value={metrics.archivedCount} tone={metrics.archivedCount ? "warning" : "neutral"} />
        <OperationMetric label="Evidence-ready" value={metrics.evidenceReadyCount} tone={metrics.evidenceReadyCount ? "success" : "neutral"} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Badge tone="neutral">{metrics.renderCount} render</Badge>
        <Badge tone="neutral">{metrics.artifactCount} artifact</Badge>
        <Badge tone={metrics.rerunnableCount ? "success" : "neutral"}>{metrics.rerunnableCount} rerunnable</Badge>
        <Badge tone={metrics.exportableCount ? "success" : "neutral"}>{metrics.exportableCount} exportable</Badge>
      </div>
    </div>
  );
}

interface ApplicationResultOperationMetrics {
  visibleCount: number;
  activeCount: number;
  pinnedCount: number;
  archivedCount: number;
  evidenceReadyCount: number;
  renderCount: number;
  artifactCount: number;
  rerunnableCount: number;
  exportableCount: number;
  latestStatus: string | null;
  latestResultId: string | null;
  latestImportedCount: number;
}

function applicationResultOperationMetrics(
  application: ApplicationSnapshot,
  results: ApplicationResultSummaryItem[],
  invocations: InvocationSnapshot[],
): ApplicationResultOperationMetrics {
  return {
    visibleCount: results.length,
    activeCount: results.filter((result) => !applicationResultGovernance(result).archived).length,
    pinnedCount: results.filter((result) => applicationResultGovernance(result).pinned).length,
    archivedCount: results.filter((result) => applicationResultGovernance(result).archived).length,
    evidenceReadyCount: results.filter(applicationResultEvidenceReady).length,
    renderCount: results.filter(applicationResultIsRender).length,
    artifactCount: results.filter((result) => !applicationResultIsRender(result)).length,
    rerunnableCount: results.filter((result) => {
      const invocation = invocationForApplicationResult(invocations, result);
      return Boolean(toolNameForApplicationResult(application, result) && invocation?.options?.toolArguments);
    }).length,
    exportableCount: results.length,
    latestStatus: application.latestResult?.status ?? null,
    latestResultId: application.latestResult?.resultRef?.id
      ?? application.latestResult?.renderResult?.id
      ?? application.latestResult?.artifactResult?.id
      ?? null,
    latestImportedCount: application.latestResult?.importedRecordCount
      ?? application.latestResult?.importedRecordIds?.length
      ?? 0,
  };
}

function applicationResultEvidenceReady(result: ApplicationResultSummaryItem): boolean {
  return Boolean(result.evidenceType || result.resultRef?.id || result.lineage?.resultRef?.id);
}

function ApplicationResultCompare({
  applicationId,
  results,
  onClear,
  onViewResult,
}: {
  applicationId: string;
  results: ApplicationResultSummaryItem[];
  onClear: () => void;
  onViewResult: (applicationId: string, resultId?: string | null) => void;
}) {
  if (!results.length) return null;
  if (results.length < 2) {
    return (
      <div className="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
        Select one more result to compare lineage, hashes, and payload shape.
      </div>
    );
  }
  const [left, right] = results;
  const rows = applicationResultComparisonRows(left, right);
  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">Result compare</p>
          <p className="text-xs text-muted-foreground">{left.id} vs {right.id}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => onViewResult(applicationId, left.id)}>
            <ExternalLink />
            Left
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onViewResult(applicationId, right.id)}>
            <ExternalLink />
            Right
          </Button>
          <Button size="sm" variant="ghost" onClick={onClear}>Clear</Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="w-32 py-1 pr-3 font-medium">Field</th>
              <th className="py-1 pr-3 font-medium">Left</th>
              <th className="py-1 pr-3 font-medium">Right</th>
              <th className="w-24 py-1 font-medium">State</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-border/70 align-top">
                <td className="py-1.5 pr-3 text-muted-foreground">{row.label}</td>
                <td className="py-1.5 pr-3 [overflow-wrap:anywhere]">{row.left}</td>
                <td className="py-1.5 pr-3 [overflow-wrap:anywhere]">{row.right}</td>
                <td className="py-1.5">
                  <Badge tone={row.same ? "success" : "warning"}>{row.same ? "same" : "diff"}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const DEFAULT_MCP_MARKDOWN = "# doocs/md preview\n\nThis safe sample validates the governed MCP render path.";

interface McpToolRunEntry {
  toolName: string;
  sharedName: string;
  capability?: ApplicationCapability | null;
  inputSchema: Record<string, unknown>;
}

function McpToolSchemaRunForm({
  application,
  currentProjectId,
  entry,
  invocations,
  onViewInvocation,
}: {
  application: ApplicationSnapshot;
  currentProjectId?: string | null;
  entry: McpToolRunEntry;
  invocations: InvocationSnapshot[];
  onViewInvocation: (invocationId: string) => void;
}) {
  const { execute, pending, error } = useAsyncAction();
  const schemaKey = JSON.stringify(entry.inputSchema ?? {});
  const fields = useMemo(() => mcpSchemaFields(entry.inputSchema), [schemaKey]);
  const defaults = useMemo(() => defaultMcpToolFormValues(fields), [fields]);
  const [values, setValues] = useState<Record<string, unknown>>(defaults);
  const [createdInvocationId, setCreatedInvocationId] = useState<string | null>(null);
  const createdInvocation = createdInvocationId
    ? invocations.find((invocation) => invocation.id === createdInvocationId) ?? null
    : null;
  const status = createdInvocation?.status ?? (createdInvocationId ? "queued" : "queued");
  const projectId = application.projectId ?? currentProjectId ?? null;
  const canRun = application.status !== "archived" && application.mcpAgent?.agentStatus !== "disabled" && requiredMcpFieldsPresent(fields, values);

  useEffect(() => {
    setValues(defaults);
    setCreatedInvocationId(null);
  }, [entry.sharedName, schemaKey]);

  function setFieldValue(name: string, value: unknown) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  async function runTool() {
    const payload = {
      ...mcpToolArgumentsFromForm(fields, values),
      ...(projectId ? { projectId } : {}),
    };
    const ok = await execute(async () => {
      const response = await api.createToolInvocation(entry.sharedName, payload);
      const invocationId = typeof response.invocationId === "string" ? response.invocationId : response.invocation?.id ?? null;
      setCreatedInvocationId(invocationId);
      return response;
    });
    if (!ok) setCreatedInvocationId(null);
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge tone={createdInvocationId ? statusTone(status) : "neutral"}>{createdInvocationId ? readableStatus(status) : "ready"}</Badge>
          <Badge tone="neutral">{entry.sharedName}</Badge>
          {entry.capability?.metadata?.resultPath?.outputCollection ? (
            <Badge tone="neutral">{entry.capability.metadata.resultPath.outputCollection}</Badge>
          ) : null}
        </div>
        {createdInvocationId ? (
          <Button size="sm" variant="secondary" onClick={() => onViewInvocation(createdInvocationId)}>
            <ExternalLink />
            View invocation
          </Button>
        ) : null}
      </div>
      {fields.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {fields.map((field) => (
            <McpSchemaField
              key={field.name}
              field={field}
              value={values[field.name]}
              disabled={pending}
              onChange={(value) => setFieldValue(field.name, value)}
            />
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending || !canRun} onClick={() => void runTool()}>
          <Play />
          {pending ? "Starting..." : `Run ${entry.toolName}`}
        </Button>
        {fields.length ? (
          <Badge tone="neutral">{fields.length} input field{fields.length === 1 ? "" : "s"}</Badge>
        ) : (
          <Badge tone="neutral">no input</Badge>
        )}
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

interface McpSchemaFieldSpec {
  name: string;
  required: boolean;
  schema: Record<string, unknown>;
  type: string;
  enumValues: string[];
}

function McpSchemaField({
  field,
  value,
  disabled,
  onChange,
}: {
  field: McpSchemaFieldSpec;
  value: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  const label = field.required ? `${field.name} *` : field.name;
  if (field.enumValues.length) {
    return (
      <Field label={label}>
        <Select value={String(value ?? "")} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
          {!field.required ? <option value="">—</option> : null}
          {field.enumValues.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </Select>
      </Field>
    );
  }
  if (field.type === "boolean") {
    return (
      <label className="flex min-h-9 items-center gap-2 rounded-md border border-border bg-input/40 px-3 py-2 text-sm">
        <input
          type="checkbox"
          className="size-4"
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      </label>
    );
  }
  if (field.type === "number" || field.type === "integer") {
    return (
      <Field label={label}>
        <Input
          type="number"
          value={value == null ? "" : String(value)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))}
        />
      </Field>
    );
  }
  if (field.type === "object" || field.type === "array") {
    return (
      <Field label={label} className="sm:col-span-2">
        <Textarea
          rows={4}
          value={typeof value === "string" ? value : JSON.stringify(value ?? (field.type === "array" ? [] : {}), null, 2)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      </Field>
    );
  }
  return (
    <Field label={label} className={field.name.toLowerCase().includes("markdown") ? "sm:col-span-2" : undefined}>
      <Input
        value={String(value ?? "")}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

function ApplicationMcpSummary({
  application,
  capabilities,
  currentProjectId,
  invocations,
  onViewInvocation,
  onViewResult,
}: {
  application: ApplicationSnapshot;
  capabilities: ApplicationCapability[];
  currentProjectId?: string | null;
  invocations: InvocationSnapshot[];
  onViewInvocation: (invocationId: string) => void;
  onViewResult: (applicationId: string, resultId?: string | null) => void;
}) {
  const { execute, pending, error } = useAsyncAction();
  const mcpAgent = application.mcpAgent;
  const servers = application.probe?.mcpServers ?? [];
  const [confirmCandidate, setConfirmCandidate] = useState<ApplicationProbeMcpServer | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [markdown, setMarkdown] = useState(DEFAULT_MCP_MARKDOWN);
  const [theme, setTheme] = useState("default");
  const [createdInvocationId, setCreatedInvocationId] = useState<string | null>(null);
  if (!mcpAgent && servers.length === 0) return null;
  const renderToolName = (mcpAgent?.sharedToolNames ?? []).find((name) => name.endsWith(".render_markdown")) ?? null;
  const schemaToolEntries = mcpToolRunEntries(application, capabilities)
    .filter((entry) => renderToolName ? entry.sharedName !== renderToolName : true);
  const listThemesEntry = schemaToolEntries.find((entry) => entry.sharedName.endsWith(".list_themes")) ?? null;
  const latestRenderRun = latestMcpRenderRun(application, invocations, createdInvocationId);
  const resultRefId = application.latestResult?.resultRef?.id ?? application.latestResult?.renderResult?.id ?? null;
  const canRunRender = Boolean(renderToolName) && application.status !== "archived" && mcpAgent?.agentStatus !== "disabled";
  const renderCapability = renderToolName ? capabilities.find((capability) => capability.name === renderToolName) : null;
  const status = latestRenderRun?.status ?? (pending ? "running" : createdInvocationId ? "queued" : "queued");

  function closeConfirm() {
    if (pending) return;
    setConfirmCandidate(null);
    setAcknowledged(false);
  }

  function confirmManualCandidate(candidate: ApplicationProbeMcpServer) {
    void execute(() => runWithApplicationApproval((approvalRequestId) =>
      api.confirmApplicationMcpCandidate(application.id, candidate.id, approvalRequestId ? { approvalRequestId } : {}),
    )).then((ok) => {
      if (ok) closeConfirm();
    });
  }

  function probeHttpCandidate(candidate: ApplicationProbeMcpServer) {
    void execute(() => api.probeApplicationMcpCandidate(application.id, candidate.id));
  }

  async function runRenderMarkdown(input: { markdown: string; theme: string }) {
    if (!renderToolName) return;
    const projectId = application.projectId ?? currentProjectId ?? null;
    const payload = {
      markdown: input.markdown,
      theme: input.theme || "default",
      ...(projectId ? { projectId } : {}),
    };
    const ok = await execute(async () => {
      const response = await api.createToolInvocation(renderToolName, payload);
      const invocationId = typeof response.invocationId === "string" ? response.invocationId : response.invocation?.id ?? null;
      setCreatedInvocationId(invocationId);
      return response;
    });
    if (!ok) setCreatedInvocationId(null);
  }

  async function runSchemaTool(entry: McpToolRunEntry) {
    const projectId = application.projectId ?? currentProjectId ?? null;
    const ok = await execute(() => api.createToolInvocation(entry.sharedName, {
      ...(projectId ? { projectId } : {}),
    }));
    if (ok && entry.sharedName.endsWith(".list_themes")) {
      setCreatedInvocationId(null);
    }
  }

  function rerunLastInput() {
    const toolArguments = latestRenderRun?.options?.toolArguments;
    const lastMarkdown = toolArguments && typeof toolArguments === "object" && !Array.isArray(toolArguments) && typeof toolArguments.markdown === "string"
      ? toolArguments.markdown
      : markdown;
    const lastTheme = toolArguments && typeof toolArguments === "object" && !Array.isArray(toolArguments) && typeof toolArguments.theme === "string"
      ? toolArguments.theme
      : theme;
    setMarkdown(lastMarkdown);
    setTheme(lastTheme);
    void runRenderMarkdown({ markdown: lastMarkdown, theme: lastTheme });
  }

  return (
    <Card data-application-panel="mcp">
      <CardHeader>
        <CardTitle>MCP tools</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {mcpAgent ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="success">registered</Badge>
              {mcpAgent.agentStatus ? <Badge tone={mcpAgent.agentStatus === "disabled" ? "danger" : "success"}>{mcpAgent.agentStatus}</Badge> : null}
              {mcpAgent.toolNamespace ? <Badge tone="neutral">{mcpAgent.toolNamespace}</Badge> : null}
              {mcpAgent.discovery?.autoRegistered ? <Badge tone="success">auto-registered</Badge> : null}
            </div>
            <FactList
              facts={[
                { term: "Agent", value: mcpAgent.agentId ?? "—" },
                { term: "Tools", value: (mcpAgent.allowedTools ?? []).join(", ") || "—" },
                { term: "Shared names", value: (mcpAgent.sharedToolNames ?? []).join(", ") || "—" },
                { term: "Recovery", value: mcpAgent.recovery?.reason ?? "—" },
              ]}
            />
            {mcpAgent.recovery?.nextAction ? (
              <p className="[overflow-wrap:anywhere] rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                {mcpAgent.recovery.nextAction}
              </p>
            ) : null}
            {renderToolName ? (
              <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
                <div className="space-y-2 rounded-md border border-border bg-background p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">doocs/md quick actions</p>
                      <p className="text-xs text-muted-foreground">Open the editor path, run a sample render, inspect themes, or jump to the latest result.</p>
                    </div>
                    <Badge tone="success">guided</Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" disabled={pending} onClick={() => void execute(() => api.applicationLifecycle(application.id, "probe"))}>
                      <RefreshCw />
                      Probe
                    </Button>
                    <Button size="sm" disabled={pending || !canRunRender} onClick={() => void runRenderMarkdown({ markdown: DEFAULT_MCP_MARKDOWN, theme: "default" })}>
                      <Play />
                      Render sample
                    </Button>
                    {listThemesEntry ? (
                      <Button size="sm" variant="secondary" disabled={pending} onClick={() => void runSchemaTool(listThemesEntry)}>
                        <ListChecks />
                        List themes
                      </Button>
                    ) : null}
                    <Button size="sm" variant="secondary" disabled={!resultRefId} onClick={() => onViewResult(application.id, resultRefId)}>
                      <ExternalLink />
                      View latest result
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={statusTone(status)}>{readableStatus(status)}</Badge>
                    <Badge tone="neutral">{renderToolName}</Badge>
                    {renderCapability?.metadata?.resultPath?.outputCollection ? (
                      <Badge tone="neutral">{renderCapability.metadata.resultPath.outputCollection}</Badge>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" disabled={pending} onClick={() => void execute(() => api.applicationLifecycle(application.id, "probe"))}>
                      <RefreshCw />
                      Re-probe MCP
                    </Button>
                    <Button size="sm" variant="secondary" disabled={pending || !latestRenderRun} onClick={rerunLastInput}>
                      <RotateCcw />
                      Run last input
                    </Button>
                    <Button size="sm" variant="secondary" disabled={!resultRefId} onClick={() => onViewResult(application.id, resultRefId)}>
                      <ExternalLink />
                      View result
                    </Button>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem]">
                  <Field label="Markdown">
                    <Textarea
                      rows={5}
                      value={markdown}
                      disabled={pending}
                      onChange={(event) => setMarkdown(event.target.value)}
                    />
                  </Field>
                  <Field label="Theme">
                    <Input
                      value={theme}
                      disabled={pending}
                      onChange={(event) => setTheme(event.target.value)}
                    />
                  </Field>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" disabled={pending || !canRunRender || !markdown.trim()} onClick={() => void runRenderMarkdown({ markdown, theme })}>
                    <Play />
                    {pending ? "Starting..." : "Run render"}
                  </Button>
                  {latestRenderRun?.id ? (
                    <Button size="sm" variant="secondary" onClick={() => onViewInvocation(latestRenderRun.id)}>
                      <ExternalLink />
                      View invocation
                    </Button>
                  ) : null}
                  <span className="text-xs text-muted-foreground">
                    {mcpRunNextAction(latestRenderRun, mcpAgent.recovery)}
                  </span>
                </div>
              </div>
            ) : null}
            {schemaToolEntries.length ? (
              <div className="space-y-2">
                {schemaToolEntries.map((entry) => (
                  <McpToolSchemaRunForm
                    key={entry.sharedName}
                    application={application}
                    currentProjectId={currentProjectId}
                    entry={entry}
                    invocations={invocations}
                    onViewInvocation={onViewInvocation}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {servers.length ? (
          <div className="space-y-2">
            {servers.map((server) => (
              <div key={server.id} className="space-y-2 rounded-md border border-border p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{server.serverName}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {server.transport ? <Badge tone="neutral">{server.transport}</Badge> : null}
                    {server.confidence ? <Badge tone={confidenceTone(server.confidence)}>{server.confidence} confidence</Badge> : null}
                    {server.autoRegister ? <Badge tone="success">auto register</Badge> : <Badge tone="warning">manual confirm</Badge>}
                    {server.review?.liveProbe ? (
                      <Badge tone={mcpLiveProbeTone(server.review.liveProbe.state)}>
                        {mcpLiveProbeLabel(server.review.liveProbe.state)}
                      </Badge>
                    ) : null}
                  </div>
                </div>
                <FactList
                  facts={[
                    { term: "Source", value: server.sourcePath ?? server.source ?? "—" },
                    { term: "Preview", value: server.adapterPreview?.command ? `${server.adapterPreview.command} · ${server.adapterPreview.argCount ?? 0} args` : server.adapterPreview?.url ?? "—" },
                    { term: "Reason", value: server.autoRegisterReason ?? "—" },
                    { term: "Boundary", value: server.review?.dataBoundary ?? "—" },
                    { term: "Policies", value: server.review ? `${server.review.filePolicy ?? "—"} files / ${server.review.networkPolicy ?? "—"} network` : "—" },
                    { term: "Endpoint", value: server.review?.endpointOrigin ?? "—" },
                    { term: "Tools", value: (server.allowedTools ?? []).join(", ") || "—" },
                    ...mcpLiveProbeFacts(server),
                  ]}
                />
                {server.review?.liveProbe?.nextAction || server.review?.liveProbe?.message ? (
                  <p className="[overflow-wrap:anywhere] rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                    {server.review.liveProbe.nextAction ?? server.review.liveProbe.message}
                  </p>
                ) : null}
                {!mcpAgent && !server.autoRegister && server.status === "ready" ? (
                  <div className="flex flex-wrap justify-end gap-2">
                    {mcpHttpLiveProbeRequired(server) && server.review?.liveProbe?.state !== "succeeded" ? (
                      <Button size="sm" variant="secondary" disabled={pending} onClick={() => probeHttpCandidate(server)}>
                        <Search />
                        {mcpProbeActionLabel(server)}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={pending || !mcpCandidateReadyToConfirm(server)}
                      onClick={() => {
                        setConfirmCandidate(server);
                        setAcknowledged(false);
                      }}
                    >
                      Review MCP
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <ManualMcpConfirmModal
          candidate={confirmCandidate}
          open={Boolean(confirmCandidate)}
          pending={pending}
          acknowledged={acknowledged}
          error={error}
          onAcknowledgedChange={setAcknowledged}
          onClose={closeConfirm}
          onConfirm={() => {
            if (confirmCandidate) confirmManualCandidate(confirmCandidate);
          }}
        />
      </CardContent>
    </Card>
  );
}

function ManualMcpConfirmModal({
  candidate,
  open,
  pending,
  acknowledged,
  error,
  onAcknowledgedChange,
  onClose,
  onConfirm,
}: {
  candidate: ApplicationProbeMcpServer | null;
  open: boolean;
  pending: boolean;
  acknowledged: boolean;
  error: string | null;
  onAcknowledgedChange: (value: boolean) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!candidate) return null;
  const preview = candidate.adapterPreview?.command
    ? `${candidate.adapterPreview.command} · ${candidate.adapterPreview.argCount ?? 0} args`
    : candidate.adapterPreview?.url ?? "—";
  const canConfirm = mcpCandidateReadyToConfirm(candidate);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Review ${candidate.serverName}`}
      description="Confirm this MCP candidate before it is registered as shared Application tools."
      size="lg"
      closeDisabled={pending}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {candidate.transport ? <Badge tone="neutral">{candidate.transport}</Badge> : null}
          {candidate.confidence ? <Badge tone={confidenceTone(candidate.confidence)}>{candidate.confidence} confidence</Badge> : null}
          <Badge tone="warning">manual confirm</Badge>
          {candidate.review?.liveProbe ? (
            <Badge tone={mcpLiveProbeTone(candidate.review.liveProbe.state)}>
              {mcpLiveProbeLabel(candidate.review.liveProbe.state)}
            </Badge>
          ) : null}
        </div>
        <FactList
          facts={[
            { term: "Source", value: candidate.sourcePath ?? candidate.source ?? "—" },
            { term: "Preview", value: preview },
            { term: "Reason", value: candidate.review?.manualConfirmationReason ?? candidate.autoRegisterReason ?? "—" },
            { term: "Boundary", value: candidate.review?.dataBoundary ?? "—" },
            { term: "Policies", value: candidate.review ? `${candidate.review.filePolicy ?? "—"} files / ${candidate.review.networkPolicy ?? "—"} network` : "—" },
            { term: "Endpoint", value: candidate.review?.endpointOrigin ?? "—" },
            { term: "Tools", value: (candidate.allowedTools ?? []).join(", ") || "—" },
            ...mcpLiveProbeFacts(candidate),
          ]}
        />
        {!canConfirm ? (
          <p className="[overflow-wrap:anywhere] rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
            Run a successful HTTP MCP live probe before confirming this candidate.
          </p>
        ) : null}
        <label className="flex items-start gap-2 rounded-md border border-border bg-background p-3 text-xs">
          <input
            type="checkbox"
            className="mt-0.5 size-4"
            checked={acknowledged}
            disabled={pending}
            onChange={(event) => onAcknowledgedChange(event.target.checked)}
          />
          <span className="text-muted-foreground">
            I reviewed the MCP source, local execution boundary, file/network policy, and allowed tools.
          </span>
        </label>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="sm" disabled={pending || !acknowledged || !canConfirm} onClick={onConfirm}>
            {pending ? "Confirming..." : "Confirm MCP"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ApplicationResultActionBar({
  applicationId,
  result,
  pending,
  rerunning,
  canRerun,
  showViewResult = true,
  onViewResult,
  onUpdateGovernance,
  onCopyExport,
  onSaveEvidence,
  onViewInvocation,
  onRerun,
}: {
  applicationId: string;
  result: ApplicationResultRecord;
  pending: boolean;
  rerunning?: boolean;
  canRerun?: boolean;
  showViewResult?: boolean;
  onViewResult?: (applicationId: string, resultId?: string | null) => void;
  onUpdateGovernance: (result: ApplicationResultRecord, body: Parameters<typeof api.updateApplicationResult>[2]) => void | Promise<void>;
  onCopyExport: (result: ApplicationResultRecord) => void | Promise<void>;
  onSaveEvidence: (result: ApplicationResultRecord) => void | Promise<void>;
  onViewInvocation?: (invocationId: string) => void;
  onRerun?: (result: ApplicationResultRecord) => void | Promise<void>;
}) {
  const governance = applicationResultGovernance(result);
  return (
    <>
      {showViewResult && onViewResult ? (
        <Button size="sm" variant="secondary" onClick={() => onViewResult(applicationId, result.id)}>
          <ExternalLink />
          View result
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() => void onUpdateGovernance(result, {
          pinned: !governance.pinned,
          note: governance.pinned ? null : "Pinned from Result Center.",
        })}
      >
        <Pin />
        {governance.pinned ? "Unpin" : "Pin"}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() => void onUpdateGovernance(result, {
          archived: !governance.archived,
          note: governance.archived ? null : "Archived from Result Center.",
        })}
      >
        {governance.archived ? <RotateCcw /> : <Archive />}
        {governance.archived ? "Restore" : "Archive"}
      </Button>
      <Button size="sm" variant="secondary" onClick={() => void onCopyExport(result)}>
        <Clipboard />
        Copy export
      </Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() => void onSaveEvidence(result)}
      >
        <CheckCircle2 />
        Save evidence
      </Button>
      {result.invocationId && onViewInvocation ? (
        <Button size="sm" variant="secondary" onClick={() => onViewInvocation(result.invocationId!)}>
          <ExternalLink />
          View invocation
        </Button>
      ) : null}
      {onRerun ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={!canRerun || pending}
          onClick={() => void onRerun(result)}
        >
          <RotateCcw />
          {rerunning ? "Rerunning..." : "Rerun"}
        </Button>
      ) : null}
    </>
  );
}

function ApplicationRenderResultModal({
  target,
  application,
  currentProjectId,
  invocations,
  onViewInvocation,
  onClose,
}: {
  target: { applicationId: string; resultId?: string | null } | null;
  application: ApplicationSnapshot;
  currentProjectId?: string | null;
  invocations: InvocationSnapshot[];
  onViewInvocation: (invocationId: string) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { execute, pending, error: actionError } = useAsyncAction();
  const [copiedResultLink, setCopiedResultLink] = useState(false);
  const [copiedResultExport, setCopiedResultExport] = useState(false);
  const [savedEvidenceResultId, setSavedEvidenceResultId] = useState<string | null>(null);
  const [rerunningResultId, setRerunningResultId] = useState<string | null>(null);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["application-render-result", target?.applicationId, target?.resultId ?? "latest"],
    queryFn: () => target?.resultId
      ? api.getApplicationResult(target.applicationId, target.resultId)
      : api.getLatestApplicationResult(target!.applicationId),
    enabled: Boolean(target?.applicationId),
  });
  useEffect(() => {
    setCopiedResultLink(false);
    setCopiedResultExport(false);
    setSavedEvidenceResultId(null);
    setRerunningResultId(null);
  }, [target?.applicationId, target?.resultId]);
  const result = data?.result ?? null;
  const html = applicationResultHtml(result);
  const summary = applicationResultSummary(result);
  const theme = applicationResultTheme(result);
  const bytes = applicationResultBytes(result);
  const primaryHash = applicationResultPrimaryHash(result);
  const artifactPayload = html == null ? applicationResultPayloadPreview(result) : null;
  const lineage = result?.lineage ?? null;
  const governance = applicationResultGovernance(result);
  const resultLinkId = result?.id ?? target?.resultId ?? null;
  const retention = application.resultRetention ?? null;
  const invocation = result ? invocationForApplicationResult(invocations, result) : null;
  const toolName = result ? toolNameForApplicationResult(application, result) : null;
  const canRerun = Boolean(toolName && invocation?.options?.toolArguments);
  const handoffMeta = applicationEditorHandoffMeta(result);
  const handoffSource = applicationResultSource(result);

  function copyResultLink() {
    if (!target?.applicationId || !resultLinkId) return;
    void navigator.clipboard?.writeText(applicationResultDeepLink(target.applicationId, resultLinkId));
    setCopiedResultLink(true);
  }

  async function refreshResultViews() {
    await refetch();
    if (target?.applicationId) {
      await queryClient.invalidateQueries({ queryKey: ["application-results", target.applicationId] });
    }
  }

  async function updateResultGovernance(resultRecord: ApplicationResultRecord, body: Parameters<typeof api.updateApplicationResult>[2]) {
    const ok = await execute(() => api.updateApplicationResult(application.id, resultRecord.id, body));
    if (ok) void refreshResultViews();
  }

  async function copyResultExport(resultRecord: ApplicationResultRecord) {
    await navigator.clipboard?.writeText(JSON.stringify(applicationResultExportPayload(application, resultRecord), null, 2));
    setCopiedResultExport(true);
  }

  async function saveResultEvidence(resultRecord: ApplicationResultRecord) {
    setSavedEvidenceResultId(null);
    const ok = await execute(() => api.saveImportedEvidence({
      source: "application_result_center",
      repoPath: applicationSourcePath(application),
      summary: applicationResultEvidenceSummary(application, resultRecord),
    }));
    if (ok) setSavedEvidenceResultId(resultRecord.id);
  }

  async function rerunResult(resultRecord: ApplicationResultRecord) {
    const invocation = invocationForApplicationResult(invocations, resultRecord);
    const toolName = toolNameForApplicationResult(application, resultRecord);
    const toolArguments = invocation?.options?.toolArguments ?? null;
    if (!toolName || !toolArguments) return;
    const projectId = application.projectId ?? currentProjectId ?? null;
    const payload = {
      ...toolArguments,
      ...(projectId && !Object.prototype.hasOwnProperty.call(toolArguments, "projectId") ? { projectId } : {}),
    };
    setRerunningResultId(resultRecord.id);
    const ok = await execute(() => api.createToolInvocation(toolName, payload));
    setRerunningResultId(null);
    if (ok) void queryClient.invalidateQueries({ queryKey: ["application-results", application.id] });
  }

  return (
    <Modal
      open={Boolean(target)}
      onClose={onClose}
      title="Application result"
      description={result?.id ? [result.id, theme].filter(Boolean).join(" · ") : "Application result"}
      size="lg"
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading result...</p>
      ) : error ? (
        <p className="text-sm text-destructive">Could not load the application result.</p>
      ) : result ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="success">{html == null ? "recorded" : "rendered"}</Badge>
            {governance.pinned ? <Badge tone="success">pinned</Badge> : null}
            {governance.archived ? <Badge tone="warning">archived</Badge> : null}
            {result.artifactType ? <Badge tone="neutral">{result.artifactType}</Badge> : null}
            {result.evidenceType ? <Badge tone="neutral">{result.evidenceType}</Badge> : null}
            {theme ? <Badge tone="neutral">{theme}</Badge> : null}
            {handoffSource === "application_web_editor" ? <Badge tone="success">Web editor</Badge> : null}
            {bytes ? <Badge tone="neutral">{bytes} bytes</Badge> : null}
            <Badge tone={retention?.enabled ? "success" : "neutral"}>
              {retention?.enabled ? "retention auto" : "retention manual"}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={copyResultLink}>
              <Clipboard />
              Copy link
            </Button>
            <ApplicationResultActionBar
              applicationId={application.id}
              result={result}
              pending={pending}
              rerunning={rerunningResultId === result.id}
              canRerun={canRerun}
              showViewResult={false}
              onUpdateGovernance={updateResultGovernance}
              onCopyExport={copyResultExport}
              onSaveEvidence={saveResultEvidence}
              onViewInvocation={onViewInvocation}
              onRerun={rerunResult}
            />
            {copiedResultLink ? <span className="text-xs text-success">Copied result link.</span> : null}
            {copiedResultExport ? <span className="text-xs text-success">Copied export.</span> : null}
            {savedEvidenceResultId ? <span className="text-xs text-success">Saved evidence.</span> : null}
          </div>
          {actionError ? <p className="text-xs text-destructive">{actionError}</p> : null}
          {handoffMeta ? (
            <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="success">Editor handoff</Badge>
                {handoffMeta.theme ? <Badge tone="neutral">{handoffMeta.theme}</Badge> : null}
              </div>
              <FactList
                facts={[
                  { term: "Post title", value: handoffMeta.postTitle ?? "—" },
                  { term: "Source", value: "Web editor handoff" },
                  { term: "Markdown", value: handoffMeta.markdownLength == null ? "—" : `${handoffMeta.markdownLength} chars` },
                  { term: "HTML", value: handoffMeta.htmlByteLength == null ? "—" : `${handoffMeta.htmlByteLength} bytes` },
                  { term: "Editor URL", value: handoffMeta.editorUrl ?? "—" },
                ]}
              />
            </div>
          ) : null}
          <FactList
            facts={[
              { term: "Invocation", value: result.invocationId ?? "—" },
              { term: "Agent", value: lineage?.agentId ?? result.agentId ?? "—" },
              { term: "Capability", value: lineage?.capability ?? result.capability ?? "—" },
              { term: "MCP tool", value: lineage?.mcpToolName ?? result.mcpToolName ?? "—" },
              { term: "Collection", value: lineage?.outputCollection ?? result.outputCollection ?? "—" },
              { term: "Result ref", value: result.resultRef?.id ?? "—" },
              { term: "Governance", value: applicationResultGovernanceLabel(result) },
              { term: "Retention", value: applicationResultRetentionLabel(application) },
              { term: html == null ? "Data hash" : "Markdown hash", value: primaryHash ? primaryHash.slice(0, 16) : "—" },
              { term: html == null ? "Shape" : "HTML hash", value: html == null ? applicationResultShapeLabel(result) : applicationResultHtmlHash(result)?.slice(0, 16) ?? "—" },
              { term: "Generated", value: shortTime(result.generatedAt ?? result.createdAt) },
            ]}
          />
          {summary ? (
            <p className="[overflow-wrap:anywhere] rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              {summary}
            </p>
          ) : null}
          {governance.note ? (
            <p className="[overflow-wrap:anywhere] rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              {governance.note}
            </p>
          ) : null}
          {html != null ? (
            <div className="h-80 overflow-hidden rounded-md border border-border bg-background">
              <iframe
                title="Rendered markdown result"
                srcDoc={html}
                sandbox=""
                className="h-full w-full bg-white"
              />
            </div>
          ) : (
            <pre className="max-h-80 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              {artifactPayload}
            </pre>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No application result is available.</p>
      )}
    </Modal>
  );
}

function latestMcpRenderRun(
  application: ApplicationSnapshot,
  invocations: InvocationSnapshot[],
  createdInvocationId?: string | null,
): InvocationSnapshot | null {
  const direct = createdInvocationId ? invocations.find((invocation) => invocation.id === createdInvocationId) : null;
  if (direct) return direct;
  const candidates = invocations.filter((invocation) => {
    const metadata = invocation.options?.metadata;
    return metadata?.providerType === "mcp"
      && metadata.applicationId === application.id
      && (
        metadata.mcpToolName === "render_markdown"
        || metadata.capability === "doocs_md.render_markdown"
        || String(metadata.capability ?? "").endsWith(".render_markdown")
      );
  });
  return candidates.sort((left, right) =>
    Date.parse(right.createdAt ?? right.updatedAt ?? "") - Date.parse(left.createdAt ?? left.updatedAt ?? ""))[0] ?? null;
}

function invocationForApplicationResult(
  invocations: InvocationSnapshot[],
  result: ApplicationResultRecord,
): InvocationSnapshot | null {
  return result.invocationId
    ? invocations.find((invocation) => invocation.id === result.invocationId) ?? null
    : null;
}

function toolNameForApplicationResult(
  application: ApplicationSnapshot,
  result: ApplicationResultRecord,
): string | null {
  if (result.capability) return result.capability;
  const namespace = application.mcpAgent?.toolNamespace;
  if (namespace && result.mcpToolName) return `${namespace}.${result.mcpToolName}`;
  return null;
}

function applicationResultIsRender(result: ApplicationResultSummaryItem | ApplicationResultDetail | null): boolean {
  return result?.resultRef?.type === "application_render_result"
    || Object.prototype.hasOwnProperty.call(result ?? {}, "htmlByteLength")
    || Object.prototype.hasOwnProperty.call(result ?? {}, "html");
}

function applicationResultTheme(result: ApplicationResultSummaryItem | ApplicationResultDetail | null): string | null {
  const value = (result as { theme?: unknown } | null)?.theme;
  return typeof value === "string" && value.trim() ? value : null;
}

function applicationResultBytes(result: ApplicationResultSummaryItem | ApplicationResultDetail | null): number | null {
  const value = applicationResultIsRender(result)
    ? (result as { htmlByteLength?: unknown } | null)?.htmlByteLength
    : (result as { byteLength?: unknown } | null)?.byteLength;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function applicationResultPrimaryHash(result: ApplicationResultSummaryItem | ApplicationResultDetail | null): string | null {
  const value = applicationResultIsRender(result)
    ? (result as { markdownHash?: unknown } | null)?.markdownHash
    : (result as { dataHash?: unknown } | null)?.dataHash;
  return typeof value === "string" && value.trim() ? value : null;
}

function applicationResultHtmlHash(result: ApplicationResultSummaryItem | ApplicationResultDetail | null): string | null {
  const value = (result as { htmlHash?: unknown } | null)?.htmlHash;
  return typeof value === "string" && value.trim() ? value : null;
}

function applicationResultSummary(result: ApplicationResultSummaryItem | ApplicationResultDetail | null): string | null {
  const summary = (result as { summary?: unknown } | null)?.summary;
  if (typeof summary === "string" && summary.trim()) return summary;
  const htmlSummary = (result as { htmlSummary?: unknown } | null)?.htmlSummary;
  return typeof htmlSummary === "string" && htmlSummary.trim() ? htmlSummary : null;
}

function applicationResultGovernance(result: ApplicationResultSummaryItem | ApplicationResultDetail | null) {
  const governance = (result as { governance?: unknown } | null)?.governance;
  const object = governance && typeof governance === "object" && !Array.isArray(governance)
    ? governance as Record<string, unknown>
    : {};
  return {
    pinned: object.pinned === true,
    archived: object.archived === true,
    retentionPolicy: typeof object.retentionPolicy === "string" && object.retentionPolicy.trim() ? object.retentionPolicy : "standard",
    note: typeof object.note === "string" && object.note.trim() ? object.note : null,
  };
}

function applicationResultHtml(result: ApplicationResultDetail | null): string | null {
  const value = (result as { html?: unknown } | null)?.html;
  return typeof value === "string" ? value : null;
}

function applicationResultShapeLabel(result: ApplicationResultSummaryItem | ApplicationResultDetail | null): string {
  const shape = (result as { dataShape?: unknown } | null)?.dataShape;
  if (!shape || typeof shape !== "object" || Array.isArray(shape)) return "—";
  const type = typeof (shape as { type?: unknown }).type === "string" ? (shape as { type: string }).type : "artifact";
  const count = typeof (shape as { itemCount?: unknown }).itemCount === "number" ? (shape as { itemCount: number }).itemCount : null;
  return count == null ? type : `${type} · ${count} item(s)`;
}

function applicationResultPayloadPreview(result: ApplicationResultDetail | null): string {
  const payload = (result as { payload?: unknown } | null)?.payload;
  if (payload !== undefined && payload !== null) return JSON.stringify(payload, null, 2);
  const text = (result as { text?: unknown } | null)?.text;
  if (typeof text === "string" && text.trim()) return text;
  const preview = (result as { preview?: unknown } | null)?.preview;
  if (preview !== undefined && preview !== null) return typeof preview === "string" ? preview : JSON.stringify(preview, null, 2);
  return "{}";
}

function applicationResultComparisonRows(left: ApplicationResultSummaryItem, right: ApplicationResultSummaryItem) {
  const row = (label: string, leftValue: unknown, rightValue: unknown) => {
    const leftText = applicationResultCompareValue(leftValue);
    const rightText = applicationResultCompareValue(rightValue);
    return { label, left: leftText, right: rightText, same: leftText === rightText };
  };
  return [
    row("Type", applicationResultIsRender(left) ? "render" : "artifact", applicationResultIsRender(right) ? "render" : "artifact"),
    row("Tool", left.mcpToolName ?? left.capability, right.mcpToolName ?? right.capability),
    row("Artifact", left.artifactType, right.artifactType),
    row("Evidence", left.evidenceType, right.evidenceType),
    row("Invocation", left.invocationId, right.invocationId),
    row("Hash", applicationResultPrimaryHash(left), applicationResultPrimaryHash(right)),
    row("Bytes", applicationResultBytes(left), applicationResultBytes(right)),
    row("Shape", applicationResultShapeLabel(left), applicationResultShapeLabel(right)),
    row("Governance", applicationResultGovernanceLabel(left), applicationResultGovernanceLabel(right)),
  ];
}

function applicationResultCompareValue(value: unknown): string {
  if (value == null || value === "") return "—";
  return String(value);
}

function applicationResultGovernanceLabel(result: ApplicationResultSummaryItem | ApplicationResultDetail | null): string {
  const governance = applicationResultGovernance(result);
  return [
    governance.pinned ? "pinned" : null,
    governance.archived ? "archived" : null,
    governance.retentionPolicy,
  ].filter(Boolean).join(" · ");
}

function applicationResultRetentionLabel(application: ApplicationSnapshot): string {
  const retention = application.resultRetention;
  if (!retention) return "manual only";
  const parts = [
    retention.enabled ? "auto enabled" : "manual only",
    `keep latest ${retention.keepLatest ?? 20}`,
    retention.archiveAfterDays == null ? "no age archive" : `archive after ${retention.archiveAfterDays} day(s)`,
    retention.lastRunAt ? `last run ${shortTime(retention.lastRunAt)}` : null,
    retention.lastArchivedCount ? `archived ${retention.lastArchivedCount}` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

function applicationResultMetadata(result: ApplicationResultSummaryItem | ApplicationResultDetail | null): Record<string, unknown> {
  const metadata = (result as { metadata?: unknown } | null)?.metadata;
  return metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {};
}

function applicationResultSource(result: ApplicationResultSummaryItem | ApplicationResultDetail | null): string | null {
  const metadata = applicationResultMetadata(result);
  const source = typeof metadata.source === "string" && metadata.source.trim() ? metadata.source : null;
  return source ?? result?.lineage?.source ?? null;
}

function applicationResultPostTitle(result: ApplicationResultSummaryItem | ApplicationResultDetail | null): string | null {
  const metadata = applicationResultMetadata(result);
  const value = metadata.postTitle ?? metadata.title;
  return typeof value === "string" && value.trim() ? value : null;
}

function applicationEditorHandoffResult(application: ApplicationSnapshot): ApplicationResultSummaryItem | null {
  const result = application.latestResult?.renderResult ?? null;
  return applicationResultSource(result) === "application_web_editor" ? result : null;
}

function applicationEditorHandoffMeta(result: ApplicationResultSummaryItem | ApplicationResultDetail | null): {
  postTitle: string | null;
  editorUrl: string | null;
  theme: string | null;
  markdownLength: number | null;
  htmlByteLength: number | null;
} | null {
  if (applicationResultSource(result) !== "application_web_editor")
    return null;
  const metadata = applicationResultMetadata(result);
  return {
    postTitle: applicationResultPostTitle(result),
    editorUrl: stringMetadataValue(metadata.editorUrl) ?? stringMetadataValue(metadata.sourceUrl),
    theme: stringMetadataValue(metadata.theme) ?? applicationResultTheme(result),
    markdownLength: numberMetadataValue(metadata.markdownLength),
    htmlByteLength: numberMetadataValue(metadata.htmlByteLength) ?? applicationResultBytes(result),
  };
}

function stringMetadataValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberMetadataValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function applicationResultExportPayload(application: ApplicationSnapshot, result: ApplicationResultRecord) {
  return {
    version: "application_result_export.v1",
    application: {
      id: application.id,
      name: application.name,
      projectId: application.projectId ?? null,
      sourceType: application.source?.type ?? null,
    },
    result: {
      id: result.id,
      resultType: applicationResultIsRender(result) ? "render" : "artifact",
      resultRef: result.resultRef ?? null,
      capability: result.capability ?? null,
      mcpToolName: result.mcpToolName ?? null,
      artifactType: result.artifactType ?? null,
      evidenceType: result.evidenceType ?? null,
      outputCollection: result.outputCollection ?? null,
      summary: applicationResultSummary(result),
      hash: applicationResultPrimaryHash(result),
      bytes: applicationResultBytes(result),
      generatedAt: result.generatedAt ?? result.createdAt ?? null,
      lineage: result.lineage ?? null,
      governance: result.governance ?? null,
    },
  };
}

function applicationResultEvidenceSummary(application: ApplicationSnapshot, result: ApplicationResultRecord): string {
  const summary = applicationResultSummary(result);
  const parts = [
    `Application result ${result.id}`,
    application.name,
    result.mcpToolName ?? result.capability ?? null,
    result.artifactType ?? null,
    result.evidenceType ?? null,
    summary,
  ].filter(Boolean);
  return truncateText(parts.join(" · "), 360);
}

function applicationSourcePath(application: ApplicationSnapshot): string | null {
  const source = application.source;
  return source?.type === "local" && typeof source.path === "string" ? source.path : null;
}

function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function mcpToolRunEntries(application: ApplicationSnapshot, capabilities: ApplicationCapability[]): McpToolRunEntry[] {
  const mcpAgent = application.mcpAgent;
  if (!mcpAgent) return [];
  const namespace = mcpAgent.toolNamespace ?? mcpToolNamespaceFromApplication(application);
  return (mcpAgent.allowedTools ?? []).map((toolName, index) => {
    const sharedName = mcpAgent.sharedToolNames?.[index] ?? `${namespace}.${mcpToolSegment(toolName)}`;
    const capability = capabilities.find((item) => item.name === sharedName) ?? null;
    return {
      toolName,
      sharedName,
      capability,
      inputSchema: mcpInputSchemaForTool(mcpAgent, capability, toolName),
    };
  });
}

function mcpInputSchemaForTool(
  mcpAgent: NonNullable<ApplicationSnapshot["mcpAgent"]>,
  capability: ApplicationCapability | null,
  toolName: string,
): Record<string, unknown> {
  const metadataMcp = recordValue(capability?.metadata?.mcp);
  return recordValue(metadataMcp?.inputSchema)
    ?? recordValue(capability?.inputSchema)
    ?? recordValue(mcpAgent.toolSchemas?.[toolName])
    ?? { type: "object", additionalProperties: false, properties: {} };
}

function mcpSchemaFields(schema: Record<string, unknown>): McpSchemaFieldSpec[] {
  const properties = recordValue(schema.properties) ?? {};
  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
  return Object.entries(properties).map(([name, raw]) => {
    const fieldSchema = recordValue(raw) ?? {};
    const enumValues = Array.isArray(fieldSchema.enum)
      ? fieldSchema.enum.filter((item) => ["string", "number", "boolean"].includes(typeof item)).map(String)
      : [];
    const type = Array.isArray(fieldSchema.type)
      ? String(fieldSchema.type.find((item) => item !== "null") ?? "string")
      : String(fieldSchema.type ?? (enumValues.length ? "string" : "string"));
    return {
      name,
      required: required.has(name),
      schema: fieldSchema,
      type,
      enumValues,
    };
  });
}

function defaultMcpToolFormValues(fields: McpSchemaFieldSpec[]): Record<string, unknown> {
  return Object.fromEntries(fields.map((field) => [field.name, defaultMcpFieldValue(field)]));
}

function defaultMcpFieldValue(field: McpSchemaFieldSpec): unknown {
  if (field.schema.default !== undefined) return field.schema.default;
  if (field.enumValues.length) return field.enumValues[0];
  if (field.type === "boolean") return false;
  if (field.type === "number" || field.type === "integer") return "";
  if (field.type === "object") return "{}";
  if (field.type === "array") return "[]";
  if (field.name.toLowerCase().includes("markdown")) return DEFAULT_MCP_MARKDOWN;
  if (field.name.toLowerCase() === "theme") return "default";
  return "";
}

function requiredMcpFieldsPresent(fields: McpSchemaFieldSpec[], values: Record<string, unknown>): boolean {
  return fields.every((field) => {
    if (!field.required) return true;
    const value = values[field.name];
    if (field.type === "boolean") return typeof value === "boolean";
    return value !== undefined && value !== null && String(value).trim() !== "";
  });
}

function mcpToolArgumentsFromForm(fields: McpSchemaFieldSpec[], values: Record<string, unknown>): Record<string, unknown> {
  const entries = [];
  for (const field of fields) {
    const value = values[field.name];
    if (!field.required && (value === "" || value === undefined || value === null)) continue;
    entries.push([field.name, coerceMcpFieldValue(field, value)]);
  }
  return Object.fromEntries(entries);
}

function coerceMcpFieldValue(field: McpSchemaFieldSpec, value: unknown): unknown {
  if (field.type === "number" || field.type === "integer") {
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }
  if (field.type === "object" || field.type === "array") {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return field.type === "array" ? [] : {};
    }
  }
  return value;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function mcpToolNamespaceFromApplication(application: ApplicationSnapshot): string {
  return mcpToolSegment(application.name ?? application.id ?? "mcp");
}

function mcpToolSegment(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "tool";
}

function mcpRunNextAction(
  invocation: InvocationSnapshot | null,
  recovery?: NonNullable<ApplicationSnapshot["mcpAgent"]>["recovery"],
): string {
  if (!invocation) return recovery?.nextAction ?? "Ready to run the default markdown sample through Desktop Bridge.";
  if (invocation.status === "queued" || invocation.status === "dispatching") return "Waiting for Desktop Bridge to pick up this MCP invocation.";
  if (invocation.status === "running") return "Desktop Bridge is running the registered MCP adapter.";
  if (invocation.status === "succeeded") return "Result imported. View the render result or rerun the last input.";
  if (invocation.status === "timed_out") return recovery?.nextAction ?? "Retry with smaller markdown or increase the MCP adapter timeout.";
  if (invocation.status === "cancelled") return "The run was cancelled before a render result was imported.";
  return recovery?.nextAction ?? fallbackMcpFailureAction(invocation);
}

function fallbackMcpFailureAction(invocation: InvocationSnapshot): string {
  const result = invocation.result as (InvocationSnapshot["result"] & { policyDecision?: string }) | undefined;
  const text = `${result?.summary ?? ""} ${result?.policyDecision ?? ""}`.toLowerCase();
  if (text.includes("local_execution_refused") || text.includes("policy")) {
    return "Policy refused execution. Review the MCP descriptor and local execution policy before retrying.";
  }
  if (text.includes("enoent") || text.includes("spawn") || text.includes("could not start")) {
    return "MCP start failed. Re-probe MCP and verify dependencies are installed.";
  }
  if (text.includes("tool") && text.includes("not")) {
    return "Tool was not found. Re-probe MCP to refresh the registered tool list.";
  }
  return "Open the invocation timeline, fix the runtime error, then rerun the last input.";
}

export function latestRoutineInvocation(invocations: InvocationSnapshot[], applicationId: string, routineId: string) {
  return invocations.find((invocation) => {
    const metadata = invocation.options?.metadata;
    return metadata?.source === "application_orchestration"
      && metadata.applicationId === applicationId
      && metadata.routineId === routineId;
  }) ?? null;
}

function WrapperCapabilityRunForm({
  capability,
  onViewInvocation,
}: {
  capability: ApplicationCapability;
  onViewInvocation: (invocationId: string) => void;
}) {
  const argInputs = capability.metadata?.wrapper?.argInputs ?? [];
  const readiness = capability.metadata?.readiness;
  const applicationId = capability.provider?.id;
  const commandId = capability.metadata?.wrapper?.commandId;
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [approvalRequestId, setApprovalRequestId] = useState("");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const { execute, pending, error } = useAsyncAction();
  const policyConsentRequired = capability.metadata?.wrapper?.policySupported === false;
  const policyConsent = capability.metadata?.wrapper?.policyConsent;
  const disabled = pending || readiness?.state === "needs_setup" || (capability.status === "disabled" && !policyConsentRequired);

  function updateValue(input: NpmWrapperArgInputSnapshot, value: string | boolean) {
    setValues((current) => ({ ...current, [input.key]: value }));
  }

  function inputPayload() {
    const payload = wrapperArgInputPayload(argInputs, values);
    if (approvalRequestId.trim()) payload.approvalRequestId = approvalRequestId.trim();
    return payload;
  }

  async function runCapability() {
    const ok = await execute(async () => {
      if (policyConsentRequired && applicationId && commandId) {
        const consent = await runWithApplicationApproval((consentApprovalRequestId) =>
          api.grantApplicationWrapperPolicyConsent(applicationId, commandId, {
            ...(consentApprovalRequestId ? { approvalRequestId: consentApprovalRequestId } : {}),
            reason: `Allow wrapper command ${commandId} policy for ${capability.name}.`,
          }),
        );
        setResult(consent);
      }
      const payload = inputPayload();
      const response = approvalRequestId.trim()
        ? await api.createCapabilityInvocation(capability.name, payload)
        : await runWithApplicationApproval((runApprovalRequestId) =>
          api.createCapabilityInvocation(capability.name, {
            ...payload,
            ...(runApprovalRequestId ? { approvalRequestId: runApprovalRequestId } : {}),
          }),
        );
      setResult(response);
      const invocationId = typeof response.invocationId === "string" ? response.invocationId : null;
      if (invocationId) onViewInvocation(invocationId);
    });
    if (!ok) setResult(null);
  }

  async function revokePolicyConsent() {
    if (!applicationId || !commandId) return;
    const ok = await execute(async () => {
      const response = await api.revokeApplicationWrapperPolicyConsent(applicationId, commandId, {
        reason: `Revoke wrapper command ${commandId} policy for ${capability.name}.`,
      });
      setResult(response);
      return response;
    });
    if (!ok) setResult(null);
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border border-border bg-muted/20 p-3">
      {policyConsent?.state === "granted" ? (
        <div className="space-y-2 rounded-md border border-border bg-background p-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="success">Policy consent granted</Badge>
            {policyConsent.grantedAt ? <span className="text-muted-foreground">{shortTime(policyConsent.grantedAt)}</span> : null}
            {policyConsent.expiresAt ? <span className="text-muted-foreground">Expires {shortTime(policyConsent.expiresAt)}</span> : null}
          </div>
          {policyConsent.reason ? (
            <p className="[overflow-wrap:anywhere] text-muted-foreground">{policyConsent.reason}</p>
          ) : null}
          <Button size="sm" variant="secondary" disabled={pending} onClick={revokePolicyConsent}>
            <Trash2 />
            Revoke consent
          </Button>
        </div>
      ) : null}
      {argInputs.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {argInputs.map((input) => (
            <Field key={input.key} label={input.key}>
              <WrapperArgInputControl
                input={input}
                value={values[input.key]}
                disabled={pending}
                label={input.flag ?? input.key}
                onChange={(value) => updateValue(input, value)}
              />
            </Field>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No runtime inputs declared for this wrapper command.</p>
      )}
      {capability.requiresApproval ? (
        <Field label="Approval request">
          <Input
            value={approvalRequestId}
            onChange={(event) => setApprovalRequestId(event.target.value)}
            placeholder="approvalRequestId"
            disabled={pending}
          />
        </Field>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={runCapability} disabled={disabled}>
          <Play />
          Run
        </Button>
        {readiness?.state === "needs_setup" ? (
          <span className="text-xs text-warning">{readiness.reason ?? "Wrapper setup required."}</span>
        ) : null}
        {policyConsentRequired ? (
          <span className="text-xs text-warning">Policy consent required.</span>
        ) : null}
      </div>
      {capabilityResultMessage(result) ? (
        <p className="text-xs text-muted-foreground">{capabilityResultMessage(result)}</p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function WrapperArgInputControl({
  input,
  value,
  disabled,
  label,
  onChange,
}: {
  input: NpmWrapperArgInputSnapshot;
  value: string | boolean | undefined;
  disabled?: boolean;
  label?: string;
  onChange: (value: string | boolean) => void;
}) {
  if (input.type === "boolean-flag") {
    return (
      <label className="flex h-9 items-center gap-2 rounded-md border border-border bg-input/40 px-3 text-sm">
        <input
          type="checkbox"
          checked={value === true}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{label ?? input.flag ?? input.key}</span>
      </label>
    );
  }
  if (input.type === "enum") {
    return (
      <Select
        value={formStringValue(value)}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Select</option>
        {(input.values ?? []).map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </Select>
    );
  }
  return (
    <Input
      type={input.type === "date" ? "date" : "text"}
      value={formStringValue(value)}
      disabled={disabled}
      placeholder={input.flag ?? input.key}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function CapabilityAutomationPanel({
  application,
  capability,
  automations,
  runs,
  focusedAutomationId,
  onViewInvocation,
}: {
  application: ApplicationSnapshot;
  capability: ApplicationCapability;
  automations: AutomationSnapshot[];
  runs: ApplicationRunRecord[];
  focusedAutomationId?: string | null;
  onViewInvocation: (invocationId: string) => void;
}) {
  const { execute, pending, error } = useAsyncAction();
  const argInputs = capability.metadata?.wrapper?.argInputs ?? [];
  const [scheduleKind, setScheduleKind] = useState<"interval" | "daily" | "weekdays">("daily");
  const [time, setTime] = useState("09:00");
  const [everyMinutes, setEveryMinutes] = useState("60");
  const [inputValues, setInputValues] = useState<Record<string, string | boolean>>({});
  const [result, setResult] = useState<string | null>(null);
  const disabled = pending || application.status !== "active" || !application.projectId || capability.status === "disabled";

  function schedulePayload() {
    if (scheduleKind === "interval") {
      return { kind: "interval", everyMinutes: Math.max(1, Number(everyMinutes) || 60) };
    }
    return { kind: scheduleKind, time };
  }

  function updateInputValue(input: NpmWrapperArgInputSnapshot, value: string | boolean) {
    setInputValues((current) => ({ ...current, [input.key]: value }));
  }

  async function createSchedule() {
    const ok = await execute(async () => {
      const response = await api.createAutomation({
        kind: "application_capability",
        name: `${application.name} · ${capability.displayName ?? shortCapabilityName(capability.name)}`,
        projectId: application.projectId,
        enabled: true,
        schedule: schedulePayload(),
        target: {
          type: "application_capability",
          applicationId: application.id,
          capabilityName: capability.name,
          input: wrapperArgInputPayload(argInputs, inputValues),
        },
      }) as { automation?: AutomationSnapshot };
      setResult(response.automation?.nextRunAt ? `Scheduled ${shortTime(response.automation.nextRunAt)}.` : "Scheduled.");
    });
    if (!ok) setResult(null);
  }

  async function runNow(automation: AutomationSnapshot) {
    const ok = await execute(async () => {
      const response = await api.runAutomation(automation.id) as { invocationId?: string; invocation?: { id?: string }; status?: string };
      const invocationId = response.invocationId ?? response.invocation?.id ?? null;
      setResult(invocationId ? `Queued ${invocationId}.` : `Run requested${response.status ? `: ${response.status}` : ""}.`);
      if (invocationId) onViewInvocation(invocationId);
    });
    if (!ok) setResult(null);
  }

  async function toggleAutomation(automation: AutomationSnapshot) {
    const ok = await execute(async () => {
      await api.updateAutomation(automation.id, { enabled: !automation.enabled });
      setResult(automation.enabled ? "Schedule paused." : "Schedule resumed.");
    });
    if (!ok) setResult(null);
  }

  async function deleteAutomation(automation: AutomationSnapshot) {
    const ok = await execute(async () => {
      await api.deleteAutomation(automation.id);
      setResult("Schedule deleted.");
    });
    if (!ok) setResult(null);
  }

  return (
    <div className="mt-2 space-y-3 rounded-md border border-border bg-muted/20 p-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <Field label="Schedule">
          <Select value={scheduleKind} disabled={pending} onChange={(event) => setScheduleKind(event.target.value as typeof scheduleKind)}>
            <option value="daily">Daily</option>
            <option value="weekdays">Weekdays</option>
            <option value="interval">Interval</option>
          </Select>
        </Field>
        {scheduleKind === "interval" ? (
          <Field label="Minutes">
            <Input
              type="number"
              min="1"
              value={everyMinutes}
              disabled={pending}
              onChange={(event) => setEveryMinutes(event.target.value)}
            />
          </Field>
        ) : (
          <Field label="Time">
            <Input type="time" value={time} disabled={pending} onChange={(event) => setTime(event.target.value)} />
          </Field>
        )}
        <div className="flex items-end">
          <Button size="sm" disabled={disabled} onClick={createSchedule}>
            <CalendarClock />
            Schedule
          </Button>
        </div>
      </div>
      {argInputs.length ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Scheduled inputs</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {argInputs.map((input) => (
              <Field key={input.key} label={`Schedule ${input.key}`}>
                <WrapperArgInputControl
                  input={input}
                  value={inputValues[input.key]}
                  disabled={pending}
                  label={`Schedule ${input.flag ?? input.key}`}
                  onChange={(value) => updateInputValue(input, value)}
                />
              </Field>
            ))}
          </div>
        </div>
      ) : null}
      {application.status !== "active" ? <p className="text-xs text-muted-foreground">Bring the application online before scheduling this capability.</p> : null}
      {!application.projectId ? <p className="text-xs text-warning">Scheduling needs an application project.</p> : null}
      {automations.length ? (
        <div className="space-y-2">
          {automations.map((automation) => {
            const scheduledRuns = automationRuns(runs, automation);
            const diagnostics = automationDiagnostics(automation, scheduledRuns, capability);
            const focused = automation.id === focusedAutomationId;
            return (
              <div
                key={automation.id}
                data-application-automation-id={automation.id}
                className={cn(
                  "rounded-md border border-border bg-background p-2 text-xs",
                  focused && "border-primary/60 bg-primary/5 ring-2 ring-primary/30",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {focused ? <Badge tone="running">focused</Badge> : null}
                      <Badge tone={automation.enabled ? "success" : "neutral"}>{automation.enabled ? "enabled" : "paused"}</Badge>
                      <Badge tone={diagnostics.tone}>{diagnostics.title}</Badge>
                      <span className="[overflow-wrap:anywhere] font-medium">{automation.name}</span>
                    </div>
                    <p className="text-muted-foreground">
                      {automation.schedule?.label ?? "Schedule"} · Next {automation.nextRunAt ? shortTime(automation.nextRunAt) : "paused"} · Runs {automation.runCount ?? 0}
                    </p>
                    <p className="[overflow-wrap:anywhere] text-muted-foreground">{wrapperInputSummary(automation.target?.input)}</p>
                    <p className="[overflow-wrap:anywhere] text-muted-foreground">{diagnostics.detail}</p>
                    {automationNeedsAttention(automation) || diagnostics.consecutiveFailures ? (
                      <p className="[overflow-wrap:anywhere] text-warning">Next: {diagnostics.nextAction}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="icon" variant="secondary" title="Run now" aria-label="Run automation now" disabled={pending} onClick={() => void runNow(automation)}>
                      <Play />
                    </Button>
                    <Button size="icon" variant="secondary" title={automation.enabled ? "Pause" : "Resume"} aria-label={automation.enabled ? "Pause automation" : "Resume automation"} disabled={pending} onClick={() => void toggleAutomation(automation)}>
                      {automation.enabled ? <Pause /> : <Play />}
                    </Button>
                    {latestAutomationInvocationId(automation) ? (
                      <Button size="icon" variant="ghost" title="Open last invocation" aria-label="Open last invocation" onClick={() => onViewInvocation(latestAutomationInvocationId(automation)!)}>
                        <ExternalLink />
                      </Button>
                    ) : null}
                    <Button size="icon" variant="ghost" title="Delete schedule" aria-label="Delete schedule" disabled={pending} onClick={() => void deleteAutomation(automation)}>
                      <Trash2 />
                    </Button>
                  </div>
                  {automationNeedsAttention(automation) || diagnostics.consecutiveFailures ? (
                    <div className="flex w-full flex-wrap gap-2 border-t border-border pt-2">
                      <Button size="sm" variant="secondary" disabled={pending} onClick={() => void toggleAutomation(automation)}>
                        {automation.enabled ? <Pause /> : <Play />}
                        {automation.enabled ? "Pause schedule" : "Resume schedule"}
                      </Button>
                      <Button size="sm" disabled={pending} onClick={() => void runNow(automation)}>
                        <Play />
                        Run now
                      </Button>
                      {latestAutomationInvocationId(automation) ? (
                        <Button size="sm" variant="secondary" onClick={() => onViewInvocation(latestAutomationInvocationId(automation)!)}>
                          <ExternalLink />
                          {focusedAutomationActionLabel(automation)}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      {result ? <p className="text-xs text-muted-foreground">{result}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function ApplicationLatestActivity({
  runs,
  onViewInvocation,
}: {
  runs: ApplicationRunRecord[];
  onViewInvocation: (invocationId: string) => void;
}) {
  const latest = runs[0] ?? null;
  if (!latest) return null;
  const diagnostics = runDiagnostics(latest);
  return (
    <Card data-application-panel="orchestrations">
      <CardHeader>
        <CardTitle>Latest activity</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={statusTone(latest.invocation.status ?? "unknown")}>{readableStatus(latest.invocation.status ?? "unknown")}</Badge>
          <Badge tone="neutral">{latest.kind}</Badge>
          {latest.capability ? <Badge tone="neutral">{shortCapabilityName(latest.capability)}</Badge> : null}
          <span className="text-xs text-muted-foreground">{shortTime(latest.invocation.createdAt)}</span>
        </div>
        <RunDiagnosticsSummary diagnostics={diagnostics} />
        <Button size="sm" variant="secondary" onClick={() => onViewInvocation(latest.invocation.id)}>
          <ExternalLink />
          Open latest
        </Button>
      </CardContent>
    </Card>
  );
}

function CapabilityRunHistory({
  runs,
  capability,
  onViewInvocation,
}: {
  runs: ApplicationRunRecord[];
  capability: ApplicationCapability;
  onViewInvocation: (invocationId: string) => void;
}) {
  if (!runs.length) {
    return <p className="text-xs text-muted-foreground">No recent runs for this capability.</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">Recent runs</p>
      <ul className="space-y-2">
        {runs.map((run) => {
          const diagnostics = runDiagnostics(run, capability);
          return (
            <li key={run.invocation.id} className="rounded-md border border-border bg-background p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={statusTone(run.invocation.status ?? "unknown")}>{readableStatus(run.invocation.status ?? "unknown")}</Badge>
                  <span className="font-mono text-xs">{run.invocation.id}</span>
                  <span className="text-xs text-muted-foreground">{shortTime(run.invocation.createdAt)}</span>
                </div>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onViewInvocation(run.invocation.id)}>
                  <ExternalLink />
                  View
                </Button>
              </div>
              <RunDiagnosticsSummary diagnostics={diagnostics} compact />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RunDiagnosticsSummary({
  diagnostics,
  compact = false,
}: {
  diagnostics: { title: string; detail: string; tone: "neutral" | "success" | "warning" | "danger"; nextAction: string };
  compact?: boolean;
}) {
  return (
    <div className={compact ? "mt-2 space-y-1 text-xs" : "space-y-2 rounded-md border border-border bg-muted/20 p-3 text-xs"}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={diagnostics.tone}>{diagnostics.title}</Badge>
        <span className="[overflow-wrap:anywhere] text-muted-foreground">{diagnostics.detail}</span>
      </div>
      <p className="[overflow-wrap:anywhere] text-muted-foreground">
        Next: {diagnostics.nextAction}
      </p>
    </div>
  );
}

function shortCapabilityName(value: string) {
  const parts = value.split(".").filter(Boolean);
  if (value.includes(".wrapper.")) return `wrapper.${parts.at(-1)}`;
  return parts.slice(-2).join(".") || value;
}

function isCcusageApplication(application: ApplicationSnapshot): boolean {
  return application.id === "app_ccusage"
    || (application.source.type === "npm" && application.source.package === "ccusage");
}

function ccusageCapabilityNames(applicationId: string, capabilities: ApplicationCapability[]) {
  const wrapperPrefix = `app.${applicationId}.wrapper.`;
  return capabilities
    .filter((capability) => capability.name.startsWith(wrapperPrefix))
    .map((capability) => capability.name)
    .sort();
}

const CCUSAGE_WALKTHROUGH_PATH = "docs/engineering/CCUSAGE_APPLICATION_USE_CASE.md";

function ccusageRunStatusTone(status?: string | null): "neutral" | "success" | "warning" | "danger" | "running" {
  if (status === "succeeded") return "success";
  if (status === "failed" || status === "rejected" || status === "cancelled") return "danger";
  if (status === "queued" || status === "running" || status === "waiting_for_local_approval") return "running";
  return "neutral";
}

function ccusageRunTerminal(status?: string | null) {
  return ["succeeded", "failed", "rejected", "cancelled"].includes(status ?? "");
}

function ccusageRunSummary(invocation?: InvocationSnapshot | null) {
  if (!invocation) return null;
  return invocation.result?.summary
    ?? invocation.explanation?.summary
    ?? invocation.explanation?.reason
    ?? null;
}

function ccusageRunNextAction(invocation?: InvocationSnapshot | null, error?: string | null) {
  const haystack = [
    error,
    invocation?.result?.summary,
    invocation?.explanation?.summary,
    invocation?.explanation?.reason,
    invocation?.explanation?.nextAction,
  ].filter(Boolean).join(" ");
  if (/agent_not_available|Application Wrapper Runner|Desktop Bridge/i.test(haystack)) {
    return "Start the full local stack with pnpm dev, confirm Desktop Bridge is online, and retry.";
  }
  if (/project_not_found/i.test(haystack)) {
    return "Switch to an existing project, then retry the daily report.";
  }
  if (/MODULE_NOT_FOUND|application-wrapper\.mjs/i.test(haystack)) {
    return "Re-register the Application Wrapper Runner so it uses the absolute wrapper script path.";
  }
  if (/Wrapper setup needed|needs_setup|wrapper.*not.*ready/i.test(haystack)) {
    return "Confirm the ccusage CLI and wrapper readiness, then refresh or re-register the Application.";
  }
  if (invocation?.status === "failed" || invocation?.status === "rejected") {
    return "Open the invocation timeline for logs, then retry after fixing the setup issue.";
  }
  if (invocation?.status === "queued" || invocation?.status === "running") {
    return "Keep this panel open; the latest result updates after the Desktop Bridge completes the run.";
  }
  return null;
}

function CcusageChecklistStep({
  number,
  title,
  tone,
  children,
  actions,
}: {
  number: number;
  title: string;
  tone: "neutral" | "success" | "warning" | "danger" | "running";
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <li className="rounded-md border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={tone}>{number}</Badge>
        <span className="text-sm font-medium">{title}</span>
      </div>
      <div className="mt-2 space-y-2 text-xs text-muted-foreground">{children}</div>
      {actions ? <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div> : null}
    </li>
  );
}

function CcusageReferenceUseCase({
  application,
  capabilities,
  currentProjectId,
  onViewInvocation,
}: {
  application: ApplicationSnapshot;
  capabilities: ApplicationCapability[];
  currentProjectId?: string | null;
  onViewInvocation: (invocationId: string) => void;
}) {
  const { execute, pending, error } = useAsyncAction();
  const [createdInvocationId, setCreatedInvocationId] = useState<string | null>(null);
  const [copiedWalkthroughPath, setCopiedWalkthroughPath] = useState(false);
  const wrapperCapabilities = ccusageCapabilityNames(application.id, capabilities);
  const latestInvocationId = application.latestResult?.invocationId ?? null;
  const importedCount = application.latestResult?.importedRecordCount
    ?? application.latestResult?.importedRecordIds?.length
    ?? 0;
  const outputCollection = application.latestResult?.outputCollection ?? "importedUsageEstimates";
  const latestResultStatus = application.latestResult?.status ?? null;
  const invocations = useConsoleState().data?.invocations ?? [];
  const createdInvocation = createdInvocationId
    ? invocations.find((invocation) => invocation.id === createdInvocationId) ?? null
    : null;
  const latestInvocation = latestInvocationId
    ? invocations.find((invocation) => invocation.id === latestInvocationId) ?? null
    : null;
  const createdRunStatus = createdInvocation?.status ?? (createdInvocationId ? "queued" : null);
  const createdRunSummary = ccusageRunSummary(createdInvocation);
  const createdRunNextAction = ccusageRunNextAction(createdInvocation, error);
  const appDeepLink = `/?section=applications&application=${encodeURIComponent(application.id)}`;

  async function runDailyReport() {
    setCreatedInvocationId(null);
    const ok = await execute(async () => {
      const response = await api.createToolInvocation("ccusage.report", {
        report: "daily",
        source: "all",
        offline: true,
        ...(application.projectId || currentProjectId ? { projectId: application.projectId ?? currentProjectId } : {}),
      });
      setCreatedInvocationId(response.invocationId);
      return response;
    });
    if (!ok) setCreatedInvocationId(null);
  }

  function copyWalkthroughPath() {
    void navigator.clipboard?.writeText(CCUSAGE_WALKTHROUGH_PATH);
    setCopiedWalkthroughPath(true);
  }

  return (
    <Card data-application-panel="ccusage-use-case">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <CardTitle>ccusage operation case</CardTitle>
            <p className="text-xs text-muted-foreground">
              A 3-step reader path: discover capabilities, run the stable facade, and inspect imported usage evidence.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={appDeepLink}
              className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium text-card-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <ExternalLink />
              Open deep link
            </a>
            <Button size="sm" variant="secondary" onClick={copyWalkthroughPath}>
              <Clipboard />
              Copy walkthrough path
            </Button>
            {copiedWalkthroughPath ? <span className="self-center text-xs text-success">Copied walkthrough path.</span> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="success">reference application</Badge>
          <Badge tone="neutral">ccusage.report facade</Badge>
          <Badge tone="neutral">importedUsageEstimates</Badge>
          {importedCount > 0 ? <Badge tone="success">{importedCount} latest import</Badge> : null}
        </div>
        <p className="text-xs text-muted-foreground">
          This panel mirrors the reader document, but keeps the core flow operable from the Application detail screen.
        </p>
        <ol className="space-y-2">
          <CcusageChecklistStep
            number={1}
            title="Discover governed report capabilities"
            tone={wrapperCapabilities.length ? "success" : "warning"}
          >
            <p>
              {wrapperCapabilities.length
                ? `${wrapperCapabilities.length} wrapper report capabilities are projected.`
                : "Run probe or refresh capabilities to see wrapper report capabilities."}
            </p>
            {wrapperCapabilities.length ? (
              <div className="flex flex-wrap gap-1.5">
                {wrapperCapabilities.slice(0, 6).map((name) => (
                  <Badge key={name} tone="neutral">{shortCapabilityName(name)}</Badge>
                ))}
              </div>
            ) : null}
          </CcusageChecklistStep>
          <CcusageChecklistStep
            number={2}
            title="Run the stable ccusage.report facade"
            tone={createdInvocationId ? ccusageRunStatusTone(createdRunStatus) : pending ? "running" : "neutral"}
            actions={
              <>
                <Button size="sm" disabled={pending || application.status === "archived"} onClick={() => void runDailyReport()}>
                  <Play />
                  {pending ? "Starting..." : "Run daily report"}
                </Button>
                {createdInvocationId ? (
                  <Button size="sm" variant="secondary" onClick={() => onViewInvocation(createdInvocationId)}>
                    <ExternalLink />
                    View created invocation
                  </Button>
                ) : null}
              </>
            }
          >
            <p>
              The public API remains `ccusage.report`; the backing execution routes through the Application wrapper runner.
            </p>
            <p className="font-mono text-[11px] text-muted-foreground">
              report=daily · source=all · offline=true
              {application.projectId || currentProjectId ? ` · projectId=${application.projectId ?? currentProjectId}` : ""}
            </p>
            {createdInvocationId ? (
              <div className="space-y-2 rounded-md border border-border bg-background p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={ccusageRunStatusTone(createdRunStatus)}>{readableStatus(createdRunStatus ?? "queued")}</Badge>
                  <span className="font-mono text-[11px] text-foreground">{createdInvocationId}</span>
                  {ccusageRunTerminal(createdRunStatus) && importedCount > 0 ? (
                    <Badge tone="success">{importedCount} imported row(s)</Badge>
                  ) : null}
                </div>
                <p className={createdRunStatus === "failed" || createdRunStatus === "rejected" ? "text-destructive" : "text-muted-foreground"}>
                  {createdRunSummary
                    ?? (ccusageRunTerminal(createdRunStatus)
                      ? `Daily report finished with status ${readableStatus(createdRunStatus ?? "unknown")}.`
                      : `Daily report queued. Results import into ${outputCollection}.`)}
                </p>
                {createdRunNextAction ? <p className="text-muted-foreground">Next: {createdRunNextAction}</p> : null}
              </div>
            ) : null}
          </CcusageChecklistStep>
          <CcusageChecklistStep
            number={3}
            title="Inspect imported usage evidence"
            tone={importedCount > 0 ? "success" : latestInvocationId ? ccusageRunStatusTone(latestResultStatus) : "neutral"}
            actions={
              latestInvocationId ? (
                <Button size="sm" variant="secondary" onClick={() => onViewInvocation(latestInvocationId)}>
                  <ExternalLink />
                  View latest invocation
                </Button>
              ) : null
            }
          >
            <p>
              Completed rows land in `{outputCollection}` and link back to the invocation, latest result, audit, and Evidence Center.
            </p>
            {latestInvocationId || latestResultStatus || importedCount > 0 ? (
              <div className="space-y-2 rounded-md border border-border bg-background p-2">
                <div className="flex flex-wrap gap-1.5">
                  {latestResultStatus ? <Badge tone={ccusageRunStatusTone(latestResultStatus)}>{readableStatus(latestResultStatus)}</Badge> : null}
                  {latestInvocationId ? <Badge tone="neutral">{latestInvocationId}</Badge> : null}
                  {importedCount > 0 ? <Badge tone="success">{importedCount} imported row(s)</Badge> : null}
                </div>
                {latestInvocation ? (
                  <p className={latestInvocation.status === "failed" || latestInvocation.status === "rejected" ? "text-destructive" : "text-muted-foreground"}>
                    {ccusageRunSummary(latestInvocation) ?? `Latest invocation is ${readableStatus(latestInvocation.status ?? "unknown")}.`}
                  </p>
                ) : null}
                {ccusageRunNextAction(latestInvocation) ? (
                  <p className="text-muted-foreground">Next: {ccusageRunNextAction(latestInvocation)}</p>
                ) : null}
              </div>
            ) : (
              <p>Run the daily report once, then inspect the created invocation and imported rows.</p>
            )}
          </CcusageChecklistStep>
        </ol>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

function OrchestrationDrafts({
  application,
  invocations,
  orchestrations,
}: {
  application: ApplicationSnapshot;
  invocations: InvocationSnapshot[];
  orchestrations: ApplicationOrchestration[];
}) {
  const { execute, pending, error } = useAsyncAction();
  const setSelectedInvocationId = useUiStore((s) => s.setSelectedInvocationId);
  const setSection = useUiStore((s) => s.setSection);
  const [createdInvocationByRoutineKey, setCreatedInvocationByRoutineKey] = useState<Record<string, string>>({});
  const [copiedRoutineId, setCopiedRoutineId] = useState<string | null>(null);
  const [pendingRoutineId, setPendingRoutineId] = useState<string | null>(null);

  function viewInvocation(invocationId: string) {
    setSelectedInvocationId(invocationId);
    setSection("invocations");
  }

  function copyRoutine(orchestration: ApplicationOrchestration) {
    const text = orchestration.relativePath
      ? `${orchestration.routineId} (${orchestration.relativePath})`
      : orchestration.routineId;
    void navigator.clipboard?.writeText(text);
    setCopiedRoutineId(orchestration.routineId);
  }

  async function runOrchestration(orchestration: ApplicationOrchestration) {
    setPendingRoutineId(orchestration.routineId);
    const routineKey = `${application.id}:${orchestration.routineId}`;
    const ok = await execute(async () => {
      const created = await api.runApplicationOrchestration(application.id, orchestration.routineId) as {
        invocationId?: string;
        invocation?: { id?: string };
      };
      const invocationId = created.invocationId ?? created.invocation?.id ?? null;
      if (invocationId) {
        setCreatedInvocationByRoutineKey((current) => ({
          ...current,
          [routineKey]: invocationId,
        }));
      }
      return created;
    });
    if (!ok) {
      setCreatedInvocationByRoutineKey((current) => {
        const next = { ...current };
        delete next[routineKey];
        return next;
      });
    }
    setPendingRoutineId(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Orchestration drafts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {orchestrations.map((orchestration) => {
          const lastInvocation = latestRoutineInvocation(invocations, application.id, orchestration.routineId);
          const invocationId = createdInvocationByRoutineKey[`${application.id}:${orchestration.routineId}`]
            ?? lastInvocation?.id
            ?? null;
          const isPendingRoutine = pending && pendingRoutineId === orchestration.routineId;
          return (
            <div key={orchestration.routineId} className="space-y-2 rounded-md border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <p className="[overflow-wrap:anywhere] font-mono text-xs">{orchestration.routineId}</p>
                  <p className="[overflow-wrap:anywhere] text-xs text-muted-foreground">
                    {orchestration.relativePath ?? orchestration.path ?? "Draft path not recorded"}
                  </p>
                </div>
                <Badge tone={orchestration.validation?.ok === false ? "danger" : "success"}>
                  {orchestration.validation?.ok === false ? "invalid" : orchestration.status ?? "draft"}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="icon"
                  variant="secondary"
                  title="Copy orchestration reference"
                  aria-label="Copy orchestration reference"
                  onClick={() => copyRoutine(orchestration)}
                >
                  <Clipboard />
                </Button>
                <Button
                  size="sm"
                  disabled={pending || orchestration.validation?.ok === false || application.status !== "active"}
                  onClick={() => void runOrchestration(orchestration)}
                >
                  <Play />
                  {isPendingRoutine ? "Starting..." : "Run"}
                </Button>
                {invocationId ? (
                  <Button size="sm" variant="secondary" onClick={() => viewInvocation(invocationId)}>
                    <ExternalLink />
                    View invocation
                  </Button>
                ) : null}
                {copiedRoutineId === orchestration.routineId ? (
                  <span className="text-xs text-success">Copied.</span>
                ) : null}
              </div>
              <OrchestrationRunHistory application={application} orchestration={orchestration} onView={viewInvocation} />
            </div>
          );
        })}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        {application.status !== "active" ? (
          <p className="text-xs text-muted-foreground">Bring the application online before running a draft.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function OrchestrationRunHistory({
  application,
  orchestration,
  onView,
}: {
  application: ApplicationSnapshot;
  orchestration: ApplicationOrchestration;
  onView: (invocationId: string) => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["application-orchestration-runs", application.id, orchestration.routineId],
    queryFn: () => api.listApplicationOrchestrationRuns(application.id, orchestration.routineId, 3),
    enabled: Boolean(application.id && orchestration.routineId),
    refetchInterval: 2000,
  });
  const selectedApplicationRun = useUiStore((s) => s.selectedApplicationRun);
  const [expandedInvocationId, setExpandedInvocationId] = useState<string | null>(null);
  const runs = data?.runs ?? [];

  useEffect(() => {
    if (
      selectedApplicationRun?.applicationId === application.id
      && selectedApplicationRun.routineId === orchestration.routineId
    ) {
      setExpandedInvocationId(selectedApplicationRun.invocationId);
    }
  }, [application.id, orchestration.routineId, selectedApplicationRun]);

  if (error) {
    return <p className="text-xs text-destructive">Could not load run history.</p>;
  }
  if (!runs.length) {
    return (
      <p className="text-xs text-muted-foreground">
        {isLoading ? "Loading runs..." : "No runs recorded yet."}
      </p>
    );
  }

  return (
    <div className="space-y-1.5 border-t border-border pt-2">
      {runs.map((run) => (
        <OrchestrationRunRow
          key={run.invocationId}
          application={application}
          orchestration={orchestration}
          run={run}
          expanded={expandedInvocationId === run.invocationId}
          onToggleInspect={() => setExpandedInvocationId((current) => current === run.invocationId ? null : run.invocationId)}
          onView={onView}
        />
      ))}
    </div>
  );
}

function OrchestrationRunRow({
  application,
  orchestration,
  run,
  expanded,
  onToggleInspect,
  onView,
}: {
  application: ApplicationSnapshot;
  orchestration: ApplicationOrchestration;
  run: ApplicationOrchestrationRun;
  expanded: boolean;
  onToggleInspect: () => void;
  onView: (invocationId: string) => void;
}) {
  return (
    <div className="space-y-2 rounded-md border border-border p-2 text-xs">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone(run.status)}>{readableStatus(run.status)}</Badge>
            <span className="font-mono text-muted-foreground">{run.invocationId}</span>
            <span className="text-muted-foreground">{shortTime(run.createdAt)}</span>
            {run.agentId ? <span className="text-muted-foreground">{run.agentId}</span> : null}
            {run.metadata?.retryOfInvocationId ? (
              <span className="text-muted-foreground">
                Retry of <span className="font-mono">{run.metadata.retryOfInvocationId}</span>
              </span>
            ) : null}
          </div>
          {run.resultSummary || run.errorSummary ? (
            <p className="[overflow-wrap:anywhere] text-muted-foreground">
              {run.resultSummary ?? run.errorSummary}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={onToggleInspect}>
            <Search />
            {expanded ? "Hide" : "Inspect"}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onView(run.invocationId)}>
            <ExternalLink />
            View
          </Button>
        </div>
      </div>
      {expanded ? (
        <OrchestrationRunDiagnostics
          applicationId={application.id}
          routineId={orchestration.routineId}
          invocationId={run.invocationId}
          canRetry={application.status === "active"}
        />
      ) : null}
    </div>
  );
}

function OrchestrationRunDiagnostics({
  applicationId,
  routineId,
  invocationId,
  canRetry,
}: {
  applicationId: string;
  routineId: string;
  invocationId: string;
  canRetry: boolean;
}) {
  const { execute, pending, error: retryError } = useAsyncAction();
  const [copiedRunLink, setCopiedRunLink] = useState(false);
  const [copiedRecoveryLink, setCopiedRecoveryLink] = useState(false);
  const { data: state } = useConsoleState();
  const setSelectedInvocationId = useUiStore((s) => s.setSelectedInvocationId);
  const setSection = useUiStore((s) => s.setSection);
  const selectedApplicationRecoveryId = useUiStore((s) => s.selectedApplicationRecoveryId);
  const { data, isLoading, error } = useQuery({
    queryKey: ["application-orchestration-run", applicationId, routineId, invocationId],
    queryFn: () => api.getApplicationOrchestrationRun(applicationId, routineId, invocationId),
    enabled: Boolean(applicationId && routineId && invocationId),
    refetchInterval: 2000,
  });
  const { data: eventData, isLoading: eventsLoading, error: eventsError } = useQuery({
    queryKey: ["application-orchestration-run-events", applicationId, routineId, invocationId],
    queryFn: () => api.listApplicationOrchestrationRunEvents(applicationId, routineId, invocationId),
    enabled: Boolean(applicationId && routineId && invocationId),
    refetchInterval: 2000,
  });
  const { data: recoveryData, isLoading: recoveryLoading, error: recoveryError } = useQuery({
    queryKey: ["application-orchestration-run-recovery", applicationId, routineId, invocationId],
    queryFn: () => api.getApplicationOrchestrationRunRecovery(applicationId, routineId, invocationId),
    enabled: Boolean(applicationId && routineId && invocationId),
    refetchInterval: 2000,
  });
  const run = data?.run;
  const events = eventData?.events ?? [];
  const recovery = recoveryData?.recovery;
  const hasSelectAgentAction = recovery?.actions.some((action) => action.type === "select_agent") ?? false;
  const { data: recoveryAgentData, isLoading: recoveryAgentsLoading, error: recoveryAgentsError } = useQuery({
    queryKey: ["application-orchestration-recovery-agent-candidates", applicationId, routineId, invocationId],
    queryFn: () => api.listApplicationOrchestrationRecoveryAgentCandidates(applicationId, routineId, invocationId),
    enabled: Boolean(applicationId && routineId && invocationId && hasSelectAgentAction),
    refetchInterval: 2000,
  });
  const recoveryActionRequests = (state?.applicationRecoveryActions ?? [])
    .filter((request) => request.applicationId === applicationId
      && request.routineId === routineId
      && request.invocationId === invocationId);

  function retryRun() {
    void execute(() => api.requestApplicationOrchestrationRecoveryAction(applicationId, routineId, invocationId, {
      actionType: "rerun",
      reason: run?.errorSummary ?? "Manual retry from application orchestration diagnostics.",
    }));
  }

  function requestRecoveryAction(actionType: string, reason?: string | null, agentId?: string | null) {
    void execute(() => api.requestApplicationOrchestrationRecoveryAction(applicationId, routineId, invocationId, {
      actionType,
      reason,
      agentId,
    }));
  }

  function viewInvocation(targetInvocationId: string) {
    setSelectedInvocationId(targetInvocationId);
    setSection("invocations");
  }

  function copyRunLink() {
    void navigator.clipboard?.writeText(applicationRunDeepLink({ applicationId, routineId, invocationId }));
    setCopiedRunLink(true);
  }

  function copySelectedRecoveryLink() {
    if (!selectedApplicationRecoveryId) return;
    void navigator.clipboard?.writeText(applicationRecoveryDeepLink({ applicationId, routineId, invocationId }, selectedApplicationRecoveryId));
    setCopiedRecoveryLink(true);
  }

  if (error) {
    return <p className="rounded-md bg-destructive/10 p-2 text-destructive">Could not load run diagnostics.</p>;
  }
  if (isLoading || !run) {
    return <p className="rounded-md bg-muted p-2 text-muted-foreground">Loading diagnostics...</p>;
  }

  const retryOfInvocationId = stringValue(run.metadata?.retryOfInvocationId);
  return (
    <div className="space-y-2 rounded-md bg-muted p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium">Run diagnostics</p>
          {retryOfInvocationId ? (
            <p className="[overflow-wrap:anywhere] text-xs text-muted-foreground">
              Retry of <span className="font-mono">{retryOfInvocationId}</span>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="icon"
            variant="secondary"
            title="Copy run link"
            aria-label="Copy run link"
            onClick={copyRunLink}
          >
            <Clipboard />
          </Button>
          {selectedApplicationRecoveryId && recoveryActionRequests.some((request) => request.id === selectedApplicationRecoveryId) ? (
            <Button
              size="icon"
              variant="secondary"
              title="Copy recovery link"
              aria-label="Copy recovery link"
              onClick={copySelectedRecoveryLink}
            >
              <Pin />
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" disabled={!canRetry || pending} onClick={retryRun}>
            <Play />
            {pending ? "Retrying..." : "Re-run"}
          </Button>
          {copiedRunLink ? <span className="text-xs text-success">Copied.</span> : null}
          {copiedRecoveryLink ? <span className="text-xs text-success">Recovery link copied.</span> : null}
        </div>
      </div>
      {retryError ? <p className="text-xs text-destructive">{retryError}</p> : null}
      <FactList
        facts={[
          { term: "Status", value: readableStatus(run.status) },
          { term: "Agent", value: run.agentId ?? "Unassigned" },
          { term: "Delivery", value: run.delivery?.state ?? run.deliveryState ?? "Not recorded" },
          { term: "Dispatch attempts", value: formatValue(run.delivery?.dispatchAttempts) },
          { term: "Cancellation", value: run.cancellation?.state ?? run.cancellationState ?? "None" },
          { term: "Trace", value: run.traceId ?? "Not recorded" },
          { term: "Policy", value: run.audit?.permissionDecision ?? run.policyDecisionId ?? "Not recorded" },
          { term: "Cost", value: run.audit?.costSummary ?? "Not recorded" },
        ]}
      />
      {run.result?.summary || run.errorSummary ? (
        <div className="space-y-1">
          {run.result?.summary ? <p className="[overflow-wrap:anywhere] text-muted-foreground">{run.result.summary}</p> : null}
          {run.errorSummary ? <p className="[overflow-wrap:anywhere] text-destructive">{run.errorSummary}</p> : null}
        </div>
      ) : null}
      <div className="rounded-md border border-border bg-background p-2">
        <p className="mb-2 text-xs font-medium">Timeline</p>
        {eventsError ? (
          <p className="text-xs text-destructive">Could not load run timeline.</p>
        ) : eventsLoading ? (
          <p className="text-xs text-muted-foreground">Loading timeline...</p>
        ) : (
          <Transcript events={events} />
        )}
      </div>
      <div className="rounded-md border border-border bg-background p-2">
        <p className="mb-2 text-xs font-medium">Recovery</p>
        {recoveryError ? (
          <p className="text-xs text-destructive">Could not load recovery suggestions.</p>
        ) : recoveryLoading || !recovery ? (
          <p className="text-xs text-muted-foreground">Loading recovery...</p>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={recoveryTone(recovery.category)}>{readableRecoveryCategory(recovery.category)}</Badge>
              <span className="text-muted-foreground">{Math.round(recovery.confidence * 100)}% confidence</span>
              {recovery.retryRecommended ? <Badge tone="running">Retry recommended</Badge> : null}
              {recovery.humanApprovalRequired ? <Badge tone="warning">Approval required</Badge> : null}
            </div>
            <p className="[overflow-wrap:anywhere] text-xs text-muted-foreground">{recovery.summary}</p>
            <RecoveryTimeline
              requests={recoveryActionRequests}
              selectedRecoveryId={selectedApplicationRecoveryId}
              onViewInvocation={viewInvocation}
            />
            {recovery.actions.length ? (
              <ul className="space-y-1">
                {recovery.actions.map((action) => {
                  const latestRequest = latestRecoveryActionRequest(recoveryActionRequests, action.type);
                  return (
                    <RecoveryActionItem
                      key={`${action.type}:${action.label}`}
                      action={action}
                      canRetry={canRetry}
                      pending={pending}
                      latestRequest={latestRequest}
                      agentCandidates={recoveryAgentData?.candidates ?? []}
                      agentsLoading={recoveryAgentsLoading}
                      agentsError={Boolean(recoveryAgentsError)}
                      onRequest={requestRecoveryAction}
                    />
                  );
                })}
              </ul>
            ) : null}
          </div>
        )}
      </div>
      <DiagnosticsBlock title="Metadata" value={run.metadata} />
      <DiagnosticsBlock title="Result" value={run.result} />
      <DiagnosticsBlock title="Delivery" value={run.delivery} />
    </div>
  );
}

function RecoveryTimeline({
  requests,
  selectedRecoveryId,
  onViewInvocation,
}: {
  requests: ApplicationRecoveryActionRequest[];
  selectedRecoveryId: string | null;
  onViewInvocation: (invocationId: string) => void;
}) {
  const sortedRequests = sortedRecoveryActionRequests(requests);
  if (sortedRequests.length === 0) return null;
  return (
    <div className="space-y-2 rounded border border-border bg-muted p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium">Recovery history</p>
        <span className="text-xs text-muted-foreground">{sortedRequests.length} action{sortedRequests.length === 1 ? "" : "s"}</span>
      </div>
      <div className="space-y-2">
        {sortedRequests.map((request, index) => (
          <RecoveryLineage
            key={request.id}
            request={request}
            open={selectedRecoveryId ? request.id === selectedRecoveryId : index === 0}
            selected={request.id === selectedRecoveryId}
            label={index === 0 ? "Latest recovery" : "Recovery action"}
            onViewInvocation={onViewInvocation}
          />
        ))}
      </div>
    </div>
  );
}

function RecoveryLineage({
  request,
  open,
  selected,
  label,
  onViewInvocation,
}: {
  request: ApplicationRecoveryActionRequest;
  open: boolean;
  selected: boolean;
  label: string;
  onViewInvocation: (invocationId: string) => void;
}) {
  const outcome = request.outcome;
  const explanation = request.explanation ?? null;
  const resultInvocationId = request.resultInvocation?.id ?? request.resultInvocationId ?? null;
  const ref = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    if (selected) {
      ref.current?.scrollIntoView({ block: "nearest" });
    }
  }, [selected]);

  return (
    <details
      ref={ref}
      data-application-recovery-id={request.id}
      className={cn(
        "rounded border border-border bg-background p-2",
        selected && "border-primary/60 ring-1 ring-primary/30",
      )}
      open={open}
    >
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium">{label}</span>
            <Badge tone="neutral">{readableRecoveryActionType(request.actionType)}</Badge>
            <Badge tone={recoveryActionRequestTone(request.status)}>{readableRecoveryActionRequestStatus(request.status)}</Badge>
            {outcome ? <Badge tone={recoveryOutcomeTone(outcome.state)}>{readableRecoveryOutcome(outcome.state)}</Badge> : null}
            {outcome?.reason ? <Badge tone={recoveryOutcomeSeverityTone(outcome.severity)}>{readableRecoveryOutcomeReason(outcome.reason)}</Badge> : null}
            {explanation?.state ? <Badge tone={recoveryExplanationTone(explanation.state)}>{readableRecoveryExplanationState(explanation.state)}</Badge> : null}
          </div>
          <span className="text-xs text-muted-foreground">{shortTime(request.updatedAt ?? request.createdAt)}</span>
        </div>
      </summary>
      <div className="mt-2 space-y-2">
        <RecoveryExplanationPanel
          explanation={explanation}
          outcome={outcome}
          fallbackResultInvocationId={resultInvocationId}
          onViewInvocation={onViewInvocation}
        />
        <FactList
          facts={[
            { term: "Source", value: request.sourceInvocation?.id ?? request.invocationId },
            { term: "Result", value: resultInvocationId ?? "Not linked" },
            { term: "Result status", value: request.resultInvocation?.status ?? "Not recorded" },
            { term: "Requested agent", value: request.requestedAgentId ?? "Automatic" },
            { term: "Selected agent", value: request.selectedAgentId ?? "Not changed" },
            { term: "Outcome reason", value: outcome?.reason ? readableRecoveryOutcomeReason(outcome.reason) : "Not recorded" },
            { term: "Next step", value: outcome?.nextStep ?? "Not recorded" },
            { term: "Updated", value: shortTime(request.updatedAt) },
          ]}
        />
        <RecoveryCandidateSnapshot request={request} />
        <RecoveryActionTimeline entries={request.timeline ?? []} />
      </div>
    </details>
  );
}

function RecoveryExplanationPanel({
  explanation,
  outcome,
  fallbackResultInvocationId,
  onViewInvocation,
}: {
  explanation: ApplicationRecoveryExplanation | null;
  outcome: ApplicationRecoveryActionRequest["outcome"];
  fallbackResultInvocationId: string | null;
  onViewInvocation: (invocationId: string) => void;
}) {
  if (!explanation && !outcome) return null;
  const state = explanation?.state ?? outcome?.state ?? null;
  const reason = explanation?.reason ?? outcome?.reason ?? null;
  const summary = explanation?.summary ?? outcome?.summary ?? null;
  const nextStep = explanation?.nextStep ?? outcome?.nextStep ?? null;
  const resultInvocationId = explanation?.resultInvocationId ?? fallbackResultInvocationId;
  const resultOrchestration = recoveryResultOrchestrationLabel(explanation);
  const requestedAgent = recoveryAgentChoiceLabel(explanation);

  return (
    <div className="space-y-2 rounded border border-border bg-muted p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium">Recovery guidance</span>
          {explanation?.selectedAction ? <Badge tone="neutral">{readableRecoveryActionType(explanation.selectedAction)}</Badge> : null}
          {state ? <Badge tone={recoveryExplanationTone(state)}>{readableRecoveryExplanationState(state)}</Badge> : null}
          {reason ? <Badge tone={recoveryExplanationReasonTone(reason)}>{readableRecoveryExplanationReason(reason)}</Badge> : null}
        </div>
        {resultInvocationId ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onViewInvocation(resultInvocationId)}
          >
            <ExternalLink />
            View result
          </Button>
        ) : null}
      </div>
      {summary ? <p className="[overflow-wrap:anywhere] text-xs text-muted-foreground">{summary}</p> : null}
      {nextStep ? (
        <p className="[overflow-wrap:anywhere] rounded bg-background px-2 py-1 text-xs">
          <span className="font-medium">Next step: </span>
          <span className="text-muted-foreground">{nextStep}</span>
        </p>
      ) : null}
      <FactList
        facts={[
          { term: "Approval request", value: explanation?.approvalRequestId ?? "Not required" },
          { term: "Duplicate guard", value: explanation?.blockedReason ? readableRecoveryActionAvailabilityReason(explanation.blockedReason) : "Clear" },
          { term: "Latest request", value: explanation?.latestRequestId ?? explanation?.recoveryActionRequestId ?? "Not recorded" },
          { term: "Result invocation", value: resultInvocationId ?? "Not linked" },
          { term: "Result orchestration", value: resultOrchestration ?? "Not linked" },
          { term: "Agent choice", value: requestedAgent ?? "Automatic" },
        ]}
      />
    </div>
  );
}

function RecoveryCandidateSnapshot({ request }: { request: ApplicationRecoveryActionRequest }) {
  const candidates = request.agentCandidateSnapshot ?? [];
  if (request.actionType !== "select_agent" || candidates.length === 0) return null;
  const selectableCount = candidates.filter((candidate) => candidate.selectable).length;
  const selected = candidates.find((candidate) => candidate.id === request.selectedAgentId)
    ?? candidates.find((candidate) => candidate.id === request.requestedAgentId)
    ?? null;
  const blocked = candidates.filter((candidate) => !candidate.selectable);
  return (
    <div className="space-y-1 rounded border border-border bg-muted p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">Agent candidate snapshot</span>
        <Badge tone="success">{selectableCount} selectable</Badge>
        {blocked.length ? <Badge tone="warning">{blocked.length} blocked</Badge> : null}
        {selected ? <Badge tone={selected.selectable ? "success" : "warning"}>{selected.name}</Badge> : null}
      </div>
      {blocked.length ? (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {blocked.map((candidate) => (
            <li key={candidate.id} className="[overflow-wrap:anywhere]">
              {candidate.name}: {candidate.reasons.map(readableRecoveryAgentReason).join(", ")}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function RecoveryActionTimeline({ entries }: { entries: ApplicationRecoveryTimelineEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <ol className="space-y-1 border-l border-border pl-3 text-xs">
      {entries.map((entry) => (
        <li key={entry.id} className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={recoveryTimelineTone(entry.status)}>{readableRecoveryTimelineStatus(entry.status)}</Badge>
            <span className="text-muted-foreground">{shortTime(entry.createdAt)}</span>
          </div>
          {entry.message ? <p className="[overflow-wrap:anywhere] text-muted-foreground">{entry.message}</p> : null}
        </li>
      ))}
    </ol>
  );
}

function RecoveryActionItem({
  action,
  canRetry,
  pending,
  latestRequest,
  agentCandidates,
  agentsLoading,
  agentsError,
  onRequest,
}: {
  action: ApplicationOrchestrationRecoveryAction;
  canRetry: boolean;
  pending: boolean;
  latestRequest: ApplicationRecoveryActionRequest | null;
  agentCandidates: ApplicationOrchestrationRecoveryAgentCandidate[];
  agentsLoading: boolean;
  agentsError: boolean;
  onRequest: (actionType: string, reason?: string | null, agentId?: string | null) => void;
}) {
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const selectableAgents = agentCandidates.filter((candidate) => candidate.selectable);
  const preferredAgentId = agentCandidates.find((candidate) => candidate.preferred)?.id ?? selectableAgents[0]?.id ?? "";
  const effectiveAgentId = selectedAgentId || preferredAgentId;
  const selectedAgent = agentCandidates.find((candidate) => candidate.id === effectiveAgentId) ?? null;
  const isSelectAgent = action.type === "select_agent";
  const canRunSelectAgent = !isSelectAgent || Boolean(effectiveAgentId && selectedAgent?.selectable);
  const blockedReason = action.availability?.blockedReason ?? action.blockedReason ?? null;
  const warningReason = action.availability?.warningReason ?? action.warningReason ?? null;
  const actionBlocked = action.availability?.state === "blocked" || Boolean(blockedReason);
  const disabled = pending || actionBlocked;
  const latestExplanation = latestRequest?.explanation ?? null;

  return (
    <li className="rounded border border-border bg-muted p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{action.label}</span>
          {action.recommended ? <Badge tone="success">Recommended</Badge> : null}
          {action.riskLevel ? <Badge tone={riskTone(action.riskLevel)}>Risk {action.riskLevel}</Badge> : null}
          {blockedReason ? <Badge tone="warning">{readableRecoveryActionAvailabilityReason(blockedReason)}</Badge> : null}
          {warningReason ? <Badge tone="warning">{readableRecoveryActionAvailabilityReason(warningReason)}</Badge> : null}
          {action.requiresApproval ? <Badge tone="warning">Approval</Badge> : null}
          {!isExecutableRecoveryAction(action.type) ? <Badge tone="neutral">Manual</Badge> : null}
          {latestRequest ? <Badge tone={recoveryActionRequestTone(latestRequest.status)}>{readableRecoveryActionRequestStatus(latestRequest.status)}</Badge> : null}
        </div>
        {isExecutableRecoveryAction(action.type) ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={!canRetry || disabled || !canRunSelectAgent}
            onClick={() => onRequest(action.type, action.description, isSelectAgent ? effectiveAgentId : null)}
          >
            <Play />
            {actionBlocked ? "Blocked" : "Run"}
          </Button>
        ) : action.requiresApproval ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled || latestRequest?.status === "approval_pending"}
            onClick={() => onRequest(action.type, action.description)}
          >
            {actionBlocked ? "Blocked" : latestRequest?.status === "approval_pending" ? "Pending approval" : "Request approval"}
          </Button>
        ) : (
          <Button size="sm" variant="secondary" disabled>
            {action.type === "view_invocation" ? "Open from View" : "Not supported"}
          </Button>
        )}
      </div>
      {action.description ? (
        <p className="[overflow-wrap:anywhere] text-muted-foreground">{action.description}</p>
      ) : null}
      {action.recommendationReason ? (
        <p className="[overflow-wrap:anywhere] text-xs text-muted-foreground">{action.recommendationReason}</p>
      ) : null}
      {blockedReason || warningReason ? (
        <p className="[overflow-wrap:anywhere] text-xs text-muted-foreground">
          {readableRecoveryActionAvailabilityReason(blockedReason ?? warningReason ?? "")}
          {action.latestRequestId ? ` (${action.latestRequestId})` : ""}
        </p>
      ) : null}
      {latestExplanation?.nextStep || latestExplanation?.approvalRequestId || latestExplanation?.resultInvocationId ? (
        <div className="mt-2 space-y-1 rounded border border-border bg-background p-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Latest action guidance</span>
            {latestExplanation.state ? <Badge tone={recoveryExplanationTone(latestExplanation.state)}>{readableRecoveryExplanationState(latestExplanation.state)}</Badge> : null}
            {latestExplanation.reason ? <Badge tone={recoveryExplanationReasonTone(latestExplanation.reason)}>{readableRecoveryExplanationReason(latestExplanation.reason)}</Badge> : null}
          </div>
          {latestExplanation.nextStep ? (
            <p className="[overflow-wrap:anywhere] text-muted-foreground">{latestExplanation.nextStep}</p>
          ) : null}
          <FactList
            facts={[
              { term: "Approval request", value: latestExplanation.approvalRequestId ?? "Not required" },
              { term: "Result invocation", value: latestExplanation.resultInvocationId ?? "Not linked" },
              { term: "Result orchestration", value: latestExplanation.resultOrchestrationId ?? "Not linked" },
            ]}
          />
        </div>
      ) : null}
      {isSelectAgent ? (
        <SelectAgentRecoveryPicker
          candidates={agentCandidates}
          loading={agentsLoading}
          error={agentsError}
          value={effectiveAgentId}
          onChange={setSelectedAgentId}
        />
      ) : null}
    </li>
  );
}

function SelectAgentRecoveryPicker({
  candidates,
  loading,
  error,
  value,
  onChange,
}: {
  candidates: ApplicationOrchestrationRecoveryAgentCandidate[];
  loading: boolean;
  error: boolean;
  value: string;
  onChange: (agentId: string) => void;
}) {
  if (error) {
    return <p className="mt-2 text-xs text-destructive">Could not load recovery agents.</p>;
  }
  if (loading && candidates.length === 0) {
    return <p className="mt-2 text-xs text-muted-foreground">Loading recovery agents...</p>;
  }
  if (candidates.length === 0) {
    return <p className="mt-2 text-xs text-destructive">No governed application-control agents are registered.</p>;
  }
  const selected = candidates.find((candidate) => candidate.id === value) ?? null;
  return (
    <div className="mt-2 space-y-2">
      <Select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Recovery agent"
      >
        {!value ? <option value="">No selectable recovery agent</option> : null}
        {candidates.map((candidate) => (
          <option key={candidate.id} value={candidate.id} disabled={!candidate.selectable}>
            {recoveryAgentOptionLabel(candidate)}
          </option>
        ))}
      </Select>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {selected?.preferred ? <Badge tone="success">Recommended</Badge> : null}
        {selected?.sourceAgent ? <Badge tone="neutral">Original agent</Badge> : null}
        {selected ? (
          <span className="text-muted-foreground">
            {selected.status}
            {selected.healthStatus ? ` / ${selected.healthStatus}` : ""}
            {selected.locationType ? ` / ${selected.locationType}` : ""}
          </span>
        ) : null}
      </div>
      {candidates.some((candidate) => !candidate.selectable) ? (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {candidates.filter((candidate) => !candidate.selectable).map((candidate) => (
            <li key={candidate.id} className="[overflow-wrap:anywhere]">
              {candidate.name}: {candidate.reasons.map(readableRecoveryAgentReason).join(", ")}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function recoveryAgentOptionLabel(candidate: ApplicationOrchestrationRecoveryAgentCandidate): string {
  const suffixes = [
    candidate.preferred ? "recommended" : "",
    candidate.sourceAgent ? "original" : "",
    candidate.selectable ? "" : candidate.reasons.map(readableRecoveryAgentReason).join(", "),
  ].filter(Boolean);
  return suffixes.length ? `${candidate.name} (${suffixes.join("; ")})` : candidate.name;
}

function DiagnosticsBlock({ title, value }: { title: string; value?: unknown }) {
  if (value == null) return null;
  return (
    <details className="rounded border border-border bg-background p-2">
      <summary className="cursor-pointer text-xs font-medium">{title}</summary>
      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not recorded";
  return String(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function shortTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function applicationEventTone(level?: string | null): "neutral" | "success" | "warning" | "danger" {
  if (level === "error") return "danger";
  if (level === "warn" || level === "warning") return "warning";
  if (level === "info") return "success";
  return "neutral";
}

type ApplicationEventActualLevel = Exclude<ApplicationEventLevelSelection, "all"> | "other";

function normalizedApplicationEventLevel(level?: string | null): ApplicationEventActualLevel {
  if (level === "error") return "error";
  if (level === "warn" || level === "warning") return "warning";
  if (level === "info") return "info";
  return "other";
}

function applicationEventDataSummary(event: ApplicationEventSnapshot): string | null {
  const data = event.data ?? {};
  const parts = [
    typeof data.sourceType === "string" ? `source ${data.sourceType}` : null,
    typeof data.status === "string" ? `status ${data.status}` : null,
    typeof data.capabilityCount === "number" ? `${data.capabilityCount} capabilities` : null,
    typeof data.mcpServerCandidateCount === "number" ? `${data.mcpServerCandidateCount} MCP candidates` : null,
    typeof data.commandId === "string" ? `command ${data.commandId}` : null,
    typeof data.action === "string" ? `action ${data.action}` : null,
    typeof data.projectId === "string" ? `project ${data.projectId}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

function eventMatchesCapability(event: ApplicationEventSnapshot, capabilityName: string): boolean {
  const data = event.data ?? {};
  if (data.capability === capabilityName) return true;
  const result = data.applicationResult && typeof data.applicationResult === "object" && !Array.isArray(data.applicationResult)
    ? data.applicationResult as { capability?: unknown; applicationAction?: unknown }
    : null;
  if (result?.capability === capabilityName || result?.applicationAction === capabilityName) return true;
  if (typeof data.commandId === "string" && capabilityName.endsWith(`.wrapper.${data.commandId}`)) return true;
  return false;
}

function ApplicationEventTimeline({
  events,
  capabilities,
  loading,
  error,
}: {
  events: ApplicationEventSnapshot[];
  capabilities: ApplicationCapability[];
  loading: boolean;
  error: boolean;
}) {
  const levelFilter = useUiStore((s) => s.selectedApplicationEventLevel);
  const setLevelFilter = useUiStore((s) => s.setSelectedApplicationEventLevel);
  const [capabilityFilter, setCapabilityFilter] = useState("all");
  const counts = useMemo(() => {
    const next = { error: 0, warning: 0, info: 0, other: 0 };
    for (const event of events) {
      const level = normalizedApplicationEventLevel(event.level);
      next[level] += 1;
    }
    return next;
  }, [events]);
  const filteredEvents = useMemo(
    () => events.filter((event) =>
      (levelFilter === "all" || normalizedApplicationEventLevel(event.level) === levelFilter)
      && (capabilityFilter === "all" || eventMatchesCapability(event, capabilityFilter))),
    [events, levelFilter, capabilityFilter],
  );
  const latestProblem = events.find((event) => {
    const level = normalizedApplicationEventLevel(event.level);
    return level === "error" || level === "warning";
  });
  const filters: Array<{ value: ApplicationEventLevelSelection; label: string; count: number; tone: "neutral" | "success" | "warning" | "danger" }> = [
    { value: "all", label: "All", count: events.length, tone: "neutral" },
    { value: "error", label: "Errors", count: counts.error, tone: "danger" },
    { value: "warning", label: "Warnings", count: counts.warning, tone: "warning" },
    { value: "info", label: "Info", count: counts.info, tone: "success" },
  ];

  return (
    <Card data-application-panel="timeline">
      <CardHeader>
        <CardTitle>Application timeline</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {error ? (
          <p className="text-sm text-destructive">Could not load application events.</p>
        ) : loading ? (
          <p className="text-sm text-muted-foreground">Loading events...</p>
        ) : !events.length ? (
          <p className="text-sm text-muted-foreground">No application events recorded yet.</p>
        ) : (
          <>
            <div className="rounded-md border border-border bg-muted/40 p-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={counts.error ? "danger" : counts.warning ? "warning" : "success"}>
                  {counts.error ? `${counts.error} error${counts.error === 1 ? "" : "s"}` : counts.warning ? `${counts.warning} warning${counts.warning === 1 ? "" : "s"}` : "No recent problems"}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {filteredEvents.length} of {events.length} event(s)
                </span>
                {counts.info ? <Badge tone="success">{counts.info} info</Badge> : null}
                {counts.other ? <Badge tone="neutral">{counts.other} other</Badge> : null}
              </div>
              {latestProblem ? (
                <p className="mt-1 [overflow-wrap:anywhere] text-xs text-muted-foreground">
                  Latest attention item: {latestProblem.message ?? latestProblem.type}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2" aria-label="Application event level filter">
              {filters.map((filter) => (
                <Button
                  key={filter.value}
                  size="sm"
                  variant={levelFilter === filter.value ? "secondary" : "ghost"}
                  className="h-7 px-2 text-xs"
                  onClick={() => setLevelFilter(filter.value)}
                >
                  {filter.label}
                  <Badge tone={filter.tone}>{filter.count}</Badge>
                </Button>
              ))}
            </div>
            {capabilities.length ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Capability</span>
                <Select
                  className="h-8 max-w-full text-xs sm:max-w-80"
                  value={capabilityFilter}
                  aria-label="Application event capability filter"
                  onChange={(event) => setCapabilityFilter(event.target.value)}
                >
                  <option value="all">All capabilities</option>
                  {capabilities.map((capability) => (
                    <option key={capability.name} value={capability.name}>
                      {capability.displayName ?? shortCapabilityName(capability.name)}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
            {!filteredEvents.length ? (
              <p className="text-sm text-muted-foreground">No events match this level.</p>
            ) : (
              <ul className="space-y-2">
                {filteredEvents.map((event) => {
                  const summary = applicationEventDataSummary(event);
                  return (
                    <li key={event.id} className="rounded-md border border-border p-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={applicationEventTone(event.level)}>{event.level ?? "event"}</Badge>
                        <span className="[overflow-wrap:anywhere] font-mono text-xs">{event.type}</span>
                        <span className="text-xs text-muted-foreground">{shortTime(event.createdAt)}</span>
                      </div>
                      {event.message ? (
                        <p className="mt-1 [overflow-wrap:anywhere] text-sm text-muted-foreground">{event.message}</p>
                      ) : null}
                      {summary ? <p className="mt-1 [overflow-wrap:anywhere] text-xs text-muted-foreground">{summary}</p> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Right-pane detail for the application selected in the Applications view. */
export function ApplicationsInspector() {
  const { data: state } = useConsoleState();
  const selectedApplicationId = useUiStore((s) => s.selectedApplicationId);
  const selectedApplicationResultId = useUiStore((s) => s.selectedApplicationResultId);
  const selectedApplicationAutomationId = useUiStore((s) => s.selectedApplicationAutomationId);
  const setSelectedApplicationId = useUiStore((s) => s.setSelectedApplicationId);
  const setSelectedApplicationResultId = useUiStore((s) => s.setSelectedApplicationResultId);
  const setSelectedInvocationId = useUiStore((s) => s.setSelectedInvocationId);
  const setSection = useUiStore((s) => s.setSection);
  const application = (state?.applications ?? []).find((app) => app.id === selectedApplicationId);
  const resultViewer = application && selectedApplicationResultId
    ? { applicationId: application.id, resultId: selectedApplicationResultId }
    : null;
  const automations = state?.automations ?? [];

  const { data: capabilityData } = useQuery({
    queryKey: ["application-capabilities", application?.id],
    queryFn: () => api.listApplicationCapabilities(application!.id),
    enabled: Boolean(application?.id),
    refetchInterval: 2000,
  });
  const { data: eventData, isLoading: eventsLoading, error: eventsError } = useQuery({
    queryKey: ["application-events", application?.id],
    queryFn: () => api.listApplicationEvents(application!.id, 12),
    enabled: Boolean(application?.id),
    refetchInterval: 3000,
  });
  const capabilities = capabilityData?.capabilities ?? [];

  useEffect(() => {
    if (!application?.id || !selectedApplicationAutomationId) return;
    const frame = window.requestAnimationFrame(() => scrollAutomationIntoView(selectedApplicationAutomationId));
    return () => window.cancelAnimationFrame(frame);
  }, [application?.id, selectedApplicationAutomationId, capabilities.length, automations.length]);

  if (!application) {
    return (
      <Card data-application-panel="summary">
        <CardHeader>
          <CardTitle>Application details</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Select an application to see its source, capabilities, probe, and orchestration drafts.
          </p>
        </CardContent>
      </Card>
    );
  }

  const probe = application.probe;
  const orchestrations = application.orchestrations ?? [];
  const invocations = state?.invocations ?? [];
  const auditSummaries = state?.auditSummaries ?? [];
  const runs = applicationRuns(application, invocations, auditSummaries);

  function viewInvocation(invocationId: string) {
    setSelectedInvocationId(invocationId);
    setSection("invocations");
  }

  function viewResult(applicationId: string, resultId?: string | null) {
    setSelectedApplicationId(applicationId);
    setSelectedApplicationResultId(resultId ?? null);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{application.name}</CardTitle>
          <p className="text-xs text-muted-foreground">
            {application.id} · {application.kind}
          </p>
        </CardHeader>
        <CardContent>
          <FactList
            facts={[
              { term: "Status", value: application.status },
              { term: "Source", value: `${application.source.type} · ${sourceSummary(application.source)}` },
              { term: "Path", value: application.path ?? "—" },
              { term: "Owner", value: application.ownerTeamId ?? "—" },
            ]}
          />
        </CardContent>
      </Card>

      {isCcusageApplication(application) ? (
        <CcusageReferenceUseCase
          application={application}
          capabilities={capabilities}
          currentProjectId={state?.currentProjectId}
          onViewInvocation={viewInvocation}
        />
      ) : null}

      <ApplicationActionRequired
        application={application}
        recoveryActions={state?.applicationRecoveryActions ?? []}
        onViewInvocation={viewInvocation}
      />
      <ApplicationRecoveryOperations
        application={application}
        recoveryActions={state?.applicationRecoveryActions ?? []}
        onViewInvocation={viewInvocation}
      />
      <ApplicationApprovalQueue
        application={application}
        approvalRequests={state?.approvalRequests ?? []}
        recoveryActions={state?.applicationRecoveryActions ?? []}
        invocations={invocations}
        onViewInvocation={viewInvocation}
      />
      <ApplicationOnboardingContinuity application={application} />
      <ApplicationDescriptorNextActions application={application} />
      <ApplicationActions application={application} onViewResult={viewResult} />
      <ApplicationLatestActivity runs={runs} onViewInvocation={viewInvocation} />
      <ApplicationEventTimeline
        events={eventData?.events ?? []}
        capabilities={capabilities}
        loading={eventsLoading}
        error={Boolean(eventsError)}
      />
      <ApplicationDescriptorEditor application={application} />
      <ApplicationResultSummary result={application.latestResult} onViewInvocation={viewInvocation} onViewResult={viewResult} />
      <ApplicationResultsHistory
        application={application}
        currentProjectId={state?.currentProjectId}
        invocations={invocations}
        onViewInvocation={viewInvocation}
        onViewResult={viewResult}
      />
      <ApplicationMcpSummary
        application={application}
        capabilities={capabilities}
        currentProjectId={state?.currentProjectId}
        invocations={invocations}
        onViewInvocation={viewInvocation}
        onViewResult={viewResult}
      />

      <Card data-application-panel="capabilities">
        <CardHeader>
          <CardTitle>Capabilities</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {!capabilities.length ? (
            <p className="text-sm text-muted-foreground">No capabilities projected.</p>
          ) : (
            capabilities.map((capability) => (
              <div key={capability.name} className="space-y-2 rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {capability.displayName ?? capability.name}
                    {capability.requiresApproval ? <span className="text-warning"> ⚠</span> : null}
                  </span>
                  <div className="flex min-w-0 flex-wrap gap-1.5 sm:shrink-0 sm:justify-end">
                    <Badge tone={riskTone(capability.riskLevel)}>{capability.riskLevel ?? "—"}</Badge>
                    <Badge tone={capability.status === "disabled" ? "danger" : "success"}>
                      {capability.status ?? "—"}
                    </Badge>
                    {capability.metadata?.readiness?.state ? (
                      <Badge tone={readinessTone(capability.metadata.readiness.state)}>
                        {capability.metadata.readiness.state}
                      </Badge>
                    ) : null}
                    {capability.metadata?.resultPath?.outputCollection ? (
                      <Badge tone="neutral">{capability.metadata.resultPath.outputCollection}</Badge>
                    ) : null}
                  </div>
                </div>
                {isWrapperCapability(capability) ? (
                  <WrapperCapabilityRunForm capability={capability} onViewInvocation={viewInvocation} />
                ) : null}
                <CapabilityAutomationPanel
                  application={application}
                  capability={capability}
                  automations={capabilityAutomations(automations, application, capability)}
                  runs={runs}
                  focusedAutomationId={selectedApplicationAutomationId}
                  onViewInvocation={viewInvocation}
                />
                <CapabilityRunHistory
                  runs={capabilityRuns(runs, capability.name)}
                  capability={capability}
                  onViewInvocation={viewInvocation}
                />
              </div>
            ))
          )}
          <p className="text-xs text-muted-foreground">⚠ requires an explicit approval token</p>
        </CardContent>
      </Card>

      {probe ? (
        <Card>
          <CardHeader>
            <CardTitle>Probe</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {probe.summary ? <p className="text-sm text-muted-foreground">{probe.summary}</p> : null}
            {probeDiffGroups(probe.diff).length ? (
              <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="warning">changes</Badge>
                  <span className="text-xs text-muted-foreground">
                    Compared with the previous probe{probe.diff?.previousCheckedAt ? ` at ${shortTime(probe.diff.previousCheckedAt)}` : ""}.
                  </span>
                </div>
                {probeDiffGroups(probe.diff).map((group) => (
                  <div key={group.label} className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">{group.label}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {group.values.map((value) => (
                        <Badge key={value} tone={group.tone}>{shortProbeDiffName(value)}</Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {probe.capabilities?.length ? (
              <div className="flex flex-wrap gap-1.5">
                {probe.capabilities.map((capability) => (
                  <Badge key={capability.name} tone={capability.source === "inferred" ? "warning" : "neutral"}>
                    {capability.name.split(".").at(-1)}
                  </Badge>
                ))}
              </div>
            ) : null}
            {probe.warnings?.length ? (
              <ul className="list-inside list-disc text-xs text-warning">
                {probe.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {orchestrations.length ? (
        <OrchestrationDrafts
          application={application}
          invocations={invocations}
          orchestrations={orchestrations}
        />
      ) : null}
      <ApplicationRenderResultModal
        target={resultViewer}
        application={application}
        currentProjectId={state?.currentProjectId}
        invocations={invocations}
        onViewInvocation={viewInvocation}
        onClose={() => setSelectedApplicationResultId(null)}
      />
    </div>
  );
}
