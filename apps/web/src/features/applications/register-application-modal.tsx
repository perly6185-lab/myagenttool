import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronDown, ChevronUp, Copy, LoaderCircle, ShieldCheck } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { useUiStore } from "@/store/ui-store";
import type { ApplicationInstallPlan, ApplicationInstallRun, ApplicationRegisterRequest, ApplicationSource } from "@/lib/console-state";

type SourceType = ApplicationSource["type"];
type SetupPhase = "detect" | "plan" | "approval" | "installing" | "probing" | "registering" | "ready" | "login" | "failed" | "cancelled";

const SETUP_STEPS: Array<{ phase: Exclude<SetupPhase, "failed" | "cancelled" | "login">; label: string }> = [
  { phase: "detect", label: "Detect" },
  { phase: "plan", label: "Plan" },
  { phase: "approval", label: "Approve" },
  { phase: "installing", label: "Install" },
  { phase: "probing", label: "Probe" },
  { phase: "registering", label: "Register" },
  { phase: "ready", label: "Ready" },
];

export function RegisterApplicationModal({ open, onClose, initialApplication = "" }: { open: boolean; onClose: () => void; initialApplication?: string }) {
  const { data: state } = useConsoleState();
  const setSelectedApplicationId = useUiStore((s) => s.setSelectedApplicationId);
  const { execute, pending, error } = useAsyncAction();
  const finalizingRunRef = useRef<string | null>(null);

  const [sourceType, setSourceType] = useState<SourceType>("git");
  const [knownApplication, setKnownApplication] = useState("");
  const [gitUrl, setGitUrl] = useState("");
  const [gitRef, setGitRef] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [npmPackage, setNpmPackage] = useState("");
  const [npmVersion, setNpmVersion] = useState("");
  const [manualUri, setManualUri] = useState("");
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [setupPhase, setSetupPhase] = useState<SetupPhase>("detect");
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupMessage, setSetupMessage] = useState("Choose a known Application to detect local readiness.");
  const [installPlan, setInstallPlan] = useState<ApplicationInstallPlan | null>(null);
  const [installRunId, setInstallRunId] = useState<string | null>(null);
  const [installRun, setInstallRun] = useState<ApplicationInstallRun | null>(null);

  const projects = state?.projects ?? [];
  const { data: knownApplicationData } = useQuery({
    queryKey: ["known-application-catalog"],
    queryFn: () => api.listKnownApplications(),
    enabled: open,
    staleTime: 60_000,
  });
  const { data: installRunData } = useQuery({
    queryKey: ["runtime-install-run", installRunId],
    queryFn: () => api.getApplicationInstallRun(installRunId!),
    enabled: Boolean(open && installRunId),
    refetchInterval: 700,
  });

  useEffect(() => {
    if (!open || !initialApplication) return;
    setKnownApplication(initialApplication);
    resetSetup("Check this local application and repair it if needed.");
  }, [open, initialApplication]);

  const knownEntry = useMemo(() => {
    const normalized = knownApplication.trim().toLowerCase();
    return (knownApplicationData?.applications ?? []).find((entry) => entry.aliases.includes(normalized)) ?? null;
  }, [knownApplication, knownApplicationData]);
  const selectedDevice = state?.device ?? null;
  const readiness = knownEntry && selectedDevice
    ? (selectedDevice.runtimeReadiness ?? selectedDevice.applicationBinaryReadiness)?.find((row) => row.command === knownEntry.command) ?? null
    : null;
  // Server-owned local sign-in command (Stage 4-2), never hardcoded here.
  const authenticationLoginCommand = readiness?.authenticationStatus === "unauthenticated"
    ? knownEntry?.loginCommand ?? null
    : null;

  useEffect(() => {
    const run = installRunData?.run;
    if (!run) return;
    setInstallRun(run);
    const latestProgress = run.progress.at(-1);
    if (["queued", "running", "cancelling"].includes(run.status)) {
      setSetupPhase(latestProgress?.type === "probing" ? "probing" : "installing");
      setSetupMessage(latestProgress?.summary ?? "Desktop Bridge is executing the approved installation plan.");
      return;
    }
    setInstallRunId(null);
    if (run.status === "succeeded" && finalizingRunRef.current !== run.id) {
      finalizingRunRef.current = run.id;
      setSetupPhase("registering");
      setSetupMessage("Readiness confirmed. Registering the governed Application asset.");
      void registerKnownApplication().finally(() => { finalizingRunRef.current = null; });
      return;
    }
    if (run.status === "cancelled") {
      setSetupPhase("cancelled");
      setSetupMessage(run.result?.summary ?? "Installation was cancelled. You can retry safely.");
      return;
    }
    setSetupPhase("failed");
    setSetupError(run.result?.classification === "probe_failed"
      ? "Installation completed, but the readiness probe failed. Check PATH or restart Desktop Bridge, then retry."
      : run.result?.summary ?? "Installation failed. Review the device and retry.");
  }, [installRunData]);

  function resetSetup(message = "Choose a known Application to detect local readiness.") {
    setSetupPhase("detect");
    setSetupBusy(false);
    setSetupError(null);
    setSetupMessage(message);
    setInstallPlan(null);
    setInstallRunId(null);
    setInstallRun(null);
    finalizingRunRef.current = null;
  }

  async function registerKnownApplication() {
    try {
      const result = await api.quickRegisterApplication({ name: knownApplication.trim(), ...(projectId ? { projectId } : {}) });
      if (result.application?.id) setSelectedApplicationId(result.application.id);
      setSetupPhase("ready");
      setSetupMessage(`${result.application?.name ?? knownEntry?.displayName ?? "Application"} is registered and ready.`);
    } catch (caught) {
      setSetupPhase("failed");
      setSetupError(caught instanceof Error ? caught.message : "Registration failed after installation.");
    }
  }

  async function startQuickSetup() {
    if (!knownEntry) return;
    setSetupBusy(true);
    setSetupError(null);
    setSetupPhase("detect");
    setSetupMessage(`Checking ${knownEntry.displayName} on this computer.`);
    try {
      if (knownEntry.runtimeRequirements.length === 0) {
        setSetupPhase("registering");
        setSetupMessage(`${knownEntry.displayName} is built in. Adding it now.`);
        await registerKnownApplication();
        return;
      }
      if (!selectedDevice) {
        setSetupPhase("failed");
        setSetupError("Start the local Desktop Bridge, then retry.");
        return;
      }
      if (selectedDevice.status !== "online") {
        setSetupPhase("failed");
        setSetupError("The selected device is offline. Start Desktop Bridge or choose an online device, then retry.");
        return;
      }
      if (readiness?.status === "available") {
        if (readiness.authenticationStatus === "unauthenticated") {
          // A resumable login STEP, not a failure: show the server-owned command,
          // let the user sign in locally, then re-check (Copy + Re-check buttons).
          const loginCommand = knownEntry.loginCommand;
          setSetupPhase("login");
          setSetupMessage(`${knownEntry.displayName} is installed but not signed in.${loginCommand ? ` Run ${loginCommand} locally, then re-check.` : " Sign in locally, then re-check."}`);
          return;
        }
        if (readiness.authenticationStatus === "unknown") {
          setSetupPhase("failed");
          setSetupError(`${knownEntry.displayName} is installed, but local sign-in could not be verified. Retry detection after checking the application locally.`);
          return;
        }
        setSetupPhase("registering");
        setSetupMessage(`${knownEntry.displayName} ${readiness.version ?? ""} is already available. Registering it now.`);
        await registerKnownApplication();
        return;
      }
      setSetupPhase("plan");
      setSetupMessage(`Building an allowlisted ${selectedDevice.platform} installation plan.`);
      const response = await api.createApplicationInstallPlan({
        name: knownEntry.name,
        deviceId: selectedDevice.id,
        ...(projectId ? { projectId } : {}),
      });
      setInstallPlan(response.plan);
      setSetupPhase("approval");
      setSetupMessage("Review the safe summary and approve local installation.");
    } catch (caught) {
      setSetupPhase("failed");
      setSetupError(caught instanceof Error ? caught.message : "Setup planning failed.");
    } finally {
      setSetupBusy(false);
    }
  }

  async function copyAuthenticationLoginCommand() {
    if (!authenticationLoginCommand) return;
    try {
      await navigator.clipboard.writeText(authenticationLoginCommand);
      setSetupMessage(`Copied ${authenticationLoginCommand}. Run it locally, complete sign-in, then retry detection.`);
    } catch {
      setSetupError(`Could not access the clipboard. Run ${authenticationLoginCommand} locally, then retry detection.`);
    }
  }

  async function approveInstallation() {
    if (!installPlan) return;
    setSetupBusy(true);
    setSetupError(null);
    try {
      const grant = await api.issueApprovalGrant("application.install", installPlan.planId);
      const queued = await api.queueApplicationInstall({ plan: installPlan, approvalToken: grant.token });
      setInstallRun(queued.run);
      setInstallRunId(queued.run.id);
      setSetupPhase("installing");
      setSetupMessage("Approval accepted. Waiting for Desktop Bridge to start installation.");
    } catch (caught) {
      setSetupPhase("approval");
      setSetupError(caught instanceof Error ? caught.message : "Approval or queueing failed. Request a fresh approval and retry.");
    } finally {
      setSetupBusy(false);
    }
  }

  async function cancelInstallation() {
    if (!installRun?.id) return;
    setSetupBusy(true);
    try {
      await api.cancelApplicationInstall(installRun.id);
      setSetupMessage("Cancellation requested. Waiting for Desktop Bridge to stop the process.");
    } catch (caught) {
      setSetupError(caught instanceof Error ? caught.message : "Cancellation request failed.");
    } finally {
      setSetupBusy(false);
    }
  }

  function buildSource(): ApplicationSource | null {
    switch (sourceType) {
      case "git": return gitUrl.trim() ? { type: "git", url: gitUrl.trim(), ref: gitRef.trim() || null } : null;
      case "local": return localPath.trim() ? { type: "local", path: localPath.trim() } : null;
      case "npm": return npmPackage.trim() ? { type: "npm", package: npmPackage.trim(), version: npmVersion.trim() || null } : null;
      default: return { type: "manual", uri: manualUri.trim() || null };
    }
  }

  const source = buildSource();
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!source) return;
    const body: ApplicationRegisterRequest = { source, ...(name.trim() ? { name: name.trim() } : {}), ...(projectId ? { projectId } : {}) };
    void execute(async () => {
      const result = await api.registerApplication(body);
      if (result?.application?.id) { setSelectedApplicationId(result.application.id); onClose(); }
      return result;
    });
  }

  const activeStep = setupPhase === "failed" || setupPhase === "cancelled" ? 3 : Math.max(0, SETUP_STEPS.findIndex((step) => step.phase === setupPhase));
  const workflowActive = ["installing", "probing", "registering"].includes(setupPhase);

  return (
    <Modal open={open} onClose={onClose} closeDisabled={workflowActive} title="Add application" description="Add a ready-to-use application or register an advanced source." size="lg">
      <form className="space-y-3" onSubmit={submit}>
        <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-3 sm:p-4">
          <div>
            <p className="text-sm font-semibold">Quick setup</p>
            <p className="text-xs text-muted-foreground">Detect, approve, install, verify, and register a known Application without entering commands.</p>
          </div>
          <div className="grid gap-2">
            <Select
              value={knownApplication}
              onChange={(event) => { setKnownApplication(event.target.value); resetSetup(); }}
              disabled={workflowActive}
              aria-label="Application"
            >
              <option value="">Choose an application</option>
              {(knownApplicationData?.applications ?? []).map((application) => (
                <option key={application.name} value={application.name}>{application.displayName}</option>
              ))}
            </Select>
          </div>
          <Select value={projectId} onChange={(event) => { setProjectId(event.target.value); resetSetup("Project scope changed. Run detection again."); }} disabled={workflowActive} aria-label="Project scope">
            <option value="">No project scope</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </Select>

          <div className="grid grid-cols-4 gap-1 sm:grid-cols-7" aria-label="Application setup progress">
            {SETUP_STEPS.map((step, index) => {
              const complete = setupPhase === "ready" || index < activeStep;
              const active = index === activeStep && setupPhase !== "failed" && setupPhase !== "cancelled";
              return (
                <div key={step.phase} className="min-w-0 text-center">
                  <span className={`mx-auto grid size-6 place-items-center rounded-full border text-[10px] ${complete ? "border-emerald-500 bg-emerald-500 text-white" : active ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground"}`}>
                    {complete ? <Check className="size-3" /> : active && workflowActive ? <LoaderCircle className="size-3 animate-spin" /> : index + 1}
                  </span>
                  <span className="mt-1 block truncate text-[10px] text-muted-foreground">{step.label}</span>
                </div>
              );
            })}
          </div>

          <div className={`rounded-lg border p-3 text-xs ${setupPhase === "failed" ? "border-destructive/40 bg-destructive/5" : setupPhase === "ready" ? "border-emerald-500/40 bg-emerald-500/5" : "border-border bg-card"}`}>
            <div className="flex items-start gap-2">
              {setupPhase === "failed" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" /> : setupPhase === "ready" ? <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />}
              <div className="min-w-0">
                <p className="font-medium capitalize">{setupPhase === "detect" ? "Ready to detect" : setupPhase}</p>
                <p className="mt-0.5 text-muted-foreground">{setupMessage}</p>
                {setupError ? <p className="mt-1 text-destructive">{setupError}</p> : null}
                {authenticationLoginCommand ? (
                  <Button type="button" size="sm" variant="secondary" className="mt-2" onClick={() => void copyAuthenticationLoginCommand()}>
                    <Copy className="size-3.5" aria-hidden /> Copy login command
                  </Button>
                ) : null}
              </div>
            </div>
          </div>

          {setupPhase === "approval" && installPlan ? (
            <div className="grid gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs sm:grid-cols-2">
              <div><span className="text-muted-foreground">Package</span><p className="font-medium break-words">{installPlan.package.identifier}</p></div>
              <div><span className="text-muted-foreground">Provider</span><p className="font-medium capitalize">{installPlan.package.provider}</p></div>
              <div><span className="text-muted-foreground">This computer</span><p className="font-medium">{installPlan.target.platform}</p></div>
              <div><span className="text-muted-foreground">Policy</span><p className="font-medium capitalize">{installPlan.risk.level} risk · cancellable</p></div>
              <p className="sm:col-span-2 text-muted-foreground">No shell string or custom arguments are accepted. Approval is single-use and bound to this exact plan.</p>
            </div>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2">
            {setupPhase === "approval" ? <Button size="sm" disabled={setupBusy} onClick={() => void approveInstallation()}>{setupBusy ? "Approving…" : "Approve & install"}</Button> : null}
            {["installing", "probing"].includes(setupPhase) ? <Button size="sm" variant="destructive" disabled={setupBusy || !installRun?.id} onClick={() => void cancelInstallation()}>{setupBusy ? "Cancelling…" : "Cancel installation"}</Button> : null}
            {setupPhase === "login" ? <Button size="sm" onClick={() => { resetSetup("Re-checking sign-in after local login."); void startQuickSetup(); }}>Re-check</Button> : null}
            {["failed", "cancelled"].includes(setupPhase) ? <Button size="sm" variant="secondary" onClick={() => { resetSetup("Retrying setup from readiness detection."); void startQuickSetup(); }}>Retry</Button> : null}
            {setupPhase === "ready" ? <Button size="sm" onClick={onClose}>Done</Button> : null}
            {["detect", "plan"].includes(setupPhase) ? <Button size="sm" disabled={setupBusy || !knownEntry || (knownEntry.runtimeRequirements.length > 0 && !selectedDevice)} onClick={() => void startQuickSetup()}>{setupBusy ? "Detecting…" : "Set up"}</Button> : null}
          </div>
        </div>

        <button type="button" className="flex w-full items-center justify-center gap-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground" onClick={() => setAdvancedOpen((value) => !value)}>
          {advancedOpen ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />} Advanced registration
        </button>

        {advancedOpen ? (
          <div className="space-y-3 rounded-lg border border-border p-3">
            <Field label="Source type"><Select value={sourceType} onChange={(event) => setSourceType(event.target.value as SourceType)}><option value="git">Git</option><option value="local">Local</option><option value="npm">npm</option><option value="manual">Manual</option></Select></Field>
            {sourceType === "git" ? <div className="grid gap-3 sm:grid-cols-2"><Field label="Repository (owner/repo or URL)"><Input value={gitUrl} onChange={(event) => setGitUrl(event.target.value)} placeholder="acme/web" /></Field><Field label="Ref (optional)"><Input value={gitRef} onChange={(event) => setGitRef(event.target.value)} placeholder="main" /></Field></div> : null}
            {sourceType === "local" ? <Field label="Local path"><Input value={localPath} onChange={(event) => setLocalPath(event.target.value)} placeholder="/path/to/app" /></Field> : null}
            {sourceType === "npm" ? <div className="grid gap-3 sm:grid-cols-2"><Field label="Package"><Input value={npmPackage} onChange={(event) => setNpmPackage(event.target.value)} placeholder="@scope/pkg" /></Field><Field label="Version (optional)"><Input value={npmVersion} onChange={(event) => setNpmVersion(event.target.value)} placeholder="latest" /></Field></div> : null}
            {sourceType === "manual" ? <Field label="URI (optional)"><Input value={manualUri} onChange={(event) => setManualUri(event.target.value)} placeholder="https://…" /></Field> : null}
            <Field label="Name (optional)"><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Defaults from source" /></Field>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" size="sm" onClick={onClose}>Cancel</Button><Button type="submit" size="sm" disabled={pending || !source}>{pending ? "Registering…" : "Register advanced source"}</Button></div>
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
