import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { useConsoleState } from "@/data/use-console-state";
import { useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/cn";

export const SWATCHES = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#0ea5e9", "#a855f7"];
type Mode = "clone" | "local" | "empty";

// Register a project (clone a repo / link a local checkout / empty). Reused by
// the Projects page card and the "+" modal in the nav rail. Calls onDone after
// a successful create (used to close the modal).
export function ProjectRegisterForm({ onDone }: { onDone?: () => void }) {
  const { execute, pending, error } = useAsyncAction();
  const { data: state } = useConsoleState();
  const setSelectedProjectId = useUiStore((s) => s.setSelectedProjectId);
  const setSection = useUiStore((s) => s.setSection);
  const pendingLocalDocumentRegistration = useUiStore((s) => s.pendingLocalDocumentRegistration);
  const setPendingLocalDocumentRegistration = useUiStore((s) => s.setPendingLocalDocumentRegistration);
  const defaultCloneParent = state?.defaults?.cloneParentDir ?? "";

  const [mode, setMode] = useState<Mode>("clone");
  const [color, setColor] = useState(SWATCHES[0]);
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [parentDir, setParentDir] = useState("");
  const [repoPath, setRepoPath] = useState("");

  // Pre-fill the clone parent with the server's durable default (the browser
  // can't resolve a home dir). Only fills when still empty, so a user edit or a
  // deliberate clear is preserved.
  useEffect(() => {
    if (defaultCloneParent) setParentDir((cur) => cur || defaultCloneParent);
  }, [defaultCloneParent]);

  useEffect(() => {
    if (!pendingLocalDocumentRegistration) return;
    setMode("local");
    setRepoPath(pendingLocalDocumentRegistration.directory);
  }, [pendingLocalDocumentRegistration]);

  function afterCreate(created: { project?: { id: string } }) {
    if (created.project?.id) setSelectedProjectId(created.project.id);
    setName("");
    setRepoUrl("");
    setRepoPath("");
    if (created.project?.id && pendingLocalDocumentRegistration) {
      window.history.replaceState(window.history.state, "", localDocumentReturnUrl(window.location.href, created.project.id, pendingLocalDocumentRegistration.documentName));
      setPendingLocalDocumentRegistration(null);
      setSection("documents");
    }
    onDone?.();
  }

  function submit() {
    if (mode === "clone") {
      if (!repoUrl.trim() || !parentDir.trim()) return;
      void execute(async () => {
        const r = (await api.cloneProject({
          repoUrl: repoUrl.trim(),
          parentDir: parentDir.trim(),
          name: name.trim() || undefined,
          color,
        })) as { project?: { id: string } };
        afterCreate(r);
        return r;
      });
    } else if (mode === "local") {
      if (!repoPath.trim()) return;
      void execute(async () => {
        const r = (await api.bindProject({
          repoPath: repoPath.trim(),
          name: name.trim() || undefined,
          color,
        })) as { project?: { id: string } };
        afterCreate(r);
        return r;
      });
    } else {
      if (!name.trim()) return;
      void execute(async () => {
        const r = (await api.createProject({ name: name.trim(), color })) as { project?: { id: string } };
        afterCreate(r);
        return r;
      });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {(
          [
            ["clone", "Clone URL"],
            ["local", "Local path"],
            ["empty", "Empty"],
          ] as [Mode, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setMode(key)}
            className={cn(
              "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition",
              mode === key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "clone" ? (
        <>
          <Field label="Git URL">
            <Input value={repoUrl} placeholder="https://github.com/owner/repo.git" onChange={(e) => setRepoUrl(e.target.value)} />
          </Field>
          <Field label="Parent folder">
            <Input value={parentDir} placeholder={defaultCloneParent || "/Users/you/projects"} onChange={(e) => setParentDir(e.target.value)} />
          </Field>
        </>
      ) : null}

      {mode === "local" ? (
        <Field label="Repository path">
          <Input value={repoPath} placeholder="/Users/you/projects/repo" onChange={(e) => setRepoPath(e.target.value)} />
        </Field>
      ) : null}

      <Field label={mode === "empty" ? "Name" : "Name (optional — derived from repo)"}>
        <Input
          value={name}
          placeholder="e.g. Migrations"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
      </Field>

      <Field label="Color">
        <div className="flex flex-wrap gap-2">
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Color ${c}`}
              onClick={() => setColor(c)}
              className="h-7 w-7 rounded-full border-2 transition"
              style={{ backgroundColor: c, borderColor: color === c ? "var(--foreground)" : "transparent" }}
            />
          ))}
        </div>
      </Field>

      <Button onClick={submit} disabled={pending}>
        {mode === "clone" ? "Clone…" : mode === "local" ? "Link repository" : "Create project"}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function localDocumentReturnUrl(currentUrl: string, projectId: string, documentName: string): string {
  const url = new URL(currentUrl);
  url.searchParams.set("section", "documents");
  url.searchParams.set("project", projectId);
  url.searchParams.set("document", documentName);
  url.searchParams.delete("worktree");
  return `${url.pathname}${url.search}${url.hash}`;
}
