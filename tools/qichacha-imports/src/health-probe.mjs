// Health probe for the qichacha persistent profile: is the logged-in session
// still alive? Backs the CLI `--probe` mode and the server-side
// session-manager's manual probe (qichacha is heartbeatTier "manual" — the
// scheduled sweep never touches it, precisely because logged-in views can
// consume the site's daily quota).
//
// Probe shape (cheap, gentle — and quota-safe): open the profile, load the
// site HOMEPAGE, and check the DOM login marker (site.mjs records why a
// cookie name cannot carry this verdict). Never navigates to /firm/* — the
// verdict is the homepage header, not a company page. `ok` means the probe
// RAN (browser launched, page loaded); `loggedIn` is the health verdict. A
// profile that lost its session reports ok:true, loggedIn:false — that is a
// finding, not a probe failure.

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
    // Load a page so any signed-out state settles; the verdict is the header
    // DOM, so give the SPA a beat after domcontentloaded. A navigation timeout
    // is not fatal — the marker check still runs on whatever painted.
    await page.goto(healthUrl, { waitUntil: "domcontentloaded", timeout: config.limits.pageTimeoutMs }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: config.limits.pageTimeoutMs }).catch(() => {});
    const hits = await page.locator(SITE.loginMarkerSelector).count().catch(() => 0);
    return {
      ok: true,
      loggedIn: hits > 0,
      detail:
        hits > 0
          ? `login marker present (${SITE.loginMarkerSelector})`
          : `login marker absent (${SITE.loginMarkerSelector}) — header shows the signed-out state (re-run --login to reseed)`,
    };
  } finally {
    await close();
  }
}
