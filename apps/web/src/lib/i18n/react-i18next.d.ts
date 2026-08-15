import "i18next";
import { defaultNamespace } from "@/lib/i18n/config";
import type { resources } from "@/lib/i18n/resources";
import type { executionUiTranslations } from "@/lib/i18n/execution-ui-resources";
import type { autoRunTranslations } from "@/lib/i18n/auto-run-resources";
import type { workProfileTranslations } from "@/lib/i18n/work-profile-resources";
import type { worktreeViewTranslations } from "@/lib/i18n/worktree-view-resources";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNamespace;
    resources: {
      common: (typeof resources)["en-US"]["common"] & {
        automationPage: (typeof autoRunTranslations)["en-US"]["automationPage"];
        autoRuns: (typeof autoRunTranslations)["en-US"]["autoRuns"];
        autoRunActions: (typeof autoRunTranslations)["en-US"]["autoRunActions"];
        autoRunConfig: (typeof autoRunTranslations)["en-US"]["autoRunConfig"];
        executionUi: (typeof executionUiTranslations)["en-US"];
        workProfile: (typeof workProfileTranslations)["en-US"];
        worktreeView: (typeof worktreeViewTranslations)["en-US"];
      };
    };
  }
}
