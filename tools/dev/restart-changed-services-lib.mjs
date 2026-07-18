export function servicesForFiles(files) {
  const services = new Set();
  for (const file of files) {
    const normalized = file.replaceAll("\\", "/");
    if (normalized === "package.json" || normalized === "pnpm-lock.yaml" || normalized === "pnpm-workspace.yaml") {
      add(services, "server", "desktop", "web");
    } else if (normalized.startsWith("packages/protocol/") || normalized.startsWith("packages/shared/")) {
      add(services, "server", "desktop", "web");
    } else if (normalized.startsWith("packages/adapters/")) {
      add(services, "server", "desktop");
    } else if (normalized.startsWith("apps/server/")) {
      services.add("server");
    } else if (normalized.startsWith("apps/desktop/")) {
      services.add("desktop");
    } else if (normalized.startsWith("apps/web/")) {
      services.add("web");
    } else if (normalized === "tools/dev/run-local-demo.mjs") {
      add(services, "server", "desktop", "web");
    }
  }
  return [...services];
}

function add(target, ...services) {
  for (const service of services) {
    target.add(service);
  }
}
