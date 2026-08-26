import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import {
  siteBlockTypes,
  siteBounds,
  siteDeploymentKinds,
  siteDeploymentProviderCapabilities,
  siteEntryIdPrefix,
  siteEntryStatuses,
  siteEntryTypes,
  siteIdPrefix,
  sitePublicationIdPrefix,
  sitePublicationPlanIdPrefix,
  siteRevisionIdPrefix,
  siteDeploymentTargetIdPrefix,
  siteAssetIdPrefix,
  siteDomainTlsBindingIdPrefix,
  siteDomainTlsAccessModes,
} from "@myagenttool/protocol/site";
import { LOCAL_TEAM_ID, LOCAL_USER_ID } from "../runtime/auth.mjs";
import { makeRunTx } from "../runtime/store/run-tx.mjs";
import { renderSiteBundle, siteAssetPublicPath } from "./site-renderer.mjs";
import {
  listSiteDeploymentAdapters,
  normalizeCredentialReference,
  normalizeCustomDomain,
  SiteDeploymentAdapterError,
  siteDeploymentAdapters,
} from "./site-deployment-adapters.mjs";
import { createEnvironmentCredentialResolver } from "./site-credential-resolver.mjs";
import { createSiteAssetStorage, readBoundedSiteAssetBody, safeSiteAssetName } from "./site-asset-storage.mjs";
import { SiteDomainTlsAdapterError } from "./site-domain-tls-adapter.mjs";
import { classifySshAddress } from "./ssh-host-connector.mjs";

const BLOCK_TYPES = new Set(siteBlockTypes);
const ENTRY_TYPES = new Set(siteEntryTypes);
const ENTRY_STATUSES = new Set(siteEntryStatuses);
const DEPLOYMENT_KINDS = new Set(siteDeploymentKinds);
const DOMAIN_TLS_ACCESS_MODES = new Set(siteDomainTlsAccessModes);
const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_OSS_BUCKET = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const SAFE_OSS_REGION = /^oss-[a-z0-9]+(?:-[a-z0-9]+)+$/;

function boundedText(value, max, { required = false } = {}) {
  const normalized = String(value ?? "").trim();
  if ((required && !normalized) || normalized.length > max) return undefined;
  return normalized;
}

function normalizeEmail(value) {
  const email = String(value ?? "").trim();
  if (!email) return "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : undefined;
}

function normalizeSlug(value) {
  const slug = String(value ?? "").trim().toLowerCase();
  return slug.length <= siteBounds.maxSlugLength && SAFE_SLUG.test(slug) ? slug : undefined;
}

function normalizeBlocks(value) {
  if (!Array.isArray(value) || value.length > siteBounds.maxBlocksPerEntry) return null;
  const seen = new Set();
  const blocks = [];
  for (let index = 0; index < value.length; index += 1) {
    const candidate = value[index];
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) || !BLOCK_TYPES.has(candidate.type)) return null;
    const id = String(candidate.id ?? `block-${index + 1}`).trim();
    if (!id || id.length > 100 || seen.has(id) || !candidate.data || typeof candidate.data !== "object" || Array.isArray(candidate.data)) return null;
    const normalized = { id, type: candidate.type, data: candidate.data, hidden: Boolean(candidate.hidden) };
    if (Buffer.byteLength(JSON.stringify(normalized), "utf8") > siteBounds.maxBlockBytes) return null;
    seen.add(id);
    blocks.push(normalized);
  }
  return blocks;
}

function normalizeSiteSettings(value, current = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const theme = value.theme === undefined ? current.theme : String(value.theme);
  const brandColor = value.brandColor === undefined ? current.brandColor : String(value.brandColor).trim();
  const contactEmail = value.contactEmail === undefined ? (current.contactEmail ?? "") : normalizeEmail(value.contactEmail);
  const logoUrl = value.logoUrl === undefined ? (current.logoUrl ?? "") : boundedText(value.logoUrl, 1000);
  const logoAssetId = value.logoAssetId === undefined ? (current.logoAssetId ?? null) : value.logoAssetId == null || value.logoAssetId === "" ? null : boundedText(value.logoAssetId, 100);
  const footerText = value.footerText === undefined ? (current.footerText ?? "") : boundedText(value.footerText, 500);
  const supportedLocales = value.supportedLocales === undefined ? (current.supportedLocales ?? null) : value.supportedLocales;
  const normalizedLocales = supportedLocales == null ? null : Array.isArray(supportedLocales)
    ? [...new Set(supportedLocales.map(String))]
    : undefined;
  if (!["ocean", "ink", "warm"].includes(theme) || !/^#[0-9a-f]{6}$/i.test(brandColor ?? "")
    || contactEmail === undefined || logoUrl === undefined || logoAssetId === undefined || footerText === undefined
    || normalizedLocales === undefined || (normalizedLocales && (normalizedLocales.length < 1 || normalizedLocales.length > 2 || normalizedLocales.some((locale) => !["zh-CN", "en-US"].includes(locale))))) return undefined;
  return { logoUrl, logoAssetId, theme, brandColor: brandColor.toLowerCase(), contactEmail, footerText, ...(normalizedLocales ? { supportedLocales: normalizedLocales } : {}) };
}

function assetIdsIn(value, output = new Set()) {
  if (Array.isArray(value)) value.forEach((item) => assetIdsIn(item, output));
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key === "assetId" && typeof item === "string" && item) output.add(item);
      else assetIdsIn(item, output);
    }
  }
  return output;
}

function normalizeNavigation(value, current, validEntryIds) {
  if (value === undefined) return current;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const normalizeMenu = (items) => {
    if (!Array.isArray(items) || items.length > 30) return undefined;
    const menu = [];
    for (const item of items) {
      if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
      const id = boundedText(item.id, 100, { required: true });
      const label = boundedText(item.label, 100, { required: true });
      const entryId = item.entryId == null ? null : String(item.entryId);
      const url = entryId ? "" : boundedText(item.url, 1000) ?? "";
      if (!id || !label || (entryId && !validEntryIds.has(entryId))) return undefined;
      menu.push({ id, entryId, label, ...(url ? { url } : {}) });
    }
    return menu;
  };
  const header = normalizeMenu(value.header ?? current.header ?? []);
  const footer = normalizeMenu(value.footer ?? current.footer ?? []);
  return header && footer ? { header, footer } : undefined;
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function initialEntryDefinitions({ siteName, description, primaryAction, contactEmail }) {
  return [
    {
      type: "page", slug: "home", title: "首页", summary: description,
      blocks: [
        { id: "home-hero", type: "hero", data: { eyebrow: siteName, title: description || siteName, subtitle: primaryAction, primaryLabel: primaryAction || "联系我们", primaryUrl: "/contact/" } },
        { id: "home-services", type: "service_cards", data: { title: "我们提供的服务", items: [{ title: "服务一", description: "在这里介绍一项核心服务。" }, { title: "服务二", description: "在这里介绍另一项核心服务。" }] } },
        { id: "home-articles", type: "article_list", data: { title: "最新文章", description: "分享最新动态、观点和实践。" } },
      ],
    },
    {
      type: "page", slug: "about", title: "关于", summary: `了解${siteName}`,
      blocks: [{ id: "about-intro", type: "rich_text", data: { title: `关于${siteName}`, paragraphs: [description || "在这里介绍你的经历、团队和价值。"] } }],
    },
    {
      type: "page", slug: "services", title: "服务", summary: "我们提供的服务",
      blocks: [{ id: "services-list", type: "service_cards", data: { title: "服务", items: [{ title: "服务一", description: "说明适合谁、解决什么问题。" }] } }],
    },
    {
      type: "page", slug: "articles", title: "文章", summary: "文章与动态",
      blocks: [{ id: "articles-list", type: "article_list", data: { title: "文章", description: "这里会显示已经发布的文章。" } }],
    },
    {
      type: "page", slug: "contact", title: "联系", summary: "联系方式",
      blocks: [{ id: "contact-main", type: "contact", data: { title: "联系我们", description: primaryAction, email: contactEmail } }],
    },
  ];
}

function safeReleaseDirectory(root, teamId, siteId, publicationId) {
  if (!root) return null;
  const base = resolve(root);
  const target = resolve(base, teamId, siteId, publicationId);
  if (!target.startsWith(`${base}${sep}`) && target !== base) throw new Error("site_release_path_invalid");
  return target;
}

function activateRelease(releaseDirectory, publicationId, bundleHash) {
  if (!releaseDirectory) return;
  const pointerDirectory = dirname(releaseDirectory);
  mkdirSync(pointerDirectory, { recursive: true });
  const pointer = join(pointerDirectory, "current.json");
  const temporary = `${pointer}.${publicationId}.tmp`;
  writeFileSync(temporary, JSON.stringify({ publicationId, releaseDirectory, hash: bundleHash }), { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, pointer);
}

function writeBundle(root, teamId, siteId, publicationId, bundle, { activate = true } = {}) {
  const releaseDirectory = safeReleaseDirectory(root, teamId, siteId, publicationId);
  if (!releaseDirectory) return null;
  for (const [path, body] of Object.entries(bundle.files)) {
    const destination = resolve(releaseDirectory, path);
    if (!destination.startsWith(`${releaseDirectory}${sep}`)) throw new Error("site_release_file_path_invalid");
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, body, { encoding: "utf8", mode: 0o644 });
  }
  if (activate) activateRelease(releaseDirectory, publicationId, bundle.hash);
  return releaseDirectory;
}

function deploymentFailure(error) {
  if (error instanceof SiteDeploymentAdapterError) {
    return { error: error.code, message: error.message, retryable: error.retryable };
  }
  return { error: "site_deployment_failed", message: "Site deployment failed.", retryable: false };
}

function domainTlsFailure(error) {
  if (error instanceof SiteDomainTlsAdapterError) {
    return { error: error.code, message: error.message, retryable: error.retryable, cleanupRecordDigest: error.cleanupRecordDigest ?? null };
  }
  return { error: "site_domain_tls_operation_failed", message: "The domain and certificate operation failed.", retryable: false, cleanupRecordDigest: null };
}

export function createSiteService({
  state,
  now,
  nextId,
  appendEvent = () => {},
  persistStateSoon = () => {},
  store,
  publishRoot = null,
  assetRoot = null,
  resolveCredential = createEnvironmentCredentialResolver(),
  deploymentAdapters = {},
  domainTlsAdapter = null,
  tlsCertificateAdapter = null,
}) {
  const runTx = makeRunTx({ store, persistStateSoon });
  const assetStorage = createSiteAssetStorage({ root: assetRoot });
  for (const key of ["sites", "siteEntries", "siteEntryRevisions", "sitePublicationPlans", "sitePublications", "siteDeploymentTargets", "siteDomainTlsBindings", "siteAssets"]) {
    state[key] ??= [];
  }
  const activeDeploymentAdapters = { ...deploymentAdapters };
  const teamOf = (actor) => actor?.teamId ?? LOCAL_TEAM_ID;
  const userOf = (actor) => actor?.userId ?? LOCAL_USER_ID;
  const notFound = (kind = "site") => ({ ok: false, status: 404, body: { error: `${kind}_not_found` } });
  const inFlightSiteDeployments = new Set();
  const inFlightDomainTlsOperations = new Set();

  function findSite(siteId, actor) {
    return state.sites.find((site) => site.id === String(siteId) && site.ownerTeamId === teamOf(actor)) ?? null;
  }

  function findEntry(siteId, entryId, actor) {
    return state.siteEntries.find((entry) => entry.id === String(entryId) && entry.siteId === String(siteId) && entry.ownerTeamId === teamOf(actor)) ?? null;
  }

  function entriesFor(site, { includeArchived = false } = {}) {
    return state.siteEntries.filter((entry) => entry.siteId === site.id && entry.ownerTeamId === site.ownerTeamId)
      .filter((entry) => includeArchived || entry.status !== "archived")
      .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
  }

  function revisionFor(revisionId) {
    return state.siteEntryRevisions.find((revision) => revision.id === revisionId) ?? null;
  }

  function targetFor(site) {
    return state.siteDeploymentTargets.find((target) => target.siteId === site.id && target.ownerTeamId === site.ownerTeamId && target.status !== "disabled") ?? null;
  }

  function domainTlsFor(site) {
    return state.siteDomainTlsBindings.find((binding) => binding.siteId === site.id && binding.ownerTeamId === site.ownerTeamId && binding.status !== "disabled") ?? null;
  }

  function domainTlsView(binding, { professional = false } = {}) {
    if (!binding) return null;
    const ordinary = {
      hostname: binding.hostname,
      accessMode: binding.accessMode,
      status: binding.status,
      lastVerifiedAt: binding.lastVerifiedAt,
      renewAfter: binding.renewAfter,
      notAfter: binding.notAfter,
    };
    return professional ? {
      ...ordinary,
      id: binding.id,
      deploymentTargetId: binding.deploymentTargetId,
      dnsProvider: binding.dnsProvider,
      dnsCredentialRef: binding.dnsCredentialRef,
      challenge: binding.challenge,
      dnsZone: binding.dnsZone ?? null,
      certificateScopeId: binding.certificateScopeId,
      activationProfileId: binding.activationProfileId,
      certificateEnvironment: binding.certificateEnvironment ?? null,
      certificateFingerprint: binding.certificateFingerprint ?? null,
      certificateIssuer: binding.certificateIssuer ?? null,
      certificateSans: binding.certificateSans ?? [],
      certificateNotBefore: binding.certificateNotBefore ?? null,
      stagingIssuedAt: binding.stagingIssuedAt ?? null,
      stagingDeployedAt: binding.stagingDeployedAt ?? null,
      certificateReleaseId: binding.certificateReleaseId ?? null,
      lastCleanupRecordDigest: binding.lastCleanupRecordDigest ?? null,
      lastFailure: binding.lastFailure,
      revision: binding.revision,
      createdAt: binding.createdAt,
      updatedAt: binding.updatedAt,
    } : ordinary;
  }

  function assetsFor(site) {
    return state.siteAssets.filter((asset) => asset.siteId === site.id && asset.ownerTeamId === site.ownerTeamId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  function findAsset(site, assetId) {
    return state.siteAssets.find((asset) => asset.id === String(assetId) && asset.siteId === site.id && asset.ownerTeamId === site.ownerTeamId) ?? null;
  }

  function focalPointFor(asset) {
    const x = Number(asset?.focalPoint?.x);
    const y = Number(asset?.focalPoint?.y);
    return { x: Number.isFinite(x) ? Math.min(100, Math.max(0, x)) : 50, y: Number.isFinite(y) ? Math.min(100, Math.max(0, y)) : 50 };
  }

  function visibleDerivatives(asset, { professional = false } = {}) {
    return (asset.derivatives ?? []).map(({ storageKey: _storageKey, sha256, ...derivative }) => ({
      ...derivative,
      ...(professional ? { sha256 } : {}),
    }));
  }

  function assetStoredBytes(asset) {
    return Number(asset.size ?? 0) + (asset.derivatives ?? []).reduce((sum, derivative) => sum + Number(derivative.size ?? 0), 0);
  }

  function assetView(asset, { professional = false } = {}) {
    const { storageKey: _storageKey, derivatives: _derivatives, ...visible } = asset;
    const responsive = {
      width: asset.width ?? null, height: asset.height ?? null, focalPoint: focalPointFor(asset),
      derivativeStatus: asset.derivativeStatus ?? "unavailable", derivatives: visibleDerivatives(asset, { professional }),
    };
    return professional ? { ...visible, ...responsive } : {
      id: asset.id, siteId: asset.siteId, name: asset.name, mimeType: asset.mimeType, extension: asset.extension,
      size: asset.size, altText: asset.altText, caption: asset.caption, status: asset.status,
      revision: asset.revision, createdAt: asset.createdAt, updatedAt: asset.updatedAt, ...responsive,
    };
  }

  function assetSnapshot(asset) {
    return {
      id: asset.id, revision: asset.revision, sha256: asset.sha256, size: asset.size,
      ...(asset.width ? { width: asset.width, height: asset.height } : {}),
      ...(asset.focalPoint ? { focalPoint: focalPointFor(asset) } : {}),
      ...(asset.derivatives?.length ? { derivatives: asset.derivatives.map((derivative) => ({ key: derivative.key, width: derivative.width, height: derivative.height, sha256: derivative.sha256, size: derivative.size })) } : {}),
    };
  }

  function validAssetReferences(site, value) {
    const ready = new Set(assetsFor(site).filter((asset) => asset.status === "ready").map((asset) => asset.id));
    return [...assetIdsIn(value)].every((assetId) => ready.has(assetId));
  }

  function publicationView(publication, { professional = false } = {}) {
    if (!publication) return null;
    const { releaseDirectory: _releaseDirectory, snapshot: _snapshot, remoteDeployment: _remoteDeployment, ...publicPublication } = publication;
    return professional ? { ...publicPublication, snapshot: publication.snapshot, remoteDeployment: publication.remoteDeployment ?? null } : publicPublication;
  }

  function siteContentHash(site) {
    return hash({ settings: site.settings, navigation: site.navigation, name: site.name, description: site.description });
  }

  function entryView(entry, { includeBlocks = false } = {}) {
    const revision = revisionFor(entry.draftRevisionId);
    return {
      ...entry,
      hasUnpublishedChanges: entry.draftRevisionId !== entry.publishedRevisionId,
      ...(includeBlocks ? { blocks: revision?.blocks ?? [] } : {}),
    };
  }

  function siteView(site, { includeEntries = true, professional = false } = {}) {
    const entries = entriesFor(site);
    const activePublication = state.sitePublications.find((publication) => publication.id === site.activePublicationId) ?? null;
    const target = targetFor(site);
    const entryChangeCount = entries.filter((entry) => entry.draftRevisionId !== entry.publishedRevisionId).length;
    const siteChanged = Boolean(activePublication && activePublication.snapshot?.siteHash !== siteContentHash(site));
    const publishedAssets = new Map((activePublication?.snapshot?.assets ?? []).map((asset) => [asset.id, asset]));
    const currentAssets = referencedAssetsFor(site).map(assetSnapshot);
    const currentAssetIds = new Set(currentAssets.map((asset) => asset.id));
    const assetChangeCount = activePublication ? currentAssets.filter((asset) => hash(asset) !== hash(publishedAssets.get(asset.id) ?? null)).length
      + [...publishedAssets.keys()].filter((assetId) => !currentAssetIds.has(assetId)).length : 0;
    return {
      ...site,
      entries: includeEntries ? entries.map((entry) => entryView(entry)) : undefined,
      assetCount: assetsFor(site).filter((asset) => asset.status === "ready").length,
      unpublishedCount: entryChangeCount + (siteChanged ? 1 : 0) + assetChangeCount,
      activePublication: publicationView(activePublication, { professional }),
      deploymentTarget: target ? {
        id: target.id,
        kind: target.kind,
        status: target.status,
        displayName: target.displayName,
        capabilities: target.capabilities,
        lastVerifiedAt: target.lastVerifiedAt,
        ...(professional ? {
          revision: target.revision,
          remoteProjectRef: target.remoteProjectRef,
          region: target.region,
          credentialRef: target.credentialRef,
          customDomain: target.customDomain ?? "",
          verification: target.verification ?? null,
          lastError: target.lastError ?? null,
        } : {}),
      } : null,
      domainTlsBinding: domainTlsView(domainTlsFor(site), { professional }),
    };
  }

  function listSites(actor = null) {
    const sites = state.sites.filter((site) => site.ownerTeamId === teamOf(actor));
    return { ok: true, status: 200, body: { sites: sites.map((site) => siteView(site)), count: sites.length } };
  }

  function getSite({ siteId, professional = false } = {}, actor = null) {
    const site = findSite(siteId, actor);
    return site ? { ok: true, status: 200, body: { site: siteView(site, { professional }) } } : notFound();
  }

  function createRevision({ site, entry, blocks, actor, note = "", metadata = null }) {
    const revision = {
      id: nextId(siteRevisionIdPrefix),
      ownerTeamId: site.ownerTeamId,
      siteId: site.id,
      entryId: entry.id,
      revisionNumber: (state.siteEntryRevisions.filter((row) => row.entryId === entry.id).reduce((max, row) => Math.max(max, row.revisionNumber), 0)) + 1,
      blocks,
      metadata: metadata ?? { title: entry.title, summary: entry.summary, slug: entry.slug, status: entry.status },
      note: boundedText(note, 500) ?? "",
      createdAt: now(),
      createdBy: userOf(actor),
    };
    state.siteEntryRevisions.push(revision);
    entry.draftRevisionId = revision.id;
    return revision;
  }

  function createSite(input = {}, actor = null) {
    if (state.sites.some((site) => site.ownerTeamId === teamOf(actor) && site.status !== "disabled")) {
      return { ok: false, status: 409, body: { error: "site_already_exists" } };
    }
    const name = boundedText(input.name, siteBounds.maxNameLength, { required: true });
    const description = boundedText(input.description, siteBounds.maxDescriptionLength) ?? "";
    const audience = boundedText(input.audience, 300) ?? "";
    const primaryAction = boundedText(input.primaryAction, 200) ?? "联系我们";
    const contactEmail = normalizeEmail(input.contactEmail);
    if (!name || contactEmail === undefined) return { ok: false, status: 400, body: { error: "invalid_site_setup" } };
    const timestamp = now();
    const site = {
      id: nextId(siteIdPrefix),
      ownerTeamId: teamOf(actor),
      name,
      description,
      audience,
      primaryAction,
      defaultLocale: input.defaultLocale === "en-US" ? "en-US" : "zh-CN",
      status: "setup",
      visibility: "private_preview",
      publicUrl: null,
      activePublicationId: null,
      settings: {
        logoUrl: "",
        logoAssetId: null,
        theme: ["ocean", "ink", "warm"].includes(input.theme) ? input.theme : "ocean",
        brandColor: "#155eef",
        contactEmail,
        footerText: `© ${new Date(timestamp).getUTCFullYear()} ${name}`,
        supportedLocales: [input.defaultLocale === "en-US" ? "en-US" : "zh-CN"],
      },
      navigation: { header: [], footer: [] },
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: userOf(actor),
      lastModifiedBy: userOf(actor),
    };
    runTx(() => {
      state.sites.push(site);
      const definitions = initialEntryDefinitions({ siteName: name, description, primaryAction, contactEmail });
      definitions.forEach((definition, position) => {
        const entry = {
          id: nextId(siteEntryIdPrefix),
          ownerTeamId: site.ownerTeamId,
          siteId: site.id,
          type: definition.type,
          locale: site.defaultLocale,
          translationOf: null,
          slug: definition.slug,
          title: definition.title,
          summary: definition.summary,
          status: "draft",
          draftRevisionId: null,
          publishedRevisionId: null,
          position,
          revision: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
          createdBy: userOf(actor),
          lastModifiedBy: userOf(actor),
        };
        state.siteEntries.push(entry);
        createRevision({ site, entry, blocks: definition.blocks, actor, note: "初始模板" });
      });
      const bySlug = new Map(entriesFor(site).map((entry) => [entry.slug, entry]));
      site.navigation.header = ["home", "about", "services", "articles", "contact"].map((slug) => ({
        id: `nav-${slug}`, entryId: bySlug.get(slug)?.id ?? null, label: bySlug.get(slug)?.title ?? slug,
      }));
      state.siteDeploymentTargets.push({
        id: nextId(siteDeploymentTargetIdPrefix), ownerTeamId: site.ownerTeamId, siteId: site.id,
        kind: "local_directory", displayName: "本地发布", status: "ready", credentialRef: null,
        remoteProjectRef: null, region: null, capabilities: siteDeploymentProviderCapabilities.local_directory,
        lastVerifiedAt: timestamp, revision: 1, createdAt: timestamp, updatedAt: timestamp,
      });
      appendEvent({ invocationId: null, type: "site_created", level: "info", message: `Site ${site.id} created.`, data: { siteId: site.id, actorTeamId: site.ownerTeamId } });
    });
    return { ok: true, status: 201, body: { site: siteView(site) } };
  }

  function updateSite({ siteId, expectedRevision, ...changes } = {}, actor = null) {
    const site = findSite(siteId, actor);
    if (!site) return notFound();
    if (!Number.isInteger(expectedRevision)) return { ok: false, status: 400, body: { error: "expected_revision_required", currentRevision: site.revision } };
    if (expectedRevision !== site.revision) return { ok: false, status: 409, body: { error: "site_revision_conflict", currentRevision: site.revision } };
    const name = changes.name === undefined ? site.name : boundedText(changes.name, siteBounds.maxNameLength, { required: true });
    const description = changes.description === undefined ? site.description : boundedText(changes.description, siteBounds.maxDescriptionLength);
    const audience = changes.audience === undefined ? site.audience : boundedText(changes.audience, 300);
    const primaryAction = changes.primaryAction === undefined ? site.primaryAction : boundedText(changes.primaryAction, 200);
    const settings = changes.settings === undefined ? site.settings : normalizeSiteSettings(changes.settings, site.settings);
    const navigation = normalizeNavigation(changes.navigation, site.navigation, new Set(entriesFor(site, { includeArchived: true }).map((entry) => entry.id)));
    if (!name || description === undefined || audience === undefined || primaryAction === undefined
      || !settings || !navigation || !(settings.supportedLocales ?? [site.defaultLocale]).includes(site.defaultLocale)) {
      return { ok: false, status: 400, body: { error: "invalid_site_update" } };
    }
    if (entriesFor(site, { includeArchived: true }).some((entry) => !(settings.supportedLocales ?? [site.defaultLocale]).includes(entry.locale ?? site.defaultLocale))) {
      return { ok: false, status: 409, body: { error: "site_locale_in_use" } };
    }
    if (settings.logoAssetId && !validAssetReferences(site, { assetId: settings.logoAssetId })) {
      return { ok: false, status: 400, body: { error: "site_asset_reference_invalid" } };
    }
    const timestamp = now();
    runTx(() => {
      Object.assign(site, { name, description, audience, primaryAction, settings, navigation, revision: site.revision + 1, updatedAt: timestamp, lastModifiedBy: userOf(actor) });
    });
    return { ok: true, status: 200, body: { site: siteView(site) } };
  }

  function listEntries({ siteId, includeArchived = false } = {}, actor = null) {
    const site = findSite(siteId, actor);
    if (!site) return notFound();
    const entries = entriesFor(site, { includeArchived: Boolean(includeArchived) });
    return { ok: true, status: 200, body: { entries: entries.map((entry) => entryView(entry)), count: entries.length } };
  }

  function getEntry({ siteId, entryId } = {}, actor = null) {
    const site = findSite(siteId, actor);
    if (!site) return notFound();
    const entry = findEntry(siteId, entryId, actor);
    return entry ? { ok: true, status: 200, body: { entry: entryView(entry, { includeBlocks: true }) } } : notFound("site_entry");
  }

  function createEntry({ siteId, type = "article", slug, title, summary = "", blocks = [], locale, translationOf = null } = {}, actor = null) {
    const site = findSite(siteId, actor);
    if (!site) return notFound();
    if (entriesFor(site, { includeArchived: true }).length >= siteBounds.maxEntries) return { ok: false, status: 409, body: { error: "site_entry_limit_reached" } };
    const normalizedType = String(type);
    const normalizedSlug = normalizeSlug(slug);
    const normalizedTitle = boundedText(title, siteBounds.maxEntryTitleLength, { required: true });
    const normalizedSummary = boundedText(summary, siteBounds.maxEntrySummaryLength);
    const normalizedBlocks = normalizeBlocks(blocks);
    const normalizedLocale = locale == null ? site.defaultLocale : String(locale);
    const supportedLocales = site.settings?.supportedLocales ?? [site.defaultLocale];
    const sourceEntry = translationOf ? findEntry(site.id, translationOf, actor) : null;
    const normalizedTranslationOf = sourceEntry ? (sourceEntry.translationOf ?? sourceEntry.id) : null;
    if (!ENTRY_TYPES.has(normalizedType) || !normalizedSlug || !normalizedTitle || normalizedSummary === undefined || !normalizedBlocks
      || !supportedLocales.includes(normalizedLocale) || (translationOf && !sourceEntry)
      || (sourceEntry && (sourceEntry.type !== normalizedType || (sourceEntry.locale ?? site.defaultLocale) === normalizedLocale))) {
      return { ok: false, status: 400, body: { error: "invalid_site_entry" } };
    }
    if (!validAssetReferences(site, normalizedBlocks)) return { ok: false, status: 400, body: { error: "site_asset_reference_invalid" } };
    if (entriesFor(site, { includeArchived: true }).some((entry) => entry.slug === normalizedSlug && (entry.locale ?? site.defaultLocale) === normalizedLocale)) return { ok: false, status: 409, body: { error: "site_slug_conflict" } };
    if (normalizedTranslationOf && entriesFor(site, { includeArchived: true }).some((entry) => (entry.translationOf ?? entry.id) === normalizedTranslationOf && (entry.locale ?? site.defaultLocale) === normalizedLocale)) {
      return { ok: false, status: 409, body: { error: "site_translation_conflict" } };
    }
    const timestamp = now();
    const entry = {
      id: nextId(siteEntryIdPrefix), ownerTeamId: site.ownerTeamId, siteId: site.id,
      type: normalizedType, slug: normalizedSlug, title: normalizedTitle, summary: normalizedSummary,
      locale: normalizedLocale, translationOf: normalizedTranslationOf,
      status: "draft", draftRevisionId: null, publishedRevisionId: null,
      position: entriesFor(site, { includeArchived: true }).length, revision: 1,
      createdAt: timestamp, updatedAt: timestamp, createdBy: userOf(actor), lastModifiedBy: userOf(actor),
    };
    let caseShowcaseAdded = false;
    runTx(() => {
      state.siteEntries.push(entry);
      createRevision({ site, entry, blocks: normalizedBlocks, actor, note: "创建内容" });
      if (normalizedType === "case") {
        const home = entriesFor(site, { includeArchived: true }).find((candidate) => candidate.slug === "home" && candidate.status !== "archived" && (candidate.locale ?? site.defaultLocale) === normalizedLocale);
        const homeBlocks = revisionFor(home?.draftRevisionId)?.blocks ?? [];
        if (home && homeBlocks.length < siteBounds.maxBlocksPerEntry && !homeBlocks.some((block) => block.type === "case_cards" && block.data?.source === "cases")) {
          createRevision({
            site,
            entry: home,
            blocks: [...homeBlocks, { id: `${entry.id}-showcase`, type: "case_cards", data: { title: normalizedLocale === "en-US" ? "Featured cases" : "精选案例", source: "cases" }, hidden: false }],
            actor,
            note: "自动加入案例展示",
          });
          Object.assign(home, { revision: home.revision + 1, updatedAt: timestamp, lastModifiedBy: userOf(actor) });
          caseShowcaseAdded = true;
        }
      }
      site.revision += 1;
      site.updatedAt = timestamp;
    });
    return { ok: true, status: 201, body: { entry: entryView(entry, { includeBlocks: true }), site: siteView(site), caseShowcaseAdded } };
  }

  function updateEntry({ siteId, entryId, expectedRevision, title, summary, slug, status, blocks, note } = {}, actor = null) {
    const site = findSite(siteId, actor);
    if (!site) return notFound();
    const entry = findEntry(siteId, entryId, actor);
    if (!entry) return notFound("site_entry");
    if (!Number.isInteger(expectedRevision)) return { ok: false, status: 400, body: { error: "expected_revision_required", currentRevision: entry.revision } };
    if (entry.revision !== expectedRevision) return { ok: false, status: 409, body: { error: "site_entry_revision_conflict", currentRevision: entry.revision } };
    const normalizedTitle = title === undefined ? entry.title : boundedText(title, siteBounds.maxEntryTitleLength, { required: true });
    const normalizedSummary = summary === undefined ? entry.summary : boundedText(summary, siteBounds.maxEntrySummaryLength);
    const normalizedSlug = slug === undefined ? entry.slug : normalizeSlug(slug);
    const normalizedStatus = status === undefined ? entry.status : String(status);
    const normalizedBlocks = blocks === undefined ? revisionFor(entry.draftRevisionId)?.blocks ?? [] : normalizeBlocks(blocks);
    if (!normalizedTitle || normalizedSummary === undefined || !normalizedSlug || !ENTRY_STATUSES.has(normalizedStatus) || !normalizedBlocks) {
      return { ok: false, status: 400, body: { error: "invalid_site_entry" } };
    }
    if (!validAssetReferences(site, normalizedBlocks)) return { ok: false, status: 400, body: { error: "site_asset_reference_invalid" } };
    if (normalizedSlug !== entry.slug && entriesFor(site, { includeArchived: true }).some((row) => row.id !== entry.id && row.slug === normalizedSlug && (row.locale ?? site.defaultLocale) === (entry.locale ?? site.defaultLocale))) {
      return { ok: false, status: 409, body: { error: "site_slug_conflict" } };
    }
    const draftBytes = Buffer.byteLength(JSON.stringify(normalizedBlocks), "utf8");
    if (draftBytes > siteBounds.maxSiteDraftBytes) return { ok: false, status: 400, body: { error: "site_draft_too_large" } };
    const timestamp = now();
    runTx(() => {
      const contentChanged = hash(normalizedBlocks) !== hash(revisionFor(entry.draftRevisionId)?.blocks ?? []);
      const metadataChanged = normalizedTitle !== entry.title || normalizedSummary !== entry.summary
        || normalizedSlug !== entry.slug || normalizedStatus !== entry.status;
      if (contentChanged || metadataChanged) {
        createRevision({
          site,
          entry,
          blocks: normalizedBlocks,
          actor,
          note,
          metadata: { title: normalizedTitle, summary: normalizedSummary, slug: normalizedSlug, status: normalizedStatus },
        });
      }
      Object.assign(entry, { title: normalizedTitle, summary: normalizedSummary, slug: normalizedSlug, status: normalizedStatus, revision: entry.revision + 1, updatedAt: timestamp, lastModifiedBy: userOf(actor) });
      site.revision += 1;
      site.updatedAt = timestamp;
      site.lastModifiedBy = userOf(actor);
    });
    return { ok: true, status: 200, body: { entry: entryView(entry, { includeBlocks: true }), site: siteView(site) } };
  }

  function listAssets({ siteId, professional = false } = {}, actor = null) {
    const site = findSite(siteId, actor);
    if (!site) return notFound();
    const assets = assetsFor(site);
    return {
      ok: true, status: 200, body: {
        assets: assets.map((asset) => assetView(asset, { professional })), count: assets.length,
        usage: { bytes: assets.reduce((sum, asset) => sum + assetStoredBytes(asset), 0), limitBytes: siteBounds.maxAssetTotalBytes },
      },
    };
  }

  async function uploadAsset({ siteId, name, clientFileId = null, contentType = "" } = {}, req, actor = null) {
    const site = findSite(siteId, actor);
    if (!site) return notFound();
    if (!assetStorage.available) return { ok: false, status: 503, body: { error: "site_asset_storage_unavailable" } };
    const currentAssets = assetsFor(site);
    if (currentAssets.length >= siteBounds.maxAssets) return { ok: false, status: 409, body: { error: "site_asset_limit_reached" } };
    const normalizedClientFileId = clientFileId == null || clientFileId === "" ? null : boundedText(clientFileId, 120);
    if (clientFileId != null && !normalizedClientFileId) return { ok: false, status: 400, body: { error: "invalid_site_asset_upload" } };
    if (normalizedClientFileId) {
      const prior = currentAssets.find((asset) => asset.clientFileId === normalizedClientFileId);
      if (prior) return { ok: true, status: 200, body: { asset: assetView(prior), deduplicated: true } };
    }
    let bytes;
    try {
      bytes = await readBoundedSiteAssetBody(req, siteBounds.maxAssetBytes);
    } catch (error) {
      return { ok: false, status: error?.code === "site_asset_too_large" ? 413 : 400, body: { error: error?.code ?? "site_asset_upload_failed" } };
    }
    if (!bytes.length) return { ok: false, status: 400, body: { error: "site_asset_empty" } };
    const inspected = assetStorage.inspect(bytes);
    if (!inspected) return { ok: false, status: 415, body: { error: "site_asset_type_unsupported" } };
    const declared = String(contentType ?? "").split(";", 1)[0].trim().toLowerCase();
    if (declared.startsWith("image/") && declared !== inspected.mimeType) {
      return { ok: false, status: 400, body: { error: "site_asset_content_type_mismatch", detectedType: inspected.mimeType } };
    }
    const storedBytes = currentAssets.reduce((sum, asset) => sum + assetStoredBytes(asset), 0);
    if (storedBytes + inspected.size > siteBounds.maxAssetTotalBytes) {
      return { ok: false, status: 413, body: { error: "site_asset_storage_limit_reached" } };
    }
    const duplicate = currentAssets.find((asset) => asset.sha256 === inspected.sha256 && asset.status === "ready");
    if (duplicate) return { ok: true, status: 200, body: { asset: assetView(duplicate), deduplicated: true } };
    const storageKey = assetStorage.storageKeyFor({ ownerTeamId: site.ownerTeamId, siteId: site.id, sha256: inspected.sha256, extension: inspected.extension });
    try {
      assetStorage.write(storageKey, bytes);
    } catch {
      return { ok: false, status: 500, body: { error: "site_asset_write_failed" } };
    }
    const derived = await assetStorage.derive(bytes);
    const derivatives = [];
    let remainingBytes = siteBounds.maxAssetTotalBytes - storedBytes - inspected.size;
    for (const candidate of derived.variants) {
      if (candidate.size > remainingBytes) continue;
      const derivativeStorageKey = assetStorage.storageKeyFor({ ownerTeamId: site.ownerTeamId, siteId: site.id, sha256: candidate.sha256, extension: candidate.extension });
      try {
        assetStorage.write(derivativeStorageKey, candidate.bytes);
        derivatives.push({
          key: candidate.key, width: candidate.width, height: candidate.height,
          mimeType: candidate.mimeType, extension: candidate.extension, size: candidate.size,
          sha256: candidate.sha256, storageKey: derivativeStorageKey,
        });
        remainingBytes -= candidate.size;
      } catch { /* keep the original as a compatibility fallback */ }
    }
    const timestamp = now();
    const asset = {
      id: nextId(siteAssetIdPrefix), ownerTeamId: site.ownerTeamId, siteId: site.id,
      name: safeSiteAssetName(name), mimeType: inspected.mimeType, extension: inspected.extension,
      size: inspected.size, sha256: inspected.sha256, storageKey, clientFileId: normalizedClientFileId,
      width: derived.width, height: derived.height, focalPoint: { x: 50, y: 50 },
      derivativeStatus: derivatives.length ? "ready" : "unavailable", derivatives,
      altText: "", caption: "", status: "ready", revision: 1,
      createdAt: timestamp, updatedAt: timestamp, createdBy: userOf(actor), lastModifiedBy: userOf(actor),
    };
    runTx(() => {
      state.siteAssets.push(asset);
      site.revision += 1;
      site.updatedAt = timestamp;
      site.lastModifiedBy = userOf(actor);
      appendEvent({ invocationId: null, type: "site_asset_uploaded", level: "info", message: `Asset ${asset.id} uploaded.`, data: { siteId: site.id, assetId: asset.id, actorTeamId: site.ownerTeamId } });
    });
    return { ok: true, status: 201, body: { asset: assetView(asset), deduplicated: false } };
  }

  function updateAsset({ siteId, assetId, expectedRevision, altText, caption, name, focalPoint } = {}, actor = null) {
    const site = findSite(siteId, actor);
    if (!site) return notFound();
    const asset = findAsset(site, assetId);
    if (!asset) return notFound("site_asset");
    if (!Number.isInteger(expectedRevision)) return { ok: false, status: 400, body: { error: "expected_revision_required", currentRevision: asset.revision } };
    if (asset.revision !== expectedRevision) return { ok: false, status: 409, body: { error: "site_asset_revision_conflict", currentRevision: asset.revision } };
    const normalizedName = name === undefined ? asset.name : boundedText(safeSiteAssetName(name), 120, { required: true });
    const normalizedAltText = altText === undefined ? asset.altText : boundedText(altText, 500);
    const normalizedCaption = caption === undefined ? asset.caption : boundedText(caption, 1000);
    const normalizedFocalPoint = focalPoint === undefined ? focalPointFor(asset) : {
      x: Number(focalPoint?.x), y: Number(focalPoint?.y),
    };
    if (!normalizedName || normalizedAltText === undefined || normalizedCaption === undefined
      || !Number.isFinite(normalizedFocalPoint.x) || !Number.isFinite(normalizedFocalPoint.y)
      || normalizedFocalPoint.x < 0 || normalizedFocalPoint.x > 100 || normalizedFocalPoint.y < 0 || normalizedFocalPoint.y > 100) {
      return { ok: false, status: 400, body: { error: "invalid_site_asset_update" } };
    }
    const timestamp = now();
    runTx(() => {
      Object.assign(asset, { name: normalizedName, altText: normalizedAltText, caption: normalizedCaption, focalPoint: normalizedFocalPoint, revision: asset.revision + 1, updatedAt: timestamp, lastModifiedBy: userOf(actor) });
      site.revision += 1;
      site.updatedAt = timestamp;
      site.lastModifiedBy = userOf(actor);
    });
    return { ok: true, status: 200, body: { asset: assetView(asset) } };
  }

  function assetUsage(site, assetId) {
    const entryIds = entriesFor(site, { includeArchived: true }).filter((entry) => assetIdsIn(revisionFor(entry.draftRevisionId)?.blocks).has(assetId)).map((entry) => entry.id);
    const settings = site.settings?.logoAssetId === assetId;
    const publicationIds = state.sitePublications.filter((publication) => publication.siteId === site.id && (publication.snapshot?.assets ?? []).some((asset) => asset.id === assetId)).map((publication) => publication.id);
    return { entryIds, settings, publicationIds };
  }

  function deleteAsset({ siteId, assetId, expectedRevision } = {}, actor = null) {
    const site = findSite(siteId, actor);
    if (!site) return notFound();
    const asset = findAsset(site, assetId);
    if (!asset) return notFound("site_asset");
    if (asset.revision !== expectedRevision) return { ok: false, status: 409, body: { error: "site_asset_revision_conflict", currentRevision: asset.revision } };
    const usedBy = assetUsage(site, asset.id);
    if (usedBy.settings || usedBy.entryIds.length || usedBy.publicationIds.length) return { ok: false, status: 409, body: { error: "site_asset_in_use", usedBy } };
    const timestamp = now();
    runTx(() => {
      state.siteAssets.splice(state.siteAssets.indexOf(asset), 1);
      site.revision += 1;
      site.updatedAt = timestamp;
      site.lastModifiedBy = userOf(actor);
      appendEvent({ invocationId: null, type: "site_asset_deleted", level: "info", message: `Asset ${asset.id} deleted.`, data: { siteId: site.id, assetId: asset.id, actorTeamId: site.ownerTeamId } });
    });
    const storageKeys = [asset.storageKey, ...(asset.derivatives ?? []).map((derivative) => derivative.storageKey)];
    for (const storageKey of storageKeys) {
      const stillUsed = state.siteAssets.some((row) => row.storageKey === storageKey || (row.derivatives ?? []).some((derivative) => derivative.storageKey === storageKey));
      if (!stillUsed) assetStorage.remove(storageKey);
    }
    return { ok: true, status: 200, body: { deleted: true, assetId: asset.id } };
  }

  function getAssetContent({ siteId, assetId, variant = null } = {}, actor = null) {
    const site = findSite(siteId, actor);
    if (!site) return notFound();
    const asset = findAsset(site, assetId);
    if (!asset) return notFound("site_asset");
    const derivative = variant ? (asset.derivatives ?? []).find((candidate) => candidate.key === String(variant)) ?? null : null;
    if (variant && !derivative) return notFound("site_asset_variant");
    const bytes = assetStorage.read(derivative?.storageKey ?? asset.storageKey);
    return bytes ? { ok: true, status: 200, body: { asset: derivative ? { ...assetView(asset), mimeType: derivative.mimeType, extension: derivative.extension } : assetView(asset), bytes } }
      : { ok: false, status: 410, body: { error: "site_asset_content_unavailable" } };
  }

  function referencedAssetsFor(site) {
    const ids = assetIdsIn({ settings: site.settings });
    for (const entry of entriesFor(site)) assetIdsIn(revisionFor(entry.draftRevisionId)?.blocks, ids);
    return [...ids].map((assetId) => findAsset(site, assetId)).filter(Boolean).sort((a, b) => a.id.localeCompare(b.id));
  }

  function renderDraft(site) {
    const entries = entriesFor(site);
    const revisionsById = new Map(state.siteEntryRevisions.filter((revision) => revision.siteId === site.id).map((revision) => [revision.id, revision]));
    const customDomain = targetFor(site)?.customDomain ?? "";
    return renderSiteBundle({
      site, entries, revisionsById, canonicalBase: customDomain ? `https://${customDomain}` : "",
      assets: assetsFor(site), readAsset: (asset, derivative = null) => assetStorage.read(derivative?.storageKey ?? asset.storageKey),
    });
  }

  function previewSite({ siteId, path = "index.html" } = {}, actor = null) {
    const site = findSite(siteId, actor);
    if (!site) return notFound();
    const bundle = renderDraft(site);
    const safePath = String(path || "index.html").replace(/^\/+/, "");
    const body = bundle.files[safePath];
    if (body == null || Buffer.isBuffer(body)) return { ok: false, status: 404, body: { error: "site_preview_path_not_found" } };
    const assetPaths = {};
    for (const asset of assetsFor(site)) {
      if (bundle.files[siteAssetPublicPath(asset).slice(1)]) assetPaths[siteAssetPublicPath(asset)] = asset.id;
      for (const derivative of asset.derivatives ?? []) {
        const path = siteAssetPublicPath(asset, derivative);
        if (bundle.files[path.slice(1)]) assetPaths[path] = { assetId: asset.id, variant: derivative.key };
      }
    }
    return { ok: true, status: 200, body: { preview: { path: safePath, html: body, styles: bundle.files["assets/site.css"] ?? "", assetPaths, bundleHash: bundle.hash, files: bundle.manifest } } };
  }

  function snapshotFor(site) {
    return {
      siteRevision: site.revision,
      siteHash: siteContentHash(site),
      entries: entriesFor(site).map((entry) => ({ id: entry.id, revision: entry.revision, revisionId: entry.draftRevisionId, slug: entry.slug, status: entry.status, locale: entry.locale ?? site.defaultLocale, translationOf: entry.translationOf ?? null })),
      assets: referencedAssetsFor(site).map(assetSnapshot),
    };
  }

  function changesFor(site, snapshot) {
    const currentPublication = state.sitePublications.find((publication) => publication.id === site.activePublicationId);
    const previous = new Map((currentPublication?.snapshot?.entries ?? []).map((entry) => [entry.id, entry]));
    const current = new Map(snapshot.entries.map((entry) => [entry.id, entry]));
    const previousAssets = new Map((currentPublication?.snapshot?.assets ?? []).map((asset) => [asset.id, asset]));
    const currentAssets = new Map(snapshot.assets.map((asset) => [asset.id, asset]));
    return {
      added: snapshot.entries.filter((entry) => !previous.has(entry.id)).map((entry) => entry.id),
      changed: snapshot.entries.filter((entry) => previous.has(entry.id) && previous.get(entry.id).revisionId !== entry.revisionId).map((entry) => entry.id),
      removed: [...previous.keys()].filter((entryId) => !current.has(entryId)),
      siteChanged: Boolean(currentPublication && currentPublication.snapshot?.siteHash !== snapshot.siteHash),
      assetsChanged: snapshot.assets.filter((asset) => hash(asset) !== hash(previousAssets.get(asset.id) ?? null)).map((asset) => asset.id)
        .concat([...previousAssets.keys()].filter((assetId) => !currentAssets.has(assetId))),
    };
  }

  function createPublicationPlan({ siteId } = {}, actor = null) {
    const site = findSite(siteId, actor);
    if (!site) return notFound();
    const snapshot = snapshotFor(site);
    const bundle = renderDraft(site);
    const timestamp = now();
    const plan = {
      id: nextId(sitePublicationPlanIdPrefix), ownerTeamId: site.ownerTeamId, siteId: site.id,
      kind: "publish", status: "planned", snapshot, bundleHash: bundle.hash,
      progress: { stage: "planned", completed: 0, total: 4, updatedAt: timestamp },
      changes: changesFor(site, snapshot), checks: { errors: [], warnings: [], fileCount: bundle.manifest.length, bytes: bundle.manifest.reduce((sum, file) => sum + file.bytes, 0) },
      targetId: targetFor(site)?.id ?? null,
      targetRevision: targetFor(site)?.revision ?? null,
      targetKind: targetFor(site)?.kind ?? null,
      createdAt: timestamp, createdBy: userOf(actor), expiresAt: new Date(Date.parse(timestamp) + 30 * 60_000).toISOString(),
    };
    runTx(() => state.sitePublicationPlans.push(plan));
    return { ok: true, status: 201, body: { plan } };
  }

  function getPublicationPlan({ siteId, planId } = {}, actor = null) {
    const site = findSite(siteId, actor);
    if (!site) return notFound();
    const plan = state.sitePublicationPlans.find((row) => row.id === String(planId) && row.siteId === site.id && row.ownerTeamId === site.ownerTeamId);
    if (!plan) return notFound("site_publication_plan");
    const { snapshot: _snapshot, ...visible } = plan;
    return { ok: true, status: 200, body: { plan: visible } };
  }

  function planCurrent(plan, site) {
    if (Date.parse(plan.expiresAt) <= Date.parse(now())) return false;
    const target = targetFor(site);
    return hash(plan.snapshot) === hash(snapshotFor(site))
      && plan.targetId === (target?.id ?? null)
      && plan.targetRevision === (target?.revision ?? null)
      && plan.targetKind === (target?.kind ?? null);
  }

  async function confirmPublicationPlan({ siteId, planId, confirmed } = {}, actor = null) {
    const site = findSite(siteId, actor);
    if (!site) return notFound();
    const plan = state.sitePublicationPlans.find((row) => row.id === String(planId) && row.siteId === site.id && row.ownerTeamId === site.ownerTeamId);
    if (!plan) return notFound("site_publication_plan");
    if (confirmed !== true) return { ok: false, status: 400, body: { error: "site_publication_confirmation_required" } };
    if (plan.status !== "planned") return { ok: false, status: 409, body: { error: "site_publication_plan_used" } };
    if (inFlightSiteDeployments.has(site.id)) return { ok: false, status: 409, body: { error: "site_deployment_busy" } };
    if (!planCurrent(plan, site)) return { ok: false, status: 409, body: { error: "site_publication_plan_stale" } };
    const bundle = renderDraft(site);
    if (bundle.hash !== plan.bundleHash) return { ok: false, status: 409, body: { error: "site_publication_bundle_changed" } };
    const deploymentTarget = targetFor(site);
    if (actor?.pilotSandboxId && deploymentTarget?.kind !== "local_directory") {
      return { ok: false, status: 403, body: { error: "site_pilot_cloud_deployment_forbidden" } };
    }
    const adapterMetadata = siteDeploymentAdapters[deploymentTarget?.kind];
    if (!deploymentTarget || !adapterMetadata?.productionReady || deploymentTarget.status !== "ready") {
      return { ok: false, status: 409, body: { error: "site_deployment_target_not_ready" } };
    }
    const deploymentTargetSnapshot = structuredClone(deploymentTarget);
    inFlightSiteDeployments.add(site.id);
    try {
    runTx(() => {
      plan.status = "deploying";
      plan.startedAt = now();
      plan.progress = { stage: "preparing", completed: 0, total: 4, updatedAt: now() };
    });
    const reportProgress = (progress) => runTx(() => {
      if (plan.status !== "deploying") return;
      plan.progress = {
        stage: String(progress?.stage ?? "preparing").slice(0, 60),
        completed: Math.max(0, Number(progress?.completed ?? 0)),
        total: Math.max(1, Number(progress?.total ?? 4)),
        ...(Number.isFinite(progress?.itemsCompleted) ? { itemsCompleted: Math.max(0, Number(progress.itemsCompleted)) } : {}),
        ...(Number.isFinite(progress?.itemsTotal) ? { itemsTotal: Math.max(0, Number(progress.itemsTotal)) } : {}),
        updatedAt: now(),
      };
    });
    const publicationId = nextId(sitePublicationIdPrefix);
    const previous = state.sitePublications.find((publication) => publication.id === site.activePublicationId) ?? null;
    let releaseDirectory = null;
    let remoteDeployment = null;
    try {
      releaseDirectory = writeBundle(publishRoot, site.ownerTeamId, site.id, publicationId, bundle, {
        activate: deploymentTarget.kind === "local_directory",
      });
      if (deploymentTarget.kind !== "local_directory") {
        const adapter = activeDeploymentAdapters[deploymentTargetSnapshot.kind];
        if (!adapter) throw new SiteDeploymentAdapterError("site_deployment_adapter_unavailable", "Deployment provider is not available.");
        const resolved = deploymentTargetSnapshot.kind === "ssh_static" ? { ok: true, credential: null } : await resolveCredential(deploymentTargetSnapshot.credentialRef);
        if (!resolved?.ok) throw new SiteDeploymentAdapterError(resolved?.error ?? "site_deployment_credential_unavailable", "Deployment credential is unavailable.");
        remoteDeployment = await adapter.deploy({
          target: deploymentTargetSnapshot,
          credential: resolved.credential,
          bundle,
          publicationId,
          previousPublication: previous,
          onProgress: reportProgress,
        });
      } else {
        reportProgress({ stage: "completed", completed: 4, total: 4 });
      }
    } catch (error) {
      const failure = error?.code?.startsWith?.("site_deployment_")
        ? deploymentFailure(error)
        : { error: "site_publication_write_failed", message: "Unable to prepare the site release.", retryable: false };
      runTx(() => {
        Object.assign(plan, { status: "failed", failedAt: now(), failure, progress: { ...(plan.progress ?? {}), stage: "failed", updatedAt: now() } });
        appendEvent({ invocationId: null, type: "site_publication_failed", level: failure.error === "site_deployment_recovery_failed" ? "error" : "warning", message: `Site ${site.id} publication ${publicationId} failed.`, data: { siteId: site.id, publicationId, planId: plan.id, deploymentTargetId: deploymentTarget.id, deploymentKind: deploymentTarget.kind, ...(deploymentTarget.kind === "ssh_static" ? { deploymentScopeId: deploymentTarget.remoteProjectRef } : {}), error: failure.error, retryable: failure.retryable, actorTeamId: site.ownerTeamId } });
      });
      return { ok: false, status: failure.error === "site_publication_write_failed" ? 500 : 502, body: failure };
    }
    const timestamp = now();
    const publication = {
      id: publicationId, ownerTeamId: site.ownerTeamId, siteId: site.id,
      version: Math.max(0, ...state.sitePublications.filter((row) => row.siteId === site.id).map((row) => row.version)) + 1,
      status: "active", snapshot: plan.snapshot, bundleHash: bundle.hash, manifest: bundle.manifest,
      changes: plan.changes, targetId: plan.targetId, targetKind: deploymentTarget.kind, targetRevision: deploymentTarget.revision, previousPublicationId: previous?.id ?? null,
      releaseDirectory,
      remoteDeployment,
      publicUrl: remoteDeployment?.url ?? null,
      verification: {
        status: "healthy",
        checkedAt: remoteDeployment?.verification?.checkedAt ?? timestamp,
        checkedPaths: ["index.html", "404.html", "sitemap.xml", "robots.txt"],
        ...(remoteDeployment ? { provider: deploymentTarget.kind, contentHash: remoteDeployment.verification?.contentHash ?? null } : {}),
      },
      createdAt: timestamp, activatedAt: timestamp, createdBy: userOf(actor),
    };
    runTx(() => {
      if (previous) previous.status = "superseded";
      state.sitePublications.push(publication);
      plan.status = "confirmed";
      plan.confirmedAt = timestamp;
      plan.progress = { stage: "completed", completed: 4, total: 4, updatedAt: timestamp };
      site.activePublicationId = publication.id;
      site.status = "ready";
      // A managed local release is a verified deployable artifact, not proof
      // that a public host or domain is serving it.
      site.visibility = deploymentTarget.kind === "local_directory" ? "private_preview" : "public";
      site.publicUrl = remoteDeployment?.url ?? null;
      site.revision += 1;
      site.updatedAt = timestamp;
      for (const snapshotEntry of plan.snapshot.entries) {
        const entry = state.siteEntries.find((row) => row.id === snapshotEntry.id);
        if (!entry) continue;
        entry.publishedRevisionId = snapshotEntry.revisionId;
        if (entry.status !== "archived") entry.status = "published";
        entry.updatedAt = timestamp;
      }
      appendEvent({ invocationId: null, type: "site_published", level: "info", message: `Site ${site.id} published as ${publication.id}.`, data: { siteId: site.id, publicationId: publication.id, deploymentTargetId: deploymentTarget.id, deploymentKind: deploymentTarget.kind, ...(deploymentTarget.kind === "ssh_static" ? { deploymentScopeId: deploymentTarget.remoteProjectRef } : {}), actorTeamId: site.ownerTeamId } });
    });
    return { ok: true, status: 200, body: { publication: publicationView(publication), site: siteView(site) } };
    } finally {
      inFlightSiteDeployments.delete(site.id);
    }
  }

  function listPublications({ siteId, professional = false } = {}, actor = null) {
    const site = findSite(siteId, actor);
    if (!site) return notFound();
    const publications = state.sitePublications.filter((publication) => publication.siteId === site.id && publication.ownerTeamId === site.ownerTeamId).sort((a, b) => b.version - a.version);
    return { ok: true, status: 200, body: { publications: publications.map((publication) => publicationView(publication, { professional })), count: publications.length } };
  }

  function createRollbackPlan({ siteId, targetPublicationId = null } = {}, actor = null) {
    const site = findSite(siteId, actor);
    if (!site) return notFound();
    const current = state.sitePublications.find((publication) => publication.id === site.activePublicationId);
    const target = targetPublicationId
      ? state.sitePublications.find((publication) => publication.id === String(targetPublicationId) && publication.siteId === site.id && publication.ownerTeamId === site.ownerTeamId)
      : state.sitePublications.find((publication) => publication.id === current?.previousPublicationId && publication.ownerTeamId === site.ownerTeamId);
    const deploymentTarget = targetFor(site);
    const targetDeploymentKind = target?.targetKind ?? target?.remoteDeployment?.provider ?? "local_directory";
    if (!current || !target || !deploymentTarget || target.id === current.id || target.verification?.status !== "healthy" || targetDeploymentKind !== deploymentTarget.kind) return { ok: false, status: 409, body: { error: "site_rollback_unavailable" } };
    const timestamp = now();
    const plan = {
      id: nextId(sitePublicationPlanIdPrefix), ownerTeamId: site.ownerTeamId, siteId: site.id,
      kind: "rollback", status: "planned", sourcePublicationId: current.id, targetPublicationId: target.id,
      deploymentTargetId: deploymentTarget.id, deploymentTargetKind: deploymentTarget.kind, deploymentTargetRevision: deploymentTarget.revision,
      changes: { fromVersion: current.version, toVersion: target.version }, createdAt: timestamp,
      createdBy: userOf(actor), expiresAt: new Date(Date.parse(timestamp) + 30 * 60_000).toISOString(),
    };
    runTx(() => state.sitePublicationPlans.push(plan));
    return { ok: true, status: 201, body: { plan } };
  }

  async function confirmRollbackPlan({ siteId, planId, confirmed } = {}, actor = null) {
    const site = findSite(siteId, actor);
    if (!site) return notFound();
    const plan = state.sitePublicationPlans.find((row) => row.id === String(planId) && row.siteId === site.id && row.ownerTeamId === site.ownerTeamId && row.kind === "rollback");
    if (!plan) return notFound("site_publication_plan");
    if (confirmed !== true) return { ok: false, status: 400, body: { error: "site_rollback_confirmation_required" } };
    const deploymentTarget = targetFor(site);
    if (inFlightSiteDeployments.has(site.id)) return { ok: false, status: 409, body: { error: "site_deployment_busy" } };
    if (plan.status !== "planned" || Date.parse(plan.expiresAt) <= Date.parse(now()) || site.activePublicationId !== plan.sourcePublicationId
      || !deploymentTarget || deploymentTarget.id !== plan.deploymentTargetId || deploymentTarget.kind !== plan.deploymentTargetKind || deploymentTarget.revision !== plan.deploymentTargetRevision) {
      return { ok: false, status: 409, body: { error: "site_rollback_plan_stale" } };
    }
    const current = state.sitePublications.find((publication) => publication.id === plan.sourcePublicationId);
    const target = state.sitePublications.find((publication) => publication.id === plan.targetPublicationId);
    if (!current || !target || target.verification?.status !== "healthy") return { ok: false, status: 409, body: { error: "site_rollback_unavailable" } };
    const deploymentTargetSnapshot = structuredClone(deploymentTarget);
    inFlightSiteDeployments.add(site.id);
    try {
    runTx(() => {
      plan.status = "deploying";
      plan.startedAt = now();
    });
    if (deploymentTarget?.kind !== "local_directory") {
      try {
        const adapter = activeDeploymentAdapters[deploymentTargetSnapshot.kind];
        if (!adapter?.rollback || target.remoteDeployment?.provider !== deploymentTargetSnapshot.kind) {
          throw new SiteDeploymentAdapterError("site_deployment_rollback_unavailable", "Remote rollback is unavailable for this release.");
        }
        const resolved = deploymentTargetSnapshot.kind === "ssh_static" ? { ok: true, credential: null } : await resolveCredential(deploymentTargetSnapshot.credentialRef);
        if (!resolved?.ok) throw new SiteDeploymentAdapterError(resolved?.error ?? "site_deployment_credential_unavailable", "Deployment credential is unavailable.");
        await adapter.rollback({ target: deploymentTargetSnapshot, credential: resolved.credential, publication: target });
      } catch (error) {
        const failure = deploymentFailure(error);
        runTx(() => {
          Object.assign(plan, { status: "failed", failedAt: now(), failure });
          appendEvent({ invocationId: null, type: "site_rollback_failed", level: failure.error === "site_deployment_recovery_failed" ? "error" : "warning", message: `Site ${site.id} rollback ${plan.id} failed.`, data: { siteId: site.id, planId: plan.id, sourcePublicationId: plan.sourcePublicationId, targetPublicationId: plan.targetPublicationId, deploymentTargetId: deploymentTarget.id, deploymentKind: deploymentTarget.kind, error: failure.error, retryable: failure.retryable, actorTeamId: site.ownerTeamId } });
        });
        return { ok: false, status: 502, body: failure };
      }
    }
    const timestamp = now();
    if (deploymentTarget?.kind === "local_directory" && publishRoot && target.releaseDirectory) activateRelease(target.releaseDirectory, target.id, target.bundleHash);
    runTx(() => {
      current.status = "rolled_back";
      target.status = "active";
      site.activePublicationId = target.id;
      site.status = "ready";
      site.visibility = deploymentTarget?.kind === "local_directory" ? "private_preview" : "public";
      site.publicUrl = target.remoteDeployment?.url ?? null;
      site.revision += 1;
      site.updatedAt = timestamp;
      plan.status = "confirmed";
      plan.confirmedAt = timestamp;
      for (const snapshotEntry of target.snapshot.entries) {
        const entry = state.siteEntries.find((row) => row.id === snapshotEntry.id);
        if (entry) entry.publishedRevisionId = snapshotEntry.revisionId;
      }
      appendEvent({ invocationId: null, type: "site_rolled_back", level: "warning", message: `Site ${site.id} restored to ${target.id}.`, data: { siteId: site.id, publicationId: target.id, actorTeamId: site.ownerTeamId } });
    });
    return { ok: true, status: 200, body: { publication: publicationView(target), site: siteView(site) } };
    } finally {
      inFlightSiteDeployments.delete(site.id);
    }
  }

  function listDeploymentProviders(actor = null) {
    return {
      ok: true, status: 200, body: {
        providers: listSiteDeploymentAdapters().filter((provider) => !actor?.pilotSandboxId || provider.kind === "local_directory"),
      },
    };
  }

  function configureDeploymentTarget({ siteId, expectedRevision, kind, displayName, credentialRef = null, remoteProjectRef = null, region = null, customDomain = "" } = {}, actor = null) {
    const site = findSite(siteId, actor);
    if (!site) return notFound();
    const target = targetFor(site);
    if (!target) return notFound("site_deployment_target");
    if (inFlightSiteDeployments.has(site.id)) return { ok: false, status: 409, body: { error: "site_deployment_busy" } };
    if (inFlightDomainTlsOperations.has(site.id)) return { ok: false, status: 409, body: { error: "site_domain_tls_busy" } };
    if (target.revision !== expectedRevision) return { ok: false, status: 409, body: { error: "site_deployment_target_revision_conflict", currentRevision: target.revision } };
    if (!DEPLOYMENT_KINDS.has(kind)) return { ok: false, status: 400, body: { error: "invalid_site_deployment_kind" } };
    if (actor?.pilotSandboxId && kind !== "local_directory") {
      return { ok: false, status: 403, body: { error: "site_pilot_cloud_deployment_forbidden" } };
    }
    const normalizedCredentialRef = normalizeCredentialReference(credentialRef);
    const normalizedDomain = normalizeCustomDomain(customDomain);
    if (normalizedCredentialRef === undefined) return { ok: false, status: 400, body: { error: "site_deployment_credential_reference_invalid" } };
    if (normalizedDomain === undefined) return { ok: false, status: 400, body: { error: "site_deployment_domain_invalid" } };
    if (["cloudflare_pages", "aliyun_oss_cdn"].includes(kind) && !normalizedCredentialRef) return { ok: false, status: 400, body: { error: "site_deployment_credential_required" } };
    if (kind === "cloudflare_pages" && !boundedText(remoteProjectRef, 300, { required: true })) return { ok: false, status: 400, body: { error: "site_deployment_project_required" } };
    if (kind === "aliyun_oss_cdn" && !String(remoteProjectRef ?? "").trim()) return { ok: false, status: 400, body: { error: "site_deployment_bucket_required" } };
    if (kind === "aliyun_oss_cdn" && !SAFE_OSS_BUCKET.test(String(remoteProjectRef).trim().toLowerCase())) return { ok: false, status: 400, body: { error: "site_deployment_bucket_invalid" } };
    if (kind === "aliyun_oss_cdn" && !String(region ?? "").trim()) return { ok: false, status: 400, body: { error: "site_deployment_region_required" } };
    if (kind === "aliyun_oss_cdn" && (!SAFE_OSS_REGION.test(String(region).trim().toLowerCase()) || String(region).toLowerCase().includes("internal"))) return { ok: false, status: 400, body: { error: "site_deployment_region_invalid" } };
    if (kind === "aliyun_oss_cdn" && !normalizedDomain) return { ok: false, status: 400, body: { error: "site_deployment_domain_required" } };
    const sshScope = kind === "ssh_static"
      ? state.hostFileScopes?.find((scope) => scope.id === String(remoteProjectRef ?? "").trim() && scope.ownerTeamId === site.ownerTeamId) ?? null
      : null;
    if (kind === "ssh_static" && !sshScope) return { ok: false, status: 400, body: { error: "site_deployment_ssh_scope_required" } };
    if (kind === "ssh_static" && (sshScope.purpose !== "site_publish" || sshScope.status !== "ready" || !sshScope.permissions?.includes("upload") || !sshScope.permissions?.includes("download"))) {
      return { ok: false, status: 409, body: { error: "site_deployment_ssh_scope_not_ready" } };
    }
    const sshHost = kind === "ssh_static"
      ? state.sshTargets?.find((host) => host.id === sshScope.sshTargetId && host.ownerTeamId === site.ownerTeamId) ?? null
      : null;
    if (kind === "ssh_static" && (!sshHost || sshHost.connectionStatus !== "ready" || !sshHost.purposes?.includes("site_publish") || !sshHost.capabilities?.sftp)) {
      return { ok: false, status: 409, body: { error: "site_deployment_ssh_host_not_ready" } };
    }
    if (kind === "ssh_static" && (!sshHost.capabilities.posixRename || !sshHost.capabilities.symlink)) {
      return { ok: false, status: 409, body: { error: "site_deployment_ssh_atomic_capability_required" } };
    }
    if (kind === "ssh_static" && !normalizedDomain) return { ok: false, status: 400, body: { error: "site_deployment_domain_required" } };
    const storedCredentialRef = ["cloudflare_pages", "aliyun_oss_cdn"].includes(kind) ? normalizedCredentialRef : null;
    const timestamp = now();
    const previousRemoteProjectRef = target.remoteProjectRef ?? null;
    const binding = domainTlsFor(site);
    const bindingInvalidated = binding && (kind !== "ssh_static" || binding.hostname !== normalizedDomain || previousRemoteProjectRef !== (boundedText(remoteProjectRef, 300) || null));
    if (bindingInvalidated) domainTlsAdapter?.discardStagingArtifact?.(binding.id);
    runTx(() => {
      Object.assign(target, {
        kind, displayName: boundedText(displayName, 120) || target.displayName, credentialRef: storedCredentialRef,
        remoteProjectRef: boundedText(remoteProjectRef, 300) || null, region: boundedText(region, 100) || null,
        customDomain: normalizedDomain, capabilities: siteDeploymentProviderCapabilities[kind],
        status: kind === "local_directory" ? "ready" : "setup", lastVerifiedAt: kind === "local_directory" ? timestamp : null,
        verification: null, lastError: null, revision: target.revision + 1, updatedAt: timestamp,
      });
      if (bindingInvalidated) {
        Object.assign(binding, { certificateScopeId: null, activationProfileId: null });
        if (binding.certificateEnvironment === "staging") Object.assign(binding, {
          certificateEnvironment: null, certificateFingerprint: null, certificateIssuer: null, certificateSans: [],
          certificateNotBefore: null, stagingIssuedAt: null, stagingDeployedAt: null, certificateReleaseId: null,
          renewAfter: null, notAfter: null, lastCleanupRecordDigest: null,
        });
        Object.assign(binding, kind === "ssh_static" ? {
          status: "needs_attention",
          lastFailure: { error: "site_domain_target_changed", message: "The server publishing target changed. Review and verify domain and HTTPS setup again.", retryable: false },
          lastVerifiedAt: null,
          revision: binding.revision + 1,
          updatedAt: timestamp,
        } : {
          status: "disabled",
          lastFailure: null,
          lastVerifiedAt: null,
          revision: binding.revision + 1,
          updatedAt: timestamp,
        });
      }
    });
    return { ok: true, status: 200, body: { site: siteView(site, { professional: true }) } };
  }

  function configureDomainTlsBinding({ siteId, expectedRevision, hostname, accessMode = "public" } = {}, actor = null) {
    const site = findSite(siteId, actor);
    if (!site) return notFound();
    if (inFlightDomainTlsOperations.has(site.id)) return { ok: false, status: 409, body: { error: "site_domain_tls_busy" } };
    const target = targetFor(site);
    if (!target || target.kind !== "ssh_static") return { ok: false, status: 409, body: { error: "site_domain_ssh_target_required" } };
    const current = domainTlsFor(site);
    const expected = current?.revision ?? 0;
    if (!Number.isInteger(expectedRevision)) return { ok: false, status: 400, body: { error: "expected_revision_required", currentRevision: expected } };
    if (expectedRevision !== expected) return { ok: false, status: 409, body: { error: "site_domain_tls_revision_conflict", currentRevision: expected } };
    const normalizedHostname = normalizeCustomDomain(hostname);
    if (!normalizedHostname) return { ok: false, status: 400, body: { error: "site_domain_hostname_invalid" } };
    if (normalizedHostname !== target.customDomain) return { ok: false, status: 409, body: { error: "site_domain_target_hostname_mismatch" } };
    if (!DOMAIN_TLS_ACCESS_MODES.has(accessMode)) return { ok: false, status: 400, body: { error: "site_domain_access_mode_invalid" } };
    const scope = state.hostFileScopes?.find((candidate) => candidate.id === target.remoteProjectRef && candidate.ownerTeamId === site.ownerTeamId) ?? null;
    const host = scope ? state.sshTargets?.find((candidate) => candidate.id === scope.sshTargetId && candidate.ownerTeamId === site.ownerTeamId) ?? null : null;
    if (!scope || scope.status !== "ready" || scope.purpose !== "site_publish" || !host || host.connectionStatus !== "ready") {
      return { ok: false, status: 409, body: { error: "site_domain_ssh_target_not_ready" } };
    }
    if (accessMode === "private_lan" && host.networkPolicy !== "allow_private_network") {
      return { ok: false, status: 409, body: { error: "site_domain_private_network_not_allowed" } };
    }
    if (accessMode === "private_lan" && classifySshAddress(scope.lastResolvedAddress) !== "private") {
      return { ok: false, status: 409, body: { error: "site_domain_private_address_required" } };
    }
    if (current && current.hostname === normalizedHostname && current.accessMode === accessMode && current.deploymentTargetId === target.id) {
      return { ok: true, status: 200, body: { site: siteView(site, { professional: true }), binding: domainTlsView(current, { professional: true }) } };
    }
    const timestamp = now();
    let binding;
    const currentWasActive = current?.status === "active";
    if (current) domainTlsAdapter?.discardStagingArtifact?.(current.id);
    runTx(() => {
      if (current) {
        Object.assign(current, {
          deploymentTargetId: target.id,
          hostname: normalizedHostname,
          accessMode,
          status: currentWasActive ? "needs_attention" : "setup",
          lastVerifiedAt: null,
          lastFailure: currentWasActive
            ? { error: "site_domain_binding_changed", message: "Domain or access mode changed. Issue and verify a matching certificate before continuing.", retryable: false }
            : null,
          revision: current.revision + 1,
          updatedAt: timestamp,
        });
        if (!currentWasActive) Object.assign(current, {
          dnsZone: null, certificateEnvironment: null, certificateFingerprint: null, certificateIssuer: null, certificateSans: [],
          certificateNotBefore: null, stagingIssuedAt: null, stagingDeployedAt: null, certificateReleaseId: null,
          renewAfter: null, notAfter: null, lastCleanupRecordDigest: null,
        });
        binding = current;
        return;
      }
      binding = {
        id: nextId(siteDomainTlsBindingIdPrefix),
        ownerTeamId: site.ownerTeamId,
        siteId: site.id,
        deploymentTargetId: target.id,
        hostname: normalizedHostname,
        accessMode,
        dnsProvider: "alidns",
        dnsCredentialRef: "credential://alidns/main",
        challenge: "dns-01",
        dnsZone: null,
        certificateScopeId: null,
        activationProfileId: null,
        status: "setup",
        certificateEnvironment: null,
        certificateFingerprint: null,
        certificateIssuer: null,
        certificateSans: [],
        certificateNotBefore: null,
        stagingIssuedAt: null,
        stagingDeployedAt: null,
        certificateReleaseId: null,
        lastCleanupRecordDigest: null,
        lastVerifiedAt: null,
        renewAfter: null,
        notAfter: null,
        lastFailure: null,
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      state.siteDomainTlsBindings.push(binding);
      appendEvent({ invocationId: null, type: "site_domain_tls_configured", level: "info", message: `Domain and HTTPS setup was configured for site ${site.id}.`, data: { siteId: site.id, bindingId: binding.id, deploymentTargetId: target.id, accessMode, actorTeamId: site.ownerTeamId } });
    });
    return { ok: true, status: current ? 200 : 201, body: { site: siteView(site, { professional: true }), binding: domainTlsView(binding, { professional: true }) } };
  }

  async function verifyDomainTlsDns({ siteId, expectedRevision } = {}, actor = null) {
    const site = findSite(siteId, actor);
    if (!site) return notFound();
    const binding = domainTlsFor(site);
    if (!binding) return notFound("site_domain_tls_binding");
    if (!Number.isInteger(expectedRevision)) return { ok: false, status: 400, body: { error: "expected_revision_required", currentRevision: binding.revision } };
    if (binding.revision !== expectedRevision) return { ok: false, status: 409, body: { error: "site_domain_tls_revision_conflict", currentRevision: binding.revision } };
    if (!domainTlsAdapter?.verifyDns) return { ok: false, status: 501, body: { error: "site_domain_tls_adapter_unavailable" } };
    if (inFlightDomainTlsOperations.has(site.id)) return { ok: false, status: 409, body: { error: "site_domain_tls_busy" } };
    inFlightDomainTlsOperations.add(site.id);
    try {
      const resolved = await resolveCredential(binding.dnsCredentialRef);
      if (!resolved?.ok) return { ok: false, status: 409, body: { error: "site_domain_dns_credential_unavailable" } };
      const verification = await domainTlsAdapter.verifyDns({ hostname: binding.hostname, credential: resolved.credential });
      const timestamp = now();
      runTx(() => Object.assign(binding, {
        dnsZone: verification.zone,
        status: "dns_ready",
        lastVerifiedAt: timestamp,
        lastFailure: null,
        lastCleanupRecordDigest: null,
        revision: binding.revision + 1,
        updatedAt: timestamp,
      }));
      appendEvent({ invocationId: null, type: "site_domain_dns_verified", level: "info", message: `AliDNS access was verified for site ${site.id}.`, data: { siteId: site.id, bindingId: binding.id, deploymentTargetId: binding.deploymentTargetId, actorTeamId: site.ownerTeamId } });
      return { ok: true, status: 200, body: { site: siteView(site, { professional: true }), binding: domainTlsView(binding, { professional: true }) } };
    } catch (error) {
      const failure = domainTlsFailure(error);
      const timestamp = now();
      runTx(() => Object.assign(binding, {
        status: "needs_attention",
        lastFailure: { error: failure.error, message: failure.message, retryable: failure.retryable },
        lastCleanupRecordDigest: failure.cleanupRecordDigest,
        revision: binding.revision + 1,
        updatedAt: timestamp,
      }));
      return { ok: false, status: failure.retryable ? 503 : 409, body: { ...failure, currentRevision: binding.revision } };
    } finally {
      inFlightDomainTlsOperations.delete(site.id);
    }
  }

  async function issueDomainTlsStaging({ siteId, expectedRevision, confirmed = false } = {}, actor = null) {
    const site = findSite(siteId, actor);
    if (!site) return notFound();
    const binding = domainTlsFor(site);
    if (!binding) return notFound("site_domain_tls_binding");
    if (!Number.isInteger(expectedRevision)) return { ok: false, status: 400, body: { error: "expected_revision_required", currentRevision: binding.revision } };
    if (binding.revision !== expectedRevision) return { ok: false, status: 409, body: { error: "site_domain_tls_revision_conflict", currentRevision: binding.revision } };
    if (confirmed !== true) return { ok: false, status: 400, body: { error: "site_domain_staging_confirmation_required" } };
    if (binding.status !== "dns_ready") return { ok: false, status: 409, body: { error: "site_domain_dns_verification_required" } };
    if (!domainTlsAdapter?.issueStaging) return { ok: false, status: 501, body: { error: "site_domain_tls_adapter_unavailable" } };
    if (inFlightDomainTlsOperations.has(site.id)) return { ok: false, status: 409, body: { error: "site_domain_tls_busy" } };
    const contactEmail = String(site.settings?.contactEmail ?? "").trim();
    if (!contactEmail) return { ok: false, status: 409, body: { error: "site_domain_acme_contact_required" } };
    inFlightDomainTlsOperations.add(site.id);
    const startedAt = now();
    runTx(() => Object.assign(binding, { status: "issuing", lastFailure: null, revision: binding.revision + 1, updatedAt: startedAt }));
    try {
      const resolved = await resolveCredential(binding.dnsCredentialRef);
      if (!resolved?.ok) throw new SiteDomainTlsAdapterError("site_domain_dns_credential_unavailable", "The AliDNS credential is unavailable.");
      const result = await domainTlsAdapter.issueStaging({ bindingId: binding.id, hostname: binding.hostname, contactEmail, credential: resolved.credential });
      const timestamp = now();
      const notAfter = new Date(result.notAfter);
      const renewAfter = new Date(notAfter.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const cleanupFailed = result.cleanup?.ok === false;
      runTx(() => Object.assign(binding, {
        status: cleanupFailed ? "needs_attention" : "staging_ready",
        certificateEnvironment: "staging",
        certificateFingerprint: result.fingerprint,
        certificateIssuer: result.issuer,
        certificateSans: result.sans,
        certificateNotBefore: result.notBefore,
        stagingIssuedAt: timestamp,
        renewAfter,
        notAfter: result.notAfter,
        lastVerifiedAt: timestamp,
        lastCleanupRecordDigest: cleanupFailed ? result.cleanup.recordDigest : null,
        lastFailure: cleanupFailed ? { error: "site_domain_txt_cleanup_failed", message: "The staging certificate was issued, but its temporary DNS record could not be removed.", retryable: true } : null,
        revision: binding.revision + 1,
        updatedAt: timestamp,
      }));
      appendEvent({ invocationId: null, type: "site_domain_staging_certificate_issued", level: cleanupFailed ? "warning" : "info", message: `A staging certificate was issued for site ${site.id}.`, data: { siteId: site.id, bindingId: binding.id, deploymentTargetId: binding.deploymentTargetId, cleanupSucceeded: !cleanupFailed, actorTeamId: site.ownerTeamId } });
      return { ok: true, status: 200, body: { site: siteView(site, { professional: true }), binding: domainTlsView(binding, { professional: true }) } };
    } catch (error) {
      const failure = domainTlsFailure(error);
      const timestamp = now();
      runTx(() => Object.assign(binding, {
        status: "needs_attention",
        lastFailure: { error: failure.error, message: failure.message, retryable: failure.retryable },
        lastCleanupRecordDigest: failure.cleanupRecordDigest,
        revision: binding.revision + 1,
        updatedAt: timestamp,
      }));
      return { ok: false, status: failure.retryable ? 503 : 409, body: { ...failure, currentRevision: binding.revision } };
    } finally {
      inFlightDomainTlsOperations.delete(site.id);
    }
  }

  function configureDomainTlsDeployment({ siteId, expectedRevision, certificateScopeId, activationProfileId } = {}, actor = null) {
    const site = findSite(siteId, actor);
    if (!site) return notFound();
    const binding = domainTlsFor(site);
    if (!binding) return notFound("site_domain_tls_binding");
    if (!Number.isInteger(expectedRevision)) return { ok: false, status: 400, body: { error: "expected_revision_required", currentRevision: binding.revision } };
    if (binding.revision !== expectedRevision) return { ok: false, status: 409, body: { error: "site_domain_tls_revision_conflict", currentRevision: binding.revision } };
    if (inFlightDomainTlsOperations.has(site.id)) return { ok: false, status: 409, body: { error: "site_domain_tls_busy" } };
    const target = targetFor(site);
    const publishScope = target ? state.hostFileScopes.find((item) => item.id === target.remoteProjectRef && item.ownerTeamId === site.ownerTeamId) : null;
    const scope = state.hostFileScopes.find((item) => item.id === String(certificateScopeId ?? "") && item.ownerTeamId === site.ownerTeamId) ?? null;
    const profile = state.hostTlsActivationProfiles?.find((item) => item.id === String(activationProfileId ?? "") && item.ownerTeamId === site.ownerTeamId) ?? null;
    const host = scope ? state.sshTargets.find((item) => item.id === scope.sshTargetId && item.ownerTeamId === site.ownerTeamId) ?? null : null;
    if (!target || target.kind !== "ssh_static" || !publishScope || !scope || !profile || !host) return { ok: false, status: 409, body: { error: "site_tls_deployment_configuration_incomplete" } };
    if (scope.purpose !== "tls_certificate" || scope.status !== "ready" || !scope.permissions?.includes("certificate_write")) return { ok: false, status: 409, body: { error: "site_tls_certificate_scope_not_ready" } };
    if (profile.status !== "ready" || profile.type !== "docker_nginx" || profile.sshTargetId !== host.id || profile.certificateScopeId !== scope.id) return { ok: false, status: 409, body: { error: "site_tls_activation_profile_not_ready" } };
    if (publishScope.sshTargetId !== host.id || publishScope.lastResolvedAddress !== scope.lastResolvedAddress) return { ok: false, status: 409, body: { error: "site_tls_host_binding_mismatch" } };
    if (host.connectionStatus !== "ready" || !host.purposes?.some((purpose) => ["site_publish", "tls_certificate"].includes(purpose)) || !host.capabilities?.sftp || !host.capabilities?.posixRename || !host.capabilities?.symlink) return { ok: false, status: 409, body: { error: "site_tls_host_not_ready" } };
    const timestamp = now();
    runTx(() => Object.assign(binding, {
      certificateScopeId: scope.id,
      activationProfileId: profile.id,
      lastFailure: binding.lastFailure?.error?.startsWith("site_tls_") ? null : binding.lastFailure,
      revision: binding.revision + 1,
      updatedAt: timestamp,
    }));
    appendEvent({ invocationId: null, type: "site_domain_tls_deployment_configured", level: "info", message: `Controlled TLS deployment was configured for site ${site.id}.`, data: { siteId: site.id, bindingId: binding.id, certificateScopeId: scope.id, activationProfileId: profile.id, actorTeamId: site.ownerTeamId } });
    return { ok: true, status: 200, body: { site: siteView(site, { professional: true }), binding: domainTlsView(binding, { professional: true }) } };
  }

  async function deployDomainTlsStaging({ siteId, expectedRevision, confirmed = false } = {}, actor = null) {
    const site = findSite(siteId, actor);
    if (!site) return notFound();
    const binding = domainTlsFor(site);
    if (!binding) return notFound("site_domain_tls_binding");
    if (!Number.isInteger(expectedRevision)) return { ok: false, status: 400, body: { error: "expected_revision_required", currentRevision: binding.revision } };
    if (binding.revision !== expectedRevision) return { ok: false, status: 409, body: { error: "site_domain_tls_revision_conflict", currentRevision: binding.revision } };
    if (confirmed !== true) return { ok: false, status: 400, body: { error: "site_tls_staging_deployment_confirmation_required" } };
    if (binding.status !== "staging_ready" || binding.certificateEnvironment !== "staging" || binding.lastCleanupRecordDigest) return { ok: false, status: 409, body: { error: "site_domain_staging_certificate_required" } };
    if (!binding.certificateScopeId || !binding.activationProfileId) return { ok: false, status: 409, body: { error: "site_tls_deployment_configuration_incomplete" } };
    if (!domainTlsAdapter?.withStagingArtifact || !tlsCertificateAdapter?.deployStaging) return { ok: false, status: 501, body: { error: "site_tls_deployment_adapter_unavailable" } };
    if (!domainTlsAdapter.hasStagingArtifact?.(binding.id, binding.certificateFingerprint)) return { ok: false, status: 409, body: { error: "site_domain_staging_artifact_unavailable" } };
    if (inFlightDomainTlsOperations.has(site.id)) return { ok: false, status: 409, body: { error: "site_domain_tls_busy" } };
    inFlightDomainTlsOperations.add(site.id);
    runTx(() => Object.assign(binding, { status: "deploying", lastFailure: null, revision: binding.revision + 1, updatedAt: now() }));
    try {
      const deployment = await domainTlsAdapter.withStagingArtifact(binding.id, binding.certificateFingerprint, (artifact) => tlsCertificateAdapter.deployStaging({ binding: structuredClone(binding), artifact }));
      const timestamp = now();
      runTx(() => Object.assign(binding, {
        status: "staging_deployed", stagingDeployedAt: timestamp, certificateReleaseId: deployment.releaseId,
        lastVerifiedAt: timestamp, lastFailure: null, revision: binding.revision + 1, updatedAt: timestamp,
      }));
      domainTlsAdapter.discardStagingArtifact(binding.id);
      appendEvent({ invocationId: null, type: "site_domain_staging_certificate_deployed", level: "info", message: `A staging certificate was atomically activated and verified for site ${site.id}.`, data: { siteId: site.id, bindingId: binding.id, certificateReleaseId: deployment.releaseId, activationProfileId: deployment.activationProfileId, actorTeamId: site.ownerTeamId } });
      return { ok: true, status: 200, body: { site: siteView(site, { professional: true }), binding: domainTlsView(binding, { professional: true }) } };
    } catch (error) {
      const failure = domainTlsFailure(error);
      const recoveryFailed = failure.error === "site_tls_recovery_failed";
      const timestamp = now();
      runTx(() => Object.assign(binding, {
        status: recoveryFailed ? "needs_attention" : "staging_ready",
        lastFailure: { error: failure.error, message: failure.message, retryable: failure.retryable },
        revision: binding.revision + 1, updatedAt: timestamp,
      }));
      return { ok: false, status: recoveryFailed ? 409 : failure.retryable ? 503 : 409, body: { ...failure, currentRevision: binding.revision } };
    } finally {
      inFlightDomainTlsOperations.delete(site.id);
    }
  }

  async function verifyDeploymentTarget({ siteId } = {}, actor = null) {
    const site = findSite(siteId, actor);
    if (!site) return notFound();
    const target = targetFor(site);
    if (!target) return notFound("site_deployment_target");
    if (inFlightSiteDeployments.has(site.id)) return { ok: false, status: 409, body: { error: "site_deployment_busy" } };
    if (actor?.pilotSandboxId && target.kind !== "local_directory") {
      return { ok: false, status: 403, body: { error: "site_pilot_cloud_deployment_forbidden" } };
    }
    const timestamp = now();
    if (target.kind === "local_directory") {
      runTx(() => Object.assign(target, { status: "ready", lastVerifiedAt: timestamp, verification: { provider: "local_directory" }, lastError: null, updatedAt: timestamp }));
      return { ok: true, status: 200, body: { site: siteView(site, { professional: true }), verification: target.verification } };
    }
    const adapter = activeDeploymentAdapters[target.kind];
    if (!adapter?.verifyConnection) return { ok: false, status: 409, body: { error: "site_deployment_adapter_unavailable" } };
    const targetSnapshot = structuredClone(target);
    inFlightSiteDeployments.add(site.id);
    try {
      const resolved = targetSnapshot.kind === "ssh_static" ? { ok: true, credential: null } : await resolveCredential(targetSnapshot.credentialRef);
      if (!resolved?.ok) throw new SiteDeploymentAdapterError(resolved?.error ?? "site_deployment_credential_unavailable", "Deployment credential is unavailable.");
      const verification = await adapter.verifyConnection({ target: targetSnapshot, credential: resolved.credential });
      const verifiedAt = now();
      runTx(() => Object.assign(target, { status: "ready", lastVerifiedAt: verifiedAt, verification, lastError: null, updatedAt: verifiedAt }));
      return { ok: true, status: 200, body: { site: siteView(site, { professional: true }), verification } };
    } catch (error) {
      const failure = deploymentFailure(error);
      runTx(() => Object.assign(target, { status: "error", lastError: failure, updatedAt: now() }));
      return { ok: false, status: 502, body: failure };
    } finally {
      inFlightSiteDeployments.delete(site.id);
    }
  }

  async function provisionPilotSandbox({ scenario, fixtureStatus = "private" } = {}, actor = null) {
    if (!actor?.pilotSandboxId || !String(teamOf(actor)).startsWith("pilot_sandbox_")) {
      return { ok: false, status: 403, body: { error: "site_pilot_sandbox_context_required" } };
    }
    const existing = state.sites.find((site) => site.ownerTeamId === teamOf(actor) && site.status !== "disabled") ?? null;
    if (existing || scenario === "first_setup") {
      return { ok: true, status: 200, body: { site: existing ? siteView(existing) : null } };
    }
    const created = createSite({
      name: scenario === "content_maintenance" ? "山岚工作室" : "试用示例官网",
      description: scenario === "content_maintenance" ? "为成长中的团队提供品牌与内容服务" : "用于判断网站上线状态的示例站点",
      audience: "希望快速了解服务的访客",
      primaryAction: "联系我们",
      contactEmail: "",
      theme: "ocean",
    }, actor);
    if (!created.ok) return created;
    const needsLocalBaseline = scenario === "content_maintenance"
      || (scenario === "status_understanding" && fixtureStatus !== "private");
    if (!needsLocalBaseline) return created;
    const plan = createPublicationPlan({ siteId: created.body.site.id }, actor);
    if (!plan.ok) return plan;
    const published = await confirmPublicationPlan({ siteId: created.body.site.id, planId: plan.body.plan.id, confirmed: true }, actor);
    if (!published.ok || scenario === "content_maintenance" || fixtureStatus !== "public") return published;
    const site = findSite(created.body.site.id, actor);
    const publication = site ? state.sitePublications.find((candidate) => candidate.id === site.activePublicationId) ?? null : null;
    const timestamp = now();
    runTx(() => {
      if (!site) return;
      site.visibility = "public";
      site.publicUrl = `https://${site.id}.pilot.invalid/`;
      site.updatedAt = timestamp;
      if (publication) publication.publicUrl = site.publicUrl;
    });
    return { ok: true, status: 200, body: { site: siteView(site) } };
  }

  function purgePilotSandbox(actor = null) {
    const ownerTeamId = teamOf(actor);
    if (!actor?.pilotSandboxId || !/^pilot_sandbox_[A-Za-z0-9_-]+$/.test(ownerTeamId)) {
      return { ok: false, status: 403, body: { error: "site_pilot_sandbox_context_required" } };
    }
    const assets = state.siteAssets.filter((asset) => asset.ownerTeamId === ownerTeamId);
    for (const binding of state.siteDomainTlsBindings.filter((candidate) => candidate.ownerTeamId === ownerTeamId)) {
      domainTlsAdapter?.discardStagingArtifact?.(binding.id);
    }
    for (const asset of assets) {
      try { assetStorage.remove(asset.storageKey); } catch { /* stale sandbox files must not block record cleanup */ }
      for (const derivative of asset.derivatives ?? []) {
        try { assetStorage.remove(derivative.storageKey); } catch { /* stale sandbox files must not block record cleanup */ }
      }
    }
    runTx(() => {
      for (const key of ["sites", "siteEntries", "siteEntryRevisions", "siteAssets", "sitePublicationPlans", "sitePublications", "siteDeploymentTargets", "siteDomainTlsBindings"]) {
        state[key] = state[key].filter((row) => row.ownerTeamId !== ownerTeamId);
      }
    });
    if (publishRoot) {
      const base = resolve(publishRoot);
      const target = resolve(base, ownerTeamId);
      if (target.startsWith(`${base}${sep}`) && existsSync(target)) rmSync(target, { recursive: true, force: true });
    }
    return { ok: true, status: 200, body: { deleted: true } };
  }

  return {
    listSites,
    getSite,
    createSite,
    updateSite,
    listEntries,
    getEntry,
    createEntry,
    updateEntry,
    listAssets,
    uploadAsset,
    updateAsset,
    deleteAsset,
    getAssetContent,
    previewSite,
    createPublicationPlan,
    getPublicationPlan,
    confirmPublicationPlan,
    listPublications,
    createRollbackPlan,
    confirmRollbackPlan,
    listDeploymentProviders,
    configureDeploymentTarget,
    verifyDeploymentTarget,
    configureDomainTlsBinding,
    configureDomainTlsDeployment,
    verifyDomainTlsDns,
    issueDomainTlsStaging,
    deployDomainTlsStaging,
    provisionPilotSandbox,
    purgePilotSandbox,
  };
}
