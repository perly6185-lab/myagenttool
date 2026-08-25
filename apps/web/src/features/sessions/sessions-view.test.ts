import { describe, expect, it } from "vitest";
import { wechatConnectionState, type SessionCard } from "./sessions-view";

function session(overrides: Partial<SessionCard> = {}): SessionCard {
  return {
    site: "wechat_official",
    displayName: "微信公众号",
    authMethod: "persistent_profile",
    heartbeatTier: "manual",
    heartbeatIntervalMinutes: null,
    profileDir: "/tmp/profile",
    status: "unknown",
    lastProbeAt: null,
    lastProbeOk: null,
    lastReauthAt: null,
    detail: "Never probed.",
    ...overrides,
  };
}

describe("wechatConnectionState", () => {
  it("distinguishes unavailable, unregistered, registered and ready states", () => {
    expect(wechatConnectionState(session({ runtimeAvailable: false }))).toBe("unavailable");
    expect(wechatConnectionState(session({ runtimeAvailable: true }))).toBe("not_registered");
    expect(wechatConnectionState(session({ runtimeAvailable: true, connection: {
      registered: true, ready: false, applicationStatus: "offline", agentStatus: "unknown",
    } }))).toBe("registered");
    expect(wechatConnectionState(session({ runtimeAvailable: true, connection: {
      registered: true, ready: true, applicationStatus: "active", agentStatus: "unknown",
    } }))).toBe("needs_login");
    expect(wechatConnectionState(session({ status: "active", runtimeAvailable: true, connection: {
      registered: true, ready: true, applicationStatus: "active", agentStatus: "unknown",
    } }))).toBe("ready");
  });

  it("does not apply to ordinary read-only site sessions", () => {
    expect(wechatConnectionState(session({ site: "zhihu" }))).toBeNull();
  });
});
