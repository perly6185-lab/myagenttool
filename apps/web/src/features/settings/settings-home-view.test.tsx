import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsHomeView } from "@/features/settings/settings-home-view";
import { i18n } from "@/lib/i18n";

const mocks = vi.hoisted(() => ({
  useConsoleState: vi.fn(),
  navigate: vi.fn(),
  getTaskMaterialStorage: vi.fn(),
  cleanupTaskMaterialStorage: vi.fn(),
  updateProject: vi.fn(),
}));
vi.mock("@/data/use-console-state", () => ({ useConsoleState: mocks.useConsoleState }));
vi.mock("@/data/use-console-actions", () => ({ api: mocks }));
vi.mock("@/hooks/use-page-navigation", () => ({ usePageNavigation: () => mocks.navigate }));

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
  mocks.useConsoleState.mockReturnValue({ data: { device: { status: "offline" }, agents: [], applications: [], channelOperations: [] } });
  mocks.getTaskMaterialStorage.mockResolvedValue({
    usedBytes: 100,
    limitBytes: 1_000,
    reclaimableBytes: 50,
    draftCount: 1,
    fileCount: 2,
    completedTaskCount: 1,
    expiredDraftCount: 0,
    retentionDays: 30,
    previewToken: "preview-1",
  });
  mocks.cleanupTaskMaterialStorage.mockResolvedValue({
    reclaimedBytes: 50,
    fileCount: 2,
    draftCount: 1,
    usage: {
      usedBytes: 50,
      limitBytes: 1_000,
      reclaimableBytes: 0,
      draftCount: 0,
      fileCount: 0,
      completedTaskCount: 0,
      expiredDraftCount: 0,
      retentionDays: 30,
      previewToken: "preview-2",
    },
  });
  mocks.updateProject.mockResolvedValue({ project: { id: "prj_1" } });
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

  it("connects Application, Agent, Tool, and optional Channel setup", () => {
    render(<SettingsHomeView />);
    expect(screen.getByText("Capability setup path")).toBeTruthy();
    for (const label of ["Application", "Agent", "Tool", "Channel"]) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  });

  it("previews and confirms safe local material cleanup", async () => {
    render(<SettingsHomeView />);
    expect(await screen.findByText("Local reference material storage")).toBeTruthy();
    expect(screen.getByText("50 B")).toBeTruthy();
    expect(screen.getByText(/Completed tasks past retention: 1/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Free space" }));
    expect(screen.getByRole("dialog", { name: "Free local reference material storage?" })).toBeTruthy();
    expect(screen.getByText(/Active tasks are unaffected/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm cleanup" }));

    await waitFor(() => expect(mocks.cleanupTaskMaterialStorage).toHaveBeenCalledWith("preview-1"));
    expect(await screen.findByText("Freed 50 B of local storage.")).toBeTruthy();
  });

  it("lets the user retry when local storage cannot be read", async () => {
    mocks.getTaskMaterialStorage.mockRejectedValueOnce(new Error("offline"));
    render(<SettingsHomeView />);
    expect((await screen.findByRole("alert")).textContent).toContain("temporarily unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(mocks.getTaskMaterialStorage).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("100 B")).toBeTruthy();
  });

  it("saves server-enforced external issue controls for the current project", async () => {
    mocks.useConsoleState.mockReturnValue({ data: {
      currentProjectId: "prj_1",
      projects: [{ id: "prj_1", name: "Console", externalIssuePolicy: { intakeEnabled: true, writebackEnabled: true, autoExecutionEnabled: false, emergencyStop: false } }],
      device: { status: "online" }, agents: [], applications: [], channelOperations: [],
    } });
    render(<SettingsHomeView />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Allow external issues to trigger automatic execution/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save project controls" }));
    await waitFor(() => expect(mocks.updateProject).toHaveBeenCalledWith("prj_1", {
      externalIssuePolicy: { intakeEnabled: true, writebackEnabled: true, autoExecutionEnabled: true, emergencyStop: false },
    }));
    expect(await screen.findByText(/saved and are active now/)).toBeTruthy();
  });
});
