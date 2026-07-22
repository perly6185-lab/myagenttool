import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NavRail } from "@/components/layout/nav-rail";
import { DEFAULT_COLLAPSED_NAV_GROUPS, useUiStore } from "@/store/ui-store";

const stateMock = vi.hoisted(() => ({ useConsoleState: vi.fn() }));
vi.mock("@/data/use-console-state", () => ({ useConsoleState: stateMock.useConsoleState }));

function mockEmptyState() {
  stateMock.useConsoleState.mockReturnValue({
    data: { projects: [], worktrees: [], projectTargets: [], pendingDecisions: [], evidenceLedger: [] },
  });
}

function renderNav(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    createElement(QueryClientProvider, { client }, createElement(NavRail) as ReactElement),
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  useUiStore.setState({ section: "dashboard", collapsedNavGroups: [...DEFAULT_COLLAPSED_NAV_GROUPS] });
  vi.clearAllMocks();
});

describe("NavRail collapsible groups (#928)", () => {
  it("shows Work items but hides expert-group items by default", () => {
    mockEmptyState();
    useUiStore.setState({ section: "dashboard", collapsedNavGroups: [...DEFAULT_COLLAPSED_NAV_GROUPS] });
    renderNav();
    expect(screen.getByText("Overview")).toBeTruthy(); // Work — open
    expect(screen.getByText("Documents")).toBeTruthy();
    expect(screen.queryByText("Agents")).toBeNull(); // Configure — collapsed
    expect(screen.queryByText("Economics")).toBeNull(); // Ledgers — collapsed
  });

  it("force-opens the collapsed group that holds the active section (deep-link safety)", () => {
    mockEmptyState();
    useUiStore.setState({ section: "economics", collapsedNavGroups: [...DEFAULT_COLLAPSED_NAV_GROUPS] });
    renderNav();
    // Ledgers is collapsed by default, but the active section lives there → shown anyway.
    expect(screen.getByText("Economics")).toBeTruthy();
  });

  it("toggles a collapsed group open from its header", () => {
    mockEmptyState();
    useUiStore.setState({ section: "dashboard", collapsedNavGroups: [...DEFAULT_COLLAPSED_NAV_GROUPS] });
    renderNav();
    expect(screen.queryByText("Agents")).toBeNull();
    fireEvent.click(screen.getByText("Configure"));
    expect(screen.getByText("Agents")).toBeTruthy();
  });
});
