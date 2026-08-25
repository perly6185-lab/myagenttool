import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkItemViewSwitch } from "./work-item-view-switch";

describe("WorkItemViewSwitch", () => {
  it("exposes ordinary and professional views without duplicating task data", () => {
    const onChange = vi.fn();
    render(<WorkItemViewSwitch mode="summary" language="zh" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "普通视图" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "专业视图" }));
    expect(onChange).toHaveBeenCalledWith("expert");
  });
});
