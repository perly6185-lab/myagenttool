import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GuidedSetupCard } from "./guided-setup-card";
import { i18n } from "@/lib/i18n";
import { useUiStore } from "@/store/ui-store";

const stateMock = vi.hoisted(() => ({
  useConsoleState: vi.fn(),
  commandGuidedSetup: vi.fn(),
}));
vi.mock("@/data/use-console-state", () => ({ useConsoleState: stateMock.useConsoleState }));
vi.mock("@/lib/api-client", () => ({ commandGuidedSetup: stateMock.commandGuidedSetup }));

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
  window.localStorage.clear();
  useUiStore.setState({ section: "dashboard" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("GuidedSetupCard", () => {
  it("starts with one server command, then shows one primary recovery action", async () => {
    stateMock.useConsoleState.mockReturnValue({
      data: {
        device: { status: "offline" },
        projects: [],
        projectTargets: [],
        agents: [],
      },
      refetch: vi.fn(),
    });
    stateMock.commandGuidedSetup.mockResolvedValue({
      guidedSetup: {
        version: 1,
        status: "action_required",
        currentStep: "computer",
        reason: "computer_offline",
        action: { kind: "open_section", section: "devices" },
        runId: "gsr_1",
        updatedAt: "2026-07-27T00:00:00Z",
        completedCount: 0,
        totalCount: 3,
        steps: [
          { key: "computer", state: "current" },
          { key: "workspace", state: "pending" },
          { key: "execution", state: "pending" },
        ],
      },
    });
    render(<GuidedSetupCard />);

    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Start setup" }));
    await screen.findByText("0/3");
    expect(stateMock.commandGuidedSetup).toHaveBeenCalledWith("start", null);
    expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop setup guide" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open connection help" }));
    expect(useUiStore.getState().section).toBe("devices");
  });

  it("resumes from durable completed facts after refresh without repeating them", () => {
    stateMock.useConsoleState.mockReturnValue({
      data: {
        guidedSetup: {
          version: 1,
          status: "login_required",
          currentStep: "execution",
          reason: "login_required",
          action: { kind: "open_section", section: "applications" },
          runId: "gsr_recovered",
          completedCount: 2,
          totalCount: 3,
          steps: [
            { key: "computer", state: "complete" },
            { key: "workspace", state: "complete" },
            { key: "execution", state: "current" },
          ],
        },
      },
      refetch: vi.fn(),
    });
    render(<GuidedSetupCard />);
    expect(screen.getByText("2/3")).toBeTruthy();
    expect(screen.getAllByText("Ready")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Continue sign-in" })).toBeTruthy();
  });

  it("cancels and resumes the guide without losing its run id", async () => {
    const active = {
      version: 1 as const,
      status: "action_required" as const,
      currentStep: "workspace" as const,
      reason: "workspace_missing",
      action: { kind: "open_section" as const, section: "projects" },
      runId: "gsr_resume",
      updatedAt: "2026-07-27T00:00:00Z",
      completedCount: 1,
      totalCount: 3,
      steps: [
        { key: "computer" as const, state: "complete" as const },
        { key: "workspace" as const, state: "current" as const },
        { key: "execution" as const, state: "pending" as const },
      ],
    };
    stateMock.useConsoleState.mockReturnValue({ data: { guidedSetup: active }, refetch: vi.fn() });
    stateMock.commandGuidedSetup
      .mockResolvedValueOnce({
        guidedSetup: {
          ...active,
          status: "cancelled",
          reason: "setup_cancelled",
          action: null,
          updatedAt: "2026-07-27T00:01:00Z",
          steps: [
            active.steps[0],
            { key: "workspace", state: "cancelled" },
            active.steps[2],
          ],
        },
      })
      .mockResolvedValueOnce({
        guidedSetup: { ...active, updatedAt: "2026-07-27T00:02:00Z" },
      });
    render(<GuidedSetupCard />);

    fireEvent.click(screen.getByRole("button", { name: "Stop setup guide" }));
    await screen.findByRole("button", { name: "Resume setup" });
    expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Resume setup" }));
    await waitFor(() => expect(stateMock.commandGuidedSetup).toHaveBeenLastCalledWith("resume", "gsr_resume"));
  });

  it.each([
    ["waiting_for_approval", "approval_required", "Review and approve"],
    ["installing", "install_in_progress", "View installation progress"],
    ["login_required", "login_required", "Continue sign-in"],
    ["failed", "install_failed", "Open recovery guidance"],
    ["cancelled", "install_cancelled", "Open installation recovery"],
  ] as const)("keeps one governed handoff for %s", (status, reason, actionLabel) => {
    stateMock.useConsoleState.mockReturnValue({
      data: {
        guidedSetup: {
          version: 1,
          status,
          currentStep: "execution",
          reason,
          action: { kind: "open_section", section: "applications" },
          runId: `gsr_${status}`,
          completedCount: 2,
          totalCount: 3,
          steps: [
            { key: "computer", state: "complete" },
            { key: "workspace", state: "complete" },
            { key: "execution", state: status === "failed" ? "failed" : status === "cancelled" ? "cancelled" : "current" },
          ],
        },
      },
      refetch: vi.fn(),
    });
    render(<GuidedSetupCard />);

    fireEvent.click(screen.getByRole("button", { name: actionLabel }));
    expect(useUiStore.getState().section).toBe("applications");
  });
});
