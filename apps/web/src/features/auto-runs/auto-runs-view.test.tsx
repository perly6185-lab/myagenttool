import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/lib/i18n";
import { AutoRunsView } from "./auto-runs-view";

const mocks = vi.hoisted(() => ({
  listAutoRuns: vi.fn(),
  useConsoleState: vi.fn(),
}));

vi.mock("@/data/use-console-actions", () => ({ api: { listAutoRuns: mocks.listAutoRuns } }));
vi.mock("@/data/use-console-state", () => ({ useConsoleState: mocks.useConsoleState }));
vi.mock("@/hooks/use-visible-interval", () => ({ useVisibleInterval: vi.fn() }));
vi.mock("./auto-run-dashboard", () => ({
  AutoRunDashboard: ({ onOpenRun }: { onOpenRun: (runId: string) => void }) => (
    <button type="button" onClick={() => onOpenRun("run-2")}>Open dashboard run</button>
  ),
}));
vi.mock("./auto-run-detail-card", () => ({
  AutoRunDetailCard: ({ run, focused }: { run: { id: string }; focused: boolean }) => (
    <div id={`auto-run-${run.id}`} data-testid={`detail-${run.id}`} data-focused={String(focused)}>
      Detail {run.id}
    </div>
  ),
}));
vi.mock("./auto-run-overview", () => ({
  AutoRunBoard: ({ runs, onOpen }: { runs: { id: string }[]; onOpen: (runId: string) => void }) => (
    <section data-testid="run-board">
      <span>{runs.map((run) => run.id).join(",")}</span>
      <button type="button" onClick={() => onOpen(runs[0]?.id ?? "")}>Open board run</button>
    </section>
  ),
}));

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
  window.history.replaceState(null, "", "/");
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  mocks.useConsoleState.mockReturnValue({ data: { invocations: [], events: [] } });
  mocks.listAutoRuns.mockResolvedValue({
    autoRuns: [
      { id: "run-1", status: "running", agentId: "agent-blue", branchName: "feature/search" },
      { id: "run-2", status: "blocked", link: { type: "issue", number: 42, title: "Fix routing", url: null } },
    ],
    summary: null,
    deployments: null,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AutoRunsView interactions", () => {
  it("filters list records and carries the filtered set into board mode", async () => {
    render(<AutoRunsView />);
    expect(await screen.findByTestId("detail-run-1")).toBeTruthy();
    expect(screen.getByTestId("detail-run-2")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("Search issue, run, agent, or branch"), { target: { value: "routing" } });
    expect(screen.queryByTestId("detail-run-1")).toBeNull();
    expect(screen.getByTestId("detail-run-2")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Board" }));
    expect(screen.getByTestId("run-board").textContent).toContain("run-2");
    expect(screen.getByTestId("run-board").textContent).not.toContain("run-1");
  });

  it("returns from the board to a focused list record and performs a full refresh", async () => {
    render(<AutoRunsView />);
    await screen.findByTestId("detail-run-1");

    fireEvent.click(screen.getByRole("button", { name: "Board" }));
    fireEvent.click(screen.getByRole("button", { name: "Open board run" }));
    expect(screen.getByTestId("detail-run-1").getAttribute("data-focused")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(mocks.listAutoRuns).toHaveBeenLastCalledWith(true));
  });

  it("filters by status without losing the available status choices", async () => {
    render(<AutoRunsView />);
    await screen.findByTestId("detail-run-1");

    const status = screen.getByRole("combobox");
    expect(status.querySelectorAll("option")).toHaveLength(3);
    fireEvent.change(status, { target: { value: "blocked" } });
    expect(screen.queryByTestId("detail-run-1")).toBeNull();
    expect(screen.getByTestId("detail-run-2")).toBeTruthy();
  });
});
