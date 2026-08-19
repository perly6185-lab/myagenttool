import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/lib/i18n";
import { ExternalCollaborationMenu } from "./external-collaboration-menu";

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
});

afterEach(cleanup);

describe("ExternalCollaborationMenu", () => {
  it("keeps external intake behind one secondary menu and routes each kind explicitly", () => {
    const actions = {
      onImportIssue: vi.fn(),
      onOpenIssueInbox: vi.fn(),
      onOpenChanges: vi.fn(),
      onOpenSettings: vi.fn(),
    };
    render(<ExternalCollaborationMenu {...actions} />);

    const trigger = screen.getByRole("button", { name: "External work" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("menuitem")).toHaveLength(4);
    fireEvent.click(screen.getByRole("menuitem", { name: /Create tasks from issues/ }));
    expect(actions.onImportIssue).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /Change requests/ }));
    expect(actions.onOpenChanges).toHaveBeenCalledOnce();
  });

  it("supports keyboard opening, menu traversal, and escape focus restoration", async () => {
    render(
      <ExternalCollaborationMenu
        onImportIssue={() => {}}
        onOpenIssueInbox={() => {}}
        onOpenChanges={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    const trigger = screen.getByRole("button", { name: "External work" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const items = screen.getAllByRole("menuitem");
    await waitFor(() => expect(items[0]).toBe(document.activeElement));
    fireEvent.keyDown(items[0], { key: "End" });
    expect(items[3]).toBe(document.activeElement);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toBe(document.activeElement);
  });
});
