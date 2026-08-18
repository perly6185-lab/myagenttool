import { useEffect, useState } from "react";
import {
  ensureSession,
  getSessionUser,
  SESSION_CHANGED_EVENT,
  type SessionUser,
} from "@/lib/api-client";

let sessionRefresh: Promise<unknown> | null = null;

function refreshSessionOnce() {
  if (!sessionRefresh) {
    // Share the transport's cached session discovery. Calling the full
    // session-details endpoint from every shell surface caused repeated 401s
    // for a perfectly valid signed-out local workspace.
    sessionRefresh = ensureSession()
      .catch(() => null)
      .finally(() => { sessionRefresh = null; });
  }
  return sessionRefresh;
}

/** Reactive view of the server-verified browser session shared by shell surfaces. */
export function useSessionUser() {
  const [user, setUser] = useState<SessionUser | null>(() => getSessionUser());

  useEffect(() => {
    const sync = () => setUser(getSessionUser());
    window.addEventListener(SESSION_CHANGED_EVENT, sync);
    void refreshSessionOnce();
    return () => window.removeEventListener(SESSION_CHANGED_EVENT, sync);
  }, []);

  return user;
}
