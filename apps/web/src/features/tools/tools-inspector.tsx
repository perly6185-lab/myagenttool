import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FactList } from "@/components/common/fact-list";
import { api } from "@/data/use-console-actions";
import { useUiStore } from "@/store/ui-store";
import type { ToolDescriptor } from "@/lib/console-state";

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
  const selectedToolName = useUiStore((s) => s.selectedToolName);
  const { data } = useQuery({ queryKey: ["tools"], queryFn: () => api.listTools(), refetchInterval: 2000 });
  const tool = data?.tools?.find((item) => item.name === selectedToolName);

  if (!tool) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Tool details</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Select a tool to see its input contract, backing agents, and approval policy.
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
              { term: "Risk", value: tool.riskLevel ?? "unknown" },
              { term: "Output", value: tool.outputCollection ?? "—" },
              {
                term: "Billing",
                value: tool.authoritativeBilling === false ? "Non-authoritative" : "Authoritative",
              },
              { term: "Device", value: tool.requiresLocalDevice ? "Local device required" : "Any" },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Input contract</CardTitle>
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
            <p className="text-sm text-muted-foreground">No declared input fields.</p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">* required</p>
        </CardContent>
      </Card>

      {tool.agents?.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Backing agents</CardTitle>
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
            <CardTitle>Approval policy</CardTitle>
          </CardHeader>
          <CardContent>
            <FactList facts={approvals} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
