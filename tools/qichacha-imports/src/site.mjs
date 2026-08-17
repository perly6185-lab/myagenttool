// Qichacha site constants — the ONLY place qichacha specifics live. The
// server-side session-manager knows the site key "qichacha" and the CLI
// contract; everything below (URLs, auth cookie, content selectors) stays in
// this package. A new site plugin copies this file with its own values (see
// tools/session-engine/README.md for the recipe).

export const SITE = Object.freeze({
  site: "qichacha",
  // Where --login sends the operator to sign in (and where it polls for the
  // auth cookie).
  loginUrl: "https://www.qcc.com/userlogin",
  // A cheap page --probe renders to confirm the profile still holds a session.
  // Deliberately the HOMEPAGE, never a /firm/* page: logged-in views of firm
  // pages consume Qichacha's daily view quota, and a health heartbeat must not
  // spend it.
  healthUrl: "https://www.qcc.com/",
  // Qichacha's auth cookie — any one of these being present counts as logged
  // in. The exact name is being confirmed by in-band discovery (--login prints
  // cookie NAMES to stderr while the operator signs in; see fetch-doc.mjs);
  // "qcc-token" is the leading guess and the list absorbs ambiguity.
  authCookie: "qcc-token",
  authCookies: Object.freeze(["qcc-token", "UC005", "QCCJT"]),
  // The selectors the render waits for to prove a real firm page painted (vs a
  // login wall / slider interstitial). Kept permissive until the live pass
  // finalizes the exact firm-page containers; their presence proves the
  // browser cleared the wall AND the company page rendered.
  contentSelector: ".header-content, .firm-header, h1, table",
});
