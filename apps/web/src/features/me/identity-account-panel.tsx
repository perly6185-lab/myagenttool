import { useEffect, useState } from "react";
import { Clock3, Copy, KeyRound, Laptop, ShieldAlert, ShieldCheck, UsersRound } from "lucide-react";
import { ConfirmModal } from "@/components/common/confirm-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getCurrentSession,
  getIdentitySecurityAlerts,
  issuePasswordRecovery,
  logout,
  logoutAllSessions,
  type PasswordRecoveryGrantResponse,
  type SessionInfo,
  type SessionUser,
} from "@/lib/api-client";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

export function IdentityAccountPanel({
  user,
  onSignedOut,
}: {
  user: SessionUser;
  onSignedOut?: () => void;
}) {
  const { t, i18n } = useAppTranslation();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [confirm, setConfirm] = useState<"current" | "all" | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryUserId, setRecoveryUserId] = useState("");
  const [recoveryGrant, setRecoveryGrant] = useState<PasswordRecoveryGrantResponse | null>(null);
  const [recoveryPending, setRecoveryPending] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [openSecurityAlerts, setOpenSecurityAlerts] = useState(0);
  const canRecoverUsers = ["owner", "admin"].includes(user.role ?? "") && user.teamId !== "team_local";

  useEffect(() => {
    void getCurrentSession()
      .then((result) => setSession(result?.session ?? null))
      .catch(() => setError(t("identityAccount.loadFailed")));
  }, [t]);

  useEffect(() => {
    if (!canRecoverUsers) return;
    void getIdentitySecurityAlerts()
      .then((alerts) => setOpenSecurityAlerts(alerts.filter((alert) => alert.status === "open").length))
      .catch(() => undefined);
  }, [canRecoverUsers]);

  const roleKey = {
    owner: "identity.role.owner",
    admin: "identity.role.admin",
    operator: "identity.role.operator",
    viewer: "identity.role.viewer",
  } as const;
  const modeKey = {
    local: "identityAccount.mode.local",
    password: "identityAccount.mode.password",
    enterprise: "identityAccount.mode.enterprise",
  } as const;

  async function confirmLogout() {
    if (!confirm) return;
    setPending(true);
    setError(null);
    try {
      if (confirm === "all") await logoutAllSessions();
      else await logout();
      setConfirm(null);
      onSignedOut?.();
    } catch {
      setError(t("identityAccount.logoutFailed"));
    } finally {
      setPending(false);
    }
  }

  async function authorizeRecovery(event: React.FormEvent) {
    event.preventDefault();
    setRecoveryPending(true);
    setRecoveryError(null);
    setRecoveryGrant(null);
    try {
      setRecoveryGrant(await issuePasswordRecovery(recoveryUserId.trim()));
    } catch {
      setRecoveryError(t("identityAccount.recoveryFailed"));
    } finally {
      setRecoveryPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{user.name ?? user.id}</p>
          <p className="text-xs text-muted-foreground">{user.id}</p>
        </div>
        <Badge tone="success"><ShieldCheck className="size-3" />{t(roleKey[user.role ?? "viewer"])}</Badge>
      </div>

      <dl className="grid gap-3 rounded-lg border border-border bg-muted/30 p-3 text-xs sm:grid-cols-2">
        <SessionFact icon={UsersRound} label={t("identityAccount.team")} value={user.teamId ?? t("identity.localTeam")} />
        <SessionFact icon={Laptop} label={t("identityAccount.device")} value={t("identityAccount.thisComputer")} />
        <SessionFact icon={ShieldCheck} label={t("identityAccount.method")} value={t(modeKey[session?.mode ?? "local"])} />
        <SessionFact
          icon={Clock3}
          label={t("identityAccount.expires")}
          value={session?.absoluteExpiresAt ? new Date(session.absoluteExpiresAt).toLocaleString(i18n.resolvedLanguage) : t("identityAccount.loading")}
        />
      </dl>

      <p className="text-xs text-muted-foreground">{t("identityAccount.serverAuthority")}</p>
      {openSecurityAlerts > 0 ? (
        <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
          <p>{t("identityAccount.securityAlerts", { count: openSecurityAlerts })}</p>
        </div>
      ) : null}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}

      {canRecoverUsers ? (
        <form className="space-y-3 rounded-lg border border-border p-3" onSubmit={authorizeRecovery}>
          <div className="flex gap-2">
            <KeyRound className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <h3 className="text-xs font-semibold">{t("identityAccount.recoveryTitle")}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{t("identityAccount.recoveryDescription")}</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              aria-label={t("identityAccount.recoveryUserId")}
              placeholder={t("identityAccount.recoveryUserId")}
              value={recoveryUserId}
              onChange={(event) => {
                setRecoveryUserId(event.target.value);
                setRecoveryGrant(null);
              }}
              autoComplete="off"
            />
            <Button type="submit" size="sm" disabled={recoveryPending || !recoveryUserId.trim()}>
              {recoveryPending ? t("identityAccount.authorizing") : t("identityAccount.authorizeRecovery")}
            </Button>
          </div>
          {recoveryError ? <p role="alert" className="text-xs text-destructive">{recoveryError}</p> : null}
          {recoveryGrant ? (
            <div className="space-y-2 rounded-md bg-muted p-3 text-xs">
              <p className="font-medium">{t("identityAccount.recoveryTokenOnce")}</p>
              <code className="block break-all rounded bg-background p-2">{recoveryGrant.recoveryToken}</code>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-muted-foreground">
                  {t("identityAccount.recoveryExpires", {
                    time: new Date(recoveryGrant.grant.expiresAt).toLocaleString(i18n.resolvedLanguage),
                  })}
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={() => void navigator.clipboard?.writeText(recoveryGrant.recoveryToken)}>
                  <Copy className="size-3" />{t("identityAccount.copyRecovery")}
                </Button>
              </div>
            </div>
          ) : null}
        </form>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => setConfirm("current")}>{t("identityAccount.logoutCurrent")}</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setConfirm("all")}>{t("identityAccount.logoutAll")}</Button>
      </div>

      <ConfirmModal
        open={confirm !== null}
        title={confirm === "all" ? t("identityAccount.logoutAllTitle") : t("identityAccount.logoutCurrentTitle")}
        description={confirm === "all" ? t("identityAccount.logoutAllDescription") : t("identityAccount.logoutCurrentDescription")}
        confirmLabel={confirm === "all" ? t("identityAccount.logoutAll") : t("identityAccount.logoutCurrent")}
        destructive
        pending={pending}
        error={error}
        onConfirm={() => void confirmLogout()}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}

function SessionFact({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Laptop;
  label: string;
  value: string;
}) {
  return (
    <div className="flex gap-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div><dt className="text-muted-foreground">{label}</dt><dd className="mt-0.5 font-medium text-foreground">{value}</dd></div>
    </div>
  );
}
