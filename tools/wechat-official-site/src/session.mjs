import { openContext } from "../../session-engine/src/launch.mjs";
import { SITE } from "./site.mjs";

export async function probeWechatOfficialSession({ config, open = openContext } = {}) {
  const browser = await open({ ...config, headless: true });
  try {
    await browser.page.goto(SITE.homeUrl, { waitUntil: "domcontentloaded", timeout: config.navigationTimeoutMs });
    const loggedIn = await hasLoginMarker(browser.page);
    return {
      ok: true,
      loggedIn,
      detail: loggedIn ? "公众号后台登录状态有效" : "公众号后台需要扫码登录",
    };
  } finally {
    await browser.close();
  }
}

export async function loginWechatOfficialProfile({ config, open = openContext } = {}) {
  const browser = await open({ ...config, headless: false });
  try {
    await browser.page.goto(SITE.homeUrl, { waitUntil: "domcontentloaded", timeout: config.navigationTimeoutMs });
    const deadline = Date.now() + config.loginTimeoutMs;
    while (Date.now() < deadline) {
      if (await hasLoginMarker(browser.page)) return { ok: true, loggedIn: true };
      await browser.page.waitForTimeout(1_000);
    }
    throw sessionError("wechat_login_timeout");
  } finally {
    await browser.close();
  }
}

export async function hasLoginMarker(page) {
  for (const selector of SITE.loginMarkers) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index++) {
      if (await locator.nth(index).isVisible().catch(() => false)) return true;
    }
  }
  return false;
}

function sessionError(code) {
  return Object.assign(new Error(code), { code });
}
