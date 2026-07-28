import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Building2, ExternalLink, KeyRound, Monitor, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  beginIdentityChallenge,
  cancelIdentityChallenge,
  completePasswordRecovery,
  getCurrentSession,
  getIdentityChallenge,
  getIdentityOptions,
  loginLocal,
  loginWithCredentials,
  ApiError,
  type IdentityChallengeResponse,
  type IdentityOptions,
  type IdentityProviderCapability,
  type SessionUser,
} from "@/lib/api-client";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { safeAuthorizationUri, stageForChallenge, type IdentityEntryStage } from "./identity-entry-model";

export function IdentityEntryPanel({
  compact = false,
  onSignedIn,
}: {
  compact?: boolean;
  onSignedIn?: (user: SessionUser) => void;
}) {
  const { t, i18n } = useAppTranslation();
  const [options, setOptions] = useState<IdentityOptions | null>(null);
  const [stage, setStage] = useState<IdentityEntryStage>("entry");
  const [challenge, setChallenge] = useState<IdentityChallengeResponse | null>(null);
  const [provider, setProvider] = useState<IdentityProviderCapability | null>(null);
  const [teamId, setTeamId] = useState("");
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [recoveryToken, setRecoveryToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [recoveryDone, setRecoveryDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOptions = useCallback(async () => {
    setError(null);
    try {
      setOptions(await getIdentityOptions());
    } catch {
      setError(t("identityEntry.optionsFailed"));
    }
  }, [t]);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    if (!challenge?.challenge.id || !["waiting", "confirmed"].includes(stage)) return;
    const timer = window.setInterval(async () => {
      try {
        const latest = await getIdentityChallenge(challenge.challenge.id);
        setChallenge((current) => ({ ...latest, authorizationUri: current?.authorizationUri }));
        if (latest.challenge.state === "consumed") {
          const session = await getCurrentSession();
          if (session?.user) onSignedIn?.(session.user);
          return;
        }
        setStage(stageForChallenge(latest.challenge.state));
      } catch {
        setStage("rejected");
      }
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [challenge?.challenge.id, onSignedIn, stage]);

  async function localSignIn() {
    setBusy(true);
    setError(null);
    try {
      onSignedIn?.(await loginLocal());
    } catch {
      setError(t("identityEntry.localFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function passwordSignIn(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await loginWithCredentials(teamId.trim(), userId.trim(), password);
      if (user) onSignedIn?.(user);
    } catch {
      setError(t("identityEntry.passwordFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function recoverPassword(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError(t("identityEntry.recoveryMismatch"));
      return;
    }
    setBusy(true);
    try {
      await completePasswordRecovery({
        teamId: teamId.trim(),
        userId: userId.trim(),
        recoveryToken: recoveryToken.trim(),
        newPassword,
      });
      setRecoveryToken("");
      setNewPassword("");
      setConfirmPassword("");
      setRecoveryDone(true);
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : "recovery_failed";
      if (code === "password_too_short") setError(t("identityEntry.recoveryTooShort"));
      else if (code === "password_too_long") setError(t("identityEntry.recoveryTooLong"));
      else if (code === "password_blocklisted") setError(t("identityEntry.recoveryBlocklisted"));
      else setError(t("identityEntry.recoveryFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function startProvider(selected: IdentityProviderCapability) {
    setBusy(true);
    setError(null);
    setProvider(selected);
    try {
      const started = await beginIdentityChallenge(selected.provider);
      setChallenge(started);
      setStage(stageForChallenge(started.challenge.state));
    } catch {
      setStage("rejected");
    } finally {
      setBusy(false);
    }
  }

  async function leaveChallenge() {
    if (challenge?.challenge.id) await cancelIdentityChallenge(challenge.challenge.id).catch(() => undefined);
    setChallenge(null);
    setProvider(null);
    setStage("entry");
    setError(null);
  }

  const authorizationUri = useMemo(
    () => safeAuthorizationUri(challenge?.authorizationUri),
    [challenge?.authorizationUri],
  );

  if (stage === "password") {
    return (
      <form className="space-y-3" onSubmit={passwordSignIn}>
        <EntryHeading title={t("identityEntry.passwordTitle")} description={t("identityEntry.passwordDescription")} />
        <Input aria-label={t("identityEntry.teamId")} placeholder={t("identityEntry.teamId")} value={teamId} onChange={(event) => setTeamId(event.target.value)} autoComplete="organization" autoFocus />
        <Input aria-label={t("login.userId")} placeholder={t("login.userId")} value={userId} onChange={(event) => setUserId(event.target.value)} autoComplete="username" />
        <Input aria-label={t("login.password")} type="password" placeholder={t("login.password")} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
        {error ? <ErrorText>{error}</ErrorText> : null}
        <div className="flex justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setStage("entry")}>{t("identityEntry.back")}</Button>
          <Button type="submit" size="sm" disabled={busy || !teamId.trim() || !userId.trim() || !password}>{busy ? t("login.signingIn") : t("login.signIn")}</Button>
        </div>
        <button type="button" className="text-xs text-muted-foreground underline-offset-4 hover:underline" onClick={() => setStage("recovery")}>
          {t("identityEntry.needHelp")}
        </button>
      </form>
    );
  }

  if (["waiting", "confirmed"].includes(stage) && challenge) {
    return (
      <div className="space-y-3" data-identity-stage={stage}>
        <EntryHeading
          title={stage === "confirmed" ? t("identityEntry.confirmedTitle") : t("identityEntry.waitingTitle")}
          description={stage === "confirmed" ? t("identityEntry.confirmedDescription") : t("identityEntry.waitingDescription")}
        />
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs">
          <p className="font-medium">{provider?.label}</p>
          <p className="mt-1 text-muted-foreground">{t("identityEntry.boundContext", { origin: window.location.origin })}</p>
          <p className="mt-1 text-muted-foreground">{t("identityEntry.expiresAt", { time: new Date(challenge.challenge.expiresAt).toLocaleTimeString(i18n.resolvedLanguage) })}</p>
        </div>
        {authorizationUri ? (
          <a className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground" href={authorizationUri} target="_blank" rel="noreferrer">
            {t("identityEntry.continueProvider", { provider: provider?.label ?? provider?.provider ?? "" })}<ExternalLink className="size-4" />
          </a>
        ) : null}
        <p className="text-xs text-muted-foreground">{t("identityEntry.noSharedDetails")}</p>
        <Button type="button" variant="ghost" size="sm" onClick={() => void leaveChallenge()}>{t("shared.cancel")}</Button>
      </div>
    );
  }

  if (stage === "expired") {
    return (
      <RecoveryState
        icon={RefreshCw}
        title={t("identityEntry.expiredTitle")}
        description={t("identityEntry.expiredDescription")}
        action={t("identityEntry.refreshCode")}
        onAction={() => provider && void startProvider(provider)}
        onBack={() => void leaveChallenge()}
      />
    );
  }

  if (stage === "rejected") {
    return (
      <RecoveryState
        icon={AlertCircle}
        title={t("identityEntry.rejectedTitle")}
        description={t("identityEntry.rejectedDescription")}
        action={t("identityEntry.changeMethod")}
        onAction={() => void leaveChallenge()}
        onBack={options?.passwordMode ? () => setStage("password") : undefined}
      />
    );
  }

  if (stage === "recovery") {
    if (recoveryDone) {
      return (
        <RecoveryState
          icon={ShieldCheck}
          title={t("identityEntry.recoveryDoneTitle")}
          description={t("identityEntry.recoveryDoneDescription")}
          action={t("identityEntry.backToPassword")}
          onAction={() => {
            setRecoveryDone(false);
            setStage("password");
          }}
          onBack={() => setStage("entry")}
        />
      );
    }
    return (
      <form className="space-y-3" onSubmit={recoverPassword}>
        <ShieldCheck className="size-6 text-primary" aria-hidden="true" />
        <EntryHeading title={t("identityEntry.recoveryTitle")} description={t("identityEntry.recoveryDescription")} />
        <Input aria-label={t("identityEntry.teamId")} placeholder={t("identityEntry.teamId")} value={teamId} onChange={(event) => setTeamId(event.target.value)} autoComplete="organization" />
        <Input aria-label={t("login.userId")} placeholder={t("login.userId")} value={userId} onChange={(event) => setUserId(event.target.value)} autoComplete="username" />
        <Input aria-label={t("identityEntry.recoveryToken")} placeholder={t("identityEntry.recoveryToken")} value={recoveryToken} onChange={(event) => setRecoveryToken(event.target.value)} autoComplete="off" />
        <Input aria-label={t("identityEntry.newPassword")} type="password" placeholder={t("identityEntry.newPassword")} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" />
        <Input aria-label={t("identityEntry.confirmPassword")} type="password" placeholder={t("identityEntry.confirmPassword")} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" />
        <p className="text-xs text-muted-foreground">{t("identityEntry.passwordGuidance")}</p>
        {error ? <ErrorText>{error}</ErrorText> : null}
        <div className="flex justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setStage("password")}>{t("identityEntry.back")}</Button>
          <Button type="submit" size="sm" disabled={busy || !teamId.trim() || !userId.trim() || !recoveryToken.trim() || !newPassword || !confirmPassword}>
            {busy ? t("identityEntry.recovering") : t("identityEntry.completeRecovery")}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-3" data-identity-stage="entry">
      <EntryHeading title={t("identityEntry.title")} description={t("identityEntry.description")} />
      {options?.localMode ? (
        <button type="button" disabled={busy} onClick={() => void localSignIn()} className="flex min-h-16 w-full items-center gap-3 rounded-lg border border-border p-3 text-left hover:border-primary/50 hover:bg-muted/40 disabled:opacity-50">
          <Monitor className="size-5 text-primary" aria-hidden="true" />
          <span><span className="block text-sm font-medium">{t("identityEntry.local")}</span><span className="block text-xs text-muted-foreground">{t("identityEntry.localHint")}</span></span>
        </button>
      ) : null}
      <div className="rounded-lg border border-border p-3">
        <div className="flex items-center gap-3">
          <Building2 className="size-5 text-primary" aria-hidden="true" />
          <span><span className="block text-sm font-medium">{t("identityEntry.team")}</span><span className="block text-xs text-muted-foreground">{t("identityEntry.teamHint")}</span></span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {options?.providers.map((item) => (
            <Button key={item.provider} type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void startProvider(item)}>{item.label}</Button>
          ))}
          {options && options.providers.length === 0 ? <p className="text-xs text-muted-foreground">{t("identityEntry.noProviders")}</p> : null}
        </div>
      </div>
      {options?.passwordMode ? (
        <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => setStage("password")}>
          <KeyRound className="size-4" />{t("identityEntry.passwordFallback")}
        </Button>
      ) : null}
      {!options && !error ? <p role="status" className="text-xs text-muted-foreground">{t("identityEntry.loading")}</p> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      {error ? <Button type="button" variant="ghost" size="sm" onClick={() => void loadOptions()}>{t("shared.tryAgain")}</Button> : null}
      {!compact ? <p className="text-xs text-muted-foreground">{t("identityEntry.boundaryNote")}</p> : null}
    </div>
  );
}

function EntryHeading({ title, description }: { title: string; description: string }) {
  return <div><h2 className="text-sm font-semibold">{title}</h2><p className="mt-1 text-xs text-muted-foreground">{description}</p></div>;
}

function ErrorText({ children }: { children: string }) {
  return <p role="alert" className="text-xs text-destructive">{children}</p>;
}

function RecoveryState({
  icon: Icon,
  title,
  description,
  action,
  onAction,
  onBack,
}: {
  icon: typeof AlertCircle;
  title: string;
  description: string;
  action: string;
  onAction: () => void;
  onBack?: () => void;
}) {
  const { t } = useAppTranslation();
  return (
    <div className="space-y-3">
      <Icon className="size-6 text-primary" aria-hidden="true" />
      <EntryHeading title={title} description={description} />
      <Button type="button" size="sm" onClick={onAction}>{action}</Button>
      {onBack ? <Button type="button" variant="ghost" size="sm" onClick={onBack}>{t("identityEntry.back")}</Button> : null}
    </div>
  );
}
