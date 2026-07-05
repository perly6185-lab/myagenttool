import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type SectionKey =
  | "dashboard"
  | "projects"
  | "task"
  | "autoRuns"
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
  setSelectedApplicationId: (id: string | null) => void;
  setSelectedApplicationRun: (selection: ApplicationRunSelection | null) => void;
  setResumeFromInvocationId: (id: string | null) => void;
}

const SECTION_KEYS: SectionKey[] = [
  "dashboard",
  "projects",
  "task",
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

/** A `?section=` deep-link, when valid, wins over any persisted section. */
function sectionFromUrl(): SectionKey | null {
  if (typeof window === "undefined") return null;
  const param = new URLSearchParams(window.location.search).get("section");
  return param && SECTION_KEYS.includes(param as SectionKey) ? (param as SectionKey) : null;
}

/**
 * UI-only state (navigation + selection). Server data lives in React Query.
 * Persisted to localStorage so a refresh/restart restores the workspace view;
 * stale selection ids degrade gracefully (each screen already handles a missing
 * id), and an explicit `?section=` deep-link still wins on load.
 */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      section: sectionFromUrl() ?? "dashboard",
      selectedAgentId: null,
      selectedInvocationId: null,
      selectedArtifactId: null,
      selectedProjectId: null,
      selectedWorktreeId: null,
      selectedAgentSkillId: null,
      selectedToolName: null,
      selectedApplicationId: null,
      selectedApplicationRun: null,
      resumeFromInvocationId: null,
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
      setResumeFromInvocationId: (resumeFromInvocationId) => set({ resumeFromInvocationId }),
    }),
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
      }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<UiState>;
        const merged = { ...current, ...saved };
        // Guard against a persisted section that no longer exists after a code change.
        if (!merged.section || !SECTION_KEYS.includes(merged.section)) {
          merged.section = "dashboard";
        }
        // An explicit deep-link overrides the restored section.
        const urlSection = sectionFromUrl();
        if (urlSection) merged.section = urlSection;
        return merged;
      },
    },
  ),
);
