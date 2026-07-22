import "i18next";
import { defaultNamespace, resources } from "@/lib/i18n/resources";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNamespace;
    resources: (typeof resources)["en-US"];
  }
}
