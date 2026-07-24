import { describe, expect, it } from "vitest";
import {
  parsePlanningProjectSnapshot,
  planningExportFilename,
  planningProjectCsv,
  planningProjectJson,
} from "./planning-export";

const project = {
  id: "ppj_1",
  name: "Q3 Release",
  description: "Ship",
  ownerId: "usr_release",
  capacityPoints: 34,
  startDate: "2026-07-01",
  targetDate: "2026-09-30",
  status: "on_hold" as const,
  tags: ["release", "backend"],
  statusSummary: "Ready for rollout",
  checkIns: [{ id: "ppc_1", summary: "Ready for rollout", authorId: "usr_a", createdAt: "2026-07-24T00:00:00.000Z" }],
  revision: 4,
  savedViews: [{ name: "Risks" }],
  automationRules: [{ priority: "p0" }],
  items: [{
    workItem: {
      id: "lwi_1", localRef: "LOCAL-1", title: "Fix, verify", body: "Line 1\nLine 2",
      type: "bug", status: "ready", priority: "p0", milestone: "M3", dueDate: "2026-08-01",
      labels: ["release", "backend"], assigneeIds: ["usr_a"], dependencyIds: ["lwi_0"],
    },
  }],
};

describe("planning export", () => {
  it("produces escaped CSV with planning fields", () => {
    const csv = planningProjectCsv(project);
    expect(csv).toContain('"Fix, verify"');
    expect(csv).toContain('"Line 1\nLine 2"');
    expect(csv).toContain("release|backend");
  });

  it("produces a versioned JSON snapshot and safe filename", () => {
    const json = JSON.parse(planningProjectJson(project, "2026-07-24T00:00:00.000Z"));
    expect(json.schemaVersion).toBe(1);
    expect(json.project.savedViews[0].name).toBe("Risks");
    expect(json.project.ownerId).toBe("usr_release");
    expect(json.project.checkIns[0].summary).toBe("Ready for rollout");
    expect(json.workItems[0].dependencyIds).toEqual(["lwi_0"]);
    expect(planningExportFilename(project.name, "json")).toBe("q3-release.json");
  });

  it("validates an exported snapshot for template import", () => {
    const imported = parsePlanningProjectSnapshot(planningProjectJson(project, "2026-07-24T00:00:00.000Z"));
    expect(imported.name).toBe("Q3 Release");
    expect(imported.savedViews).toHaveLength(1);
    expect(imported).toMatchObject({
      ownerId: "usr_release", capacityPoints: 34,
      startDate: "2026-07-01", targetDate: "2026-09-30",
      status: "on_hold",
      tags: ["release", "backend"],
      statusSummary: "Ready for rollout",
    });
    expect(imported.workItemCount).toBe(1);
    expect(() => parsePlanningProjectSnapshot('{"schemaVersion":2,"project":{}}')).toThrow(/Unsupported/);
  });
});
