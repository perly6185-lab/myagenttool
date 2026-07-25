import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Search } from "lucide-react";
import { pageRegistration } from "@/app/sections";
import { SectionHeading } from "@/components/common/section-heading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/badge";
import { useConsoleState } from "@/data/use-console-state";
import { usePageNavigation } from "@/hooks/use-page-navigation";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

const DOMAIN_KEYS = ["projects", "agents", "agentSkills", "devices", "discovery", "integrations", "tools", "applications", "channels", "automation", "routines", "economics"] as const;

export function SettingsHomeView() {
  const { t } = useAppTranslation();
  const navigate = usePageNavigation();
  const { data: state } = useConsoleState();
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const domains = useMemo(() => DOMAIN_KEYS.map((key) => pageRegistration(key))
    .filter((page) => !normalized || `${t(page.labelKey)} ${t(page.blurbKey)}`.toLowerCase().includes(normalized)), [normalized, t]);

  const readyAgents = (state?.agents ?? []).filter((item) => item.status !== "disabled" && item.health?.status !== "unhealthy").length;
  const readyApplications = (state?.applications ?? []).filter((item) => item.status === "active" && item.localReadiness?.state !== "repair_required").length;
  const readyChannels = (state?.channelOperations ?? []).filter((item) => item.ready && item.health !== "attention").length;
  const checks = [
    { key: "device", label: "settingsHome.checks.device" as const, fix: "settingsHome.fixes.device" as const, ready: state?.device?.status === "online", section: "devices" as const },
    { key: "agent", label: "settingsHome.checks.agent" as const, fix: "settingsHome.fixes.agent" as const, ready: readyAgents > 0, section: "agents" as const },
    { key: "application", label: "settingsHome.checks.application" as const, fix: "settingsHome.fixes.application" as const, ready: readyApplications > 0, section: "applications" as const },
    { key: "channel", label: "settingsHome.checks.channel" as const, fix: "settingsHome.fixes.channel" as const, ready: readyChannels > 0, section: "channels" as const, optional: true },
  ];
  const needsFix = checks.filter((item) => !item.ready && !item.optional);

  return (
    <div className="space-y-5">
      <SectionHeading eyebrow={t("settingsHome.eyebrow")} title={t("settingsHome.title")} description={t("settingsHome.description")} />
      <Card>
        <CardHeader><CardTitle>{t("settingsHome.health")}</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {checks.map((check) => (
            <button key={check.key} type="button" onClick={() => navigate(check.section)} className="rounded-lg border p-3 text-left hover:bg-muted">
              <span className="flex items-center justify-between gap-2 text-sm font-medium">
                {t(check.label)}
                {check.ready ? <CheckCircle2 className="size-4 text-success" /> : <AlertTriangle className="size-4 text-warning" />}
              </span>
              <StatusBadge tone={check.ready ? "success" : check.optional ? "neutral" : "warning"}>
                {t(check.ready ? "settingsHome.ready" : check.optional ? "settingsHome.optional" : "settingsHome.needsSetup")}
              </StatusBadge>
            </button>
          ))}
        </CardContent>
      </Card>
      {needsFix.length ? (
        <Card>
          <CardHeader><CardTitle>{t("settingsHome.recommended")}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {needsFix.map((check, index) => (
              <button key={check.key} type="button" onClick={() => navigate(check.section)} className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted">
                <span>{index + 1}. {t(check.fix)}</span><span aria-hidden>→</span>
              </button>
            ))}
          </CardContent>
        </Card>
      ) : null}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
        <Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" aria-label={t("settingsHome.search")} placeholder={t("settingsHome.searchPlaceholder")} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {domains.map((page) => {
          const Icon = page.icon;
          return <button key={page.key} type="button" onClick={() => navigate(page.key)} className="rounded-xl border bg-card p-4 text-left hover:bg-muted">
            <Icon className="mb-3 size-5" /><strong className="block text-sm">{t(page.labelKey)}</strong><span className="text-xs text-muted-foreground">{t(page.blurbKey)}</span>
          </button>;
        })}
      </div>
      {!domains.length ? <p className="text-sm text-muted-foreground">{t("settingsHome.noMatch")}</p> : null}
    </div>
  );
}
