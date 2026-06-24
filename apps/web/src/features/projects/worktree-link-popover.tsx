import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CircleDot, ExternalLink, GitPullRequest, Play, Clipboard } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useUiStore } from "@/store/ui-store";
import type { WorktreeSnapshot } from "@/lib/console-state";

// Click a worktree's issue/PR indicator to open a popover card with the linked
// item plus actions: run an agent in this worktree, copy its path, open the
// issue/PR on GitHub.
export function WorktreeLinkPopover({ worktree }: { worktree: WorktreeSnapshot }) {
  const link = worktree.link!;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const setSection = useUiStore((s) => s.setSection);
  const setSelectedProjectId = useUiStore((s) => s.setSelectedProjectId);
  const setSelectedWorktreeId = useUiStore((s) => s.setSelectedWorktreeId);

  const Icon = link.type === "pr" ? GitPullRequest : CircleDot;
  const tone = link.type === "pr" ? "text-emerald-500" : "text-sky-500";
  const label = link.type === "pr" ? "PR" : "Issue";

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!cardRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: Math.min(r.top, window.innerHeight - 180), left: r.right + 8 });
    }
    setOpen((v) => !v);
  }

  function runHere() {
    setSelectedProjectId(worktree.projectId);
    setSelectedWorktreeId(worktree.id);
    setSection("projects"); // opens the worktree session view
    setOpen(false);
  }
  function copyPath() {
    void navigator.clipboard?.writeText(worktree.path);
    setOpen(false);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        title={`${label} #${link.number}: ${link.title}`}
        className="grid size-5 shrink-0 place-items-center rounded hover:bg-sidebar-accent"
      >
        <Icon className={`size-3 ${tone}`} />
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={cardRef}
              style={{ top: pos.top, left: pos.left }}
              className="fixed z-50 w-64 rounded-lg border border-border bg-card p-3 text-xs shadow-xl"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <Icon className={`size-3.5 shrink-0 ${tone}`} />
                  <span className="font-medium">
                    {label} #{link.number}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
                  <button type="button" onClick={runHere} title="Run an agent in this worktree" className="hover:text-foreground">
                    <Play className="size-3.5" />
                  </button>
                  <button type="button" onClick={copyPath} title="Copy worktree path" className="hover:text-foreground">
                    <Clipboard className="size-3.5" />
                  </button>
                  {link.url ? (
                    <a href={link.url} target="_blank" rel="noreferrer" title="Open on GitHub" className="hover:text-foreground">
                      <ExternalLink className="size-3.5" />
                    </a>
                  ) : null}
                </span>
              </div>
              <p className="mt-1.5 font-medium text-foreground">{link.title}</p>
              <div className="mt-1.5">
                <Badge tone={link.state === "open" ? "success" : "neutral"}>State: {link.state}</Badge>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
