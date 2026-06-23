import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { EmptyState } from "@/components/common/empty-state";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/cn";
import { readableAdapterType, readableReviewState } from "@/lib/readable-labels";
import type { IntegrationPayload } from "@/lib/api-client";
import type { IntegrationArtifact } from "@/lib/console-state";

interface BuilderForm {
  targetType: string;
  description: string;
  command: string;
  baseUrl: string;
  workingDirectory: string;
  environmentNeeds: string;
  cancellation: string;
  streaming: boolean;
  costOwner: string;
  economicModel: string;
}

const INITIAL_FORM: BuilderForm = {
  targetType: "cli",
  description: "I have an unsupported local CLI agent. It can receive a task and return a summary.",
  command: "demo-agent",
  baseUrl: "http://127.0.0.1:3212",
  workingDirectory: "",
  environmentNeeds: "No secrets required",
  cancellation: "unknown",
  streaming: false,
  costOwner: "usr_local",
  economicModel: "unknown",
};

const ARTIFACT_ACTIONS = ["review", "approve", "reject", "archive", "probe", "register"] as const;

function toPayload(form: BuilderForm): IntegrationPayload {
  return {
    targetType: form.targetType,
    title: "Unsupported agent integration",
    description: form.description.trim(),
    command: form.command.trim(),
    baseUrl: form.baseUrl.trim(),
    workingDirectory: form.workingDirectory.trim(),
    environmentNeeds: form.environmentNeeds.trim(),
    cancellation: form.cancellation,
    streaming: form.streaming,
    costOwner: form.costOwner.trim() || "usr_local",
    economicModel: form.economicModel,
  };
}

function actionDisabled(action: string, artifact: IntegrationArtifact): boolean {
  const { artifactType, reviewState } = artifact;
  if (action === "probe")
    return artifactType !== "adapter_config" || !["approved", "tested"].includes(reviewState);
  if (action === "register")
    return artifactType !== "adapter_config" || reviewState !== "tested";
  if (action === "approve")
    return ["approved", "tested", "enabled", "archived"].includes(reviewState);
  if (action === "review")
    return ["needs_review", "tested", "enabled", "archived"].includes(reviewState);
  if (action === "reject") return ["rejected", "enabled", "archived"].includes(reviewState);
  if (action === "archive") return reviewState === "archived";
  return false;
}

export function IntegrationsView() {
  const { data: state } = useConsoleState();
  const selectedArtifactId = useUiStore((s) => s.selectedArtifactId);
  const setSelectedArtifactId = useUiStore((s) => s.setSelectedArtifactId);
  const { execute, pending, error } = useAsyncAction();
  const [form, setForm] = useState<BuilderForm>(INITIAL_FORM);

  const artifacts = state?.integrationArtifacts ?? [];
  const probeRuns = state?.integrationProbeRuns ?? [];
  const selectedPlan =
    artifacts.find((item) => item.id === selectedArtifactId) ?? artifacts[0] ?? null;
  const noIntent = form.description.trim().length === 0;

  function update<K extends keyof BuilderForm>(key: K, value: BuilderForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function saveDraft() {
    await execute(async () => {
      const data = (await api.createIntegrationArtifact({
        ...toPayload(form),
        artifactType: "integration_plan",
        reviewState: "draft",
        generatedByAi: false,
      })) as { artifact: { id: string } };
      setSelectedArtifactId(data.artifact.id);
      return data;
    });
  }

  async function platformDraft() {
    await execute(async () => {
      const data = (await api.builderDraft(toPayload(form))) as { artifact: { id: string } };
      setSelectedArtifactId(data.artifact.id);
      return data;
    });
  }

  function generate() {
    if (!selectedPlan) return;
    void execute(() => api.artifactAction(selectedPlan.id, "generate"));
  }

  const generateDisabled =
    pending ||
    !selectedPlan ||
    selectedPlan.artifactType !== "integration_plan" ||
    ["archived", "rejected"].includes(selectedPlan.reviewState);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <Card>
        <CardHeader>
          <CardTitle>Connect unsupported agent</CardTitle>
          <p className="text-sm text-muted-foreground">
            Drafts stay disabled until reviewed, tested, and registered explicitly.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea rows={4} value={form.description} onChange={(e) => update("description", e.target.value)} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Adapter hint">
              <Select value={form.targetType} onChange={(e) => update("targetType", e.target.value)}>
                <option value="cli">Local command</option>
                <option value="http">HTTP endpoint</option>
              </Select>
            </Field>
            <Field label="Cancellation">
              <Select value={form.cancellation} onChange={(e) => update("cancellation", e.target.value)}>
                <option value="unknown">Unknown</option>
                <option value="supported">Supported</option>
                <option value="unsupported">Unsupported</option>
              </Select>
            </Field>
            <Field label="Command">
              <Input value={form.command} onChange={(e) => update("command", e.target.value)} />
            </Field>
            <Field label="URL">
              <Input value={form.baseUrl} onChange={(e) => update("baseUrl", e.target.value)} />
            </Field>
            <Field label="Working directory">
              <Input
                value={form.workingDirectory}
                onChange={(e) => update("workingDirectory", e.target.value)}
              />
            </Field>
            <Field label="Environment needs">
              <Input
                value={form.environmentNeeds}
                onChange={(e) => update("environmentNeeds", e.target.value)}
              />
            </Field>
            <Field label="Cost owner">
              <Input value={form.costOwner} onChange={(e) => update("costOwner", e.target.value)} />
            </Field>
            <Field label="Cost model">
              <Select value={form.economicModel} onChange={(e) => update("economicModel", e.target.value)}>
                <option value="unknown">Unknown</option>
                <option value="free">Free</option>
                <option value="external_billed">External billed</option>
                <option value="internal_chargeback">Internal chargeback</option>
              </Select>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.streaming}
              onChange={(e) => update("streaming", e.target.checked)}
            />
            Streaming
          </label>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={pending || noIntent} onClick={saveDraft}>
              Save draft
            </Button>
            <Button variant="secondary" disabled={pending || noIntent} onClick={platformDraft}>
              Platform draft
            </Button>
            <Button variant="secondary" disabled={generateDisabled} onClick={generate}>
              Generate artifacts
            </Button>
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </CardContent>
      </Card>

      <div className="space-y-4">
        {artifacts.length === 0 ? (
          <EmptyState title="No artifacts yet" hint="Draft an unsupported integration to begin review." />
        ) : (
          artifacts.slice(0, 12).map((artifact) => {
            const probe = probeRuns.find((item) => item.artifactId === artifact.id);
            const active = artifact.id === selectedPlan?.id;
            return (
              <Card
                key={artifact.id}
                className={cn("cursor-pointer", active && "border-primary/40")}
                onClick={() => setSelectedArtifactId(artifact.id)}
              >
                <CardHeader>
                  <CardTitle>{artifact.summary}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {artifact.payload?.adapterGuidance ?? "Review this generated integration artifact before use."}
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge>Type: {artifact.artifactType.replaceAll("_", " ")}</Badge>
                    <Badge>Adapter: {readableAdapterType(artifact.targetType)}</Badge>
                    <Badge tone={artifact.reviewState === "enabled" ? "success" : "neutral"}>
                      Review: {readableReviewState(artifact.reviewState)}
                    </Badge>
                    <Badge>{artifact.generatedByAi ? "Generated by AI" : "User draft"}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {probe ? `${probe.summary} (${probe.status})` : "Probe has not run."}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {ARTIFACT_ACTIONS.map((action) => (
                      <Button
                        key={action}
                        size="sm"
                        variant="secondary"
                        disabled={pending || actionDisabled(action, artifact)}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedArtifactId(artifact.id);
                          void execute(() => api.artifactAction(artifact.id, action));
                        }}
                      >
                        {action === "register" ? "Register disabled" : action[0].toUpperCase() + action.slice(1)}
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
