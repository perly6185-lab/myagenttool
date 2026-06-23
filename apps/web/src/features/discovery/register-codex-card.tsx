import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { useUiStore } from "@/store/ui-store";

type Sandbox = "read-only" | "workspace-write" | "danger-full-access";

const SANDBOXES: { value: Sandbox; label: string; hint: string; tone: "neutral" | "warning" | "danger" }[] = [
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
];

export function RegisterCodexCard() {
  const setSelectedAgentId = useUiStore((s) => s.setSelectedAgentId);
  const setSection = useUiStore((s) => s.setSection);
  const { execute, pending, error } = useAsyncAction();

  const [name, setName] = useState("Codex CLI");
  const [sandbox, setSandbox] = useState<Sandbox>("workspace-write");
  const [costOwner, setCostOwner] = useState("usr_local");
  const [registered, setRegistered] = useState<string | null>(null);

  const active = SANDBOXES.find((s) => s.value === sandbox)!;
  const writable = sandbox !== "read-only";

  async function register() {
    await execute(async () => {
      const result = (await api.registerAgent({
        type: "cli",
        command: "codex",
        name: `${name} (${sandbox})`,
        sandbox,
        outputFormat: "codex_jsonl",
        timeoutSeconds: 180,
        cancellation: "supported",
        costOwner: costOwner.trim() || "usr_local",
      })) as { agent: { id: string; status: string } };
      setSelectedAgentId(result.agent.id);
      setRegistered(result.agent.id);
      return result;
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect Codex CLI</CardTitle>
        <p className="text-sm text-muted-foreground">
          Registers <code className="font-mono">codex exec --json</code> with the sandbox you choose. Codex is
          always high-risk, so every run requires local approval.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Sandbox">
            <Select value={sandbox} onChange={(e) => setSandbox(e.target.value as Sandbox)}>
              {SANDBOXES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
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
            Writable mode lets Codex modify files in its working directory. It stays disabled-by-default safe via
            the approval gate — review each run before approving.
          </p>
        ) : null}

        <div className="flex items-center gap-3">
          <Button disabled={pending} onClick={register}>
            Register Codex
          </Button>
          {registered ? (
            <button
              type="button"
              className="text-xs text-primary underline-offset-2 hover:underline"
              onClick={() => setSection("agents")}
            >
              Registered {registered} — open in Agents →
            </button>
          ) : null}
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
