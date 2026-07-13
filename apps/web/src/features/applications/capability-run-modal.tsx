import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import {
  buildInvokeBody,
  capabilityRunContract,
  explainRunFailure,
  runBlocker,
  type RunFormState,
} from "@/features/applications/capability-run";
import type { ApplicationCapability } from "@/lib/console-state";

/**
 * Run an Application capability (#800).
 *
 * Generic on purpose: the form is built from the capability's PUBLISHED contract
 * (its declared inputs, whether it needs a repository, whether it needs approval).
 * It contains no knowledge of git, or of any other application — the next one must
 * work here without a rewrite.
 *
 * It shows the operator a capability and a repository. It never shows argv, the
 * wrapper path, or the device's command allowlist.
 */
export function CapabilityRunModal({
  capability,
  onClose,
  onRan,
}: {
  capability: ApplicationCapability | null;
  onClose: () => void;
  onRan: (invocationId: string) => void;
}) {
  const { data: state } = useConsoleState();
  const { execute, pending, error } = useAsyncAction();
  const [form, setForm] = useState<RunFormState>({ projectId: "", values: {} });

  const projects = state?.projects ?? [];
  const contract = useMemo(
    () => (capability ? capabilityRunContract(capability) : null),
    [capability],
  );

  if (!capability || !contract) return null;

  const blocker = runBlocker(contract, form);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!capability || !contract || blocker) return;
    void execute(async () => {
      const result = (await api.invokeCapability(
        capability.name,
        buildInvokeBody(contract, form),
      )) as { invocationId?: string };
      if (result?.invocationId) {
        onRan(result.invocationId);
        onClose();
      }
      return result;
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={capability.displayName ?? capability.name}
      description={capability.description ?? "Run this governed application capability."}
      size="lg"
    >
      <form className="space-y-3" onSubmit={submit}>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={capability.riskLevel === "low" ? "neutral" : "warning"}>
            {capability.riskLevel ?? "—"} risk
          </Badge>
          {contract.requiresApproval ? <Badge tone="warning">needs approval</Badge> : null}
          {capability.metadata?.wrapper?.filePolicy ? (
            <Badge tone="neutral">files: {capability.metadata.wrapper.filePolicy}</Badge>
          ) : null}
          {capability.metadata?.wrapper?.networkPolicy ? (
            <Badge tone="neutral">network: {capability.metadata.wrapper.networkPolicy}</Badge>
          ) : null}
        </div>

        {contract.needsProject ? (
          <Field label="Repository">
            <Select
              value={form.projectId}
              onChange={(e) => setForm((prev) => ({ ...prev, projectId: e.target.value }))}
            >
              <option value="">Choose a repository…</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              This command runs inside the repository you choose, on the device that owns it.
            </p>
          </Field>
        ) : null}

        {contract.inputs.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {contract.inputs.map((input) => (
              <Field key={input.key} label={`${input.key} (optional)`}>
                {input.values.length ? (
                  <Select
                    value={form.values[input.key] ?? ""}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        values: { ...prev.values, [input.key]: e.target.value },
                      }))
                    }
                  >
                    <option value="">Any</option>
                    {input.values.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    value={form.values[input.key] ?? ""}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        values: { ...prev.values, [input.key]: e.target.value },
                      }))
                    }
                    placeholder={placeholderFor(input.type)}
                  />
                )}
              </Field>
            ))}
          </div>
        ) : null}

        {error ? <p className="text-xs text-destructive">{explainRunFailure(error)}</p> : null}

        <div className="flex items-center justify-between gap-2 pt-1">
          <p className="text-xs text-muted-foreground">{blocker ?? "Runs as a governed invocation."}</p>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending || Boolean(blocker)}>
              {pending ? "Running…" : "Run"}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function placeholderFor(type: string): string {
  if (type === "date") return "2026-07-01";
  if (type === "git-rev") return "HEAD";
  return "";
}
