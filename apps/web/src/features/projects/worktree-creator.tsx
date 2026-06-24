import { useEffect, useState } from "react";
import { ChevronDown, CircleDot, GitBranch, GitPullRequest, Github, Sparkles, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { cn } from "@/lib/cn";

type GithubItem = {
  type: "pr" | "issue";
  number: number;
  title: string;
  headRefName: string | null;
  author: string;
  url: string | null;
  state: string;
};
type GithubState = { available: boolean; message: string; items: GithubItem[] };
type BranchRef = { name: string; remote: boolean };
type Tab = "smart" | "github" | "branch" | "name";

// Branch name for a worktree created from an issue: "<number>-<title slug>".
function issueBranchName(item: GithubItem): string {
  const slug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "issue";
  return `${item.number}-${slug}`;
}

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
  const [suggesting, setSuggesting] = useState(false);

  const [branches, setBranches] = useState<BranchRef[]>([]);
  const [brQuery, setBrQuery] = useState("");
  const [brSel, setBrSel] = useState<string | null>(null);

  const [gh, setGh] = useState<GithubState | null>(null);
  const [ghLoading, setGhLoading] = useState(false);
  const [ghQuery, setGhQuery] = useState("");
  const [ghSel, setGhSel] = useState<GithubItem | null>(null);

  // Keep a valid agent selected once the (async) agent list arrives.
  useEffect(() => {
    if (!agentId && agents.length > 0) setAgentId(agents[0].id);
  }, [agents, agentId]);

  // Load branches on mount / when the project changes; reset per-project picks
  // (selections and the base-branch override belong to the previous project).
  useEffect(() => {
    setGh(null);
    setBrSel(null);
    setGhSel(null);
    setBaseBranch("");
    setBrQuery("");
    setGhQuery("");
    setWtName("");
    setDesc("");
    (api.listBranches(pid) as Promise<{ branches: BranchRef[] }>)
      .then((r) => setBranches(r.branches ?? []))
      .catch(() => setBranches([]));
  }, [pid]);

  // Lazily load PRs + issues the first time the GitHub tab is opened.
  useEffect(() => {
    if (tab !== "github" || gh) return;
    setGhLoading(true);
    (api.listGithubItems(pid) as Promise<GithubState>)
      .then(setGh)
      .catch((e) => setGh({ available: false, message: e instanceof Error ? e.message : "Failed to load.", items: [] }))
      .finally(() => setGhLoading(false));
  }, [tab, gh, pid]);

  // Switching tabs starts the new mode clean — otherwise a PR/branch selection
  // (and the name it backfilled) leaks into a name/smart create as a new branch.
  function changeTab(next: Tab) {
    setTab(next);
    setGhSel(null);
    setBrSel(null);
    setWtName("");
  }

  // Selecting a GitHub item backfills the shared name field: an issue seeds a
  // new "<num>-<slug>" branch you can edit; a PR fills (read-only) its head ref.
  function selectGithub(item: GithubItem) {
    setGhSel(item);
    setWtName(item.type === "issue" ? issueBranchName(item) : (item.headRefName ?? ""));
  }
  // Selecting a branch checks out that ref; reflect it in the name field too.
  function selectBranch(name: string) {
    setBrSel(name);
    setWtName(name);
  }

  async function suggest() {
    if (!desc.trim()) return;
    setSuggesting(true);
    try {
      const r = (await api.suggestWorktreeName(desc.trim())) as { name: string };
      setWtName(r.name); // backfill the editable name field
    } finally {
      setSuggesting(false);
    }
  }

  // A PR / existing branch checks out an existing ref; everything else creates a
  // new branch from the (editable) name field.
  const createsExistingRef = (tab === "github" && ghSel?.type === "pr") || tab === "branch";
  const canCreate = createsExistingRef ? Boolean(tab === "branch" ? brSel : ghSel) : Boolean(wtName.trim());

  function create() {
    if (!canCreate) return;
    const startPoint = baseBranch || undefined;
    // Carry the GitHub link so the worktree can show its issue/PR card later.
    const link =
      tab === "github" && ghSel
        ? { type: ghSel.type, number: ghSel.number, title: ghSel.title, url: ghSel.url, state: ghSel.state }
        : undefined;
    const payload =
      tab === "github" && ghSel?.type === "pr"
        ? { prNumber: ghSel.number, agentId, link }
        : tab === "branch"
          ? { ref: brSel!, agentId }
          : { name: wtName.trim(), agentId, startPoint, link };
    void execute(async () => {
      const r = await api.createWorktree(pid, payload);
      onDone?.();
      return r;
    });
  }

  const filteredBranches = branches.filter((b) => b.name.toLowerCase().includes(brQuery.trim().toLowerCase()));
  const filteredItems = (gh?.items ?? []).filter((it) =>
    `#${it.number} ${it.title} ${it.headRefName ?? ""}`.toLowerCase().includes(ghQuery.trim().toLowerCase()),
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
              onClick={() => changeTab(key)}
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
          {tab === "smart" ? (
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
                        onClick={() => selectBranch(b.name)}
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
              {ghLoading ? <p className="text-xs text-muted-foreground">Loading PRs &amp; issues…</p> : null}
              {!ghLoading && gh && !gh.available ? (
                <div className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                  {gh.message} Connect a GitHub remote and authenticate <span className="font-mono">gh</span> to create
                  worktrees from PRs and issues.
                </div>
              ) : null}
              {gh?.available ? (
                <>
                  <Input value={ghQuery} placeholder="Search GitHub PRs & issues" onChange={(e) => setGhQuery(e.target.value)} />
                  {filteredItems.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No matching PRs or issues.</p>
                  ) : (
                    <ul className="max-h-44 overflow-y-auto rounded-md border border-border">
                      {filteredItems.map((it) => (
                        <li key={`${it.type}-${it.number}`}>
                          <button
                            type="button"
                            onClick={() => selectGithub(it)}
                            className={cn(
                              "flex w-full items-start gap-2 px-3 py-1.5 text-left text-xs",
                              ghSel?.type === it.type && ghSel?.number === it.number
                                ? "bg-primary/10 text-foreground"
                                : "hover:bg-muted",
                            )}
                          >
                            {it.type === "pr" ? (
                              <GitPullRequest className="mt-0.5 size-3 shrink-0 text-emerald-500" />
                            ) : (
                              <CircleDot className="mt-0.5 size-3 shrink-0 text-sky-500" />
                            )}
                            <span className="min-w-0">
                              <span className="truncate">
                                <span className="font-medium">#{it.number}</span> {it.title}
                              </span>
                              <span className="block text-[10px] text-muted-foreground">
                                {it.type === "pr" ? it.headRefName : `issue → ${issueBranchName(it)}`}
                                {it.author ? ` · @${it.author}` : ""}
                              </span>
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

        {tab === "branch" && brSel ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Checks out existing branch <span className="font-mono">{brSel}</span>.
          </p>
        ) : null}
        {tab === "github" && ghSel?.type === "pr" ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Checks out PR #{ghSel.number} (<span className="font-mono">{ghSel.headRefName}</span>).
          </p>
        ) : null}
        {tab === "name" || tab === "smart" || (tab === "github" && ghSel?.type === "issue") ? (
          <div className="mt-2">
            <Field label="Worktree branch name">
              <Input
                value={wtName}
                placeholder="new-branch-name"
                className="font-mono"
                onChange={(e) => setWtName(e.target.value)}
              />
            </Field>
          </div>
        ) : null}
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
