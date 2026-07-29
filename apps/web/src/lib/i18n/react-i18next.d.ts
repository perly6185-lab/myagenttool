import "i18next";
import { defaultNamespace, resources } from "@/lib/i18n/resources";
import type { executionUiTranslations } from "@/lib/i18n/execution-ui-resources";
import type { workProfileTranslations } from "@/lib/i18n/work-profile-resources";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNamespace;
    resources: {
      common: (typeof resources)["en-US"]["common"] & {
        executionUi: (typeof executionUiTranslations)["en-US"];
        workProfile: (typeof workProfileTranslations)["en-US"];
      };
    };
  }
}
