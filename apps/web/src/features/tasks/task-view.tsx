import { useEffect, useMemo, useState } from "react";
import { Hand, History, RefreshCw, ExternalLink, GitBranch, Workflow, Zap } from "lucide-react";
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
import { cn } from "@/lib/cn";
import { statusTone } from "@/lib/readable-labels";
import { invocationStatus } from "@/lib/i18n/readable-labels";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import type { IssueClaimEvent } from "@/lib/console-state";
import { branchFromIssue, worktreeLinkFor } from "@/features/projects/worktree-payload";
import { githubItemKindLabel, worktreeAutoRunPrompt } from "@myagenttool/protocol/issue-prompt";

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

const TABS: GithubItem["type"][] = ["issue", "pr"];

// Task = GitHub issues/PRs across repo-backed projects, surfaced as work items.
// Mirrors the project's existing per-worktree GitHub list, lifted to a top-level
// board with project/type/search filters.
export function TaskView() {
  const { t } = useAppTranslation();
  const { data: state } = useConsoleState();
  const { execute, pending, error } = useAsyncAction();
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

  // A worktree already linked to this item (so the row offers "Open" not "Create").
  function linkedWorktree(row: Row) {
    return worktrees.find((w) => w.projectId === row.projectId && w.link?.type === row.type && w.link?.number === row.number) ?? null;
  }
  // #1143: the issue's active, unexpired claim (develop lease preferred) — the
  // pool signal: who holds this issue right now.
  const issueClaims = state?.issueClaims ?? [];
  function activeClaim(row: Row) {
    const nowMs = Date.now();
    const live = issueClaims.filter(
      (c) =>
        c.projectId === row.projectId &&
        c.issueNumber === row.number &&
        c.status === "active" &&
        (!c.leaseExpiresAt || Date.parse(c.leaseExpiresAt) > nowMs),
    );
    return live.find((c) => c.mode === "develop") ?? live[0] ?? null;
  }
  // Claim/release are advisory-fast: the 700ms state poll reflects the result,
  // and a 409 (someone else holds the develop lease) surfaces on the error line.
  function claimIssueRow(row: Row) {
    void execute(() => api.claimIssue(row.projectId, { issueNumber: row.number }));
  }
  function releaseClaimRow(claimId: string) {
    void execute(() => api.releaseIssueClaim(claimId));
  }
  // #1163: the issue's durable claim history (#1152's issueClaimEvents — who
  // held it and how each hold ended). Server rows are newest-first already.
  const issueClaimEvents = state?.issueClaimEvents ?? [];
  const [historyRow, setHistoryRow] = useState<Row | null>(null);
  function claimHistory(row: Row) {
    return issueClaimEvents.filter((e) => e.projectId === row.projectId && e.issueNumber === row.number);
  }
  // The newest run in a worktree (invocations are newest-first) for its status.
  function latestRun(worktreeId: string) {
    return invocations.find((i) => i.worktreeId === worktreeId) ?? null;
  }
  function openWorktree(worktreeId: string, projectId: string) {
    setSelectedProjectId(projectId);
    setSelectedWorktreeId(worktreeId);
    setSection("projects");
  }
  // One-click Auto: materialize a worktree from the item and start an
  // issue-seeded agent run in it, then jump into that worktree. Merge stays human.
  function autoRunIssue(row: Row) {
    void execute(async () => {
      const r = (await api.startAutoRun(row.projectId, {
        link: worktreeLinkFor(row),
        name: branchFromIssue(row),
      })) as { worktree?: { id: string } };
      if (r.worktree?.id) openWorktree(r.worktree.id, row.projectId);
      return r;
    });
  }
  // Create a paused automation scoped to this item; the user lands on it to tune.
  function automateIssue(row: Row) {
    const kindLabel = githubItemKindLabel(row.type);
    void execute(async () => {
      const r = await api.createAutomation({
        name: `${kindLabel} #${row.number}: ${row.title}`.slice(0, 80),
        projectId: row.projectId,
        branch: "main",
        schedule: { kind: "weekdays", time: "09:00" },
        enabled: false,
        prompt: worktreeAutoRunPrompt({ type: row.type, number: row.number, title: row.title, url: row.url }),
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
      setNotice(repoProjects.length === 0 ? t("tasks.noRepoProject") : null);
      return;
    }
    setLoading(true);
    setNotice(null);
    Promise.all(
      targetProjects.map((p) =>
        (api.listGithubItems(p.id) as Promise<GithubResult>)
          .then((r) => ({ p, r }))
          .catch(() => ({ p, r: { available: false, message: t("tasks.requestFailed"), items: [] } as GithubResult })),
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
            <CardTitle>{t("tasks.title")}</CardTitle>
            <p className="text-sm text-muted-foreground">{t("tasks.description")}</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={loading}
            onClick={() => setNonce((n) => n + 1)}
            title={t("tasks.refresh")}
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Type tabs */}
          <div className="flex gap-1 rounded-lg bg-muted p-0.5 text-xs">
            {TABS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  "rounded-md px-3 py-1.5 font-medium transition",
                  tab === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(key === "issue" ? "tasks.issues" : "tasks.prs")}
                {rows.filter((r) => r.type === key).length > 0 ? (
                  <span className="ml-1.5 text-muted-foreground">{rows.filter((r) => r.type === key).length}</span>
                ) : null}
              </button>
            ))}
          </div>
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label={t("tasks.project")} className="h-8 w-auto text-xs">
            <option value="all">{t("tasks.allProjects")}</option>
            {repoProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("tasks.searchPlaceholder")}
            aria-label={t("tasks.search")}
            className="h-8 max-w-xs text-xs"
          />
        </div>

        {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}

        {visible.length === 0 ? (
          <EmptyState
            title={loading ? t("tasks.loading") : t(tab === "pr" ? "tasks.noPrs" : "tasks.noIssues")}
            hint={loading ? t("tasks.fetching") : t("tasks.noMatches")}
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">ID</th>
                  <th className="px-3 py-2 font-medium">{t("tasks.titleContext")}</th>
                  <th className="px-3 py-2 font-medium">{t("tasks.author")}</th>
                  <th className="px-3 py-2 font-medium">{t("tasks.state")}</th>
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
                              {run ? <Badge tone={statusTone(run.status)}>{invocationStatus(t, run.status)}</Badge> : null}
                            </span>
                          );
                        })()}
                        {(() => {
                          if (r.type !== "issue") return null;
                          const claim = activeClaim(r);
                          return claim ? (
                            <Badge tone={claim.mode === "develop" ? "warning" : "neutral"} className="shrink-0">
                              <Hand className="mr-1 size-3" />
                              {t(claim.mode === "develop" ? "tasks.claimed" : "tasks.reviewing")} · {claim.claimedBy}
                            </Badge>
                          ) : null;
                        })()}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{r.author || "—"}</td>
                    <td className="px-3 py-2">
                      <Badge tone={r.state === "open" ? "success" : r.state === "merged" ? "neutral" : "warning"}>{r.state}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        {r.type === "issue" && claimHistory(r).length > 0 ? (
                          <Button variant="ghost" size="sm" disabled={pending} onClick={() => setHistoryRow(r)} title={t("taskActions.claimHistoryHint")}>
                            <History className="size-3.5" />
                          </Button>
                        ) : null}
                        {(() => {
                          if (r.type !== "issue" || r.state !== "open") return null;
                          const claim = activeClaim(r);
                          return claim ? (
                            <Button variant="ghost" size="sm" disabled={pending} onClick={() => releaseClaimRow(claim.id)} title={t("taskActions.releaseHint", { owner: claim.claimedBy })}>
                              <Hand className="mr-1 size-3.5" /> {t("taskActions.release")}
                            </Button>
                          ) : (
                            <Button variant="secondary" size="sm" disabled={pending} onClick={() => claimIssueRow(r)} title={t("taskActions.claimHint")}>
                              <Hand className="mr-1 size-3.5" /> {t("taskActions.claim")}
                            </Button>
                          );
                        })()}
                        <Button variant="secondary" size="sm" disabled={pending} onClick={() => automateIssue(r)} title={t("taskActions.automateHint")}>
                          <Workflow className="mr-1 size-3.5" /> {t("tasks.automate")}
                        </Button>
                        {(() => {
                          const wt = linkedWorktree(r);
                          return wt ? (
                            <Button variant="secondary" size="sm" onClick={() => openWorktree(wt.id, r.projectId)} title={`Open worktree ${wt.branch}`}>
                              <GitBranch className="mr-1 size-3.5" /> {t("tasks.open")}
                            </Button>
                          ) : (
                            <>
                              <Button size="sm" disabled={pending} onClick={() => autoRunIssue(r)} title={t("taskActions.autoHint")}>
                                <Zap className="mr-1 size-3.5" /> {t("tasks.auto")}
                              </Button>
                              <Button variant="secondary" size="sm" disabled={pending} onClick={() => setWtRow(r)} title={t("taskActions.worktreeHint")}>
                                <GitBranch className="mr-1 size-3.5" /> {t("tasks.worktree")}
                              </Button>
                            </>
                          );
                        })()}
                        {r.url ? (
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-grid size-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                            title={t("tasks.openGithub")}
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

      <Modal open={Boolean(historyRow)} onClose={() => setHistoryRow(null)} title={historyRow ? t("tasks.claimHistoryId", { number: historyRow.number }) : t("tasks.claimHistory")}>
        {historyRow ? <ClaimHistoryList events={claimHistory(historyRow)} /> : null}
      </Modal>

      <Modal open={Boolean(wtRow)} onClose={() => setWtRow(null)} title={wtRow ? t("tasks.worktreeFor", { number: wtRow.number }) : t("tasks.worktree")}>
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

// #1163: the durable claim trail for one issue — each row is a recorded
// transition from issueClaimEvents (#1152), newest first. Read-only.
const CLAIM_EVENT_TONE = { claimed: "warning", released: "neutral", expired: "danger" } as const;
function ClaimHistoryList({ events }: { events: IssueClaimEvent[] }) {
  const { t } = useAppTranslation();
  if (!events.length) return <p className="text-sm text-muted-foreground">{t("tasks.noClaimHistory")}</p>;
  return (
    <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
      {events.map((e) => (
        <li key={e.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border/60 px-2.5 py-1.5 text-xs">
          <Badge tone={CLAIM_EVENT_TONE[e.type] ?? "neutral"}>{e.type}</Badge>
          <span className="font-medium">{e.claimedBy}</span>
          <span className="text-muted-foreground">{e.mode}</span>
          {e.type === "released" && e.actorId && e.actorId !== e.claimedBy ? (
            <span className="text-muted-foreground">{t("tasks.releasedBy", { actor: e.actorId })}</span>
          ) : null}
          {e.outcome && e.outcome !== "released" ? <span className="text-muted-foreground">{e.outcome.replaceAll("_", " ")}</span> : null}
          {e.autoRunId ? <span className="font-mono text-muted-foreground">{e.autoRunId}</span> : null}
          <span className="ml-auto text-muted-foreground">{e.at.replace("T", " ").slice(0, 16)}</span>
        </li>
      ))}
    </ul>
  );
}

// Worktree-creation options for a Task item: branch name (smart-suggested for an
// issue), base branch, and agent. A PR checks out its own branch, so only the
// agent is offered.
function WorktreeOptionsForm({ row, onDone }: { row: Row; onDone: (wt: { id: string; projectId: string } | null) => void }) {
  const { t } = useAppTranslation();
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
          <>{t("tasks.checkoutPr", { number: row.number })}{row.headRefName ? <> (<span className="font-mono">{row.headRefName}</span>)</> : null}.</>
        ) : (
          <>{t("tasks.createIssueBranch", { number: row.number })}</>
        )}
      </p>
      {!isPr ? (
        <>
          <Field label={t("tasks.branchName")}>
            <div className="flex gap-2">
              <Input value={branch} onChange={(e) => setBranch(e.target.value)} className="font-mono" />
              <Button variant="secondary" size="sm" disabled={suggesting} onClick={suggest} title={t("tasks.suggestName")}>
                {t("tasks.suggest")}
              </Button>
            </div>
          </Field>
          <Field label={t("tasks.baseBranch")}>
            <Input value={base} onChange={(e) => setBase(e.target.value)} className="font-mono" placeholder="main" />
          </Field>
        </>
      ) : null}
      <Field label={t("tasks.agent")}>
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
          {t("tasks.cancel")}
        </Button>
        <Button size="sm" disabled={pending} onClick={create}>
          {t("tasks.createWorktree")}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
