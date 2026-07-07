import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Clipboard, ExternalLink, Pause, Pencil, Play, Search, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { FactList } from "@/components/common/fact-list";
import { ConfirmModal } from "@/components/common/confirm-modal";
import { Field } from "@/components/common/field";
import { applicationRunDeepLink } from "@/app/deep-links";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/cn";
import { DescriptorFeedbackList, WrapperCapabilityImpactPanel } from "@/features/applications/descriptor-feedback";
import { parseOptionalJsonObjectAllowNull, prettyJson, wrapperCapabilityImpact } from "@/features/applications/descriptor-utils";
import { NpmWrapperCommandBuilder } from "@/features/applications/wrapper-command-builder";
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
import { readableStatus, statusTone } from "@/lib/readable-labels";
import type {
  ApplicationEventSnapshot,
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
  ApplicationSnapshot,
  ApplicationResultRef,
  AuditSnapshot,
  AutomationSnapshot,
  NpmWrapperArgInputSnapshot,
  InvocationSnapshot,
} from "@/lib/console-state";
import type { ApplicationEventLevelSelection } from "@/store/ui-store";

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

function formStringValue(value: unknown) {
  return typeof value === "string" ? value : "";
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

function ApplicationActions({ application }: { application: ApplicationSnapshot }) {
  const { execute, pending, error } = useAsyncAction();
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const status = application.status;

  const lifecycle = (action: "probe" | "online" | "offline" | "archive" | "refresh") =>
    runWithApplicationApproval((approvalRequestId) =>
      api.applicationLifecycle(application.id, action, approvalRequestId ? { approvalRequestId } : {}),
    );

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
    <Card>
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
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          <Pencil />
          Edit descriptors
        </Button>
        <Modal open={open} onClose={() => setOpen(false)} title="Edit application descriptors" description="Update the reviewed descriptor JSON for this Application." size="lg">
          <form className="space-y-3" onSubmit={submit}>
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
}: {
  result?: ApplicationResultRef | null;
  onViewInvocation: (invocationId: string) => void;
}) {
  if (!result) return null;
  const importedCount = result.importedRecordCount ?? result.importedRecordIds?.length ?? 0;
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
        </div>
        <FactList
          facts={[
            { term: "Capability", value: result.capability ?? result.applicationAction ?? "—" },
            { term: "MCP tool", value: result.mcpToolName ?? "—" },
            { term: "Invocation", value: result.invocationId ?? "—" },
            { term: "Completed", value: shortTime(result.completedAt) },
            {
              term: "Imported records",
              value: importedCount > 0 ? (result.importedRecordIds ?? []).join(", ") || String(importedCount) : "None",
            },
          ]}
        />
        {result.invocationId ? (
          <Button size="sm" variant="secondary" onClick={() => onViewInvocation(result.invocationId!)}>
            <ExternalLink />
            View invocation
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ApplicationMcpSummary({ application }: { application: ApplicationSnapshot }) {
  const { execute, pending, error } = useAsyncAction();
  const mcpAgent = application.mcpAgent;
  const servers = application.probe?.mcpServers ?? [];
  const [confirmCandidate, setConfirmCandidate] = useState<ApplicationProbeMcpServer | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  if (!mcpAgent && servers.length === 0) return null;

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
  const { data: state } = useConsoleState();
  const setSelectedInvocationId = useUiStore((s) => s.setSelectedInvocationId);
  const setSection = useUiStore((s) => s.setSection);
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
          <Button size="sm" variant="secondary" disabled={!canRetry || pending} onClick={retryRun}>
            <Play />
            {pending ? "Retrying..." : "Re-run"}
          </Button>
          {copiedRunLink ? <span className="text-xs text-success">Copied.</span> : null}
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
            <RecoveryTimeline requests={recoveryActionRequests} onViewInvocation={viewInvocation} />
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
  onViewInvocation,
}: {
  requests: ApplicationRecoveryActionRequest[];
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
            open={index === 0}
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
  label,
  onViewInvocation,
}: {
  request: ApplicationRecoveryActionRequest;
  open: boolean;
  label: string;
  onViewInvocation: (invocationId: string) => void;
}) {
  const outcome = request.outcome;
  const explanation = request.explanation ?? null;
  const resultInvocationId = request.resultInvocation?.id ?? request.resultInvocationId ?? null;
  return (
    <details className="rounded border border-border bg-background p-2" open={open}>
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
  const selectedApplicationAutomationId = useUiStore((s) => s.selectedApplicationAutomationId);
  const setSelectedInvocationId = useUiStore((s) => s.setSelectedInvocationId);
  const setSection = useUiStore((s) => s.setSection);
  const application = (state?.applications ?? []).find((app) => app.id === selectedApplicationId);
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

      <ApplicationActionRequired
        application={application}
        recoveryActions={state?.applicationRecoveryActions ?? []}
        onViewInvocation={viewInvocation}
      />
      <ApplicationActions application={application} />
      <ApplicationLatestActivity runs={runs} onViewInvocation={viewInvocation} />
      <ApplicationEventTimeline
        events={eventData?.events ?? []}
        capabilities={capabilities}
        loading={eventsLoading}
        error={Boolean(eventsError)}
      />
      <ApplicationDescriptorEditor application={application} />
      <ApplicationResultSummary result={application.latestResult} onViewInvocation={viewInvocation} />
      <ApplicationMcpSummary application={application} />

      <Card>
        <CardHeader>
          <CardTitle>Capabilities</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {!capabilities.length ? (
            <p className="text-sm text-muted-foreground">No capabilities projected.</p>
          ) : (
            capabilities.map((capability) => (
              <div key={capability.name} className="space-y-2 rounded-md border border-border p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <span className="[overflow-wrap:anywhere]">
                    {capability.displayName ?? capability.name}
                    {capability.requiresApproval ? <span className="text-warning"> ⚠</span> : null}
                  </span>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
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
    </div>
  );
}
