import { Badge } from "@/components/ui/badge";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import type { IssueClaimEvent } from "@/lib/console-state";

const CLAIM_EVENT_TONE = { claimed: "warning", released: "neutral", expired: "danger" } as const;

export function ClaimHistoryList({ events }: { events: IssueClaimEvent[] }) {
  const { t } = useAppTranslation();
  if (!events.length) return <p className="text-sm text-muted-foreground">{t("tasks.noClaimHistory")}</p>;
  return (
    <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto">
      {events.map((event) => (
        <li key={event.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border/60 px-2.5 py-1.5 text-xs">
          <Badge tone={CLAIM_EVENT_TONE[event.type] ?? "neutral"}>{event.type}</Badge>
          <span className="font-medium">{event.claimedBy}</span>
          <span className="text-muted-foreground">{event.mode}</span>
          {event.type === "released" && event.actorId && event.actorId !== event.claimedBy ? (
            <span className="text-muted-foreground">{t("tasks.releasedBy", { actor: event.actorId })}</span>
          ) : null}
          {event.outcome && event.outcome !== "released" ? <span className="text-muted-foreground">{event.outcome.replaceAll("_", " ")}</span> : null}
          {event.autoRunId ? <span className="font-mono text-muted-foreground">{event.autoRunId}</span> : null}
          <span className="ml-auto text-muted-foreground">{event.at.replace("T", " ").slice(0, 16)}</span>
        </li>
      ))}
    </ul>
  );
}
