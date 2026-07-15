import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTranscriptCollector, TRANSCRIPT_LIMITS } from "../../../tools/agents/stream-transcript.mjs";

// #1071 (Epic #1070): the claude wrapper parses its stream-json stdout line by
// line and ships a bounded `transcript` on the final RESULT, instead of
// discarding thinking / tool_use / tool_result / assistant text.

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const claudeWrapper = join(repoRoot, "tools/agents/claude-review-wrapper.mjs");
const workdir = realpathSync(mkdtempSync(join(tmpdir(), "transcript-capture-test-")));

// A recorded-shape stream-json session: init, a thinking+tool_use turn, the
// tool result, a final text turn, and the result event carrying the review JSON.
const FIXTURE_EVENTS = [
  { type: "system", subtype: "init", session_id: "s1" },
  {
    type: "assistant",
    message: {
      role: "assistant",
      model: "claude-fable-5",
      content: [
        { type: "thinking", thinking: "Let me check the working tree first." },
        { type: "tool_use", id: "tu_1", name: "Bash", input: { command: "git status --short", description: "check working tree" } },
      ],
    },
  },
  {
    type: "user",
    message: {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "tu_1", content: [{ type: "text", text: "M a.ts" }], is_error: false },
      ],
    },
  },
  { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "**Tree is dirty.**\n\n| f | s |\n|---|---|\n| a.ts | M |" }] } },
  {
    type: "result",
    subtype: "success",
    result: JSON.stringify({ summary: "one issue", findings: [{ severity: "high", file: "a.ts", line: 1, message: "bug", suggestion: "fix", confidence: "high" }] }),
    usage: { input_tokens: 10, output_tokens: 5 },
    total_cost_usd: 0.01,
  },
];

function tickingCollector(limits = TRANSCRIPT_LIMITS) {
  let clock = 0;
  return createTranscriptCollector({ now: () => (clock += 1000), limits });
}

// --- collector unit tests ---

test("collector captures thinking/tool IN-OUT/text in stream order with durations", () => {
  const collector = tickingCollector();
  for (const event of FIXTURE_EVENTS) collector.pushLine(JSON.stringify(event));
  const transcript = collector.finish();
  assert.deepEqual(transcript.blocks.map((b) => b.kind), ["thinking", "tool_use", "tool_result", "text"]);
  const [thinking, toolUse, toolResult, text] = transcript.blocks;
  assert.equal(thinking.durationMs, 1000, "thinking duration comes from inter-event arrival time");
  assert.equal(thinking.text, "Let me check the working tree first.");
  assert.equal(toolUse.toolName, "Bash");
  assert.equal(toolUse.toolUseId, "tu_1");
  assert.equal(toolUse.description, "check working tree");
  assert.match(toolUse.input, /git status --short/);
  assert.equal(toolResult.toolUseId, "tu_1");
  assert.equal(toolResult.isError, false);
  assert.equal(toolResult.output, "M a.ts");
  assert.match(text.text, /\*\*Tree is dirty\.\*\*/);
  assert.equal(transcript.droppedBlocks, 0);
  assert.equal(transcript.unparsedLines, 0);
  assert.equal(transcript.truncated, false);
});

test("collector never throws on malformed or irrelevant lines", () => {
  const collector = tickingCollector();
  collector.pushLine("not json at all");
  collector.pushLine("");
  collector.pushLine("   ");
  collector.pushLine("42"); // valid JSON, not an object
  collector.pushLine(JSON.stringify({ summary: "plain review JSON, no type" }));
  const transcript = collector.finish();
  assert.equal(transcript.blocks.length, 0);
  assert.equal(transcript.unparsedLines, 1, "only the non-JSON line counts as unparsed");
});

test("collector caps an oversized block with explicit truncation metadata", () => {
  const collector = tickingCollector();
  const huge = "x".repeat(TRANSCRIPT_LIMITS.thinkingChars + 1000);
  collector.pushLine(JSON.stringify({ type: "assistant", message: { content: [{ type: "thinking", thinking: huge }] } }));
  const [block] = collector.finish().blocks;
  assert.equal(block.text.length, TRANSCRIPT_LIMITS.thinkingChars);
  assert.equal(block.truncated, true);
  assert.equal(block.droppedChars, 1000);
});

test("collector degrades to skeleton blocks past the total budget — shape survives, no silent loss", () => {
  const collector = tickingCollector({ ...TRANSCRIPT_LIMITS, totalChars: 10 });
  const textEvent = (text) => JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } });
  collector.pushLine(textEvent("0123456789ABC")); // spends the whole 10-char budget
  collector.pushLine(textEvent("dropped payload"));
  const transcript = collector.finish();
  assert.equal(transcript.blocks.length, 2);
  assert.equal(transcript.blocks[0].text, "0123456789");
  assert.equal(transcript.blocks[0].truncated, true);
  assert.equal(transcript.blocks[1].payloadDropped, true, "over-budget block keeps kind/sizes only");
  assert.equal(transcript.blocks[1].chars, "dropped payload".length);
  assert.ok(!("text" in transcript.blocks[1]));
  assert.equal(transcript.droppedBlocks, 1);
  assert.equal(transcript.truncated, true);
});

test("collector stops appending past maxBlocks and counts the drops", () => {
  const collector = tickingCollector({ ...TRANSCRIPT_LIMITS, maxBlocks: 2 });
  for (let i = 0; i < 5; i += 1) {
    collector.pushLine(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: `t${i}` }] } }));
  }
  const transcript = collector.finish();
  assert.equal(transcript.blocks.length, 2);
  assert.equal(transcript.droppedBlocks, 3);
});

test("collector reads string tool_result content and error flags", () => {
  const collector = tickingCollector();
  collector.pushLine(JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "tu_9", content: "boom", is_error: true }] },
  }));
  const [block] = collector.finish().blocks;
  assert.equal(block.output, "boom");
  assert.equal(block.isError, true);
});

// --- wrapper integration: the RESULT contract gains `transcript`, keeps the rest ---

// A fake claude CLI that replays the fixture as NDJSON; the last line is written
// WITHOUT a trailing newline to prove the remainder is flushed on close.
function writeStreamStub() {
  const stub = join(workdir, "fake-claude-stream.mjs");
  const lines = FIXTURE_EVENTS.map((event) => JSON.stringify(event));
  writeFileSync(stub, [
    `const lines = ${JSON.stringify(lines)};`,
    "for (const line of lines.slice(0, -1)) console.log(line);",
    "process.stdout.write(lines.at(-1));",
  ].join("\n"));
  return stub;
}

test("claude wrapper ships the transcript on RESULT and keeps summary/findings/cost identical", () => {
  const res = spawnSync(process.execPath, [
    claudeWrapper, "--mode", "diff-review", "--cwd", workdir, "--claude-cli", writeStreamStub(),
  ], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.equal(res.status, 0, res.stderr || res.stdout);
  const line = res.stdout.split(/\r?\n/).find((l) => l.startsWith("RESULT "));
  assert.ok(line, `expected a RESULT line in:\n${res.stdout}`);
  const payload = JSON.parse(line.slice("RESULT ".length));

  // Existing consumers: identical review + cost extraction.
  assert.equal(payload.output.summary, "one issue");
  assert.equal(payload.output.findings.length, 1);
  assert.equal(payload.output.findings[0].file, "a.ts");
  assert.equal(payload.cost.inputTokens, 10);
  assert.equal(payload.cost.outputTokens, 5);
  assert.equal(payload.cost.amountUsd, 0.01);

  // New: the bounded transcript, in stream order, including the newline-less tail.
  assert.deepEqual(payload.transcript.blocks.map((b) => b.kind), ["thinking", "tool_use", "tool_result", "text"]);
  assert.equal(typeof payload.transcript.blocks[0].durationMs, "number");
  assert.equal(payload.transcript.blocks[1].toolName, "Bash");
  assert.equal(payload.transcript.blocks[1].description, "check working tree");
  assert.equal(payload.transcript.blocks[2].output, "M a.ts");
  assert.match(payload.transcript.blocks[3].text, /\| a\.ts \| M \|/);
  assert.equal(payload.transcript.droppedBlocks, 0);
  assert.equal(payload.transcript.unparsedLines, 0);
});
