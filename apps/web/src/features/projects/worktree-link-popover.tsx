import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CircleDot, ExternalLink, GitPullRequest } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { WorktreeLink } from "@/lib/console-state";

// Click the issue/PR indicator on a worktree to open a small popover card with
// the linked item's number, title, state, and an "open on GitHub" action.
export function WorktreeLinkPopover({ link }: { link: WorktreeLink }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
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
      setPos({ top: Math.min(r.top, window.innerHeight - 160), left: r.right + 8 });
    }
    setOpen((v) => !v);
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
                {link.url ? (
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    title="Open on GitHub"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="size-3.5" />
                  </a>
                ) : null}
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
