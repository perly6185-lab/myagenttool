import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { EmptyState } from "@/components/common/empty-state";
import { SectionHeading } from "@/components/common/section-heading";
import { DesktopHandoffLink } from "@/components/common/desktop-handoff";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/cn";
import type {
  ProjectSnapshot,
  ToolDescriptor,
  ToolInvocationRequest,
  WorktreeSnapshot,
} from "@/lib/console-state";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { QUERY_POLLING, visiblePolling } from "@/lib/query-polling";

const TOOLS_KEY = ["tools"] as const;

function riskTone(risk: string | undefined): "neutral" | "warning" | "danger" {
  if (risk === "high") return "danger";
  if (risk === "medium") return "warning";
  return "neutral";
}

/** Governed tool registry: discover /api/tools and run a bounded invocation. */
export function ToolsView() {
  const { t, i18n } = useAppTranslation();
  const { data: state } = useConsoleState();
  const selectedToolName = useUiStore((s) => s.selectedToolName);
  const setSelectedToolName = useUiStore((s) => s.setSelectedToolName);

  const { data, isLoading, error } = useQuery({
    queryKey: TOOLS_KEY,
    queryFn: () => api.listTools(),
    refetchInterval: () => visiblePolling(QUERY_POLLING.activeOperation),
  });

  const tools = data?.tools ?? [];
  const worktrees = state?.worktrees ?? [];
  const projects = state?.projects ?? [];
  const deviceOnline = state?.device?.status === "online";

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow={t("toolsPage.governed")}
        title={t("toolsPage.title")}
        description={t("toolsPage.description")}
      />

      {!deviceOnline ? <div className="flex flex-wrap items-center gap-2"><p className="text-xs text-warning">{t("toolsPage.bridgeRequired")}</p><DesktopHandoffLink section="tools" action="open-desktop-page" compact>{i18n.resolvedLanguage?.startsWith("zh") ? "打开桌面版" : "Open desktop"}</DesktopHandoffLink></div> : null}

      {error ? (
        <EmptyState title={t("toolsPage.loadFailed")} hint={error instanceof Error ? error.message : t("toolsPage.requestFailed")} />
      ) : !tools.length ? (
        <EmptyState
          title={isLoading ? t("toolsPage.loading") : t("toolsPage.empty")}
          hint={isLoading ? undefined : t("toolsPage.emptyHint")}
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {tools.map((tool) => (
            <ToolCard
              key={tool.name}
              tool={tool}
              worktrees={worktrees}
              projects={projects}
              deviceOnline={deviceOnline}
              selected={selectedToolName === tool.name}
              onSelect={() => setSelectedToolName(tool.name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolCard({
  tool,
  worktrees,
  projects,
  deviceOnline,
  selected,
  onSelect,
}: {
  tool: ToolDescriptor;
  worktrees: WorktreeSnapshot[];
  projects: ProjectSnapshot[];
  deviceOnline: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useAppTranslation();
  const isReview = tool.name === "codex.review.diff" || tool.name === "claude.review.diff";
  const isCcusage = tool.name === "ccusage.report";
  const disabledAgents = (tool.agents ?? []).every((agent) => agent.status === "disabled");
  const noAgents = !(tool.agents ?? []).length;

  return (
    <Card
      onClick={onSelect}
      onFocusCapture={onSelect}
      className={cn("cursor-pointer transition-colors", selected && "border-primary/50")}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle>{tool.displayName}</CardTitle>
          <span className="text-xs text-muted-foreground">v{tool.version}</span>
        </div>
        {tool.description ? (
          <p className="text-sm text-muted-foreground">{tool.description}</p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={riskTone(tool.riskLevel)}>{t("toolsPage.risk")}: {t(`labels.risk.${tool.riskLevel ?? "unknown"}` as never, { defaultValue: tool.riskLevel ?? t("toolsPage.unknown") })}</Badge>
          {tool.requiresLocalDevice ? <Badge>{t("toolsPage.localDevice")}</Badge> : null}
          {tool.authoritativeBilling === false ? <Badge>{t("toolsPage.nonAuthoritative")}</Badge> : null}
          {(tool.riskTags ?? []).map((tag) => (
            <Badge key={tag}>{tag}</Badge>
          ))}
        </div>

        {noAgents ? (
          <p className="text-xs text-warning">{t("toolsPage.noAgent")}</p>
        ) : disabledAgents ? (
          <p className="text-xs text-warning">{t("toolsPage.agentsDisabled")}</p>
        ) : null}

        {isCcusage ? (
          <CcusageForm tool={tool} disabled={!deviceOnline || noAgents || disabledAgents} />
        ) : isReview ? (
          <ReviewForm
            tool={tool}
            worktrees={worktrees}
            projects={projects}
            disabled={!deviceOnline || noAgents || disabledAgents}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("toolsPage.noForm")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Shared success/error surface + "view invocation" jump for both forms. */
function useToolInvoke() {
  const setSelectedInvocationId = useUiStore((s) => s.setSelectedInvocationId);
  const setSection = useUiStore((s) => s.setSection);
  const { execute, pending, error } = useAsyncAction();
  const [invocationId, setInvocationId] = useState<string | null>(null);

  async function invoke(name: string, input: ToolInvocationRequest) {
    setInvocationId(null);
    await execute(async () => {
      const result = await api.createToolInvocation(name, input);
      setInvocationId(result.invocationId);
      return result;
    });
  }

  function viewInvocation() {
    if (!invocationId) return;
    setSelectedInvocationId(invocationId);
    setSection("invocations");
  }

  return { invoke, viewInvocation, invocationId, pending, error };
}

function ResultNote({
  invocationId,
  error,
  outputCollection,
  onView,
}: {
  invocationId: string | null;
  error: string | null;
  outputCollection?: string;
  onView: () => void;
}) {
  const { t } = useAppTranslation();
  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!invocationId) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span className="text-success">{t("toolsPage.invocationCreated")}</span>
      {outputCollection ? <span>{t("toolsPage.importsInto", { collection: outputCollection })}</span> : null}
      <button type="button" className="font-medium text-primary hover:underline" onClick={onView}>
        {t("toolsPage.viewInvocation")} →
      </button>
    </div>
  );
}

/**
 * Sources the backend accepts for a report: a provider-specific source is only
 * valid for a matching provider report (source_report_mismatch otherwise).
 */
export function ccusageSourcesFor(report: string): Array<"all" | "codex" | "claude"> {
  const sources: Array<"all" | "codex" | "claude"> = ["all"];
  if (report.startsWith("codex_")) sources.push("codex");
  if (report.startsWith("claude_")) sources.push("claude");
  return sources;
}

function CcusageForm({ tool, disabled }: { tool: ToolDescriptor; disabled: boolean }) {
  const { t } = useAppTranslation();
  const reportOptions = useMemo(() => {
    // Drop approval-required reports (e.g. session) — they always 409 here.
    const policy = tool.approvalPolicy ?? {};
    const fromAgents = (tool.agents ?? [])
      .map((agent) => agent.report)
      .filter((r): r is string => Boolean(r))
      .filter((r) => policy[r] !== "approval_required");
    return fromAgents.length ? Array.from(new Set(fromAgents)) : ["daily"];
  }, [tool.agents, tool.approvalPolicy]);

  const [report, setReport] = useState(reportOptions[0]);
  const [source, setSource] = useState<"all" | "codex" | "claude">("all");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const { invoke, viewInvocation, invocationId, pending, error } = useToolInvoke();

  // Keep the selection valid as discovered options load/change after mount.
  useEffect(() => {
    if (!reportOptions.includes(report)) setReport(reportOptions[0]);
  }, [reportOptions, report]);

  const sourceOptions = useMemo(() => ccusageSourcesFor(report), [report]);
  useEffect(() => {
    if (!sourceOptions.includes(source)) setSource("all");
  }, [sourceOptions, source]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    void invoke(tool.name, {
      report,
      source,
      since: since || null,
      until: until || null,
      offline: true,
    });
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("toolsPage.report")}>
          <Select value={report} onChange={(e) => setReport(e.target.value)}>
            {reportOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("toolsPage.source")}>
          <Select value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
            {sourceOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("toolsPage.since")}>
          <Input value={since} onChange={(e) => setSince(e.target.value)} placeholder={t("toolsPage.optional")} />
        </Field>
        <Field label={t("toolsPage.until")}>
          <Input value={until} onChange={(e) => setUntil(e.target.value)} placeholder={t("toolsPage.optional")} />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("toolsPage.offlineOnly")}
      </p>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={disabled || pending}>
          {t(pending ? "toolsPage.running" : "toolsPage.runReport")}
        </Button>
        <ResultNote
          invocationId={invocationId}
          error={error}
          outputCollection={tool.outputCollection}
          onView={viewInvocation}
        />
      </div>
    </form>
  );
}

function ReviewForm({
  tool,
  worktrees,
  projects,
  disabled,
}: {
  tool: ToolDescriptor;
  worktrees: WorktreeSnapshot[];
  projects: ProjectSnapshot[];
  disabled: boolean;
}) {
  const { t } = useAppTranslation();
  const projectName = useMemo(() => {
    const map = new Map(projects.map((project) => [project.id, project.name]));
    return (id: string) => map.get(id) ?? id;
  }, [projects]);

  const [worktreeId, setWorktreeId] = useState(worktrees[0]?.id ?? "");
  const [severityFloor, setSeverityFloor] = useState<"low" | "medium" | "high">("low");
  const [instruction, setInstruction] = useState("");
  const { invoke, viewInvocation, invocationId, pending, error } = useToolInvoke();

  // Worktrees arrive from a different query than the one that mounts this form;
  // re-sync the selection once they load (or if the chosen one disappears).
  useEffect(() => {
    if (!worktrees.some((worktree) => worktree.id === worktreeId)) {
      setWorktreeId(worktrees[0]?.id ?? "");
    }
  }, [worktrees, worktreeId]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const worktree = worktrees.find((item) => item.id === worktreeId);
    if (!worktree) return;
    // Send the worktree's own project so the backend doesn't reject it against
    // the actor's default project (worktree_not_found).
    void invoke(tool.name, {
      projectId: worktree.projectId,
      worktreeId,
      severityFloor,
      instruction: instruction.trim() || null,
    });
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("toolsPage.worktree")}>
          <Select value={worktreeId} onChange={(e) => setWorktreeId(e.target.value)}>
            {!worktrees.length ? <option value="">{t("toolsPage.noWorktrees")}</option> : null}
            {worktrees.map((worktree) => (
              <option key={worktree.id} value={worktree.id}>
                {worktree.branch} · {projectName(worktree.projectId)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("toolsPage.severity")}>
          <Select
            value={severityFloor}
            onChange={(e) => setSeverityFloor(e.target.value as typeof severityFloor)}
          >
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </Select>
        </Field>
      </div>
      <Field label={t("toolsPage.instruction")}>
        <Textarea
          value={instruction}
          maxLength={1200}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder={t("toolsPage.instructionPlaceholder")}
        />
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={disabled || pending || !worktreeId}>
          {t(pending ? "toolsPage.starting" : "toolsPage.runReview")}
        </Button>
        <ResultNote
          invocationId={invocationId}
          error={error}
          outputCollection={tool.outputCollection}
          onView={viewInvocation}
        />
      </div>
    </form>
  );
}
