import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NavRail } from "@/components/layout/nav-rail";
import { DEFAULT_COLLAPSED_NAV_GROUPS, useUiStore } from "@/store/ui-store";
import { i18n } from "@/lib/i18n";

const stateMock = vi.hoisted(() => ({ useConsoleState: vi.fn() }));
vi.mock("@/data/use-console-state", () => ({
  useConsoleState: stateMock.useConsoleState,
  useRefreshConsoleState: () => vi.fn(),
}));

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
  it("keeps the ordinary navigation to four clear destinations", () => {
    mockEmptyState();
    useUiStore.setState({ section: "dashboard", collapsedNavGroups: [...DEFAULT_COLLAPSED_NAV_GROUPS] });
    renderNav();
    expect(screen.getByText("My home")).toBeTruthy();
    expect(screen.getByText("My tasks")).toBeTruthy();
    expect(screen.getByText("My projects")).toBeTruthy();
    expect(screen.getByText("My hosts")).toBeTruthy();
    expect(screen.queryByText("Needs me")).toBeNull();
    expect(screen.getByText("My settings")).toBeTruthy();
    expect(screen.queryByText("External work")).toBeNull();
    expect(screen.queryByText("Queue")).toBeNull();
    expect(screen.queryByText("Needs attention")).toBeNull();
    expect(screen.queryByText("Documents")).toBeNull(); // contextual — deep-link only
    expect(screen.queryByText("Agents")).toBeNull(); // Settings — collapsed
    expect(screen.queryByText("Economics")).toBeNull();
  });

  it("keeps ordinary destinations visible on a professional deep link", () => {
    mockEmptyState();
    useUiStore.setState({ section: "economics", collapsedNavGroups: [...DEFAULT_COLLAPSED_NAV_GROUPS] });
    renderNav();
    expect(screen.getByText("My home")).toBeTruthy();
    expect(screen.getByText("My settings")).toBeTruthy();
    expect(screen.queryByText("Economics")).toBeNull();
  });

  it("does not expose Settings and Trace as global groups", () => {
    mockEmptyState();
    useUiStore.setState({ section: "dashboard", collapsedNavGroups: [...DEFAULT_COLLAPSED_NAV_GROUPS] });
    renderNav();
    expect(screen.queryByText("Agents")).toBeNull();
    expect(screen.queryByText("Settings")).toBeNull();
    expect(screen.queryByText("Trace")).toBeNull();
    expect(screen.queryByText("Agents")).toBeNull();
  });

  it("renders stable navigation keys in Simplified Chinese", async () => {
    mockEmptyState();
    useUiStore.setState({ section: "dashboard", locale: "zh-CN", collapsedNavGroups: [...DEFAULT_COLLAPSED_NAV_GROUPS] });
    await i18n.changeLanguage("zh-CN");
    renderNav();
    expect(screen.getByText("我的首页")).toBeTruthy();
    expect(screen.getByText("我的任务")).toBeTruthy();
    expect(screen.getByText("我的项目")).toBeTruthy();
    expect(screen.getByText("我的主机")).toBeTruthy();
    expect(screen.getByText("我的设置")).toBeTruthy();
    expect(screen.queryByText("外部协作")).toBeNull();
    expect(screen.queryByText("待我处理")).toBeNull();
    expect(screen.queryByText("文档")).toBeNull();
    expect(screen.getByRole("navigation", { name: "工作台栏目" })).toBeTruthy();
  });
});
