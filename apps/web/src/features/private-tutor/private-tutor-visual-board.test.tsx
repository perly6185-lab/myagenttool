import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivateTutorVisualBoard } from "@/features/private-tutor/private-tutor-visual-board";
import type { PrivateTutorVisualScene } from "@/features/private-tutor/private-tutor-api";

const scene: PrivateTutorVisualScene = {
  schemaVersion: 1,
  revisionId: "balance-demo-v1",
  template: "equation_balance",
  title: "等式是一架平衡的天平",
  ariaLabel: "x 加 3 等于 8，两边同时减 3 后 x 等于 5",
  parameters: {
    initialLeft: "x + 3",
    initialRight: "8",
    states: [
      { narration: "先看天平两边", left: "x + 3", right: "8" },
      { narration: "两边同时减去 3", left: "x + 3 - 3", right: "8 - 3" },
      { narration: "天平仍然平衡", left: "x", right: "5" },
    ],
  },
  steps: [
    { id: "step-1", index: 0, startMs: 0, durationMs: 2_400, narration: "先看天平两边", stateIndex: 0 },
    { id: "step-2", index: 1, startMs: 2_400, durationMs: 2_400, narration: "两边同时减去 3", stateIndex: 1 },
    { id: "step-3", index: 2, startMs: 4_800, durationMs: 2_400, narration: "天平仍然平衡", stateIndex: 2 },
  ],
  interaction: {
    kind: "select_value",
    prompt: "选择最后的 x",
    choices: [
      { id: "choice-1", label: "5", value: "5" },
      { id: "choice-2", label: "8", value: "8" },
      { id: "choice-3", label: "3", value: "3" },
    ],
  },
  publication: { status: "engineering_preview", contentVersion: "p7.1", mathValidated: true, reviewedAt: null },
};

describe("private tutor visual board", () => {
  afterEach(() => cleanup());

  it("keeps visual state and narration on the same manually selected step", () => {
    const onNarrate = vi.fn(() => true);
    render(<PrivateTutorVisualBoard scene={scene} reducedMotion={false} disabled={false} onNarrate={onNarrate} onStopNarration={vi.fn()} onAnswer={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    expect(screen.getByText("两边同时减去 3")).toBeTruthy();
    expect(screen.getByText("x + 3 - 3")).toBeTruthy();
    expect(onNarrate).toHaveBeenCalledWith("两边同时减去 3", expect.any(Function));
  });

  it("advances the shared timeline only after each narration finishes", () => {
    const callbacks: Array<() => void> = [];
    const onNarrate = vi.fn((_text: string, onEnd: () => void) => { callbacks.push(onEnd); return true; });
    render(<PrivateTutorVisualBoard scene={scene} reducedMotion={false} disabled={false} onNarrate={onNarrate} onStopNarration={vi.fn()} onAnswer={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /播放/ }));
    expect(onNarrate.mock.calls[0][0]).toBe("先看天平两边");
    act(() => callbacks.shift()?.());
    expect(onNarrate.mock.calls[1][0]).toBe("两边同时减去 3");
    expect(screen.getByText("第 2 / 3 步 · 可以暂停或逐步查看")).toBeTruthy();
    act(() => callbacks.shift()?.());
    expect(onNarrate.mock.calls[2][0]).toBe("天平仍然平衡");
  });

  it("keeps static single-step learning and visual answers available with reduced motion", () => {
    const onAnswer = vi.fn();
    render(<PrivateTutorVisualBoard scene={scene} reducedMotion disabled={false} onNarrate={() => false} onStopNarration={vi.fn()} onAnswer={onAnswer} />);

    expect(screen.getByLabelText("动态白板：等式是一架平衡的天平").getAttribute("data-motion")).toBe("reduced");
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fireEvent.click(screen.getByRole("button", { name: "5" }));
    expect(onAnswer).toHaveBeenCalledWith("5");
  });
});
