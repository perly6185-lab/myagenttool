import { describe, expect, it } from "vitest";
import { assetDeepLink, taskTraceIdentity, taskTraceWaitingReason, workItemAssetChainLabels } from "./work-item-observability";

describe("taskTraceIdentity (#1500)", () => {
  it("exposes only task attribution and explanation fields", () => {
    expect(taskTraceIdentity({
      actorId: "fallback-user",
      data: {
        principalId: "user-1",
        terminalId: "terminal-1",
        effectiveAuthority: "task.execute",
        waitingReason: "Waiting for local capacity",
        credential: "must-not-render",
        payload: { secret: true },
      },
    })).toEqual({
      principalId: "user-1",
      deviceId: "terminal-1",
      effectiveAuthority: "task.execute",
      reason: "Waiting for local capacity",
    });
  });

  it("falls back to the event actor and bounds explanation text", () => {
    const result = taskTraceIdentity({
      actorId: "user-2",
      data: { rationale: "x".repeat(300) },
    });
    expect(result.principalId).toBe("user-2");
    expect(result.reason?.length).toBe(161);
    expect(result.reason?.endsWith("…")).toBe(true);
  });
});

describe("taskTraceWaitingReason (#1500)", () => {
  it("uses the first bounded queue explanation and ignores unrelated payloads", () => {
    expect(taskTraceWaitingReason({
      timeline: [
        {
          id: "run", at: "2026-07-25T00:00:00Z", source: "execution", type: "started",
          stage: "execution", actorId: null, message: "Started", data: { reason: "Not a wait" },
        },
        {
          id: "queue", at: "2026-07-25T00:00:01Z", source: "execution", type: "queued",
          stage: "queue", actorId: null, message: "Queued",
          data: { waitingReason: "Waiting for local capacity", credential: "secret" },
        },
      ],
    } as never)).toBe("Waiting for local capacity");
  });
});

describe("workItemAssetChainLabels (#1502)", () => {
  it("connects inputs, ordered operations, outputs, and archived evidence", () => {
    expect(workItemAssetChainLabels({
      inputAssets: [{ id: "xlsx", path: "source.xlsx" }],
      assetOperations: [
        { id: "render", capability: "render" },
        { id: "mutate", capability: "edit" },
      ],
      outputAssets: [
        { id: "pptx", path: "review.pptx" },
        { id: "png", path: "evidence/review.png" },
      ],
      verificationRecords: [{
        evidence: [{ kind: "asset", assetId: "png", ref: "evidence/review.png" }],
      }],
    } as never)).toEqual([
      "Input · source.xlsx",
      "Operation · edit",
      "Operation · render",
      "Output · review.pptx",
      "Evidence · evidence/review.png",
    ]);
  });

  it("deep-links to the owning project and worktree without exposing a host path", () => {
    const link = assetDeepLink(
      { projectId: "project 1" } as never,
      { path: "reports/Q3 review.xlsx", worktreeId: "worktree/1" },
    );
    expect(link).toContain("section=documents");
    expect(link).toContain("project=project+1");
    expect(link).toContain("document=reports%2FQ3+review.xlsx");
    expect(link).toContain("worktree=worktree%2F1");
    expect(link).not.toContain("/Users/");
  });
});
