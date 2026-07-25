import { describe, expect, it } from "vitest";
import { entryJourneyContext } from "./entry-journey";
import type { ConsoleSnapshot } from "@/lib/console-state";

describe("entryJourneyContext", () => {
  it("keeps the journey and attention inside the active project", () => {
    const state = {
      invocations: [
        { id: "other-new", projectId: "p2", createdAt: "2026-07-25T03:00:00Z" },
        { id: "mine", projectId: "p1", createdAt: "2026-07-25T02:00:00Z" },
      ],
      pendingDecisions: [
        { id: "d1", invocationId: "mine" },
        { id: "d2", invocationId: "other-new" },
      ],
      evidenceLedger: [
        { id: "e1", invocationId: "mine", attention: true },
        { id: "e2", invocationId: "other-new", attention: true },
      ],
    } as unknown as ConsoleSnapshot;
    const context = entryJourneyContext(state, "p1", "other-new");
    expect(context.invocation?.id).toBe("mine");
    expect(context.pending).toBe(1);
    expect(context.attention).toBe(1);
  });
});
