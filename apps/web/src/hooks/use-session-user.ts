import { useEffect, useState } from "react";
import {
  getCurrentSession,
  getSessionUser,
  SESSION_CHANGED_EVENT,
  type SessionUser,
} from "@/lib/api-client";

let sessionRefresh: Promise<unknown> | null = null;

function refreshSessionOnce() {
  if (!sessionRefresh) {
    sessionRefresh = getCurrentSession()
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
