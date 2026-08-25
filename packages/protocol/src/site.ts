import type { IsoDateTime, TeamId, UserId } from "./common.js";

export type SiteId = `sit_${string}`;
export type SiteEntryId = `sen_${string}`;
export type SiteRevisionId = `srv_${string}`;
export type SitePublicationId = `spb_${string}`;
export type SiteAssetId = `sat_${string}`;
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

export interface Site {
  id: SiteId;
  ownerTeamId: TeamId;
  name: string;
  description: string;
  audience: string;
  primaryAction: string;
  defaultLocale: "zh-CN" | "en-US";
  status: "setup" | "ready" | "publishing" | "degraded" | "disabled";
  visibility: "private_preview" | "public";
  publicUrl?: string | null;
  activePublicationId: SitePublicationId | null;
  settings: Record<string, unknown>;
  navigation: Record<string, unknown>;
  revision: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  createdBy: UserId;
  lastModifiedBy: UserId;
}

export interface SiteEntry {
  id: SiteEntryId;
  siteId: SiteId;
  ownerTeamId: TeamId;
  type: SiteEntryType;
  locale?: "zh-CN" | "en-US";
  translationOf?: SiteEntryId | null;
  slug: string;
  title: string;
  summary: string;
  status: SiteEntryStatus;
  draftRevisionId: SiteRevisionId;
  publishedRevisionId: SiteRevisionId | null;
  revision: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface SiteEntryRevision {
  id: SiteRevisionId;
  entryId: SiteEntryId;
  siteId: SiteId;
  ownerTeamId: TeamId;
  revisionNumber: number;
  blocks: SiteBlock[];
  metadata?: Pick<SiteEntry, "title" | "summary" | "slug" | "status">;
  createdAt: IsoDateTime;
  createdBy: UserId;
}

export interface SiteAsset {
  id: SiteAssetId;
  siteId: SiteId;
  ownerTeamId: TeamId;
  name: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  extension: "png" | "jpg" | "webp";
  size: number;
  sha256: string;
  altText: string;
  caption: string;
  status: "ready" | "error";
  width?: number | null;
  height?: number | null;
  focalPoint?: { x: number; y: number };
  derivativeStatus?: "ready" | "unavailable";
  derivatives?: Array<{
    key: string;
    width: number;
    height: number;
    mimeType: "image/webp";
    extension: "webp";
    size: number;
    sha256?: string;
  }>;
  revision: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  createdBy: UserId;
}
