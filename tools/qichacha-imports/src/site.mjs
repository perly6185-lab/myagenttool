// Qichacha site constants — the ONLY place qichacha specifics live. The
// server-side session-manager knows the site key "qichacha" and the CLI
// contract; everything below (URLs, login marker, content selectors) stays in
// this package. A new site plugin copies this file with its own values (see
// tools/session-engine/README.md for the recipe).

export const SITE = Object.freeze({
  site: "qichacha",
  // Where --login sends the operator to sign in (and where it polls for the
  // login marker). Login is a homepage MODAL, not a page: /userlogin is a 404
  // (live pass 2026-08-17). --login opens the homepage; the operator clicks
  // 登录 to surface the modal (QR / SMS / password). The poller is URL-agnostic
  // — it watches the DOM marker, so manual navigation during login is fine.
  loginUrl: "https://www.qcc.com/",
  // A cheap page --probe renders to confirm the profile still holds a session.
  // Deliberately the HOMEPAGE, never a /firm/* page: logged-in views of firm
  // pages consume Qichacha's daily view quota, and a health heartbeat must not
  // spend it.
  healthUrl: "https://www.qcc.com/",
  // How logged-in state is detected — by DOM MARKER, not by cookie name. Live
  // pass 2026-08-17: the session rides server-side on QCCSESSID, which exists
  // logged-out too, and the only logged-in-only cookies were WAF/slider
  // artifacts — no cookie NAME distinguishes the states. The header renders
  // this personal-center link only for a signed-in visitor: seeded profile →
  // 2 hits, fresh anonymous context → 0 hits (A/B evidence on issue #1698).
  loginMarkerSelector: 'a[href*="/web/user/account-info"]',
  // The selectors the render waits for to prove a real firm page painted (vs a
  // login wall / slider interstitial) — live-pass final 2026-08-17: the firm
  // page wraps everything in `.company-detail` and the company name is an
  // `h1.copy-value`. Both are firm-page-only (the old `.header-content` guess
  // matches the site-wide nav on every page, homepage included).
  contentSelector: ".company-detail, h1.copy-value",
});
