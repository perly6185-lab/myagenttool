import { describe, expect, it } from "vitest";

import type { InvocationSnapshot } from "@/lib/console-state";
import { proposalFromInvocation } from "./approval-patch-model";

function invocation(overrides: Partial<InvocationSnapshot> = {}): InvocationSnapshot {
  return {
    id: "inv-proposal",
    status: "succeeded",
    options: { metadata: { tool: "claude.propose.patch", projectId: "project-1", worktreeId: "worktree-1" } },
    result: {
      output: {
        summary: "Update settings flow",
        patch: "diff --git a/file.ts b/file.ts",
        files: [{ path: "file.ts", action: "modify" }, { path: "", action: "ignore" }],
      },
    },
    ...overrides,
  } as InvocationSnapshot;
}

describe("proposalFromInvocation", () => {
  it("normalizes a completed governed patch proposal", () => {
    expect(proposalFromInvocation(invocation())).toMatchObject({
      invocationId: "inv-proposal",
      projectId: "project-1",
      worktreeId: "worktree-1",
      summary: "Update settings flow",
      patch: "diff --git a/file.ts b/file.ts",
      files: [{ path: "file.ts", action: "modify" }],
    });
  });

  it("prefers invocation scope over legacy metadata scope", () => {
    expect(proposalFromInvocation(invocation({ projectId: "project-current", worktreeId: "worktree-current" }))).toMatchObject({
      projectId: "project-current",
      worktreeId: "worktree-current",
    });
  });

  it("rejects unfinished, unrelated, and empty-patch invocations", () => {
    expect(proposalFromInvocation(invocation({ status: "running" }))).toBeNull();
    expect(proposalFromInvocation(invocation({ options: { metadata: { tool: "other.tool" } } }))).toBeNull();
    expect(proposalFromInvocation(invocation({ result: { output: { patch: "   " } } }))).toBeNull();
  });
});
