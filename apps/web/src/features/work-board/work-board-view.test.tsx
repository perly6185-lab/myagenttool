import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkBoardView } from "@/features/work-board/work-board-view";
import { i18n } from "@/lib/i18n";
import { useUiStore } from "@/store/ui-store";

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
    expect(screen.getByText("尚无待办事项")).toBeTruthy();
    expect(screen.getByText("状态")).toBeTruthy();
  });

  it("keeps user-authored work titles unchanged in zh-CN", async () => {
    await i18n.changeLanguage("zh-CN");
    mocks.state = {
      workBoard: {
        states: {
          pending_decision: { count: 1, items: [{ id: "item-1", title: "Fix Codex PR #42", section: "approvals" }] },
          follow_up: { count: 0, items: [] },
          in_progress: { count: 0, items: [] },
          waiting: { count: 0, items: [] },
          failed: { count: 0, items: [] },
          done: { count: 0, items: [] },
        },
      },
    };
    render(<WorkBoardView />);
    expect(screen.getByText("Fix Codex PR #42")).toBeTruthy();
  });

  it("localizes and opens a due follow-up reminder in its canonical Local Issue", async () => {
    await i18n.changeLanguage("zh-CN");
    useUiStore.setState({ section: "workBoard", selectedWorkItemId: null });
    mocks.state = {
      workBoard: {
        states: {
          pending_decision: { count: 0, items: [] },
          follow_up: { count: 1, items: [{ id: "followup:wfr_1", kind: "work_item_follow_up_reminder", title: "Update customer", reason: "Scheduled stakeholder follow-up is due", section: "task", targetId: "lwi_1" }] },
          in_progress: { count: 0, items: [] }, waiting: { count: 0, items: [] }, failed: { count: 0, items: [] }, done: { count: 0, items: [] },
        },
      },
    };
    render(<WorkBoardView />);
    expect(screen.getByText("关系人跟进时间已到")).toBeTruthy();
    expect(screen.queryByText("Scheduled stakeholder follow-up is due")).toBeNull();
    fireEvent.click(screen.getByText("Update customer"));
    expect(useUiStore.getState().selectedWorkItemId).toBe("lwi_1");
    expect(useUiStore.getState().section).toBe("task");
  });
});
