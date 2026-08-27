import { describe, expect, it } from "vitest";

import { hostDiagnosticPlan, hostDiagnosticPlanCopy, hostDiagnosticSummaryCopy, suggestHostDiagnostic } from "./host-assistant";

describe("host assistant safe suggestions", () => {
  it("maps ordinary language to a fixed read-only action", () => {
    expect(suggestHostDiagnostic("帮我看看磁盘还剩多少空间")?.action).toBe("disk_usage");
    expect(suggestHostDiagnostic("show memory usage")?.command).toBe("free -h");
    expect(suggestHostDiagnostic("哪些服务失败了")?.action).toBe("failed_services");
    expect(suggestHostDiagnostic("列出当前监听端口")?.action).toBe("listening_ports");
    expect(suggestHostDiagnostic("看看 Docker 容器")?.action).toBe("docker_status");
    expect(suggestHostDiagnostic("看看 nginx 服务运行状态")?.parameters).toEqual({ serviceName: "nginx" });
    expect(suggestHostDiagnostic("看看服务状态")).toBeNull();
  });

  it("does not turn arbitrary shell input into a command", () => {
    expect(suggestHostDiagnostic("删除 /tmp 下的文件 && whoami")).toBeNull();
    expect(suggestHostDiagnostic("show logs; cat /etc/passwd")).toBeNull();
  });

  it("keeps the command plan stable and reviewable", () => {
    expect(hostDiagnosticPlan("system_info")).toMatchObject({ action: "system_info", command: "uname -a" });
    expect(hostDiagnosticPlan("processes").command).toContain("head -n 15");
    expect(hostDiagnosticPlanCopy(hostDiagnosticPlan("disk_usage"), false)).toMatchObject({
      title: "Check device space",
      check: "remaining space and the highest usage level",
    });
  });

  it("turns stable summary codes into ordinary conclusions without trusting raw output", () => {
    expect(hostDiagnosticSummaryCopy({
      version: 1,
      severity: "critical",
      finding: "disk_capacity_critical",
      impact: "file_operations_may_fail",
      nextAction: "free_device_space",
      facts: [{ key: "disk_used_percent", value: "95%", severity: "critical" }],
    }, false)).toEqual({
      finding: "Device space is critically low",
      impact: "Uploading, saving, or publishing files may fail. Existing files were not cleaned up automatically.",
      nextAction: "Free device space, then check the target file before starting again.",
      facts: [{ key: "disk_used_percent", value: "95%", severity: "critical", label: "Highest storage use" }],
    });

    expect(hostDiagnosticSummaryCopy({ version: 1, severity: "unknown", finding: "future_private_code", impact: "future_impact", nextAction: "future_action", facts: [] }, false)).toMatchObject({
      finding: "The check result could not be assessed",
      impact: "The check did not change the device, but its impact still needs confirmation.",
    });
  });
});
