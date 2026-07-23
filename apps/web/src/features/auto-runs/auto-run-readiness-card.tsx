import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, CircleAlert, CircleCheck, CircleX } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/data/use-console-actions";
import { cn } from "@/lib/cn";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

interface ReadinessCheck {
  key: string;
  label: string;
  status: "ok" | "warn" | "blocked";
  detail: string;
}
interface Readiness {
  checks: ReadinessCheck[];
  ready: boolean;
}

function dot(status: ReadinessCheck["status"]) {
  if (status === "ok") return <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />;
  if (status === "warn") return <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />;
  return <CircleX className="mt-0.5 size-3.5 shrink-0 text-red-600 dark:text-red-400" />;
}

// U1 preflight: shows whether the current project can run an auto-run and what's
// missing (agent, bridge, verify, budget, brakes) — so the operator isn't left
// guessing why a run won't start.
export function AutoRunReadinessCard({ projectId }: { projectId: string | null }) {
  const { t } = useAppTranslation();
  const [readiness, setReadiness] = useState<Readiness | null>(null);

  const load = useCallback(async () => {
    if (!projectId) {
      setReadiness(null);
      return;
    }
    try {
      const data = (await api.autoRunReadiness(projectId)) as { readiness?: Readiness };
      setReadiness(data.readiness ?? null);
    } catch {
      setReadiness(null);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  if (!projectId || !readiness) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2">
            <ShieldCheck className="size-4" /> {t("autoRunActions.readiness")}
          </span>
          {readiness.ready ? <Badge tone="success">{t("autoRunActions.ready")}</Badge> : <Badge tone="danger">{t("autoRunActions.notReady")}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {readiness.checks.map((c) => (
          <div key={c.key} className="flex items-start gap-2 text-xs">
            {dot(c.status)}
            <span className="min-w-0">
              <span className={cn("font-medium", c.status === "blocked" && "text-red-600 dark:text-red-400")}>{c.label}:</span>{" "}
              <span className="text-muted-foreground">{c.detail}</span>
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
