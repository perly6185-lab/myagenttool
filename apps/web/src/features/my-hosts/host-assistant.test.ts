import { describe, expect, it } from "vitest";

import { hostDiagnosticPlan, suggestHostDiagnostic } from "./host-assistant";

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
  });

  it("keeps the command plan stable and reviewable", () => {
    expect(hostDiagnosticPlan("system_info")).toMatchObject({ action: "system_info", command: "uname -a" });
    expect(hostDiagnosticPlan("processes").command).toContain("head -n 15");
  });
});
