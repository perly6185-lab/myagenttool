import { describe, expect, it } from "vitest";
import { descriptorRiskPreview } from "@/features/applications/descriptor-utils";
import type { ApplicationSnapshot } from "@/lib/console-state";

describe("descriptorRiskPreview", () => {
  it("summarizes npm wrapper approval, projection, and policy consent risk", () => {
    const preview = descriptorRiskPreview(application({
      source: { type: "npm", package: "report-tool" },
    }), {
      wrapperDescriptor: JSON.stringify({
        mode: "installed-wrapper",
        commands: [{
          id: "daily",
          displayName: "Daily",
          status: "approved",
          riskLevel: "low",
          requiresApproval: false,
          filePolicy: "read_only",
          networkPolicy: "forbidden",
        }, {
          id: "deploy",
          displayName: "Deploy",
          status: "approved",
          riskLevel: "high",
          requiresApproval: true,
          filePolicy: "workspace_write",
          networkPolicy: "network",
        }, {
          id: "draft",
          status: "draft",
        }],
      }),
    });

    expect(preview.projectedCount).toBe(2);
    expect(preview.draftCount).toBe(1);
    expect(preview.approvalCount).toBe(2);
    expect(preview.policyConsentCount).toBe(1);
    expect(preview.highRiskCount).toBe(1);
    expect(preview.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Daily", projectedCapability: true, needsPolicyConsent: false }),
      expect.objectContaining({ label: "Deploy", projectedCapability: true, needsPolicyConsent: true }),
      expect.objectContaining({ label: "draft", projectedCapability: false, status: "draft" }),
    ]));
  });

  it("summarizes MCP and manual manifest descriptors conservatively", () => {
    const preview = descriptorRiskPreview(application({
      source: { type: "manual", uri: "manual://fixture" },
    }), {
      mcpDescriptor: JSON.stringify({
        transport: "http",
        url: "https://example.test/mcp",
        allowedTools: ["render_markdown"],
      }),
      manualManifest: JSON.stringify({
        capabilities: [{ id: "render", displayName: "Render", requiresApproval: true }],
      }),
    });

    expect(preview.projectedCount).toBe(1);
    expect(preview.draftCount).toBe(1);
    expect(preview.approvalCount).toBe(2);
    expect(preview.highRiskCount).toBe(1);
    expect(preview.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "render_markdown", surface: "mcp", networkPolicy: "restricted" }),
      expect.objectContaining({ label: "Render", surface: "manual_manifest", status: "candidate" }),
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
