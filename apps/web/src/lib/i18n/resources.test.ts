import { describe, expect, it } from "vitest";
import { resources } from "@/lib/i18n/resources";
import { executionUiTranslations } from "@/lib/i18n/execution-ui-resources";
import { autoRunTranslations } from "@/lib/i18n/auto-run-resources";
import { workProfileTranslations } from "@/lib/i18n/work-profile-resources";
import { worktreeViewTranslations } from "@/lib/i18n/worktree-view-resources";
import { notificationCenterTranslations } from "@/components/layout/notification-center-copy";

function flatten(value: unknown, prefix = ""): Map<string, string> {
  const result = new Map<string, string>();
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") result.set(path, child);
    else resultForChild(child, path, result);
  }
  return result;
}

function resultForChild(value: unknown, prefix: string, target: Map<string, string>): void {
  for (const [key, child] of flatten(value, prefix)) target.set(key, child);
}

function variables(value: string): string[] {
  return [...value.matchAll(/{{\s*([^},\s]+).*?}}/g)].map((match) => match[1]).sort();
}

describe("translation resources", () => {
  it.each([
    ["executionUi", executionUiTranslations],
    ["autoRun", autoRunTranslations],
    ["workProfile", workProfileTranslations],
    ["worktreeView", worktreeViewTranslations],
    ["notificationCenter", notificationCenterTranslations],
  ])("keeps lazy %s resources complete and interpolation-compatible", (_name, translations) => {
    const english = flatten(translations["en-US"]);
    const chinese = flatten(translations["zh-CN"]);
    expect([...chinese.keys()].sort()).toEqual([...english.keys()].sort());
    for (const [key, value] of english) {
      const translated = chinese.get(key);
      expect(value.trim(), `${key} English`).not.toBe("");
      expect(translated?.trim(), `${key} Chinese`).not.toBe("");
      expect(variables(translated ?? ""), `${key} variables`).toEqual(variables(value));
    }
  });

  it("keeps both locales complete, non-empty, and interpolation-compatible", () => {
    const english = flatten(resources["en-US"].common);
    const chinese = flatten(resources["zh-CN"].common);
    expect([...chinese.keys()].sort()).toEqual([...english.keys()].sort());
    for (const [key, value] of english) {
      const translated = chinese.get(key);
      expect(value.trim(), `${key} English`).not.toBe("");
      expect(translated?.trim(), `${key} Chinese`).not.toBe("");
      expect(variables(translated ?? ""), `${key} variables`).toEqual(variables(value));
    }
  });

  it("uses the ordinary-user zh-CN glossary on the Epic entry surfaces", () => {
    const zh = resources["zh-CN"].common;
    expect(zh.dashboard.agent).toBe("任务助手");
    expect(zh.dashboard.runningIn).toContain("隔离工作区");
    expect(zh.dashboard.trace).toBe("追踪编号（Trace ID）");
    expect(zh.me.trace).toBe("运行记录");
    expect(zh.workBoard.channel).toBe("消息渠道");
    expect(notificationCenterTranslations["zh-CN"].status.updates).toBe("更新方式");
    expect(zh.shell.controlPlane).toBe("本地工作台");
    expect(zh.sessionHistory.title).toBe("任务记录");

    expect(zh.dashboard.cancel).toBe("取消任务");
    expect(zh.guidedSetup.actions.failed).toBe("打开恢复指引");
    expect(notificationCenterTranslations["zh-CN"].approvals).toBe("待审批");
    expect(zh.actionError.retry).toBe("重试");
  });

  it("does not expose unexplained architecture nouns on ordinary zh-CN surfaces", () => {
    const zh = resources["zh-CN"].common;
    const roots = ["todo", "me", "sessionHistory", "dashboard", "guidedSetup", "workBoard", "runRecords"] as const;
    const allowedTechnicalDetails = new Set(["dashboard.trace"]);
    const forbidden = /\b(?:Agent|Application|Channel|Desktop Bridge|Issue|PR|Worktree|Invocation)\b/;

    for (const root of roots) {
      for (const [key, value] of flatten(zh[root], root)) {
        if (allowedTechnicalDetails.has(key)) continue;
        expect(value, key).not.toMatch(forbidden);
      }
    }
    for (const [key, value] of flatten(notificationCenterTranslations["zh-CN"], "notificationCenter")) {
      expect(value, key).not.toMatch(forbidden);
    }
    for (const key of ["controlPlane", "navLabel", "footer"] as const) {
      expect(zh.shell[key], `shell.${key}`).not.toMatch(forbidden);
    }
  });
});
