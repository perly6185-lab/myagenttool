import {
  SECTION_KEYS,
  searchFromNavigationState,
  type ApplicationRunSelection,
  type SectionKey,
  type UrlNavigationState,
} from "@/store/ui-store";

const NAVIGATION_QUERY_KEYS = ["section", "invocation", "application", "routine", "run", "evidence"] as const;

interface WebNavigationTarget {
  section: SectionKey;
  selectedInvocationId?: string | null;
  selectedApplicationId?: string | null;
  selectedApplicationRun?: ApplicationRunSelection | null;
  selectedEvidenceId?: string | null;
  /** A focused schedule, so an attention badge can be linked to (#849). */
  selectedAutomationId?: string | null;
}

interface RelativeWebNavigationLink {
  query: string;
  target?: Record<string, unknown>;
}

function currentHref(): string {
  return typeof window === "undefined" ? "http://localhost/" : window.location.href;
}

export function webDeepLink(target: WebNavigationTarget, href = currentHref()): string {
  const url = new URL(href);
  url.search = searchFromNavigationState(url.search, {
    section: target.section,
    selectedInvocationId: target.selectedInvocationId ?? null,
    selectedApplicationId: target.selectedApplicationId ?? null,
    selectedApplicationRun: target.selectedApplicationRun ?? null,
    selectedEvidenceId: target.selectedEvidenceId ?? null,
    selectedAutomationId: target.selectedAutomationId ?? null,
  });
  return url.toString();
}

export function invocationDeepLink(invocationId: string, href?: string): string {
  return webDeepLink({
    section: "invocations",
    selectedInvocationId: invocationId,
  }, href);
}

export function applicationRunDeepLink(selection: ApplicationRunSelection, href?: string): string {
  return webDeepLink({
    section: "applications",
    selectedApplicationId: selection.applicationId,
    selectedApplicationRun: selection,
  }, href);
}

export function evidenceDeepLink(evidenceId: string, href?: string): string {
  return webDeepLink({
    section: "audit",
    selectedEvidenceId: evidenceId,
  }, href);
}

export function webNavigationLinkDeepLink(link: RelativeWebNavigationLink, href = currentHref()): string {
  const url = new URL(href);
  const current = new URLSearchParams(url.search);
  for (const key of NAVIGATION_QUERY_KEYS) current.delete(key);

  const navigation = new URLSearchParams(link.query);
  for (const key of NAVIGATION_QUERY_KEYS) {
    const value = navigation.get(key)?.trim();
    if (value) current.set(key, value);
  }

  const next = current.toString();
  url.search = next ? `?${next}` : "";
  return url.toString();
}

export function webNavigationStateFromLink(link: RelativeWebNavigationLink): UrlNavigationState {
  const target = link.target ?? {};
  const section = stringValue(target.section);
  const invocationId = stringValue(target.invocation);
  const applicationId = stringValue(target.application);
  const routineId = stringValue(target.routine);
  const runInvocationId = stringValue(target.run);
  const evidenceId = stringValue(target.evidence);
  const navigation: UrlNavigationState = {};

  if (section && SECTION_KEYS.includes(section as SectionKey)) {
    navigation.section = section as SectionKey;
  }
  if (invocationId) {
    navigation.selectedInvocationId = invocationId;
  }
  if (applicationId) {
    navigation.selectedApplicationId = applicationId;
  }
  navigation.selectedApplicationRun = applicationId && routineId && runInvocationId
    ? { applicationId, routineId, invocationId: runInvocationId }
    : null;
  if (evidenceId) {
    navigation.selectedEvidenceId = evidenceId;
  }
  return navigation;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
