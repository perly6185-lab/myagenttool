import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/common/empty-state";
import { useConsoleState } from "@/data/use-console-state";
import { useAsyncAction, api } from "@/data/use-console-actions";
import { useUiStore } from "@/store/ui-store";
import { cn } from "@/lib/cn";
import type { AgentSkillPath, AgentSkillSnapshot, AgentSkillTarget } from "@/lib/console-state";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";

const ALL_TARGETS: AgentSkillTarget[] = ["claude", "codex"];
const ALL_PATHS: AgentSkillPath[] = ["develop", "office", "general", "design", "creative", "content", "prototype", "clarify"];

interface Draft {
  name: string;
  slug: string;
  description: string;
  body: string;
  targets: AgentSkillTarget[];
  paths: AgentSkillPath[];
  cli: string;
  enabled: boolean;
}

function toDraft(skill: AgentSkillSnapshot | null): Draft {
  return {
    name: skill?.name ?? "",
    slug: skill?.slug ?? "",
    description: skill?.description ?? "",
    body: skill?.body ?? "",
    targets: skill?.targets ?? ["claude"],
    paths: skill?.paths ?? [],
    cli: skill?.tool?.cli ?? "",
    enabled: skill?.enabled ?? true,
  };
}

export function AgentSkillsView() {
  const { t } = useAppTranslation();
  const { data: state } = useConsoleState();
  const selectedSkillId = useUiStore((s) => s.selectedAgentSkillId);
  const setSelectedSkillId = useUiStore((s) => s.setSelectedAgentSkillId);
  const { execute, pending } = useAsyncAction();

  const skills = state?.agentSkills ?? [];
  const creating = selectedSkillId === "__new__";
  const skill = creating ? null : skills.find((s) => s.id === selectedSkillId) ?? null;

  const [draft, setDraft] = useState<Draft>(() => toDraft(skill));
  // Reload the editor whenever the selected skill changes.
  useEffect(() => {
    setDraft(toDraft(creating ? null : skill));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSkillId, skill?.updatedAt]);

  const toggleTarget = (t: AgentSkillTarget) =>
    setDraft((d) => ({
      ...d,
      targets: d.targets.includes(t) ? d.targets.filter((x) => x !== t) : [...d.targets, t],
    }));

  const togglePath = (p: AgentSkillPath) =>
    setDraft((d) => ({
      ...d,
      paths: d.paths.includes(p) ? d.paths.filter((x) => x !== p) : [...d.paths, p],
    }));

  const save = () => {
    const payload = {
      name: draft.name,
      slug: draft.slug || undefined,
      description: draft.description,
      body: draft.body,
      targets: draft.targets,
      paths: draft.paths,
      enabled: draft.enabled,
      tool: draft.cli ? { cli: draft.cli, ...(skill?.tool?.mcp ? { mcp: skill.tool.mcp } : {}) } : undefined,
    };
    if (creating) {
      void execute(async () => {
        const res = (await api.createAgentSkill(payload)) as { agentSkill: AgentSkillSnapshot };
        setSelectedSkillId(res.agentSkill.id);
      });
    } else if (skill) {
      void execute(() => api.updateAgentSkill(skill.id, payload));
    }
  };

  const remove = () => {
    if (!skill) return;
    void execute(async () => {
      await api.deleteAgentSkill(skill.id);
      setSelectedSkillId(null);
    });
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{t("agentSkillsPage.title")}</CardTitle>
          <Button size="sm" variant="primary" onClick={() => setSelectedSkillId("__new__")}>
            {t("agentSkillsPage.newSkill")}
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {skills.length === 0 ? (
            <EmptyState title={t("agentSkillsPage.empty")} hint={t("agentSkillsPage.emptyHint")} />
          ) : (
            skills.map((item) => {
              const active = item.id === selectedSkillId;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedSkillId(item.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                    active ? "border-primary/40 bg-accent" : "border-border hover:bg-accent/60",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {item.name}
                      {!item.enabled && <span className="ml-2 text-xs text-muted-foreground">({t("agentSkillsPage.disabled")})</span>}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{item.description || item.slug}</span>
                  </span>
                  <span className="flex shrink-0 gap-1">
                    {ALL_TARGETS.map((t) => (
                      <Badge key={t} tone={item.targets.includes(t) ? "running" : "neutral"}>
                        {t}
                      </Badge>
                    ))}
                  </span>
                </button>
              );
            })
          )}
        </CardContent>
      </Card>

      {creating || skill ? (
        <Card>
          <CardHeader>
            <CardTitle>{creating ? t("agentSkillsPage.newSkill") : skill?.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label={t("agentSkillsPage.name")}>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Image Edit" />
            </Field>
            <Field label={t("agentSkillsPage.slug")} hint={t("agentSkillsPage.slugHint")}>
              <Input value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} placeholder="image-edit" />
            </Field>
            <Field label={t("agentSkillsPage.description")} hint={t("agentSkillsPage.descriptionHint")}>
              <Input
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder={t("agentSkillsPage.descriptionPlaceholder")}
              />
            </Field>
            <Field label={t("agentSkillsPage.appliesTo")} hint={t("agentSkillsPage.appliesHint")}>
              <div className="flex gap-2">
                {ALL_TARGETS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleTarget(t)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors",
                      draft.targets.includes(t)
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-accent/60",
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </Field>
            <Field label={t("agentSkillsPage.roles")} hint={t("agentSkillsPage.rolesHint")}>
              <div className="flex flex-wrap gap-2">
                {ALL_PATHS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => togglePath(p)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors",
                      draft.paths.includes(p)
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-accent/60",
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </Field>
            <Field label={t("agentSkillsPage.body")} hint={t("agentSkillsPage.bodyHint")}>
              <Textarea
                className="min-h-40 font-mono text-xs"
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              />
            </Field>
            <Field label={t("agentSkillsPage.toolCli")} hint={t("agentSkillsPage.toolHint")}>
              <Input
                value={draft.cli}
                onChange={(e) => setDraft({ ...draft, cli: e.target.value })}
                placeholder="node packages/image-tool/cli.mjs"
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
              {t("agentSkillsPage.enabled")}
            </label>
            {skill?.tool?.mcp && (
              <p className="text-xs text-muted-foreground">
                {t("agentSkillsPage.mcpServer")}: <span className="font-mono">{skill.tool.mcp.name}</span> →{" "}
                <span className="font-mono">
                  {skill.tool.mcp.command} {(skill.tool.mcp.args ?? []).join(" ")}
                </span>{" "}
                ({t("agentSkillsPage.mcpHint")} <span className="font-mono">.mcp.json</span>)
              </p>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              <Button size="sm" variant="primary" disabled={pending || !draft.name.trim() || draft.targets.length === 0} onClick={save}>
                {creating ? t("agentSkillsPage.create") : t("agentSkillsPage.save")}
              </Button>
              {skill && (
                <Button size="sm" variant="secondary" disabled={pending} onClick={remove}>
                  {t("agentSkillsPage.delete")}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <EmptyState title={t("agentSkillsPage.select")} hint={t("agentSkillsPage.selectHint")} />
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
