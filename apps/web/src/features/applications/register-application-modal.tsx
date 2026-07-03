import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { useUiStore } from "@/store/ui-store";
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

  const projects = state?.projects ?? [];

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
    if (!source) return;
    const body: ApplicationRegisterRequest = {
      source,
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(projectId ? { projectId } : {}),
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

        {error ? <p className="text-xs text-destructive">{error}</p> : null}
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
