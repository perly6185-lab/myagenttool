import { Languages, ListTree, Palette, Settings, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { LanguagePicker } from "@/components/layout/language-picker";
import { LoginControl } from "@/components/layout/login-control";
import { SkinPicker } from "@/components/layout/skin-picker";
import { Card, CardContent } from "@/components/ui/card";
import { usePageNavigation } from "@/hooks/use-page-navigation";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { useUiStore } from "@/store/ui-store";

export function MeView({ embedded = false }: { embedded?: boolean }) {
  const { t } = useAppTranslation();
  const navigate = usePageNavigation();
  const professionalMode = useUiStore((state) => state.experienceMode) === "professional";
  const setExperienceMode = useUiStore((state) => state.setExperienceMode);

  return (
    <div className={`mx-auto flex w-full max-w-2xl flex-col gap-3 ${embedded ? "pb-4" : ""}`}>
      {!embedded ? <div>
        <h1 className="text-lg font-semibold">{t("me.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("me.description")}</p>
      </div> : null}

      <Card>
        <CardContent className="p-4">
          <div className="mb-4 flex items-center gap-3">
            <UserRound className="size-5 text-muted-foreground" aria-hidden="true" />
            <div><h2 className="text-sm font-semibold">{t("me.account")}</h2><p className="text-xs text-muted-foreground">{t("me.accountHint")}</p></div>
          </div>
          <LoginControl expanded />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="divide-y divide-border p-0">
          <PreferenceRow icon={Languages} label={t("me.language")}>
            <LanguagePicker comfortable />
          </PreferenceRow>
          <PreferenceRow icon={Palette} label={t("me.appearance")}>
            <SkinPicker alwaysVisible />
          </PreferenceRow>
          <PreferenceRow
            icon={ListTree}
            label={t("me.professionalMode")}
            description={t("me.professionalModeHint")}
          >
            <button
              type="button"
              role="switch"
              aria-checked={professionalMode}
              aria-label={t("me.professionalMode")}
              onClick={() => setExperienceMode(professionalMode ? "ordinary" : "professional")}
              className={`relative h-6 w-11 rounded-full transition-colors ${professionalMode ? "bg-primary" : "bg-muted-foreground/35"}`}
            >
              <span
                className={`absolute top-0.5 size-5 rounded-full bg-background shadow-sm transition-transform ${professionalMode ? "translate-x-5" : "translate-x-0.5"}`}
                aria-hidden="true"
              />
            </button>
          </PreferenceRow>
        </CardContent>
      </Card>

      {!embedded ? <Card>
        <CardContent className="divide-y divide-border p-0">
          <Destination
            icon={Settings}
            label={t("me.settings")}
            description={t("me.settingsHint")}
            onClick={() => navigate("settings")}
          />
        </CardContent>
      </Card> : null}
    </div>
  );
}

function PreferenceRow({
  icon: Icon,
  label,
  description,
  children,
}: {
  icon: typeof UserRound;
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
      <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        {description ? <span className="block text-xs text-muted-foreground">{description}</span> : null}
      </span>
      <div className="w-full pl-8 sm:ml-auto sm:w-auto sm:pl-0">{children}</div>
    </div>
  );
}

function Destination({
  icon: Icon,
  label,
  description,
  onClick,
}: {
  icon: typeof Settings;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/50"
    >
      <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      <span className="ml-auto text-muted-foreground" aria-hidden="true">›</span>
    </button>
  );
}
