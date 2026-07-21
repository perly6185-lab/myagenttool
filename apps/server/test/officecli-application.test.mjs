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

test("a media-source prop (src/path/preview) that escapes the worktree is DROPPED; text props are untouched", () => {
  const app = register();
  // src is a file officecli opens — a traversal/absolute/URL source is dropped.
  for (const src of ["../../../etc/passwd.png", "/etc/x.png", "~/x.png", "https://attacker/x.png", "file:///etc/x", "a/../../b.png"]) {
    const plan = applicationWrapperExecutionPlan(app, "add", { file: "b.xlsx", parent: "/Sheet1", type: "picture", props: { src } });
    assert.ok(!plan.args.some((a) => a.startsWith("src=")), `unsafe src "${src}" must be dropped`);
  }
  // a worktree-relative source and a data: URI are kept.
  assert.ok(applicationWrapperExecutionPlan(app, "add", { file: "b.xlsx", parent: "/Sheet1", type: "picture", props: { src: "assets/logo.png" } }).args.includes("src=assets/logo.png"));
  assert.ok(applicationWrapperExecutionPlan(app, "set", { file: "b.xlsx", path: "/p", props: { src: "data:image/png;base64,AAA" } }).args.some((a) => a.startsWith("src=data:")));
  // path (src alias) and preview are guarded too.
  assert.ok(!applicationWrapperExecutionPlan(app, "add", { file: "b.xlsx", parent: "/Sheet1", type: "ole", props: { path: "../secret" } }).args.some((a) => a.startsWith("path=")));
  // CONTENT keys (value/formula/text) are literal — a path-looking value is kept.
  assert.ok(applicationWrapperExecutionPlan(app, "set", { file: "b.xlsx", path: "/Sheet1/A1", props: { value: "../this/is/text" } }).args.includes("value=../this/is/text"));
  assert.ok(applicationWrapperExecutionPlan(app, "set", { file: "b.xlsx", path: "/p", props: { text: "/etc/passwd" } }).args.includes("text=/etc/passwd"));
});

test("the full file-source key set is guarded — data (table) and image (cell/shape), not just src/path/preview", () => {
  const app = register();
  // data=<escaping> reads a host file into a table — must be dropped (the gap that
  // let host-file exfiltration through before).
  assert.ok(!applicationWrapperExecutionPlan(app, "add", { file: "b.docx", parent: "/body", type: "table", props: { data: "/etc/passwd" } }).args.some((a) => a.startsWith("data=")));
  assert.ok(!applicationWrapperExecutionPlan(app, "add", { file: "b.docx", parent: "/body", type: "table", props: { data: "../secret.csv" } }).args.some((a) => a.startsWith("data=")));
  assert.ok(!applicationWrapperExecutionPlan(app, "set", { file: "b.xlsx", path: "/Sheet1/A1", props: { image: "../out.png" } }).args.some((a) => a.startsWith("image=")));
  // a worktree-relative data/image source is still allowed.
  assert.ok(applicationWrapperExecutionPlan(app, "add", { file: "b.docx", parent: "/body", type: "table", props: { data: "rows.csv" } }).args.includes("data=rows.csv"));
});

test("image aliases (imagefill/img) are guarded; hyperlink target keys (link/href/...) are exempt", () => {
  const app = register();
  const kept = (props) => {
    const pl = applicationWrapperExecutionPlan(app, "add", { file: "b.docx", parent: "/body", type: "picture", props });
    return pl.args.some((a) => a.startsWith(`${Object.keys(props)[0]}=`));
  };
  // image aliases resolve a file source too — escaping/scheme values dropped.
  assert.equal(kept({ imagefill: "http://attacker/x.png" }), false);
  assert.equal(kept({ imagefill: "../out.png" }), false);
  assert.equal(kept({ img: "/etc/passwd" }), false);
  assert.equal(kept({ imagefill: "assets/logo.png" }), true); // worktree-relative ok
  // hyperlink/reference TARGETS are stored URIs, never a local file read — a
  // path/drive/URL target is legitimate and must NOT be dropped by the backstop.
  for (const link of ["/team/report", "../shared/report.docx", "C:\\Reports\\q3.xlsx", "https://example.com/a/../b"]) {
    assert.equal(kept({ link }), true, `hyperlink target ${link} must be kept`);
  }
});

test("the officecli `image:<path>` fill form is validated (slide background reads a file)", () => {
  const app = register();
  const kept = (props) => applicationWrapperExecutionPlan(app, "set", { file: "deck.pptx", path: "/slide[1]", props }).args.some((a) => a.startsWith(`${Object.keys(props)[0]}=`));
  // `background=image:<abs|../>` embeds a host image — the `image:` prefix hid the
  // path from the escaping-path check; it must now be refused.
  assert.equal(kept({ background: "image:/etc/passwd" }), false);
  assert.equal(kept({ background: "image:../secret.png" }), false);
  assert.equal(kept({ background: "image:http://attacker/x.png" }), false);
  // a worktree-relative image fill and a plain colour stay allowed.
  assert.equal(kept({ background: "image:assets/bg.png" }), true);
  assert.equal(kept({ background: "#FF0000" }), true);
  // poster/fallback are file-source keys now — escaping/URL refused, relative kept.
  assert.equal(kept({ poster: "http://attacker/x.png" }), false);
  assert.equal(kept({ fallback: "../x.png" }), false);
  assert.equal(kept({ poster: "thumb.png" }), true);
});

test("fail-closed backstop: an UNKNOWN prop key carrying an escaping local path is dropped; formatting values pass", () => {
  const app = register();
  // A future/unknown officecli file-source key can't exfiltrate — a `..`/absolute
  // value on any non-content key is refused.
  assert.ok(!applicationWrapperExecutionPlan(app, "add", { file: "b.docx", parent: "/body", type: "shape", props: { future: "/etc/passwd" } }).args.some((a) => a.startsWith("future=")));
  assert.ok(!applicationWrapperExecutionPlan(app, "add", { file: "b.docx", parent: "/body", type: "shape", props: { blip: "../x" } }).args.some((a) => a.startsWith("blip=")));
  // ordinary formatting values are not escaping paths — kept.
  const plan = applicationWrapperExecutionPlan(app, "set", { file: "b.docx", path: "/body/p[1]", props: { style: "Heading1", bold: "true", width: "6in", color: "#FF0000" } });
  for (const kv of ["style=Heading1", "bold=true", "width=6in", "color=#FF0000"]) assert.ok(plan.args.includes(kv), `formatting ${kv} must be kept`);
});

test("`batch` drops the WHOLE list if an item's media-source prop escapes the worktree", () => {
  const app = register();
  const plan = applicationWrapperExecutionPlan(app, "batch", {
    file: "b.xlsx",
    commands: [
      { command: "set", path: "/Sheet1/A1", props: { value: "ok" } },
      { command: "add", parent: "/Sheet1", type: "picture", props: { src: "../../etc/passwd.png" } },
    ],
  });
  assert.deepEqual(plan.args, ["batch", "b.xlsx"]);
});

test("a write command is forced to require approval at registration even if the descriptor says false", () => {
  const svc = service();
  const app = svc.registerApplication({
    id: "app_x", name: "x",
    source: { type: "binary", binary: "officecli", wrapper: { mode: "installed-wrapper", commands: [
      { id: "sneaky", commandType: "bin", command: "officecli", args: ["set"], status: "approved", segment: "apply", filePolicy: "workspace_write", requiresApproval: false },
    ] } },
  });
  const cmd = app.source.wrapper.commands.find((c) => c.id === "sneaky");
  assert.equal(cmd.requiresApproval, true, "an apply/workspace_write command must require approval regardless of the descriptor");
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
