import { createHash } from "node:crypto";

const SHA256 = /^sha256:[a-f0-9]{64}$/i;

export function normalizeWechatArticlePackage(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw packageError("invalid_wechat_article_package");
  const article = normalizedArticleFields(input);
  const packageDigest = String(input.packageDigest ?? "").trim().toLowerCase();
  if (!article.title || !article.contentHtml || !SHA256.test(packageDigest)) throw packageError("invalid_wechat_article_package");
  if (packageDigest !== digestFor(article)) throw packageError("wechat_article_package_digest_mismatch");
  return Object.freeze({
    schemaVersion: 1,
    ...article,
    packageDigest,
  });
}

export function createWechatArticlePackage(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw packageError("invalid_wechat_article_package");
  const article = normalizedArticleFields(input);
  if (!article.title || !article.contentHtml) throw packageError("invalid_wechat_article_package");
  return Object.freeze({ schemaVersion: 1, ...article, packageDigest: digestFor(article) });
}

function normalizedArticleFields(input) {
  const bodyImages = normalizeFiles(input.bodyImages, 100);
  const cover = input.cover == null ? null : normalizeFile(input.cover);
  return {
    title: text(input.title, 64),
    author: text(input.author, 32),
    digest: text(input.digest, 240),
    contentHtml: html(input.contentHtml, 512 * 1024),
    cover,
    bodyImages: Object.freeze(bodyImages),
    sourceUrl: httpsUrl(input.sourceUrl),
  };
}

function digestFor(article) {
  return `sha256:${createHash("sha256").update(JSON.stringify(article)).digest("hex")}`;
}

function normalizeFiles(value, max) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > max) throw packageError("invalid_wechat_article_images");
  return value.map(normalizeFile);
}

function normalizeFile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw packageError("invalid_wechat_article_image");
  const path = String(value.path ?? "").trim();
  const hash = String(value.hash ?? "").trim();
  if (!path || path.length > 1_000 || !hash || hash.length > 200) throw packageError("invalid_wechat_article_image");
  return Object.freeze({ path, hash });
}

function text(value, max) {
  const result = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return result.length <= max ? result : "";
}

function html(value, maxBytes) {
  const result = String(value ?? "").trim();
  if (!result || Buffer.byteLength(result, "utf8") > maxBytes || /<script\b|\son\w+\s*=/i.test(result)) return "";
  return result;
}

function httpsUrl(value) {
  if (!value) return null;
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function packageError(code) {
  return Object.assign(new Error(code), { code });
}
