import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { useUiStore } from "@/store/ui-store";
import { DescriptorFeedbackList, DescriptorRiskPreviewPanel, WrapperCapabilityImpactPanel } from "@/features/applications/descriptor-feedback";
import { applicationOnboardingGuide, type ApplicationOnboardingStep } from "@/features/applications/application-onboarding-guide";
import { generateApplicationIntegrationDrafts } from "@/features/applications/application-draft-generator";
import { descriptorRiskPreview, parseOptionalJsonObject, prettyJson, wrapperCapabilityImpact } from "@/features/applications/descriptor-utils";
import { NpmWrapperCommandBuilder } from "@/features/applications/wrapper-command-builder";
import { CheckCircle2, Circle, ListChecks } from "lucide-react";
import type { ApplicationIntegrationBrief, ApplicationRegisterRequest, ApplicationSnapshot, ApplicationSource } from "@/lib/console-state";

type SourceType = ApplicationSource["type"];

/** Register an application from a git / local / npm / manual source. */
export function RegisterApplicationModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: state } = useConsoleState();
  const setSection = useUiStore((s) => s.setSection);
  const setSelectedApplicationId = useUiStore((s) => s.setSelectedApplicationId);
  const setSelectedApplicationAutomationId = useUiStore((s) => s.setSelectedApplicationAutomationId);
  const { execute, pending, error, errorDetail } = useAsyncAction();

  const [sourceType, setSourceType] = useState<SourceType>("git");
  const [gitUrl, setGitUrl] = useState("");
  const [gitRef, setGitRef] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [npmPackage, setNpmPackage] = useState("");
  const [npmVersion, setNpmVersion] = useState("");
  const [manualUri, setManualUri] = useState("");
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [briefOpen, setBriefOpen] = useState(false);
  const [briefIntent, setBriefIntent] = useState("");
  const [briefDiscoverableCapabilities, setBriefDiscoverableCapabilities] = useState("");
  const [briefInvokableCapabilities, setBriefInvokableCapabilities] = useState("");
  const [briefDataBoundary, setBriefDataBoundary] = useState("");
  const [briefFixedCommands, setBriefFixedCommands] = useState("");
  const [briefUserInputs, setBriefUserInputs] = useState("");
  const [briefResultImport, setBriefResultImport] = useState("");
  const [briefApprovalsAndRecovery, setBriefApprovalsAndRecovery] = useState("");
  const [briefSmokeTests, setBriefSmokeTests] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [mcpDescriptor, setMcpDescriptor] = useState("");
  const [wrapperDescriptor, setWrapperDescriptor] = useState("");
  const [manualManifest, setManualManifest] = useState("");
  const [autoProbeAfterRegister, setAutoProbeAfterRegister] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState<string | null>(null);

  const projects = state?.projects ?? [];
  const previewApplicationId = useMemo(
    () => `app_${slugSegment(name.trim() || npmPackage.trim() || "npm_application")}`,
    [name, npmPackage],
  );
  const wrapperImpact = useMemo(
    () => sourceType === "npm" ? wrapperCapabilityImpact(previewApplicationId, null, wrapperDescriptor) : null,
    [previewApplicationId, sourceType, wrapperDescriptor],
  );

  function buildSource(): ApplicationSource | null {
    switch (sourceType) {
      case "git":
        return gitUrl.trim() ? { type: "git", url: gitUrl.trim(), ref: gitRef.trim() || null } : null;
      case "local":
        return localPath.trim() ? { type: "local", path: localPath.trim() } : null;
      case "npm":
        return npmPackage.trim()
          ? { type: "npm", package: npmPackage.trim(), version: npmVersion.trim() || null }
          : null;
      default:
        return { type: "manual", uri: manualUri.trim() || null };
    }
  }

  const source = buildSource();

  function buildIntegrationBrief(): ApplicationIntegrationBrief | null {
    const brief: ApplicationIntegrationBrief = {
      version: "application-intake.v1",
      status: "draft",
      intent: briefIntent.trim() || null,
      sourceType: inferredBriefSourceType(sourceType, {
        intent: briefIntent,
        dataBoundary: briefDataBoundary,
        approvalsAndRecovery: briefApprovalsAndRecovery,
        fixedCommands: briefFixedCommands,
      }),
      discoverableCapabilities: lines(briefDiscoverableCapabilities),
      invokableCapabilities: lines(briefInvokableCapabilities),
      dataBoundary: briefDataBoundary.trim() || null,
      fixedCommands: lines(briefFixedCommands),
      userInputs: briefUserInputs.trim() || null,
      resultImport: briefResultImport.trim() || null,
      approvalsAndRecovery: briefApprovalsAndRecovery.trim() || null,
      smokeTests: lines(briefSmokeTests),
      aiAssistance: {
        requested: true,
        nextDrafts: ["descriptor", "wrapper_or_mcp_adapter", "safe_probe", "smoke_tests", "review_notes"],
      },
    };
    const hasContent = [
      brief.intent,
      brief.dataBoundary,
      brief.userInputs,
      brief.resultImport,
      brief.approvalsAndRecovery,
      ...(brief.discoverableCapabilities ?? []),
      ...(brief.invokableCapabilities ?? []),
      ...(brief.fixedCommands ?? []),
      ...(brief.smokeTests ?? []),
    ].some(Boolean);
    return hasContent ? brief : null;
  }

  const integrationBrief = buildIntegrationBrief();
  const integrationDrafts = useMemo(() => {
    if (!source || !integrationBrief) return null;
    return generateApplicationIntegrationDrafts(previewApplication({
      id: previewApplicationId,
      name: name.trim() || npmPackage.trim() || localPath.trim().split(/[\\/]/).filter(Boolean).at(-1) || manualUri.trim() || "Application",
      source,
      integrationBrief,
    }));
  }, [integrationBrief, localPath, manualUri, name, npmPackage, previewApplicationId, source]);
  const riskPreview = useMemo(() => source
    ? descriptorRiskPreview(previewApplication({
        id: previewApplicationId,
        name: name.trim() || npmPackage.trim() || localPath.trim().split(/[\\/]/).filter(Boolean).at(-1) || manualUri.trim() || "Application",
        source,
        integrationBrief: integrationBrief ?? { version: "application-intake.v1", status: "draft" },
      }), { mcpDescriptor, wrapperDescriptor, manualManifest })
    : null,
  [integrationBrief, localPath, manualManifest, manualUri, mcpDescriptor, name, npmPackage, previewApplicationId, source, wrapperDescriptor]);
  const onboardingGuide = applicationOnboardingGuide({
    sourceType,
    sourceReady: Boolean(source),
    hasIntegrationBrief: Boolean(integrationBrief),
    hasDescriptorDraft: Boolean(mcpDescriptor.trim() || wrapperDescriptor.trim() || manualManifest.trim()),
    smokeTests: integrationBrief?.smokeTests ?? [],
    autoProbeAfterRegister,
  });

  function applyDoocsMdPreset() {
    setSourceType("local");
    setLocalPath("doocs-md");
    setName("doocs/md");
    setBriefOpen(true);
    setBriefIntent("Render and inspect WeChat-ready Markdown through doocs/md MCP and the web editor.");
    setBriefDiscoverableCapabilities("render markdown\nlist themes\nget renderer options\nstart web editor\nsend editor result");
    setBriefInvokableCapabilities("render markdown\nlist themes\nstart web editor\nsend editor result");
    setBriefDataBoundary("Local doocs/md checkout. MCP runs as a rooted stdio process through Desktop Bridge; web editor runs local Vite and imports rendered HTML into Application Result Center.");
    setBriefFixedCommands("render_markdown\nlist_themes\nget_renderer_options\npnpm run start");
    setBriefUserInputs("Markdown content, theme, post title, and editor source URL.");
    setBriefResultImport("Rendered HTML results, editor handoff metadata, and option catalogs are imported into Application Result Center.");
    setBriefApprovalsAndRecovery("Desktop Bridge must be online. Local execution stays allowlisted to the rooted doocs/md checkout. Startup failures surface bridge reason, last error, and next step.");
    setBriefSmokeTests("pnpm smoke:doocs-md-application\npnpm smoke:doocs-md-editor");
    setAutoProbeAfterRegister(true);
    setFormError(null);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!source) return;
    const mcpAgent = parseOptionalJsonObject(mcpDescriptor, "MCP descriptor");
    if (mcpAgent.error) {
      setFormError(mcpAgent.error);
      return;
    }
    const wrapper = sourceType === "npm" ? parseOptionalJsonObject(wrapperDescriptor, "Wrapper descriptor") : { value: null, error: null };
    if (wrapper.error) {
      setFormError(wrapper.error);
      return;
    }
    const manifest = sourceType === "manual" ? parseOptionalJsonObject(manualManifest, "Manual manifest") : { value: null, error: null };
    if (manifest.error) {
      setFormError(manifest.error);
      return;
    }
    const sourceWithAdvanced: ApplicationSource =
      source.type === "npm" && wrapper.value
        ? { ...source, wrapper: wrapper.value }
        : source.type === "manual" && manifest.value
          ? { ...source, manifest: manifest.value }
          : source;
    const body: ApplicationRegisterRequest = {
      source: sourceWithAdvanced,
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(projectId ? { projectId } : {}),
      ...(mcpAgent.value ? { mcpAgent: mcpAgent.value } : {}),
      ...(integrationBrief ? { integrationBrief } : {}),
    };
    void execute(async () => {
      const result = await api.registerApplication(body);
      if (result?.application?.id) {
        setSelectedApplicationId(result.application.id);
        setSelectedApplicationAutomationId(null);
        setSection("applications");
        if (autoProbeAfterRegister) {
          await api.applicationLifecycle(result.application.id, "probe");
        }
        onClose();
      }
      return result;
    });
  }

  function applyIntegrationDraft(kind: "mcp" | "npmWrapper" | "manualManifest") {
    if (!integrationDrafts?.available) return;
    if (kind === "mcp" && integrationDrafts.mcpDescriptor) {
      setMcpDescriptor(prettyJson(integrationDrafts.mcpDescriptor));
      setAdvancedOpen(true);
      setDraftStatus("MCP descriptor draft applied.");
      return;
    }
    if (kind === "npmWrapper" && integrationDrafts.npmWrapper) {
      setWrapperDescriptor(prettyJson(integrationDrafts.npmWrapper));
      setAdvancedOpen(true);
      setDraftStatus("npm wrapper draft applied.");
      return;
    }
    if (kind === "manualManifest" && integrationDrafts.manualManifest) {
      setManualManifest(prettyJson(integrationDrafts.manualManifest));
      setAdvancedOpen(true);
      setDraftStatus("Manual manifest draft applied.");
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Register application" description="Register a governed application asset." size="lg">
      <form className="space-y-3" onSubmit={submit}>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/20 p-3">
          <div>
            <p className="text-sm font-medium">doocs/md preset</p>
            <p className="text-xs text-muted-foreground">Local checkout, MCP probe, web editor handoff, and Result Center import.</p>
          </div>
          <Button type="button" size="sm" variant="secondary" onClick={applyDoocsMdPreset}>
            Use preset
          </Button>
        </div>
        <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ListChecks className="size-4 text-muted-foreground" aria-hidden />
              <span className="text-sm font-medium">Onboarding guide</span>
            </div>
            <Badge tone={onboardingGuide.readinessTone}>{onboardingGuide.readinessLabel}</Badge>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {onboardingGuide.steps.map((step) => (
              <OnboardingGuideStep key={step.id} step={step} />
            ))}
          </div>
          {integrationDrafts?.available ? (
            <div className="space-y-2 rounded-md border border-border/70 bg-card/60 p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">Descriptor drafts</span>
                <Badge tone="warning">review before register</Badge>
                {draftStatus ? <span className="text-success">{draftStatus}</span> : null}
              </div>
              <p className="[overflow-wrap:anywhere] text-muted-foreground">{integrationDrafts.summary}</p>
              <div className="flex flex-wrap gap-2">
                {integrationDrafts.mcpDescriptor ? (
                  <Button type="button" size="sm" variant="secondary" onClick={() => applyIntegrationDraft("mcp")}>
                    Apply MCP draft
                  </Button>
                ) : null}
                {integrationDrafts.npmWrapper ? (
                  <Button type="button" size="sm" variant="secondary" onClick={() => applyIntegrationDraft("npmWrapper")}>
                    Apply npm wrapper draft
                  </Button>
                ) : null}
                {integrationDrafts.manualManifest ? (
                  <Button type="button" size="sm" variant="secondary" onClick={() => applyIntegrationDraft("manualManifest")}>
                    Apply manual manifest draft
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        <div className="rounded-md border border-border bg-muted/20">
          <button
            type="button"
            className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium"
            onClick={() => setBriefOpen((value) => !value)}
          >
            <span>Integration brief for Codex</span>
            <span className="text-xs text-muted-foreground">{briefOpen ? "Hide" : "Show"}</span>
          </button>
          {briefOpen ? (
            <div className="space-y-3 border-t border-border p-3">
              <Field label="Job to support">
                <Textarea
                  rows={3}
                  value={briefIntent}
                  onChange={(event) => setBriefIntent(event.target.value)}
                  placeholder="What should this Application help the operator do?"
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Discoverable capabilities">
                  <Textarea
                    rows={4}
                    value={briefDiscoverableCapabilities}
                    onChange={(event) => setBriefDiscoverableCapabilities(event.target.value)}
                    placeholder="One capability per line"
                  />
                </Field>
                <Field label="Invokable capabilities">
                  <Textarea
                    rows={4}
                    value={briefInvokableCapabilities}
                    onChange={(event) => setBriefInvokableCapabilities(event.target.value)}
                    placeholder="Only the capabilities that may run"
                  />
                </Field>
              </div>
              <Field label="Data boundary">
                <Textarea
                  rows={3}
                  value={briefDataBoundary}
                  onChange={(event) => setBriefDataBoundary(event.target.value)}
                  placeholder="What can it read, write, or send over the network?"
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Fixed commands or tools">
                  <Textarea
                    rows={4}
                    value={briefFixedCommands}
                    onChange={(event) => setBriefFixedCommands(event.target.value)}
                    placeholder="Commands, scripts, MCP tools, or endpoints"
                  />
                </Field>
                <Field label="User-controlled inputs">
                  <Textarea
                    rows={4}
                    value={briefUserInputs}
                    onChange={(event) => setBriefUserInputs(event.target.value)}
                    placeholder="Arguments that need schema validation"
                  />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Result to import">
                  <Textarea
                    rows={4}
                    value={briefResultImport}
                    onChange={(event) => setBriefResultImport(event.target.value)}
                    placeholder="Records, evidence, reports, or result refs"
                  />
                </Field>
                <Field label="Approvals and recovery">
                  <Textarea
                    rows={4}
                    value={briefApprovalsAndRecovery}
                    onChange={(event) => setBriefApprovalsAndRecovery(event.target.value)}
                    placeholder="Consent, per-run approval, fallback, retry"
                  />
                </Field>
              </div>
              <Field label="Smoke tests">
                <Textarea
                  rows={3}
                  value={briefSmokeTests}
                  onChange={(event) => setBriefSmokeTests(event.target.value)}
                  placeholder="Registration, probe, invocation, import, restart"
                />
              </Field>
              {integrationBrief ? (
                <div className="rounded-md border border-border/70 p-3 text-xs">
                  <div className="mb-2 font-medium">Codex draft inputs</div>
                  <p className="text-muted-foreground">
                    {[
                      integrationBrief.intent ? "intent" : null,
                      integrationBrief.discoverableCapabilities?.length ? "capabilities" : null,
                      integrationBrief.fixedCommands?.length ? "commands" : null,
                      integrationBrief.smokeTests?.length ? "tests" : null,
                    ].filter(Boolean).join(" · ")}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <Field label="Source type">
          <Select value={sourceType} onChange={(e) => setSourceType(e.target.value as SourceType)}>
            <option value="git">Git</option>
            <option value="local">Local</option>
            <option value="npm">npm</option>
            <option value="manual">Manual</option>
          </Select>
        </Field>

        {sourceType === "git" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Repository (owner/repo or URL)">
              <Input value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} placeholder="acme/web" />
            </Field>
            <Field label="Ref (optional)">
              <Input value={gitRef} onChange={(e) => setGitRef(e.target.value)} placeholder="main" />
            </Field>
          </div>
        ) : null}
        {sourceType === "local" ? (
          <Field label="Local path">
            <Input value={localPath} onChange={(e) => setLocalPath(e.target.value)} placeholder="/path/to/app" />
          </Field>
        ) : null}
        {sourceType === "npm" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Package">
              <Input value={npmPackage} onChange={(e) => setNpmPackage(e.target.value)} placeholder="@scope/pkg" />
            </Field>
            <Field label="Version (optional)">
              <Input value={npmVersion} onChange={(e) => setNpmVersion(e.target.value)} placeholder="latest" />
            </Field>
          </div>
        ) : null}
        {sourceType === "manual" ? (
          <Field label="URI (optional)">
            <Input value={manualUri} onChange={(e) => setManualUri(e.target.value)} placeholder="https://…" />
          </Field>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name (optional)">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Defaults from source" />
          </Field>
          <Field label="Project (optional)">
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">None</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="rounded-md border border-border">
          <button
            type="button"
            className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium"
            onClick={() => setAdvancedOpen((value) => !value)}
          >
            <span>Advanced descriptors</span>
            <span className="text-xs text-muted-foreground">{advancedOpen ? "Hide" : "Show"}</span>
          </button>
          {advancedOpen ? (
            <div className="space-y-3 border-t border-border p-3">
              <Field label="MCP descriptor JSON (optional)">
                <Textarea
                  rows={5}
                  value={mcpDescriptor}
                  onChange={(event) => setMcpDescriptor(event.target.value)}
                  placeholder='{"transport":"stdio","command":"node","args":["server.mjs"],"allowedTools":["render"]}'
                />
              </Field>
              {sourceType === "npm" ? (
                <>
                  <NpmWrapperCommandBuilder
                    descriptorText={wrapperDescriptor}
                    onDescriptorTextChange={setWrapperDescriptor}
                  />
                  <Field label="npm wrapper descriptor JSON (optional)">
                    <Textarea
                      rows={7}
                      value={wrapperDescriptor}
                      onChange={(event) => setWrapperDescriptor(event.target.value)}
                      placeholder='{"mode":"installed-wrapper","installState":"installed","packageManager":"npm","commands":[{"id":"lint","commandType":"npm_script","command":"lint","status":"approved"}]}'
                    />
                  </Field>
                  <WrapperCapabilityImpactPanel impact={wrapperImpact} />
                </>
              ) : null}
              {sourceType === "manual" ? (
                <Field label="Manual manifest JSON (optional)">
                  <Textarea
                    rows={5}
                    value={manualManifest}
                    onChange={(event) => setManualManifest(event.target.value)}
                    placeholder='{"capabilities":[]}'
                  />
                </Field>
              ) : null}
              {riskPreview ? <DescriptorRiskPreviewPanel preview={riskPreview} /> : null}
            </div>
          ) : null}
        </div>

        <DescriptorFeedbackList message={formError ?? error} error={formError ? null : errorDetail} />
        {autoProbeAfterRegister ? (
          <p className="text-xs text-muted-foreground">
            This preset will run Probe after registration and open the Application inspector.
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={pending || !source}>
            {pending ? "Registering…" : "Register"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function OnboardingGuideStep({ step }: { step: ApplicationOnboardingStep }) {
  return (
    <div className="rounded-md border border-border/70 bg-card/60 p-3 text-xs">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        {step.status === "done" ? (
          <CheckCircle2 className="size-3.5 text-success" aria-hidden />
        ) : (
          <Circle className={step.status === "current" ? "size-3.5 text-warning" : "size-3.5 text-muted-foreground"} aria-hidden />
        )}
        <span className="font-medium">{step.title}</span>
        <Badge tone={step.tone}>{step.status}</Badge>
      </div>
      <p className="[overflow-wrap:anywhere] text-muted-foreground">{step.detail}</p>
    </div>
  );
}

function previewApplication({
  id,
  name,
  source,
  integrationBrief,
}: {
  id: string;
  name: string;
  source: ApplicationSource;
  integrationBrief: ApplicationIntegrationBrief;
}): ApplicationSnapshot {
  const now = "2026-07-10T00:00:00.000Z";
  return {
    id,
    name,
    kind: source.type,
    source,
    status: "draft",
    integrationBrief,
    createdAt: now,
    updatedAt: now,
  };
}

function inferredBriefSourceType(
  sourceType: SourceType,
  brief: {
    intent: string;
    dataBoundary: string;
    approvalsAndRecovery: string;
    fixedCommands: string;
  },
): ApplicationIntegrationBrief["sourceType"] {
  if (sourceType !== "local") return sourceType === "manual" ? "manual" : sourceType;
  const text = `${brief.intent} ${brief.dataBoundary} ${brief.approvalsAndRecovery} ${brief.fixedCommands}`.toLowerCase();
  return /\bmcp\b|render_markdown|list_themes|stdio/.test(text) ? "mixed" : "local";
}

function slugSegment(value: string): string {
  const text = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replaceAll(".", "_")
    .replaceAll("-", "_");
  return text || "npm_application";
}

function lines(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}
