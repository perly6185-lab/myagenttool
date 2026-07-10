import { describe, expect, it } from "vitest";
import { generateApplicationIntegrationDrafts } from "@/features/applications/application-draft-generator";
import type { ApplicationSnapshot } from "@/lib/console-state";

describe("generateApplicationIntegrationDrafts", () => {
  it("generates review-only MCP and manual drafts from a mixed integration brief", () => {
    const drafts = generateApplicationIntegrationDrafts(application({
      source: { type: "manual", uri: "manual://md" },
      integrationBrief: {
        version: "application-intake.v1",
        status: "draft",
        intent: "Render markdown previews.",
        sourceType: "mixed",
        discoverableCapabilities: ["render markdown", "list themes"],
        invokableCapabilities: ["render markdown"],
        fixedCommands: ["render_markdown", "list_themes"],
        dataBoundary: "Read markdown input and write preview evidence.",
        resultImport: "preview evidence record",
        smokeTests: ["register", "probe", "invoke"],
      },
    }));

    expect(drafts.available).toBe(true);
    expect(drafts.mcpDescriptor).toEqual(expect.objectContaining({
      transport: "stdio",
      command: "node",
      allowedTools: ["render_markdown", "list_themes"],
      filePolicy: "workspace_write",
      networkPolicy: "forbidden",
    }));
    expect(drafts.manualManifest?.capabilities).toEqual([
      expect.objectContaining({ id: "render-markdown", requiresApproval: true }),
      expect.objectContaining({ id: "list-themes", requiresApproval: false }),
    ]);
    expect(drafts.notes.join(" ")).toContain("register, probe, invoke");
    expect(drafts.reviewChecklist).toEqual(expect.arrayContaining([
      "Replace placeholder commands, args, cwd, URLs, and tool names before saving.",
      "Keep commands as draft until static review and local probe evidence are complete.",
    ]));
    expect(drafts.smokePlan).toEqual(["register", "probe", "invoke"]);
  });

  it("generates npm wrapper commands as draft and approval-required", () => {
    const drafts = generateApplicationIntegrationDrafts(application({
      source: { type: "npm", package: "report-tool", version: "1.0.0" },
      integrationBrief: {
        version: "application-intake.v1",
        status: "draft",
        intent: "Import daily reports.",
        sourceType: "npm",
        invokableCapabilities: ["daily report"],
        fixedCommands: ["daily"],
        dataBoundary: "Read local report input.",
      },
    }));

    expect(drafts.npmWrapper).toEqual(expect.objectContaining({
      mode: "installed-wrapper",
      installState: "unknown",
      packageManager: "npm",
    }));
    expect(drafts.npmWrapper?.commands).toEqual([
      expect.objectContaining({
        id: "daily",
        command: "daily",
        status: "draft",
        requiresApproval: true,
        filePolicy: "read_only",
      }),
      expect.objectContaining({
        id: "daily-report",
        command: "daily-report",
        status: "draft",
        requiresApproval: true,
      }),
    ]);
    expect(drafts.smokePlan).toEqual(expect.arrayContaining([
      "Save reviewed descriptors and run an Application probe.",
      "Inspect projected capabilities and confirm no raw command or adapter secret is exposed.",
    ]));
  });
});

function application(overrides: Partial<ApplicationSnapshot>): ApplicationSnapshot {
  return {
    id: "app_fixture",
    name: "Fixture",
    kind: "manual",
    source: { type: "manual", uri: "manual://fixture" },
    status: "registered",
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
    ...overrides,
  };
}
