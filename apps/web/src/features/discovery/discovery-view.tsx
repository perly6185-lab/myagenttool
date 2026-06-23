import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { FactList } from "@/components/common/fact-list";
import { EmptyState } from "@/components/common/empty-state";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { useUiStore } from "@/store/ui-store";
import { readableAdapterType, readableDiscoverySource } from "@/lib/readable-labels";
import { RegisterCodexCard } from "@/features/discovery/register-codex-card";
import type { DiscoveryCandidate, DiscoveryRunSnapshot } from "@/lib/console-state";

const FULL_SCOPE = [
  "known_command_allowlist",
  "known_local_endpoint",
  "user_provided_path",
  "user_provided_endpoint",
  "bridge_managed_config",
];

function parseList(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isCodex(candidate: DiscoveryCandidate): boolean {
  const command = String(candidate.adapter?.command ?? "").toLowerCase();
  return (
    command === "codex" ||
    command.endsWith("/codex") ||
    command.endsWith("\\codex") ||
    candidate.adapter?.outputFormat === "codex_jsonl"
  );
}

function discoverySummaryText(run: DiscoveryRunSnapshot | undefined): string {
  if (!run) return "Discovery is conservative and only checks known or user-provided sources.";
  if (run.status === "queued") return "Discovery is queued for Desktop Bridge.";
  if (run.status === "running") return "Desktop Bridge is checking conservative discovery sources.";
  if (run.status === "failed") return run.message ?? "Discovery failed.";
  return `${run.message ?? "Discovery finished."} Candidates are not auto-enabled.`;
}

export function DiscoveryView() {
  const { data: state } = useConsoleState();
  const setSelectedAgentId = useUiStore((s) => s.setSelectedAgentId);
  const { execute, pending } = useAsyncAction();

  const [paths, setPaths] = useState("demo-agent");
  const [endpoints, setEndpoints] = useState("http://127.0.0.1:3212");

  const run = state?.discoveryRuns?.[0];
  const offline = state?.device?.status !== "online";
  const busy = pending || run?.status === "queued" || run?.status === "running";
  const blocked = !state || offline || busy;

  function discover() {
    void execute(() =>
      api.createDiscovery({
        scope: FULL_SCOPE,
        userProvidedPaths: parseList(paths),
        userProvidedEndpoints: parseList(endpoints),
      }),
    );
  }

  function addCodex() {
    if (!parseList(paths).includes("codex")) setPaths((prev) => `${prev ? `${prev}, ` : ""}codex`);
    void execute(() =>
      api.createDiscovery({ scope: ["user_provided_path"], userProvidedPaths: ["codex"] }),
    );
  }

  async function register(candidate: DiscoveryCandidate) {
    if (!run) return;
    await execute(async () => {
      const result = (await api.registerCandidate(run.id, candidate.id)) as { agent?: { id: string } };
      if (result.agent?.id) setSelectedAgentId(result.agent.id);
      return result;
    });
  }

  return (
    <div className="space-y-5">
      <RegisterCodexCard />

      <Card>
        <CardHeader>
          <CardTitle>Find local agents</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="CLI commands or paths">
              <Input value={paths} onChange={(e) => setPaths(e.target.value)} />
            </Field>
            <Field label="HTTP endpoints">
              <Input value={endpoints} onChange={(e) => setEndpoints(e.target.value)} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={blocked} onClick={discover}>
              Discover agents
            </Button>
            <Button variant="secondary" disabled={blocked} onClick={addCodex}>
              Add Codex CLI
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{discoverySummaryText(run)}</p>
          {offline ? (
            <p className="text-xs text-warning">Discovery needs Desktop Bridge online.</p>
          ) : null}
        </CardContent>
      </Card>

      {!run?.candidates?.length ? (
        <EmptyState title="No candidates yet" hint="Run discovery while Desktop Bridge is online." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {run.candidates.map((candidate) => (
            <Card key={candidate.id}>
              <CardHeader>
                <CardTitle>{candidate.name}</CardTitle>
                <p className="text-sm text-muted-foreground">{candidate.description}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  <Badge>Adapter: {readableAdapterType(candidate.adapter?.type)}</Badge>
                  <Badge>Source: {readableDiscoverySource(candidate.source)}</Badge>
                  <Badge>Confidence: {candidate.confidence}</Badge>
                  <Badge tone={candidate.riskLevel === "high" ? "danger" : "neutral"}>
                    Risk: {candidate.riskLevel}
                  </Badge>
                  <Badge>{candidate.healthProbeAvailable ? "Health probe" : "No health probe"}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {candidate.riskHints?.join(" ") ?? "Review this candidate before registering."}
                </p>
                {isCodex(candidate) ? (
                  <div className="rounded-lg border border-warning/40 bg-warning/10 p-3">
                    <FactList
                      facts={[
                        {
                          term: "Command",
                          value: [candidate.adapter?.command, ...(candidate.adapter?.args ?? [])]
                            .filter(Boolean)
                            .join(" "),
                        },
                        {
                          term: "Evidence",
                          value:
                            candidate.adapter?.outputFormat === "codex_jsonl"
                              ? "Codex JSONL events"
                              : "Review output format",
                        },
                        { term: "Sandbox", value: candidate.adapter?.sandbox ?? "unset" },
                        { term: "Approval", value: "Required before high-risk local invocation" },
                      ]}
                    />
                  </div>
                ) : null}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending || candidate.registration?.status === "registered"}
                  onClick={() => register(candidate)}
                >
                  {candidate.registration?.status === "registered" ? "Registered disabled" : "Register disabled"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
