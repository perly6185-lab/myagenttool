import assert from "node:assert/strict";
import { test } from "node:test";

import { createCodexReviewImportService } from "../src/services/codex-review-imports.mjs";
import { createClaudeReviewImportService } from "../src/services/claude-review-imports.mjs";
import { createCcusageImportService } from "../src/services/ccusage-imports.mjs";
import { isGovernedCodexReviewAgent } from "../src/services/codex-agent.mjs";
import { isGovernedClaudeReviewAgent } from "../src/services/claude-agent.mjs";

const now = () => "2026-07-02T00:00:00.000Z";

// A governed review agent as it appears in state (adapter + toolContract +
// code_review capability + the fixed wrapper argv). Wrapper path is absolute,
// as the real registration resolves it.
function governedReviewAgent({ id, tool, wrapper, args }) {
  return {
    id,
    name: `${id} agent`,
    adapter: {
      type: "cli",
      command: "node",
      args: args ?? [`/opt/myagenttool/tools/agents/${wrapper}`, "--mode", "diff-review"],
      outputFormat: "plain_result",
    },
    toolContract: { name: tool },
    capabilities: [{ name: "code_review" }],
  };
}

function governedCcusageAgent() {
  return {
    id: "agt_ccusage_daily",
    name: "ccusage Daily Report",
    adapter: {
      type: "cli",
      command: "node",
      args: ["/opt/myagenttool/tools/agents/ccusage-wrapper.mjs", "--report", "daily"],
      outputFormat: "plain_result",
    },
    toolContract: { name: "ccusage.report" },
    capabilities: [{ name: "usage_cost_report" }],
  };
}

function importState() {
  return { codexReviewFindings: [], claudeReviewFindings: [], importedUsageEstimates: [] };
}

function makeCounter(prefix) {
  let n = 0;
  return () => `${prefix}_${(n += 1)}`;
}

// --- Governed-agent identity (regression for the basename→full-path fix) ---

test("isGovernedCodexReviewAgent rejects a wrapper path outside tools/agents", () => {
  // The pinning fix: a script whose *basename* matches the wrapper but lives
  // at an attacker-controlled path must NOT be treated as governed.
  const evil = governedReviewAgent({
    id: "agt_codex_review_diff",
    tool: "codex.review.diff",
    wrapper: "codex-review-wrapper.mjs",
    args: ["/tmp/evil/codex-review-wrapper.mjs", "--mode", "diff-review"],
  });
  assert.equal(isGovernedCodexReviewAgent(evil), false);
});

test("isGovernedCodexReviewAgent accepts the canonical absolute wrapper path", () => {
  const good = governedReviewAgent({ id: "agt_codex_review_diff", tool: "codex.review.diff", wrapper: "codex-review-wrapper.mjs" });
  assert.equal(isGovernedCodexReviewAgent(good), true);
});

test("isGovernedClaudeReviewAgent rejects a wrapper path outside tools/agents", () => {
  const evil = governedReviewAgent({
    id: "agt_claude_review_diff",
    tool: "claude.review.diff",
    wrapper: "claude-review-wrapper.mjs",
    args: ["/tmp/evil/claude-review-wrapper.mjs", "--mode", "diff-review"],
  });
  assert.equal(isGovernedClaudeReviewAgent(evil), false);
});

test("isGovernedCodexReviewAgent rejects extra wrapper args", () => {
  const extra = governedReviewAgent({
    id: "agt_codex_review_diff",
    tool: "codex.review.diff",
    wrapper: "codex-review-wrapper.mjs",
    args: ["/opt/myagenttool/tools/agents/codex-review-wrapper.mjs", "--mode", "diff-review", "--codex-cli", "evil.mjs"],
  });
  assert.equal(isGovernedCodexReviewAgent(extra), false);
});

// --- Codex review import service ---

test("recordCodexReviewFindings imports and normalizes findings, keeping raw server-side", () => {
  const state = importState();
  const { recordCodexReviewFindings } = createCodexReviewImportService({ state, now, nextId: makeCounter("crf"), appendEvent: () => {} });
  const agent = governedReviewAgent({ id: "agt_codex_review_diff", tool: "codex.review.diff", wrapper: "codex-review-wrapper.mjs" });
  const records = recordCodexReviewFindings({
    invocation: { id: "inv_1", projectId: "projA", worktreeId: "wtA", requestedBy: "usr_a", agentId: "agt_codex_review_diff" },
    result: { output: { source: "codex", tool: "codex.review.diff", mode: "diff-review", severityFloor: "medium", summary: "1 issue", findings: [
      { severity: "high", file: "a.ts", line: 3, message: "bug", suggestion: "fix", confidence: "bogus" },
      { severity: "HIGH", file: "b.ts", message: "case-mismatch enum, still kept but normalized" },
      { severity: "high", file: "", message: "no file" },       // dropped: empty file
      { severity: "high", message: "missing file field" },       // dropped: missing file
      "not-an-object",                                            // dropped: not object
    ] } },
    agent,
  });
  assert.equal(records.length, 2);
  assert.equal(state.codexReviewFindings.length, 2);
  const rec = records[0];
  assert.equal(rec.projectId, "projA");
  assert.equal(rec.severity, "high");        // valid enum kept
  assert.equal(rec.confidence, "medium");    // invalid enum -> fallback medium
  assert.equal(rec.file, "a.ts");
  assert.equal(rec.line, 3);
  assert.ok(rec.raw, "raw payload retained on the server-side record");
  assert.equal(records[1].severity, "medium"); // "HIGH" is not an allowed value -> fallback medium (enum is case-sensitive)
});

test("recordCodexReviewFindings derives projectId from options.metadata when top-level is absent", () => {
  const state = importState();
  const { recordCodexReviewFindings } = createCodexReviewImportService({ state, now, nextId: makeCounter("crf"), appendEvent: () => {} });
  const agent = governedReviewAgent({ id: "agt_codex_review_diff", tool: "codex.review.diff", wrapper: "codex-review-wrapper.mjs" });
  const [rec] = recordCodexReviewFindings({
    invocation: { id: "inv_2", options: { metadata: { projectId: "projMeta", worktreeId: "wtMeta" } } },
    result: { output: { source: "codex", tool: "codex.review.diff", findings: [{ severity: "low", file: "x.ts", message: "m" }] } },
    agent,
  });
  assert.equal(rec.projectId, "projMeta");
  assert.equal(rec.worktreeId, "wtMeta");
});

test("recordCodexReviewFindings ignores a non-governed agent", () => {
  const state = importState();
  const { recordCodexReviewFindings } = createCodexReviewImportService({ state, now, nextId: makeCounter("crf"), appendEvent: () => {} });
  const evil = governedReviewAgent({
    id: "agt_codex_review_diff", tool: "codex.review.diff", wrapper: "codex-review-wrapper.mjs",
    args: ["/tmp/evil/codex-review-wrapper.mjs", "--mode", "diff-review"],
  });
  const records = recordCodexReviewFindings({
    invocation: { id: "inv_3", projectId: "projA" },
    result: { output: { source: "codex", tool: "codex.review.diff", findings: [{ severity: "high", file: "a.ts", message: "m" }] } },
    agent: evil,
  });
  assert.deepEqual(records, []);
  assert.equal(state.codexReviewFindings.length, 0);
});

test("recordCodexReviewFindings ignores an errored or foreign result", () => {
  const state = importState();
  const { recordCodexReviewFindings } = createCodexReviewImportService({ state, now, nextId: makeCounter("crf"), appendEvent: () => {} });
  const agent = governedReviewAgent({ id: "agt_codex_review_diff", tool: "codex.review.diff", wrapper: "codex-review-wrapper.mjs" });
  assert.deepEqual(recordCodexReviewFindings({ invocation: { id: "i" }, result: { output: { source: "codex", tool: "codex.review.diff", error: "boom", findings: [{ severity: "high", file: "a", message: "m" }] } }, agent }), []);
  assert.deepEqual(recordCodexReviewFindings({ invocation: { id: "i" }, result: { output: { source: "claude", tool: "claude.review.diff", findings: [{ severity: "high", file: "a", message: "m" }] } }, agent }), []);
});

test("recordCodexReviewFindings caps findings per review and reports the dropped count", () => {
  const state = importState();
  const events = [];
  const { recordCodexReviewFindings } = createCodexReviewImportService({ state, now, nextId: makeCounter("crf"), appendEvent: (e) => events.push(e) });
  const agent = governedReviewAgent({ id: "agt_codex_review_diff", tool: "codex.review.diff", wrapper: "codex-review-wrapper.mjs" });
  const findings = Array.from({ length: 1005 }, (_, i) => ({ severity: "low", file: `f${i}.ts`, message: `m${i}` }));
  const records = recordCodexReviewFindings({
    invocation: { id: "inv_cap", projectId: "projA" },
    result: { output: { source: "codex", tool: "codex.review.diff", findings } },
    agent,
  });
  assert.equal(records.length, 1000);
  assert.equal(state.codexReviewFindings.length, 1000);
  assert.equal(events.at(-1).data.droppedFindingCount, 5);
});

// --- Claude review import service (parallel behavior) ---

test("recordClaudeReviewFindings imports governed Claude findings", () => {
  const state = importState();
  const { recordClaudeReviewFindings } = createClaudeReviewImportService({ state, now, nextId: makeCounter("clf"), appendEvent: () => {} });
  const agent = governedReviewAgent({ id: "agt_claude_review_diff", tool: "claude.review.diff", wrapper: "claude-review-wrapper.mjs" });
  const records = recordClaudeReviewFindings({
    invocation: { id: "inv_c", projectId: "projB" },
    result: { output: { source: "claude", tool: "claude.review.diff", findings: [{ severity: "medium", file: "b.ts", line: 9, message: "issue" }] } },
    agent,
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].source, "claude");
  assert.equal(records[0].projectId, "projB");
});

test("recordClaudeReviewFindings ignores a Codex result", () => {
  const state = importState();
  const { recordClaudeReviewFindings } = createClaudeReviewImportService({ state, now, nextId: makeCounter("clf"), appendEvent: () => {} });
  const agent = governedReviewAgent({ id: "agt_claude_review_diff", tool: "claude.review.diff", wrapper: "claude-review-wrapper.mjs" });
  assert.deepEqual(recordClaudeReviewFindings({ invocation: { id: "i" }, result: { output: { source: "codex", tool: "codex.review.diff", findings: [{ severity: "high", file: "a", message: "m" }] } }, agent }), []);
});

// --- ccusage import service (regression for the options.metadata projectId fix) ---

test("recordCcusageImportedEstimates derives projectId from options.metadata, not input.metadata", () => {
  const state = importState();
  const { recordCcusageImportedEstimates } = createCcusageImportService({ state, now, nextId: makeCounter("ccu"), appendEvent: () => {} });
  const records = recordCcusageImportedEstimates({
    invocation: {
      id: "inv_ccu",
      // input.metadata must be ignored; only options.metadata is authoritative.
      input: { metadata: { projectId: "projWrong", worktreeId: "wtWrong" } },
      options: { metadata: { projectId: "projRight", worktreeId: "wtRight" } },
    },
    result: { output: { source: "ccusage", reportId: "daily", report: [{ provider: "codex", model: "gpt", totalCostUsd: 1.5, inputTokens: 10, outputTokens: 20 }] } },
    agent: governedCcusageAgent(),
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].projectId, "projRight");
  assert.equal(records[0].worktreeId, "wtRight");
});

test("recordCcusageImportedEstimates ignores an errored or non-ccusage result", () => {
  const state = importState();
  const { recordCcusageImportedEstimates } = createCcusageImportService({ state, now, nextId: makeCounter("ccu"), appendEvent: () => {} });
  assert.deepEqual(recordCcusageImportedEstimates({ invocation: { id: "i", options: {} }, result: { output: { source: "ccusage", error: "boom", report: [{ provider: "x" }] } }, agent: governedCcusageAgent() }), []);
  assert.deepEqual(recordCcusageImportedEstimates({ invocation: { id: "i", options: {} }, result: { output: { source: "other", report: [{ provider: "x" }] } }, agent: governedCcusageAgent() }), []);
});

test("recordCcusageImportedEstimates caps imported estimate rows", () => {
  const state = importState();
  const { recordCcusageImportedEstimates } = createCcusageImportService({ state, now, nextId: makeCounter("ccu"), appendEvent: () => {} });
  const report = Array.from({ length: 1002 }, (_, i) => ({ provider: `p${i}`, totalCostUsd: i }));
  recordCcusageImportedEstimates({
    invocation: { id: "inv_big", options: { metadata: { projectId: "projA" } } },
    result: { output: { source: "ccusage", reportId: "daily", report } },
    agent: governedCcusageAgent(),
  });
  assert.equal(state.importedUsageEstimates.length, 1000);
});
