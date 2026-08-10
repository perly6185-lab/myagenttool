import { pageRegistration } from "@/app/sections";
import type { SessionUser } from "@/lib/api-client";
import type { SectionKey } from "@/store/ui-store";

export type SessionRole = NonNullable<SessionUser["role"]>;

const OPERATIONAL_PROFESSIONAL_PAGES = new Set<SectionKey>([
  "approvals",
  "autoRuns",
  "compare",
]);

/**
 * Discovery policy only. The server remains the authorization boundary for
 * every read and mutation; this prevents the shell advertising controls that
 * a verified role normally cannot administer.
 *
 * An unknown role stays compatible with local/offline startup until the
 * server-verified session arrives.
 */
export function canDiscoverProfessionalPage(section: SectionKey, role?: SessionRole) {
  if (!role) return true;
  const page = pageRegistration(section);
  if (page.authority === "manage") return role === "owner" || role === "admin";
  if (OPERATIONAL_PROFESSIONAL_PAGES.has(section)) return role !== "viewer";
  return true;
}

export function canManageProfessionalSettings(role?: SessionRole) {
  return !role || role === "owner" || role === "admin";
}
