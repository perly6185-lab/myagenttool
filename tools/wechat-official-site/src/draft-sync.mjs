import { openContext } from "../../session-engine/src/launch.mjs";
import { normalizeWechatArticlePackage } from "./article-package.mjs";
import { hasLoginMarker } from "./session.mjs";
import { SITE } from "./site.mjs";

export async function syncWechatOfficialDraft({ config, articlePackage, open = openContext } = {}) {
  const article = normalizeWechatArticlePackage(articlePackage);
  // Image insertion and cover cropping need a separately verified page
  // contract. Refuse before opening the editor instead of silently dropping
  // assets or publishing a text-only surprise.
  if (article.bodyImages.length || article.cover) {
    return failure("wechat_draft_media_contract_not_ready", "当前插件版本尚未验证公众号图片和封面控件；草稿没有被修改。", false);
  }
  const browser = await open({ ...config, headless: false });
  let saveStarted = false;
  try {
    const page = browser.page;
    await page.goto(SITE.homeUrl, { waitUntil: "domcontentloaded", timeout: config.navigationTimeoutMs });
    if (!(await hasLoginMarker(page))) {
      return {
        status: "session_expired",
        sideEffectState: "not_started",
        errorCode: "wechat_login_required",
        summary: "公众号登录状态已失效，需要扫码后继续原任务。",
        userAction: { kind: "login", message: "请在弹出的公众号页面扫码登录。" },
      };
    }
    await openDraftEditor(page, config.navigationTimeoutMs);
    await fillRequired(page, SITE.editor.title, article.title, "wechat_title_field_not_found");
    if (article.author) await fillOptional(page, SITE.editor.author, article.author);
    if (article.digest) await fillOptional(page, SITE.editor.digest, article.digest);
    const body = await uniqueVisible(page, SITE.editor.body, "wechat_body_editor_not_found");
    await body.evaluate((element, content) => {
      element.innerHTML = content;
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: null }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }, article.contentHtml);
    const save = await uniqueVisible(page, SITE.editor.save, "wechat_save_draft_button_not_found");
    saveStarted = true;
    await save.click();
    await waitForAnyVisible(page, SITE.editor.saved, 15_000);
    return {
      status: "succeeded",
      sideEffectState: "confirmed",
      summary: `公众号草稿“${article.title}”已保存。`,
      receipt: {
        packageDigest: article.packageDigest,
        title: article.title,
        editorUrl: safeEditorUrl(page.url()),
        pageContractVersion: "wechat-official-draft-v1",
      },
    };
  } catch (error) {
    if (saveStarted) {
      return {
        status: "unconfirmed",
        sideEffectState: "unknown",
        errorCode: error?.code ?? "wechat_draft_save_unconfirmed",
        summary: "保存操作已经开始，但没有取得可靠回执；请先到草稿箱核对，不会自动重复保存。",
      };
    }
    return {
      status: error?.code?.includes("not_found") ? "site_layout_changed" : "failed",
      sideEffectState: "not_started",
      errorCode: error?.code ?? "wechat_draft_sync_failed",
      summary: error?.message ?? String(error),
      retryable: false,
    };
  } finally {
    await browser.close();
  }
}

async function openDraftEditor(page, timeout) {
  const entry = await uniqueVisible(page, SITE.draftEntrySelectors, "wechat_draft_entry_not_found");
  await Promise.all([
    page.waitForLoadState("domcontentloaded", { timeout }).catch(() => {}),
    entry.click(),
  ]);
}

async function fillRequired(page, selectors, value, code) {
  const locator = await uniqueVisible(page, selectors, code);
  await locator.fill(value);
}

async function fillOptional(page, selectors, value) {
  const locator = await firstVisible(page, selectors);
  if (locator) await locator.fill(value);
}

async function uniqueVisible(page, selectors, code) {
  const candidates = [];
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);
    for (let index = 0; index < count; index++) {
      const item = locator.nth(index);
      if (await item.isVisible().catch(() => false)) candidates.push(item);
    }
    if (candidates.length) break;
  }
  if (candidates.length !== 1) throw draftError(code);
  return candidates[0];
}

async function firstVisible(page, selectors) {
  try {
    return await uniqueVisible(page, selectors, "optional_field_not_found");
  } catch {
    return null;
  }
}

async function waitForAnyVisible(page, selectors, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await firstVisible(page, selectors)) return;
    await page.waitForTimeout(250);
  }
  throw draftError("wechat_draft_save_receipt_not_found");
}

function safeEditorUrl(value) {
  try {
    const url = new URL(value);
    if (url.hostname !== "mp.weixin.qq.com") return null;
    url.searchParams.delete("token");
    return url.toString();
  } catch {
    return null;
  }
}

function failure(errorCode, summary, retryable) {
  return { status: "failed", sideEffectState: "not_started", errorCode, summary, retryable };
}

function draftError(code) {
  return Object.assign(new Error(code), { code });
}
