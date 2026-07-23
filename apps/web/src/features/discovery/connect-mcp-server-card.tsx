import { useState } from "react";
import { Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/common/field";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { useConsoleState } from "@/data/use-console-state";
import { useUiStore } from "@/store/ui-store";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

export interface McpConnectForm {
  transport: string;
  command: string;
  argsText: string;
  url: string;
  allowedToolsText: string;
}

function parseList(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Assemble the adapter config for both the dry-probe and the eventual
 * registration. Exported (and pure) so the transport-specific shape — stdio
 * carries command+args, http carries url — is unit-tested without the bridge.
 */
export function buildMcpProbePayload(form: McpConnectForm): Record<string, unknown> {
  const allowedTools = parseList(form.allowedToolsText);
  if (form.transport === "http") {
    return { transport: "http", url: form.url.trim(), allowedTools };
  }
  return { transport: "stdio", command: form.command.trim(), args: parseList(form.argsText), allowedTools };
}

interface ProbeState {
  status: "idle" | "probing" | "ok" | "failed";
  message?: string;
  tools?: string[];
}

interface ProbeRunResult {
  id: string;
  status: string;
  summary?: string;
  tools?: string[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function ConnectMcpServerCard() {
  const { t } = useAppTranslation();
  const setSelectedAgentId = useUiStore((s) => s.setSelectedAgentId);
  const setSection = useUiStore((s) => s.setSection);
  const { data: state } = useConsoleState();
  const { execute, pending, error } = useAsyncAction();

  const [name, setName] = useState<string>(() => t("mcp.defaultName"));
  const [transport, setTransport] = useState("stdio");
  const [command, setCommand] = useState("");
  const [argsText, setArgsText] = useState("");
  const [url, setUrl] = useState("");
  const [allowedToolsText, setAllowedToolsText] = useState("");
  const [costOwner, setCostOwner] = useState("usr_local");
  const [probe, setProbe] = useState<ProbeState>({ status: "idle" });

  const offline = state?.device?.status !== "online";
  const form: McpConnectForm = { transport, command, argsText, url, allowedToolsText };
  const targetFilled = transport === "http" ? url.trim().length > 0 : command.trim().length > 0;
  const canProbe = !pending && !offline && targetFilled;
  const canConnect = probe.status === "ok";
  // Empty allowlist means the server's whole tool surface is exposed — the
  // governance signal the connect flow must not let read as "ordinary/safe".
  const wideOpen = parseList(allowedToolsText).length === 0;

  // Any change to the config invalidates a prior probe result.
  function edited<T>(setter: (v: T) => void) {
    return (v: T) => {
      setProbe({ status: "idle" });
      setter(v);
    };
  }

  async function testConnection() {
    setProbe({ status: "probing" });
    const succeeded = await execute(async () => {
      const started = (await api.probeAgent(buildMcpProbePayload(form))) as { probeRun: { id: string } };
      const id = started.probeRun.id;
      for (let attempt = 0; attempt < 25; attempt += 1) {
        await sleep(600);
        const { probeRun } = (await api.getAgentProbe(id)) as { probeRun: ProbeRunResult };
        if (probeRun.status === "succeeded") {
          setProbe({ status: "ok", message: probeRun.summary, tools: probeRun.tools ?? [] });
          return probeRun;
        }
        if (probeRun.status === "failed") {
          setProbe({ status: "failed", message: probeRun.summary ?? t("mcp.probeFailed") });
          return probeRun;
        }
      }
      setProbe({ status: "failed", message: t("mcp.probeTimeout") });
      return null;
    });
    // execute() swallows thrown errors (e.g. offline/invalid config) and surfaces
    // them via `error`; without this the button would stay stuck on "Testing…".
    if (!succeeded) setProbe((prev) => (prev.status === "probing" ? { status: "idle" } : prev));
  }

  async function connect() {
    await execute(async () => {
      const result = (await api.registerAgent({
        type: "mcp",
        name: name.trim() || t("mcp.defaultName"),
        costOwner: costOwner.trim() || "usr_local",
        ...buildMcpProbePayload(form),
      })) as { agent: { id: string } };
      setSelectedAgentId(result.agent.id);
      setSection("agents");
      return result;
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("mcp.title")}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {t("mcp.description")}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("mcp.name")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t("mcp.transport")}>
            <Select value={transport} onChange={(e) => edited(setTransport)(e.target.value)}>
              <option value="stdio">{t("mcp.stdio")}</option>
              <option value="http">{t("mcp.http")}</option>
            </Select>
          </Field>
          {transport === "stdio" ? (
            <>
              <Field label={t("mcp.command")}>
                <Input
                  value={command}
                  placeholder="npx"
                  onChange={(e) => edited(setCommand)(e.target.value)}
                />
              </Field>
              <Field label={t("mcp.arguments")}>
                <Input
                  value={argsText}
                  placeholder="-y, @modelcontextprotocol/server-filesystem, /path"
                  onChange={(e) => edited(setArgsText)(e.target.value)}
                />
              </Field>
            </>
          ) : (
            <Field label={t("mcp.serverUrl")}>
              <Input
                value={url}
                placeholder="https://mcp.example/rpc"
                onChange={(e) => edited(setUrl)(e.target.value)}
              />
            </Field>
          )}
          <Field label={t("mcp.allowedTools")}>
            <Input
              value={allowedToolsText}
              placeholder="read_file, list_dir"
              onChange={(e) => edited(setAllowedToolsText)(e.target.value)}
            />
          </Field>
          <Field label={t("mcp.costOwner")}>
            <Input value={costOwner} onChange={(e) => setCostOwner(e.target.value)} />
          </Field>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
          <Badge tone={wideOpen ? "danger" : "warning"}>{t(wideOpen ? "mcp.allTools" : "mcp.allowlisted")}</Badge>
          <p className="text-muted-foreground">
            {wideOpen
              ? t("mcp.allToolsHint")
              : t("mcp.allowlistedHint")}
          </p>
        </div>

        {probe.status === "ok" ? (
          <div className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm">
            <p className="text-success">{probe.message ?? t("mcp.handshakeSucceeded")}</p>
            {probe.tools && probe.tools.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {probe.tools.map((tool) => (
                  <Badge key={tool}>{tool}</Badge>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">{t("mcp.noTools")}</p>
            )}
          </div>
        ) : null}
        {probe.status === "failed" ? (
          <p className="text-xs text-destructive">{probe.message}</p>
        ) : null}

        <div className="flex items-center gap-3">
          <Button variant="secondary" disabled={!canProbe} onClick={testConnection}>
            {t(probe.status === "probing" ? "mcp.testing" : "mcp.test")}
          </Button>
          <Button variant={canConnect ? "primary" : "secondary"} disabled={!canConnect || pending} onClick={connect}>
            {t(pending && canConnect ? "mcp.connecting" : "mcp.connect")}
          </Button>
          {canConnect ? (
            <span className="inline-flex items-center gap-1 text-xs text-success">
              <Check className="size-3.5" />
              {t("mcp.verified")}
            </span>
          ) : null}
        </div>
        {offline ? <p className="text-xs text-warning">{t("mcp.bridgeRequired")}</p> : null}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
