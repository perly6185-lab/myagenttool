import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/common/empty-state";
import { useConsoleState } from "@/data/use-console-state";
import { useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/cn";
import { readableStatus, shortTime, statusTone } from "@/lib/readable-labels";
import type { InvocationSnapshot } from "@/lib/console-state";

/**
 * Project-scoped conversation history (#163): filter + order the invocation list
 * for the Sessions panel. Kept pure so it can be unit-tested without a DOM.
 */
export function selectSessions(
  invocations: InvocationSnapshot[],
  opts: { scope: "project" | "all"; currentProjectId?: string | null; worktreeId?: string | null; worktreeOnly: boolean },
): InvocationSnapshot[] {
  let list = invocations;
  if (opts.scope === "project" && opts.currentProjectId) {
    list = list.filter((inv) => inv.projectId === opts.currentProjectId);
  }
  if (opts.worktreeOnly && opts.worktreeId) {
    list = list.filter((inv) => inv.worktreeId === opts.worktreeId);
  }
  return [...list]
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, 50);
}

/** Right-side Sessions panel — recent runs, selecting one reconstructs its transcript. */
export function SessionHistory() {
  const { data: state } = useConsoleState();
  const selectedInvocationId = useUiStore((s) => s.selectedInvocationId);
  const setSelectedInvocationId = useUiStore((s) => s.setSelectedInvocationId);
  const setSection = useUiStore((s) => s.setSection);
  const setResumeFromInvocationId = useUiStore((s) => s.setResumeFromInvocationId);
  const setSelectedProjectId = useUiStore((s) => s.setSelectedProjectId);
  const setSelectedAgentId = useUiStore((s) => s.setSelectedAgentId);
  const setSelectedWorktreeIdStore = useUiStore((s) => s.setSelectedWorktreeId);
  const selectedWorktreeId = useUiStore((s) => s.selectedWorktreeId);
  const [scope, setScope] = useState<"project" | "all">("project");
  const [worktreeOnly, setWorktreeOnly] = useState(false);

  const currentProjectId = state?.currentProjectId ?? null;
  const sessions = useMemo(
    () =>
      selectSessions(state?.invocations ?? [], {
        scope,
        currentProjectId,
        worktreeId: selectedWorktreeId,
        worktreeOnly,
      }),
    [state?.invocations, scope, currentProjectId, selectedWorktreeId, worktreeOnly],
  );

  function open(inv: InvocationSnapshot) {
    setSelectedInvocationId(inv.id);
    setSection("dashboard"); // the Dashboard transcript reconstructs the selected run
  }

  // Resume (#163): continue this session's Codex conversation. Restore the run's
  // project/worktree/agent context, arm the composer's resume mode, and jump to
  // the Dashboard so the next send is a `continue_last` run targeting this session.
  function resume(inv: InvocationSnapshot) {
    if (inv.projectId) setSelectedProjectId(inv.projectId);
    setSelectedWorktreeIdStore(inv.worktreeId ?? null);
    if (inv.agentId) setSelectedAgentId(inv.agentId);
    setResumeFromInvocationId(inv.id);
    setSelectedInvocationId(inv.id);
    setSection("dashboard");
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Sessions</CardTitle>
          <div className="flex gap-1">
            <Toggle active={scope === "project"} onClick={() => setScope("project")}>
              Project
            </Toggle>
            <Toggle active={scope === "all"} onClick={() => setScope("all")}>
              All
            </Toggle>
          </div>
        </div>
        {selectedWorktreeId ? (
          <label className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={worktreeOnly} onChange={(e) => setWorktreeOnly(e.target.checked)} />
            This worktree only
          </label>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-1.5">
        {!sessions.length ? (
          <EmptyState title="No sessions" hint="Runs for this project appear here." />
        ) : (
          sessions.map((inv) => (
            <div
              key={inv.id}
              className={cn(
                "rounded-md border transition-colors",
                inv.id === selectedInvocationId ? "border-primary bg-primary/5" : "border-border hover:bg-accent",
              )}
            >
              <button
                type="button"
                onClick={() => open(inv)}
                className="flex w-full flex-col gap-1 px-2.5 py-1.5 text-left"
              >
                <span className="truncate text-sm [overflow-wrap:anywhere]">
                  {inv.input?.task || "Untitled run"}
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <StatusBadge tone={statusTone(inv.status)}>{readableStatus(inv.status)}</StatusBadge>
                  {inv.createdAt ? <span className="font-mono tabular-nums">{shortTime(inv.createdAt)}</span> : null}
                  {inv.worktreeId ? <Badge tone="neutral">worktree</Badge> : null}
                </span>
              </button>
              <div className="border-t border-border/60 px-2.5 py-1">
                <button
                  type="button"
                  onClick={() => resume(inv)}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Resume
                </button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function Toggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded px-2 py-0.5 text-xs font-medium",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}
