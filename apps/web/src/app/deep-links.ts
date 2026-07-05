import { searchFromNavigationState, type ApplicationRunSelection, type SectionKey } from "@/store/ui-store";

interface WebNavigationTarget {
  section: SectionKey;
  selectedInvocationId?: string | null;
  selectedApplicationId?: string | null;
  selectedApplicationRun?: ApplicationRunSelection | null;
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
