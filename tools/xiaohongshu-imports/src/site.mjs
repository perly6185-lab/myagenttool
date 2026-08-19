// Xiaohongshu site constants — the ONLY place xiaohongshu specifics live. The
// server-side session-manager knows the site key "xiaohongshu" and the CLI
// contract; everything below (URLs, login marker, content selectors) stays in
// this package. A new site plugin copies this file with its own values (see
// tools/session-engine/README.md for the recipe).

export const SITE = Object.freeze({
  site: "xiaohongshu",
  // Where --login sends the operator to sign in. XHS login is a MODAL that
  // auto-pops on /explore for an anonymous visitor (live matrix 2026-08-17,
  // issue #1703: anonymous browser on /explore renders login-modal=2 with the
  // QR / SMS form) — so --login just opens /explore and the poller watches the
  // DOM marker. XHS web sign-in is QR / phone-SMS only.
  loginUrl: "https://www.xiaohongshu.com/explore",
  // A cheap page --probe renders to confirm the profile still holds a session.
  // Deliberately the explore FEED, never a note detail page: XHS runs
  // aggressive behavioral risk control, and the probe must spend zero
  // note-level signals. The verdict is the header DOM, not feed content.
  healthUrl: "https://www.xiaohongshu.com/explore",
  // How logged-in state is detected — by DOM MARKER, not by cookie name
  // (qichacha lesson, issue #1698: the marker survives cases where no cookie
  // name distinguishes the states). The signed-in header swaps the 登录 button
  // for the user's profile link (a[href*="/user/profile/"]). The matrix could
  // only verify the NEGATIVE side (anonymous: 0 hits, 登录 rendered); the
  // positive side is confirmed in the seeded-profile live pass on #1703.
  loginMarkerSelector: 'a[href*="/user/profile/"]',
  // The selectors the render waits for to prove a real note painted (vs the
  // login shell / /404 interstitial the anonymous matrix saw). Note detail
  // pages render the note container (#detail-desc for text, .note-content for
  // the note root) — aligned with findProviderContent's xiaohongshu branch in
  // apps/server/src/services/article-imports.mjs.
  contentSelector: "#detail-desc, .note-content",
  // Wall markers for a clean failure message: the anonymous matrix (issue
  // #1703) saw plain-HTTP note URLs 302 into /404/sec_<rand>
  // (error_code=300031) and browser visitors get the login modal
  // (.login-container). Checked only to pick the error MESSAGE — detection is
  // the content selector's timeout.
  loginWallSelector: ".login-container, [class*='login-modal']",
});
