import { useCallback, useEffect, useState } from "react";
import { Settings2, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { api } from "@/data/use-console-actions";
import { cn } from "@/lib/cn";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { getSessionUser } from "@/lib/api-client";
import { useConsoleState } from "@/data/use-console-state";

interface AutoRunConfig {
  autoTrigger: { enabled: boolean; label: string; maxConcurrent: number; requireProjectFields: boolean };
  statusWriteback: boolean;
  spawnIssues: boolean;
  decision: { minConfidence: number; fastPath: boolean };
  deciderTimeoutMs: number;
  judgeTimeoutMs: number;
  requireChecksGreenToMerge: boolean;
  autonomyKillSwitch: boolean;
  requireIssuedApprovals: boolean;
  autoApproveNonCodePaths: boolean;
  globalMaxConcurrent: number;
  breakerFailureThreshold: number;
  breakerCooldownMinutes: number;
  designArtifacts: boolean;
  designImagesToIssue: boolean;
  autoMergeLowRisk: boolean;
  autoMergeMaxDiffLines: number;
  autoMergeSensitivePaths: string[];
  commands: { verify: boolean; decider: boolean; judge: boolean; review: boolean; designRender: boolean };
  verifyCommandNames: string[];
  settings: Record<string, unknown>;
}

// The flat safe-knob draft the form edits (mirrors normalizeAutoRunSettings).
interface Draft {
  autoTriggerEnabled: boolean;
  autoTriggerLabel: string;
  autoTriggerMaxConcurrent: number;
  autoTriggerRequireProjectFields: boolean;
  statusWriteback: boolean;
  spawnIssues: boolean;
  decisionMinConfidence: number;
  deciderFastPath: boolean;
  deciderTimeoutMs: number;
  judgeTimeoutMs: number;
  requireChecksGreenToMerge: boolean;
  autonomyKillSwitch: boolean;
  requireIssuedApprovals: boolean;
  autoApproveNonCodePaths: boolean;
  alertWebhookUrl: string;
  globalMaxConcurrent: number;
  breakerFailureThreshold: number;
  breakerCooldownMinutes: number;
  designArtifacts: boolean;
  designImagesToIssue: boolean;
  autoMergeLowRisk: boolean;
  autoMergeMaxDiffLines: number;
  autoMergeSensitivePaths: string; // newline-separated globs; empty = use the default set
  sloTargets: { prSuccessRate: number; failureRate: number; attentionRate: number; timeToPrMedianSeconds: number };
  routingThresholds: { minSamples: number; windowDays: number; fallbackRate: number; lowConfidenceRate: number; latencyP90Ms: number };
}

const SLO_DEFAULTS = { prSuccessRate: 0.7, failureRate: 0.2, attentionRate: 0.5, timeToPrMedianSeconds: 1800 };
const ROUTING_DEFAULTS = { minSamples: 5, windowDays: 30, fallbackRate: 0.2, lowConfidenceRate: 0.25, latencyP90Ms: 5000 };

export function canReplaceTeamWebhook(value: string) {
  return value.trim().length > 0;
}

export function canManageAutoRunConfig(role: string | undefined) {
  return role === "owner" || role === "admin";
}

function toDraft(c: AutoRunConfig): Draft {
  return {
    autoTriggerEnabled: c.autoTrigger.enabled,
    autoTriggerLabel: c.autoTrigger.label,
    autoTriggerMaxConcurrent: c.autoTrigger.maxConcurrent,
    autoTriggerRequireProjectFields: c.autoTrigger.requireProjectFields,
    statusWriteback: c.statusWriteback,
    spawnIssues: c.spawnIssues,
    decisionMinConfidence: c.decision.minConfidence,
    deciderFastPath: c.decision.fastPath,
    deciderTimeoutMs: c.deciderTimeoutMs,
    judgeTimeoutMs: c.judgeTimeoutMs,
    requireChecksGreenToMerge: c.requireChecksGreenToMerge,
    autonomyKillSwitch: c.autonomyKillSwitch,
    requireIssuedApprovals: c.requireIssuedApprovals,
    autoApproveNonCodePaths: c.autoApproveNonCodePaths,
    alertWebhookUrl: (c.settings?.alertWebhookUrl as string) ?? "",
    globalMaxConcurrent: c.globalMaxConcurrent,
    breakerFailureThreshold: c.breakerFailureThreshold,
    breakerCooldownMinutes: c.breakerCooldownMinutes,
    designArtifacts: c.designArtifacts,
    designImagesToIssue: c.designImagesToIssue,
    autoMergeLowRisk: c.autoMergeLowRisk,
    autoMergeMaxDiffLines: c.autoMergeMaxDiffLines,
    autoMergeSensitivePaths: ((c.settings?.autoMergeSensitivePaths as string[] | undefined) ?? []).join("\n"),
    sloTargets: { ...SLO_DEFAULTS, ...((c.settings?.sloTargets as Partial<typeof SLO_DEFAULTS>) ?? {}) },
    routingThresholds: { ...ROUTING_DEFAULTS, ...((c.settings?.routingThresholds as Partial<typeof ROUTING_DEFAULTS>) ?? {}) },
  };
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      <input type="checkbox" className="mt-1 shrink-0" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

// A conservative starting posture: autonomy off, guardrails on, brakes armed.
const RECOMMENDED_SAFE_DEFAULTS = {
  autoTriggerEnabled: false,
  autoTriggerRequireProjectFields: true,
  autoApproveNonCodePaths: false,
  requireChecksGreenToMerge: true,
  statusWriteback: false,
  spawnIssues: false,
  deciderFastPath: true,
  autonomyKillSwitch: false,
  requireIssuedApprovals: false,
  designArtifacts: false,
  designImagesToIssue: false,
  autoMergeLowRisk: false,
  autoMergeMaxDiffLines: 400,
  autoTriggerMaxConcurrent: 1,
  globalMaxConcurrent: 3,
  breakerFailureThreshold: 3,
  breakerCooldownMinutes: 15,
  decisionMinConfidence: 0.6,
  deciderTimeoutMs: 30000,
  judgeTimeoutMs: 120000,
} as const;

function NumberField({ label, hint, value, step, min, max, onChange }: { label: string; hint?: string; value: number; step?: number; min?: number; max?: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2">
      <span className="text-sm font-medium">{label}</span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      <Input
        type="number"
        value={String(value)}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-0.5 h-8"
      />
    </label>
  );
}

export function AutoRunConfigCard() {
  const { t } = useAppTranslation();
  const { data: consoleState, refetch: refetchConsoleState } = useConsoleState();
  const [config, setConfig] = useState<AutoRunConfig | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(false);
  const [teamWebhookUrl, setTeamWebhookUrl] = useState("");
  const [teamWebhookSaving, setTeamWebhookSaving] = useState(false);
  const [teamWebhookSaved, setTeamWebhookSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = (await api.getAutoRunConfig()) as { config?: AutoRunConfig };
      if (data.config) {
        setConfig(data.config);
        setDraft(toDraft(data.config));
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setSavedAt(false);
    setDraft((d) => (d ? { ...d, [k]: v } : d));
  };

  // Load a conservative starting posture into the draft (operator reviews + saves).
  const applyRecommended = () => {
    setSavedAt(false);
    setDraft((d) => (d ? { ...d, ...RECOMMENDED_SAFE_DEFAULTS, sloTargets: { ...SLO_DEFAULTS }, routingThresholds: { ...ROUTING_DEFAULTS } } : d));
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      // The sensitive-path list edits as newline text; send it as a glob array
      // (empty = clear the override → the server's default set).
      const { alertWebhookUrl, ...safeDraft } = draft;
      const payload: Record<string, unknown> = {
        ...safeDraft,
        autoMergeSensitivePaths: draft.autoMergeSensitivePaths.split("\n").map((s) => s.trim()).filter(Boolean),
      };
      // A redacted configured target loads as blank. Omit blank so saving an
      // unrelated setting cannot silently erase the secret.
      if (alertWebhookUrl.trim()) payload.alertWebhookUrl = alertWebhookUrl.trim();
      const data = (await api.updateAutoRunSettings(payload as unknown as Record<string, unknown>)) as { config?: AutoRunConfig };
      if (data.config) {
        setConfig(data.config);
        setDraft(toDraft(data.config));
      }
      setSavedAt(true);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const saveTeamWebhook = async () => {
    const teamId = getSessionUser()?.teamId;
    if (!teamId) {
      setError(t("autoRunConfig.webhookHint"));
      return;
    }
    setTeamWebhookSaving(true);
    try {
      await api.updateTeamAlertWebhook(teamId, teamWebhookUrl.trim() || null);
      setTeamWebhookUrl("");
      setTeamWebhookSaved(true);
      await refetchConsoleState();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTeamWebhookSaving(false);
    }
  };
  const clearTeamWebhook = async () => {
    const teamId = getSessionUser()?.teamId;
    if (!teamId) return;
    const teamLabel = sessionTeam?.name ?? teamId;
    if (!window.confirm(`${teamLabel} · ${t("documents.clear")} ${t("autoRunConfig.webhook")}?`)) return;
    setTeamWebhookSaving(true);
    try {
      await api.updateTeamAlertWebhook(teamId, null);
      setTeamWebhookUrl("");
      setTeamWebhookSaved(true);
      await refetchConsoleState();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTeamWebhookSaving(false);
    }
  };

  if (!config || !draft) return null;
  const sessionTeamId = getSessionUser()?.teamId;
  const sessionTeam = consoleState?.teams?.find((team) => team.id === sessionTeamId);
  const sessionRole = getSessionUser()?.role ?? "viewer";
  const canManage = canManageAutoRunConfig(sessionRole);

  const cmdBadge = (on: boolean) => (
    <Badge tone={on ? "success" : "neutral"}>{t(on ? "autoRunConfig.configured" : "autoRunConfig.notConfigured")}</Badge>
  );

  return (
    <Card>
      <CardHeader className="cursor-pointer" onClick={() => setOpen((v) => !v)}>
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2">
            {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            <Settings2 className="size-4" /> {t("autoRunConfig.title")}
          </span>
          <span className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
            <Badge tone={canManage ? "success" : "neutral"}>{sessionRole}</Badge>
            {config.autoTrigger.enabled ? <Badge tone="success">{t("autoRunConfig.autoTriggerOn")}</Badge> : <Badge tone="neutral">{t("autoRunConfig.autoTriggerOff")}</Badge>}
            {config.statusWriteback ? <Badge tone="running">{t("autoRunConfig.statusWriteback")}</Badge> : null}
          </span>
        </CardTitle>
      </CardHeader>
      {open ? (
        <CardContent className="flex flex-col gap-4">
          <fieldset disabled={!canManage} className="contents">
          {/* O0 kill switch — global emergency brake, applies immediately. */}
          <label className={cn("flex items-center justify-between gap-3 rounded-lg border px-3 py-2", draft.autonomyKillSwitch ? "border-red-500/60 bg-red-500/5" : "border-border")}>
            <span className="min-w-0">
              <span className={cn("block text-sm font-semibold", draft.autonomyKillSwitch && "text-red-600 dark:text-red-400")}>{t("autoRunConfig.killSwitch")}</span>
              <span className="block text-xs text-muted-foreground">{t("autoRunConfig.killSwitchHint")}</span>
            </span>
            <input type="checkbox" className="mt-0.5 shrink-0" checked={draft.autonomyKillSwitch} onChange={(e) => set("autonomyKillSwitch", e.target.checked)} />
          </label>
          {/* Approval grants phase-2 — reject legacy free-text approvalTokens once migration is complete. */}
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{t("autoRunConfig.strictApprovals")}</span>
              <span className="block text-xs text-muted-foreground">{t("autoRunConfig.strictApprovalsHint")}</span>
            </span>
            <input type="checkbox" className="mt-0.5 shrink-0" checked={draft.requireIssuedApprovals} onChange={(e) => set("requireIssuedApprovals", e.target.checked)} />
          </label>
          <p className="text-xs text-muted-foreground">
            {t("autoRunConfig.applyHint")}
          </p>

          <Section title={t("autoRunConfig.autonomy")}>
            <div className="grid gap-2 md:grid-cols-2">
              <Toggle label={t("autoRunConfig.autoTrigger")} hint={t("autoRunConfig.autoTriggerHint")} checked={draft.autoTriggerEnabled} onChange={(v) => set("autoTriggerEnabled", v)} />
              <Toggle label={t("autoRunConfig.requireFields")} hint={t("autoRunConfig.requireFieldsHint")} checked={draft.autoTriggerRequireProjectFields} onChange={(v) => set("autoTriggerRequireProjectFields", v)} />
              <Toggle label={t("autoRunConfig.autoApprove")} hint={t("autoRunConfig.autoApproveHint")} checked={draft.autoApproveNonCodePaths} onChange={(v) => set("autoApproveNonCodePaths", v)} />
              <Toggle label={t("autoRunConfig.fastPath")} hint={t("autoRunConfig.fastPathHint")} checked={draft.deciderFastPath} onChange={(v) => set("deciderFastPath", v)} />
              <label className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2">
                <span className="text-sm font-medium">{t("autoRunConfig.triggerLabel")}</span>
                <span className="text-xs text-muted-foreground">{t("autoRunConfig.triggerLabelHint")}</span>
                <Input value={draft.autoTriggerLabel} onChange={(e) => set("autoTriggerLabel", e.target.value)} className="mt-0.5 h-8" />
              </label>
              <NumberField label={t("autoRunConfig.minConfidence")} hint={t("autoRunConfig.minConfidenceHint")} value={draft.decisionMinConfidence} step={0.05} min={0} max={1} onChange={(v) => set("decisionMinConfidence", v)} />
            </div>
          </Section>

          <Section title={t("autoRunConfig.reliability")}>
            <div className="grid gap-2 md:grid-cols-2">
              <NumberField label={t("autoRunConfig.projectConcurrent")} value={draft.autoTriggerMaxConcurrent} min={1} max={10} onChange={(v) => set("autoTriggerMaxConcurrent", v)} />
              <NumberField label={t("autoRunConfig.globalConcurrent")} hint={t("autoRunConfig.globalConcurrentHint")} value={draft.globalMaxConcurrent} min={0} max={100} onChange={(v) => set("globalMaxConcurrent", v)} />
              <NumberField label={t("autoRunConfig.breakerThreshold")} hint={t("autoRunConfig.breakerThresholdHint")} value={draft.breakerFailureThreshold} min={0} max={50} onChange={(v) => set("breakerFailureThreshold", v)} />
              <NumberField label={t("autoRunConfig.breakerCooldown")} hint={t("autoRunConfig.breakerCooldownHint")} value={draft.breakerCooldownMinutes} min={1} max={1440} onChange={(v) => set("breakerCooldownMinutes", v)} />
              <NumberField label={t("autoRunConfig.deciderTimeout")} value={draft.deciderTimeoutMs} step={1000} min={1000} max={300000} onChange={(v) => set("deciderTimeoutMs", v)} />
              <NumberField label={t("autoRunConfig.judgeTimeout")} value={draft.judgeTimeoutMs} step={1000} min={1000} max={300000} onChange={(v) => set("judgeTimeoutMs", v)} />
            </div>
          </Section>

          <Section title={t("autoRunConfig.quality")}>
            <div className="grid gap-2 md:grid-cols-2">
              <Toggle label={t("autoRunConfig.requireGreen")} hint={t("autoRunConfig.requireGreenHint")} checked={draft.requireChecksGreenToMerge} onChange={(v) => set("requireChecksGreenToMerge", v)} />
              <Toggle label={t("autoRunConfig.writeback")} hint={t("autoRunConfig.writebackHint")} checked={draft.statusWriteback} onChange={(v) => set("statusWriteback", v)} />
              <Toggle label={t("autoRunConfig.spawnIssues")} hint={t("autoRunConfig.spawnIssuesHint")} checked={draft.spawnIssues} onChange={(v) => set("spawnIssues", v)} />
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <Toggle
                label={t("autoRunConfig.designArtifacts")}
                hint={t("autoRunConfig.designArtifactsHint")}
                checked={draft.designArtifacts}
                onChange={(v) => set("designArtifacts", v)}
              />
              <Toggle
                label={t("autoRunConfig.embedPreviews")}
                hint={t("autoRunConfig.embedPreviewsHint")}
                checked={draft.designImagesToIssue}
                onChange={(v) => set("designImagesToIssue", v)}
              />
              <Toggle
                label={t("autoRunConfig.autoMerge")}
                hint={t("autoRunConfig.autoMergeHint")}
                checked={draft.autoMergeLowRisk}
                onChange={(v) => set("autoMergeLowRisk", v)}
              />
              <NumberField label={t("autoRunConfig.maxDiff")} hint={t("autoRunConfig.maxDiffHint")} value={draft.autoMergeMaxDiffLines} min={1} max={100000} step={50} onChange={(v) => set("autoMergeMaxDiffLines", v)} />
            </div>
            {draft.autoMergeLowRisk && !config.commands.review ? (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                {t("autoRunConfig.noReviewWarning")}
              </p>
            ) : null}
            {draft.designImagesToIssue && !config.commands.designRender ? (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                {t("autoRunConfig.noRenderWarning")}
              </p>
            ) : null}
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">{t("autoRunConfig.sensitivePaths")}</span>
              <span className="text-xs text-muted-foreground">{t("autoRunConfig.sensitivePathsHint")}</span>
              <textarea
                value={draft.autoMergeSensitivePaths}
                onChange={(e) => set("autoMergeSensitivePaths", e.target.value)}
                rows={4}
                spellCheck={false}
                placeholder={".github/workflows/**\n**/migrations/**\n**/auth/**"}
                className="mt-0.5 rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs"
              />
              {draft.autoMergeSensitivePaths.trim() === "" ? (
                <span className="text-xs text-muted-foreground">{t("autoRunConfig.defaultPaths", { paths: config.autoMergeSensitivePaths.join(", ") })}</span>
              ) : null}
            </label>
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm">
              <span className="text-muted-foreground">{t("autoRunConfig.commands")}:</span>
              <span className="flex items-center gap-1.5">verify {cmdBadge(config.commands.verify)}</span>
              <span className="flex items-center gap-1.5">decider {cmdBadge(config.commands.decider)}</span>
              <span className="flex items-center gap-1.5">judge {cmdBadge(config.commands.judge)}</span>
              <span className="flex items-center gap-1.5">review {cmdBadge(config.commands.review)}</span>
            </div>
            {config.verifyCommandNames.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                {t("autoRunConfig.verifyCommands", { commands: config.verifyCommandNames.join(", ") })}
              </p>
            ) : null}
          </Section>

          <Section title={t("autoRunConfig.alerting")}>
            <label className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2">
              <span className="text-sm font-medium">{t("autoRunConfig.webhook")}</span>
              <span className="text-xs text-muted-foreground">{t("autoRunConfig.webhookHint")}</span>
              <Input value={draft.alertWebhookUrl} onChange={(e) => set("alertWebhookUrl", e.target.value)} placeholder="https://hooks.example.com/..." className="mt-0.5 h-8" />
            </label>
            <label className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2">
              <span className="flex items-center gap-2 text-sm font-medium">
                {sessionTeam?.name ?? sessionTeamId ?? "Team"} · {t("autoRunConfig.webhook")}
                {cmdBadge(Boolean(sessionTeam?.alertWebhookConfigured))}
              </span>
              <span className="text-xs text-muted-foreground">{t("autoRunConfig.webhookHint")}</span>
              <div className="flex gap-2">
                <Input value={teamWebhookUrl} onChange={(e) => { setTeamWebhookUrl(e.target.value); setTeamWebhookSaved(false); }} placeholder="https://hooks.example.com/team/..." className="mt-0.5 h-8" />
                <Button type="button" size="sm" variant="secondary" disabled={teamWebhookSaving || !canReplaceTeamWebhook(teamWebhookUrl)} onClick={() => void saveTeamWebhook()}>
                  {teamWebhookSaving ? <RefreshCw className="size-3.5 animate-spin" /> : t("autoRunConfig.save")}
                </Button>
                {sessionTeam?.alertWebhookConfigured ? (
                  <Button type="button" size="sm" variant="ghost" disabled={teamWebhookSaving} onClick={() => void clearTeamWebhook()}>
                    {t("documents.clear")}
                  </Button>
                ) : null}
              </div>
              {teamWebhookSaved ? <span className="text-xs text-emerald-600">{t("autoRunConfig.saved")}</span> : null}
            </label>
            <div className="grid gap-2 md:grid-cols-2">
              <NumberField label={t("autoRunConfig.sloPr")} hint={t("autoRunConfig.ratioHint")} value={draft.sloTargets.prSuccessRate} step={0.05} min={0} max={1} onChange={(v) => set("sloTargets", { ...draft.sloTargets, prSuccessRate: v })} />
              <NumberField label={t("autoRunConfig.sloFailure")} hint={t("autoRunConfig.ratioHint")} value={draft.sloTargets.failureRate} step={0.05} min={0} max={1} onChange={(v) => set("sloTargets", { ...draft.sloTargets, failureRate: v })} />
              <NumberField label={t("autoRunConfig.sloAttention")} hint={t("autoRunConfig.ratioHint")} value={draft.sloTargets.attentionRate} step={0.05} min={0} max={1} onChange={(v) => set("sloTargets", { ...draft.sloTargets, attentionRate: v })} />
              <NumberField label={t("autoRunConfig.sloTime")} hint={t("autoRunConfig.secondsHint")} value={draft.sloTargets.timeToPrMedianSeconds} step={60} min={1} onChange={(v) => set("sloTargets", { ...draft.sloTargets, timeToPrMedianSeconds: v })} />
              <NumberField label={t("routingThresholdConfig.samples")} value={draft.routingThresholds.minSamples} min={1} max={1000} onChange={(v) => set("routingThresholds", { ...draft.routingThresholds, minSamples: v })} />
              <NumberField label={t("routingThresholdConfig.window")} value={draft.routingThresholds.windowDays} min={1} max={365} onChange={(v) => set("routingThresholds", { ...draft.routingThresholds, windowDays: v })} />
              <NumberField label={t("routingThresholdConfig.fallback")} hint={t("autoRunConfig.ratioHint")} value={draft.routingThresholds.fallbackRate} step={0.05} min={0} max={1} onChange={(v) => set("routingThresholds", { ...draft.routingThresholds, fallbackRate: v })} />
              <NumberField label={t("routingThresholdConfig.confidence")} hint={t("autoRunConfig.ratioHint")} value={draft.routingThresholds.lowConfidenceRate} step={0.05} min={0} max={1} onChange={(v) => set("routingThresholds", { ...draft.routingThresholds, lowConfidenceRate: v })} />
              <NumberField label={t("routingThresholdConfig.latency")} value={draft.routingThresholds.latencyP90Ms} step={500} min={1} max={300000} onChange={(v) => set("routingThresholds", { ...draft.routingThresholds, latencyP90Ms: v })} />
            </div>
          </Section>

          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

          <div className="flex items-center gap-3">
            <Button size="sm" variant="primary" disabled={saving} onClick={() => void save()}>
              {saving ? <RefreshCw className="mr-1 size-3.5 animate-spin" /> : null} {t("autoRunConfig.save")}
            </Button>
            <Button size="sm" variant="secondary" disabled={saving} onClick={applyRecommended} title={t("autoRunConfig.recommendedHint")}>
              {t("autoRunConfig.recommended")}
            </Button>
            {savedAt ? <span className="text-xs text-muted-foreground">{t("autoRunConfig.saved")}</span> : null}
          </div>
          </fieldset>
        </CardContent>
      ) : null}
    </Card>
  );
}
