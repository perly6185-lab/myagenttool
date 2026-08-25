import { homedir } from "node:os";
import { join } from "node:path";

export function resolveConfig(env = process.env, overrides = {}) {
  return {
    profileDir: overrides.profileDir ?? env.WECHAT_OFFICIAL_PROFILE_DIR ?? join(homedir(), ".myagenttool-wechat_official-profile"),
    channel: overrides.channel ?? env.WECHAT_OFFICIAL_BROWSER_CHANNEL ?? "auto",
    headless: overrides.headless ?? env.WECHAT_OFFICIAL_HEADLESS === "1",
    navigationTimeoutMs: boundedNumber(env.WECHAT_OFFICIAL_NAVIGATION_TIMEOUT_MS, 60_000, 10_000, 180_000),
    loginTimeoutMs: boundedNumber(env.WECHAT_OFFICIAL_LOGIN_TIMEOUT_MS, 330_000, 30_000, 600_000),
  };
}

function boundedNumber(value, fallback, min, max) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) && parsed >= min ? Math.min(parsed, max) : fallback;
}
