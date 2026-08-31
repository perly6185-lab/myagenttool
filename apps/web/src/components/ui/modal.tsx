import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { cn } from "@/lib/cn";

// Minimal centered modal with backdrop + Escape to close. No focus-trap library;
// enough for the project-register dialog.
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  headerActions,
  size = "md",
  closeDisabled = false,
  bodyClassName,
  returnFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  headerActions?: ReactNode;
  size?: "md" | "lg" | "xl" | "2xl" | "full" | "viewport";
  closeDisabled?: boolean;
  bodyClassName?: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const { t } = useAppTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const restoreFocusIdentityRef = useRef<{ tagName: string; id: string; ariaLabel: string; text: string } | null>(null);
  // Capture during render, before a descendant's `autoFocus` runs in the commit
  // phase. Waiting for an effect can otherwise remember the first form field
  // inside the dialog instead of the control that opened it.
  const explicitReturnTarget = returnFocusRef?.current ?? null;
  const returnTarget = open
    ? explicitReturnTarget
      ?? (document.activeElement instanceof HTMLElement && !dialogRef.current?.contains(document.activeElement)
        ? document.activeElement
        : null)
    : null;
  if (open && returnTarget) {
    restoreFocusRef.current = returnTarget;
    restoreFocusIdentityRef.current = {
      tagName: returnTarget.tagName,
      id: returnTarget.id,
      ariaLabel: returnTarget.getAttribute("aria-label") ?? "",
      text: returnTarget.textContent?.replace(/\s+/g, " ").trim() ?? "",
    };
  }
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const explicitTarget = returnFocusRef?.current ?? null;
    const activeTarget = document.activeElement instanceof HTMLElement && !dialog?.contains(document.activeElement)
      ? document.activeElement
      : null;
    const target = explicitTarget ?? activeTarget;
    if (target) {
      restoreFocusRef.current = target;
      restoreFocusIdentityRef.current = {
        tagName: target.tagName,
        id: target.id,
        ariaLabel: target.getAttribute("aria-label") ?? "",
        text: target.textContent?.replace(/\s+/g, " ").trim() ?? "",
      };
    }
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
      const target = restoreFocusRef.current;
      const identity = restoreFocusIdentityRef.current;
      queueMicrotask(() => {
        if (target?.isConnected) {
          target.focus();
          return;
        }
        if (!identity) return;
        const replacement = [...document.querySelectorAll<HTMLElement>(identity.tagName)].find((node) =>
          (identity.id && node.id === identity.id)
          || (identity.ariaLabel && node.getAttribute("aria-label") === identity.ariaLabel)
          || (identity.text && node.textContent?.replace(/\s+/g, " ").trim() === identity.text),
        );
        replacement?.focus();
      });
    };
  }, [closeDisabled, open, returnFocusRef]);

  if (!open) return null;

  return createPortal(
    <div className={`app-modal-layer fixed inset-0 z-50 flex items-center justify-center ${size === "full" ? "p-0 sm:p-4" : size === "viewport" ? "p-2 sm:p-4" : "p-4"}`}>
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
        className={`relative z-10 flex max-h-[calc(100vh-2rem)] w-full flex-col overflow-hidden ${
          size === "viewport" ? "h-[calc(100vh-1rem)] max-h-none max-w-[calc(100vw-1rem)] rounded-xl sm:h-[calc(100vh-2rem)] sm:max-w-[calc(100vw-2rem)]"
            : size === "full" ? "h-full max-h-none max-w-7xl rounded-none sm:h-auto sm:max-h-[calc(100vh-2rem)] sm:rounded-xl"
            : size === "2xl" ? "max-w-6xl rounded-xl" : size === "xl" ? "max-w-5xl rounded-xl" : size === "lg" ? "max-w-lg rounded-xl" : "max-w-md rounded-xl"
        } border border-border bg-card p-4 shadow-xl sm:p-5`}
      >
        <div className="absolute right-2 top-2 z-20 flex items-center gap-1">
          <button
            type="button"
            onClick={closeDisabled ? undefined : onClose}
            disabled={closeDisabled}
            aria-label={t("shell.close")}
            className="order-2 grid size-9 touch-manipulation place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" />
          </button>
          {headerActions ? <div className="order-1 flex items-center gap-1">{headerActions}</div> : null}
        </div>
        <div className={cn("shrink-0", headerActions ? "pr-20" : "pr-8")}>
          <h2 id={titleId} className="text-base font-semibold">{title}</h2>
          {description ? <p id={descriptionId} className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        <div className={cn("mt-4 min-h-0 overflow-y-auto", bodyClassName)}>{children}</div>
        {footer ? <div className="mt-4 shrink-0 border-t border-border pt-4">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
