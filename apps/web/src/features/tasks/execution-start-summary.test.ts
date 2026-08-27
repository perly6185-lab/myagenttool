import { describe, expect, it } from "vitest";
import type { ProjectSnapshot } from "@/lib/console-state";
import type { LocalWorkItem } from "./task-view-types";
import { deriveExecutionStartSummary } from "./execution-start-summary";

describe("execution start summary", () => {
  it("explains the task, reusable method, materials, repository, and checks separately", () => {
    const item = {
      title: "更新客户台账",
      intentStatement: "把待跟进客户改为已联系",
      acceptanceCriteria: ["三条记录状态正确"],
      verificationSop: ["检查变更记录数量和状态字段"],
      inputAssets: [{ id: "asset_1", originalName: "联系结果.xlsx", path: "/tmp/联系结果.xlsx" }],
      localContentRefs: [{ id: "content_1", title: "客户跟进规则" }],
      taskResourceRefs: [{ id: "resource_1", title: "CRM 客户表", locality: "remote" }],
      recordBindings: [],
      myTemplateBinding: { name: "客户跟进更新", expectedOutput: "已更新的客户台账" },
    } as unknown as LocalWorkItem;
    const project = {
      id: "prj_1",
      name: "客户运营",
      path: "/work/customer-ops",
    } as ProjectSnapshot;

    const summary = deriveExecutionStartSummary({ item, project, readiness: { ready: true, checks: [] }, language: "zh" });

    expect(summary.goal).toBe("把待跟进客户改为已联系");
    expect(summary.template).toEqual({ name: "客户跟进更新", expectedOutput: "已更新的客户台账" });
    expect(summary.materials).toEqual([
      { id: "asset_1", title: "联系结果.xlsx", source: "本地文件" },
      { id: "content_1", title: "客户跟进规则", source: "我的资料" },
      { id: "resource_1", title: "CRM 客户表", source: "远程资料" },
    ]);
    expect(summary.repository).toEqual({ name: "客户运营", path: "/work/customer-ops" });
    expect(summary.acceptanceCriteria).toEqual(["三条记录状态正确"]);
    expect(summary.verificationSteps).toEqual(["检查变更记录数量和状态字段"]);
  });

  it("surfaces readiness warnings and changed records as risks", () => {
    const item = {
      title: "Prepare release",
      acceptanceCriteria: ["Release notes exist"],
      verificationSop: ["Run the release check"],
      recordBindings: [{
        id: "binding_1",
        record: { title: "Release ledger" },
        resolution: { state: "stale" },
      }],
    } as unknown as LocalWorkItem;

    const summary = deriveExecutionStartSummary({
      item,
      project: null,
      readiness: {
        ready: true,
        checks: [{ key: "verify", label: "Verification", status: "warn", detail: "No verify command is configured." }],
      },
      language: "en",
    });

    expect(summary.risks).toContain("No verify command is configured.");
    expect(summary.risks).toContain("1 business material(s) are not ready and must be refreshed or selected again.");
    expect(summary.boundary).toContain("only starts AI");
  });
});
