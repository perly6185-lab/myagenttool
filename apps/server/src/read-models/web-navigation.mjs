const NAVIGATION_KEYS = ["section", "invocation", "application", "routine", "run"];

function queryFromNavigation(target) {
  const params = new URLSearchParams();
  for (const key of NAVIGATION_KEYS) {
    const value = target?.[key];
    if (typeof value === "string" && value.trim()) {
      params.set(key, value.trim());
    }
  }
  const query = params.toString();
  return query ? `?${query}` : null;
}

function link(label, target) {
  const query = queryFromNavigation(target);
  return query ? { label, query, target } : null;
}

export function invocationWebLink(invocationId, label = "Open invocation") {
  if (typeof invocationId !== "string" || !invocationId.trim()) return null;
  return link(label, {
    section: "invocations",
    invocation: invocationId,
  });
}

export function applicationRunWebLink(input = {}, label = "Open application run") {
  const { applicationId, routineId, invocationId } = input ?? {};
  if (
    typeof applicationId !== "string" || !applicationId.trim()
    || typeof routineId !== "string" || !routineId.trim()
    || typeof invocationId !== "string" || !invocationId.trim()
  ) {
    return null;
  }
  return link(label, {
    section: "applications",
    application: applicationId,
    routine: routineId,
    run: invocationId,
  });
}

export function applicationRunWebLinkFromInvocation(invocation, label = "Open application run") {
  const metadata = invocation?.options?.metadata ?? {};
  return applicationRunWebLink({
    applicationId: metadata.applicationId,
    routineId: metadata.routineId,
    invocationId: invocation?.id,
  }, label);
}
