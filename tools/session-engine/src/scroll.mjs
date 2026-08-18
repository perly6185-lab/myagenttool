// Lazy-hydration scrolling, extracted verbatim from
// tools/zhihu-imports/src/fetch-doc.mjs (PR #1680). Long SPAs hydrate content
// and image attributes (data-original/src) only as they scroll into view;
// stepping to the bottom surfaces them so the returned HTML carries every
// image for the parent's downloadMedia. Stops early once the document height
// stabilizes for several consecutive steps.

/**
 * Scroll the page to the bottom in steps to trigger lazy hydration. Stops early
 * once the document height stabilizes for several consecutive steps.
 *
 * @param {import("playwright").Page} page
 * @param {Record<string, number>} limits - scrollMaxSteps, scrollSettleMs
 */
export async function scrollToBottom(page, limits) {
  let prevHeight = 0;
  let stable = 0;
  for (let i = 0; i < limits.scrollMaxSteps; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await page.waitForTimeout(limits.scrollSettleMs).catch(() => {});
    const h = await page.evaluate(() => document.body.scrollHeight).catch(() => prevHeight);
    if (h === prevHeight) {
      stable++;
      if (stable >= 3) break;
    } else {
      stable = 0;
    }
    prevHeight = h;
  }
  // Final settle so trailing lazy responses flush before we snapshot.
  await page.waitForTimeout(500).catch(() => {});
}
