import { create } from "zustand";

export type SectionKey =
  | "dashboard"
  | "projects"
  | "task"
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
  setSection: (section: SectionKey) => void;
  setSelectedAgentId: (id: string | null) => void;
  setSelectedInvocationId: (id: string | null) => void;
  setSelectedArtifactId: (id: string | null) => void;
  setSelectedProjectId: (id: string | null) => void;
  setSelectedWorktreeId: (id: string | null) => void;
  setSelectedAgentSkillId: (id: string | null) => void;
  setSelectedToolName: (name: string | null) => void;
  setSelectedApplicationId: (id: string | null) => void;
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

/** Allow deep-linking a section via `?section=` (a step toward URL routing). */
function initialSection(): SectionKey {
  if (typeof window === "undefined") return "dashboard";
  const param = new URLSearchParams(window.location.search).get("section");
  return SECTION_KEYS.includes(param as SectionKey) ? (param as SectionKey) : "dashboard";
}

/** UI-only state (navigation + selection). Server data lives in React Query. */
export const useUiStore = create<UiState>((set) => ({
  section: initialSection(),
  selectedAgentId: null,
  selectedInvocationId: null,
  selectedArtifactId: null,
  selectedProjectId: null,
  selectedWorktreeId: null,
  selectedAgentSkillId: null,
  selectedToolName: null,
  selectedApplicationId: null,
  setSection: (section) => set({ section }),
  setSelectedAgentId: (selectedAgentId) => set({ selectedAgentId }),
  setSelectedInvocationId: (selectedInvocationId) => set({ selectedInvocationId }),
  setSelectedArtifactId: (selectedArtifactId) => set({ selectedArtifactId }),
  setSelectedProjectId: (selectedProjectId) => set({ selectedProjectId }),
  setSelectedWorktreeId: (selectedWorktreeId) => set({ selectedWorktreeId }),
  setSelectedAgentSkillId: (selectedAgentSkillId) => set({ selectedAgentSkillId }),
  setSelectedToolName: (selectedToolName) => set({ selectedToolName }),
  setSelectedApplicationId: (selectedApplicationId) => set({ selectedApplicationId }),
}));
