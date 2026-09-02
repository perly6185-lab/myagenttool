import { describe, expect, it } from "vitest";
import type { ProjectSnapshot } from "@/lib/console-state";
import type { LocalWorkItem } from "./task-view-types";
import { deriveExecutionStartSummary } from "./execution-start-summary";

function intentContract(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    snapshotKind: "current",
    workItemId: "wi_1",
    goal: "按已确认范围分析客户资料",
    taskKind: "business_research",
    action: { accessMode: "read_only", operation: "query_data", forbiddenActions: ["modify"] },
    expectedOutput: "客户分析.md",
    method: { kind: "custom", definitionId: null, familyId: null, version: null, name: "已确认分析方案" },
    materials: {
      inputCount: 1,
      inputs: [{ id: "content_frozen", title: "已确认客户资料", purpose: "required_input", locality: "local", version: 3, fingerprint: "sha256:frozen" }],
      changeTargets: [],
    },
    delivery: { destination: "task", platformId: null, platformLabel: null },
    sources: { goal: "current_user", action: "current_user", expectedOutput: "task_definition", method: "safe_default", materials: "confirmed_task_context", delivery: "safe_default" },
    acceptanceCriteria: ["结论引用已确认资料"],
    verificationSop: ["核对引用来源"],
    conflicts: [],
    missing: [],
    resolutions: [],
    clarification: null,
    status: "ready",
    digest: "a".repeat(64),
    ...overrides,
  };
}

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
        materials: [{ id: "asset_1", title: "报价单.xlsx", role: "required_input", allowedRoles: ["required_input"], source: "channel_attachment", locality: "local", availability: "ready", versionPolicy: "pinned" }],
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
        materials: [{ id: "resource_1", title: "供应商台账", role: "change_target", allowedRoles: ["change_target"], source: "remote_resource", locality: "remote", availability: "selected", versionPolicy: "pinned" }],
        delivery: { destination: "task", label: "task", channelId: null, conversationId: null, status: null },
      },
    } as unknown as LocalWorkItem;

    const summary = deriveExecutionStartSummary({ item, project: null, readiness: { ready: true, checks: [] }, language: "zh" });

    expect(summary.issues).toContainEqual(expect.objectContaining({ code: "method:needs_confirmation", severity: "blocking" }));
    expect(summary.issues).toContainEqual(expect.objectContaining({ code: "materials:change_targets", severity: "warning" }));
  });

  it("projects one key intent clarification without hiding the conflict evidence", () => {
    const item = {
      title: "只读分析客户台账",
      acceptanceCriteria: ["给出分析结论"],
      verificationSop: ["核对分析范围"],
      intentContract: {
        clarification: {
          code: "read_only_with_change_targets",
          question: "这次只读取并分析，还是允许修改这些资料？",
          resolution: "task_context",
        },
      },
    } as unknown as LocalWorkItem;

    const summary = deriveExecutionStartSummary({ item, project: null, readiness: { ready: true, checks: [] }, language: "zh" });

    expect(summary.issues).toContainEqual(expect.objectContaining({
      code: "intent:read_only_with_change_targets",
      severity: "blocking",
    }));
    expect(summary.clarification).toEqual({
      code: "read_only_with_change_targets",
      question: "这次只读取并分析，还是允许修改这些资料？",
      reason: null,
      recommendation: null,
      options: [],
      targetFields: [],
      resolution: "task_context",
    });
  });

  it("localizes structured clarification choices with recommendation, impact, and controlled targets", () => {
    const item = {
      title: "修改客户台账",
      intentContract: intentContract({
        status: "needs_clarification",
        clarification: {
          code: "write_request_exceeds_confirmed_boundary",
          question: "这次继续只读处理，还是明确扩大为允许产生变更？",
          questionCopy: { zh: "这次继续只读处理，还是明确扩大为允许产生变更？", en: "Keep this run read-only or allow changes?" },
          reason: { zh: "任务要求产生变更，但确认边界是只读。", en: "The task asks for changes, but its confirmed boundary is read-only." },
          recommendation: { zh: "不需要实际改动时保持只读。", en: "Keep it read-only unless actual changes are needed." },
          options: [{
            id: "keep_read_only",
            label: { zh: "保持只读", en: "Keep read-only" },
            description: { zh: "只给出建议。", en: "Provide recommendations only." },
            impact: { zh: "不扩大权限。", en: "Does not expand permission." },
            recommended: true,
            applyMode: "automatic",
            targetFields: ["action.accessMode", "action.operation"],
          }],
          targetFields: ["action.accessMode", "action.operation"],
          resolution: "task_definition",
        },
      }),
    } as unknown as LocalWorkItem;

    const summary = deriveExecutionStartSummary({ item, project: null, readiness: { ready: true, checks: [] }, language: "en" });

    expect(summary.clarification).toEqual({
      code: "write_request_exceeds_confirmed_boundary",
      question: "Keep this run read-only or allow changes?",
      reason: "The task asks for changes, but its confirmed boundary is read-only.",
      recommendation: "Keep it read-only unless actual changes are needed.",
      options: [{
        id: "keep_read_only",
        label: "Keep read-only",
        description: "Provide recommendations only.",
        impact: "Does not expand permission.",
        recommended: true,
        applyMode: "automatic",
        targetFields: ["action.accessMode", "action.operation"],
      }],
      targetFields: ["action.accessMode", "action.operation"],
      resolution: "task_definition",
    });
  });

  it("allows a changed intent to be reconfirmed while explaining the stale confirmation", () => {
    const item = {
      title: "更新客户台账",
      acceptanceCriteria: ["状态正确"],
      verificationSop: ["核对变更"],
      executionContractGate: {
        ready: false,
        missing: ["intent_changed"],
        source: "manual",
        confirmedAt: "2026-08-27T08:00:00.000Z",
        intentChanged: true,
      },
    } as unknown as LocalWorkItem;

    const summary = deriveExecutionStartSummary({ item, project: null, readiness: { ready: true, checks: [] }, language: "zh" });

    expect(summary.issues).toContainEqual(expect.objectContaining({
      code: "intent:confirmation_stale",
      severity: "warning",
    }));
    expect(summary.clarification).toBeNull();
  });

  it("uses a v2 intent contract instead of conflicting mutable task fields", () => {
    const item = {
      title: "后来改过的标题",
      intentStatement: "后来改过的目标",
      acceptanceCriteria: ["后来改过的标准"],
      verificationSop: ["后来改过的检查"],
      localContentRefs: [{ id: "content_current", title: "当前但未确认的资料" }],
      intentContract: intentContract(),
    } as unknown as LocalWorkItem;

    const summary = deriveExecutionStartSummary({ item, project: null, readiness: { ready: true, checks: [] }, language: "zh" });

    expect(summary.goal).toBe("按已确认范围分析客户资料");
    expect(summary.acceptanceCriteria).toEqual(["结论引用已确认资料"]);
    expect(summary.verificationSteps).toEqual(["核对引用来源"]);
    expect(summary.materials).toEqual([
      { id: "content_frozen", title: "已确认客户资料", source: "本地资料", role: "必须使用" },
    ]);
    expect(summary.method).toEqual({ name: "已确认分析方案", expectedOutput: "客户分析.md", kind: "custom" });
  });

  it("labels an execution snapshot as frozen and fails closed for an unknown contract version", () => {
    const frozen = deriveExecutionStartSummary({
      item: { title: "分析资料", intentContract: intentContract({ snapshotKind: "execution_snapshot" }) } as unknown as LocalWorkItem,
      project: null,
      readiness: { ready: true, checks: [] },
      language: "en",
    });
    const future = deriveExecutionStartSummary({
      item: { title: "Future task", acceptanceCriteria: ["Done"], verificationSop: ["Check"], intentContract: { schemaVersion: 99, status: "ready" } } as unknown as LocalWorkItem,
      project: null,
      readiness: { ready: true, checks: [] },
      language: "en",
    });

    expect(frozen.boundary).toContain("frozen for this run");
    expect(future.issues).toContainEqual(expect.objectContaining({
      code: "intent:contract_not_understood",
      severity: "blocking",
    }));
  });
});
