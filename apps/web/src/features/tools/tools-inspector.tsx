import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FactList } from "@/components/common/fact-list";
import { api } from "@/data/use-console-actions";
import { useUiStore } from "@/store/ui-store";
import type { ToolDescriptor } from "@/lib/console-state";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

function inputFields(tool: ToolDescriptor): { name: string; required: boolean }[] {
  const schema = tool.inputSchema as { properties?: Record<string, unknown>; required?: string[] } | undefined;
  const required = new Set(schema?.required ?? []);
  return Object.keys(schema?.properties ?? {}).map((name) => ({ name, required: required.has(name) }));
}

function approvalEntries(tool: ToolDescriptor): { term: string; value: string }[] {
  const policy = tool.approvalPolicy ?? {};
  return Object.entries(policy).map(([term, value]) => ({ term, value: String(value) }));
}

/** Right-pane detail for the tool selected in the Tools view. */
export function ToolsInspector() {
  const { t } = useAppTranslation();
  const selectedToolName = useUiStore((s) => s.selectedToolName);
  const { data } = useQuery({ queryKey: ["tools"], queryFn: () => api.listTools(), refetchInterval: 2000 });
  const tool = data?.tools?.find((item) => item.name === selectedToolName);

  if (!tool) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("toolsInspector.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {t("toolsInspector.select")}
          </p>
        </CardContent>
      </Card>
    );
  }

  const fields = inputFields(tool);
  const approvals = approvalEntries(tool);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{tool.displayName}</CardTitle>
          <p className="text-xs text-muted-foreground">
            {tool.name} · v{tool.version}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <FactList
            facts={[
              { term: t("toolsInspector.risk"), value: tool.riskLevel ?? t("toolsPage.unknown") },
              { term: t("toolsInspector.output"), value: tool.outputCollection ?? "—" },
              {
                term: t("toolsInspector.billing"),
                value: t(tool.authoritativeBilling === false ? "toolsInspector.nonAuthoritative" : "toolsInspector.authoritative"),
              },
              { term: t("toolsInspector.device"), value: t(tool.requiresLocalDevice ? "toolsInspector.localRequired" : "toolsInspector.any") },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("toolsInspector.inputContract")}</CardTitle>
        </CardHeader>
        <CardContent>
          {fields.length ? (
            <div className="flex flex-wrap gap-1.5">
              {fields.map((field) => (
                <Badge key={field.name} tone={field.required ? "warning" : "neutral"}>
                  {field.name}
                  {field.required ? " *" : ""}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("toolsInspector.noFields")}</p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">{t("toolsInspector.required")}</p>
        </CardContent>
      </Card>

      {tool.agents?.length ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("toolsInspector.backingAgents")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {tool.agents.map((agent) => (
              <div key={agent.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="[overflow-wrap:anywhere] text-foreground">{agent.name}</span>
                <Badge tone={agent.status === "disabled" ? "danger" : "success"}>
                  {agent.status ?? "unknown"}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {approvals.length ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("toolsInspector.approvalPolicy")}</CardTitle>
          </CardHeader>
          <CardContent>
            <FactList facts={approvals} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
