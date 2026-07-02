import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { EmptyState } from "@/components/common/empty-state";
import { SectionHeading } from "@/components/common/section-heading";
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

const TOOLS_KEY = ["tools"] as const;

function riskTone(risk: string | undefined): "neutral" | "warning" | "danger" {
  if (risk === "high") return "danger";
  if (risk === "medium") return "warning";
  return "neutral";
}

/** Governed tool registry: discover /api/tools and run a bounded invocation. */
export function ToolsView() {
  const { data: state } = useConsoleState();
  const selectedToolName = useUiStore((s) => s.selectedToolName);
  const setSelectedToolName = useUiStore((s) => s.setSelectedToolName);

  const { data, isLoading, error } = useQuery({
    queryKey: TOOLS_KEY,
    queryFn: () => api.listTools(),
    refetchInterval: 2000,
  });

  const tools = data?.tools ?? [];
  const worktrees = state?.worktrees ?? [];
  const projects = state?.projects ?? [];
  const deviceOnline = state?.device?.status === "online";

  return (
    <div className="space-y-5">
      <SectionHeading
        eyebrow="Governed"
        title="Tools"
        description="Discover the governed tools this control plane exposes and run a bounded invocation. Raw wrapper commands stay server-side."
      />

      {!deviceOnline ? (
        <p className="text-xs text-warning">
          These tools run on the local device — start Desktop Bridge to bring it online before invoking.
        </p>
      ) : null}

      {error ? (
        <EmptyState title="Could not load tools" hint={error instanceof Error ? error.message : "Request failed."} />
      ) : !tools.length ? (
        <EmptyState
          title={isLoading ? "Loading tools…" : "No governed tools available"}
          hint={isLoading ? undefined : "Register a governed ccusage or diff-review agent to expose a tool."}
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
  const isReview = tool.name === "codex.review.diff" || tool.name === "claude.review.diff";
  const isCcusage = tool.name === "ccusage.report";
  const disabledAgents = (tool.agents ?? []).every((agent) => agent.status === "disabled");
  const noAgents = !(tool.agents ?? []).length;

  return (
    <Card
      onClick={onSelect}
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
          <Badge tone={riskTone(tool.riskLevel)}>Risk: {tool.riskLevel ?? "unknown"}</Badge>
          {tool.requiresLocalDevice ? <Badge>Local device</Badge> : null}
          {tool.authoritativeBilling === false ? <Badge>Non-authoritative billing</Badge> : null}
          {(tool.riskTags ?? []).map((tag) => (
            <Badge key={tag}>{tag}</Badge>
          ))}
        </div>

        {noAgents ? (
          <p className="text-xs text-warning">No backing agent is registered for this tool.</p>
        ) : disabledAgents ? (
          <p className="text-xs text-warning">Every backing agent is disabled.</p>
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
            This tool has no console invoke form yet. Select it to inspect its schema.
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
  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!invocationId) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span className="text-success">Invocation created.</span>
      {outputCollection ? <span>Results import into {outputCollection}.</span> : null}
      <button type="button" className="font-medium text-primary hover:underline" onClick={onView}>
        View invocation →
      </button>
    </div>
  );
}

function CcusageForm({ tool, disabled }: { tool: ToolDescriptor; disabled: boolean }) {
  const reportOptions = useMemo(() => {
    const fromAgents = (tool.agents ?? []).map((agent) => agent.report).filter((r): r is string => Boolean(r));
    return fromAgents.length ? Array.from(new Set(fromAgents)) : ["daily"];
  }, [tool.agents]);

  const [report, setReport] = useState(reportOptions[0]);
  const [source, setSource] = useState<"all" | "codex" | "claude">("all");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const { invoke, viewInvocation, invocationId, pending, error } = useToolInvoke();

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
    <form className="space-y-3" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Report">
          <Select value={report} onChange={(e) => setReport(e.target.value)}>
            {reportOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Source">
          <Select value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
            <option value="all">all</option>
            <option value="codex">codex</option>
            <option value="claude">claude</option>
          </Select>
        </Field>
        <Field label="Since (YYYY-MM-DD)">
          <Input value={since} onChange={(e) => setSince(e.target.value)} placeholder="optional" />
        </Field>
        <Field label="Until (YYYY-MM-DD)">
          <Input value={until} onChange={(e) => setUntil(e.target.value)} placeholder="optional" />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">
        Offline mode only — online and session reports require explicit approval.
      </p>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={disabled || pending}>
          {pending ? "Running…" : "Run report"}
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
  const projectName = useMemo(() => {
    const map = new Map(projects.map((project) => [project.id, project.name]));
    return (id: string) => map.get(id) ?? id;
  }, [projects]);

  const [worktreeId, setWorktreeId] = useState(worktrees[0]?.id ?? "");
  const [severityFloor, setSeverityFloor] = useState<"low" | "medium" | "high">("low");
  const [instruction, setInstruction] = useState("");
  const { invoke, viewInvocation, invocationId, pending, error } = useToolInvoke();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!worktreeId) return;
    void invoke(tool.name, {
      worktreeId,
      severityFloor,
      instruction: instruction.trim() || null,
    });
  }

  return (
    <form className="space-y-3" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Worktree">
          <Select value={worktreeId} onChange={(e) => setWorktreeId(e.target.value)}>
            {!worktrees.length ? <option value="">No worktrees available</option> : null}
            {worktrees.map((worktree) => (
              <option key={worktree.id} value={worktree.id}>
                {worktree.branch} · {projectName(worktree.projectId)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Severity floor">
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
      <Field label="Instruction (optional)">
        <Textarea
          value={instruction}
          maxLength={1200}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="Focus areas for the reviewer…"
        />
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={disabled || pending || !worktreeId}>
          {pending ? "Starting…" : "Run review"}
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
