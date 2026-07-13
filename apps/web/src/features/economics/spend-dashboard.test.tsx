import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { SpendDashboard, dailySpend, topSpend } from "@/features/economics/spend-dashboard";
import type { LedgerEntry, LedgerSummary } from "@/lib/console-state";

afterEach(cleanup);

describe("dailySpend", () => {
  it("sums billable USD per UTC day, oldest→newest, skipping non-positive/undated", () => {
    const entries = [
      { amountUsd: 1, createdAt: "2026-07-10T01:00:00Z" },
      { amountUsd: 2, createdAt: "2026-07-10T20:00:00Z" },
      { amountUsd: 3, createdAt: "2026-07-11T00:00:00Z" },
      { amountUsd: -5, createdAt: "2026-07-11T02:00:00Z" }, // negative → skipped
      { amountUsd: null, createdAt: "2026-07-12T00:00:00Z" }, // no amount → skipped
    ] as unknown as LedgerEntry[];
    expect(dailySpend(entries)).toEqual([
      { date: "2026-07-10", usd: 3 },
      { date: "2026-07-11", usd: 3 },
    ]);
  });
});

describe("topSpend", () => {
  it("ranks by known+estimated USD descending, drops zero rows", () => {
    const rows = [
      { agentName: "a", knownCostUsd: 2, estimatedCostUsd: 1 },
      { agentName: "b", knownCostUsd: 5 },
      { agentName: "c", knownCostUsd: 0, estimatedCostUsd: 0 },
    ];
    expect(topSpend(rows, (r) => String(r.agentName))).toEqual([
      { label: "b", usd: 5 },
      { label: "a", usd: 3 },
    ]);
  });
});

describe("SpendDashboard", () => {
  it("renders the trend and breakdowns from ledger data", () => {
    const summary = { byAgent: [{ agentId: "agt_x", agentName: "Reviewer", knownCostUsd: 5 }], byProject: [] } as unknown as LedgerSummary;
    const entries = [{ amountUsd: 2, createdAt: "2026-07-10T00:00:00Z" }] as unknown as LedgerEntry[];
    render(createElement(SpendDashboard, { summary, entries }));
    expect(screen.getByText("Spend dashboard")).toBeTruthy();
    expect(screen.getByText("Top agents")).toBeTruthy();
    expect(screen.getByText("Reviewer")).toBeTruthy();
  });

  it("shows an empty state when there is no spend", () => {
    render(createElement(SpendDashboard, { summary: undefined, entries: [] }));
    expect(screen.getByText("No spend yet")).toBeTruthy();
  });
});
