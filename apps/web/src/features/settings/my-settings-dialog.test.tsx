import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/lib/i18n";
import { useUiStore } from "@/store/ui-store";
import { MySettingsDialog } from "./my-settings-dialog";

const mocks = vi.hoisted(() => ({ role: "owner" as "owner" | "admin" | "operator" | "viewer" }));

vi.mock("@/hooks/use-session-user", () => ({
  useSessionUser: () => ({ id: "usr_test", role: mocks.role }),
}));
vi.mock("@/features/me/me-view", () => ({
  MeView: () => <div>General preferences panel</div>,
}));
vi.mock("./settings-home-view", () => ({
  SettingsHomeView: () => <div>Professional readiness panel</div>,
}));
vi.mock("@/app/routes", () => ({
  SECTION_VIEWS: {
    agents: () => <div>Embedded agents page</div>,
    invocations: () => <div>Embedded invocations page</div>,
  },
}));

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
  mocks.role = "owner";
  useUiStore.setState({
    section: "dashboard",
    surfaceReturnSection: null,
    settingsDialogOpen: false,
    settingsCategory: null,
    settingsQuery: "",
    recentSettingsSections: [],
    favoriteSettingsSections: [],
  });
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("MySettingsDialog", () => {
  it("opens from Me, keeps professional navigation in the dialog, and restores the previous page", () => {
    useUiStore.setState({ section: "me", surfaceReturnSection: "task", settingsDialogOpen: true });
    render(<MySettingsDialog />);

    const dialog = screen.getByRole("dialog", { name: "My settings" });
    expect(dialog.closest(".app-modal-layer")).toBeTruthy();
    expect(within(dialog).getByText("General preferences panel")).toBeTruthy();
    const executionCategory = within(dialog).getByRole("button", { name: /Execution & Agents/ });
    fireEvent.click(executionCategory);
    expect(useUiStore.getState().settingsCategory).toBe("execution");
    expect(executionCategory.getAttribute("aria-expanded")).toBe("true");
    const executionSubnav = dialog.querySelector("#settings-subnav-execution")!;
    fireEvent.click(within(executionSubnav as HTMLElement).getByRole("button", { name: "Agents" }));
    expect(useUiStore.getState().section).toBe("agents");
    expect(within(dialog).getByText("Embedded agents page")).toBeTruthy();
    expect(useUiStore.getState().recentSettingsSections).toContain("agents");

    const closeButton = within(dialog).getByRole("button", { name: "Close" });
    expect(closeButton.className).toContain("size-9");
    fireEvent.click(closeButton);
    expect(useUiStore.getState().section).toBe("task");
    expect(useUiStore.getState().settingsDialogOpen).toBe(false);
  });

  it("filters professional areas by the verified role", () => {
    mocks.role = "operator";
    useUiStore.setState({ section: "settings", settingsDialogOpen: true });
    render(<MySettingsDialog />);

    const dialog = screen.getByRole("dialog", { name: "My settings" });
    expect(within(dialog).queryByRole("button", { name: /Execution & Agents/ })).toBeNull();
    expect(within(dialog).getByRole("button", { name: /Records & diagnostics/ })).toBeTruthy();
  });

  it("maximizes and restores the settings workspace", () => {
    useUiStore.setState({ section: "settings", settingsDialogOpen: true });
    render(<MySettingsDialog />);
    const dialog = screen.getByRole("dialog", { name: "My settings" });

    expect(dialog.className).toContain("max-w-6xl");
    fireEvent.click(within(dialog).getByRole("button", { name: "Maximize dialog" }));
    expect(dialog.className).toContain("max-w-[calc(100vw-1rem)]");
    expect(within(dialog).getByRole("button", { name: "Restore dialog size" })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Restore dialog size" }));
    expect(dialog.className).toContain("max-w-6xl");
  });

  it("searches across permitted leaf pages without flattening the left navigation", () => {
    window.history.replaceState(null, "", "/?section=settings");
    useUiStore.setState({ section: "settings", settingsDialogOpen: true });
    render(<MySettingsDialog />);
    const dialog = screen.getByRole("dialog", { name: "My settings" });
    expect(dialog.querySelector('[data-settings-navigation="ready"]')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Search settings"), { target: { value: "registered health" } });
    expect(within(dialog).getByText(/professional capabilities found/)).toBeTruthy();
    expect(within(dialog).getByText("Agents", { selector: "strong" })).toBeTruthy();
  });

  it("offers a category and capability selector on compact layouts", () => {
    useUiStore.setState({ section: "settings", settingsDialogOpen: true });
    render(<MySettingsDialog />);
    const dialog = screen.getByRole("dialog", { name: "My settings" });

    fireEvent.change(within(dialog).getByLabelText("Settings area", { exact: true }), { target: { value: "diagnostics" } });
    const capability = within(dialog).getByLabelText("Capability", { exact: true });
    expect(within(capability).getByRole("option", { name: "Invocations" })).toBeTruthy();
    fireEvent.change(capability, { target: { value: "invocations" } });

    expect(useUiStore.getState()).toMatchObject({
      section: "invocations",
      settingsCategory: "diagnostics",
      settingsDialogOpen: true,
    });
  });
});
