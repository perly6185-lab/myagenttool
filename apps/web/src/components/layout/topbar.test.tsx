import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Topbar } from "@/components/layout/topbar";
import { useUiStore } from "@/store/ui-store";

const stateMock = vi.hoisted(() => ({
  useConsoleState: vi.fn(),
}));

vi.mock("@/data/use-console-state", () => ({
  useConsoleState: stateMock.useConsoleState,
  useRefreshConsoleState: () => vi.fn(),
}));

vi.mock("@/data/use-console-actions", () => ({
  useAsyncAction: () => ({ execute: vi.fn(), pending: false }),
  api: { selectProject: vi.fn() },
}));

beforeEach(() => {
  stateMock.useConsoleState.mockReturnValue({
    data: {
      device: {
        id: "dev_local",
        name: "Local",
        status: "online",
        platform: "win32",
        architecture: "x64",
        lastSeenAt: "2026-07-07T00:00:00.000Z",
      },
      projects: [],
      currentProjectId: null,
      approvalRequests: [],
      codexPatchProposals: [{
        id: "cpp_pending",
        source: "codex",
        proposalInvocationId: "inv_proposal",
        invocationId: "inv_proposal",
        projectId: "prj_local",
        worktreeId: "wt_main",
        tool: "codex.propose.patch",
        mode: "patch-proposal",
        summary: "Review me",
        files: [],
        diffPreview: "",
        patchSha256: "a".repeat(64),
        verification: [],
        immutable: true,
        reviewState: "generated",
        authoritative: false,
        createdAt: "2026-07-07T01:00:00.000Z",
      }],
      invocations: [{
        id: "inv_blocked",
        status: "failed",
        options: { metadata: { tool: "codex.plan.change" } },
        createdAt: "2026-07-07T02:00:00.000Z",
      }],
    },
    isError: false,
    isLoading: false,
  });
  useUiStore.setState({
    section: "dashboard",
    selectedToolName: null,
    selectedToolFocus: null,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Topbar Codex ops shortcut", () => {
  it("shows pending Codex operations and deep-links to the Tools queue", () => {
    render(createElement(Topbar));

    const button = screen.getByRole("button", { name: /Codex Ops 2/i });
    fireEvent.click(button);

    expect(useUiStore.getState().section).toBe("tools");
    expect(useUiStore.getState().selectedToolName).toBe("codex");
    expect(useUiStore.getState().selectedToolFocus).toBe("ops");
  });
});
