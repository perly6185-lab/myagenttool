import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const stateMock = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock("@/data/use-console-state", () => ({ useConsoleState: () => stateMock }));

import { ImportedUsageCard } from "@/features/economics/imported-usage-card";

afterEach(cleanup);

const row = (over: Record<string, unknown>) => ({
  id: "ccu_x", source: "ccusage", provider: "anthropic", model: "claude-opus",
  date: "2026-07-11", inputTokens: 100, outputTokens: 50, totalTokens: 150,
  estimatedCostUsd: 0.5, currency: "USD", authoritative: false, createdAt: "2026-07-11T09:00:00.000Z",
  ...over,
});

describe("ImportedUsageCard", () => {
  it("shows a last-imported freshness label from the newest row", () => {
    stateMock.data = {
      importedUsageEstimates: [
        row({ id: "ccu_1", createdAt: "2026-07-10T09:00:00.000Z" }),
        row({ id: "ccu_2", createdAt: "2026-07-11T14:30:00.000Z", estimatedCostUsd: 1.2 }),
      ],
    };
    render(createElement(ImportedUsageCard));
    expect(screen.getByText(/last imported/)).toBeTruthy();
    expect(screen.getByText(/row\(s\)/)).toBeTruthy();
  });

  it("shows the empty state (and no freshness label) with no estimates", () => {
    stateMock.data = { importedUsageEstimates: [] };
    render(createElement(ImportedUsageCard));
    expect(screen.getByText("No imported usage yet")).toBeTruthy();
    expect(screen.queryByText(/last imported/)).toBeNull();
  });
});
