import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/lib/i18n";
import { useAutoRunsController } from "./use-auto-runs-controller";

const mocks = vi.hoisted(() => ({
  listAutoRuns: vi.fn(),
  useConsoleState: vi.fn(),
}));

vi.mock("@/data/use-console-actions", () => ({ api: { listAutoRuns: mocks.listAutoRuns } }));
vi.mock("@/data/use-console-state", () => ({ useConsoleState: mocks.useConsoleState }));
vi.mock("@/hooks/use-visible-interval", () => ({ useVisibleInterval: vi.fn() }));

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
  window.history.replaceState(null, "", "/");
  mocks.useConsoleState.mockReturnValue({ data: { invocations: [], events: [] } });
  mocks.listAutoRuns.mockResolvedValue({
    autoRuns: [
      { id: "run-1", status: "running" },
      { id: "run-2", status: "blocked" },
    ],
    summary: { total: 2 },
    deployments: { total: 0 },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("useAutoRunsController", () => {
  it("refreshes quietly after a successful coordinated action", async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useAutoRunsController());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mocks.listAutoRuns).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.performRunAction("run-1", action);
    });

    expect(action).toHaveBeenCalledOnce();
    expect(mocks.listAutoRuns).toHaveBeenCalledTimes(2);
    expect(mocks.listAutoRuns).toHaveBeenLastCalledWith(false);
    expect(result.current.actionRunId).toBeNull();
    expect(result.current.actionError).toBeNull();
  });

  it("surfaces action failures without refreshing stale data", async () => {
    const action = vi.fn().mockRejectedValue(new Error("approval expired"));
    const { result } = renderHook(() => useAutoRunsController());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.performRunAction("run-2", action);
    });

    expect(mocks.listAutoRuns).toHaveBeenCalledTimes(1);
    expect(result.current.actionRunId).toBeNull();
    expect(result.current.actionError).toBe("approval expired");
  });

  it("consumes an auto-run deep link and preserves unrelated URL state", async () => {
    window.history.replaceState(null, "", "/?section=autoRuns&autoRun=run-2#history");
    const { result } = renderHook(() => useAutoRunsController());

    await waitFor(() => expect(result.current.focusedRunId).toBe("run-2"));
    expect(result.current.viewMode).toBe("list");
    expect(window.location.search).toBe("?section=autoRuns");
    expect(window.location.hash).toBe("#history");
  });
});
