/*
 * OfficeCLI Application (P1, read-only). The file/path/selector/mode inputs are
 * POSITIONAL argv elements, so their validators are the only thing standing
 * between caller input and the binary. Test the refusals before the happy path.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createApplicationService, applicationWrapperExecutionPlan } from "../src/services/applications.mjs";
import {
  createOfficecliApplicationRegistration,
  OFFICECLI_APPLICATION_ID,
} from "../src/services/officecli-application.mjs";

function service(state = { applications: [] }) {
  return createApplicationService({
    state,
    now: () => "2026-07-20T00:00:00.000Z",
    nextId: (p) => `${p}_x`,
    appendEvent: () => {},
    persistStateSoon: () => {},
    addProject: () => null,
    cloneProject: () => null,
    defaultProjectPath: "/tmp/repo",
  });
}

function register() {
  return service().registerApplication(createOfficecliApplicationRegistration());
}

test("registration projects five read verbs (read-only, no approval) + the write verb", () => {
  const app = register();
  assert.equal(app.id, OFFICECLI_APPLICATION_ID);
  const commands = app.source?.wrapper?.commands ?? [];
  const reads = commands.filter((c) => c.filePolicy === "read_only");
  assert.deepEqual(reads.map((c) => c.id).sort(), ["dump", "get", "query", "validate", "view"]);
  for (const command of reads) {
    assert.equal(command.networkPolicy, "forbidden", `${command.id} must be offline`);
    assert.equal(command.requiresApproval, false, `${command.id} needs no approval`);
    assert.equal(command.cwdPolicy, "invocation_root");
    assert.notEqual(command.segment, "apply", `${command.id} is a read command`);
  }
});

test("the write verb `remove` is workspace_write, approval-required, and lives under the apply segment", () => {
  const app = register();
  const remove = (app.source?.wrapper?.commands ?? []).find((c) => c.id === "remove");
  assert.ok(remove, "remove is registered");
  assert.equal(remove.filePolicy, "workspace_write");
  assert.equal(remove.networkPolicy, "forbidden");
  assert.equal(remove.requiresApproval, true, "a write must carry an approval token");
  assert.equal(remove.segment, "apply", "routes under the officecliApply write policy");
  assert.equal(remove.cwdPolicy, "invocation_root", "a write is confined to the worktree it runs in");
});

test("the write verb's execution plan carries the apply capability + workspace_write policy", () => {
  const app = register();
  const plan = applicationWrapperExecutionPlan(app, "remove", { file: "deck.pptx", path: "/slide[2]/shape[3]" });
  assert.equal(plan.capability, "app.app_officecli.apply.remove", "write commands use the .apply. segment");
  assert.deepEqual(plan.args, ["remove", "deck.pptx", "/slide[2]/shape[3]"]);
  assert.equal(plan.filePolicy, "workspace_write");
  assert.equal(plan.cwdPolicy, "invocation_root");
});

test("`set` emits positionals BEFORE the repeatable --prop pairs (officecli requires that order)", () => {
  const app = register();
  const plan = applicationWrapperExecutionPlan(app, "set", {
    file: "demo.xlsx",
    path: "/Sheet1/A1",
    props: { value: "Hi", bold: "true" },
  });
  assert.equal(plan.capability, "app.app_officecli.apply.set");
  assert.equal(plan.filePolicy, "workspace_write");
  assert.deepEqual(plan.args, ["set", "demo.xlsx", "/Sheet1/A1", "--prop", "value=Hi", "--prop", "bold=true"]);
});

test("`add` emits file+parent positionals, then --type (enum) and --prop pairs", () => {
  const app = register();
  const plan = applicationWrapperExecutionPlan(app, "add", {
    file: "demo.xlsx",
    parent: "/Sheet1",
    type: "cell",
    props: { ref: "F1", value: "ADDED" },
  });
  assert.equal(plan.capability, "app.app_officecli.apply.add");
  assert.equal(plan.filePolicy, "workspace_write");
  assert.deepEqual(plan.args, ["add", "demo.xlsx", "/Sheet1", "--type", "cell", "--prop", "ref=F1", "--prop", "value=ADDED"]);
});

test("`add` drops an out-of-set element type (closed enum)", () => {
  const app = register();
  const plan = applicationWrapperExecutionPlan(app, "add", {
    file: "demo.xlsx",
    parent: "/Sheet1",
    type: "malware",
    props: { ref: "F1" },
  });
  // unknown --type is dropped; the rest still resolves
  assert.deepEqual(plan.args, ["add", "demo.xlsx", "/Sheet1", "--prop", "ref=F1"]);
});

test("`merge` emits template+output positionals + a compacted --data JSON (+ --force)", () => {
  const app = register();
  const plan = applicationWrapperExecutionPlan(app, "merge", {
    template: "tmpl.xlsx", output: "out.xlsx", data: { name: "World", n: 3 }, force: "true",
  });
  assert.equal(plan.capability, "app.app_officecli.apply.merge");
  assert.equal(plan.filePolicy, "workspace_write");
  assert.deepEqual(plan.args.slice(0, 3), ["merge", "tmpl.xlsx", "out.xlsx"]);
  const dataIdx = plan.args.indexOf("--data");
  assert.deepEqual(JSON.parse(plan.args[dataIdx + 1]), { name: "World", n: 3 });
  assert.ok(plan.args.includes("--force"));
});

test("`merge` drops a traversal template/output and a non-object --data", () => {
  const app = register();
  // template/output are office_file → traversal is dropped
  const esc = applicationWrapperExecutionPlan(app, "merge", { template: "../t.xlsx", output: "out.xlsx", data: { a: 1 } });
  assert.equal(esc.args.includes("../t.xlsx"), false);
  // a --data that is not a JSON object/array is dropped
  const badData = applicationWrapperExecutionPlan(app, "merge", { template: "t.xlsx", output: "o.xlsx", data: "not json" });
  assert.equal(badData.args.includes("--data"), false);
});

test("`import` emits three positionals + --header/--format; a traversal source is dropped", () => {
  const app = register();
  const plan = applicationWrapperExecutionPlan(app, "import", {
    file: "book.xlsx", parent: "/Sheet1", source: "data/rows.csv", header: "true", format: "csv",
  });
  assert.equal(plan.capability, "app.app_officecli.apply.import");
  assert.equal(plan.filePolicy, "workspace_write");
  assert.deepEqual(plan.args, ["import", "book.xlsx", "/Sheet1", "data/rows.csv", "--header", "--format", "csv"]);
  // A CSV source that would escape the worktree is dropped (csv_file is worktree-safe).
  const bad = applicationWrapperExecutionPlan(app, "import", { file: "book.xlsx", parent: "/Sheet1", source: "../secret.csv" });
  assert.deepEqual(bad.args, ["import", "book.xlsx", "/Sheet1"]);
  // A non-csv/tsv source is dropped too.
  const notCsv = applicationWrapperExecutionPlan(app, "import", { file: "book.xlsx", parent: "/Sheet1", source: "data.txt" });
  assert.deepEqual(notCsv.args, ["import", "book.xlsx", "/Sheet1"]);
});

test("`swap` emits three positionals (file, path1, path2) under the apply segment", () => {
  const app = register();
  const plan = applicationWrapperExecutionPlan(app, "swap", {
    file: "demo.xlsx",
    path1: "/Sheet1/row[2]",
    path2: "/Sheet1/row[3]",
  });
  assert.equal(plan.capability, "app.app_officecli.apply.swap");
  assert.equal(plan.filePolicy, "workspace_write");
  assert.deepEqual(plan.args, ["swap", "demo.xlsx", "/Sheet1/row[2]", "/Sheet1/row[3]"]);
});

test("`move` emits file+path positionals before the destination flag", () => {
  const app = register();
  const plan = applicationWrapperExecutionPlan(app, "move", {
    file: "deck.pptx",
    path: "/slide[3]",
    after: "/slide[1]",
  });
  assert.equal(plan.capability, "app.app_officecli.apply.move");
  assert.deepEqual(plan.args, ["move", "deck.pptx", "/slide[3]", "--after", "/slide[1]"]);
});

test("`batch` emits the file positional + a compacted, verb-validated --commands JSON", () => {
  const app = register();
  const commands = [
    { command: "set", path: "/Sheet1/A1", props: { value: "B1" } },
    { command: "add", parent: "/Sheet1", type: "cell", props: { ref: "C1", value: "x" } },
    { command: "remove", path: "/Sheet1/A2" },
  ];
  const plan = applicationWrapperExecutionPlan(app, "batch", { file: "demo.xlsx", commands });
  assert.equal(plan.capability, "app.app_officecli.apply.batch");
  assert.equal(plan.filePolicy, "workspace_write");
  assert.deepEqual(plan.args.slice(0, 3), ["batch", "demo.xlsx", "--commands"]);
  assert.deepEqual(JSON.parse(plan.args[3]), commands);
});

test("`batch` drops the WHOLE list if any item uses a non-write verb (all-or-nothing)", () => {
  const app = register();
  const plan = applicationWrapperExecutionPlan(app, "batch", {
    file: "demo.xlsx",
    commands: [
      { command: "set", path: "/A1", props: { value: "x" } },
      { command: "raw-set", part: "/document" }, // low-level verb — not allowed
    ],
  });
  assert.deepEqual(plan.args, ["batch", "demo.xlsx"]);
});

test("`batch` accepts a JSON string; a non-array or oversized payload is dropped", () => {
  const app = register();
  const ok = applicationWrapperExecutionPlan(app, "batch", {
    file: "demo.xlsx",
    commands: '[{"command":"remove","path":"/Sheet1/A1"}]',
  });
  assert.deepEqual(JSON.parse(ok.args[3]), [{ command: "remove", path: "/Sheet1/A1" }]);
  const notArray = applicationWrapperExecutionPlan(app, "batch", { file: "demo.xlsx", commands: '{"command":"set"}' });
  assert.deepEqual(notArray.args, ["batch", "demo.xlsx"]);
  const tooMany = applicationWrapperExecutionPlan(app, "batch", {
    file: "demo.xlsx",
    commands: Array.from({ length: 101 }, () => ({ command: "remove", path: "/A1" })),
  });
  assert.deepEqual(tooMany.args, ["batch", "demo.xlsx"]);
});

test("`set` allows a value containing `=` (formulas) but drops malformed/oversized/injection pairs", () => {
  const app = register();
  const plan = applicationWrapperExecutionPlan(app, "set", {
    file: "demo.xlsx",
    path: "/Sheet1/B5",
    props: {
      formula: "SUM(B2:B4)", // value with parens — fine
      note: "a=b",           // value may itself contain '='
      "-bad": "x",           // key must start with a letter → dropped
      "has space": "y",      // invalid key → dropped
      big: "z".repeat(201),  // oversized value → dropped
      nl: "a\nb",            // control char → dropped
    },
  });
  assert.deepEqual(plan.args, [
    "set", "demo.xlsx", "/Sheet1/B5",
    "--prop", "formula=SUM(B2:B4)",
    "--prop", "note=a=b",
  ]);
});

test("read verbs append their positionals after the fixed base, in declaration order", () => {
  const app = register();
  assert.deepEqual(
    applicationWrapperExecutionPlan(app, "get", { file: "demo.xlsx", path: "/Sheet1/A1" }).args,
    ["get", "--json", "demo.xlsx", "/Sheet1/A1"],
  );
  assert.deepEqual(
    applicationWrapperExecutionPlan(app, "query", { file: "deck.pptx", selector: "shape" }).args,
    ["query", "--json", "deck.pptx", "shape"],
  );
  assert.deepEqual(
    applicationWrapperExecutionPlan(app, "view", { file: "report.docx", mode: "text" }).args,
    ["view", "report.docx", "text"],
  );
  // `html` is an in-set render mode (self-contained preview to stdout).
  assert.deepEqual(
    applicationWrapperExecutionPlan(app, "view", { file: "deck.pptx", mode: "html" }).args,
    ["view", "deck.pptx", "html"],
  );
  assert.deepEqual(
    applicationWrapperExecutionPlan(app, "validate", { file: "demo.xlsx" }).args,
    ["validate", "--json", "demo.xlsx"],
  );
});

test("an out-of-set view mode is DROPPED, never appended", () => {
  const app = register();
  // enum validation drops an unknown mode rather than passing it to the binary.
  assert.deepEqual(
    applicationWrapperExecutionPlan(app, "view", { file: "report.docx", mode: "screenshot" }).args,
    ["view", "report.docx"],
  );
  assert.deepEqual(
    applicationWrapperExecutionPlan(app, "view", { file: "report.docx", mode: "../../etc" }).args,
    ["view", "report.docx"],
  );
});

test("flag-shaped and control-character positionals are DROPPED (refusals before the happy path)", () => {
  const app = register();
  for (const file of ["-x.xlsx", "--help", "a\nb.xlsx", "x".repeat(201) + ".xlsx"]) {
    const plan = applicationWrapperExecutionPlan(app, "get", { file });
    assert.deepEqual(plan.args, ["get", "--json"], `file "${file}" must be dropped`);
  }
});

test("a file positional that would escape the worktree (traversal / absolute) is DROPPED", () => {
  const app = register();
  // officecli resolves the file against its worktree cwd; a `..`/absolute path
  // would escape it (a real write-outside-worktree hole), so office_file drops it.
  for (const file of ["../../etc/passwd.xlsx", "/etc/evil.xlsx", "~/secret.xlsx", "a/../../b.xlsx", "C:\\x.xlsx", "\\\\host\\share\\x.xlsx"]) {
    const plan = applicationWrapperExecutionPlan(app, "get", { file });
    assert.deepEqual(plan.args, ["get", "--json"], `escaping file "${file}" must be dropped`);
  }
  // a safe relative path — including a subdirectory of the worktree — is kept.
  assert.deepEqual(
    applicationWrapperExecutionPlan(app, "get", { file: "reports/q1.xlsx", path: "/Sheet1/A1" }).args,
    ["get", "--json", "reports/q1.xlsx", "/Sheet1/A1"],
  );
});
