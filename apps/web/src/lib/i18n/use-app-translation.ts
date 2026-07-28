import { useTranslation } from "react-i18next";
import { i18n } from "@/lib/i18n";

/** Bind components to the app-owned instance, including isolated test renders. */
export function useAppTranslation() {
  return useTranslation(undefined, { i18n });
}
