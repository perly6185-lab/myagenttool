import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Code2, PackageCheck, Settings2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { EmptyState } from "@/components/common/empty-state";
import { SectionHeading } from "@/components/common/section-heading";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/cn";
import { RegisterApplicationModal } from "@/features/applications/register-application-modal";
import { ApplicationsInspector } from "@/features/applications/applications-inspector";
import {
  applicationMatchesSearch,
  applicationNextStep,
  applicationTriageBucket,
  applicationTriageCounts,
  latestApplicationRecoveryAction,
  sortApplicationsForTriage,
  sourceSummary,
  type ApplicationTriageFilter,
} from "@/features/applications/application-health";
import {
  readableRecoveryActionRequestStatus,
  readableRecoveryActionType,
  readableRecoveryOutcome,
  recoveryActionRequestTone,
  recoveryOutcomeTone,
} from "@/features/recovery/application-recovery-ui";
import type { ApplicationSnapshot } from "@/lib/console-state";
import type { Tone } from "@/lib/readable-labels";
import type { ApplicationEventLevelSelection } from "@/store/ui-store";
import type { ApplicationRegisterRequest } from "@/lib/console-state";

const CCUSAGE_APPLICATION_ID = "app_ccusage";
const CCUSAGE_DEFAULT_VERSION = "20.0.16";
const DOOCS_MD_APPLICATION_ID = "app_doocs_md";
const DOOCS_MD_DEFAULT_PATH = "doocs-md";
const CCUSAGE_REPORT_WRAPPERS = [
  { id: "daily", displayName: "ccusage Daily Report", args: ["daily", "--json"] },
  { id: "weekly", displayName: "ccusage Weekly Report", args: ["weekly", "--json"] },
  { id: "monthly", displayName: "ccusage Monthly Report", args: ["monthly", "--json"] },
  { id: "session", displayName: "ccusage Session Report", args: ["session", "--json"] },
  { id: "codex_daily", displayName: "ccusage Codex Daily Report", args: ["codex", "daily", "--json"] },
  { id: "claude_daily", displayName: "ccusage Claude Daily Report", args: ["claude", "daily", "--json"] },
];

type FleetFilter = "all" | "npm_wrapper" | "stdio_mcp" | "http_mcp" | "manual_manifest" | "blocked_probe" | "ready_mcp" | "automation_attention";

function createCcusageApplicationRegistration(): ApplicationRegisterRequest {
  return {
    id: CCUSAGE_APPLICATION_ID,
    name: "ccusage",
    autoOnline: false,
    source: {
      type: "npm",
      package: "ccusage",
      version: CCUSAGE_DEFAULT_VERSION,
      wrapper: {
        mode: "installed-wrapper",
        packageManager: "npm",
        commands: CCUSAGE_REPORT_WRAPPERS.map((report) => ({
          id: report.id,
          displayName: report.displayName,
          description: `Governed ccusage ${report.id} usage report (read-only, JSON).`,
          commandType: "bin",
          command: "ccusage",
          args: [...report.args, "--offline"],
          status: "approved",
          riskLevel: "low",
          riskTags: ["usage-report", "read-only"],
          requiresApproval: report.id === "session",
          filePolicy: "read_only",
          networkPolicy: "forbidden",
          compatibilityFacade: {
            type: "tool",
            name: "ccusage.report",
            invocationMode: "tool-facade",
          },
          outputCollection: "importedUsageEstimates",
          billing: {
            authoritative: false,
            externalBilled: true,
            amountSource: "imported_ccusage_report",
          },
          resultImport: {
            source: "ccusage",
            kind: "usage_estimates",
            amountSource: "imported_ccusage_report",
          },
          argInputs: [
            { key: "since", flag: "--since", type: "date" },
            { key: "until", flag: "--until", type: "date" },
            { key: "timezone", flag: "--timezone", type: "token" },
          ],
        })),
      },
    },
  };
}

function createDoocsMdApplicationRegistration(): ApplicationRegisterRequest {
  return {
    id: DOOCS_MD_APPLICATION_ID,
    name: "doocs/md",
    source: {
      type: "local",
      path: DOOCS_MD_DEFAULT_PATH,
    },
    integrationBrief: {
      version: "application-intake.v1",
      status: "draft",
      intent: "Render and inspect WeChat-ready Markdown through doocs/md MCP and the web editor.",
      sourceType: "local",
      discoverableCapabilities: [
        "render markdown",
        "list themes",
        "get renderer options",
        "start web editor",
        "send editor result",
      ],
      invokableCapabilities: [
        "render markdown",
        "list themes",
        "start web editor",
        "send editor result",
      ],
      dataBoundary: "Local doocs/md checkout. MCP runs as a rooted stdio process through Desktop Bridge; web editor runs local Vite and imports rendered HTML into Application Result Center.",
      fixedCommands: ["render_markdown", "list_themes", "get_renderer_options", "pnpm run start"],
      userInputs: "Markdown content, theme, post title, and editor source URL.",
      resultImport: "Rendered HTML results, editor handoff metadata, and option catalogs are imported into Application Result Center.",
      approvalsAndRecovery: "Desktop Bridge must be online. Local execution stays allowlisted to the rooted doocs/md checkout. Startup failures surface bridge reason, last error, and next step.",
      smokeTests: ["pnpm smoke:doocs-md-application", "pnpm smoke:doocs-md-editor"],
      aiAssistance: {
        requested: true,
        nextDrafts: ["descriptor", "wrapper_or_mcp_adapter", "safe_probe", "smoke_tests", "review_notes"],
      },
    },
  };
}

function useBelowXlViewport() {
  const [belowXl, setBelowXl] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(max-width: 1279px)").matches
      : false,
  );

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia("(max-width: 1279px)");
    const update = () => setBelowXl(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return belowXl;
}

function statusTone(status: string): Tone {
  if (status === "active") return "success";
  if (status === "offline" || status === "registered" || status === "draft" || status === "probing") return "warning";
  if (status === "archived" || status === "failed") return "danger";
  return "neutral";
}

function automationScheduleCounts(app: ApplicationSnapshot) {
  return app.healthSummary?.automationCounts ?? { failing: 0, waitingForApproval: 0, paused: 0, attention: 0 };
}

function hasAutomationScheduleSignal(app: ApplicationSnapshot): boolean {
  const counts = automationScheduleCounts(app);
  return counts.failing > 0 || counts.waitingForApproval > 0 || counts.paused > 0;
}

function scheduleLabel(count: number, label: string): string {
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}

function automationScheduleDetail(app: ApplicationSnapshot): string {
  const latest = app.healthSummary?.latestAutomationAttention;
  if (latest?.name && latest.nextAction) return `${latest.name}: ${latest.nextAction}`;
  if (latest?.name && latest.lastErrorSummary) return `${latest.name}: ${latest.lastErrorSummary}`;
  if (latest?.name) return latest.name;
  return "Open schedules to inspect the affected capability automation.";
}

function applicationScheduleButtonLabel(app: ApplicationSnapshot): string {
  const status = app.healthSummary?.latestAutomationAttention?.status;
  if (status === "failing") return "Inspect failing schedule";
  if (status === "waiting_for_approval") return "Review approval";
  if (status === "paused") return "Resume paused schedule";
  return "View schedules";
}

function applicationMcpServers(app: ApplicationSnapshot) {
  return app.probe?.mcpServers ?? [];
}

function isNpmWrapperApplication(app: ApplicationSnapshot): boolean {
  return app.source.type === "npm" || Boolean(app.wrapper);
}

function isManualManifestApplication(app: ApplicationSnapshot): boolean {
  return app.source.type === "manual" || app.integrationBrief?.sourceType === "manual";
}

function hasMcpTransport(app: ApplicationSnapshot, transport: "stdio" | "http"): boolean {
  return applicationMcpServers(app).some((server) => server.transport === transport);
}

function hasBlockedLiveProbe(app: ApplicationSnapshot): boolean {
  return applicationMcpServers(app).some((server) => server.review?.liveProbe?.state === "blocked");
}

function hasReadyMcpSignal(app: ApplicationSnapshot): boolean {
  return Boolean(app.mcpAgent?.agentId)
    || applicationMcpServers(app).some((server) => server.status === "ready" && server.review?.liveProbe?.state !== "blocked");
}

function hasAutomationAttention(app: ApplicationSnapshot): boolean {
  return (app.healthSummary?.automationCounts?.attention ?? 0) > 0;
}

function applicationMatchesFleetFilter(app: ApplicationSnapshot, filter: FleetFilter): boolean {
  if (filter === "all") return true;
  if (filter === "npm_wrapper") return isNpmWrapperApplication(app);
  if (filter === "stdio_mcp") return hasMcpTransport(app, "stdio");
  if (filter === "http_mcp") return hasMcpTransport(app, "http");
  if (filter === "manual_manifest") return isManualManifestApplication(app);
  if (filter === "blocked_probe") return hasBlockedLiveProbe(app);
  if (filter === "ready_mcp") return hasReadyMcpSignal(app);
  if (filter === "automation_attention") return hasAutomationAttention(app);
  return true;
}

function fleetMetricTone(count: number, filter: FleetFilter): Tone {
  if (filter === "blocked_probe" || filter === "automation_attention") return count ? "warning" : "neutral";
  if (filter === "ready_mcp") return count ? "success" : "neutral";
  return count ? "neutral" : "neutral";
}

function fleetFilterLabel(filter: FleetFilter): string {
  if (filter === "all") return "All";
  if (filter === "npm_wrapper") return "npm wrappers";
  if (filter === "stdio_mcp") return "stdio MCP";
  if (filter === "http_mcp") return "HTTP MCP";
  if (filter === "manual_manifest") return "manual manifests";
  if (filter === "blocked_probe") return "blocked probes";
  if (filter === "ready_mcp") return "ready MCP";
  if (filter === "automation_attention") return "automation attention";
  return filter;
}

function ApplicationFleetOverview({
  applications,
  activeFilter,
  onFilter,
}: {
  applications: ApplicationSnapshot[];
  activeFilter: FleetFilter;
  onFilter: (filter: FleetFilter) => void;
}) {
  const metrics: { filter: FleetFilter; label: string; value: number; detail: string }[] = [
    { filter: "all", label: "Total", value: applications.length, detail: "registered assets" },
    { filter: "npm_wrapper", label: "npm wrappers", value: applications.filter(isNpmWrapperApplication).length, detail: "reviewed package wrappers" },
    { filter: "stdio_mcp", label: "stdio MCP", value: applications.filter((app) => hasMcpTransport(app, "stdio")).length, detail: "local rooted servers" },
    { filter: "http_mcp", label: "HTTP MCP", value: applications.filter((app) => hasMcpTransport(app, "http")).length, detail: "endpoint-reviewed servers" },
    { filter: "manual_manifest", label: "Manual manifests", value: applications.filter(isManualManifestApplication).length, detail: "operator-declared assets" },
    { filter: "blocked_probe", label: "Blocked probes", value: applications.filter(hasBlockedLiveProbe).length, detail: "needs live evidence" },
    { filter: "ready_mcp", label: "Ready MCP", value: applications.filter(hasReadyMcpSignal).length, detail: "confirmed or agent-backed" },
    { filter: "automation_attention", label: "Automation", value: applications.filter(hasAutomationAttention).length, detail: "schedules need attention" },
  ];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Fleet overview</h2>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Operational mix across wrappers, MCP transports, manual manifests, live probes, and scheduled automation.
          </p>
        </div>
        <Badge tone={activeFilter === "all" ? "neutral" : "success"}>{fleetFilterLabel(activeFilter)}</Badge>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric) => (
          <button
            key={metric.filter}
            type="button"
            className={cn(
              "min-w-0 rounded-md border border-border bg-muted/20 p-3 text-left transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              activeFilter === metric.filter && "border-primary/60 bg-primary/5",
            )}
            onClick={() => onFilter(metric.filter)}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium">{metric.label}</span>
              <Badge tone={fleetMetricTone(metric.value, metric.filter)}>{metric.value}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{metric.detail}</p>
          </button>
        ))}
      </div>
    </section>
  );
}

/** Registered applications and their governed capabilities (read-only slice). */
export function ApplicationsView() {
  const { data: state } = useConsoleState();
  const { execute, pending: ccusagePending, error: ccusageError } = useAsyncAction();
  const { execute: executeDoocs, pending: doocsPending, error: doocsError } = useAsyncAction();
  const selectedApplicationId = useUiStore((s) => s.selectedApplicationId);
  const setSelectedApplicationId = useUiStore((s) => s.setSelectedApplicationId);
  const setSelectedApplicationRun = useUiStore((s) => s.setSelectedApplicationRun);
  const setSelectedApplicationRecoveryId = useUiStore((s) => s.setSelectedApplicationRecoveryId);
  const setSelectedApplicationEventLevel = useUiStore((s) => s.setSelectedApplicationEventLevel);
  const setSelectedApplicationAutomationId = useUiStore((s) => s.setSelectedApplicationAutomationId);
  const belowXl = useBelowXlViewport();

  const [status, setStatus] = useState<"all" | ApplicationSnapshot["status"]>("all");
  const [kind, setKind] = useState<"all" | string>("all");
  const [triage, setTriage] = useState<ApplicationTriageFilter>("all");
  const [fleetFilter, setFleetFilter] = useState<FleetFilter>("all");
  const [search, setSearch] = useState("");
  const [registerOpen, setRegisterOpen] = useState(false);

  const all = state?.applications ?? [];
  const ccusageApplication = all.find((app) => app.id === CCUSAGE_APPLICATION_ID || (app.source.type === "npm" && app.source.package === "ccusage")) ?? null;
  const doocsApplication = all.find((app) =>
    app.id === DOOCS_MD_APPLICATION_ID ||
    app.name === "doocs/md" ||
    (app.source.type === "local" && /(?:^|[\\/])doocs-md$/i.test(app.source.path ?? ""))) ?? null;
  const recoveryActions = state?.applicationRecoveryActions ?? [];
  const projectName = useMemo(() => {
    const map = new Map((state?.projects ?? []).map((project) => [project.id, project.name]));
    return (id?: string | null) => (id ? map.get(id) ?? id : null);
  }, [state?.projects]);

  const kinds = useMemo(() => Array.from(new Set(all.map((app) => app.kind))).sort(), [all]);
  const scopedApplications = useMemo(
    () =>
      all.filter(
        (app) => (status === "all" || app.status === status)
          && (kind === "all" || app.kind === kind)
          && applicationMatchesFleetFilter(app, fleetFilter),
      ),
    [all, status, kind, fleetFilter],
  );
  const searchedApplications = useMemo(
    () => scopedApplications.filter((app) => applicationMatchesSearch(app, search)),
    [scopedApplications, search],
  );
  const triageCounts = useMemo(() => applicationTriageCounts(searchedApplications), [searchedApplications]);
  const applications = useMemo(
    () => sortApplicationsForTriage(
      searchedApplications.filter((app) => triage === "all" || applicationTriageBucket(app) === triage),
    ),
    [searchedApplications, triage],
  );

  useEffect(() => {
    if (typeof window === "undefined" || !all.length) return;
    const applicationId = new URLSearchParams(window.location.search).get("application")?.trim();
    if (!applicationId || selectedApplicationId === applicationId) return;
    if (all.some((app) => app.id === applicationId)) {
      setSelectedApplicationId(applicationId);
    }
  }, [all, selectedApplicationId, setSelectedApplicationId]);

  function selectApplication(applicationId: string, eventLevel: ApplicationEventLevelSelection = "all", automationId: string | null = null) {
    setSelectedApplicationId(applicationId);
    setSelectedApplicationRun(null);
    setSelectedApplicationRecoveryId(null);
    setSelectedApplicationEventLevel(eventLevel);
    setSelectedApplicationAutomationId(automationId);
  }

  function selectRecoveryRun(applicationId: string, routineId: string, invocationId: string, recoveryId: string | null = null) {
    setSelectedApplicationId(applicationId);
    setSelectedApplicationRun({ applicationId, routineId, invocationId });
    setSelectedApplicationRecoveryId(recoveryId);
    setSelectedApplicationEventLevel("all");
    setSelectedApplicationAutomationId(null);
  }

  async function registerOrOpenCcusage() {
    if (ccusageApplication) {
      selectApplication(ccusageApplication.id);
      return;
    }
    await execute(async () => {
      const result = await api.registerApplication(createCcusageApplicationRegistration());
      if (result.application?.id) {
        selectApplication(result.application.id);
      }
      return result;
    });
  }

  async function registerOrOpenDoocsMd() {
    if (doocsApplication) {
      selectApplication(doocsApplication.id);
      return;
    }
    await executeDoocs(async () => {
      const result = await api.registerApplication(createDoocsMdApplicationRegistration());
      const applicationId = result.application?.id;
      if (applicationId) {
        selectApplication(applicationId);
        await api.applicationLifecycle(applicationId, "probe");
      }
      return result;
    });
  }

  const ccusageActionLabel = ccusageApplication
    ? "Open ccusage"
    : ccusagePending
      ? "Registering ccusage..."
      : "Register built-in ccusage";
  const doocsActionLabel = doocsApplication
    ? "Open doocs/md"
    : doocsPending
      ? "Registering doocs/md..."
      : "Register doocs/md";

  return (
    <div className="max-w-full space-y-5 overflow-x-hidden">
      <SectionHeading
        eyebrow="Governed assets"
        title="Applications"
        description="Applications registered as governed assets from reviewed built-ins, local projects, npm wrappers, MCP descriptors, or manual manifests."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setRegisterOpen(true)}>
              <Settings2 />
              Advanced registration
            </Button>
          </div>
        }
      />
      {ccusageError ? <p className="text-xs text-destructive">{ccusageError}</p> : null}
      {doocsError ? <p className="text-xs text-destructive">{doocsError}</p> : null}

      <RegisterApplicationModal open={registerOpen} onClose={() => setRegisterOpen(false)} />

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Built-in Applications</h2>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Reviewed integrations are the default path today. They pin source metadata, wrapper policy, result imports, and operator recovery before becoming runnable.
            </p>
          </div>
          <Badge tone="success">Reviewed first</Badge>
        </div>
        <div className="grid min-w-0 gap-3 lg:grid-cols-3">
          <Card className="min-w-0">
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <CardTitle className="min-w-0 [overflow-wrap:anywhere]">ccusage</CardTitle>
                <Badge tone={ccusageApplication ? "success" : "neutral"}>
                  {ccusageApplication ? "Registered" : "Ready"}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">Pinned npm wrapper for offline usage reports and imported usage estimates.</p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                <Badge>npm</Badge>
                <Badge>read-only</Badge>
                <Badge>6 reports</Badge>
              </div>
              <Button size="sm" variant="secondary" disabled={ccusagePending} onClick={() => void registerOrOpenCcusage()}>
                <PackageCheck />
                {ccusageActionLabel}
              </Button>
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <CardTitle className="min-w-0 [overflow-wrap:anywhere]">doocs/md MCP</CardTitle>
                <Badge tone={doocsApplication ? "success" : "warning"}>
                  {doocsApplication ? "Registered" : "Template"}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">MCP-style Application path for rooted stdio servers, shared tools, live probe evidence, and result refs.</p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                <Badge>MCP</Badge>
                <Badge>local probe</Badge>
                <Badge>web editor</Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" disabled={doocsPending} onClick={() => void registerOrOpenDoocsMd()}>
                  <PackageCheck />
                  {doocsActionLabel}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRegisterOpen(true)}>
                  <Settings2 />
                  Advanced setup
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <CardTitle className="min-w-0 [overflow-wrap:anywhere]">Custom integration</CardTitle>
                <Badge tone="neutral">Planned assistant</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                The target flow is user-described integration plus Codex-generated descriptors, wrappers, probes, tests, and review notes.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                <Badge>git</Badge>
                <Badge>local</Badge>
                <Badge>npm</Badge>
                <Badge>manual</Badge>
              </div>
              <Button size="sm" onClick={() => setRegisterOpen(true)}>
                <Code2 />
                Start advanced registration
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      <ApplicationFleetOverview
        applications={all}
        activeFilter={fleetFilter}
        onFilter={setFleetFilter}
      />

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Search" className="w-full sm:w-64">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, id, source, path"
          />
        </Field>
        <Field label="Status" className="w-full sm:w-40">
          <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="registered">Registered</option>
            <option value="probing">Probing</option>
            <option value="offline">Offline</option>
            <option value="archived">Archived</option>
            <option value="failed">Failed</option>
          </Select>
        </Field>
        <Field label="Kind" className="w-full sm:w-44">
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="all">All kinds</option>
            {kinds.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Triage" className="w-full sm:w-48">
          <Select value={triage} onChange={(e) => setTriage(e.target.value as ApplicationTriageFilter)}>
            <option value="all">All triage states</option>
            <option value="attention">Needs attention</option>
            <option value="warning">Watch</option>
            <option value="ready">Ready</option>
          </Select>
        </Field>
        <div className="flex flex-wrap items-center gap-2 pb-2">
          <span className="text-xs text-muted-foreground">
            {applications.length} of {searchedApplications.length} application(s)
          </span>
          {triageCounts.attention ? <Badge tone="danger">{triageCounts.attention} attention</Badge> : null}
          {triageCounts.warning ? <Badge tone="warning">{triageCounts.warning} watch</Badge> : null}
          {triageCounts.ready ? <Badge tone="success">{triageCounts.ready} ready</Badge> : null}
        </div>
      </div>

      {!applications.length ? (
        <EmptyState
          title={all.length ? "No applications match these filters" : "No applications registered"}
          hint={
            all.length
              ? "Loosen the search, status, kind, or triage filter."
              : "Register an application (git, local, npm, or manual) to expose its governed capabilities."
          }
        />
      ) : (
        <div className="grid min-w-0 gap-4 xl:grid-cols-2">
          {applications.map((app) => {
            const nextStep = applicationNextStep(app);
            const latestRecoveryAction = app.healthSummary?.latestRecoveryAction ?? latestApplicationRecoveryAction(app.id, recoveryActions);
            const automationCounts = automationScheduleCounts(app);
            const attentionEventLevel: ApplicationEventLevelSelection | null = (app.healthSummary?.eventCounts.error ?? 0) > 0
              ? "error"
              : (app.healthSummary?.eventCounts.warning ?? 0) > 0
                ? "warning"
                : null;
            return (
              <Card
                key={app.id}
                onClick={() => selectApplication(app.id)}
                onFocusCapture={() => selectApplication(app.id)}
                tabIndex={0}
                className={cn(
                  "min-w-0 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selectedApplicationId === app.id && "border-primary/50",
                )}
              >
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <CardTitle className="min-w-0 [overflow-wrap:anywhere]">{app.name}</CardTitle>
                    <Badge tone={statusTone(app.status)}>{app.status}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {app.kind} · {app.source.type}
                  </p>
                </CardHeader>
                <CardContent className="min-w-0 space-y-3">
                  <p className="[overflow-wrap:anywhere] font-mono text-xs text-muted-foreground">
                    {sourceSummary(app.source)}
                  </p>
                  <div className="rounded-md border border-border bg-muted/40 p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={nextStep.tone}>{nextStep.title}</Badge>
                      {app.lifecycle?.lastOperation ? (
                        <span className="text-xs text-muted-foreground">Last: {app.lifecycle.lastOperation}</span>
                      ) : null}
                    </div>
                    <p className="mt-1 [overflow-wrap:anywhere] text-xs text-muted-foreground">{nextStep.detail}</p>
                    {attentionEventLevel ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mt-2 h-7 px-2 text-xs"
                        onClick={(event) => {
                          event.stopPropagation();
                          selectApplication(app.id, attentionEventLevel);
                        }}
                      >
                        {attentionEventLevel === "error" ? "View errors" : "View warnings"}
                      </Button>
                    ) : null}
                  </div>
                  {hasAutomationScheduleSignal(app) ? (
                    <div className="rounded-md border border-border bg-muted/40 p-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium">Schedules</span>
                        {automationCounts.failing > 0 ? (
                          <Badge tone="danger">{scheduleLabel(automationCounts.failing, "failing schedule")}</Badge>
                        ) : null}
                        {automationCounts.waitingForApproval > 0 ? (
                          <Badge tone="warning">{automationCounts.waitingForApproval} waiting approval</Badge>
                        ) : null}
                        {automationCounts.paused > 0 ? (
                          <Badge tone="neutral">{scheduleLabel(automationCounts.paused, "paused schedule")}</Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 [overflow-wrap:anywhere] text-xs text-muted-foreground">
                        {automationScheduleDetail(app)}
                      </p>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mt-2 h-7 px-2 text-xs"
                        onClick={(event) => {
                          event.stopPropagation();
                          selectApplication(app.id, "all", app.healthSummary?.latestAutomationAttention?.automationId ?? null);
                        }}
                      >
                        <CalendarClock />
                        {applicationScheduleButtonLabel(app)}
                      </Button>
                    </div>
                  ) : null}
                  {latestRecoveryAction ? (
                    <div className="rounded-md border border-border bg-muted/40 p-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium">Latest recovery</span>
                        <Badge tone={recoveryActionRequestTone(latestRecoveryAction.status)}>
                          {readableRecoveryActionRequestStatus(latestRecoveryAction.status)}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{readableRecoveryActionType(latestRecoveryAction.actionType)}</span>
                        {latestRecoveryAction.recoveryCategory ? (
                          <span className="text-xs text-muted-foreground">{latestRecoveryAction.recoveryCategory}</span>
                        ) : null}
                        {latestRecoveryAction.outcome?.state ? (
                          <Badge tone={recoveryOutcomeTone(latestRecoveryAction.outcome.state)}>
                            {readableRecoveryOutcome(latestRecoveryAction.outcome.state)}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 [overflow-wrap:anywhere] text-xs text-muted-foreground">
                        {latestRecoveryAction.explanation?.nextStep
                          ?? latestRecoveryAction.outcome?.nextStep
                          ?? latestRecoveryAction.outcome?.summary
                          ?? latestRecoveryAction.reason
                          ?? "Open diagnostics to inspect the latest recovery action."}
                      </p>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mt-2 h-7 px-2 text-xs"
                        onClick={(event) => {
                          event.stopPropagation();
                          selectRecoveryRun(app.id, latestRecoveryAction.routineId, latestRecoveryAction.invocationId, latestRecoveryAction.id);
                        }}
                      >
                        View recovery
                      </Button>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-1.5">
                    {projectName(app.projectId) ? <Badge>{projectName(app.projectId)}</Badge> : null}
                    {app.probe?.capabilities?.length ? (
                      <Badge>{app.probe.capabilities.length} probed capabilities</Badge>
                    ) : null}
                    {app.orchestrationIds?.length ? (
                      <Badge>{app.orchestrationIds.length} orchestration(s)</Badge>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {belowXl && selectedApplicationId ? (
        <div className="min-w-0 max-w-full overflow-x-hidden">
          <ApplicationsInspector />
        </div>
      ) : null}
    </div>
  );
}
