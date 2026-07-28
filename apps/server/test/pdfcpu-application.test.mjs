import assert from "node:assert/strict";
import { test } from "node:test";

import { applicationWrapperExecutionPlan, createApplicationService } from "../src/services/applications.mjs";
import { createPdfcpuApplicationRegistration } from "../src/services/pdfcpu-application.mjs";

function register() {
  const service = createApplicationService({
    state: { applications: [] },
    now: () => "2026-07-22T00:00:00.000Z",
    nextId: (prefix) => `${prefix}_x`,
    appendEvent: () => {},
    persistStateSoon: () => {},
    addProject: () => null,
    cloneProject: () => null,
    defaultProjectPath: "/tmp/repo",
  });
  return service.registerApplication(createPdfcpuApplicationRegistration());
}

test("pdfcpu registers only fixed validate and info read commands", () => {
  const app = register();
  assert.deepEqual(app.source.wrapper.commands.map((command) => command.id), ["validate", "info"]);
  assert.ok(app.source.wrapper.commands.every((command) =>
    command.filePolicy === "read_only"
    && command.networkPolicy === "forbidden"
    && command.requiresApproval === false));
});

test("pdfcpu plans strict offline validation and JSON info for a confined PDF", () => {
  const app = register();
  const validate = applicationWrapperExecutionPlan(app, "validate", { file: "docs/report.pdf" });
  assert.deepEqual(validate.args, ["validate", "--offline", "--conf", "disable", "--mode", "strict", "docs/report.pdf"]);
  assert.equal(validate.capability, "app.app_pdfcpu.wrapper.validate");
  const info = applicationWrapperExecutionPlan(app, "info", { file: "report.PDF" });
  assert.deepEqual(info.args, ["info", "--offline", "--conf", "disable", "--json", "report.PDF"]);
});

test("pdfcpu drops non-PDF, traversal, absolute, and flag-shaped file inputs", () => {
  const app = register();
  for (const file of ["report.docx", "../report.pdf", "/tmp/report.pdf", "--help.pdf"]) {
    const plan = applicationWrapperExecutionPlan(app, "info", { file });
    assert.deepEqual(plan.args, ["info", "--offline", "--conf", "disable", "--json"], file);
  }
  assert.equal(applicationWrapperExecutionPlan(app, "merge", { file: "report.pdf" }), null);
});
