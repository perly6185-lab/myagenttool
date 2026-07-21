import assert from "node:assert/strict";
import test from "node:test";
import { createApplicationService, projectApplicationCapabilities } from "../src/services/applications.mjs";
import { createMarkdownApplicationRegistration } from "../src/services/markdown-application.mjs";

function service() {
  return createApplicationService({
    state: { applications: [] },
    now: () => "2026-07-19T00:00:00.000Z",
    nextId: (prefix) => `${prefix}_x`,
    appendEvent: () => {},
    persistStateSoon: () => {},
    addProject: () => null,
    cloneProject: () => null,
    defaultProjectPath: process.cwd(),
  });
}

test("Markdown registers as a local built-in Application", () => {
  const application = service().registerApplication(createMarkdownApplicationRegistration());
  assert.equal(application.id, "app_markdown");
  assert.equal(application.executionScope, "local");
  assert.deepEqual(application.runtimeRequirements, []);
  assert.ok(projectApplicationCapabilities(application).some((capability) => capability.name === "app.app_markdown.preview"));
});

test("Markdown preview is bounded and returns local structured output", () => {
  const applications = service();
  applications.registerApplication(createMarkdownApplicationRegistration());
  const result = applications.invokeApplicationCapability("app.app_markdown.preview", { markdown: "# Title\n\nBody" });
  assert.equal(result.ok, true);
  assert.equal(result.result.output.markdown, "# Title\n\nBody");
  assert.deepEqual(result.result.output.statistics, { characters: 13, lines: 3, headings: 1 });
});
