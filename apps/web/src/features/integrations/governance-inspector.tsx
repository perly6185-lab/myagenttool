import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FactList } from "@/components/common/fact-list";
import { useConsoleState } from "@/data/use-console-state";
import { retentionSummary } from "@/lib/readable-labels";
import type { IntegrationArtifact } from "@/lib/console-state";

function builderSummary(artifacts: IntegrationArtifact[] = []): string {
  if (!artifacts.length) return "Integration Builder drafts plans only";
  const generated = artifacts.filter((item) => item.generatedByAi).length;
  return `${artifacts.length} artifact(s), ${generated} AI-generated, advisory until explicit action`;
}

export function GovernanceInspector() {
  const { data: state } = useConsoleState();
  const quota = state?.quotaDecisionRecords?.[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Integration controls</CardTitle>
      </CardHeader>
      <CardContent>
        <FactList
          facts={[
            {
              term: "Quota",
              value: quota ? `${quota.decision}: ${quota.reason}` : "No quota decision recorded yet",
            },
            { term: "Retention", value: retentionSummary(state?.retentionSettings) },
            { term: "Builder", value: builderSummary(state?.integrationArtifacts) },
          ]}
        />
      </CardContent>
    </Card>
  );
}
