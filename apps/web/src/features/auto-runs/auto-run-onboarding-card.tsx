import { useCallback, useEffect, useState } from "react";
import { Wand2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useConsoleState } from "@/data/use-console-state";
import { useRefreshConsoleState } from "@/data/use-console-state";
import { api } from "@/data/use-console-actions";

interface Readiness {
  ready: boolean;
  checks: { key: string; label: string; status: "ok" | "warn" | "blocked"; detail: string }[];
}

// U3 onboarding: the few per-project essentials to get auto-run going, inline —
// pick a coding agent and a verify command, see readiness turn green. Reuses the
// existing project-update endpoint + the U1 readiness signal; autonomy toggles
// live in the Configuration card below.
export function AutoRunOnboardingCard({ projectId }: { projectId: string | null }) {
  const { data: consoleState } = useConsoleState();
  const refresh = useRefreshConsoleState();
  const [verifyNames, setVerifyNames] = useState<string[]>([]);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [busy, setBusy] = useState(false);

  const project = consoleState?.projects?.find((p) => p.id === projectId) ?? null;
  const agents = consoleState?.agents ?? [];

  const loadReadiness = useCallback(async () => {
    if (!projectId) return;
    try {
      const d = (await api.autoRunReadiness(projectId)) as { readiness?: Readiness };
      setReadiness(d.readiness ?? null);
    } catch {
      setReadiness(null);
    }
  }, [projectId]);

  useEffect(() => {
    void (async () => {
      try {
        const cfg = (await api.getAutoRunConfig()) as { config?: { verifyCommandNames?: string[] } };
        setVerifyNames(cfg.config?.verifyCommandNames ?? []);
      } catch {
        setVerifyNames([]);
      }
    })();
  }, []);

  useEffect(() => {
    void loadReadiness();
  }, [loadReadiness]);

  const patch = async (body: Record<string, unknown>) => {
    if (!projectId) return;
    setBusy(true);
    try {
      await api.updateProject(projectId, body);
      await refresh();
      await loadReadiness();
    } finally {
      setBusy(false);
    }
  };

  if (!projectId || !project) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2">
            <Wand2 className="size-4" /> Set up auto-run — {project.name}
          </span>
          {readiness ? (readiness.ready ? <Badge tone="success">ready to run</Badge> : <Badge tone="warning">setup needed</Badge>) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2">
            <span className="text-sm font-medium">Coding agent</span>
            <span className="text-xs text-muted-foreground">Which agent edits the code for this project.</span>
            <select
              className="mt-0.5 h-8 rounded-md border border-border bg-background px-2 text-sm"
              value={project.defaultAgentId ?? ""}
              disabled={busy}
              onChange={(e) => void patch({ defaultAgentId: e.target.value || null })}
            >
              <option value="">— none —</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.health?.status ? ` (${a.health.status})` : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2">
            <span className="text-sm font-medium">Verify command</span>
            <span className="text-xs text-muted-foreground">
              {verifyNames.length ? "Runs in the worktree before a PR opens." : "No named verify commands configured (env allowlist)."}
            </span>
            <select
              className="mt-0.5 h-8 rounded-md border border-border bg-background px-2 text-sm"
              value={project.verifyCommandName ?? ""}
              disabled={busy || verifyNames.length === 0}
              onChange={(e) => void patch({ verifyCommandName: e.target.value || null })}
            >
              <option value="">— none (unverified) —</option>
              {verifyNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>

        {readiness && !readiness.ready ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
            Still needed:{" "}
            {readiness.checks
              .filter((c) => c.status === "blocked")
              .map((c) => c.label)
              .join(", ")}
            . See the Readiness card for details.
          </div>
        ) : readiness?.ready ? (
          <p className="text-xs text-muted-foreground">Ready — trigger a run from the Task board [Auto] button, or enable auto-trigger in Configuration below.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
