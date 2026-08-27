export type LocalContentKind = "article" | "material" | "mail" | "task" | "task_input" | "task_output";

export type LocalContentRecord = {
  id: string;
  kind: LocalContentKind;
  title: string;
  summary: string;
  projectId: string | null;
  workItemId: string | null;
  storageMode: "managed" | "referenced" | "snapshot" | "state_record";
  root: { kind: string; id: string | null } | null;
  relativePath: string | null;
  stateLocator: { collection: string; id: string } | null;
  mimeType: string | null;
  size: number | null;
  source: { type: string | null; id: string | null };
  sourceLabel?: string;
  matchSnippet?: string | null;
  sameContent?: { canonicalContentId: string; appearances: number } | null;
  occurredAt: string | null;
  importedAt: string | null;
  modifiedAt: string | null;
  original: { available: boolean; reason: string | null };
  indexStatus: "ready" | "metadata_only" | "partial" | "missing" | string;
  metadata: Record<string, unknown>;
  relations: Array<{
    direction: "incoming" | "outgoing";
    type: string;
    contentId: string;
    kind?: LocalContentKind | null;
    title?: string | null;
    metadata: Record<string, unknown>;
  }>;
};

export type WorkItemContentReference = {
  id: string;
  contentId: string;
  resourceId?: string;
  purpose: "reference" | "required_input";
  title: string;
  kind: LocalContentKind;
  addedBy: string;
  createdAt: string;
  fingerprintPinned: boolean;
};

export type WorkItemResourceReference = {
  id: string;
  resourceId: string;
  purpose: "query_source" | "change_target" | "reference";
  title: string;
  resourceKind: WorkResource["resourceKind"];
  businessRole: string | null;
  locality: WorkResource["locality"];
  sourceLabel: string;
  capabilities?: string[];
  allowedPurposes?: Array<"query_source" | "change_target" | "reference">;
  addedBy: string;
  createdAt: string;
  versionPinned: boolean;
};

export type LocalContentCatalogStats = {
  schemaVersion: number;
  total: number;
  available: number;
  byKind: Partial<Record<LocalContentKind, { count: number; available: number }>>;
  facets?: {
    projects: Array<{ value: string; count: number }>;
    workItems: Array<{ value: string; count: number }>;
    sources: Array<{ value: string; count: number }>;
    months: Array<{ value: string; count: number }>;
    availability: Array<{ value: string; count: number }>;
    indexStatuses: Array<{ value: string; count: number }>;
    mailAccounts?: Array<{ value: string; label: string; count: number }>;
    mailFolders?: Array<{ value: string; accountId: string; accountLabel: string; path: string; count: number }>;
    coverage?: Record<string, { limit: number; returned: number; truncated: boolean }>;
  };
  lastRebuiltAt: string | null;
  rebuildable: boolean;
  indexing?: { queued: number; running: number; failed: number };
};

export type LocalContentHealth = {
  contentId: string;
  state: "ready" | "changed" | "missing" | "missing_record";
  available: boolean;
  reason: string | null;
  canRefresh?: boolean;
  canReveal?: boolean;
};

export type LocalContentPreview = {
  contentId: string;
  title: string;
  kind: LocalContentKind;
  format: "plain_text";
  text: string;
  truncated: boolean;
  bytesRead: number;
  totalBytes: number;
  mimeType: string | null;
  originalName: string;
  extraction?: { parserVersion: number; pageCount: number | null; cellCount: number | null };
  activeContentExecuted: false;
  remoteResourcesLoaded: false;
};

export type WorkResource = {
  id: string;
  displayName: string;
  resourceKind: "table" | "document" | "mail" | "task_output";
  businessRole: string | null;
  locality: "local" | "remote";
  projectId: string | null;
  source: { type: "local_content" | "local_file" | "connector"; label: string; localContentLinked: boolean };
  capabilities: Array<"preview" | "read" | "query" | "propose_change" | "commit_change">;
  availability: "ready" | "stale" | "unavailable" | "archived";
  currentVersion: string | null;
  rowCount: number | null;
  lastFreshAt: string | null;
  summary: string | null;
  preview: { supported: boolean; kind: "local_content" | "structured_rows" };
  taskBinding: { supported: boolean; purposes: Array<"query_source" | "change_target" | "reference" | "required_input"> };
  actions: {
    canRefresh: boolean;
    refreshMode: "local_index" | "connection_check" | null;
    canLocate: boolean;
    managementSection: "localLibrary" | "workflowMemory";
  };
  details: {
    freshness: "current" | "stale" | "unavailable";
    statusReason: string | null;
    connectionHealth: string | null;
  };
};

export type WorkResourcePreview = {
  kind: "plain_text" | "structured_rows";
  text?: string;
  columns?: string[];
  rows?: Array<{ id: string; label: string; kind: string; status: string; fields: Record<string, string | null> }>;
  truncated: boolean;
};

export type WorkItemResourcePreflight = {
  checkedAt: string;
  executable: boolean;
  counts: { ready: number; changed: number; unavailable: number; unknown: number; blocking: number };
  references: Array<{
    referenceId: string;
    kind: "local_content" | "work_resource";
    title: string;
    purpose: string;
    locality: "local" | "remote";
    sourceLabel: string;
    status: "ready" | "changed" | "unavailable" | "unknown";
    blocking: boolean;
    versionPinned: boolean;
    canAcceptCurrentVersion: boolean;
    canRecheck: boolean;
    recovery: "recheck" | "locate_or_replace" | "refresh_local_record" | "manage_source" | "accept_current_version" | null;
    reason?: string;
  }>;
};
