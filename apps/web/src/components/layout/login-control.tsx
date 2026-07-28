import { lazy, Suspense, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useRefreshConsoleState } from "@/data/use-console-state";
import {
  getCurrentSession,
  getSessionUser,
  SESSION_CHANGED_EVENT,
  type SessionUser,
} from "@/lib/api-client";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { cn } from "@/lib/cn";
import { useUiStore } from "@/store/ui-store";

const IdentityAccountPanel = lazy(() => import("@/features/me/identity-account-panel")
  .then((module) => ({ default: module.IdentityAccountPanel })));
const IdentityEntryPanel = lazy(() => import("@/features/me/identity-entry-panel")
  .then((module) => ({ default: module.IdentityEntryPanel })));

function useSessionUser() {
  const [user, setUser] = useState<SessionUser | null>(() => getSessionUser());
  useEffect(() => {
    const sync = () => setUser(getSessionUser());
    window.addEventListener(SESSION_CHANGED_EVENT, sync);
    void getCurrentSession().catch(() => undefined);
    return () => window.removeEventListener(SESSION_CHANGED_EVENT, sync);
  }, []);
  return [user, setUser] as const;
}

/** Identity entry in the top bar; the expanded form is the Me account surface. */
export function LoginControl({ expanded = false }: { expanded?: boolean }) {
  const { t } = useAppTranslation();
  const [user, setUser] = useSessionUser();
  const [open, setOpen] = useState(false);
  const setSection = useUiStore((state) => state.setSection);
  const refresh = useRefreshConsoleState();

  function signedIn(next: SessionUser) {
    setUser(next);
    setOpen(false);
    void refresh();
  }

  function signedOut() {
    setUser(null);
    void refresh();
  }

  if (expanded) {
    return (
      <Suspense fallback={<IdentityPanelFallback label={t("tasks.loading")} />}>
        {user
          ? <IdentityAccountPanel user={user} onSignedOut={signedOut} />
          : <IdentityEntryPanel onSignedIn={signedIn} />}
      </Suspense>
    );
  }

  return (
    <div className="relative">
      {user ? (
        <button
          type="button"
          onClick={() => setSection("me")}
          className="hidden items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground sm:flex"
          aria-label={t("identityAccount.open")}
        >
          <span className="max-w-28 truncate">{user.name ?? user.id}</span>
          <Badge tone="neutral">{t(`identity.role.${user.role ?? "viewer"}`)}</Badge>
        </button>
      ) : (
        <Button variant="secondary" size="sm" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          {t("login.signIn")}
        </Button>
      )}

      {open && !user ? (
        <div className={cn("absolute right-0 top-10 z-30 w-[min(23rem,calc(100vw-1.5rem))] rounded-xl border border-border bg-card p-4 shadow-xl")}>
          <Suspense fallback={<IdentityPanelFallback label={t("tasks.loading")} />}>
            <IdentityEntryPanel compact onSignedIn={signedIn} />
          </Suspense>
        </div>
      ) : null}
    </div>
  );
}

function IdentityPanelFallback({ label }: { label: string }) {
  return <div role="status" className="py-6 text-center text-sm text-muted-foreground">{label}</div>;
}
