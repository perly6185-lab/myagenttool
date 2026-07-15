// The generic, resultImport-driven Application result importer (#801, epic #772).
//
// Before this, `completion.mjs` imported results through a hardcoded if-chain —
// ccusage, codex review, claude review — and everything else fell through to an
// empty `invocations` attach. A wrapper command could DECLARE
// `resultImport: { source, kind }` and `outputCollection`, and nothing read it.
//
// Here the declaration becomes the dispatch. Adding an Application means adding a
// parser to RESULT_PARSERS — not another branch in the completion runtime.
//
// Two rules the parsers must not break, both enforced here rather than trusted:
//   1. A parse failure NEVER fails the invocation. git ran and exited 0; a format
//      we cannot read is a worse result, not an error. The raw text is kept.
//   2. A truncated body is MARKED. The wrapper runner caps non-JSON stdout at
//      20 000 chars, so a large `log` silently loses its tail — a record that
//      parsed 40 of 50 commits must not present itself as complete.

import { makeRunTx } from "../runtime/store/run-tx.mjs";
import { gitCommandIdOf, parseGitApplicationResult } from "./git-result.mjs";
import { parseMailApplicationResult } from "./mail-result.mjs";

const MAX_APPLICATION_RESULTS = 500;
// The wrapper runner's non-JSON fallback: `{ text: stdout.trim().slice(0, 20000) }`.
// A body at exactly the cap is indistinguishable from one that fit — so treat the
// cap as "assume truncated". Over-flagging costs a caveat; under-flagging presents
// a partial repository state as the whole truth.
const RUNNER_TEXT_CAP = 20000;
const MAX_STORED_TEXT = 20000;

// Importer registry, keyed by the wrapper command's declared `resultImport.source`.
// An unknown source imports nothing and is not an error: the invocation still
// succeeds and its raw result stays on the invocation, exactly as before.
const RESULT_PARSERS = {
  git: ({ capability, text }) => parseGitApplicationResult({ commandId: gitCommandIdOf(capability), text }),
  mail_headers: ({ text }) => parseMailApplicationResult({ text }),
};

export function createApplicationResultImportService({
  state,
  now,
  nextId,
  appendEvent,
  persistStateSoon = () => {},
  store,
}) {
  const runTx = makeRunTx({ store, persistStateSoon });
  function recordApplicationResult({ invocation, result }) {
    const metadata = invocation?.options?.metadata ?? {};
    const wrapper = metadata.applicationWrapper;
    // Both facades import through this one path. A wrapper carries its resultImport
    // under applicationWrapper; an agent_facade carries it at metadata.resultImport
    // (#975). Same declaration, same parsers — no per-mode branch downstream.
    const resultImport = metadata.resultImport ?? wrapper?.resultImport ?? null;
    const source = stringOrNull(resultImport?.source);
    if (!source) return [];
    const parse = RESULT_PARSERS[source];
    if (!parse) return [];

    // Wrapper results arrive in the application envelope ({source:"application",
    // report}); an agent (MCP) result arrives as {toolName, output:"..."} or a
    // bare string. Read the text per shape — never guess one from the other.
    const output = result?.output;
    const text = wrapper
      ? (output && output.source === "application" ? outputText(output.report) : null)
      : agentResultText(output);
    if (text === null) return [];

    const capability = stringOrNull(metadata.capability ?? wrapper?.capability);

    const truncated = text.length >= RUNNER_TEXT_CAP;
    const data = parse({ capability, text });
    const createdAt = now();

    const applicationId = stringOrNull(metadata.applicationId);
    // Owning team, so a repo_state row with no projectId is still tenant-scoped in
    // the read-model (#904) — not made globally visible by projectVisible(null).
    const ownerTeamId = (state.applications ?? []).find((app) => app.id === applicationId)?.ownerTeamId ?? "team_local";

    const record = {
      id: nextId("appres"),
      source,
      kind: stringOrNull(resultImport.kind),
      applicationId,
      capability,
      invocationId: invocation.id,
      projectId: invocation.projectId ?? metadata.projectId ?? null,
      ownerTeamId,
      worktreeId: invocation.worktreeId ?? metadata.worktreeId ?? null,
      requestedBy: invocation.requestedBy ?? null,
      // "parsed" | "unparsed" — an unparsed record is still a record. The operator
      // gets the raw text and an honest label, rather than a silently empty result.
      status: data ? "parsed" : "unparsed",
      truncated,
      data: data ?? null,
      text: text.slice(0, MAX_STORED_TEXT),
      createdAt,
    };

    runTx(() => {
      state.applicationResults = state.applicationResults ?? [];
      state.applicationResults.unshift(record);
      state.applicationResults = state.applicationResults.slice(0, MAX_APPLICATION_RESULTS);
      appendEvent({
        invocationId: invocation.id,
        type: "application_result_imported",
        level: data ? "info" : "warn",
        message: data
          ? `Imported a ${source} ${record.kind ?? "result"} from ${capability ?? "an application capability"}.`
          : `Stored an unparsed ${source} result from ${capability ?? "an application capability"}.`,
        data: {
          applicationResultId: record.id,
          applicationId: record.applicationId,
          capability,
          source,
          kind: record.kind,
          parsed: Boolean(data),
          truncated,
        },
      });
    });
    return [record];
  }

  return { recordApplicationResult };
}

// The runner emits `{ text }` for non-JSON stdout (git has no JSON mode) but
// parses JSON when it can — accept either, so a future JSON-speaking binary
// application needs no change here.
function outputText(report) {
  if (typeof report === "string") return report;
  if (report && typeof report === "object" && typeof report.text === "string") return report.text;
  return null;
}

// An agent (MCP) result: the protocol client returns `{ toolName, output }` where
// output is the tool's text, or occasionally a bare string. Read the text without
// requiring the application envelope a wrapper produces.
function agentResultText(output) {
  if (typeof output === "string") return output;
  if (output && typeof output === "object" && typeof output.output === "string") return output.output;
  return null;
}

function stringOrNull(value) {
  const text = String(value ?? "").trim();
  return text || null;
}
