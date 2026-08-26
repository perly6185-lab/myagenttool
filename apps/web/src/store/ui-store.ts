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
  | "mail"
  | "localLibrary"
  | "mySite"
  | "me"
  | "workBoard"
  | "workspace"
  | "documents"
  | "workflowMemory"
  | "canvas"
  | "compare"
  | "projects"
  | "planning"
  | "task"
  | "externalWork"
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
  | "sessions"
  | "economics"
  | "audit"
  | "myHosts"
  | "siteSettings"
  | "settings";

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
export type WorkItemSection = "overview" | "process" | "assets" | "verification" | "report" | "trace";
export type TaskArea = "overview" | "process" | "assets" | "verification" | "trace";
export type ExternalWorkTab = "issue" | "pr";
export type SettingsCategoryKey = "execution" | "connections" | "automation" | "governance" | "resources" | "diagnostics";
export type WorkItemDetailMode = "summary" | "expert";
export type ExperienceMode = "ordinary" | "professional";
export type InvocationStatusFilter = "all" | "active" | "completed" | "failed";
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
  /** Entry/context page to restore after a temporary Settings or Trace visit. */
  surfaceReturnSection: SectionKey | null;
  selectedAgentId: string | null;
  selectedInvocationId: string | null;
  selectedArtifactId: string | null;
  selectedProjectId: string | null;
  selectedWorkItemId: string | null;
  selectedWorkItemMode: WorkItemDetailMode;
  workItemDetailPreference: WorkItemDetailMode;
  /** One product-wide presentation mode; advanced controls stay in My settings. */
  experienceMode: ExperienceMode;
  selectedWorkItemSection: WorkItemSection;
  /** URL-backed section inside the ordinary Tasks workspace. */
  taskArea: TaskArea;
  /** Restored filter inside External work so task-page shortcuts land precisely. */
  selectedExternalWorkTab: ExternalWorkTab;
  /** Restored low-frequency settings context. */
  settingsDialogOpen: boolean;
  settingsCategory: SettingsCategoryKey | null;
  settingsQuery: string;
  settingsScrollTop: number;
  recentSettingsSections: SectionKey[];
  favoriteSettingsSections: SectionKey[];
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
  /** Transient filter handed off by Home task statistics to Run records. */
  invocationStatusFilter: InvocationStatusFilter;
  /** Transient: the invocation whose Codex session the composer will continue on next send (#163). */
  resumeFromInvocationId: string | null;
  /** Transient task text handed off by a Run-record Reuse action. */
  composerDraftTask: string | null;
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
  setSurfaceReturnSection: (section: SectionKey | null) => void;
  setSelectedAgentId: (id: string | null) => void;
  setSelectedInvocationId: (id: string | null) => void;
  setSelectedArtifactId: (id: string | null) => void;
  setSelectedProjectId: (id: string | null) => void;
  setSelectedWorkItemId: (id: string | null) => void;
  openWorkItem: (id: string, options?: { mode?: WorkItemDetailMode; section?: WorkItemSection }) => void;
  closeWorkItem: () => void;
  setSelectedWorkItemMode: (mode: WorkItemDetailMode) => void;
  setWorkItemDetailPreference: (mode: WorkItemDetailMode) => void;
  setExperienceMode: (mode: ExperienceMode) => void;
  setSelectedWorkItemSection: (section: WorkItemSection) => void;
  setTaskArea: (area: TaskArea) => void;
  setSelectedExternalWorkTab: (tab: ExternalWorkTab) => void;
  setSettingsDialogOpen: (open: boolean) => void;
  setSettingsCategory: (category: SettingsCategoryKey | null) => void;
  setSettingsQuery: (query: string) => void;
  setSettingsScrollTop: (scrollTop: number) => void;
  recordRecentSettingsSection: (section: SectionKey) => void;
  toggleFavoriteSettingsSection: (section: SectionKey) => void;
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
  setInvocationStatusFilter: (filter: InvocationStatusFilter) => void;
  setResumeFromInvocationId: (id: string | null) => void;
  setComposerDraftTask: (task: string | null) => void;
  setOfficecliPreviewPath: (path: string | null) => void;
  setPendingLocalDocumentRegistration: (value: PendingLocalDocumentRegistration | null) => void;
  toggleNavGroup: (group: string) => void;
}

/** Ordinary Entry stays open; management and trace remain available on demand. */
export const DEFAULT_COLLAPSED_NAV_GROUPS = ["settings", "trace"];

/**
 * localStorage key for the persisted UI store. The index.html no-flash boot
 * script reads the same key before React mounts; boot-skin-script.test.mjs pins
 * them together so the two can't drift (#1360).
 */
export const UI_STORE_PERSIST_KEY = LOCALE_STORAGE_KEY;

export const SECTION_KEYS: SectionKey[] = [
  "settings",
  "dashboard",
  "mail",
  "localLibrary",
  "mySite",
  "me",
  "workBoard",
  "workspace",
  "documents",
  "workflowMemory",
  "canvas",
  "compare",
  "projects",
  "planning",
  "task",
  "externalWork",
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
  "sessions",
  "economics",
  "audit",
  "myHosts",
  "siteSettings",
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
  selectedWorkItemId?: string | null;
  selectedWorkItemMode?: WorkItemDetailMode;
  selectedWorkItemSection?: WorkItemSection;
  taskArea?: TaskArea;
  selectedExternalWorkTab?: ExternalWorkTab;
  settingsCategory?: SettingsCategoryKey | null;
  settingsDialogOpen?: boolean;
  settingsQuery?: string;
  planningProjectView?: PlanningProjectView;
  planningProjectFilters?: PlanningProjectFilters;
}

const NAVIGATION_SEARCH_KEYS = [
  "section", "invocation", "application", "routine", "run", "evidence", "automation",
  "planningProject", "planningView", "planningStatus", "planningPriority", "planningMilestone", "planningDue",
  "task", "taskMode", "taskView", "taskArea", "externalTab", "settingsOpen", "settingsCategory", "settingsQuery",
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
  const workItemId = stringParam(params, "task");
  const workItemModeParam = stringParam(params, "taskMode");
  const workItemSectionParam = stringParam(params, "taskView");
  const taskAreaParam = stringParam(params, "taskArea");
  const externalTabParam = stringParam(params, "externalTab");
  const settingsCategoryParam = stringParam(params, "settingsCategory");
  const navigation: UrlNavigationState = {};
  if (section) navigation.section = section;
  navigation.selectedInvocationId = invocationId;
  navigation.selectedApplicationId = applicationId;
  navigation.selectedApplicationRun = applicationId && routineId && runInvocationId
    ? { applicationId, routineId, invocationId: runInvocationId }
    : null;
  navigation.selectedEvidenceId = evidenceId;
  navigation.selectedAutomationId = automationId;
  navigation.selectedWorkItemId = workItemId;
  navigation.selectedWorkItemMode = workItemModeParam === "expert" ? "expert" : "summary";
  navigation.selectedWorkItemSection = ["process", "assets", "verification", "report", "trace"].includes(workItemSectionParam ?? "")
    ? workItemSectionParam as WorkItemSection
    : "overview";
  navigation.taskArea = ["process", "assets", "verification", "trace"].includes(taskAreaParam ?? "")
    ? taskAreaParam as TaskArea
    : "overview";
  if (section === "externalWork" || params.has("externalTab")) {
    navigation.selectedExternalWorkTab = externalTabParam === "pr" ? "pr" : "issue";
  }
  if (section === "me" || section === "settings" || params.get("settingsOpen") === "true" || params.has("settingsCategory") || params.has("settingsQuery")) {
    navigation.settingsDialogOpen = true;
    navigation.settingsCategory = ["execution", "connections", "automation", "governance", "resources", "diagnostics"].includes(settingsCategoryParam ?? "")
      ? settingsCategoryParam as SettingsCategoryKey
      : null;
    navigation.settingsQuery = stringParam(params, "settingsQuery") ?? "";
  }
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
  if (navigation.selectedWorkItemId !== undefined) state.selectedWorkItemId = navigation.selectedWorkItemId;
  if (navigation.selectedWorkItemMode !== undefined) state.selectedWorkItemMode = navigation.selectedWorkItemMode;
  if (navigation.selectedWorkItemSection !== undefined) state.selectedWorkItemSection = navigation.selectedWorkItemSection;
  if (navigation.taskArea !== undefined) state.taskArea = navigation.taskArea;
  if (navigation.selectedExternalWorkTab !== undefined) state.selectedExternalWorkTab = navigation.selectedExternalWorkTab;
  if (navigation.settingsDialogOpen !== undefined) state.settingsDialogOpen = navigation.settingsDialogOpen;
  if (navigation.settingsCategory !== undefined) state.settingsCategory = navigation.settingsCategory;
  if (navigation.settingsQuery !== undefined) state.settingsQuery = navigation.settingsQuery;
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
> & Partial<Pick<UiState,
  "selectedPlanningProjectId"
  | "planningProjectView"
  | "planningProjectFilters"
  | "selectedWorkItemId"
  | "selectedWorkItemMode"
  | "selectedWorkItemSection"
  | "taskArea"
  | "selectedExternalWorkTab"
  | "settingsDialogOpen"
  | "settingsCategory"
  | "settingsQuery"
>>): string {
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
  if (state.selectedWorkItemId) {
    params.set("task", state.selectedWorkItemId);
    if (state.selectedWorkItemMode === "expert") params.set("taskMode", "expert");
    const workItemSection = state.selectedWorkItemSection ?? "overview";
    if (workItemSection !== "overview") params.set("taskView", workItemSection);
  }
  if (state.section === "task" && state.taskArea && state.taskArea !== "overview") {
    params.set("taskArea", state.taskArea);
  }
  if (state.section === "externalWork" && state.selectedExternalWorkTab === "pr") {
    params.set("externalTab", "pr");
  }
  if (state.settingsDialogOpen && state.section !== "me" && state.section !== "settings") {
    params.set("settingsOpen", "true");
  }
  if (state.settingsDialogOpen || state.section === "settings") {
    if (state.settingsCategory) params.set("settingsCategory", state.settingsCategory);
    if (state.settingsQuery?.trim()) params.set("settingsQuery", state.settingsQuery.trim());
  }
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
    (set, get) => {
      const initialNavigation = navigationFromCurrentUrl();
      return {
        section: initialNavigation.section ?? "dashboard",
        surfaceReturnSection: null,
        selectedAgentId: null,
        selectedInvocationId: initialNavigation.selectedInvocationId ?? null,
        selectedArtifactId: null,
        selectedProjectId: null,
        selectedWorkItemId: initialNavigation.selectedWorkItemId ?? null,
        selectedWorkItemMode: initialNavigation.selectedWorkItemMode ?? "summary",
        workItemDetailPreference: "summary",
        experienceMode: "ordinary",
        selectedWorkItemSection: initialNavigation.selectedWorkItemSection ?? "overview",
        taskArea: initialNavigation.taskArea ?? "overview",
        selectedExternalWorkTab: initialNavigation.selectedExternalWorkTab ?? "issue",
        settingsDialogOpen: initialNavigation.settingsDialogOpen ?? false,
        settingsCategory: initialNavigation.settingsCategory ?? null,
        settingsQuery: initialNavigation.settingsQuery ?? "",
        settingsScrollTop: 0,
        recentSettingsSections: [],
        favoriteSettingsSections: [],
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
        invocationStatusFilter: "all",
        resumeFromInvocationId: null,
        composerDraftTask: null,
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
        setSurfaceReturnSection: (surfaceReturnSection) => set({ surfaceReturnSection }),
        setSelectedAgentId: (selectedAgentId) => set({ selectedAgentId }),
        setSelectedInvocationId: (selectedInvocationId) => set({ selectedInvocationId }),
        setSelectedArtifactId: (selectedArtifactId) => set({ selectedArtifactId }),
        setSelectedProjectId: (selectedProjectId) => set({ selectedProjectId }),
        setSelectedWorkItemId: (selectedWorkItemId) => set({
          selectedWorkItemId,
          selectedWorkItemMode: selectedWorkItemId ? get().workItemDetailPreference : get().selectedWorkItemMode,
          selectedWorkItemSection: "overview",
        }),
        openWorkItem: (selectedWorkItemId, options) => set({
          selectedWorkItemId,
          selectedWorkItemMode: options?.mode ?? get().workItemDetailPreference,
          selectedWorkItemSection: options?.section ?? "overview",
        }),
        closeWorkItem: () => set({ selectedWorkItemId: null }),
        setSelectedWorkItemMode: (selectedWorkItemMode) => set({ selectedWorkItemMode }),
        setWorkItemDetailPreference: (workItemDetailPreference) => set({
          workItemDetailPreference,
          experienceMode: workItemDetailPreference === "expert" ? "professional" : "ordinary",
        }),
        setExperienceMode: (experienceMode) => set({
          experienceMode,
          workItemDetailPreference: experienceMode === "professional" ? "expert" : "summary",
          selectedWorkItemMode: experienceMode === "professional" ? "expert" : "summary",
          ...(experienceMode === "ordinary" ? { taskArea: "overview" as const } : {}),
        }),
        setSelectedWorkItemSection: (selectedWorkItemSection) => set({ selectedWorkItemSection }),
        setTaskArea: (taskArea) => set({ taskArea }),
        setSelectedExternalWorkTab: (selectedExternalWorkTab) => set({ selectedExternalWorkTab }),
        setSettingsDialogOpen: (settingsDialogOpen) => set({ settingsDialogOpen }),
        setSettingsCategory: (settingsCategory) => set({ settingsCategory }),
        setSettingsQuery: (settingsQuery) => set({ settingsQuery }),
        setSettingsScrollTop: (settingsScrollTop) => set({ settingsScrollTop: Math.max(0, settingsScrollTop) }),
        recordRecentSettingsSection: (section) => set((state) => ({
          recentSettingsSections: [section, ...state.recentSettingsSections.filter((item) => item !== section)].slice(0, 5),
        })),
        toggleFavoriteSettingsSection: (section) => set((state) => ({
          favoriteSettingsSections: state.favoriteSettingsSections.includes(section)
            ? state.favoriteSettingsSections.filter((item) => item !== section)
            : [...state.favoriteSettingsSections, section],
        })),
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
        setInvocationStatusFilter: (invocationStatusFilter) => set({ invocationStatusFilter }),
        setResumeFromInvocationId: (resumeFromInvocationId) => set({ resumeFromInvocationId }),
        setComposerDraftTask: (composerDraftTask) => set({ composerDraftTask }),
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
        selectedWorkItemId: state.selectedWorkItemId,
        selectedWorkItemMode: state.selectedWorkItemMode,
        workItemDetailPreference: state.workItemDetailPreference,
        experienceMode: state.experienceMode,
        selectedWorkItemSection: state.selectedWorkItemSection,
        taskArea: state.taskArea,
        selectedExternalWorkTab: state.selectedExternalWorkTab,
        settingsCategory: state.settingsCategory,
        settingsQuery: state.settingsQuery,
        settingsScrollTop: state.settingsScrollTop,
        recentSettingsSections: state.recentSettingsSections,
        favoriteSettingsSections: state.favoriteSettingsSections,
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
        // The information architecture changed from workflow groups to three
        // stable user surfaces. Discard stale group keys without disturbing the
        // user's current page or selections.
        const validNavGroups = new Set(["entry", "settings", "trace"]);
        if (
          !Array.isArray(merged.collapsedNavGroups)
          || merged.collapsedNavGroups.some((group) => !validNavGroups.has(group))
        ) {
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
        if (!['summary', 'expert'].includes(merged.selectedWorkItemMode)) merged.selectedWorkItemMode = "summary";
        if (!['summary', 'expert'].includes(merged.workItemDetailPreference)) merged.workItemDetailPreference = "summary";
        if (!['ordinary', 'professional'].includes(merged.experienceMode)) {
          merged.experienceMode = merged.workItemDetailPreference === "expert" ? "professional" : "ordinary";
        }
        if (!["list", "board", "roadmap", "insights", "executions"].includes(merged.planningProjectView)) {
          merged.planningProjectView = "list";
        }
        if (!["overview", "process", "assets", "verification", "report", "trace"].includes(merged.selectedWorkItemSection)) {
          merged.selectedWorkItemSection = "overview";
        }
        if (!["overview", "process", "assets", "verification", "trace"].includes(merged.taskArea)) {
          merged.taskArea = "overview";
        }
        if (!["issue", "pr"].includes(merged.selectedExternalWorkTab)) merged.selectedExternalWorkTab = "issue";
        if (merged.settingsCategory && !["execution", "connections", "automation", "governance", "resources", "diagnostics"].includes(merged.settingsCategory)) {
          merged.settingsCategory = null;
        }
        if (typeof merged.settingsQuery !== "string") merged.settingsQuery = "";
        if (!Number.isFinite(merged.settingsScrollTop) || merged.settingsScrollTop < 0) merged.settingsScrollTop = 0;
        merged.recentSettingsSections = Array.isArray(merged.recentSettingsSections)
          ? merged.recentSettingsSections.filter((section) => SECTION_KEYS.includes(section)).slice(0, 5)
          : [];
        merged.favoriteSettingsSections = Array.isArray(merged.favoriteSettingsSections)
          ? merged.favoriteSettingsSections.filter((section) => SECTION_KEYS.includes(section))
          : [];
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
