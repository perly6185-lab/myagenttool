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
import type { SkillSnapshot, SkillTarget } from "@/lib/console-state";

const ALL_TARGETS: SkillTarget[] = ["claude", "codex"];

interface Draft {
  name: string;
  slug: string;
  description: string;
  body: string;
  targets: SkillTarget[];
  cli: string;
  enabled: boolean;
}

function toDraft(skill: SkillSnapshot | null): Draft {
  return {
    name: skill?.name ?? "",
    slug: skill?.slug ?? "",
    description: skill?.description ?? "",
    body: skill?.body ?? "",
    targets: skill?.targets ?? ["claude"],
    cli: skill?.tool?.cli ?? "",
    enabled: skill?.enabled ?? true,
  };
}

export function SkillsView() {
  const { data: state } = useConsoleState();
  const selectedSkillId = useUiStore((s) => s.selectedSkillId);
  const setSelectedSkillId = useUiStore((s) => s.setSelectedSkillId);
  const { execute, pending } = useAsyncAction();

  const skills = state?.skills ?? [];
  const creating = selectedSkillId === "__new__";
  const skill = creating ? null : skills.find((s) => s.id === selectedSkillId) ?? null;

  const [draft, setDraft] = useState<Draft>(() => toDraft(skill));
  // Reload the editor whenever the selected skill changes.
  useEffect(() => {
    setDraft(toDraft(creating ? null : skill));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSkillId, skill?.updatedAt]);

  const toggleTarget = (t: SkillTarget) =>
    setDraft((d) => ({
      ...d,
      targets: d.targets.includes(t) ? d.targets.filter((x) => x !== t) : [...d.targets, t],
    }));

  const save = () => {
    const payload = {
      name: draft.name,
      slug: draft.slug || undefined,
      description: draft.description,
      body: draft.body,
      targets: draft.targets,
      enabled: draft.enabled,
      tool: draft.cli ? { cli: draft.cli, ...(skill?.tool?.mcp ? { mcp: skill.tool.mcp } : {}) } : undefined,
    };
    if (creating) {
      void execute(async () => {
        const res = (await api.createSkill(payload)) as { skill: SkillSnapshot };
        setSelectedSkillId(res.skill.id);
      });
    } else if (skill) {
      void execute(() => api.updateSkill(skill.id, payload));
    }
  };

  const remove = () => {
    if (!skill) return;
    void execute(async () => {
      await api.deleteSkill(skill.id);
      setSelectedSkillId(null);
    });
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Skills</CardTitle>
          <Button size="sm" variant="primary" onClick={() => setSelectedSkillId("__new__")}>
            New skill
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {skills.length === 0 ? (
            <EmptyState title="No skills yet" hint="Create a skill and target it at Claude and/or Codex." />
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
                      {!item.enabled && <span className="ml-2 text-xs text-muted-foreground">(disabled)</span>}
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
            <CardTitle>{creating ? "New skill" : skill?.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Name">
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Image Edit" />
            </Field>
            <Field label="Slug" hint="Used for .claude/skills/<slug>/. Defaults from name.">
              <Input value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} placeholder="image-edit" />
            </Field>
            <Field label="Description" hint="One line — used in SKILL.md frontmatter and the Codex trigger.">
              <Input
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="Edit or generate images from a prompt."
              />
            </Field>
            <Field label="Applies to" hint="Only matching agents get this skill rendered into their run.">
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
            <Field label="Body" hint="Markdown instructions — when and how the agent should use this skill.">
              <Textarea
                className="min-h-40 font-mono text-xs"
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              />
            </Field>
            <Field label="Tool CLI" hint="Optional command Codex runs for this skill's capability.">
              <Input
                value={draft.cli}
                onChange={(e) => setDraft({ ...draft, cli: e.target.value })}
                placeholder="node packages/image-tool/cli.mjs"
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
              Enabled
            </label>
            {skill?.tool?.mcp && (
              <p className="text-xs text-muted-foreground">
                MCP server: <span className="font-mono">{skill.tool.mcp.name}</span> →{" "}
                <span className="font-mono">
                  {skill.tool.mcp.command} {(skill.tool.mcp.args ?? []).join(" ")}
                </span>{" "}
                (rendered into <span className="font-mono">.mcp.json</span> for Claude)
              </p>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              <Button size="sm" variant="primary" disabled={pending || !draft.name.trim() || draft.targets.length === 0} onClick={save}>
                {creating ? "Create skill" : "Save changes"}
              </Button>
              {skill && (
                <Button size="sm" variant="secondary" disabled={pending} onClick={remove}>
                  Delete
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <EmptyState title="Select a skill" hint="Pick a skill on the left, or create a new one." />
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
