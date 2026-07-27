import { describe, expect, it } from "vitest";
import { mobileTodoCounts } from "@/components/layout/mobile-navigation-model";
import type { ConsoleSnapshot } from "@/lib/console-state";

describe("mobileTodoCounts (#1540)", () => {
  it("keeps queued/running work separate from human attention", () => {
    const state = {
      workBoard: {
        generatedAt: 1,
        states: {
          in_progress: { count: 2, items: [] },
          waiting: { count: 3, items: [] },
          pending_decision: { count: 4, items: [] },
          follow_up: { count: 1, items: [] },
          done: { count: 9, items: [] },
          failed: { count: 2, items: [] },
        },
      },
    } as unknown as ConsoleSnapshot;

    expect(mobileTodoCounts(state)).toEqual({ active: 5, attention: 5 });
  });

  it("uses live run and attention facts while the board is unavailable", () => {
    const state = {
      invocations: [{ status: "queued" }, { status: "running" }, { status: "succeeded" }],
      pendingDecisions: [{ id: "decision" }],
      evidenceLedger: [{ attention: true }, { attention: false }],
    } as unknown as ConsoleSnapshot;

    expect(mobileTodoCounts(state)).toEqual({ active: 2, attention: 2 });
  });
});
