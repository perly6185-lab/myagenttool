import type { ApplicationRecoveryActionRequest, ApplicationSnapshot, ApplicationSource } from "@/lib/console-state";
import type { Tone } from "@/lib/readable-labels";

export function sourceSummary(source: ApplicationSource): string {
  switch (source.type) {
    case "git":
      return source.url;
    case "local":
      return source.path;
    case "npm":
      return `${source.package}${source.version ? `@${source.version}` : ""}`;
    default:
      return source.uri ?? "manual manifest";
  }
}

export function applicationNextStep(app: ApplicationSnapshot): { title: string; detail: string; tone: Tone } {
  if (app.status === "failed") {
    return {
      title: "Needs attention",
      detail: app.lifecycle?.error ?? "Inspect the failed lifecycle event and retry after fixing the source.",
      tone: "danger",
    };
  }
  if (app.status === "probing") {
    return {
      title: "Source setup running",
      detail: "Wait for the git clone or probe operation to finish before enabling execution.",
      tone: "warning",
    };
  }
  if (app.status === "archived") {
    return {
      title: "Archived",
      detail: "Restore by registering a fresh application if this asset needs to run again.",
      tone: "danger",
    };
  }
  if (app.status === "offline") {
    return {
      title: "Offline",
      detail: "Bring the application online to re-enable execution-like capabilities.",
      tone: "warning",
    };
  }
  const automationCounts = app.healthSummary?.automationCounts;
  const automationAttention = app.healthSummary?.latestAutomationAttention;
  if ((automationCounts?.failing ?? 0) > 0) {
    return {
      title: "Schedule failing",
      detail: automationAttention?.lastErrorSummary
        ?? automationAttention?.nextAction
        ?? `${automationCounts?.failing ?? 0} ${pluralSchedule(automationCounts?.failing ?? 0)} failing.`,
      tone: "danger",
    };
  }
  if ((automationCounts?.waitingForApproval ?? 0) > 0) {
    return {
      title: "Schedule waiting for approval",
      detail: automationAttention?.nextAction
        ?? `${automationCounts?.waitingForApproval ?? 0} ${pluralSchedule(automationCounts?.waitingForApproval ?? 0)} waiting for approval.`,
      tone: "warning",
    };
  }
  if (!app.probe) {
    return {
      title: "Probe recommended",
      detail: "Run a probe to discover capabilities, MCP candidates, and wrapper readiness.",
      tone: "warning",
    };
  }
  const wrapperReadinessProblem = applicationWrapperReadinessProblem(app);
  if (wrapperReadinessProblem) {
    return {
      title: "Wrapper setup needed",
      detail: wrapperReadinessProblem,
      tone: "warning",
    };
  }
  if (app.probe.warnings?.length) {
    return {
      title: "Probe warnings",
      detail: app.probe.warnings[0],
      tone: "warning",
    };
  }
  const probeChangeCount = applicationProbeChangeCount(app);
  if (probeChangeCount > 0) {
    return {
      title: "Probe changes detected",
      detail: `${probeChangeCount} capability or MCP candidate change(s) since the previous probe.`,
      tone: "warning",
    };
  }
  if (app.wrapper?.mode === "installed-wrapper" && app.wrapper.installState !== "installed") {
    return {
      title: "Wrapper setup needed",
      detail: "Confirm the npm wrapper is installed before wrapper commands can execute.",
      tone: "warning",
    };
  }
  if (!app.orchestrationIds?.length) {
    return {
      title: "Ready for orchestration",
      detail: "Generate a governed orchestration draft when this application needs maintenance.",
      tone: "success",
    };
  }
  return {
    title: "Ready",
    detail: "Capabilities, probe evidence, and orchestration drafts are available.",
    tone: "success",
  };
}

function pluralSchedule(count: number): string {
  return count === 1 ? "schedule is" : "schedules are";
}

function applicationWrapperReadinessProblem(app: ApplicationSnapshot): string | null {
  const readiness = app.wrapper?.readiness;
  if (!readiness || readiness.state === "ready") return null;
  const blocked = readiness.blockedCommandIds?.length ?? 0;
  if (blocked > 0) {
    return `${blocked} wrapper command(s) need setup: ${readiness.reason ?? "wrapper_static_check_failed"}.`;
  }
  return readiness.reason ? `Wrapper static check needs setup: ${readiness.reason}.` : "Wrapper static check needs setup.";
}

function applicationProbeChangeCount(app: ApplicationSnapshot): number {
  const diff = app.probe?.diff;
  if (!diff) return 0;
  return [
    diff.addedCapabilityNames,
    diff.removedCapabilityNames,
    diff.changedCapabilityNames,
    diff.addedMcpServerIds,
    diff.removedMcpServerIds,
    diff.changedMcpServerIds,
  ].reduce((count, values) => count + (values?.length ?? 0), 0);
}

export type ApplicationTriageFilter = "all" | "attention" | "warning" | "ready";

export function applicationTriageBucket(app: ApplicationSnapshot): Exclude<ApplicationTriageFilter, "all"> {
  const tone = applicationNextStep(app).tone;
  if (tone === "danger") return "attention";
  if (tone === "warning") return "warning";
  return "ready";
}

export function applicationTriageCounts(applications: ApplicationSnapshot[]): Record<Exclude<ApplicationTriageFilter, "all">, number> {
  return applications.reduce(
    (counts, app) => {
      counts[applicationTriageBucket(app)] += 1;
      return counts;
    },
    { attention: 0, warning: 0, ready: 0 },
  );
}

export function applicationMatchesSearch(app: ApplicationSnapshot, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const nextStep = applicationNextStep(app);
  const haystack = [
    app.id,
    app.name,
    app.kind,
    app.status,
    sourceSummary(app.source),
    app.path,
    app.projectId,
    app.ownerTeamId,
    app.lifecycle?.lastOperation,
    app.lifecycle?.error,
    nextStep.title,
    nextStep.detail,
  ].filter(Boolean).join(" ").toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export function sortApplicationsForTriage(applications: ApplicationSnapshot[]): ApplicationSnapshot[] {
  const triageRank: Record<ReturnType<typeof applicationTriageBucket>, number> = {
    attention: 0,
    warning: 1,
    ready: 2,
  };
  return [...applications].sort((left, right) => {
    const triageDelta = triageRank[applicationTriageBucket(left)] - triageRank[applicationTriageBucket(right)];
    if (triageDelta !== 0) return triageDelta;

    const leftUpdated = Date.parse(left.updatedAt ?? left.createdAt ?? "");
    const rightUpdated = Date.parse(right.updatedAt ?? right.createdAt ?? "");
    const timeDelta = (Number.isNaN(rightUpdated) ? 0 : rightUpdated) - (Number.isNaN(leftUpdated) ? 0 : leftUpdated);
    if (timeDelta !== 0) return timeDelta;

    return left.name.localeCompare(right.name);
  });
}

export function latestApplicationRecoveryAction(
  applicationId: string,
  requests: ApplicationRecoveryActionRequest[],
): ApplicationRecoveryActionRequest | null {
  return requests
    .filter((request) => request.applicationId === applicationId)
    .sort((left, right) => timestampValue(right.updatedAt ?? right.createdAt) - timestampValue(left.updatedAt ?? left.createdAt))[0] ?? null;
}

function timestampValue(value?: string | null): number {
  const timestamp = Date.parse(value ?? "");
  return Number.isNaN(timestamp) ? 0 : timestamp;
}
