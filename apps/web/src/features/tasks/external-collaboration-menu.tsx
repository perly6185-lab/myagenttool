import { Button } from "@/components/ui/button";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { ChevronDown, CircleDot, GitPullRequest, Inbox, Settings2 } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

interface ExternalCollaborationMenuProps {
  onImportIssue: () => void;
  onOpenIssueInbox: () => void;
  onOpenChanges: () => void;
  onOpenSettings: () => void;
}

/**
 * Keeps low-frequency code-host work discoverable without competing with the
 * ordinary New task action. Provider selection stays in the import dialog.
 */
export function ExternalCollaborationMenu({
  onImportIssue,
  onOpenIssueInbox,
  onOpenChanges,
  onOpenSettings,
}: ExternalCollaborationMenuProps) {
  const { t } = useAppTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const run = (action: () => void) => {
    setOpen(false);
    action();
  };

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? []);
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const target = event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : event.key === "ArrowDown"
          ? (current + 1) % items.length
          : event.key === "ArrowUp"
            ? (current - 1 + items.length) % items.length
            : -1;
    if (target < 0) return;
    event.preventDefault();
    items[target]?.focus();
  };

  const entries = [
    { key: "import", Icon: Inbox, label: t("externalWork.createFromIssue"), hint: t("externalWork.importProviders"), action: onImportIssue },
    { key: "issues", Icon: CircleDot, label: t("externalWork.issues"), hint: t("externalWork.issueInboxHint"), action: onOpenIssueInbox },
    { key: "changes", Icon: GitPullRequest, label: t("externalWork.changes"), hint: t("externalWork.changeRequestsHint"), action: onOpenChanges },
  ] as const;

  return (
    <div ref={rootRef} className="relative">
      <Button
        ref={triggerRef}
        variant="secondary"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="external-collaboration-menu"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          setOpen(true);
          requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus());
        }}
      >
        <GitPullRequest aria-hidden />
        {t("externalWork.title")}
        <ChevronDown className={`transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </Button>

      {open ? (
        <div
          ref={menuRef}
          id="external-collaboration-menu"
          role="menu"
          aria-label={t("externalWork.title")}
          onKeyDown={moveFocus}
          className="absolute right-0 top-10 z-40 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-card p-1.5 shadow-xl"
        >
          {entries.map(({ key, Icon, label, hint, action }) => (
            <button
              key={key}
              type="button"
              role="menuitem"
              onClick={() => run(action)}
              className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
            >
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0">
                <strong className="block text-sm font-medium">{label}</strong>
                <span className="block text-xs text-muted-foreground">{hint}</span>
              </span>
            </button>
          ))}
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            role="menuitem"
            onClick={() => run(onOpenSettings)}
            className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
          >
            <Settings2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0">
              <strong className="block text-sm font-medium">{t("externalWork.settings")}</strong>
              <span className="block text-xs text-muted-foreground">{t("externalWork.settingsHint")}</span>
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
