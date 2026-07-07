import { useCallback, useEffect, useState } from "react";
import { Settings2, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { api } from "@/data/use-console-actions";
import { cn } from "@/lib/cn";

interface AutoRunConfig {
  autoTrigger: { enabled: boolean; label: string; maxConcurrent: number; requireProjectFields: boolean };
  statusWriteback: boolean;
  spawnIssues: boolean;
  decision: { minConfidence: number; fastPath: boolean };
  deciderTimeoutMs: number;
  judgeTimeoutMs: number;
  requireChecksGreenToMerge: boolean;
  autonomyKillSwitch: boolean;
  autoApproveNonCodePaths: boolean;
  globalMaxConcurrent: number;
  breakerFailureThreshold: number;
  breakerCooldownMinutes: number;
  commands: { verify: boolean; decider: boolean; judge: boolean };
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
  autoApproveNonCodePaths: boolean;
  alertWebhookUrl: string;
  globalMaxConcurrent: number;
  breakerFailureThreshold: number;
  breakerCooldownMinutes: number;
  sloTargets: { prSuccessRate: number; failureRate: number; attentionRate: number; timeToPrMedianSeconds: number };
}

const SLO_DEFAULTS = { prSuccessRate: 0.7, failureRate: 0.2, attentionRate: 0.5, timeToPrMedianSeconds: 1800 };

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
    autoApproveNonCodePaths: c.autoApproveNonCodePaths,
    alertWebhookUrl: (c.settings?.alertWebhookUrl as string) ?? "",
    globalMaxConcurrent: c.globalMaxConcurrent,
    breakerFailureThreshold: c.breakerFailureThreshold,
    breakerCooldownMinutes: c.breakerCooldownMinutes,
    sloTargets: { ...SLO_DEFAULTS, ...((c.settings?.sloTargets as Partial<typeof SLO_DEFAULTS>) ?? {}) },
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
  const [config, setConfig] = useState<AutoRunConfig | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(false);

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
    setDraft((d) => (d ? { ...d, ...RECOMMENDED_SAFE_DEFAULTS, sloTargets: { ...SLO_DEFAULTS } } : d));
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const data = (await api.updateAutoRunSettings(draft as unknown as Record<string, unknown>)) as { config?: AutoRunConfig };
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

  if (!config || !draft) return null;

  const cmdBadge = (on: boolean) => (
    <Badge tone={on ? "success" : "neutral"}>{on ? "configured" : "not configured"}</Badge>
  );

  return (
    <Card>
      <CardHeader className="cursor-pointer" onClick={() => setOpen((v) => !v)}>
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2">
            {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            <Settings2 className="size-4" /> Configuration
          </span>
          <span className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
            {config.autoTrigger.enabled ? <Badge tone="success">auto-trigger on</Badge> : <Badge tone="neutral">auto-trigger off</Badge>}
            {config.statusWriteback ? <Badge tone="running">status writeback</Badge> : null}
          </span>
        </CardTitle>
      </CardHeader>
      {open ? (
        <CardContent className="flex flex-col gap-4">
          {/* O0 kill switch — global emergency brake, applies immediately. */}
          <label className={cn("flex items-center justify-between gap-3 rounded-lg border px-3 py-2", draft.autonomyKillSwitch ? "border-red-500/60 bg-red-500/5" : "border-border")}>
            <span className="min-w-0">
              <span className={cn("block text-sm font-semibold", draft.autonomyKillSwitch && "text-red-600 dark:text-red-400")}>Kill switch — halt all autonomous runs</span>
              <span className="block text-xs text-muted-foreground">Applies immediately: auto-trigger stops scanning and new runs are refused. Merge is unaffected.</span>
            </span>
            <input type="checkbox" className="mt-0.5 shrink-0" checked={draft.autonomyKillSwitch} onChange={(e) => set("autonomyKillSwitch", e.target.checked)} />
          </label>
          <p className="text-xs text-muted-foreground">
            Safe knobs are editable here; saved values <strong>apply on the next server start</strong> (the kill switch and require-green-checks apply immediately). The verify / decider /
            judge <em>commands</em> stay env-only (they choose what runs — a trust boundary) and show read-only below.
          </p>

          <Section title="Autonomy">
            <div className="grid gap-2 md:grid-cols-2">
              <Toggle label="Auto-trigger" hint="Start an auto-run for each new labelled issue." checked={draft.autoTriggerEnabled} onChange={(v) => set("autoTriggerEnabled", v)} />
              <Toggle label="Require Project Fields" hint="Only auto-trigger issues carrying ## Project Fields." checked={draft.autoTriggerRequireProjectFields} onChange={(v) => set("autoTriggerRequireProjectFields", v)} />
              <Toggle label="Auto-approve non-code paths" hint="Skip human approval for design/clarify/prototype runs (no code, no PR). develop + merge stay human." checked={draft.autoApproveNonCodePaths} onChange={(v) => set("autoApproveNonCodePaths", v)} />
              <Toggle label="Decider fast path" hint="Strong lexical signals skip the LLM decider hop." checked={draft.deciderFastPath} onChange={(v) => set("deciderFastPath", v)} />
              <label className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2">
                <span className="text-sm font-medium">Auto-trigger label</span>
                <span className="text-xs text-muted-foreground">Issue label that opts a run in.</span>
                <Input value={draft.autoTriggerLabel} onChange={(e) => set("autoTriggerLabel", e.target.value)} className="mt-0.5 h-8" />
              </label>
              <NumberField label="Decision min confidence" hint="0–1; low-confidence heavy paths degrade to clarify." value={draft.decisionMinConfidence} step={0.05} min={0} max={1} onChange={(v) => set("decisionMinConfidence", v)} />
            </div>
          </Section>

          <Section title="Reliability & capacity">
            <div className="grid gap-2 md:grid-cols-2">
              <NumberField label="Max concurrent / project" value={draft.autoTriggerMaxConcurrent} min={1} max={10} onChange={(v) => set("autoTriggerMaxConcurrent", v)} />
              <NumberField label="Global max concurrent" hint="System-wide in-flight cap (0 = unlimited)." value={draft.globalMaxConcurrent} min={0} max={100} onChange={(v) => set("globalMaxConcurrent", v)} />
              <NumberField label="Breaker failure threshold" hint="Open the circuit breaker after N consecutive failures (0 = off)." value={draft.breakerFailureThreshold} min={0} max={50} onChange={(v) => set("breakerFailureThreshold", v)} />
              <NumberField label="Breaker cooldown (min)" hint="How long the breaker stays open before auto-resuming." value={draft.breakerCooldownMinutes} min={1} max={1440} onChange={(v) => set("breakerCooldownMinutes", v)} />
              <NumberField label="Decider timeout (ms)" value={draft.deciderTimeoutMs} step={1000} min={1000} max={300000} onChange={(v) => set("deciderTimeoutMs", v)} />
              <NumberField label="Judge timeout (ms)" value={draft.judgeTimeoutMs} step={1000} min={1000} max={300000} onChange={(v) => set("judgeTimeoutMs", v)} />
            </div>
          </Section>

          <Section title="Quality & merge">
            <div className="grid gap-2 md:grid-cols-2">
              <Toggle label="Require green PR checks to merge" hint="Block the in-tool Merge unless the PR's checks are green (applies immediately)." checked={draft.requireChecksGreenToMerge} onChange={(v) => set("requireChecksGreenToMerge", v)} />
              <Toggle label="Status writeback" hint="Move the linked issue's status label as the run advances." checked={draft.statusWriteback} onChange={(v) => set("statusWriteback", v)} />
              <Toggle label="Spawn child issues" hint="A design decision spawns a governed child issue." checked={draft.spawnIssues} onChange={(v) => set("spawnIssues", v)} />
            </div>
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm">
              <span className="text-muted-foreground">Commands (env-only):</span>
              <span className="flex items-center gap-1.5">verify {cmdBadge(config.commands.verify)}</span>
              <span className="flex items-center gap-1.5">decider {cmdBadge(config.commands.decider)}</span>
              <span className="flex items-center gap-1.5">judge {cmdBadge(config.commands.judge)}</span>
            </div>
            {config.verifyCommandNames.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Per-project verify commands available (select by name via project settings): {config.verifyCommandNames.join(", ")}.
              </p>
            ) : null}
          </Section>

          <Section title="Alerting & SLOs">
            <label className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2">
              <span className="text-sm font-medium">Alert webhook URL</span>
              <span className="text-xs text-muted-foreground">Real-time operational alerts (budget breach, stuck-run reap) POST here. http(s) only; blank disables. Applies immediately.</span>
              <Input value={draft.alertWebhookUrl} onChange={(e) => set("alertWebhookUrl", e.target.value)} placeholder="https://hooks.example.com/..." className="mt-0.5 h-8" />
            </label>
            <div className="grid gap-2 md:grid-cols-2">
              <NumberField label="SLO: PR success rate ≥" hint="0–1 target line." value={draft.sloTargets.prSuccessRate} step={0.05} min={0} max={1} onChange={(v) => set("sloTargets", { ...draft.sloTargets, prSuccessRate: v })} />
              <NumberField label="SLO: failure rate ≤" hint="0–1 target line." value={draft.sloTargets.failureRate} step={0.05} min={0} max={1} onChange={(v) => set("sloTargets", { ...draft.sloTargets, failureRate: v })} />
              <NumberField label="SLO: human-attention rate ≤" hint="0–1 target line." value={draft.sloTargets.attentionRate} step={0.05} min={0} max={1} onChange={(v) => set("sloTargets", { ...draft.sloTargets, attentionRate: v })} />
              <NumberField label="SLO: time to PR ≤ (s)" hint="Median seconds target line." value={draft.sloTargets.timeToPrMedianSeconds} step={60} min={1} onChange={(v) => set("sloTargets", { ...draft.sloTargets, timeToPrMedianSeconds: v })} />
            </div>
          </Section>

          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

          <div className="flex items-center gap-3">
            <Button size="sm" variant="primary" disabled={saving} onClick={() => void save()}>
              {saving ? <RefreshCw className="mr-1 size-3.5 animate-spin" /> : null} Save settings
            </Button>
            <Button size="sm" variant="secondary" disabled={saving} onClick={applyRecommended} title="Load a conservative safe posture (autonomy off, guardrails on, brakes armed) — review, then Save.">
              Recommended defaults
            </Button>
            {savedAt ? <span className="text-xs text-muted-foreground">Saved — applies on the next server start.</span> : null}
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}
