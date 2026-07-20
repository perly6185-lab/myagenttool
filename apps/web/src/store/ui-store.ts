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

export type SectionKey =
  | "dashboard"
  | "workBoard"
  | "workspace"
  | "compare"
  | "projects"
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

interface UiState {
  section: SectionKey;
  selectedAgentId: string | null;
  selectedInvocationId: string | null;
  selectedArtifactId: string | null;
  selectedProjectId: string | null;
  selectedWorktreeId: string | null;
  selectedAgentSkillId: string | null;
  selectedToolName: string | null;
  selectedApplicationId: string | null;
  selectedApplicationRun: ApplicationRunSelection | null;
  selectedEvidenceId: string | null;
  selectedAutomationId: string | null;
  /** Transient: the invocation whose Codex session the composer will continue on next send (#163). */
  resumeFromInvocationId: string | null;
  /** Nav groups the operator has collapsed; expert groups start here so the rail isn't a wall of 22 (#928). */
  collapsedNavGroups: string[];
  /** Active visual skin + light/dark mode; applied to <html> by useSkinSync. */
  skin: SkinId;
  mode: SkinMode;
  setSkin: (skin: SkinId) => void;
  setMode: (mode: SkinMode) => void;
  setSection: (section: SectionKey) => void;
  setSelectedAgentId: (id: string | null) => void;
  setSelectedInvocationId: (id: string | null) => void;
  setSelectedArtifactId: (id: string | null) => void;
  setSelectedProjectId: (id: string | null) => void;
  setSelectedWorktreeId: (id: string | null) => void;
  setSelectedAgentSkillId: (id: string | null) => void;
  setSelectedToolName: (name: string | null) => void;
  setSelectedApplicationId: (id: string | null) => void;
  setSelectedApplicationRun: (selection: ApplicationRunSelection | null) => void;
  setSelectedEvidenceId: (id: string | null) => void;
  setSelectedAutomationId: (id: string | null) => void;
  setResumeFromInvocationId: (id: string | null) => void;
  toggleNavGroup: (group: string) => void;
}

/** Expert groups collapsed by default — Work/Run/Oversee stay open (#928). */
export const DEFAULT_COLLAPSED_NAV_GROUPS = ["configure", "ledgers"];

export const SECTION_KEYS: SectionKey[] = [
  "dashboard",
  "workBoard",
  "workspace",
  "compare",
  "projects",
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
}

const NAVIGATION_SEARCH_KEYS = ["section", "invocation", "application", "routine", "run", "evidence", "automation"] as const;

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
  const navigation: UrlNavigationState = {};
  if (section) navigation.section = section;
  navigation.selectedInvocationId = invocationId;
  navigation.selectedApplicationId = applicationId;
  navigation.selectedApplicationRun = applicationId && routineId && runInvocationId
    ? { applicationId, routineId, invocationId: runInvocationId }
    : null;
  navigation.selectedEvidenceId = evidenceId;
  navigation.selectedAutomationId = automationId;
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
>): string {
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
        selectedWorktreeId: null,
        selectedAgentSkillId: null,
        selectedToolName: null,
        selectedApplicationId: initialNavigation.selectedApplicationId ?? null,
        selectedApplicationRun: initialNavigation.selectedApplicationRun ?? null,
        selectedEvidenceId: initialNavigation.selectedEvidenceId ?? null,
        selectedAutomationId: initialNavigation.selectedAutomationId ?? null,
        resumeFromInvocationId: null,
        collapsedNavGroups: [...DEFAULT_COLLAPSED_NAV_GROUPS],
        skin: DEFAULT_SKIN,
        mode: DEFAULT_MODE,
        setSkin: (skin) => set({ skin }),
        setMode: (mode) => set({ mode }),
        setSection: (section) => set({ section }),
        setSelectedAgentId: (selectedAgentId) => set({ selectedAgentId }),
        setSelectedInvocationId: (selectedInvocationId) => set({ selectedInvocationId }),
        setSelectedArtifactId: (selectedArtifactId) => set({ selectedArtifactId }),
        setSelectedProjectId: (selectedProjectId) => set({ selectedProjectId }),
        setSelectedWorktreeId: (selectedWorktreeId) => set({ selectedWorktreeId }),
        setSelectedAgentSkillId: (selectedAgentSkillId) => set({ selectedAgentSkillId }),
        setSelectedToolName: (selectedToolName) => set({ selectedToolName }),
        setSelectedApplicationId: (selectedApplicationId) => set({ selectedApplicationId }),
        setSelectedApplicationRun: (selectedApplicationRun) => set({ selectedApplicationRun }),
        setSelectedEvidenceId: (selectedEvidenceId) => set({ selectedEvidenceId }),
        setSelectedAutomationId: (selectedAutomationId) => set({ selectedAutomationId }),
        setResumeFromInvocationId: (resumeFromInvocationId) => set({ resumeFromInvocationId }),
        toggleNavGroup: (group) =>
          set((state) => ({
            collapsedNavGroups: state.collapsedNavGroups.includes(group)
              ? state.collapsedNavGroups.filter((key) => key !== group)
              : [...state.collapsedNavGroups, group],
          })),
      };
    },
    {
      name: "myagenttool-ui",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Persist navigation + selection only, never the setter functions.
      partialize: (state) => ({
        section: state.section,
        selectedAgentId: state.selectedAgentId,
        selectedInvocationId: state.selectedInvocationId,
        selectedArtifactId: state.selectedArtifactId,
        selectedProjectId: state.selectedProjectId,
        selectedWorktreeId: state.selectedWorktreeId,
        selectedAgentSkillId: state.selectedAgentSkillId,
        selectedToolName: state.selectedToolName,
        selectedApplicationId: state.selectedApplicationId,
        selectedApplicationRun: state.selectedApplicationRun,
        selectedEvidenceId: state.selectedEvidenceId,
        collapsedNavGroups: state.collapsedNavGroups,
        skin: state.skin,
        mode: state.mode,
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
        // Explicit deep-link params override restored navigation selections.
        applyUrlNavigation(merged, navigationFromCurrentUrl());
        return merged;
      },
    },
  ),
);
