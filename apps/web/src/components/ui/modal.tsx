import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

// Minimal centered modal with backdrop + Escape to close. No focus-trap library;
// enough for the project-register dialog.
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = "md",
  closeDisabled = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  size?: "md" | "lg";
  closeDisabled?: boolean;
}) {
  const { t } = useAppTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ) ?? [])];
    queueMicrotask(() => (focusable()[0] ?? dialog)?.focus());
    const onKey = (e: KeyboardEvent) => {
      const openDialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (openDialogs[openDialogs.length - 1] !== dialog) return;
      if (e.key === "Escape" && !closeDisabled) onCloseRef.current();
      if (e.key === "Tab" && dialog) {
        const nodes = focusable();
        if (!nodes.length) {
          e.preventDefault();
          dialog.focus();
          return;
        }
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previouslyFocused?.focus();
    };
  }, [closeDisabled, open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={closeDisabled ? undefined : onClose}
        aria-hidden
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`relative z-10 max-h-[calc(100vh-2rem)] w-full overflow-y-auto ${size === "lg" ? "max-w-lg" : "max-w-md"} rounded-xl border border-border bg-card p-4 shadow-xl sm:p-5`}
      >
        <button
          type="button"
          onClick={closeDisabled ? undefined : onClose}
          disabled={closeDisabled}
          aria-label={t("shell.close")}
          className="absolute right-3 top-3 grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
        <h2 id={titleId} className="text-base font-semibold">{title}</h2>
        {description ? <p id={descriptionId} className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
        <div className="mt-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
