import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, BellRing, CheckCircle2, CircleAlert, ShieldCheck, Sparkles, WifiOff, X } from "lucide-react";
import { useConsoleState } from "@/data/use-console-state";
import {
  isControlPlaneStreamConnected,
  subscribeControlPlaneStream,
} from "@/data/control-plane-stream";
import { usePageNavigation } from "@/hooks/use-page-navigation";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  deriveNotificationCenterModel,
  unreadCompletionIds,
  type NotificationItem,
} from "@/components/layout/notification-center-model";
import { useUiStore, type SectionKey } from "@/store/ui-store";
import { workflowMemoryApi } from "@/features/workflow-memory/workflow-memory-api";

const COMPLETION_SEEN_KEY = "myagenttool-notification-completions-seen-v1";
const DELIVERY_ENABLED_KEY = "myagenttool-browser-notifications-v1";
const DELIVERY_BASELINE_KEY = "myagenttool-notification-delivery-baseline-v1";

function readStringArray(key: string): string[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : null;
  } catch {
    return null;
  }
}

function writeStringArray(key: string, values: Iterable<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...new Set(values)].slice(-500)));
  } catch {
    // Notification state is an enhancement; storage failures must not break the shell.
  }
}

function readDeliveryEnabled(): boolean {
  try {
    return localStorage.getItem(DELIVERY_ENABLED_KEY) === "true";
  } catch {
    return false;
  }
}

function notificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export function NotificationCenter() {
  const { t } = useAppTranslation();
  const { data: state, isError, isLoading } = useConsoleState();
  const navigate = usePageNavigation();
  const openWorkItem = useUiStore((store) => store.openWorkItem);
  const setSelectedInvocationId = useUiStore((store) => store.setSelectedInvocationId);
  const liveUpdates = useSyncExternalStore(
    subscribeControlPlaneStream,
    isControlPlaneStreamConnected,
    () => false,
  );
  const model = useMemo(
    () => deriveNotificationCenterModel(state, { isError, isLoading, liveUpdates }),
    [isError, isLoading, liveUpdates, state],
  );
  const templateTasksQuery = useQuery({
    queryKey: ["workflow-memory", "template-learning-tasks"],
    queryFn: () => workflowMemoryApi.listTemplateLearningTasks(),
    enabled: Boolean(state),
    refetchInterval: 5_000,
  });
  const templateAlerts = (templateTasksQuery.data?.tasks ?? [])
    .filter((task) => task.stage === "needs_case_review" || task.stage === "failed");
  const templateItems: NotificationItem[] = templateAlerts.map((task) => ({
    id: task.id,
    title: task.stage === "failed"
      ? `${task.name || t("notificationCenter.templatesUntitled")} · ${t("notificationCenter.templatesFailed")}`
      : task.name || t("notificationCenter.templatesUntitled"),
    target: "template",
  }));
  const [open, setOpen] = useState(false);
  const [seenCompletionIds, setSeenCompletionIds] = useState<Set<string> | null>(null);
  const [deliveryEnabled, setDeliveryEnabled] = useState(readDeliveryEnabled);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    notificationPermission,
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const completionSignature = model.completions.items.map((item) => item.id).join("|");
  useEffect(() => {
    if (!state || seenCompletionIds !== null) return;
    const stored = readStringArray(COMPLETION_SEEN_KEY);
    const baseline = stored ?? model.completions.items.map((item) => item.id);
    if (stored === null) writeStringArray(COMPLETION_SEEN_KEY, baseline);
    setSeenCompletionIds(new Set(baseline));
  }, [completionSignature, model.completions.items, seenCompletionIds, state]);

  const unreadIds = seenCompletionIds
    ? unreadCompletionIds(model.completions.items, seenCompletionIds)
    : [];
  const unreadCount = unreadIds.length;
  const unreadCompletionItems = model.completions.items.filter((item) => unreadIds.includes(item.id));
  const actionCount = model.approvals.count + model.failures.count + templateAlerts.length + (model.offline ? 1 : 0);
  const hasDanger = model.failures.count > 0 || templateAlerts.some((task) => task.stage === "failed") || model.offline;

  const notificationEventIds = [
    ...model.eventIds,
    ...templateAlerts.map((task) => `template:${task.id}:${task.stage}`),
  ];
  const eventSignature = notificationEventIds.join("|");
  useEffect(() => {
    if (!state || !deliveryEnabled || permission !== "granted") return;
    const prior = readStringArray(DELIVERY_BASELINE_KEY);
    if (prior === null) {
      writeStringArray(DELIVERY_BASELINE_KEY, notificationEventIds);
      return;
    }
    const priorSet = new Set(prior);
    const newIds = notificationEventIds.filter((id) => !priorSet.has(id));
    writeStringArray(DELIVERY_BASELINE_KEY, notificationEventIds);
    if (newIds.length === 0) return;
    try {
      const notice = new Notification(t("notificationCenter.browser.title"), {
        body: t("notificationCenter.browser.body", { count: newIds.length }),
        tag: "myagenttool-notification-center",
      });
      notice.onclick = () => {
        window.focus();
        navigate(newIds.some((id) => id.startsWith("template:")) ? "workflowMemory" : "workBoard");
        notice.close();
      };
    } catch {
      // The in-app center remains authoritative when OS delivery is unavailable.
    }
  // eventSignature is the stable dependency for the derived list.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliveryEnabled, eventSignature, navigate, permission, state, t]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key === "Tab") {
        const focusable = [...(rootRef.current?.querySelectorAll<HTMLElement>(
          "#notification-center button:not([disabled]), #notification-center summary",
        ) ?? [])];
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function openSection(section: SectionKey) {
    setOpen(false);
    navigate(section);
  }

  function openNotificationItem(item: NotificationItem, fallback: SectionKey) {
    setOpen(false);
    if (item.target === "work_item") {
      navigate("task");
      openWorkItem(item.id, { mode: "summary" });
      return;
    }
    if (item.target === "invocation") {
      setSelectedInvocationId(item.id);
      navigate("invocations");
      return;
    }
    if (item.target === "template") {
      const task = templateAlerts.find((candidate) => candidate.id === item.id);
      const url = new URL(window.location.href);
      url.searchParams.set("section", "workflowMemory");
      if (task?.stage === "needs_case_review") url.searchParams.set("sourceId", task.sourceId);
      else url.searchParams.delete("sourceId");
      window.location.assign(url.toString());
      return;
    }
    navigate(fallback);
  }

  function markResultsRead() {
    const next = new Set([...(seenCompletionIds ?? []), ...model.completions.items.map((item) => item.id)]);
    writeStringArray(COMPLETION_SEEN_KEY, next);
    setSeenCompletionIds(next);
  }

  async function enableBrowserNotifications() {
    if (permission === "unsupported") return;
    const next = Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();
    setPermission(next);
    if (next === "granted") {
      writeStringArray(DELIVERY_BASELINE_KEY, notificationEventIds);
      try {
        localStorage.setItem(DELIVERY_ENABLED_KEY, "true");
      } catch {
        return;
      }
      setDeliveryEnabled(true);
    }
  }

  function disableBrowserNotifications() {
    try {
      localStorage.setItem(DELIVERY_ENABLED_KEY, "false");
    } catch {
      // State still changes for the current session.
    }
    setDeliveryEnabled(false);
  }

  const accessibleLabel = t("notificationCenter.triggerLabel", {
    action: actionCount,
    unread: unreadCount,
  });

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={accessibleLabel}
        aria-expanded={open}
        aria-controls="notification-center"
        onClick={() => setOpen((value) => !value)}
        className="relative grid size-11 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Bell className="size-5" aria-hidden="true" />
        {actionCount > 0 ? (
          <span
            aria-hidden="true"
            className={cn(
              "absolute right-0 top-0 min-w-4 rounded-full px-1 text-center text-[9px] font-semibold leading-4",
              hasDanger ? "bg-destructive text-destructive-foreground" : "bg-warning text-warning-foreground",
            )}
          >
            {actionCount > 99 ? "99+" : actionCount}
          </span>
        ) : unreadCount > 0 ? (
          <span aria-hidden="true" className="absolute right-1 top-1 size-2.5 rounded-full bg-primary" />
        ) : null}
      </button>

      {open ? (
        <div
          id="notification-center"
          role="dialog"
          aria-modal="true"
          aria-label={t("notificationCenter.title")}
          className="absolute right-0 top-12 z-50 flex w-[min(calc(100vw-1rem),24rem)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
          style={{ maxHeight: "min(calc(100vh - 4.5rem), 40rem)" }}
        >
          <div className="flex items-start gap-2 border-b border-border px-3 py-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold">{t("notificationCenter.title")}</h2>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <Badge tone={hasDanger ? "danger" : actionCount > 0 ? "warning" : "neutral"}>
                  {t("notificationCenter.actionCount", { count: actionCount })}
                </Badge>
                <Badge tone={unreadCount > 0 ? "running" : "neutral"}>
                  {t("notificationCenter.unreadCount", { count: unreadCount })}
                </Badge>
              </div>
            </div>
            <button
              ref={closeRef}
              type="button"
              aria-label={t("notificationCenter.close")}
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
              }}
              className="grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          <div className="overflow-y-auto p-2">
            {actionCount === 0 && unreadCount === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-muted-foreground">{t("notificationCenter.empty")}</p>
            ) : null}
            {templateAlerts.length > 0 ? (
              <NotificationGroup>
                <NotificationRow
                  icon={<Sparkles className="size-5 text-primary" />}
                  title={t("notificationCenter.templates")}
                  description={templateAlerts.some((task) => task.stage === "failed")
                    ? t("notificationCenter.templatesFailedHint")
                    : t("notificationCenter.templatesHint")}
                  count={templateAlerts.length}
                  tone={templateAlerts.some((task) => task.stage === "failed") ? "danger" : "warning"}
                  onClick={() => openSection("workflowMemory")}
                />
                <NotificationItemLinks items={templateItems} onOpen={(item) => openNotificationItem(item, "workflowMemory")} />
              </NotificationGroup>
            ) : null}
            {model.approvals.count > 0 ? (
              <NotificationGroup>
                <NotificationRow
                  icon={<ShieldCheck className="size-5 text-warning" />}
                  title={t("notificationCenter.approvals")}
                  description={t("notificationCenter.approvalsHint")}
                  count={model.approvals.count}
                  tone="warning"
                  onClick={() => openSection("approvals")}
                />
                <NotificationItemLinks items={model.approvals.items} onOpen={(item) => openNotificationItem(item, "approvals")} />
              </NotificationGroup>
            ) : null}
            {model.failures.count > 0 ? (
              <NotificationGroup>
                <NotificationRow
                  icon={<CircleAlert className="size-5 text-destructive" />}
                  title={t("notificationCenter.failures")}
                  description={t("notificationCenter.failuresHint")}
                  count={model.failures.count}
                  tone="danger"
                  onClick={() => openSection("workBoard")}
                />
                <NotificationItemLinks items={model.failures.items} onOpen={(item) => openNotificationItem(item, "workBoard")} />
              </NotificationGroup>
            ) : null}
            {model.offline ? (
              <NotificationRow
                icon={<WifiOff className="size-5 text-destructive" />}
                title={t("notificationCenter.executionOffline")}
                description={t("notificationCenter.executionOfflineHint")}
                count={1}
                tone="danger"
                onClick={() => openSection("devices")}
              />
            ) : null}
            {unreadCount > 0 ? (
              <NotificationGroup>
                <NotificationRow
                  icon={<CheckCircle2 className="size-5 text-success" />}
                  title={t("notificationCenter.completions")}
                  description={t("notificationCenter.completionsHint")}
                  count={unreadCount}
                  tone="success"
                  onClick={() => {
                    markResultsRead();
                    openSection("workBoard");
                  }}
                />
                <NotificationItemLinks items={unreadCompletionItems} onOpen={(item) => {
                  markResultsRead();
                  openNotificationItem(item, "workBoard");
                }} />
              </NotificationGroup>
            ) : null}

            <details className="mt-2 rounded-lg border border-border bg-background/40" open={model.offline || model.fallback}>
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium">
                <CircleAlert className="size-4 text-muted-foreground" aria-hidden="true" />
                {t("notificationCenter.status.title")}
                <Badge className="ml-auto" tone={model.offline ? "danger" : model.fallback ? "warning" : "success"}>
                  {model.offline
                    ? t("notificationCenter.status.offline")
                    : model.fallback
                      ? t("notificationCenter.status.fallback")
                      : t("notificationCenter.status.healthy")}
                </Badge>
              </summary>
              <div className="space-y-2 border-t border-border px-3 py-3 text-xs">
                <StatusLine
                  label={t("notificationCenter.status.server")}
                  value={isError ? t("notificationCenter.status.offline") : isLoading ? t("notificationCenter.status.connecting") : t("notificationCenter.status.connected")}
                />
                <StatusLine
                  label={t("notificationCenter.status.computer")}
                  value={state?.device
                    ? `${state.device.name} · ${state.device.status === "online" ? t("notificationCenter.status.online") : t("notificationCenter.status.offline")}`
                    : t("notificationCenter.status.unknown")}
                />
                <StatusLine
                  label={t("notificationCenter.status.updates")}
                  value={liveUpdates ? t("notificationCenter.status.realtime") : t("notificationCenter.status.periodic")}
                />
              </div>
            </details>

            <section className="mt-2 rounded-lg border border-border bg-background/40 px-3 py-3">
              <div className="flex items-start gap-2">
                <BellRing className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-medium">{t("notificationCenter.browser.titleSetting")}</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t("notificationCenter.browser.privacy")}</p>
                  <div className="mt-2 flex items-center gap-2">
                    {deliveryEnabled ? (
                      <Button variant="secondary" size="sm" className="min-h-11" onClick={disableBrowserNotifications}>
                        {t("notificationCenter.browser.disable")}
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="min-h-11"
                        disabled={permission === "unsupported" || permission === "denied"}
                        onClick={() => void enableBrowserNotifications()}
                      >
                        {permission === "unsupported"
                          ? t("notificationCenter.browser.unsupported")
                          : permission === "denied"
                            ? t("notificationCenter.browser.denied")
                            : t("notificationCenter.browser.enable")}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NotificationGroup({ children }: { children: ReactNode }) {
  return <section className="rounded-lg hover:bg-muted/20">{children}</section>;
}

function NotificationItemLinks({
  items,
  onOpen,
}: {
  items: NotificationItem[];
  onOpen: (item: NotificationItem) => void;
}) {
  if (!items.length) return null;
  return (
    <ul className="space-y-1 px-3 pb-2 pl-11">
      {items.slice(0, 4).map((item) => (
        <li key={`${item.target}:${item.id}`}>
          <button
            type="button"
            className="min-h-9 w-full truncate rounded-md px-2 text-left text-xs font-medium text-primary hover:bg-primary/10"
            title={item.title}
            onClick={() => onOpen(item)}
          >
            {item.title}
          </button>
        </li>
      ))}
    </ul>
  );
}

function NotificationRow({
  icon,
  title,
  description,
  count,
  tone,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  count: number;
  tone: "warning" | "danger" | "success";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-14 w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-muted/60"
    >
      <span aria-hidden="true">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      <Badge tone={tone}>{count}</Badge>
      <span aria-hidden="true" className="text-muted-foreground">›</span>
    </button>
  );
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
