import { apiBase, request, requestRaw } from "@/lib/api/request";
import type {
  PublicationPlan,
  Site,
  SiteAsset,
  SiteBlock,
  SiteDeploymentKind,
  SiteDeploymentProvider,
  SiteDomainTlsAccessMode,
  SiteEntry,
  SiteEntryStatus,
  SiteEntryType,
  SitePublication,
  SitePilotMilestone,
  SitePilotCampaign,
  SitePilotInvitation,
  SitePilotScenario,
  SitePilotSession,
  SitePilotSummary,
  SitePilotWorkspace,
  SiteStatusAnswer,
} from "./site-types";

function pilotCode() {
  if (typeof window === "undefined") return "";
  const value = new URLSearchParams(window.location.search).get("sitePilot")?.trim() ?? "";
  return value && value !== "1" ? value : "";
}

function sitePath(path: string) {
  const code = pilotCode();
  if (!code) return path;
  return `${path}${path.includes("?") ? "&" : "?"}pilotCode=${encodeURIComponent(code)}`;
}

const siteRequest = <T>(method: string, path: string, body?: unknown, retry = true, timeoutMs?: number) =>
  request<T>(method, sitePath(path), body, retry, timeoutMs);

export const siteApi = {
  workspaceKey: () => pilotCode() || "production",
  list: () => siteRequest<{ sites: Site[]; count: number }>("GET", "/api/sites"),
  get: (siteId: string, professional = false) => siteRequest<{ site: Site }>("GET", `/api/sites/${encodeURIComponent(siteId)}${professional ? "?professional=1" : ""}`),
  create: (input: { name: string; description: string; audience: string; primaryAction: string; contactEmail: string; theme?: string; defaultLocale?: "zh-CN" | "en-US" }) =>
    siteRequest<{ site: Site }>("POST", "/api/sites", input),
  update: (siteId: string, input: Partial<Pick<Site, "name" | "description" | "audience" | "primaryAction" | "settings" | "navigation">> & { expectedRevision: number }) =>
    siteRequest<{ site: Site }>("PATCH", `/api/sites/${encodeURIComponent(siteId)}`, input),
  getEntry: (siteId: string, entryId: string) =>
    siteRequest<{ entry: SiteEntry }>("GET", `/api/sites/${encodeURIComponent(siteId)}/entries/${encodeURIComponent(entryId)}`),
  createEntry: (siteId: string, input: { type: SiteEntryType; slug: string; title: string; summary: string; blocks: SiteBlock[]; locale?: "zh-CN" | "en-US"; translationOf?: string | null }) =>
    siteRequest<{ entry: SiteEntry; site: Site; caseShowcaseAdded?: boolean }>("POST", `/api/sites/${encodeURIComponent(siteId)}/entries`, input),
  updateEntry: (siteId: string, entryId: string, input: { expectedRevision: number; title: string; summary: string; slug: string; status: SiteEntryStatus; blocks: SiteBlock[]; note?: string }) =>
    siteRequest<{ entry: SiteEntry; site: Site }>("PATCH", `/api/sites/${encodeURIComponent(siteId)}/entries/${encodeURIComponent(entryId)}`, input),
  assets: (siteId: string, professional = false) =>
    siteRequest<{ assets: SiteAsset[]; count: number; usage: { bytes: number; limitBytes: number } }>("GET", `/api/sites/${encodeURIComponent(siteId)}/assets${professional ? "?professional=1" : ""}`),
  uploadAsset: (siteId: string, file: File) => {
    const params = new URLSearchParams({ name: file.name, clientFileId: `${file.name}:${file.size}:${file.lastModified}` });
    return requestRaw<{ asset: SiteAsset; deduplicated: boolean }>("PUT", sitePath(`/api/sites/${encodeURIComponent(siteId)}/assets?${params}`), file, file.type || "application/octet-stream");
  },
  updateAsset: (siteId: string, assetId: string, input: { expectedRevision: number; name?: string; altText?: string; caption?: string; focalPoint?: { x: number; y: number } }) =>
    siteRequest<{ asset: SiteAsset }>("PATCH", `/api/sites/${encodeURIComponent(siteId)}/assets/${encodeURIComponent(assetId)}`, input),
  deleteAsset: (siteId: string, assetId: string, expectedRevision: number) =>
    siteRequest<{ deleted: true; assetId: string }>("DELETE", `/api/sites/${encodeURIComponent(siteId)}/assets/${encodeURIComponent(assetId)}`, { expectedRevision }),
  assetContentUrl: (siteId: string, assetId: string, variant?: string) => `${apiBase}${sitePath(`/api/sites/${encodeURIComponent(siteId)}/assets/${encodeURIComponent(assetId)}/content${variant ? `?variant=${encodeURIComponent(variant)}` : ""}`)}`,
  preview: (siteId: string, path = "index.html") =>
    siteRequest<{ preview: { path: string; html: string; styles: string; assetPaths: Record<string, string | { assetId: string; variant?: string }>; bundleHash: string; files: Array<{ path: string; bytes: number }> } }>("GET", `/api/sites/${encodeURIComponent(siteId)}/preview?path=${encodeURIComponent(path)}`),
  createPublicationPlan: (siteId: string) =>
    siteRequest<{ plan: PublicationPlan }>("POST", `/api/sites/${encodeURIComponent(siteId)}/publication-plans`, {}),
  publicationPlan: (siteId: string, planId: string) =>
    siteRequest<{ plan: PublicationPlan }>("GET", `/api/sites/${encodeURIComponent(siteId)}/publication-plans/${encodeURIComponent(planId)}`),
  confirmPublication: (siteId: string, planId: string) =>
    siteRequest<{ publication: SitePublication; site: Site }>("POST", `/api/sites/${encodeURIComponent(siteId)}/publication-plans/${encodeURIComponent(planId)}/confirm`, { confirmed: true }, true, 12 * 60_000),
  publications: (siteId: string, professional = false) =>
    siteRequest<{ publications: SitePublication[]; count: number }>("GET", `/api/sites/${encodeURIComponent(siteId)}/publications${professional ? "?professional=1" : ""}`),
  createRollbackPlan: (siteId: string, targetPublicationId: string) =>
    siteRequest<{ plan: PublicationPlan }>("POST", `/api/sites/${encodeURIComponent(siteId)}/rollback-plans`, { targetPublicationId }),
  confirmRollback: (siteId: string, planId: string) =>
    siteRequest<{ publication: SitePublication; site: Site }>("POST", `/api/sites/${encodeURIComponent(siteId)}/rollback-plans/${encodeURIComponent(planId)}/confirm`, { confirmed: true }, true, 12 * 60_000),
  providers: () => siteRequest<{ providers: SiteDeploymentProvider[] }>("GET", "/api/site-deployment-providers"),
  configureTarget: (siteId: string, input: {
    expectedRevision: number;
    kind: SiteDeploymentKind;
    displayName: string;
    credentialRef?: string | null;
    remoteProjectRef?: string | null;
    region?: string | null;
    customDomain?: string;
  }) => siteRequest<{ site: Site }>("PUT", `/api/sites/${encodeURIComponent(siteId)}/deployment-target`, input),
  verifyTarget: (siteId: string) =>
    siteRequest<{ site: Site; verification: Record<string, unknown> }>("POST", `/api/sites/${encodeURIComponent(siteId)}/deployment-target/verify`, {}, true, 60_000),
  configureDomainTls: (siteId: string, input: { expectedRevision: number; hostname: string; accessMode: SiteDomainTlsAccessMode }) =>
    siteRequest<{ site: Site; binding: NonNullable<Site["domainTlsBinding"]> }>("PUT", `/api/sites/${encodeURIComponent(siteId)}/domain-tls-binding`, input),
  activePilotSession: (invitationCode?: string) => request<{ session: SitePilotSession | null; invitationStatus: SitePilotInvitation["status"] | null; assignedScenario: SitePilotScenario | null; workspace?: SitePilotWorkspace | null }>("GET", `/api/site-pilot/sessions/active${invitationCode ? `?code=${encodeURIComponent(invitationCode)}` : ""}`),
  startPilotSession: (scenario: SitePilotScenario, campaignCode?: string) =>
    request<{ session: SitePilotSession }>("POST", "/api/site-pilot/sessions", { scenario, consent: true, ...(campaignCode ? { campaignCode } : {}) }),
  updatePilotSession: (sessionId: string, input: {
    expectedRevision: number;
    milestone?: SitePilotMilestone;
    action?: "complete" | "abandon";
    outcome?: { taskCompleted?: boolean; independent?: boolean; statusAnswer?: SiteStatusAnswer; easeRating: number };
  }) => request<{ session: SitePilotSession }>("PATCH", `/api/site-pilot/sessions/${encodeURIComponent(sessionId)}`, input),
  deletePilotSession: (sessionId: string) => request<{ deleted: true; sessionId: string }>("DELETE", `/api/site-pilot/sessions/${encodeURIComponent(sessionId)}`),
  pilotSummary: () => request<{ summary: SitePilotSummary }>("GET", "/api/site-pilot/summary"),
  pilotCampaigns: () => request<{ campaigns: SitePilotCampaign[]; count: number }>("GET", "/api/site-pilot/campaigns"),
  createPilotCampaign: (input: { label?: string; quotas?: Partial<Record<SitePilotScenario, number>>; thresholds?: Partial<SitePilotCampaign["thresholds"]> } = {}) =>
    request<{ campaign: SitePilotCampaign }>("POST", "/api/site-pilot/campaigns", input),
  updatePilotCampaign: (campaignId: string, input: { expectedRevision: number; action?: "close"; label?: string; quotas?: Partial<Record<SitePilotScenario, number>>; thresholds?: Partial<SitePilotCampaign["thresholds"]> }) =>
    request<{ campaign: SitePilotCampaign }>("PATCH", `/api/site-pilot/campaigns/${encodeURIComponent(campaignId)}`, input),
  deletePilotCampaign: (campaignId: string) => request<{ deleted: true; campaignId: string }>("DELETE", `/api/site-pilot/campaigns/${encodeURIComponent(campaignId)}`),
  createPilotInvitation: (campaignId: string, scenario: SitePilotScenario) =>
    request<{ invitation: SitePilotInvitation }>("POST", `/api/site-pilot/campaigns/${encodeURIComponent(campaignId)}/invitations`, { scenario }),
};
