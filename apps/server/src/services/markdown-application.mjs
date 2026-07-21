export const MARKDOWN_APPLICATION_ID = "app_markdown";

export function createMarkdownApplicationRegistration({ autoOnline = true } = {}) {
  return {
    id: MARKDOWN_APPLICATION_ID,
    name: "Markdown",
    kind: "builtin",
    autoOnline,
    executionScope: "local",
    runtimeRequirements: [],
    source: { type: "builtin", id: "markdown" },
  };
}
