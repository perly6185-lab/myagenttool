import { create } from "zustand";

export type SectionKey =
  | "dashboard"
  | "invocations"
  | "agents"
  | "devices"
  | "discovery"
  | "integrations"
  | "audit";

interface UiState {
  section: SectionKey;
  selectedAgentId: string | null;
  selectedInvocationId: string | null;
  selectedArtifactId: string | null;
  setSection: (section: SectionKey) => void;
  setSelectedAgentId: (id: string | null) => void;
  setSelectedInvocationId: (id: string | null) => void;
  setSelectedArtifactId: (id: string | null) => void;
}

const SECTION_KEYS: SectionKey[] = [
  "dashboard",
  "invocations",
  "agents",
  "devices",
  "discovery",
  "integrations",
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
  setSection: (section) => set({ section }),
  setSelectedAgentId: (selectedAgentId) => set({ selectedAgentId }),
  setSelectedInvocationId: (selectedInvocationId) => set({ selectedInvocationId }),
  setSelectedArtifactId: (selectedArtifactId) => set({ selectedArtifactId }),
}));
