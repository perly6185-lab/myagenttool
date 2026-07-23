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
import { readableReviewState } from "@/lib/readable-labels";
import type { IntegrationPayload } from "@/lib/api-client";
import type { IntegrationArtifact } from "@/lib/console-state";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { adapterType } from "@/lib/i18n/readable-labels";

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
  const { t } = useAppTranslation();
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
          <CardTitle>{t("integrationsPage.title")}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {t("integrationsPage.description")}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea rows={4} value={form.description} onChange={(e) => update("description", e.target.value)} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("integrationsPage.adapterHint")}>
              <Select value={form.targetType} onChange={(e) => update("targetType", e.target.value)}>
                <option value="cli">{t("integrationsPage.localCommand")}</option>
                <option value="http">{t("integrationsPage.httpEndpoint")}</option>
              </Select>
            </Field>
            <Field label={t("integrationsPage.cancellation")}>
              <Select value={form.cancellation} onChange={(e) => update("cancellation", e.target.value)}>
                <option value="unknown">{t("integrationsPage.unknown")}</option>
                <option value="supported">{t("integrationsPage.supported")}</option>
                <option value="unsupported">{t("integrationsPage.unsupported")}</option>
              </Select>
            </Field>
            <Field label={t("integrationsPage.command")}>
              <Input value={form.command} onChange={(e) => update("command", e.target.value)} />
            </Field>
            <Field label={t("integrationsPage.url")}>
              <Input value={form.baseUrl} onChange={(e) => update("baseUrl", e.target.value)} />
            </Field>
            <Field label={t("integrationsPage.workingDirectory")}>
              <Input
                value={form.workingDirectory}
                onChange={(e) => update("workingDirectory", e.target.value)}
              />
            </Field>
            <Field label={t("integrationsPage.environmentNeeds")}>
              <Input
                value={form.environmentNeeds}
                onChange={(e) => update("environmentNeeds", e.target.value)}
              />
            </Field>
            <Field label={t("integrationsPage.costOwner")}>
              <Input value={form.costOwner} onChange={(e) => update("costOwner", e.target.value)} />
            </Field>
            <Field label={t("integrationsPage.costModel")}>
              <Select value={form.economicModel} onChange={(e) => update("economicModel", e.target.value)}>
                <option value="unknown">{t("integrationsPage.unknown")}</option>
                <option value="free">{t("integrationsPage.free")}</option>
                <option value="external_billed">{t("integrationsPage.externalBilled")}</option>
                <option value="internal_chargeback">{t("integrationsPage.internalChargeback")}</option>
              </Select>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.streaming}
              onChange={(e) => update("streaming", e.target.checked)}
            />
            {t("integrationsPage.streaming")}
          </label>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={pending || noIntent} onClick={saveDraft}>
              {t("integrationsPage.saveDraft")}
            </Button>
            <Button variant="secondary" disabled={pending || noIntent} onClick={platformDraft}>
              {t("integrationsPage.platformDraft")}
            </Button>
            <Button variant="secondary" disabled={generateDisabled} onClick={generate}>
              {t("integrationsPage.generate")}
            </Button>
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </CardContent>
      </Card>

      <div className="space-y-4">
        {artifacts.length === 0 ? (
          <EmptyState title={t("integrationsPage.empty")} hint={t("integrationsPage.emptyHint")} />
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
                    {artifact.payload?.adapterGuidance ?? t("integrationsPage.reviewHint")}
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge>{t("integrationsPage.type")}: {artifact.artifactType.replaceAll("_", " ")}</Badge>
                    <Badge>{t("integrationsPage.adapter")}: {adapterType(t, artifact.targetType)}</Badge>
                    <Badge tone={artifact.reviewState === "enabled" ? "success" : "neutral"}>
                      {t("integrationsPage.review")}: {readableReviewState(artifact.reviewState)}
                    </Badge>
                    <Badge>{t(artifact.generatedByAi ? "integrationsPage.aiGenerated" : "integrationsPage.userDraft")}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {probe ? `${probe.summary} (${probe.status})` : t("integrationsPage.noProbe")}
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
                        {t(action === "register" ? "integrationsPage.registerDisabled" : `integrationsPage.action.${action}` as never)}
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
