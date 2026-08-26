export type SiteEntryType = "page" | "article" | "case";
export type SiteEntryStatus = "draft" | "ready" | "published" | "archived";
export type SiteBlockType =
  | "hero" | "rich_text" | "service_cards" | "case_cards" | "article_list"
  | "gallery" | "metrics" | "faq" | "contact" | "cta";

export interface SiteBlock {
  id: string;
  type: SiteBlockType;
  data: Record<string, unknown>;
  hidden?: boolean;
}

export interface SiteEntry {
  id: string;
  siteId: string;
  type: SiteEntryType;
  locale?: "zh-CN" | "en-US";
  translationOf?: string | null;
  slug: string;
  title: string;
  summary: string;
  status: SiteEntryStatus;
  draftRevisionId: string;
  publishedRevisionId: string | null;
  revision: number;
  hasUnpublishedChanges: boolean;
  blocks?: SiteBlock[];
  updatedAt: string;
}

export interface SiteAsset {
  id: string;
  siteId: string;
  name: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  extension: "png" | "jpg" | "webp";
  size: number;
  altText: string;
  caption: string;
  status: "ready" | "error";
  width?: number | null;
  height?: number | null;
  focalPoint?: { x: number; y: number };
  derivativeStatus?: "ready" | "unavailable";
  derivatives?: Array<{ key: string; width: number; height: number; mimeType: "image/webp"; extension: "webp"; size: number; sha256?: string }>;
  revision: number;
  sha256?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SiteDeploymentTarget {
  id: string;
  kind: SiteDeploymentKind;
  status: "ready" | "setup" | "error" | "disabled";
  displayName: string;
  capabilities: Record<string, boolean>;
  lastVerifiedAt: string | null;
  revision?: number;
  remoteProjectRef?: string | null;
  region?: string | null;
  credentialRef?: string | null;
  customDomain?: string;
  verification?: { provider?: string; projectName?: string; publicUrl?: string | null; [key: string]: unknown } | null;
  lastError?: { error: string; message: string; retryable?: boolean } | null;
}

export type SiteDomainTlsAccessMode = "public" | "private_lan";
export type SiteDomainTlsStatus = "setup" | "dns_ready" | "issuing" | "staging_ready" | "deploying" | "staging_deployed" | "active" | "renewal_due" | "needs_attention" | "disabled";

export interface SiteDomainTlsBinding {
  hostname: string;
  accessMode: SiteDomainTlsAccessMode;
  status: SiteDomainTlsStatus;
  lastVerifiedAt: string | null;
  renewAfter: string | null;
  notAfter: string | null;
  id?: string;
  deploymentTargetId?: string;
  dnsProvider?: "alidns";
  dnsCredentialRef?: "credential://alidns/main";
  challenge?: "dns-01";
  dnsZone?: string | null;
  certificateScopeId?: string | null;
  activationProfileId?: string | null;
  certificateEnvironment?: "staging" | "production" | null;
  certificateFingerprint?: string | null;
  certificateIssuer?: string | null;
  certificateSans?: string[];
  certificateNotBefore?: string | null;
  stagingIssuedAt?: string | null;
  stagingDeployedAt?: string | null;
  certificateReleaseId?: string | null;
  lastCleanupRecordDigest?: string | null;
  lastFailure?: { error: string; message: string; retryable?: boolean } | null;
  revision?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface SitePublication {
  id: string;
  version: number;
  status: "active" | "superseded" | "rolled_back";
  bundleHash: string;
  createdAt: string;
  activatedAt: string;
  previousPublicationId: string | null;
  verification: { status: string; checkedAt: string };
  remoteDeployment?: {
    provider?: SiteDeploymentKind;
    releaseId?: string;
    remoteReleasePath?: string;
    activePointerPath?: string;
    fileCount?: number;
    bytes?: number;
    bundleHash?: string;
    url?: string;
    verification?: { checkedAt?: string; contentHash?: string };
    [key: string]: unknown;
  } | null;
}

export interface Site {
  id: string;
  name: string;
  description: string;
  audience: string;
  primaryAction: string;
  defaultLocale: "zh-CN" | "en-US";
  status: "setup" | "ready" | "publishing" | "degraded" | "disabled";
  visibility: "private_preview" | "public";
  publicUrl?: string | null;
  activePublicationId: string | null;
  settings: {
    logoUrl?: string;
    logoAssetId?: string | null;
    theme?: "ocean" | "ink" | "warm";
    brandColor?: string;
    contactEmail?: string;
    footerText?: string;
    supportedLocales?: Array<"zh-CN" | "en-US">;
    [key: string]: unknown;
  };
  navigation: Record<string, unknown>;
  revision: number;
  updatedAt: string;
  entries: SiteEntry[];
  unpublishedCount: number;
  assetCount?: number;
  activePublication: SitePublication | null;
  deploymentTarget: SiteDeploymentTarget | null;
  domainTlsBinding?: SiteDomainTlsBinding | null;
}

export interface PublicationPlan {
  id: string;
  kind: "publish" | "rollback";
  status: "planned" | "deploying" | "confirmed" | "failed";
  changes: { added?: string[]; changed?: string[]; removed?: string[]; assetsChanged?: string[]; siteChanged?: boolean; fromVersion?: number; toVersion?: number };
  checks?: { errors: string[]; warnings: string[]; fileCount: number; bytes: number };
  progress?: { stage: string; completed: number; total: number; itemsCompleted?: number; itemsTotal?: number; updatedAt: string };
  expiresAt: string;
}

export type SiteDeploymentKind = "local_directory" | "cloudflare_pages" | "aliyun_oss_cdn" | "ssh_static";

export interface SiteDeploymentProvider {
  kind: SiteDeploymentKind;
  ordinaryLabel: string;
  productionReady: boolean;
  professionalOnly: boolean;
  connectionKind: "none" | "credential_reference" | "host_file_scope_reference";
  setupFlow: string[];
  capabilities: Record<string, boolean>;
}

export type SitePilotScenario = "first_setup" | "content_maintenance" | "status_understanding";
export type SitePilotMilestone =
  | "site_created" | "content_saved" | "preview_opened" | "publication_reviewed" | "published"
  | "go_live_handoff_opened" | "go_live_handoff_completed" | "professional_setup_opened";
export type SiteStatusAnswer = "private" | "local" | "public" | "unsure";

export interface SitePilotWorkspace {
  isolated: true;
  expiresAt: string;
  status: "unprovisioned" | "ready";
}

export interface SitePilotSession {
  id: string;
  scenario: SitePilotScenario;
  status: "active" | "completed" | "abandoned";
  milestones: Array<{ key: SitePilotMilestone; at: string }>;
  outcome: {
    taskCompleted: boolean | null;
    independent: boolean | null;
    statusAnswer: SiteStatusAnswer | null;
    statusCorrect: boolean | null;
    easeRating: number;
  } | null;
  revision: number;
  startedAt: string;
  completedAt: string | null;
  abandonedAt: string | null;
}

export interface SitePilotMetric {
  numerator: number;
  denominator: number;
  rate: number | null;
}

export interface SitePilotSummary {
  sampleCount: number;
  activeCount: number;
  completedCount: number;
  abandonedCount: number;
  metrics: {
    setupCompletion: SitePilotMetric;
    independentMaintenance: SitePilotMetric;
    statusUnderstanding: SitePilotMetric;
  };
  privacy: { contentCollected: false; credentialsCollected: false; freeTextCollected: false; participantIdentityCollected: false };
}

export interface SitePilotCampaign {
  id: string;
  label: string;
  status: "active" | "closed";
  inviteCode: string;
  quotas: Record<SitePilotScenario, number>;
  thresholds: { setupCompletion: number; independentMaintenance: number; statusUnderstanding: number };
  revision: number;
  createdAt: string;
  activatedAt: string;
  updatedAt: string;
  closedAt: string | null;
  summary: SitePilotSummary;
  readiness: Record<"setupCompletion" | "independentMaintenance" | "statusUnderstanding", { sampleReady: boolean; thresholdMet: boolean | null }>;
  decision: "collecting" | "meets_thresholds" | "needs_improvement";
  invitationCounts: Record<SitePilotScenario, { generated: number; available: number; active: number; completed: number; abandoned: number; expired?: number }>;
}

export interface SitePilotInvitation {
  id: string;
  campaignId: string;
  scenario: SitePilotScenario;
  inviteCode: string;
  status: "available" | "active" | "completed" | "abandoned" | "expired";
  sessionId: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  workspace?: SitePilotWorkspace | null;
}
