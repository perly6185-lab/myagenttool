import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/lib/i18n";
import type { ProjectSnapshot } from "@/lib/console-state";
import { ProjectSettingsForm } from "./project-settings-form";

const mocks = vi.hoisted(() => ({ updateProject: vi.fn() }));

vi.mock("@/data/use-console-actions", () => ({
  api: { updateProject: mocks.updateProject },
  useAsyncAction: () => ({
    pending: false,
    error: null,
    execute: async (action: () => Promise<unknown>) => { await action(); return true; },
  }),
}));

const project: ProjectSnapshot = {
  id: "prj_1",
  name: "Customer work",
  color: "#6366f1",
  ownerTeamId: "team_1",
  budgetPoolId: null,
  defaultAgentId: null,
  autoExecutionEnabled: false,
  futurePullForwardEnabled: true,
  status: "active",
  isolation: "shared",
  createdAt: "2026-08-08T00:00:00.000Z",
};

beforeEach(async () => {
  await i18n.changeLanguage("en-US");
  mocks.updateProject.mockResolvedValue({ project });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProjectSettingsForm", () => {
  it("offers two plain-language automatic-work controls and saves both", async () => {
    render(<ProjectSettingsForm project={project} />);

    const automatic = screen.getByRole("checkbox", { name: /process project tasks automatically/i });
    const pullForward = screen.getByRole("checkbox", { name: /pull future work forward/i });
    expect((pullForward as HTMLInputElement).disabled).toBe(true);

    fireEvent.click(automatic);
    expect((pullForward as HTMLInputElement).disabled).toBe(false);
    fireEvent.click(pullForward);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(mocks.updateProject).toHaveBeenCalledWith("prj_1", expect.objectContaining({
      autoExecutionEnabled: true,
      futurePullForwardEnabled: false,
    })));
  });
});
