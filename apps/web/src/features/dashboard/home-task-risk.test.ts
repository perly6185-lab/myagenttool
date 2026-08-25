import { describe, expect, it } from "vitest";
import { canStartLowRiskKnowledgeTaskDirectly } from "./home-task-risk";

describe("canStartLowRiskKnowledgeTaskDirectly", () => {
  it("starts reversible text work without a second confirmation", () => {
    expect(canStartLowRiskKnowledgeTaskDirectly({ goal: "把这篇内容改成两分钟口播稿" })).toBe(true);
    expect(canStartLowRiskKnowledgeTaskDirectly({ goal: "Give me five headline ideas for this article" })).toBe(true);
  });

  it("keeps review for external actions, mutations, attachments and ambiguous results", () => {
    expect(canStartLowRiskKnowledgeTaskDirectly({ goal: "写好后直接发布到公众号" })).toBe(false);
    expect(canStartLowRiskKnowledgeTaskDirectly({ goal: "分析并修改代码" })).toBe(false);
    expect(canStartLowRiskKnowledgeTaskDirectly({ goal: "总结附件", attachmentCount: 1 })).toBe(false);
    expect(canStartLowRiskKnowledgeTaskDirectly({ goal: "生成文章", templateMatch: { state: "ambiguous" } })).toBe(false);
  });
});
