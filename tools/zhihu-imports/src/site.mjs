// Zhihu site constants — the ONLY place zhihu specifics live. The server-side
// session-manager knows the site key "zhihu" and the CLI contract; everything
// below (URLs, auth cookie, content selectors) stays in this package. A new
// site plugin copies this file with its own values (see
// tools/session-engine/README.md for the recipe).

export const SITE = Object.freeze({
  site: "zhihu",
  // Where --login sends the operator to sign in (and where it polls for the
  // auth cookie).
  loginUrl: "https://www.zhihu.com/",
  // A cheap page --probe renders to confirm the profile still clears secng.
  healthUrl: "https://www.zhihu.com/",
  // zhihu's auth cookie — present only in a logged-in session. Used by --login
  // to detect the operator has signed in, and by --probe to report health.
  authCookie: "z_c0",
  // The same selectors parseArticleDocument uses to find zhihu content, kept
  // in sync deliberately. Their presence proves the browser cleared secng AND
  // the article body rendered (vs a login wall / challenge interstitial).
  contentSelector: ".Post-RichTextContainer, .RichContent-inner, .RichText.ztext, article",
});
