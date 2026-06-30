import { useState } from "react";
import { Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { useConsoleState } from "@/data/use-console-state";
import { useUiStore } from "@/store/ui-store";

type Tone = "neutral" | "warning" | "danger";
interface Mode {
  value: string;
  label: string;
  hint: string;
  tone: Tone;
}

interface CodingAgentConfig {
  command: string;
  title: string;
  blurb: React.ReactNode;
  /** Payload key for the chosen mode: Codex sandbox vs Claude permission mode. */
  modeField: "sandbox" | "permissionMode";
  modeLabel: string;
  /** The safe (non-writable) mode value. */
  safeMode: string;
  defaultMode: string;
  modes: Mode[];
}

const CONFIGS: Record<"codex" | "claude", CodingAgentConfig> = {
  codex: {
    command: "codex",
    title: "Connect Codex CLI",
    blurb: (
      <>
        Registers <code className="font-mono">codex exec --json</code> with the sandbox you choose.
      </>
    ),
    modeField: "sandbox",
    modeLabel: "Sandbox",
    safeMode: "read-only",
    defaultMode: "workspace-write",
    modes: [
      { value: "read-only", label: "Read-only", hint: "Reads the repo; cannot edit files. Safest.", tone: "neutral" },
      {
        value: "workspace-write",
        label: "Workspace-write",
        hint: "Can edit files in the working directory. Approval required on every run.",
        tone: "warning",
      },
      {
        value: "danger-full-access",
        label: "Full access",
        hint: "No sandbox — can edit anywhere and use the network. Highest risk.",
        tone: "danger",
      },
    ],
  },
  claude: {
    command: "claude",
    title: "Connect Claude Code",
    blurb: (
      <>
        Registers <code className="font-mono">claude -p</code> (stream-json) with the permission mode you choose.
      </>
    ),
    modeField: "permissionMode",
    modeLabel: "Permission mode",
    safeMode: "plan",
    defaultMode: "acceptEdits",
    modes: [
      { value: "plan", label: "Plan", hint: "Plans only; cannot edit files. Safest.", tone: "neutral" },
      {
        value: "acceptEdits",
        label: "Accept edits",
        hint: "Auto-accepts file edits in the working directory. Approval required on every run.",
        tone: "warning",
      },
      {
        value: "bypassPermissions",
        label: "Bypass permissions",
        hint: "Skips all permission prompts — can edit and run anything. Highest risk.",
        tone: "danger",
      },
    ],
  },
};

export function RegisterCodingAgentCard({ kind }: { kind: "codex" | "claude" }) {
  const config = CONFIGS[kind];
  const kindLabel = kind === "codex" ? "Codex" : "Claude";
  const setSelectedAgentId = useUiStore((s) => s.setSelectedAgentId);
  const setSection = useUiStore((s) => s.setSection);
  const { data: state } = useConsoleState();
  const { execute, pending, error } = useAsyncAction();

  const [name, setName] = useState(config.title.replace("Connect ", ""));
  const [mode, setMode] = useState(config.defaultMode);
  const [costOwner, setCostOwner] = useState("usr_local");

  // Reflect live registration state so the button is honest across reloads.
  // Same command + mode upserts (an update); a new mode adds a distinct agent.
  const existing = (state?.agents ?? []).filter((agent) => agent.adapter?.command === config.command);
  const registeredModes = existing.map((agent) => agent.adapter?.[config.modeField]);
  const alreadyRegistered = existing.length > 0;
  const modeAlreadyRegistered = registeredModes.includes(mode);
  const active = config.modes.find((m) => m.value === mode)!;
  const writable = mode !== config.safeMode;

  async function register() {
    await execute(async () => {
      const result = (await api.registerAgent({
        type: "cli",
        command: config.command,
        name: `${name} (${mode})`,
        [config.modeField]: mode,
        outputFormat: kind === "codex" ? "codex_jsonl" : "claude_jsonl",
        timeoutSeconds: 180,
        cancellation: "supported",
        costOwner: costOwner.trim() || "usr_local",
      })) as { agent: { id: string } };
      setSelectedAgentId(result.agent.id);
      return result;
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{config.title}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {config.blurb} This coding agent is always high-risk, so every run requires local approval.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={config.modeLabel}>
            <Select value={mode} onChange={(e) => setMode(e.target.value)}>
              {config.modes.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Cost owner">
            <Input value={costOwner} onChange={(e) => setCostOwner(e.target.value)} />
          </Field>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
          <Badge tone={active.tone}>{active.label}</Badge>
          <p className="text-muted-foreground">{active.hint}</p>
        </div>
        {writable ? (
          <p className="text-xs text-warning">
            Writable mode lets this agent modify files in its working directory. The approval gate keeps it safe —
            review each run before approving.
          </p>
        ) : null}

        <div className="flex items-center gap-3">
          <Button
            variant={alreadyRegistered ? "secondary" : "primary"}
            disabled={pending}
            onClick={register}
          >
            {pending
              ? "Registering…"
              : modeAlreadyRegistered
                ? `Update ${kindLabel} (${mode})`
                : alreadyRegistered
                  ? `Register another ${kindLabel}`
                  : `Register ${kindLabel}`}
          </Button>
          {alreadyRegistered ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-success underline-offset-2 hover:underline"
              onClick={() => setSection("agents")}
            >
              <Check className="size-3.5" />
              {existing.length} {kindLabel} agent{existing.length > 1 ? "s" : ""} registered — open in Agents →
            </button>
          ) : null}
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
