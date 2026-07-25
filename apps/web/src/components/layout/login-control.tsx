import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConsoleState, useRefreshConsoleState } from "@/data/use-console-state";
import {
  getSessionUser,
  loginWithCredentials,
  logout,
  type SessionUser,
} from "@/lib/api-client";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { pageRegistration } from "@/app/sections";
import { useUiStore } from "@/store/ui-store";
import { Badge } from "@/components/ui/badge";

/**
 * Account control (9B). In default local dev the client auto-logs-in as the
 * seeded passwordless user, so this just shows who you are and offers sign-out.
 * When the server requires auth (or you want a specific tenant), open the form
 * and sign in with a user id + password — the token is stored and the next
 * state poll reflects the new identity.
 */
export function LoginControl() {
  const { t } = useAppTranslation();
  const refresh = useRefreshConsoleState();
  const { data: consoleState } = useConsoleState();
  const [user, setUser] = useState<SessionUser | null>(() => getSessionUser());
  const [open, setOpen] = useState(false);
  const [authorityOpen, setAuthorityOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const section = useUiStore((state) => state.section);
  const authority = pageRegistration(section).authority;
  const roleKey = {
    owner: "identity.role.owner",
    admin: "identity.role.admin",
    operator: "identity.role.operator",
    viewer: "identity.role.viewer",
  } as const;
  const authorityKey = {
    ordinary: "identity.authority.ordinary",
    manage: "identity.authority.manage",
    audit: "identity.authority.audit",
  } as const;
  useEffect(() => {
    const current = getSessionUser();
    if (current?.id !== user?.id || current?.role !== user?.role) setUser(current);
  }, [consoleState, user?.id, user?.role]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const signedIn = await loginWithCredentials(userId.trim(), password);
      setUser(signedIn);
      setOpen(false);
      setUserId("");
      setPassword("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("login.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    await logout();
    setUser(null);
    await refresh();
    setBusy(false);
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        {user ? (
          <button type="button" onClick={() => setAuthorityOpen((value) => !value)} aria-expanded={authorityOpen} className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
            {user.name ?? user.id}
            <Badge tone="neutral">{t(roleKey[user.role ?? "viewer"])}</Badge>
            <Badge tone={authority === "ordinary" ? "success" : authority === "manage" ? "warning" : "neutral"}>
              {t(authorityKey[authority])}
            </Badge>
          </button>
        ) : null}
        {user ? <Badge tone="neutral" className="sm:hidden">{t(authorityKey[authority])}</Badge> : null}
        {user ? (
          <Button variant="ghost" size="sm" onClick={signOut} disabled={busy}>
            {t("login.signOut")}
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setOpen((v) => !v)}>
            {t("login.signIn")}
          </Button>
        )}
      </div>

      {authorityOpen && user ? (
        <div className="absolute right-0 top-10 z-20 w-72 space-y-2 rounded-md border border-border bg-card p-3 text-xs shadow-lg">
          <p className="font-medium">{t("identity.whyTitle")}</p>
          <p>{t("identity.roleSource", { role: t(roleKey[user.role ?? "viewer"]) })}</p>
          <p>{t("identity.teamSource", { team: user.teamId ?? t("identity.localTeam") })}</p>
          <p>{t("identity.surfaceSource", { authority: t(authorityKey[authority]) })}</p>
          <p className="text-muted-foreground">{t("identity.enforcement")}</p>
        </div>
      ) : null}

      {open && !user ? (
        <form
          onSubmit={submit}
          className="absolute right-0 top-10 z-20 w-64 space-y-2 rounded-md border border-border bg-card p-3 shadow-lg"
        >
          <p className="text-xs font-medium text-foreground">{t("login.signIn")}</p>
          <Input
            placeholder={t("login.userId")}
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            autoFocus
          />
          <Input
            type="password"
            placeholder={t("login.password")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              {t("shared.cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={busy || !userId.trim()}>
              {busy ? t("login.signingIn") : t("login.signIn")}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
