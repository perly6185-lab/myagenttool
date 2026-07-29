import type {
  IsoDateTime,
  ProjectId,
  TeamId,
  UserId,
  WorkProfileId,
  WorkProfileInferenceId,
  WorkProfileVersionId,
} from "./common.js";

/**
 * Work profile contract.
 *
 * A profile is a stable, owned aggregate. Its inferred contents live in
 * immutable versions so consumers can identify exactly which snapshot they
 * used. Expiration is explicit: an expired version must not be used for
 * personalization until it is refreshed or replaced.
 */

export const workProfileInferenceKinds = [
  "category",
  "recurring_activity",
  "document_pattern",
  "preferred_output",
] as const;

export type WorkProfileInferenceKind = (typeof workProfileInferenceKinds)[number];

export const workProfileConfidenceLevels = [
  "low",
  "medium",
  "high",
] as const;

export type WorkProfileConfidenceLevel = (typeof workProfileConfidenceLevels)[number];

export const workProfileEvidenceSourceKinds = [
  "explicit_user_input",
  "invocation",
  "document",
  "project",
  "routine",
] as const;

export type WorkProfileEvidenceSourceKind = (typeof workProfileEvidenceSourceKinds)[number];

export const workProfileAuthorizationPermissions = [
  "read",
  "update",
  "use_for_personalization",
] as const;

export type WorkProfileAuthorizationPermission =
  (typeof workProfileAuthorizationPermissions)[number];

export type WorkProfilePrincipal =
  | { type: "user"; userId: UserId }
  | { type: "team"; teamId: TeamId };

/**
 * A bounded reference to supporting material. `reference` is an opaque
 * identifier, never a raw document body, prompt, or transcript.
 */
export interface WorkProfileEvidenceSource {
  kind: WorkProfileEvidenceSourceKind;
  reference: string;
  observedAt: IsoDateTime;
}

/**
 * Evidence attached to every inferred fact. The human-readable summary is
 * required even when source references are unavailable or later deleted.
 */
export interface WorkProfileSourceSummary {
  summary: string;
  sources: WorkProfileEvidenceSource[];
  observationCount: number;
  observedFrom: IsoDateTime;
  observedTo: IsoDateTime;
}

export interface WorkProfileConfidence {
  level: WorkProfileConfidenceLevel;
  /** Normalized score in the inclusive range 0..1. */
  score: number;
}

interface WorkProfileInferenceBase {
  id: WorkProfileInferenceId;
  kind: WorkProfileInferenceKind;
  confidence: WorkProfileConfidence;
  /** Mandatory provenance for this individual inference. */
  sourceSummary: WorkProfileSourceSummary;
  inferredAt: IsoDateTime;
}

export interface WorkProfileCategoryInference extends WorkProfileInferenceBase {
  kind: "category";
  category: string;
}

export interface WorkProfileRecurringActivityInference extends WorkProfileInferenceBase {
  kind: "recurring_activity";
  activity: string;
  cadence: string;
}

export interface WorkProfileDocumentPatternInference extends WorkProfileInferenceBase {
  kind: "document_pattern";
  pattern: string;
  documentTypes: string[];
}

export interface WorkProfilePreferredOutputInference extends WorkProfileInferenceBase {
  kind: "preferred_output";
  description: string;
  formats: string[];
}

export type WorkProfileInference =
  | WorkProfileCategoryInference
  | WorkProfileRecurringActivityInference
  | WorkProfileDocumentPatternInference
  | WorkProfilePreferredOutputInference;

export interface WorkProfileAuthorizationGrant {
  principal: WorkProfilePrincipal;
  permissions: WorkProfileAuthorizationPermission[];
  /** A grant can expire before the profile; null means it follows profile lifetime. */
  expiresAt: IsoDateTime | null;
}

/**
 * Authorization is deny-by-default. The owner always retains access; every
 * other principal and permitted use must be represented by a grant.
 * `projectIds` bounds where personalization may be applied; an empty list
 * means no project is authorized, not all projects.
 */
export interface WorkProfileAuthorizationScope {
  grants: WorkProfileAuthorizationGrant[];
  projectIds: ProjectId[];
}

/**
 * An immutable inferred snapshot. `version` is positive and monotonically
 * increasing within a profile. A new snapshot points to the version it
 * replaced, preserving provenance across refreshes.
 */
export interface WorkProfileVersion {
  id: WorkProfileVersionId;
  profileId: WorkProfileId;
  version: number;
  previousVersionId: WorkProfileVersionId | null;
  categories: WorkProfileCategoryInference[];
  recurringActivities: WorkProfileRecurringActivityInference[];
  documentPatterns: WorkProfileDocumentPatternInference[];
  preferredOutputs: WorkProfilePreferredOutputInference[];
  createdAt: IsoDateTime;
  expiresAt: IsoDateTime;
}

/**
 * Stable owner and authorization envelope for versioned profile snapshots.
 */
export interface WorkProfile {
  id: WorkProfileId;
  owner: WorkProfilePrincipal;
  authorizationScope: WorkProfileAuthorizationScope;
  currentVersionId: WorkProfileVersionId;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
