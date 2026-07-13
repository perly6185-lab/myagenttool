/*
 * #801 (epic #772): the Result leg of the Application loop.
 *
 * Two things are under test, and the second matters more than the first:
 *   1. The git parsers turn porcelain/--format output into typed records.
 *   2. The importer is driven by the wrapper command's DECLARED `resultImport`,
 *      not by another per-application `if` in the completion runtime — and it
 *      never turns a successful git run into a failed invocation.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createApplicationResultImportService } from "../src/services/application-results.mjs";
import { gitCommandIdOf, parseGitApplicationResult } from "../src/services/git-result.mjs";

const UNIT = "\u001F";
const RECORD = "\u001E";

// --- the parsers --------------------------------------------------------------

test("status: porcelain v2 yields branch, ahead/behind, changed, and untracked", () => {
  const text = [
    "# branch.oid 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
    "# branch.head feat/result-import",
    "# branch.upstream origin/feat/result-import",
    "# branch.ab +2 -3",
    "1 .M N... 100644 100644 100644 abc1234 def5678 apps/server/src/services/git-result.mjs",
    "1 M. N... 100644 100644 100644 abc1234 def5678 docs/a file with spaces.md",
    "? doocs-md/",
  ].join("\n");
  const parsed = parseGitApplicationResult({ commandId: "status", text });
  assert.equal(parsed.branch.name, "feat/result-import");
  assert.equal(parsed.branch.upstream, "origin/feat/result-import");
  assert.equal(parsed.branch.ahead, 2);
  assert.equal(parsed.branch.behind, 3);
  assert.equal(parsed.counts.changed, 2);
  // The path is the LAST field precisely so spaces need no quoting — prove it.
  assert.equal(parsed.changed[1].path, "docs/a file with spaces.md");
  assert.deepEqual(parsed.untracked, [{ path: "doocs-md/" }]);
  assert.equal(parsed.clean, false);
});

test("status: a clean tree is reported clean, not empty", () => {
  const text = "# branch.oid abc1234\n# branch.head main\n";
  const parsed = parseGitApplicationResult({ commandId: "status", text });
  assert.equal(parsed.clean, true);
  assert.equal(parsed.branch.name, "main");
});

test("status: a detached HEAD is null rather than the literal '(detached)'", () => {
  const text = "# branch.oid abc1234\n# branch.head (detached)\n1 .M N... 100644 100644 100644 a b x.ts";
  const parsed = parseGitApplicationResult({ commandId: "status", text });
  assert.equal(parsed.branch.name, null);
});

test("status: a rename carries both paths", () => {
  const text = "# branch.head main\n2 R. N... 100644 100644 100644 abc def R100 new/path.ts\told/path.ts";
  const parsed = parseGitApplicationResult({ commandId: "status", text });
  assert.equal(parsed.changed[0].path, "new/path.ts");
  assert.equal(parsed.changed[0].originalPath, "old/path.ts");
  assert.equal(parsed.changed[0].renamed, true);
});

test("log: separator-delimited records become commits, and a subject with a space survives", () => {
  const text = [
    ["abc1234def5678", "Peng Shiyu", "2026-07-13T10:00:00+08:00", "feat(git): parse the result"].join(UNIT),
    ["9f8e7d6c5b4a30", "Someone Else", "2026-07-12T09:00:00+08:00", "fix: a subject, with punctuation"].join(UNIT),
  ].join(RECORD) + RECORD;
  const parsed = parseGitApplicationResult({ commandId: "log", text });
  assert.equal(parsed.count, 2);
  assert.equal(parsed.commits[0].hash, "abc1234def5678");
  assert.equal(parsed.commits[0].author, "Peng Shiyu");
  assert.equal(parsed.commits[0].subject, "feat(git): parse the result");
  // %aI is kept verbatim — re-parsing into a Date would silently shift the offset.
  assert.equal(parsed.commits[1].date, "2026-07-12T09:00:00+08:00");
});

test("branch_list / head parse their formats", () => {
  const branches = parseGitApplicationResult({
    commandId: "branch_list",
    text: `main${UNIT}abc1234\nfeat/x${UNIT}def5678\n`,
  });
  assert.deepEqual(branches.branches[1], { name: "feat/x", objectName: "def5678" });
  const head = parseGitApplicationResult({ commandId: "head", text: "1a2b3c4d5e6f7a8b9c0d\n" });
  assert.equal(head.hash, "1a2b3c4d5e6f7a8b9c0d");
});

test("diff_stat: files and the summary line", () => {
  const text = [
    " apps/server/src/services/git-result.mjs | 42 ++++++++++++++++",
    " apps/web/public/logo.png                | Bin 0 -> 1024 bytes",
    " 2 files changed, 42 insertions(+), 4 deletions(-)",
  ].join("\n");
  const parsed = parseGitApplicationResult({ commandId: "diff_stat", text });
  assert.equal(parsed.files[0].changes, 42);
  assert.equal(parsed.files[1].binary, true);
  assert.deepEqual(parsed.summary, { filesChanged: 2, insertions: 42, deletions: 4 });
});

test("show: commit header plus stat", () => {
  const text = [
    "commit 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
    "Author: Peng Shiyu <perly6185@gmail.com>",
    "Date:   Mon Jul 13 10:00:00 2026 +0800",
    "",
    "    feat(git): the subject",
    "",
    " a.ts | 2 +-",
    " 1 file changed, 1 insertion(+), 1 deletion(-)",
  ].join("\n");
  const parsed = parseGitApplicationResult({ commandId: "show", text });
  assert.equal(parsed.commit.hash, "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b");
  assert.equal(parsed.summary.filesChanged, 1);
});

test("a parser never throws: garbage, empty, and unknown commands return null", () => {
  assert.equal(parseGitApplicationResult({ commandId: "status", text: "" }), null);
  assert.equal(parseGitApplicationResult({ commandId: "log", text: "not a log at all" }), null);
  assert.equal(parseGitApplicationResult({ commandId: "head", text: "zzzz" }), null);
  assert.equal(parseGitApplicationResult({ commandId: "nope", text: "x" }), null);
  assert.equal(parseGitApplicationResult({ commandId: "status", text: null }), null);
});

test("the registered argv uses the escape each git command actually honors", async () => {
  // git has TWO spellings for a hex byte and silently emits an unrecognized escape
  // VERBATIM instead of failing. `branch --format` (ref-filter) wants %1f; `log
  // --format` wants %x1f. Shipping %x1f to branch_list produced "name%x1f<hash>"
  // — output no parser could read, and no test caught it, because the fixtures were
  // hand-written from the same misunderstanding as the argv.
  //
  // Pin both spellings here. "Unifying" them is the exact regression to prevent.
  const { createGitApplicationRegistration } = await import("../src/services/git-application.mjs");
  const commands = createGitApplicationRegistration().source.wrapper.commands;
  const argvOf = (id) => commands.find((command) => command.id === id).args.join(" ");

  assert.match(argvOf("branch_list"), /--format=%\(refname:short\)%1f%\(objectname\)/u);
  assert.doesNotMatch(argvOf("branch_list"), /%x1f/u, "ref-filter does not honor %x1f");
  assert.match(argvOf("log"), /--format=%H%x1f/u, "log --format does not honor %1f");
});

test("gitCommandIdOf reads the command out of the capability name", () => {
  assert.equal(gitCommandIdOf("app.app_git.wrapper.diff_stat"), "diff_stat");
  assert.equal(gitCommandIdOf("app.app_ccusage.wrapper.daily"), null);
  assert.equal(gitCommandIdOf(undefined), null);
});

// --- the importer -------------------------------------------------------------

function makeImporter() {
  const state = { applicationResults: [] };
  const events = [];
  let counter = 0;
  const service = createApplicationResultImportService({
    state,
    now: () => "2026-07-13T00:00:00.000Z",
    nextId: (prefix) => `${prefix}_${++counter}`,
    appendEvent: (event) => events.push(event),
    persistStateSoon: () => {},
  });
  return { state, events, service };
}

function gitInvocation({ capability = "app.app_git.wrapper.status", resultImport = { source: "git", kind: "repo_state" } } = {}) {
  return {
    id: "inv_1",
    projectId: "prj_1",
    worktreeId: null,
    requestedBy: "usr_local",
    options: {
      metadata: {
        providerType: "application",
        applicationId: "app_git",
        capability,
        applicationWrapper: { capability, resultImport, outputCollection: "applicationResults" },
      },
    },
  };
}

const statusResult = (text) => ({ output: { source: "application", capability: "app.app_git.wrapper.status", report: { text } } });

test("importer: a git result becomes a typed record in applicationResults", () => {
  const { state, events, service } = makeImporter();
  const records = service.recordApplicationResult({
    invocation: gitInvocation(),
    result: statusResult("# branch.head main\n? new.ts"),
  });
  assert.equal(records.length, 1);
  const [record] = records;
  assert.equal(record.source, "git");
  assert.equal(record.kind, "repo_state");
  assert.equal(record.status, "parsed");
  assert.equal(record.truncated, false);
  assert.equal(record.data.branch.name, "main");
  assert.equal(record.projectId, "prj_1");
  assert.equal(state.applicationResults[0].id, record.id);
  assert.equal(events[0].type, "application_result_imported");
  assert.equal(events[0].level, "info");
});

test("importer: unparseable output is STORED as unparsed, not dropped and not an error", () => {
  const { state, events, service } = makeImporter();
  const [record] = service.recordApplicationResult({
    invocation: gitInvocation(),
    result: statusResult("some git version we cannot read"),
  });
  assert.equal(record.status, "unparsed");
  assert.equal(record.data, null);
  // The raw text is kept — a worse result, never a lost one.
  assert.equal(record.text, "some git version we cannot read");
  assert.equal(state.applicationResults.length, 1);
  assert.equal(events[0].level, "warn");
});

test("importer: a body at the runner's 20k cap is MARKED truncated, not presented as complete", () => {
  const { service } = makeImporter();
  // Enough commits to overrun the runner's 20 000-char cap, then cut exactly the
  // way the runner cuts — this is the shape a large `log` actually arrives in.
  const commits = Array.from({ length: 800 }, (_, index) =>
    [`${String(index).padStart(7, "0")}abc`, "A", "2026-07-13T10:00:00+08:00", "s"].join(UNIT),
  ).join(RECORD);
  assert.ok(commits.length > 20000, "the fixture must actually exceed the cap");
  const text = commits.slice(0, 20000);
  const [record] = service.recordApplicationResult({
    invocation: gitInvocation({ capability: "app.app_git.wrapper.log" }),
    result: { output: { source: "application", report: { text } } },
  });
  assert.equal(record.truncated, true, "a body at the cap must be assumed truncated");
  assert.equal(record.status, "parsed", "it still parses what it has — it just does not claim to be whole");
});

test("importer: an unknown resultImport source imports nothing and is not an error", () => {
  const { state, service } = makeImporter();
  const records = service.recordApplicationResult({
    invocation: gitInvocation({ resultImport: { source: "svn", kind: "repo_state" } }),
    result: statusResult("# branch.head main"),
  });
  assert.deepEqual(records, []);
  assert.equal(state.applicationResults.length, 0);
});

test("importer: ccusage's declared source is left to its own importer (no double import)", () => {
  const { state, service } = makeImporter();
  const records = service.recordApplicationResult({
    invocation: gitInvocation({ resultImport: { source: "ccusage", kind: "usage_estimates" } }),
    result: { output: { source: "application", report: { daily: [] } } },
  });
  assert.deepEqual(records, [], "ccusage is not in the registry, so this importer must not touch it");
  assert.equal(state.applicationResults.length, 0);
});

test("importer: a command with no resultImport, and a non-application result, are ignored", () => {
  const { service } = makeImporter();
  assert.deepEqual(
    service.recordApplicationResult({ invocation: gitInvocation({ resultImport: null }), result: statusResult("# branch.head main") }),
    [],
  );
  assert.deepEqual(
    service.recordApplicationResult({ invocation: gitInvocation(), result: { output: { source: "agent", report: { text: "x" } } } }),
    [],
  );
});

test("importer: the collection is bounded (newest first)", () => {
  const { state, service } = makeImporter();
  for (let index = 0; index < 505; index += 1) {
    service.recordApplicationResult({ invocation: gitInvocation(), result: statusResult(`# branch.head b${index}`) });
  }
  assert.equal(state.applicationResults.length, 500);
  assert.equal(state.applicationResults[0].data.branch.name, "b504", "newest first");
});
