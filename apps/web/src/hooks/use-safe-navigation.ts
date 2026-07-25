import { useCallback, useState } from "react";

/**
 * Holds an intended navigation while a form is dirty. The caller decides how
 * to render the confirmation and how saving is performed.
 */
export function useSafeNavigation(dirty: boolean) {
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const requestNavigation = useCallback((action: () => void) => {
    if (dirty) setPendingAction(() => action);
    else action();
  }, [dirty]);

  const cancelNavigation = useCallback(() => setPendingAction(null), []);
  const discardAndContinue = useCallback(() => {
    const action = pendingAction;
    setPendingAction(null);
    action?.();
  }, [pendingAction]);
  const saveAndContinue = useCallback((save: (afterSave: () => void) => void) => {
    const action = pendingAction;
    setPendingAction(null);
    if (action) save(action);
  }, [pendingAction]);

  return {
    pendingNavigation: Boolean(pendingAction),
    requestNavigation,
    cancelNavigation,
    discardAndContinue,
    saveAndContinue,
  };
}
