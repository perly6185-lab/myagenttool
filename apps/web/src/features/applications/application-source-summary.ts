import type { ApplicationSource } from "@/lib/console-state";

export function sourceSummary(source: ApplicationSource): string {
  switch (source.type) {
    case "git":
      return source.url;
    case "local":
      return source.path;
    case "npm":
      return `${source.package}${source.version ? `@${source.version}` : ""}`;
    case "binary":
      return `${source.binary} (system binary on the device)`;
    case "builtin":
      return "Built into MyAgentTool";
    default:
      return source.uri ?? "manual manifest";
  }
}
