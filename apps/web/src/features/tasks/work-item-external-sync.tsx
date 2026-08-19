import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import type { LocalWorkItem } from "./task-view-types";

type Binding = NonNullable<LocalWorkItem["externalBindings"]>[number];
type Direction = "pull" | "push" | "resolve_local" | "resolve_remote";

export function WorkItemExternalSync({
  itemId,
  binding,
  providerLabel,
  pending,
  onSync,
}: {
  itemId: string;
  binding: Binding | null | undefined;
  providerLabel: string;
  pending: boolean;
  onSync: (direction: Direction) => void;
}) {
  const { t } = useAppTranslation();
  if (!binding) return null;
  return (
    <div id={`work-item-external-${itemId}`} className="space-y-2 rounded-md border border-border p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={binding.conflict ? "danger" : "success"}>
          {providerLabel} #{binding.number} · {t(binding.conflict ? "taskLocal.github.conflict" : "taskLocal.github.synced")}
        </Badge>
        <Badge tone="neutral">{binding.isPrimary ? "source" : (binding.relation ?? "related")}</Badge>
        {binding.url ? <a className="text-primary hover:underline" href={binding.url} target="_blank" rel="noreferrer">{t("taskLocal.github.open")}</a> : null}
        <Button variant="secondary" disabled={pending} onClick={() => onSync("pull")}>{t("taskLocal.github.pull")}</Button>
        <Button variant="secondary" disabled={pending || Boolean(binding.conflict)} onClick={() => onSync("push")}>{t("taskLocal.github.push")}</Button>
      </div>
      {binding.conflict ? (
        <div className="flex flex-wrap items-center gap-2 rounded bg-danger/10 p-2">
          <span>{t("taskLocal.github.conflictFields", { fields: binding.conflict.fields.join(", ") })}</span>
          <Button variant="secondary" disabled={pending} onClick={() => onSync("resolve_local")}>{t("taskLocal.github.keepLocal")}</Button>
          <Button variant="secondary" disabled={pending} onClick={() => onSync("resolve_remote")}>{t("taskLocal.github.acceptRemote")}</Button>
        </div>
      ) : null}
    </div>
  );
}
