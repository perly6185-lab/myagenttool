import { enUSResources } from "@/lib/i18n/resources-en";
import { zhCNResources } from "@/lib/i18n/resources-zh";

/** Static aggregate used by translation parity tests and type generation only. */
export const resources = {
  "en-US": enUSResources,
  "zh-CN": zhCNResources,
} as const;

export { defaultNamespace } from "@/lib/i18n/config";
