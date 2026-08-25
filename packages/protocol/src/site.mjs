export const siteIdPrefix = "sit";
export const siteEntryIdPrefix = "sen";
export const siteRevisionIdPrefix = "srv";
export const sitePublicationIdPrefix = "spb";
export const sitePublicationPlanIdPrefix = "spp";
export const siteDeploymentTargetIdPrefix = "sdt";
export const siteAssetIdPrefix = "sat";
export const siteDomainTlsBindingIdPrefix = "stb";

export const siteEntryTypes = ["page", "article", "case"];
export const siteEntryStatuses = ["draft", "ready", "published", "archived"];
export const siteBlockTypes = [
  "hero",
  "rich_text",
  "service_cards",
  "case_cards",
  "article_list",
  "gallery",
  "metrics",
  "faq",
  "contact",
  "cta",
];
export const siteDeploymentKinds = ["local_directory", "cloudflare_pages", "aliyun_oss_cdn", "ssh_static"];
export const siteDomainTlsAccessModes = ["public", "private_lan"];
export const siteDomainTlsStatuses = ["setup", "dns_ready", "issuing", "deploying", "active", "renewal_due", "needs_attention", "disabled"];

export const siteBounds = {
  maxNameLength: 120,
  maxDescriptionLength: 500,
  maxEntryTitleLength: 200,
  maxEntrySummaryLength: 500,
  maxSlugLength: 120,
  maxEntries: 1000,
  maxBlocksPerEntry: 100,
  maxBlockBytes: 256 * 1024,
  maxSiteDraftBytes: 10 * 1024 * 1024,
  maxAssets: 200,
  maxAssetBytes: 10 * 1024 * 1024,
  maxAssetTotalBytes: 500 * 1024 * 1024,
};

export const siteDeploymentProviderCapabilities = {
  local_directory: {
    previewUrl: false,
    atomicActivation: true,
    nativeRollback: true,
    customDomain: false,
    httpsManaged: false,
  },
  cloudflare_pages: {
    previewUrl: true,
    atomicActivation: true,
    nativeRollback: true,
    customDomain: true,
    httpsManaged: true,
  },
  aliyun_oss_cdn: {
    previewUrl: false,
    atomicActivation: true,
    nativeRollback: true,
    customDomain: true,
    httpsManaged: true,
  },
  ssh_static: {
    previewUrl: false,
    atomicActivation: true,
    nativeRollback: true,
    customDomain: true,
    httpsManaged: false,
  },
};
