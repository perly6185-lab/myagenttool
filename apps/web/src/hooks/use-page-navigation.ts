import { useCallback } from "react";
import { pageRegistration } from "@/app/sections";
import { isMySettingsSection, settingsCategoryForSection } from "@/features/settings/my-settings-model";
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
  const setTaskArea = useUiStore((state) => state.setTaskArea);
  const settingsDialogOpen = useUiStore((state) => state.settingsDialogOpen);
  const setSettingsDialogOpen = useUiStore((state) => state.setSettingsDialogOpen);
  const setSettingsCategory = useUiStore((state) => state.setSettingsCategory);
  const recordRecentSettingsSection = useUiStore((state) => state.recordRecentSettingsSection);

  return useCallback((target: SectionKey) => {
    const sourcePage = pageRegistration(section);
    const targetPage = pageRegistration(target);
    const opensTaskRunSetup = section === "task" && target === "autoRuns";
    const opensSettings = target === "me" || target === "settings" || targetPage.surface !== "entry";
    if (settingsDialogOpen && isMySettingsSection(target)) {
      setSettingsCategory(settingsCategoryForSection(target));
      recordRecentSettingsSection(target);
      setSection(target);
      return;
    }
    if (!settingsDialogOpen && sourcePage.surface === "entry" && (opensSettings || opensTaskRunSetup)) {
      setSurfaceReturnSection(section);
    } else if (targetPage.surface === "entry" && !opensSettings) {
      setSurfaceReturnSection(null);
    }
    setSettingsDialogOpen(opensSettings);
    if (target === "settings" && section !== "settings") setSettingsCategory(null);
    if (target === "task" && section !== "task") setTaskArea("overview");
    if (isMySettingsSection(target)) recordRecentSettingsSection(target);
    setSection(target);
  }, [recordRecentSettingsSection, section, setSection, setSettingsCategory, setSettingsDialogOpen, setSurfaceReturnSection, setTaskArea, settingsDialogOpen]);
}
