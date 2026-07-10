import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type SectionKey =
  | "dashboard"
  | "projects"
  | "task"
  | "autoRuns"
  | "evalTrend"
  | "automation"
  | "agentSkills"
  | "invocations"
  | "agents"
  | "devices"
  | "discovery"
  | "integrations"
  | "tools"
  | "review"
  | "applications"
  | "economics"
  | "audit";

export interface ApplicationRunSelection {
  applicationId: string;
  routineId: string;
  invocationId: string;
}

export type ApplicationEventLevelSelection = "all" | "error" | "warning" | "info";

interface UiState {
  section: SectionKey;
  selectedAgentId: string | null;
  selectedInvocationId: string | null;
  selectedArtifactId: string | null;
  selectedProjectId: string | null;
  selectedWorktreeId: string | null;
  selectedAgentSkillId: string | null;
  selectedToolName: string | null;
  selectedToolFocus: string | null;
  selectedApplicationId: string | null;
  selectedApplicationRun: ApplicationRunSelection | null;
  selectedApplicationResultId: string | null;
  selectedApplicationRecoveryId: string | null;
  selectedApplicationEventLevel: ApplicationEventLevelSelection;
  selectedApplicationAutomationId: string | null;
  selectedEvidenceId: string | null;
  /** Transient: the invocation whose Codex session the composer will continue on next send (#163). */
  resumeFromInvocationId: string | null;
  setSection: (section: SectionKey) => void;
  setSelectedAgentId: (id: string | null) => void;
  setSelectedInvocationId: (id: string | null) => void;
  setSelectedArtifactId: (id: string | null) => void;
  setSelectedProjectId: (id: string | null) => void;
  setSelectedWorktreeId: (id: string | null) => void;
  setSelectedAgentSkillId: (id: string | null) => void;
  setSelectedToolName: (name: string | null) => void;
  setSelectedToolFocus: (focus: string | null) => void;
  setSelectedApplicationId: (id: string | null) => void;
  setSelectedApplicationRun: (selection: ApplicationRunSelection | null) => void;
  setSelectedApplicationResultId: (id: string | null) => void;
  setSelectedApplicationRecoveryId: (id: string | null) => void;
  setSelectedApplicationEventLevel: (level: ApplicationEventLevelSelection) => void;
  setSelectedApplicationAutomationId: (id: string | null) => void;
  setSelectedEvidenceId: (id: string | null) => void;
  setResumeFromInvocationId: (id: string | null) => void;
}

export const SECTION_KEYS: SectionKey[] = [
  "dashboard",
  "projects",
  "task",
  "autoRuns",
  "evalTrend",
  "automation",
  "agentSkills",
  "invocations",
  "agents",
  "devices",
  "discovery",
  "integrations",
  "tools",
  "review",
  "applications",
  "economics",
  "audit",
];

export interface UrlNavigationState {
  section?: SectionKey;
  selectedInvocationId?: string | null;
  selectedApplicationId?: string | null;
  selectedToolName?: string | null;
  selectedToolFocus?: string | null;
  selectedApplicationRun?: ApplicationRunSelection | null;
  selectedApplicationResultId?: string | null;
  selectedApplicationRecoveryId?: string | null;
  selectedApplicationEventLevel?: ApplicationEventLevelSelection;
  selectedApplicationAutomationId?: string | null;
  selectedEvidenceId?: string | null;
}

const NAVIGATION_SEARCH_KEYS = ["section", "invocation", "tool", "focus", "application", "routine", "run", "applicationResult", "recovery", "eventLevel", "automation", "evidence"] as const;

function stringParam(params: URLSearchParams, key: string): string | null {
  const value = params.get(key)?.trim();
  return value ? value : null;
}

function sectionParam(params: URLSearchParams): SectionKey | null {
  const value = stringParam(params, "section");
  return value && SECTION_KEYS.includes(value as SectionKey) ? (value as SectionKey) : null;
}

function applicationEventLevelParam(params: URLSearchParams): ApplicationEventLevelSelection | null {
  const value = stringParam(params, "eventLevel");
  return value === "all" || value === "error" || value === "warning" || value === "info" ? value : null;
}

export function navigationFromSearch(search: string): UrlNavigationState {
  const params = new URLSearchParams(search);
  const hasNavigationParams = NAVIGATION_SEARCH_KEYS.some((key) => params.has(key));
  if (!hasNavigationParams) return {};
  const section = sectionParam(params);
  const invocationId = stringParam(params, "invocation");
  const toolName = stringParam(params, "tool");
  const toolFocus = stringParam(params, "focus");
  const applicationId = stringParam(params, "application");
  const routineId = stringParam(params, "routine");
  const runInvocationId = stringParam(params, "run");
  const applicationResultId = stringParam(params, "applicationResult");
  const applicationRecoveryId = stringParam(params, "recovery");
  const eventLevel = applicationEventLevelParam(params);
  const automationId = stringParam(params, "automation");
  const evidenceId = stringParam(params, "evidence");
  const navigation: UrlNavigationState = {};
  if (section) navigation.section = section;
  navigation.selectedInvocationId = invocationId;
  navigation.selectedToolName = toolName;
  navigation.selectedToolFocus = toolFocus;
  navigation.selectedApplicationId = applicationId;
  navigation.selectedApplicationRun = applicationId && routineId && runInvocationId
    ? { applicationId, routineId, invocationId: runInvocationId }
    : null;
  navigation.selectedApplicationResultId = applicationId ? applicationResultId : null;
  navigation.selectedApplicationRecoveryId = applicationId ? applicationRecoveryId : null;
  navigation.selectedApplicationEventLevel = eventLevel ?? "all";
  navigation.selectedApplicationAutomationId = automationId;
  navigation.selectedEvidenceId = evidenceId;
  return navigation;
}

function navigationFromCurrentUrl(): UrlNavigationState {
  return typeof window === "undefined" ? {} : navigationFromSearch(window.location.search);
}

function applyUrlNavigation<T extends Partial<UiState>>(state: T, navigation: UrlNavigationState): T {
  if (navigation.section) state.section = navigation.section;
  if (navigation.selectedInvocationId !== undefined) state.selectedInvocationId = navigation.selectedInvocationId;
  if (navigation.selectedToolName !== undefined) state.selectedToolName = navigation.selectedToolName;
  if (navigation.selectedToolFocus !== undefined) state.selectedToolFocus = navigation.selectedToolFocus;
  if (navigation.selectedApplicationId !== undefined) state.selectedApplicationId = navigation.selectedApplicationId;
  if (navigation.selectedApplicationRun !== undefined) state.selectedApplicationRun = navigation.selectedApplicationRun;
  if (navigation.selectedApplicationResultId !== undefined) state.selectedApplicationResultId = navigation.selectedApplicationResultId;
  if (navigation.selectedApplicationRecoveryId !== undefined) state.selectedApplicationRecoveryId = navigation.selectedApplicationRecoveryId;
  if (navigation.selectedApplicationEventLevel !== undefined) state.selectedApplicationEventLevel = navigation.selectedApplicationEventLevel;
  if (navigation.selectedApplicationAutomationId !== undefined) state.selectedApplicationAutomationId = navigation.selectedApplicationAutomationId;
  if (navigation.selectedEvidenceId !== undefined) state.selectedEvidenceId = navigation.selectedEvidenceId;
  return state;
}

export function urlNavigationPatchFromSearch(search: string): Partial<UiState> {
  return applyUrlNavigation({}, navigationFromSearch(search));
}

export function searchFromNavigationState(search: string, state: Pick<UiState,
  "section"
  | "selectedInvocationId"
  | "selectedApplicationId"
  | "selectedToolName"
  | "selectedToolFocus"
  | "selectedApplicationRun"
  | "selectedApplicationResultId"
  | "selectedApplicationRecoveryId"
  | "selectedApplicationEventLevel"
  | "selectedApplicationAutomationId"
  | "selectedEvidenceId"
>): string {
  const params = new URLSearchParams(search);
  for (const key of NAVIGATION_SEARCH_KEYS) params.delete(key);
  params.set("section", state.section);
  if (state.selectedInvocationId) params.set("invocation", state.selectedInvocationId);
  if (state.section === "tools" && state.selectedToolName) params.set("tool", state.selectedToolName);
  if (state.section === "tools" && state.selectedToolFocus) params.set("focus", state.selectedToolFocus);
  const applicationId = state.selectedApplicationRun?.applicationId ?? state.selectedApplicationId;
  if (applicationId) params.set("application", applicationId);
  if (state.selectedApplicationRun) {
    params.set("routine", state.selectedApplicationRun.routineId);
    params.set("run", state.selectedApplicationRun.invocationId);
  }
  if (state.section === "applications" && applicationId && state.selectedApplicationResultId) {
    params.set("applicationResult", state.selectedApplicationResultId);
  }
  if (state.section === "applications" && applicationId && state.selectedApplicationRecoveryId) {
    params.set("recovery", state.selectedApplicationRecoveryId);
  }
  if (state.section === "applications" && state.selectedApplicationEventLevel !== "all") {
    params.set("eventLevel", state.selectedApplicationEventLevel);
  }
  if (state.section === "applications" && state.selectedApplicationAutomationId) {
    params.set("automation", state.selectedApplicationAutomationId);
  }
  if (state.selectedEvidenceId) params.set("evidence", state.selectedEvidenceId);
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
        selectedToolName: initialNavigation.selectedToolName ?? null,
        selectedToolFocus: initialNavigation.selectedToolFocus ?? null,
        selectedApplicationId: initialNavigation.selectedApplicationId ?? null,
        selectedApplicationRun: initialNavigation.selectedApplicationRun ?? null,
        selectedApplicationResultId: initialNavigation.selectedApplicationResultId ?? null,
        selectedApplicationRecoveryId: initialNavigation.selectedApplicationRecoveryId ?? null,
        selectedApplicationEventLevel: initialNavigation.selectedApplicationEventLevel ?? "all",
        selectedApplicationAutomationId: initialNavigation.selectedApplicationAutomationId ?? null,
        selectedEvidenceId: initialNavigation.selectedEvidenceId ?? null,
        resumeFromInvocationId: null,
        setSection: (section) => set({ section }),
        setSelectedAgentId: (selectedAgentId) => set({ selectedAgentId }),
        setSelectedInvocationId: (selectedInvocationId) => set({ selectedInvocationId }),
        setSelectedArtifactId: (selectedArtifactId) => set({ selectedArtifactId }),
        setSelectedProjectId: (selectedProjectId) => set({ selectedProjectId }),
        setSelectedWorktreeId: (selectedWorktreeId) => set({ selectedWorktreeId }),
        setSelectedAgentSkillId: (selectedAgentSkillId) => set({ selectedAgentSkillId }),
        setSelectedToolName: (selectedToolName) => set({ selectedToolName }),
        setSelectedToolFocus: (selectedToolFocus) => set({ selectedToolFocus }),
        setSelectedApplicationId: (selectedApplicationId) => set((state) => ({
          selectedApplicationId,
          selectedApplicationResultId: state.selectedApplicationId === selectedApplicationId
            ? state.selectedApplicationResultId
            : null,
          selectedApplicationRecoveryId: state.selectedApplicationId === selectedApplicationId
            ? state.selectedApplicationRecoveryId
            : null,
        })),
        setSelectedApplicationRun: (selectedApplicationRun) => set({ selectedApplicationRun }),
        setSelectedApplicationResultId: (selectedApplicationResultId) => set({ selectedApplicationResultId }),
        setSelectedApplicationRecoveryId: (selectedApplicationRecoveryId) => set({ selectedApplicationRecoveryId }),
        setSelectedApplicationEventLevel: (selectedApplicationEventLevel) => set({ selectedApplicationEventLevel }),
        setSelectedApplicationAutomationId: (selectedApplicationAutomationId) => set({ selectedApplicationAutomationId }),
        setSelectedEvidenceId: (selectedEvidenceId) => set({ selectedEvidenceId }),
        setResumeFromInvocationId: (resumeFromInvocationId) => set({ resumeFromInvocationId }),
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
        selectedToolFocus: state.selectedToolFocus,
        selectedApplicationId: state.selectedApplicationId,
        selectedApplicationRun: state.selectedApplicationRun,
        selectedApplicationResultId: state.selectedApplicationResultId,
        selectedApplicationRecoveryId: state.selectedApplicationRecoveryId,
        selectedApplicationEventLevel: state.selectedApplicationEventLevel,
        selectedApplicationAutomationId: state.selectedApplicationAutomationId,
        selectedEvidenceId: state.selectedEvidenceId,
      }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<UiState>;
        const merged = { ...current, ...saved };
        // Guard against a persisted section that no longer exists after a code change.
        if (!merged.section || !SECTION_KEYS.includes(merged.section)) {
          merged.section = "dashboard";
        }
        // Explicit deep-link params override restored navigation selections.
        applyUrlNavigation(merged, navigationFromCurrentUrl());
        return merged;
      },
    },
  ),
);
