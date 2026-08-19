export const APP_PROTOCOL = "myagenttool";

const INTENTS = new Set(["manage", "send", "organize"]);
const SECTIONS = new Set(["mail", "documents", "workflowMemory", "devices", "discovery", "tools", "applications"]);
const ACTIONS = new Set([
  "mail-attachment",
  "compose-attachment",
  "open-local-document",
  "open-system-document",
  "add-real-case",
  "choose-source-folder",
  "open-desktop-page",
]);
const PARAMS = new Set(["message", "attachment", "mode", "folder", "page", "view", "project", "document", "worktree", "source"]);

function safeValue(value, maxLength = 512) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && !/[\u0000-\u001f]/.test(value)
    ? value
    : null;
}

export function desktopRouteFromArgv(argv = []) {
  const raw = argv.find((value) => typeof value === "string" && value.startsWith(`${APP_PROTOCOL}://`));
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.hostname === "mail" && url.pathname === "/connect") {
      const intent = url.searchParams.get("intent");
      return { section: "mail", mailConnect: INTENTS.has(intent) ? intent : "manage" };
    }
    if (url.hostname !== "open" || (url.pathname !== "" && url.pathname !== "/")) return null;
    const section = url.searchParams.get("section");
    const action = url.searchParams.get("desktopAction");
    if (!SECTIONS.has(section) || !ACTIONS.has(action)) return null;
    const route = { section, desktopAction: action };
    for (const key of PARAMS) {
      const value = safeValue(url.searchParams.get(key));
      if (value) route[key] = value;
    }
    return route;
  } catch {
    return null;
  }
}

export function mailConnectorIntentFromArgv(argv = []) {
  return desktopRouteFromArgv(argv)?.mailConnect ?? null;
}

export function rendererUrlForDesktopRoute(baseUrl, route) {
  if (!route || !SECTIONS.has(route.section)) return baseUrl;
  const url = new URL(baseUrl);
  for (const key of ["mailConnect", "desktopAction", ...PARAMS]) url.searchParams.delete(key);
  url.searchParams.set("section", route.section);
  if (route.mailConnect && INTENTS.has(route.mailConnect)) url.searchParams.set("mailConnect", route.mailConnect);
  if (route.desktopAction && ACTIONS.has(route.desktopAction)) url.searchParams.set("desktopAction", route.desktopAction);
  for (const key of PARAMS) {
    const value = safeValue(route[key]);
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

export function rendererUrlForMailConnector(baseUrl, intent) {
  if (!INTENTS.has(intent)) return baseUrl;
  return rendererUrlForDesktopRoute(baseUrl, { section: "mail", mailConnect: intent });
}
