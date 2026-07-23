import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkBoardView } from "@/features/work-board/work-board-view";
import { i18n } from "@/lib/i18n";

const mocks = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock("@/data/use-console-state", () => ({
  useConsoleState: () => ({ data: mocks.state }),
  useRefreshConsoleState: () => async () => {},
}));

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("en-US");
});

describe("WorkBoardView localization", () => {
  it("renders the empty board in both supported locales", async () => {
    mocks.state = {};
    await i18n.changeLanguage("en-US");
    const view = render(<WorkBoardView />);
    expect(screen.getByText("Nothing tracked yet")).toBeTruthy();

    await i18n.changeLanguage("zh-CN");
    view.rerender(<WorkBoardView />);
    expect(screen.getByText("尚无跟踪项")).toBeTruthy();
    expect(screen.getByText("状态")).toBeTruthy();
  });
});
