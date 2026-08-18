// Jianshu site constants — the ONLY place jianshu specifics live. The
// server-side session-manager knows the site key "jianshu" and the CLI
// contract; everything below (URLs, login marker, content selectors) stays in
// this package. A new site plugin copies this file with its own values (see
// tools/session-engine/README.md for the recipe).

export const SITE = Object.freeze({
  site: "jianshu",
  // Where --login sends the operator to sign in. Jianshu's own sign-in page
  // (account / QR); the poller watches the header DOM marker — it survives the
  // post-login redirect back to the homepage.
  loginUrl: "https://www.jianshu.com/sign_in",
  // A cheap page --probe renders to confirm the profile still holds a session.
  // Deliberately the HOMEPAGE, never an article page: the probe must spend zero
  // article-level signals (issue #1705 risk discipline). The verdict is the
  // header DOM, not feed content.
  healthUrl: "https://www.jianshu.com/",
  // How logged-in state is detected — by DOM MARKER, not by cookie name
  // (qichacha lesson, issue #1698: the marker survives cases where no cookie
  // name distinguishes the states). The signed-in header carries the user's
  // avatar menu linking to /u/<slug>; the signed-out header shows the sign_in
  // link instead. Candidate finalized in the seeded-profile live pass (#1705);
  // `remember_user_token` is the cookie NAME to watch on stderr (values never
  // printed).
  loginMarkerSelector: 'a[href^="/u/"]',
  // The selector the render waits for to prove a real article painted. Jianshu
  // is a Next.js SPA: the SSR DOM renders an <article> shell (with the intro
  // paragraphs) for live notes — deleted ones 404 without it. The AUTHORITATIVE
  // verdict is the __NEXT_DATA__ note payload extracted afterwards (fetch-doc);
  // this selector only proves the page type before extraction runs.
  contentSelector: "article",
});
