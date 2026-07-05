import { searchFromNavigationState, type ApplicationRunSelection, type SectionKey } from "@/store/ui-store";

const NAVIGATION_QUERY_KEYS = ["section", "invocation", "application", "routine", "run"] as const;

interface WebNavigationTarget {
  section: SectionKey;
  selectedInvocationId?: string | null;
  selectedApplicationId?: string | null;
  selectedApplicationRun?: ApplicationRunSelection | null;
}

interface RelativeWebNavigationLink {
  query: string;
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
