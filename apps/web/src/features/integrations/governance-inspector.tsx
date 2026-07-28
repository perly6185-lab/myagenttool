import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FactList } from "@/components/common/fact-list";
import { useConsoleState } from "@/data/use-console-state";
import { retentionSummary } from "@/lib/readable-labels";
import type { IntegrationArtifact } from "@/lib/console-state";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

function builderSummary(artifacts: IntegrationArtifact[] = []): string {
  if (!artifacts.length) return "Integration Builder drafts plans only";
  const generated = artifacts.filter((item) => item.generatedByAi).length;
  return `${artifacts.length} artifact(s), ${generated} AI-generated, advisory until explicit action`;
}

export function GovernanceInspector() {
  const { t } = useAppTranslation();
  const { data: state } = useConsoleState();
  const quota = state?.quotaDecisionRecords?.[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("integrationInspector.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <FactList
          facts={[
            {
              term: t("integrationInspector.quota"),
              value: quota ? `${quota.decision}: ${quota.reason}` : t("integrationInspector.noQuota"),
            },
            { term: t("integrationInspector.retention"), value: retentionSummary(state?.retentionSettings) },
            { term: t("integrationInspector.builder"), value: builderSummary(state?.integrationArtifacts) },
          ]}
        />
      </CardContent>
    </Card>
  );
}
