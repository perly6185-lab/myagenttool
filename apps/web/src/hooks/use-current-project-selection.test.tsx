import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCurrentProjectSelection } from "@/hooks/use-current-project-selection";
import { useUiStore } from "@/store/ui-store";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  selectProject: vi.fn(),
}));

vi.mock("@/data/use-console-actions", () => ({
  api: { selectProject: mocks.selectProject },
  useAsyncAction: () => ({ execute: mocks.execute, pending: false, error: null, reset: vi.fn() }),
}));

beforeEach(() => {
  localStorage.clear();
  useUiStore.setState({ selectedProjectId: "prj_old", selectedWorktreeId: "wt_old" });
  mocks.selectProject.mockResolvedValue({ currentProjectId: "prj_new" });
  mocks.execute.mockImplementation(async (action: () => Promise<unknown>) => {
    await action();
    return true;
  });
});

describe("useCurrentProjectSelection", () => {
  it("switches through the server and clears a stale worktree focus", async () => {
    const { result } = renderHook(() => useCurrentProjectSelection());
    await act(() => result.current.selectProject("prj_new", "prj_old"));

    expect(mocks.selectProject).toHaveBeenCalledWith("prj_new");
    expect(useUiStore.getState().selectedProjectId).toBe("prj_new");
    expect(useUiStore.getState().selectedWorktreeId).toBeNull();
  });

  it("restores the previous local focus when the server rejects the switch", async () => {
    mocks.execute.mockResolvedValueOnce(false);
    const { result } = renderHook(() => useCurrentProjectSelection());
    await act(() => result.current.selectProject("prj_new", "prj_old"));

    expect(useUiStore.getState().selectedProjectId).toBe("prj_old");
    expect(useUiStore.getState().selectedWorktreeId).toBe("wt_old");
  });
});
