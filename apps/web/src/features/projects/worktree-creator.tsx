import { useEffect, useState } from "react";
import { ChevronDown, GitBranch, Github, Sparkles, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { cn } from "@/lib/cn";

type PullRequest = { number: number; title: string; headRefName: string; author: string };
type PrState = { available: boolean; message: string; prs: PullRequest[] };
type BranchRef = { name: string; remote: boolean };
type Tab = "smart" | "github" | "branch" | "name";

const TABS: [Tab, string, typeof Sparkles][] = [
  ["smart", "Smart", Sparkles],
  ["github", "GitHub", Github],
  ["branch", "Branch", GitBranch],
  ["name", "Name", Type],
];

// orca-style "Create worktree" dialog: pick a project, choose how to name/create
// the worktree (smart / GitHub PR / existing branch / free name), pick an agent,
// and an advanced base-branch override. Self-contained — used in the nav "+"
// modal and inline on the Projects page.
export function WorktreeCreator({
  projectId,
  onDone,
  showProjectPicker = false,
}: {
  projectId: string;
  onDone?: () => void;
  showProjectPicker?: boolean;
}) {
  const { data: state } = useConsoleState();
  const { execute, pending } = useAsyncAction();
  const projects = (state?.projects ?? []).filter((p) => p.status !== "archived");
  const agents = state?.agents ?? [];

  const [pid, setPid] = useState(projectId);
  const [tab, setTab] = useState<Tab>("name");
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [showAdv, setShowAdv] = useState(false);
  const [baseBranch, setBaseBranch] = useState("");

  const [wtName, setWtName] = useState("");
  const [desc, setDesc] = useState("");
  const [suggested, setSuggested] = useState("");
  const [suggesting, setSuggesting] = useState(false);

  const [branches, setBranches] = useState<BranchRef[]>([]);
  const [brQuery, setBrQuery] = useState("");
  const [brSel, setBrSel] = useState<string | null>(null);

  const [pr, setPr] = useState<PrState | null>(null);
  const [prLoading, setPrLoading] = useState(false);
  const [prQuery, setPrQuery] = useState("");
  const [prSel, setPrSel] = useState<number | null>(null);

  // Load branches on mount / when the project changes; reset per-project picks.
  useEffect(() => {
    setPr(null);
    setBrSel(null);
    setPrSel(null);
    (api.listBranches(pid) as Promise<{ branches: BranchRef[] }>)
      .then((r) => setBranches(r.branches ?? []))
      .catch(() => setBranches([]));
  }, [pid]);

  // Lazily load PRs the first time the GitHub tab is opened.
  useEffect(() => {
    if (tab !== "github" || pr) return;
    setPrLoading(true);
    (api.listPullRequests(pid) as Promise<PrState>)
      .then(setPr)
      .catch((e) => setPr({ available: false, message: e instanceof Error ? e.message : "Failed to load PRs.", prs: [] }))
      .finally(() => setPrLoading(false));
  }, [tab, pr, pid]);

  async function suggest() {
    if (!desc.trim()) return;
    setSuggesting(true);
    try {
      const r = (await api.suggestWorktreeName(desc.trim())) as { name: string };
      setSuggested(r.name);
    } finally {
      setSuggesting(false);
    }
  }

  const canCreate =
    tab === "name"
      ? Boolean(wtName.trim())
      : tab === "smart"
        ? Boolean(suggested.trim())
        : tab === "branch"
          ? Boolean(brSel)
          : Boolean(prSel);

  function create() {
    if (!canCreate) return;
    const startPoint = baseBranch || undefined;
    const payload =
      tab === "github"
        ? { prNumber: prSel!, agentId }
        : tab === "branch"
          ? { ref: brSel!, agentId }
          : tab === "smart"
            ? { name: suggested.trim(), agentId, startPoint }
            : { name: wtName.trim(), agentId, startPoint };
    void execute(async () => {
      const r = await api.createWorktree(pid, payload);
      onDone?.();
      return r;
    });
  }

  const filteredBranches = branches.filter((b) => b.name.toLowerCase().includes(brQuery.trim().toLowerCase()));
  const filteredPrs = (pr?.prs ?? []).filter((p) =>
    `#${p.number} ${p.title} ${p.headRefName}`.toLowerCase().includes(prQuery.trim().toLowerCase()),
  );

  return (
    <div className="space-y-4" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") create(); }}>
      {showProjectPicker ? (
        <Field label="Project">
          <Select value={pid} onChange={(e) => setPid(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Name or “create from” (optional)</p>
        <div className="flex gap-1 border-b border-border">
          {TABS.map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-1.5 text-xs font-medium transition",
                tab === key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>

        <div className="mt-3">
          {tab === "name" ? (
            <Input value={wtName} placeholder="Worktree name (new branch)" onChange={(e) => setWtName(e.target.value)} />
          ) : null}

          {tab === "smart" ? (
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input
                  value={desc}
                  placeholder="Describe the work (e.g. fix login crash)"
                  onChange={(e) => setDesc(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") suggest();
                  }}
                />
                <Button variant="secondary" size="sm" disabled={suggesting || !desc.trim()} onClick={suggest}>
                  Suggest
                </Button>
              </div>
              {suggested ? (
                <Input value={suggested} className="font-mono" onChange={(e) => setSuggested(e.target.value)} />
              ) : null}
            </div>
          ) : null}

          {tab === "branch" ? (
            <div className="space-y-2">
              <Input value={brQuery} placeholder="Search branches" onChange={(e) => setBrQuery(e.target.value)} />
              <ul className="max-h-44 overflow-y-auto rounded-md border border-border">
                {filteredBranches.length === 0 ? (
                  <li className="px-3 py-2 text-xs text-muted-foreground">No branches</li>
                ) : (
                  filteredBranches.map((b) => (
                    <li key={b.name}>
                      <button
                        type="button"
                        onClick={() => setBrSel(b.name)}
                        className={cn(
                          "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs",
                          brSel === b.name ? "bg-primary/10 text-foreground" : "hover:bg-muted",
                        )}
                      >
                        <GitBranch className="size-3 shrink-0 opacity-60" />
                        <span className="truncate">{b.name}</span>
                        {b.remote ? <span className="ml-auto text-[10px] text-muted-foreground">remote</span> : null}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          ) : null}

          {tab === "github" ? (
            <div className="space-y-2">
              {prLoading ? <p className="text-xs text-muted-foreground">Loading pull requests…</p> : null}
              {!prLoading && pr && !pr.available ? (
                <div className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                  {pr.message} Connect a GitHub remote and authenticate <span className="font-mono">gh</span> to create
                  worktrees from pull requests.
                </div>
              ) : null}
              {pr?.available ? (
                <>
                  <Input value={prQuery} placeholder="Search GitHub PRs" onChange={(e) => setPrQuery(e.target.value)} />
                  {filteredPrs.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No matching pull requests.</p>
                  ) : (
                    <ul className="max-h-44 overflow-y-auto rounded-md border border-border">
                      {filteredPrs.map((p) => (
                        <li key={p.number}>
                          <button
                            type="button"
                            onClick={() => setPrSel(p.number)}
                            className={cn(
                              "flex w-full flex-col px-3 py-1.5 text-left text-xs",
                              prSel === p.number ? "bg-primary/10 text-foreground" : "hover:bg-muted",
                            )}
                          >
                            <span className="truncate">
                              <span className="font-medium">#{p.number}</span> {p.title}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {p.headRefName}
                              {p.author ? ` · @${p.author}` : ""}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <Field label="Agent">
        <Select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
          {agents.length === 0 ? <option value="">No agent</option> : null}
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Field>

      <div>
        <button
          type="button"
          onClick={() => setShowAdv((v) => !v)}
          className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className={cn("size-3.5 transition-transform", showAdv ? "" : "-rotate-90")} />
          Advanced
        </button>
        {showAdv ? (
          <div className="mt-2">
            <Field label="Base branch (new branches only)">
              <Select value={baseBranch} onChange={(e) => setBaseBranch(e.target.value)}>
                <option value="">Default branch</option>
                {branches.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
        <Button onClick={create} disabled={pending || !canCreate}>
          Create worktree
          <kbd className="ml-2 rounded bg-primary-foreground/15 px-1 text-[10px]">⌘↵</kbd>
        </Button>
      </div>
    </div>
  );
}
