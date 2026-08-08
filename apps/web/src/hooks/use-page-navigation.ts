import { useCallback } from "react";
import { pageRegistration } from "@/app/sections";
import { type SectionKey, useUiStore } from "@/store/ui-store";

/**
 * Shell navigation remembers the last ordinary/context page when the operator
 * temporarily enters Settings or Trace. Selection state remains in the store,
 * so returning also restores the active task/project/worktree context.
 */
export function usePageNavigation() {
  const section = useUiStore((state) => state.section);
  const setSection = useUiStore((state) => state.setSection);
  const setSurfaceReturnSection = useUiStore((state) => state.setSurfaceReturnSection);

  return useCallback((target: SectionKey) => {
    const sourcePage = pageRegistration(section);
    const targetPage = pageRegistration(target);
    const opensTaskRunSetup = section === "task" && target === "autoRuns";
    if (sourcePage.surface === "entry" && (targetPage.surface !== "entry" || opensTaskRunSetup)) {
      setSurfaceReturnSection(section);
    } else if (targetPage.surface === "entry") {
      setSurfaceReturnSection(null);
    }
    setSection(target);
  }, [section, setSection, setSurfaceReturnSection]);
}
