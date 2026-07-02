import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRefreshConsoleState } from "@/data/use-console-state";
import {
  getSessionUser,
  loginWithCredentials,
  logout,
  type SessionUser,
} from "@/lib/api-client";

/**
 * Account control (9B). In default local dev the client auto-logs-in as the
 * seeded passwordless user, so this just shows who you are and offers sign-out.
 * When the server requires auth (or you want a specific tenant), open the form
 * and sign in with a user id + password — the token is stored and the next
 * state poll reflects the new identity.
 */
export function LoginControl() {
  const refresh = useRefreshConsoleState();
  const [user, setUser] = useState<SessionUser | null>(() => getSessionUser());
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      setError(err instanceof Error ? err.message : "Sign in failed.");
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
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {user.name ?? user.id}
          </span>
        ) : null}
        {user ? (
          <Button variant="ghost" size="sm" onClick={signOut} disabled={busy}>
            Sign out
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setOpen((v) => !v)}>
            Sign in
          </Button>
        )}
      </div>

      {open && !user ? (
        <form
          onSubmit={submit}
          className="absolute right-0 top-10 z-20 w-64 space-y-2 rounded-md border border-border bg-card p-3 shadow-lg"
        >
          <p className="text-xs font-medium text-foreground">Sign in</p>
          <Input
            placeholder="User id"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            autoFocus
          />
          <Input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={busy || !userId.trim()}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
