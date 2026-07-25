import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsHomeView } from "@/features/settings/settings-home-view";
import { i18n } from "@/lib/i18n";

const mocks = vi.hoisted(() => ({ useConsoleState: vi.fn(), navigate: vi.fn() }));
vi.mock("@/data/use-console-state", () => ({ useConsoleState: mocks.useConsoleState }));
vi.mock("@/hooks/use-page-navigation", () => ({ usePageNavigation: () => mocks.navigate }));

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
  mocks.useConsoleState.mockReturnValue({ data: { device: { status: "offline" }, agents: [], applications: [], channelOperations: [] } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("SettingsHomeView", () => {
  it("shows readiness and routes the recommended safe fix", () => {
    render(<SettingsHomeView />);
    expect(screen.getByText("Recommended next steps")).toBeTruthy();
    fireEvent.click(screen.getByText(/Start or repair the local Desktop Bridge/));
    expect(mocks.navigate).toHaveBeenCalledWith("devices");
  });

  it("searches configuration domains without adding them to Entry", () => {
    render(<SettingsHomeView />);
    fireEvent.change(screen.getByLabelText("Search settings"), { target: { value: "channel" } });
    expect(screen.getByText("Channels")).toBeTruthy();
    expect(screen.queryByText("Agents")).toBeNull();
  });
});
