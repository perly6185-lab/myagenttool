import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RiskReminderAcceptanceSurface } from "./risk-reminder-acceptance-surface";

beforeEach(() => {
  document.documentElement.dataset.sourceCommit = "a".repeat(40);
  document.documentElement.dataset.sourceState = "clean";
  document.documentElement.dataset.acceptanceSurfaceVersion = "risk-reminder-ui-v1";
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
});

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.sourceCommit;
  delete document.documentElement.dataset.sourceState;
  delete document.documentElement.dataset.acceptanceSurfaceVersion;
});

describe("risk reminder acceptance surface", () => {
  it("renders production review components without facilitator answers", () => {
    const { container } = render(<RiskReminderAcceptanceSurface />);
    expect(screen.getByTestId("risk-reminder-acceptance-surface")).toBeTruthy();
    expect(screen.getByText("结果已通过复核和验证")).toBeTruthy();
    expect(screen.getAllByText("确认并创建 Pull Request").length).toBeGreaterThan(0);
    expect(screen.getByText(/不会自动合并到主分支/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.textContent).not.toContain("facilitatorGuide");
    expect(container.textContent).not.toContain("复核和验证，等待用户确认交付");
  });

  it("navigates all eight scenarios and exposes only bounded study metadata", () => {
    render(<RiskReminderAcceptanceSurface />);
    const next = screen.getByRole("button", { name: "下一个场景" });
    fireEvent.click(next);
    expect(screen.getByText("当前还不能确认交付")).toBeTruthy();
    for (let index = 0; index < 6; index += 1) fireEvent.click(next);
    expect(screen.getByText("写入状态尚不能确认")).toBeTruthy();
    expect(screen.getByText("操作回执：").parentElement?.textContent).toContain("9/10");
    const metadata = screen.getByTestId("acceptance-surface-metadata").textContent ?? "";
    expect(metadata).toContain("a".repeat(40));
    expect(metadata).toContain('"locale": "zh-CN"');
    expect(metadata).toContain('"width": 1440');
    expect(metadata).toContain('"sourceState": "clean"');
    expect(document.documentElement.lang).toBe("zh-CN");
  });

  it("blocks formal study use for dirty builds or an out-of-policy viewport", () => {
    document.documentElement.dataset.sourceState = "dirty";
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    render(<RiskReminderAcceptanceSurface />);
    expect(screen.getByRole("alert").textContent).toContain("当前构建不可用于正式验收");
  });

  it("blocks formal study use when the built surface version drifts", () => {
    document.documentElement.dataset.acceptanceSurfaceVersion = "risk-reminder-ui-v2";
    render(<RiskReminderAcceptanceSurface />);
    expect(screen.getByRole("alert").textContent).toContain("页面版本必须匹配");
  });
});
