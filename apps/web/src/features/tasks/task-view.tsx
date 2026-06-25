import { useEffect, useMemo, useState } from "react";
import { RefreshCw, ExternalLink, GitBranch, Workflow } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/common/empty-state";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { useUiStore } from "@/store/ui-store";
import { slugifyTitle, worktreeLinkFor } from "@/features/projects/worktree-payload";
import { cn } from "@/lib/cn";
import { readableStatus, statusTone } from "@/lib/readable-labels";

type GithubItem = {
  type: "issue" | "pr";
  number: number;
  title: string;
  headRefName: string | null;
  author: string;
  url: string | null;
  state: string;
};
type GithubResult = { available: boolean; message: string; items: GithubItem[] };
// Each row also carries which project it came from (for the "All projects" view).
type Row = GithubItem & { projectId: string; projectName: string };

const TABS: [GithubItem["type"], string][] = [
  ["issue", "Issues"],
  ["pr", "PRs"],
];

// Task = GitHub issues/PRs across repo-backed projects, surfaced as work items.
// Mirrors the project's existing per-worktree GitHub list, lifted to a top-level
// board with project/type/search filters.
export function TaskView() {
  const { data: state } = useConsoleState();
  const { execute, pending } = useAsyncAction();
  const setSection = useUiStore((s) => s.setSection);
  const setSelectedProjectId = useUiStore((s) => s.setSelectedProjectId);
  const setSelectedWorktreeId = useUiStore((s) => s.setSelectedWorktreeId);
  const worktrees = state?.worktrees ?? [];
  const invocations = state?.invocations ?? [];
  const [wtRow, setWtRow] = useState<Row | null>(null);
  const projects = useMemo(
    () => (state?.projects ?? []).filter((p) => p.status !== "archived"),
    [state?.projects],
  );

  // Index once instead of scanning per row: a worktree by its linked item, and a
  // worktree's newest run (invocations are newest-first, so the first wins).
  const worktreeByLink = useMemo(() => {
    const map = new Map<string, (typeof worktrees)[number]>();
    for (const w of worktrees) if (w.link) map.set(`${w.projectId}:${w.link.type}:${w.link.number}`, w);
    return map;
  }, [worktrees]);
  const latestRunByWorktree = useMemo(() => {
    const map = new Map<string, (typeof invocations)[number]>();
    for (const i of invocations) if (i.worktreeId && !map.has(i.worktreeId)) map.set(i.worktreeId, i);
    return map;
  }, [invocations]);
  // A worktree already linked to this item (so the row offers "Open" not "Create").
  function linkedWorktree(row: Row) {
    return worktreeByLink.get(`${row.projectId}:${row.type}:${row.number}`) ?? null;
  }
  // The newest run in a worktree, for its status badge.
  function latestRun(worktreeId: string) {
    return latestRunByWorktree.get(worktreeId) ?? null;
  }
  function openWorktree(worktreeId: string, projectId: string) {
    setSelectedProjectId(projectId);
    setSelectedWorktreeId(worktreeId);
    setSection("projects");
  }
  // Create a paused automation scoped to this item; the user lands on it to tune.
  function automateIssue(row: Row) {
    const kindLabel = row.type === "pr" ? "PR" : "Issue";
    void execute(async () => {
      const r = await api.createAutomation({
        name: `${kindLabel} #${row.number}: ${row.title}`.slice(0, 80),
        projectId: row.projectId,
        branch: "main",
        schedule: { kind: "weekdays", time: "09:00" },
        enabled: false,
        prompt: `Make progress on GitHub ${kindLabel} #${row.number}: ${row.title}.${row.url ? `\n${row.url}` : ""}\nReview the latest state, do the next useful step, and summarize what changed.`,
      });
      setSection("automation");
      return r;
    });
  }
  const repoProjectIds = useMemo(
    () => new Set((state?.projectTargets ?? []).filter((t) => t.state === "ready").map((t) => t.projectId)),
    [state?.projectTargets],
  );
  // Only projects with a ready repository can have GitHub items.
  const repoProjects = useMemo(() => projects.filter((p) => repoProjectIds.has(p.id)), [projects, repoProjectIds]);

  const [projectId, setProjectId] = useState<string>("all");
  const [tab, setTab] = useState<GithubItem["type"]>("issue");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const targetProjects = projectId === "all" ? repoProjects : repoProjects.filter((p) => p.id === projectId);

  useEffect(() => {
    let cancelled = false;
    if (targetProjects.length === 0) {
      setRows([]);
      setNotice(repoProjects.length === 0 ? "No repo-backed project. Clone or link a GitHub repo first." : null);
      return;
    }
    setLoading(true);
    setNotice(null);
    Promise.all(
      targetProjects.map((p) =>
        (api.listGithubItems(p.id) as Promise<GithubResult>)
          .then((r) => ({ p, r }))
          .catch(() => ({ p, r: { available: false, message: "Request failed.", items: [] } as GithubResult })),
      ),
    ).then((results) => {
      if (cancelled) return;
      const next: Row[] = [];
      const unavailable: string[] = [];
      for (const { p, r } of results) {
        if (!r.available) unavailable.push(`${p.name}: ${r.message}`);
        for (const item of r.items) next.push({ ...item, projectId: p.id, projectName: p.name });
      }
      next.sort((a, b) => b.number - a.number);
      setRows(next);
      setNotice(next.length === 0 && unavailable.length > 0 ? unavailable.join(" · ") : null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, repoProjects.length, nonce]);

  const visible = rows
    .filter((r) => r.type === tab)
    .filter((r) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return r.title.toLowerCase().includes(q) || String(r.number).includes(q) || r.projectName.toLowerCase().includes(q);
    });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Tasks</CardTitle>
            <p className="text-sm text-muted-foreground">GitHub issues and pull requests across your repo-backed projects.</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={loading}
            onClick={() => setNonce((n) => n + 1)}
            title="Refresh"
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Type tabs */}
          <div className="flex gap-1 rounded-lg bg-muted p-0.5 text-xs">
            {TABS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  "rounded-md px-3 py-1.5 font-medium transition",
                  tab === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
                {rows.filter((r) => r.type === key).length > 0 ? (
                  <span className="ml-1.5 text-muted-foreground">{rows.filter((r) => r.type === key).length}</span>
                ) : null}
              </button>
            ))}
          </div>
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project" className="h-8 w-auto text-xs">
            <option value="all">All projects</option>
            {repoProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, #number, project"
            aria-label="Search tasks"
            className="h-8 max-w-xs text-xs"
          />
        </div>

        {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}

        {visible.length === 0 ? (
          <EmptyState
            title={loading ? "Loading…" : `No open ${tab === "pr" ? "pull requests" : "issues"}`}
            hint={loading ? "Fetching from GitHub via gh." : "Nothing matches the current filters."}
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">ID</th>
                  <th className="px-3 py-2 font-medium">Title / context</th>
                  <th className="px-3 py-2 font-medium">Author</th>
                  <th className="px-3 py-2 font-medium">State</th>
                  <th className="px-3 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={`${r.projectId}:${r.type}:${r.number}`} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">#{r.number}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.title}</div>
                      <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                        <span>{r.projectName}</span>
                        {r.headRefName ? <span className="font-mono">· {r.headRefName}</span> : null}
                        {(() => {
                          const wt = linkedWorktree(r);
                          if (!wt) return null;
                          const run = latestRun(wt.id);
                          return (
                            <span className="inline-flex items-center gap-1">
                              <GitBranch className="size-3 opacity-70" />
                              <span className="font-mono">{wt.branch}</span>
                              {run ? <Badge tone={statusTone(run.status)}>{readableStatus(run.status)}</Badge> : null}
                            </span>
                          );
                        })()}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{r.author || "—"}</td>
                    <td className="px-3 py-2">
                      <Badge tone={r.state === "open" ? "success" : r.state === "merged" ? "neutral" : "warning"}>{r.state}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="secondary" size="sm" disabled={pending} onClick={() => automateIssue(r)} title="Create an automation for this item">
                          <Workflow className="mr-1 size-3.5" /> Automate
                        </Button>
                        {(() => {
                          const wt = linkedWorktree(r);
                          return wt ? (
                            <Button variant="secondary" size="sm" onClick={() => openWorktree(wt.id, r.projectId)} title={`Open worktree ${wt.branch}`}>
                              <GitBranch className="mr-1 size-3.5" /> Open
                            </Button>
                          ) : (
                            <Button variant="secondary" size="sm" disabled={pending} onClick={() => setWtRow(r)} title="Create a worktree for this item">
                              <GitBranch className="mr-1 size-3.5" /> Worktree
                            </Button>
                          );
                        })()}
                        {r.url ? (
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-grid size-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                            title="Open on GitHub"
                          >
                            <ExternalLink className="size-4" />
                          </a>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <Modal open={Boolean(wtRow)} onClose={() => setWtRow(null)} title={wtRow ? `Worktree for #${wtRow.number}` : "Worktree"}>
        {wtRow ? (
          <WorktreeOptionsForm
            row={wtRow}
            onDone={(wt) => {
              setWtRow(null);
              if (wt) openWorktree(wt.id, wt.projectId);
            }}
          />
        ) : null}
      </Modal>
    </Card>
  );
}

// Worktree-creation options for a Task item: branch name (smart-suggested for an
// issue), base branch, and agent. A PR checks out its own branch, so only the
// agent is offered.
function WorktreeOptionsForm({ row, onDone }: { row: Row; onDone: (wt: { id: string; projectId: string } | null) => void }) {
  const { data: state } = useConsoleState();
  const { execute, pending, error } = useAsyncAction();
  const agents = state?.agents ?? [];
  const isPr = row.type === "pr";

  const [branch, setBranch] = useState(branchFromIssue(row));
  const [base, setBase] = useState("main");
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [suggesting, setSuggesting] = useState(false);

  async function suggest() {
    setSuggesting(true);
    try {
      const r = (await api.suggestWorktreeName(row.title)) as { name?: string };
      if (r.name) setBranch(r.name);
    } catch {
      /* keep the slug fallback */
    }
    setSuggesting(false);
  }

  function create() {
    const link = worktreeLinkFor(row);
    const payload = isPr
      ? { prNumber: row.number, agentId: agentId || undefined, link }
      : { name: branch.trim() || branchFromIssue(row), startPoint: base.trim() || undefined, agentId: agentId || undefined, link };
    void execute(async () => {
      const r = (await api.createWorktree(row.projectId, payload)) as { worktree?: { id: string; projectId: string } };
      onDone(r.worktree ?? null);
      return r;
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {isPr ? (
          <>Checks out PR #{row.number}{row.headRefName ? <> (<span className="font-mono">{row.headRefName}</span>)</> : null}.</>
        ) : (
          <>Creates a new branch for issue #{row.number} and links it.</>
        )}
      </p>
      {!isPr ? (
        <>
          <Field label="Branch name">
            <div className="flex gap-2">
              <Input value={branch} onChange={(e) => setBranch(e.target.value)} className="font-mono" />
              <Button variant="secondary" size="sm" disabled={suggesting} onClick={suggest} title="Suggest a name">
                Suggest
              </Button>
            </div>
          </Field>
          <Field label="Base branch">
            <Input value={base} onChange={(e) => setBase(e.target.value)} className="font-mono" placeholder="main" />
          </Field>
        </>
      ) : null}
      <Field label="Agent">
        <Select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="secondary" size="sm" disabled={pending} onClick={() => onDone(null)}>
          Cancel
        </Button>
        <Button size="sm" disabled={pending} onClick={create}>
          Create worktree
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

// Branch name for a new worktree off an issue: issue-<n>-<slugified title>.
function branchFromIssue(row: Row): string {
  return `issue-${row.number}-${slugifyTitle(row.title)}`;
}
