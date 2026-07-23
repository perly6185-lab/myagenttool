import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceView } from "@/features/workspace/workspace-view";
import { i18n } from "@/lib/i18n";

vi.mock("@/data/use-console-state", () => ({ useConsoleState: () => ({ data: { projects: [] } }), useRefreshConsoleState: () => async () => {} }));
vi.mock("@/features/projects/project-tree", () => ({ ProjectTree: () => null }));
vi.mock("@/features/dashboard/dashboard-view", () => ({ DashboardView: () => null }));
vi.mock("@/features/invocations/session-history", () => ({ SessionHistory: () => null }));

afterEach(async () => { cleanup(); await i18n.changeLanguage("en-US"); });

describe("WorkspaceView localization", () => {
  it("renders its empty state in both locales", async () => {
    await i18n.changeLanguage("en-US");
    const view = render(<WorkspaceView />);
    expect(screen.getByText("No projects yet")).toBeTruthy();
    await i18n.changeLanguage("zh-CN");
    view.rerender(<WorkspaceView />);
    expect(screen.getByText("尚无项目")).toBeTruthy();
    expect(screen.getByRole("button", { name: "注册项目" })).toBeTruthy();
  });
});
