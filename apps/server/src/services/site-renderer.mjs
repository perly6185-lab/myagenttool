import { createHash } from "node:crypto";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeUrl(value, fallback = "#") {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  try {
    const parsed = new URL(raw);
    return ["https:", "mailto:", "tel:"].includes(parsed.protocol) ? raw : fallback;
  } catch {
    return fallback;
  }
}

function text(value, fallback = "") {
  return escapeHtml(String(value ?? fallback).slice(0, 20_000));
}

function list(value) {
  return Array.isArray(value) ? value.slice(0, 50) : [];
}

export function siteAssetPublicPath(asset, derivative = null) {
  const suffix = derivative ? `-${encodeURIComponent(derivative.key)}` : "";
  const extension = derivative?.extension ?? asset.extension;
  return `/assets/media/${encodeURIComponent(asset.id)}${suffix}.${extension}`;
}

function assetUrl(assetId, assetsById, fallback = "") {
  const asset = assetsById.get(String(assetId ?? ""));
  return asset?.status === "ready" ? siteAssetPublicPath(asset) : safeUrl(fallback, "");
}

function imageMarkup({ assetId, assetsById, fallback = "", alt = "", className = "", sizes = "100vw", eager = false } = {}) {
  const asset = assetsById.get(String(assetId ?? ""));
  if (asset?.status !== "ready") {
    const src = safeUrl(fallback, "");
    return src ? `<img${className ? ` class="${escapeHtml(className)}"` : ""} src="${escapeHtml(src)}" alt="${text(alt)}"${eager ? ' fetchpriority="high"' : ' loading="lazy"'}>` : "";
  }
  const derivatives = list(asset.derivatives)
    .filter((derivative) => Number.isFinite(derivative?.width) && derivative.width > 0)
    .sort((left, right) => left.width - right.width);
  const srcset = derivatives.map((derivative) => `${siteAssetPublicPath(asset, derivative)} ${derivative.width}w`).join(", ");
  const rawFocalX = Number(asset.focalPoint?.x);
  const rawFocalY = Number(asset.focalPoint?.y);
  const focalX = Math.min(100, Math.max(0, Number.isFinite(rawFocalX) ? rawFocalX : 50));
  const focalY = Math.min(100, Math.max(0, Number.isFinite(rawFocalY) ? rawFocalY : 50));
  const dimensions = Number.isFinite(asset.width) && Number.isFinite(asset.height)
    ? ` width="${asset.width}" height="${asset.height}"`
    : "";
  return `<img${className ? ` class="${escapeHtml(className)}"` : ""} src="${escapeHtml(siteAssetPublicPath(asset))}"${srcset ? ` srcset="${escapeHtml(srcset)}" sizes="${escapeHtml(sizes)}"` : ""}${dimensions} alt="${text(alt || asset.altText)}" style="object-position:${focalX}% ${focalY}%"${eager ? ' fetchpriority="high"' : ' loading="lazy"'}>`;
}

function renderBlock(block, assetsById, entries = [], site = null) {
  if (!block || block.hidden || typeof block !== "object") return "";
  const data = block.data && typeof block.data === "object" ? block.data : {};
  const zh = !site || !entries[0] || entryLocale(entries[0], site) === "zh-CN";
  switch (block.type) {
    case "hero":
      {
        const primaryUrl = localizedContentUrl(data.primaryUrl, "/contact/", entries, site);
        return `<section class="hero">${imageMarkup({ assetId: data.assetId, assetsById, fallback: data.imageUrl, alt: data.imageAlt, className: "hero-image", sizes: "(max-width: 1112px) calc(100vw - 32px), 1080px", eager: true })}<p class="eyebrow">${text(data.eyebrow)}</p><h1>${text(data.title, zh ? "欢迎来到我的网站" : "Welcome to my website")}</h1><p>${text(data.subtitle)}</p>${data.primaryLabel && primaryUrl ? `<a class="button" href="${escapeHtml(primaryUrl)}">${text(data.primaryLabel)}</a>` : ""}</section>`;
      }
    case "rich_text":
      return `<section><h2>${text(data.title)}</h2>${list(data.paragraphs).map((paragraph) => `<p>${text(paragraph)}</p>`).join("")}</section>`;
    case "service_cards":
      return `<section><h2>${text(data.title, zh ? "服务" : "Services")}</h2><div class="grid">${list(data.items).map((item) => `<article class="card"><h3>${text(item?.title)}</h3><p>${text(item?.description)}</p></article>`).join("")}</div></section>`;
    case "case_cards":
      {
        const items = data.source === "cases"
          ? entries.filter((entry) => entry.type === "case" && entry.status !== "archived").map((entry) => ({ title: entry.title, description: entry.summary, url: entryHref(entry, site) }))
          : list(data.items);
        if (!items.length) return "";
        return `<section><h2>${text(data.title, zh ? "案例" : "Cases")}</h2><div class="grid">${items.map((item) => {
          const itemUrl = item?.url ? localizedContentUrl(item.url, "#", entries, site) : "";
          return `<article class="card"><h3>${itemUrl ? `<a href="${escapeHtml(itemUrl)}">${text(item?.title)}</a>` : text(item?.title)}</h3><p>${text(item?.description)}</p></article>`;
        }).join("")}</div></section>`;
      }
    case "gallery":
      return `<section><h2>${text(data.title, zh ? "图片" : "Gallery")}</h2><div class="gallery">${list(data.items).map((item) => {
        const asset = assetsById.get(String(item?.assetId ?? ""));
        const image = imageMarkup({ assetId: item?.assetId, assetsById, fallback: item?.url, alt: item?.alt || asset?.altText, sizes: "(max-width: 520px) calc(100vw - 32px), 360px" });
        return image ? `<figure>${image}<figcaption>${text(item?.caption || asset?.caption)}</figcaption></figure>` : "";
      }).join("")}</div></section>`;
    case "metrics":
      return `<section><div class="metrics">${list(data.items).map((item) => `<div><strong>${text(item?.value)}</strong><span>${text(item?.label)}</span></div>`).join("")}</div></section>`;
    case "faq":
      return `<section><h2>${text(data.title, zh ? "常见问题" : "Frequently asked questions")}</h2>${list(data.items).map((item) => `<details><summary>${text(item?.question)}</summary><p>${text(item?.answer)}</p></details>`).join("")}</section>`;
    case "contact":
      return `<section><h2>${text(data.title, zh ? "联系我" : "Contact me")}</h2><p>${text(data.description)}</p><ul class="contact">${data.email ? `<li><a href="mailto:${escapeHtml(String(data.email).replace(/[\s"'<>]/g, ""))}">${text(data.email)}</a></li>` : ""}${data.phone ? `<li><a href="tel:${escapeHtml(String(data.phone).replace(/[^+\d-]/g, ""))}">${text(data.phone)}</a></li>` : ""}</ul></section>`;
    case "cta":
      {
        const actionUrl = localizedContentUrl(data.url, "/contact/", entries, site);
        return `<section class="cta"><h2>${text(data.title)}</h2><p>${text(data.description)}</p>${actionUrl ? `<a class="button" href="${escapeHtml(actionUrl)}">${text(data.label, zh ? "联系我们" : "Contact us")}</a>` : ""}</section>`;
      }
    case "article_list":
      {
        const articles = entries.filter((entry) => entry.type === "article" && entry.status !== "archived");
        return `<section><h2>${text(data.title, zh ? "最新文章" : "Latest articles")}</h2>${articles.length
          ? `<div class="grid">${articles.map((entry) => `<article class="card"><h3><a href="${escapeHtml(entryHref(entry, site))}">${text(entry.title)}</a></h3>${entry.summary ? `<p>${text(entry.summary)}</p>` : ""}</article>`).join("")}</div>`
          : `<p>${text(data.description, zh ? "更多内容即将发布。" : "More content is coming soon.")}</p>`}</section>`;
      }
    default:
      return "";
  }
}

const BASE_CSS = `:root{color-scheme:light;--brand:#155eef;--ink:#17202a;--muted:#667085;--surface:#fff;--soft:#f5f7fa}*{box-sizing:border-box}body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:var(--surface);line-height:1.65}a{color:inherit}header,main,footer{width:min(1080px,calc(100% - 32px));margin:auto}header{display:flex;align-items:center;justify-content:space-between;padding:20px 0;border-bottom:1px solid #e7eaf0}.site-brand{display:flex;align-items:center;gap:10px}.site-logo{width:40px;height:40px;object-fit:contain;border-radius:8px}nav{display:flex;gap:18px;flex-wrap:wrap}main{padding:48px 0 80px}section{padding:36px 0}.hero{padding:72px 0}.hero-image{display:block;width:100%;max-height:520px;object-fit:cover;border-radius:24px;margin-bottom:32px}.hero h1{font-size:clamp(2.2rem,7vw,4.6rem);line-height:1.08;max-width:850px;margin:8px 0 20px}.hero p{max-width:700px;color:var(--muted);font-size:1.08rem}.eyebrow{color:var(--brand)!important;font-weight:700}.button{display:inline-block;background:var(--brand);color:white;text-decoration:none;padding:11px 18px;border-radius:10px;margin-top:16px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}.card{padding:22px;border:1px solid #e5e9f0;border-radius:16px;background:var(--soft)}.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}.gallery img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:12px}.metrics{display:flex;gap:36px;flex-wrap:wrap}.metrics div{display:flex;flex-direction:column}.metrics strong{font-size:2rem}.metrics span,figcaption,footer{color:var(--muted)}details{padding:14px 0;border-bottom:1px solid #e5e9f0}.cta{background:var(--soft);padding:32px;border-radius:20px}footer{padding:28px 0 50px;border-top:1px solid #e7eaf0}@media(max-width:640px){header{align-items:flex-start;gap:12px;flex-direction:column}.hero{padding:44px 0}main{padding-top:20px}section{padding:26px 0}}`;

function siteCss(settings = {}) {
  const brand = /^#[0-9a-f]{6}$/i.test(String(settings.brandColor ?? "")) ? String(settings.brandColor).toLowerCase() : "#155eef";
  const themes = {
    ocean: { ink: "#17202a", muted: "#667085", surface: "#ffffff", soft: "#f5f7fa" },
    ink: { ink: "#171717", muted: "#666666", surface: "#ffffff", soft: "#f3f3f3" },
    warm: { ink: "#332c25", muted: "#74685d", surface: "#fffdf8", soft: "#f7f0e6" },
  };
  const theme = themes[settings.theme] ?? themes.ocean;
  return `${BASE_CSS}\n:root{--brand:${brand};--ink:${theme.ink};--muted:${theme.muted};--surface:${theme.surface};--soft:${theme.soft}}`;
}

function entryLocale(entry, site) {
  return entry.locale ?? site.defaultLocale ?? "zh-CN";
}

function localePrefix(locale) {
  return locale === "en-US" ? "en" : "zh";
}

function entryHref(entry, site) {
  const prefix = entryLocale(entry, site) === site.defaultLocale ? "" : `/${localePrefix(entryLocale(entry, site))}`;
  return entry.slug === "home" ? `${prefix || ""}/` : `${prefix}/${entry.slug}/`;
}

function localizedContentUrl(value, fallback, entries, site) {
  const resolved = safeUrl(value, fallback);
  if (!site || !resolved.startsWith("/") || resolved.startsWith("//")) return resolved;
  const normalized = `/${resolved.replace(/^\/+|\/+$/g, "")}${resolved === "/" ? "" : "/"}`;
  const target = entries.find((entry) => entryHref(entry, site) === normalized)
    ?? entries.find((entry) => normalized === (entry.slug === "home" ? "/" : `/${entry.slug}/`));
  if (target) return entryHref(target, site);
  const locale = entries[0] ? entryLocale(entries[0], site) : site.defaultLocale;
  return locale === site.defaultLocale ? resolved : "";
}

function entryPath(entry, site) {
  return `${entryHref(entry, site).replace(/^\/+|\/+$/g, "")}${entry.slug === "home" && entryLocale(entry, site) === site.defaultLocale ? "" : "/"}index.html`.replace(/^\//, "");
}

function translationRoot(entry) {
  return entry?.translationOf ?? entry?.id;
}

function translatedEntry(source, locale, entries, site) {
  const root = translationRoot(source);
  return entries.find((entry) => translationRoot(entry) === root && entryLocale(entry, site) === locale) ?? null;
}

function navEntry(item, locale, entriesById, entries, site) {
  const source = entriesById.get(item?.entryId);
  if (!source) return null;
  return entryLocale(source, site) === locale ? source : translatedEntry(source, locale, entries, site);
}

function navHref(item, locale, entriesById, entries, site) {
  const entry = navEntry(item, locale, entriesById, entries, site);
  if (entry) return entryHref(entry, site);
  return safeUrl(item?.url, "#");
}

function pageDocument({ site, entry, revision, entriesById, entries, canonicalBase, assetsById }) {
  const locale = entryLocale(entry, site);
  const title = entry.slug === "home" ? site.name : `${entry.title} · ${site.name}`;
  const canonicalPath = entryHref(entry, site);
  const canonical = canonicalBase ? new URL(canonicalPath, canonicalBase).toString() : canonicalPath;
  const localeEntries = entries.filter((candidate) => entryLocale(candidate, site) === locale);
  const navigation = list(site.navigation?.header).map((item) => {
    const localized = navEntry(item, locale, entriesById, entries, site);
    if (!localized && item?.entryId) return "";
    return `<a href="${escapeHtml(navHref(item, locale, entriesById, entries, site))}">${text(localized?.title ?? item?.label)}</a>`;
  }).join("");
  const blocks = list(revision?.blocks).map((block) => renderBlock(block, assetsById, localeEntries, site)).join("");
  const peers = entries.filter((candidate) => translationRoot(candidate) === translationRoot(entry));
  const alternateLinks = peers.map((peer) => `<link rel="alternate" hreflang="${escapeHtml(entryLocale(peer, site))}" href="${escapeHtml(canonicalBase ? new URL(entryHref(peer, site), canonicalBase).toString() : entryHref(peer, site))}">`).join("");
  const defaultPeer = peers.find((peer) => entryLocale(peer, site) === site.defaultLocale);
  const defaultAlternate = defaultPeer ? `<link rel="alternate" hreflang="x-default" href="${escapeHtml(canonicalBase ? new URL(entryHref(defaultPeer, site), canonicalBase).toString() : entryHref(defaultPeer, site))}">` : "";
  const languageNavigation = peers.length > 1 ? `<nav class="languages" aria-label="${locale === "zh-CN" ? "语言" : "Languages"}">${peers.map((peer) => `<a href="${escapeHtml(entryHref(peer, site))}" hreflang="${escapeHtml(entryLocale(peer, site))}"${peer.id === entry.id ? ' aria-current="page"' : ""}>${entryLocale(peer, site) === "zh-CN" ? "中文" : "English"}</a>`).join("")}</nav>` : "";
  const logo = assetUrl(site.settings?.logoAssetId, assetsById, site.settings?.logoUrl);
  return `<!doctype html><html lang="${escapeHtml(locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${text(title)}</title><meta name="description" content="${text(entry.summary || site.description)}"><link rel="canonical" href="${escapeHtml(canonical)}">${alternateLinks}${defaultAlternate}<link rel="stylesheet" href="/assets/site.css"></head><body><header><strong class="site-brand">${logo ? `<img class="site-logo" src="${escapeHtml(logo)}" alt="">` : ""}${text(site.name)}</strong><nav aria-label="${locale === "zh-CN" ? "网站导航" : "Site navigation"}">${navigation}</nav>${languageNavigation}</header><main>${blocks || `<section><h1>${text(entry.title)}</h1><p>${text(entry.summary)}</p></section>`}</main><footer>${text(site.settings?.footerText || `© ${new Date().getUTCFullYear()} ${site.name}`)}</footer></body></html>`;
}

function collectAssetIds(value, output = new Set()) {
  if (Array.isArray(value)) value.forEach((item) => collectAssetIds(item, output));
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key === "assetId" && typeof item === "string" && item) output.add(item);
      else collectAssetIds(item, output);
    }
  }
  return output;
}

export function renderSiteBundle({ site, entries, revisionsById, canonicalBase = "", assets = [], readAsset = () => null }) {
  const visibleEntries = entries.filter((entry) => entry.status !== "archived");
  const entriesById = new Map(visibleEntries.map((entry) => [entry.id, entry]));
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const referencedAssetIds = collectAssetIds({ settings: site.settings });
  const files = { "assets/site.css": siteCss(site.settings) };
  for (const entry of visibleEntries) {
    const revision = revisionsById.get(entry.draftRevisionId);
    collectAssetIds(revision?.blocks, referencedAssetIds);
    files[entryPath(entry, site)] = pageDocument({ site, entry, revision, entriesById, entries: visibleEntries, canonicalBase, assetsById });
  }
  for (const assetId of referencedAssetIds) {
    const asset = assetsById.get(assetId);
    const bytes = asset?.status === "ready" ? readAsset(asset) : null;
    if (asset && bytes) {
      files[siteAssetPublicPath(asset).slice(1)] = bytes;
      for (const derivative of asset.derivatives ?? []) {
        const derivativeBytes = readAsset(asset, derivative);
        if (derivativeBytes) files[siteAssetPublicPath(asset, derivative).slice(1)] = derivativeBytes;
      }
    }
  }
  for (const locale of site.settings?.supportedLocales ?? [site.defaultLocale]) {
    const secondary = locale !== site.defaultLocale;
    const notFoundEntry = { id: `404-${locale}`, locale, slug: "404", title: locale === "zh-CN" ? "页面不存在" : "Page not found", summary: locale === "zh-CN" ? "这个页面不存在或已经移动。" : "This page does not exist or has moved." };
    const path = secondary ? `${localePrefix(locale)}/404.html` : "404.html";
    files[path] = pageDocument({
      site,
      entry: notFoundEntry,
      revision: { blocks: [{ type: "rich_text", data: { title: notFoundEntry.title, paragraphs: [locale === "zh-CN" ? "请返回首页继续浏览。" : "Return to the home page to continue."] } }] },
      entriesById,
      entries: visibleEntries,
      canonicalBase,
      assetsById,
    });
  }
  const paths = visibleEntries.map((entry) => entryHref(entry, site));
  files["sitemap.xml"] = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((path) => `<url><loc>${escapeHtml(canonicalBase ? new URL(path, canonicalBase).toString() : path)}</loc></url>`).join("")}</urlset>`;
  files["robots.txt"] = `User-agent: *\nAllow: /\nSitemap: ${canonicalBase ? new URL("/sitemap.xml", canonicalBase).toString() : "/sitemap.xml"}\n`;
  const sortedFiles = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  const bundleDigest = createHash("sha256");
  for (const [path, body] of Object.entries(sortedFiles)) {
    bundleDigest.update(path).update("\0").update(Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8")).update("\0");
  }
  const hash = bundleDigest.digest("hex");
  return {
    files: sortedFiles,
    hash,
    manifest: Object.entries(sortedFiles).map(([path, body]) => ({
      path,
      bytes: Buffer.isBuffer(body) ? body.length : Buffer.byteLength(body, "utf8"),
      sha256: createHash("sha256").update(body).digest("hex"),
    })),
  };
}
