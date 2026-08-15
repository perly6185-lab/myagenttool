// Health probe for the zhihu persistent profile: is the logged-in session
// still alive? Backs the CLI `--probe` mode and the server-side
// session-manager's scheduled sweep.
//
// Probe shape (cheap, gentle — the sweep runs low-frequency so a too-regular
// heartbeat doesn't itself look like a bot): open the profile headless, load
// the site homepage, and check whether the auth cookie (z_c0) is still present.
// `ok` means the probe RAN (browser launched, cookies read); `loggedIn` is the
// health verdict. A profile that lost its session reports ok:true,
// loggedIn:false — that is a finding, not a probe failure.

import { SITE } from "./site.mjs";
import { openContext } from "@myagenttool/session-engine/launch";

/**
 * @param {{
 *   config: { limits: Record<string, number>, headless: boolean, channel: string | null, profileDir: string | null },
 *   signal?: AbortSignal,
 *   healthUrl?: string,
 * }} ctx
 * @returns {Promise<{ ok: boolean, loggedIn: boolean, detail: string }>}
 */
export async function probeZhihuSession({ config, signal, healthUrl = SITE.healthUrl }) {
  const { page, close } = await openContext(config);
  try {
    if (signal && signal.aborted) throw new Error("Aborted");
    // Load a page so any expired-cookie state settles; the verdict is the
    // cookie list, not the page, so a navigation timeout is not fatal.
    await page.goto(healthUrl, { waitUntil: "domcontentloaded", timeout: config.limits.pageTimeoutMs }).catch(() => {});
    const cookies = await page.context().cookies();
    const present = cookies.some((c) => c.name === SITE.authCookie);
    return {
      ok: true,
      loggedIn: present,
      detail: present ? `${SITE.authCookie} present` : `${SITE.authCookie} missing (re-run --login to reseed)`,
    };
  } finally {
    await close();
  }
}
