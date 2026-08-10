import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { CommandPalette } from "./command-palette";
import { useUiStore } from "@/store/ui-store";

// jsdom doesn't implement scrollIntoView; the palette calls it on the active row.
Element.prototype.scrollIntoView = () => {};

const sessionMocks = vi.hoisted(() => ({ role: "owner" as "owner" | "admin" | "operator" | "viewer" }));
vi.mock("@/hooks/use-session-user", () => ({ useSessionUser: () => ({ id: "usr_test", role: sessionMocks.role }) }));

afterEach(() => {
  cleanup();
  sessionMocks.role = "owner";
  useUiStore.setState({ section: "dashboard", surfaceReturnSection: null });
});

// The listeners live on window; dispatch there directly so the tests exercise
// the real global key handling rather than a component-local binding.
const press = (init: KeyboardEventInit) =>
  fireEvent(window, new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));

const open = () => press({ key: "k", metaKey: true });

describe("CommandPalette", () => {
  it("stays closed until Cmd-K, then opens", () => {
    render(<CommandPalette />);
    expect(screen.queryByRole("dialog")).toBeNull();
    open();
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });

  it("ignores Cmd-K auto-repeat so holding the combo doesn't flicker it", () => {
    render(<CommandPalette />);
    press({ key: "k", metaKey: true, repeat: true });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("ignores Shift/Alt chords (e.g. Ctrl+Shift+K)", () => {
    render(<CommandPalette />);
    press({ key: "k", ctrlKey: true, shiftKey: true });
    press({ key: "k", metaKey: true, altKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on Escape even when a result row — not the input — holds focus", () => {
    render(<CommandPalette />);
    open();
    const dialog = screen.getByRole("dialog");
    // Simulate Tab having moved focus off the input onto a row.
    within(dialog).getAllByRole("option")[0].focus();
    press({ key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("navigates with Arrow + Enter to the highlighted section and closes", () => {
    useUiStore.getState().setSection("dashboard");
    render(<CommandPalette />);
    open();
    press({ key: "ArrowDown" }); // highlight moves to the second result
    press({ key: "Enter" });
    expect(useUiStore.getState().section).toBe("task");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the empty palette concise but reveals professional pages on deliberate search", () => {
    useUiStore.setState({ section: "dashboard" });
    render(<CommandPalette />);
    open();
    expect(screen.queryByRole("option", { name: /Applications/ })).toBeNull();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Applications" } });
    expect(screen.getByRole("option", { name: /Applications/ })).toBeTruthy();
  });

  it("filters management commands for a verified viewer", () => {
    sessionMocks.role = "viewer";
    useUiStore.setState({ section: "settings" });
    render(<CommandPalette />);
    open();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Agents" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Invocations" } });
    expect(screen.getByRole("option", { name: /Invocations/ })).toBeTruthy();
  });

  it("resets the highlight to the top match when the query changes", () => {
    render(<CommandPalette />);
    open();
    press({ key: "ArrowDown" });
    press({ key: "ArrowDown" }); // active is now index 2
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "task" } });
    // A fresh query must re-highlight its first result, not leave it on a stale row.
    const options = screen.getAllByRole("option");
    expect(options.length).toBeGreaterThan(1); // label and supporting copy match several destinations
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    expect(options[1].getAttribute("aria-selected")).toBe("false");
  });

  it("points aria-activedescendant at the highlighted option as it moves", () => {
    render(<CommandPalette />);
    open();
    const input = screen.getByRole("combobox");
    expect(input.getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[0].id);
    press({ key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[1].id);
  });
});
