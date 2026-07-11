import { describe, expect, it } from "vitest";
import {
  applicationOpsBadges,
  autoRecoveryConfirmCopy,
  healthProbeConfirmCopy,
} from "@/features/applications/application-ops-ui";
import type { ApplicationSnapshot } from "@/lib/console-state";

const app = (over: Partial<ApplicationSnapshot> = {}): ApplicationSnapshot => ({
  id: "app_1",
  name: "demo",
  kind: "repository",
  source: { type: "local", path: "/x" },
  status: "active",
  ...over,
});

describe("confirm copy derives from the application's actual config", () => {
  it("enable copy uses the default cap when unconfigured, the stored cap when set", () => {
    expect(autoRecoveryConfirmCopy(app(), { enabled: true }).description).toMatch(/capped at 2/);
    expect(
      autoRecoveryConfirmCopy(app({ autoRecovery: { enabled: false, maxAttempts: 4 } }), { enabled: true }).description,
    ).toMatch(/capped at 4/);
  });

  it("changing the cap on an enabled app reads as a change, not an enable", () => {
    const copy = autoRecoveryConfirmCopy(app({ autoRecovery: { enabled: true, maxAttempts: 2 } }), { enabled: true, maxAttempts: 5 });
    expect(copy.title).toMatch(/Change auto-recovery cap/);
    expect(copy.confirmLabel).toBe("Set cap to 5");
    expect(copy.description).toMatch(/capped at 5/);
    expect(copy.destructive).toBe(false); // already enabled — adjusting is not a new grant
  });

  it("health-probe copy carries the interval that will actually be set", () => {
    expect(healthProbeConfirmCopy(app(), { enabled: true }).description).toMatch(/every 5 minute/);
    const copy = healthProbeConfirmCopy(app({ healthProbe: { enabled: true, intervalMinutes: 5 } }), { enabled: true, intervalMinutes: 30 });
    expect(copy.confirmLabel).toBe("Set interval to 30m");
    expect(copy.description).toMatch(/every 30 minute/);
  });

  it("disable copy never mentions numbers that no longer apply", () => {
    expect(autoRecoveryConfirmCopy(app({ autoRecovery: { enabled: true, maxAttempts: 4 } }), { enabled: false }).description).not.toMatch(/4/);
    expect(healthProbeConfirmCopy(app({ healthProbe: { enabled: true, intervalMinutes: 30 } }), { enabled: false }).description).not.toMatch(/30/);
  });
});

describe("applicationOpsBadges", () => {
  it("no config, no health → no badges", () => {
    expect(applicationOpsBadges(app())).toEqual([]);
  });

  it("health verdict maps to tone; enabled autonomy features get badges", () => {
    const badges = applicationOpsBadges(app({
      health: { status: "unhealthy", reason: "path gone" },
      autoRecovery: { enabled: true, maxAttempts: 2 },
      healthProbe: { enabled: true, intervalMinutes: 5 },
    }));
    expect(badges).toEqual([
      { label: "health unhealthy", tone: "danger" },
      { label: "auto-recovery", tone: "warning" },
      { label: "health probe", tone: "warning" },
    ]);
    expect(applicationOpsBadges(app({ health: { status: "healthy" } }))[0]).toEqual({ label: "health healthy", tone: "success" });
    expect(applicationOpsBadges(app({ health: { status: "unsupported" } }))[0]).toEqual({ label: "health unsupported", tone: "neutral" });
  });

  it("disabled features never earn a badge", () => {
    expect(applicationOpsBadges(app({ autoRecovery: { enabled: false }, healthProbe: { enabled: false } }))).toEqual([]);
  });
});
