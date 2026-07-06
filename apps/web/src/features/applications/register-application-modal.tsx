import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { useUiStore } from "@/store/ui-store";
import { DescriptorFeedbackList, WrapperCapabilityImpactPanel } from "@/features/applications/descriptor-feedback";
import { parseOptionalJsonObject, wrapperCapabilityImpact } from "@/features/applications/descriptor-utils";
import type { ApplicationRegisterRequest, ApplicationSource } from "@/lib/console-state";

type SourceType = ApplicationSource["type"];

/** Register an application from a git / local / npm / manual source. */
export function RegisterApplicationModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: state } = useConsoleState();
  const setSelectedApplicationId = useUiStore((s) => s.setSelectedApplicationId);
  const { execute, pending, error } = useAsyncAction();

  const [sourceType, setSourceType] = useState<SourceType>("git");
  const [gitUrl, setGitUrl] = useState("");
  const [gitRef, setGitRef] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [npmPackage, setNpmPackage] = useState("");
  const [npmVersion, setNpmVersion] = useState("");
  const [manualUri, setManualUri] = useState("");
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [mcpDescriptor, setMcpDescriptor] = useState("");
  const [wrapperDescriptor, setWrapperDescriptor] = useState("");
  const [manualManifest, setManualManifest] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

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
    };
    void execute(async () => {
      const result = await api.registerApplication(body);
      if (result?.application?.id) {
        setSelectedApplicationId(result.application.id);
        onClose();
      }
      return result;
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="Register application" description="Register a governed application asset." size="lg">
      <form className="space-y-3" onSubmit={submit}>
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
            </div>
          ) : null}
        </div>

        <DescriptorFeedbackList message={formError ?? error} />
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
