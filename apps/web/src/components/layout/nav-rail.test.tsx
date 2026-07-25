import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NavRail } from "@/components/layout/nav-rail";
import { DEFAULT_COLLAPSED_NAV_GROUPS, useUiStore } from "@/store/ui-store";
import { i18n } from "@/lib/i18n";

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

afterEach(async () => {
  cleanup();
  localStorage.clear();
  useUiStore.setState({ section: "dashboard", collapsedNavGroups: [...DEFAULT_COLLAPSED_NAV_GROUPS], locale: "en-US" });
  await i18n.changeLanguage("en-US");
  vi.clearAllMocks();
});

describe("NavRail collapsible groups (#928)", () => {
  it("shows only the five ordinary Entry destinations by default", () => {
    mockEmptyState();
    useUiStore.setState({ section: "dashboard", collapsedNavGroups: [...DEFAULT_COLLAPSED_NAV_GROUPS] });
    renderNav();
    expect(screen.getByText("Home")).toBeTruthy();
    expect(screen.getByText("Tasks")).toBeTruthy();
    expect(screen.getByText("Projects")).toBeTruthy();
    expect(screen.getByText("Queue")).toBeTruthy();
    expect(screen.getByText("Needs attention")).toBeTruthy();
    expect(screen.queryByText("Documents")).toBeNull(); // contextual — deep-link only
    expect(screen.queryByText("Agents")).toBeNull(); // Settings — collapsed
    expect(screen.queryByText("Economics")).toBeNull();
  });

  it("force-opens the collapsed group that holds the active section (deep-link safety)", () => {
    mockEmptyState();
    useUiStore.setState({ section: "economics", collapsedNavGroups: [...DEFAULT_COLLAPSED_NAV_GROUPS] });
    renderNav();
    // Settings is collapsed by default, but the active section lives there → shown anyway.
    expect(screen.getByText("Economics")).toBeTruthy();
  });

  it("toggles a collapsed group open from its header", () => {
    mockEmptyState();
    useUiStore.setState({ section: "dashboard", collapsedNavGroups: [...DEFAULT_COLLAPSED_NAV_GROUPS] });
    renderNav();
    expect(screen.queryByText("Agents")).toBeNull();
    fireEvent.click(screen.getByText("Settings"));
    expect(screen.getByText("Agents")).toBeTruthy();
  });

  it("renders stable navigation keys in Simplified Chinese", async () => {
    mockEmptyState();
    useUiStore.setState({ section: "dashboard", locale: "zh-CN", collapsedNavGroups: [...DEFAULT_COLLAPSED_NAV_GROUPS] });
    await i18n.changeLanguage("zh-CN");
    renderNav();
    expect(screen.getByText("首页")).toBeTruthy();
    expect(screen.getByText("任务")).toBeTruthy();
    expect(screen.queryByText("文档")).toBeNull();
    expect(screen.getByRole("navigation", { name: "控制平面栏目" })).toBeTruthy();
  });
});
