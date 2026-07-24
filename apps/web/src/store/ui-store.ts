import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  DEFAULT_MODE,
  DEFAULT_SKIN,
  isSkinId,
  isSkinMode,
  type SkinId,
  type SkinMode,
} from "@/lib/skins";
import {
  DEFAULT_LOCALE,
  detectLocale,
  isSupportedLocale,
  LOCALE_STORAGE_KEY,
  normalizeLocale,
  type SupportedLocale,
} from "@/lib/i18n/locale";

export type SectionKey =
  | "dashboard"
  | "workBoard"
  | "workspace"
  | "documents"
  | "canvas"
  | "compare"
  | "projects"
  | "planning"
  | "task"
  | "autoRuns"
  | "approvals"
  | "evidence"
  | "evalTrend"
  | "automation"
  | "routines"
  | "agentSkills"
  | "invocations"
  | "agents"
  | "devices"
  | "discovery"
  | "integrations"
  | "tools"
  | "review"
  | "applications"
  | "channels"
  | "economics"
  | "audit";

export interface ApplicationRunSelection {
  applicationId: string;
  routineId: string;
  invocationId: string;
}

export interface PendingLocalDocumentRegistration {
  directory: string;
  documentName: string;
}

export type PlanningProjectView = "list" | "board" | "roadmap" | "insights" | "executions";
export interface PlanningProjectFilters {
  status: string;
  priority: string;
  milestone: string;
  due: "all" | "overdue" | "upcoming" | "month" | "quarter" | "unscheduled";
}
export const DEFAULT_PLANNING_PROJECT_FILTERS: PlanningProjectFilters = {
  status: "all",
  priority: "all",
  milestone: "",
  due: "all",
};

interface UiState {
  section: SectionKey;
  selectedAgentId: string | null;
  selectedInvocationId: string | null;
  selectedArtifactId: string | null;
  selectedProjectId: string | null;
  selectedPlanningProjectId: string | null;
  planningProjectView: PlanningProjectView;
  planningProjectFilters: PlanningProjectFilters;
  selectedWorktreeId: string | null;
  selectedAgentSkillId: string | null;
  selectedCanvasSceneId: string | null;
  selectedToolName: string | null;
  selectedApplicationId: string | null;
  selectedApplicationRun: ApplicationRunSelection | null;
  selectedEvidenceId: string | null;
  selectedAutomationId: string | null;
  /** Transient: the invocation whose Codex session the composer will continue on next send (#163). */
  resumeFromInvocationId: string | null;
  /** Transient: the project-relative Office document the workspace preview is showing (#1347). */
  officecliPreviewPath: string | null;
  /** Transient handoff from Documents to local project registration. */
  pendingLocalDocumentRegistration: PendingLocalDocumentRegistration | null;
  /** Nav groups the operator has collapsed; expert groups start here so the rail isn't a wall of 22 (#928). */
  collapsedNavGroups: string[];
  /** Active visual skin + light/dark mode; applied to <html> by useSkinSync. */
  skin: SkinId;
  mode: SkinMode;
  /** Product presentation language; protocol values and user content stay unchanged. */
  locale: SupportedLocale;
  setSkin: (skin: SkinId) => void;
  setMode: (mode: SkinMode) => void;
  setLocale: (locale: SupportedLocale) => void;
  setSection: (section: SectionKey) => void;
  setSelectedAgentId: (id: string | null) => void;
  setSelectedInvocationId: (id: string | null) => void;
  setSelectedArtifactId: (id: string | null) => void;
  setSelectedProjectId: (id: string | null) => void;
  setSelectedPlanningProjectId: (id: string | null) => void;
  setPlanningProjectView: (view: PlanningProjectView) => void;
  setPlanningProjectFilters: (filters: PlanningProjectFilters) => void;
  setSelectedWorktreeId: (id: string | null) => void;
  setSelectedAgentSkillId: (id: string | null) => void;
  setSelectedCanvasSceneId: (id: string | null) => void;
  setSelectedToolName: (name: string | null) => void;
  setSelectedApplicationId: (id: string | null) => void;
  setSelectedApplicationRun: (selection: ApplicationRunSelection | null) => void;
  setSelectedEvidenceId: (id: string | null) => void;
  setSelectedAutomationId: (id: string | null) => void;
  setResumeFromInvocationId: (id: string | null) => void;
  setOfficecliPreviewPath: (path: string | null) => void;
  setPendingLocalDocumentRegistration: (value: PendingLocalDocumentRegistration | null) => void;
  toggleNavGroup: (group: string) => void;
}

/** Expert groups collapsed by default — Work/Run/Oversee stay open (#928). */
export const DEFAULT_COLLAPSED_NAV_GROUPS = ["configure", "ledgers"];

/**
 * localStorage key for the persisted UI store. The index.html no-flash boot
 * script reads the same key before React mounts; boot-skin-script.test.mjs pins
 * them together so the two can't drift (#1360).
 */
export const UI_STORE_PERSIST_KEY = LOCALE_STORAGE_KEY;

export const SECTION_KEYS: SectionKey[] = [
  "dashboard",
  "workBoard",
  "workspace",
  "documents",
  "canvas",
  "compare",
  "projects",
  "planning",
  "task",
  "autoRuns",
  "approvals",
  "evidence",
  "evalTrend",
  "automation",
  "routines",
  "agentSkills",
  "invocations",
  "agents",
  "devices",
  "discovery",
  "integrations",
  "tools",
  "review",
  "applications",
  "channels",
  "economics",
  "audit",
];

export interface UrlNavigationState {
  section?: SectionKey;
  selectedInvocationId?: string | null;
  selectedApplicationId?: string | null;
  selectedApplicationRun?: ApplicationRunSelection | null;
  selectedEvidenceId?: string | null;
  /** The schedule the operator is looking at — survives a deep link and a refresh (#849). */
  selectedAutomationId?: string | null;
  selectedPlanningProjectId?: string | null;
  planningProjectView?: PlanningProjectView;
  planningProjectFilters?: PlanningProjectFilters;
}

const NAVIGATION_SEARCH_KEYS = [
  "section", "invocation", "application", "routine", "run", "evidence", "automation",
  "planningProject", "planningView", "planningStatus", "planningPriority", "planningMilestone", "planningDue",
] as const;

function stringParam(params: URLSearchParams, key: string): string | null {
  const value = params.get(key)?.trim();
  return value ? value : null;
}

function sectionParam(params: URLSearchParams): SectionKey | null {
  const value = stringParam(params, "section");
  return value && SECTION_KEYS.includes(value as SectionKey) ? (value as SectionKey) : null;
}

export function navigationFromSearch(search: string): UrlNavigationState {
  const params = new URLSearchParams(search);
  const hasNavigationParams = NAVIGATION_SEARCH_KEYS.some((key) => params.has(key));
  if (!hasNavigationParams) return {};
  const section = sectionParam(params);
  const invocationId = stringParam(params, "invocation");
  const applicationId = stringParam(params, "application");
  const routineId = stringParam(params, "routine");
  const runInvocationId = stringParam(params, "run");
  const evidenceId = stringParam(params, "evidence");
  const automationId = stringParam(params, "automation");
  const planningProjectId = stringParam(params, "planningProject");
  const planningViewParam = stringParam(params, "planningView");
  const planningDueParam = stringParam(params, "planningDue");
  const navigation: UrlNavigationState = {};
  if (section) navigation.section = section;
  navigation.selectedInvocationId = invocationId;
  navigation.selectedApplicationId = applicationId;
  navigation.selectedApplicationRun = applicationId && routineId && runInvocationId
    ? { applicationId, routineId, invocationId: runInvocationId }
    : null;
  navigation.selectedEvidenceId = evidenceId;
  navigation.selectedAutomationId = automationId;
  if (section === "planning" || NAVIGATION_SEARCH_KEYS.some((key) => key.startsWith("planning") && params.has(key))) {
    navigation.selectedPlanningProjectId = planningProjectId;
    navigation.planningProjectView = ["board", "roadmap", "insights", "executions"].includes(planningViewParam ?? "")
      ? planningViewParam as PlanningProjectView
      : "list";
    navigation.planningProjectFilters = {
      status: stringParam(params, "planningStatus") ?? "all",
      priority: stringParam(params, "planningPriority") ?? "all",
      milestone: stringParam(params, "planningMilestone") ?? "",
      due: planningDueParam === "overdue" || planningDueParam === "upcoming" || planningDueParam === "unscheduled"
        ? planningDueParam
        : "all",
    };
  }
  return navigation;
}

function navigationFromCurrentUrl(): UrlNavigationState {
  return typeof window === "undefined" ? {} : navigationFromSearch(window.location.search);
}

function applyUrlNavigation<T extends Partial<UiState>>(state: T, navigation: UrlNavigationState): T {
  if (navigation.section) state.section = navigation.section;
  if (navigation.selectedInvocationId !== undefined) state.selectedInvocationId = navigation.selectedInvocationId;
  if (navigation.selectedApplicationId !== undefined) state.selectedApplicationId = navigation.selectedApplicationId;
  if (navigation.selectedApplicationRun !== undefined) state.selectedApplicationRun = navigation.selectedApplicationRun;
  if (navigation.selectedEvidenceId !== undefined) state.selectedEvidenceId = navigation.selectedEvidenceId;
  if (navigation.selectedAutomationId !== undefined) state.selectedAutomationId = navigation.selectedAutomationId;
  if (navigation.selectedPlanningProjectId !== undefined) state.selectedPlanningProjectId = navigation.selectedPlanningProjectId;
  if (navigation.planningProjectView !== undefined) state.planningProjectView = navigation.planningProjectView;
  if (navigation.planningProjectFilters !== undefined) state.planningProjectFilters = navigation.planningProjectFilters;
  return state;
}

export function urlNavigationPatchFromSearch(search: string): Partial<UiState> {
  return applyUrlNavigation({}, navigationFromSearch(search));
}

export function searchFromNavigationState(search: string, state: Pick<UiState,
  "section"
  | "selectedInvocationId"
  | "selectedApplicationId"
  | "selectedApplicationRun"
  | "selectedEvidenceId"
  | "selectedAutomationId"
> & Partial<Pick<UiState, "selectedPlanningProjectId" | "planningProjectView" | "planningProjectFilters">>): string {
  const params = new URLSearchParams(search);
  for (const key of NAVIGATION_SEARCH_KEYS) params.delete(key);
  params.set("section", state.section);
  if (state.selectedInvocationId) params.set("invocation", state.selectedInvocationId);
  const applicationId = state.selectedApplicationRun?.applicationId ?? state.selectedApplicationId;
  if (applicationId) params.set("application", applicationId);
  if (state.selectedApplicationRun) {
    params.set("routine", state.selectedApplicationRun.routineId);
    params.set("run", state.selectedApplicationRun.invocationId);
  }
  if (state.selectedEvidenceId) params.set("evidence", state.selectedEvidenceId);
  if (state.selectedAutomationId) params.set("automation", state.selectedAutomationId);
  if (state.section === "planning") {
    if (state.selectedPlanningProjectId) params.set("planningProject", state.selectedPlanningProjectId);
    params.set("planningView", state.planningProjectView ?? "list");
    const filters = state.planningProjectFilters ?? DEFAULT_PLANNING_PROJECT_FILTERS;
    if (filters.status !== "all") params.set("planningStatus", filters.status);
    if (filters.priority !== "all") params.set("planningPriority", filters.priority);
    if (filters.milestone) params.set("planningMilestone", filters.milestone);
    if (filters.due !== "all") params.set("planningDue", filters.due);
  }
  const next = params.toString();
  return next ? `?${next}` : "";
}

/**
 * UI-only state (navigation + selection). Server data lives in React Query.
 * Persisted to localStorage so a refresh/restart restores the workspace view;
 * stale selection ids degrade gracefully (each screen already handles a missing
 * id), and an explicit `?section=` deep-link still wins on load.
 */
export const useUiStore = create<UiState>()(
  persist(
    (set) => {
      const initialNavigation = navigationFromCurrentUrl();
      return {
        section: initialNavigation.section ?? "dashboard",
        selectedAgentId: null,
        selectedInvocationId: initialNavigation.selectedInvocationId ?? null,
        selectedArtifactId: null,
        selectedProjectId: null,
        selectedPlanningProjectId: initialNavigation.selectedPlanningProjectId ?? null,
        planningProjectView: initialNavigation.planningProjectView ?? "list",
        planningProjectFilters: initialNavigation.planningProjectFilters ?? { ...DEFAULT_PLANNING_PROJECT_FILTERS },
        selectedWorktreeId: null,
        selectedAgentSkillId: null,
        selectedCanvasSceneId: null,
        selectedToolName: null,
        selectedApplicationId: initialNavigation.selectedApplicationId ?? null,
        selectedApplicationRun: initialNavigation.selectedApplicationRun ?? null,
        selectedEvidenceId: initialNavigation.selectedEvidenceId ?? null,
        selectedAutomationId: initialNavigation.selectedAutomationId ?? null,
        resumeFromInvocationId: null,
        officecliPreviewPath: null,
        pendingLocalDocumentRegistration: null,
        collapsedNavGroups: [...DEFAULT_COLLAPSED_NAV_GROUPS],
        skin: DEFAULT_SKIN,
        mode: DEFAULT_MODE,
        locale: detectLocale(),
        setSkin: (skin) => set({ skin }),
        setMode: (mode) => set({ mode }),
        setLocale: (locale) => set({ locale: normalizeLocale(locale) ?? DEFAULT_LOCALE }),
        setSection: (section) => set({ section }),
        setSelectedAgentId: (selectedAgentId) => set({ selectedAgentId }),
        setSelectedInvocationId: (selectedInvocationId) => set({ selectedInvocationId }),
        setSelectedArtifactId: (selectedArtifactId) => set({ selectedArtifactId }),
        setSelectedProjectId: (selectedProjectId) => set({ selectedProjectId }),
        setSelectedPlanningProjectId: (selectedPlanningProjectId) => set({ selectedPlanningProjectId }),
        setPlanningProjectView: (planningProjectView) => set({ planningProjectView }),
        setPlanningProjectFilters: (planningProjectFilters) => set({ planningProjectFilters }),
        setSelectedWorktreeId: (selectedWorktreeId) => set({ selectedWorktreeId }),
        setSelectedAgentSkillId: (selectedAgentSkillId) => set({ selectedAgentSkillId }),
        setSelectedCanvasSceneId: (selectedCanvasSceneId) => set({ selectedCanvasSceneId }),
        setSelectedToolName: (selectedToolName) => set({ selectedToolName }),
        setSelectedApplicationId: (selectedApplicationId) => set({ selectedApplicationId }),
        setSelectedApplicationRun: (selectedApplicationRun) => set({ selectedApplicationRun }),
        setSelectedEvidenceId: (selectedEvidenceId) => set({ selectedEvidenceId }),
        setSelectedAutomationId: (selectedAutomationId) => set({ selectedAutomationId }),
        setResumeFromInvocationId: (resumeFromInvocationId) => set({ resumeFromInvocationId }),
        setOfficecliPreviewPath: (officecliPreviewPath) => set({ officecliPreviewPath }),
        setPendingLocalDocumentRegistration: (pendingLocalDocumentRegistration) => set({ pendingLocalDocumentRegistration }),
        toggleNavGroup: (group) =>
          set((state) => ({
            collapsedNavGroups: state.collapsedNavGroups.includes(group)
              ? state.collapsedNavGroups.filter((key) => key !== group)
              : [...state.collapsedNavGroups, group],
          })),
      };
    },
    {
      name: UI_STORE_PERSIST_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Persist navigation + selection only, never the setter functions.
      partialize: (state) => ({
        section: state.section,
        selectedAgentId: state.selectedAgentId,
        selectedInvocationId: state.selectedInvocationId,
        selectedArtifactId: state.selectedArtifactId,
        selectedProjectId: state.selectedProjectId,
        selectedPlanningProjectId: state.selectedPlanningProjectId,
        planningProjectView: state.planningProjectView,
        planningProjectFilters: state.planningProjectFilters,
        selectedWorktreeId: state.selectedWorktreeId,
        selectedAgentSkillId: state.selectedAgentSkillId,
        selectedCanvasSceneId: state.selectedCanvasSceneId,
        selectedToolName: state.selectedToolName,
        selectedApplicationId: state.selectedApplicationId,
        selectedApplicationRun: state.selectedApplicationRun,
        selectedEvidenceId: state.selectedEvidenceId,
        collapsedNavGroups: state.collapsedNavGroups,
        skin: state.skin,
        mode: state.mode,
        locale: state.locale,
      }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<UiState>;
        const merged = { ...current, ...saved };
        // A pre-#928 persisted blob has no collapsedNavGroups; fall back to the default.
        if (!Array.isArray(merged.collapsedNavGroups)) {
          merged.collapsedNavGroups = [...DEFAULT_COLLAPSED_NAV_GROUPS];
        }
        // Guard against a persisted section that no longer exists after a code change.
        if (!merged.section || !SECTION_KEYS.includes(merged.section)) {
          merged.section = "dashboard";
        }
        // A skin/mode removed in a later release falls back to the default.
        if (!isSkinId(merged.skin)) merged.skin = DEFAULT_SKIN;
        if (!isSkinMode(merged.mode)) merged.mode = DEFAULT_MODE;
        // Old blobs have no locale and keep the system-detected current value;
        // stale/unsupported saved values never escape into i18next or the DOM.
        if (!isSupportedLocale(saved.locale)) merged.locale = current.locale;
        if (!["list", "board", "roadmap", "insights", "executions"].includes(merged.planningProjectView)) {
          merged.planningProjectView = "list";
        }
        if (!merged.planningProjectFilters || typeof merged.planningProjectFilters !== "object") {
          merged.planningProjectFilters = { ...DEFAULT_PLANNING_PROJECT_FILTERS };
        }
        // Explicit deep-link params override restored navigation selections.
        applyUrlNavigation(merged, navigationFromCurrentUrl());
        return merged;
      },
    },
  ),
);
