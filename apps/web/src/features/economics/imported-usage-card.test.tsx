import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const stateMock = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock("@/data/use-console-state", () => ({ useConsoleState: () => stateMock }));

const actionMock = vi.hoisted(() => ({
  execute: vi.fn((fn: () => unknown) => fn()),
  createAutomation: vi.fn((_payload?: Record<string, unknown>) => Promise.resolve({})),
  deleteAutomation: vi.fn((_id?: string) => Promise.resolve({})),
}));
vi.mock("@/data/use-console-actions", () => ({
  useAsyncAction: () => ({ execute: actionMock.execute, pending: false, error: null }),
  api: { createAutomation: actionMock.createAutomation, deleteAutomation: actionMock.deleteAutomation },
}));

import { ImportedUsageCard } from "@/features/economics/imported-usage-card";

const CAP = "app.app_ccusage.wrapper.daily";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const row = (over: Record<string, unknown>) => ({
  id: "ccu_x", source: "ccusage", provider: "anthropic", model: "claude-opus",
  date: "2026-07-11", inputTokens: 100, outputTokens: 50, totalTokens: 150,
  estimatedCostUsd: 0.5, currency: "USD", authoritative: false, createdAt: "2026-07-11T09:00:00.000Z",
  ...over,
});

describe("ImportedUsageCard", () => {
  it("shows a last-imported freshness label from the newest row", () => {
    stateMock.data = {
      currentProjectId: "prj", automations: [],
      importedUsageEstimates: [
        row({ id: "ccu_1", createdAt: "2026-07-10T09:00:00.000Z" }),
        row({ id: "ccu_2", createdAt: "2026-07-11T14:30:00.000Z", estimatedCostUsd: 1.2 }),
      ],
    };
    render(createElement(ImportedUsageCard));
    expect(screen.getByText(/last imported/)).toBeTruthy();
  });

  it("shows the empty state (and no freshness label) with no estimates", () => {
    stateMock.data = { currentProjectId: "prj", automations: [], importedUsageEstimates: [] };
    render(createElement(ImportedUsageCard));
    expect(screen.getByText("No imported usage yet")).toBeTruthy();
    expect(screen.queryByText(/last imported/)).toBeNull();
  });

  it("enabling schedules a daily ccusage capability automation", () => {
    stateMock.data = { currentProjectId: "prj", automations: [], importedUsageEstimates: [] };
    render(createElement(ImportedUsageCard));
    fireEvent.click(screen.getByRole("button", { name: /Enable daily auto-import/i }));
    expect(actionMock.createAutomation).toHaveBeenCalledTimes(1);
    const payload = actionMock.createAutomation.mock.calls[0][0] as Record<string, any>;
    expect(payload.projectId).toBe("prj");
    expect(payload.schedule.kind).toBe("daily");
    expect(payload.target).toEqual({ kind: "capability", capability: CAP });
  });

  it("disabling removes the existing ccusage automation", () => {
    stateMock.data = {
      currentProjectId: "prj",
      automations: [{ id: "atm_1", target: { kind: "capability", capability: CAP } }],
      importedUsageEstimates: [],
    };
    render(createElement(ImportedUsageCard));
    fireEvent.click(screen.getByRole("button", { name: /Auto-import daily: on/i }));
    expect(actionMock.deleteAutomation).toHaveBeenCalledWith("atm_1");
  });

  it("the toggle is disabled when there is no current project to attach to", () => {
    stateMock.data = { currentProjectId: null, automations: [], importedUsageEstimates: [] };
    render(createElement(ImportedUsageCard));
    expect(screen.getByRole("button", { name: /Enable daily auto-import/i })).toHaveProperty("disabled", true);
  });
});
