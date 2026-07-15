// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import type { RunTranscriptBlock, RunTranscriptRecord } from "@/lib/api-client";
import { RunTranscriptBlocks, pairTranscriptBlocks, thoughtLabel } from "./run-transcript";

// #1074: the transcript block renderers — Thought-for-Ns, tool rows with
// IN/OUT panels, Markdown text, and honest truncated/reaped states.

afterEach(cleanup);

const BLOCKS: RunTranscriptBlock[] = [
  { kind: "thinking", text: "Check the working tree first.", durationMs: 4200 },
  { kind: "tool_use", toolName: "Bash", toolUseId: "tu_1", description: "check working tree", input: '{"command":"git status --short"}' },
  { kind: "tool_result", toolUseId: "tu_1", output: "M a.ts", isError: false },
  { kind: "text", text: "**Tree is dirty.**\n\n| f | s |\n|---|---|\n| a.ts | M |" },
];

const record = (overrides: Partial<RunTranscriptRecord> = {}): RunTranscriptRecord => ({
  id: "trs_inv_1",
  invocationId: "inv_1",
  blocks: BLOCKS,
  droppedBlocks: 0,
  unparsedLines: 0,
  truncated: false,
  payloadReaped: false,
  createdAt: "2026-07-15T00:00:00.000Z",
  ...overrides,
});

test("pairTranscriptBlocks joins tool_use with its tool_result by toolUseId", () => {
  const steps = pairTranscriptBlocks(BLOCKS);
  expect(steps.map((s) => s.block.kind)).toEqual(["thinking", "tool_use", "text"]);
  expect(steps[1].result?.output).toBe("M a.ts");
});

test("thoughtLabel rounds to seconds and floors at <1s", () => {
  expect(thoughtLabel(4200)).toBe("Thought for 4s");
  expect(thoughtLabel(300)).toBe("Thought for <1s");
  expect(thoughtLabel(undefined)).toBe("Thought");
});

test("renders thinking duration, tool row with IN/OUT, and Markdown text", () => {
  render(<RunTranscriptBlocks transcript={record()} />);
  expect(screen.getByText("Thought for 4s")).toBeTruthy();
  expect(screen.getByText("Bash")).toBeTruthy();
  expect(screen.getByText("check working tree")).toBeTruthy();
  // Markdown rendered, not raw asterisks/pipes.
  expect(screen.getByText("Tree is dirty.").tagName).toBe("STRONG");
  expect(screen.getByRole("table")).toBeTruthy();
  // IN / OUT are collapsed by default; expanding reveals the payloads.
  expect(screen.queryByText(/git status --short/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /IN/ }));
  expect(screen.getByText(/git status --short/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /OUT/ }));
  expect(screen.getByText("M a.ts")).toBeTruthy();
});

test("a failed tool result carries an error badge and a truncated payload says how much was cut", () => {
  const transcript = record({
    blocks: [
      { kind: "tool_use", toolName: "Bash", toolUseId: "tu_9", input: "boom" },
      { kind: "tool_result", toolUseId: "tu_9", output: "exit 1", isError: true, truncated: true, droppedChars: 2048 },
    ],
    truncated: true,
  });
  render(<RunTranscriptBlocks transcript={transcript} />);
  expect(screen.getByText("error")).toBeTruthy();
  expect(screen.getByText(/truncated — 2\.0 KB dropped/)).toBeTruthy();
});

test("a reaped transcript shows the retention banner and skeleton sizes, no payloads", () => {
  const transcript = record({
    payloadReaped: true,
    reapedAt: "2026-08-15T00:00:00.000Z",
    blocks: [
      { kind: "thinking", durationMs: 4200, payloadDropped: true, chars: 29 },
      { kind: "tool_use", toolName: "Bash", toolUseId: "tu_1", payloadDropped: true, chars: 32 },
      { kind: "tool_result", toolUseId: "tu_1", payloadDropped: true, chars: 6 },
      { kind: "text", payloadDropped: true, chars: 40 },
    ],
  });
  render(<RunTranscriptBlocks transcript={transcript} />);
  expect(screen.getByText(/expired per retention policy/)).toBeTruthy();
  expect(screen.getByText("Thought for 4s")).toBeTruthy();
  expect(screen.getByText("Bash")).toBeTruthy();
  expect(screen.queryByText("M a.ts")).toBeNull();
});

test("dropped steps beyond the size budget are stated, never silent", () => {
  render(<RunTranscriptBlocks transcript={record({ droppedBlocks: 3, truncated: true })} />);
  expect(screen.getByText(/3 step\(s\) were dropped/)).toBeTruthy();
});
