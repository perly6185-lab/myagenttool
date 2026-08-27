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
    expect(summary.origin).toEqual({ label: "手工创建", kind: "manual" });
    expect(summary.method).toEqual({ name: "客户跟进更新", expectedOutput: "已更新的客户台账", kind: "template" });
    expect(summary.materials).toEqual([
      { id: "asset_1", title: "联系结果.xlsx", source: "本地文件", role: "必须使用" },
      { id: "content_1", title: "客户跟进规则", source: "我的资料", role: "参考" },
      { id: "resource_1", title: "CRM 客户表", source: "远程资料", role: "参考" },
    ]);
    expect(summary.delivery).toEqual({ label: "当前任务", destination: "task" });
    expect(summary.repository).toEqual({ name: "客户运营", path: "/work/customer-ops" });
    expect(summary.acceptanceCriteria).toEqual(["三条记录状态正确"]);
    expect(summary.verificationSteps).toEqual(["检查变更记录数量和状态字段"]);
  });

  it("uses the server task context projection for Channel source, method, materials, and destination", () => {
    const item = {
      title: "整理供应商报价",
      acceptanceCriteria: ["生成比价表"],
      verificationSop: ["核对供应商数量"],
      taskContextSummary: {
        schemaVersion: 1,
        origin: { kind: "channel", label: "采购协作", provider: "wechat_ilink", channelId: "chn_1", conversationId: "conv_1", threadId: "cth_1", sourceMessageCount: 1 },
        method: { kind: "template", name: "报价整理", definitionId: "rtd_1", familyId: "rtf_1", version: 2, expectedOutput: "比价表.xlsx", snapshotHash: "hash" },
        materials: [{ id: "asset_1", title: "报价单.xlsx", role: "required_input", source: "channel_attachment", locality: "local", availability: "ready", versionPolicy: "pinned" }],
        delivery: { destination: "channel", label: "采购协作", channelId: "chn_1", conversationId: "conv_1", status: null },
      },
    } as unknown as LocalWorkItem;

    const summary = deriveExecutionStartSummary({ item, project: null, readiness: { ready: true, checks: [] }, language: "zh" });

    expect(summary.origin).toEqual({ label: "采购协作", kind: "channel" });
    expect(summary.method).toEqual({ name: "报价整理", expectedOutput: "比价表.xlsx", kind: "template" });
    expect(summary.materials).toEqual([{ id: "asset_1", title: "报价单.xlsx", source: "Channel 附件", role: "必须使用" }]);
    expect(summary.delivery).toEqual({ label: "采购协作", destination: "channel" });
    expect(summary.issues).toContainEqual(expect.objectContaining({ code: "delivery:channel", severity: "notice" }));
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
    expect(summary.issues).toContainEqual(expect.objectContaining({ code: "readiness:verify", severity: "warning" }));
    expect(summary.issues).toContainEqual(expect.objectContaining({ code: "materials:not_ready", severity: "blocking" }));
    expect(summary.boundary).toContain("only starts AI");
  });

  it("blocks an unconfirmed method and highlights writable materials separately", () => {
    const item = {
      title: "更新供应商台账",
      acceptanceCriteria: ["状态已更新"],
      verificationSop: ["核对变更记录"],
      taskContextSummary: {
        schemaVersion: 1,
        origin: { kind: "manual", label: "manual", provider: null, channelId: null, conversationId: null, threadId: null, sourceMessageCount: 0 },
        method: { kind: "custom", name: "处理方式待确认", definitionId: null, familyId: null, version: null, expectedOutput: null, snapshotHash: null },
        materials: [{ id: "resource_1", title: "供应商台账", role: "change_target", source: "remote_resource", locality: "remote", availability: "selected", versionPolicy: "pinned" }],
        delivery: { destination: "task", label: "task", channelId: null, conversationId: null, status: null },
      },
    } as unknown as LocalWorkItem;

    const summary = deriveExecutionStartSummary({ item, project: null, readiness: { ready: true, checks: [] }, language: "zh" });

    expect(summary.issues).toContainEqual(expect.objectContaining({ code: "method:needs_confirmation", severity: "blocking" }));
    expect(summary.issues).toContainEqual(expect.objectContaining({ code: "materials:change_targets", severity: "warning" }));
  });
});
