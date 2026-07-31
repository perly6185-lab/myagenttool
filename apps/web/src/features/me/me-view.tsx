import { History, Languages, Palette, Settings, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { LanguagePicker } from "@/components/layout/language-picker";
import { LoginControl } from "@/components/layout/login-control";
import { SkinPicker } from "@/components/layout/skin-picker";
import { Card, CardContent } from "@/components/ui/card";
import { usePageNavigation } from "@/hooks/use-page-navigation";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { WorkProfileReview } from "./work-profile-review";

export function MeView() {
  const { t } = useAppTranslation();
  const navigate = usePageNavigation();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold">{t("me.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("me.description")}</p>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="mb-4 flex items-center gap-3">
            <UserRound className="size-5 text-muted-foreground" aria-hidden="true" />
            <div><h2 className="text-sm font-semibold">{t("me.account")}</h2><p className="text-xs text-muted-foreground">{t("me.accountHint")}</p></div>
          </div>
          <LoginControl expanded />
        </CardContent>
      </Card>

      <WorkProfileReview />

      <Card>
        <CardContent className="divide-y divide-border p-0">
          <PreferenceRow icon={Languages} label={t("me.language")}>
            <LanguagePicker comfortable />
          </PreferenceRow>
          <PreferenceRow icon={Palette} label={t("me.appearance")}>
            <SkinPicker alwaysVisible />
          </PreferenceRow>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="divide-y divide-border p-0">
          <Destination
            icon={Settings}
            label={t("me.settings")}
            description={t("me.settingsHint")}
            onClick={() => navigate("settings")}
          />
          <Destination
            icon={History}
            label={t("me.trace")}
            description={t("me.traceHint")}
            onClick={() => navigate("invocations")}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function PreferenceRow({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof UserRound;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
      <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="text-sm font-medium">{label}</span>
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
