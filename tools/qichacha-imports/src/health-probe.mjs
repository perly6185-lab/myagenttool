// Health probe for the qichacha persistent profile: is the logged-in session
// still alive? Backs the CLI `--probe` mode and the server-side
// session-manager's manual probe (qichacha is heartbeatTier "manual" — the
// scheduled sweep never touches it, precisely because logged-in views can
// consume the site's daily quota).
//
// Probe shape (cheap, gentle — and quota-safe): open the profile headless,
// load the site HOMEPAGE, and check whether any of the candidate auth cookies
// is still present. Never navigates to /firm/* — the verdict is the cookie
// list, not a company page. `ok` means the probe RAN (browser launched,
// cookies read); `loggedIn` is the health verdict. A profile that lost its
// session reports ok:true, loggedIn:false — that is a finding, not a probe
// failure.

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
export async function probeQichachaSession({ config, signal, healthUrl = SITE.healthUrl }) {
  const { page, close } = await openContext(config);
  try {
    if (signal && signal.aborted) throw new Error("Aborted");
    // Load a page so any expired-cookie state settles; the verdict is the
    // cookie list, not the page, so a navigation timeout is not fatal.
    await page.goto(healthUrl, { waitUntil: "domcontentloaded", timeout: config.limits.pageTimeoutMs }).catch(() => {});
    const cookies = await page.context().cookies();
    const names = new Set(cookies.map((c) => c.name));
    const hit = SITE.authCookies.find((name) => names.has(name));
    return {
      ok: true,
      loggedIn: Boolean(hit),
      detail: hit
        ? `${hit} present`
        : `none of ${SITE.authCookies.join(", ")} present (re-run --login to reseed)`,
    };
  } finally {
    await close();
  }
}
