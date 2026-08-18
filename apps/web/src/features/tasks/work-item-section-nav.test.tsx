import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/lib/i18n";
import { WorkItemSectionNav } from "./work-item-section-nav";

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
});

afterEach(cleanup);

describe("WorkItemSectionNav", () => {
  it("keeps every section tab in the normal keyboard tab order", () => {
    const onSectionChange = vi.fn();
    render(
      <WorkItemSectionNav
        itemId="lwi_1"
        activeSection="overview"
        onSectionChange={onSectionChange}
      />,
    );

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(6);
    for (const tab of tabs) expect(tab.tabIndex).toBe(0);

    fireEvent.click(screen.getByRole("tab", { name: "Report" }));
    expect(onSectionChange).toHaveBeenCalledWith("report");
  });
});
