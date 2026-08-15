import { Archive, Eye, FileInput, FileOutput, FileText, FolderOpen, Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { LocalContentKind, LocalContentRecord } from "./local-content-types";

type LocalContentCardCopy = {
  kinds: Record<LocalContentKind, string>;
  available: string;
  unavailable: string;
  metadataOnly: string;
  partial: string;
  missing: string;
  sameOriginal: string;
  source: string;
  related: string;
  preview: string;
  locate: string;
  locating: string;
  originalMissing: string;
  addToTask: string;
};

type LocalContentCardProps = {
  record: LocalContentRecord;
  copy: LocalContentCardCopy;
  locating: boolean;
  locateDisabled: boolean;
  onPreview: () => void;
  onLocate: () => void;
  onChoose: () => void;
};

function kindIcon(kind: LocalContentKind) {
  if (kind === "mail") return Mail;
  if (kind === "task_input") return FileInput;
  if (kind === "task_output") return FileOutput;
  if (kind === "task") return FileText;
  return Archive;
}

function displaySource(record: LocalContentRecord) {
  if (record.sourceLabel) return record.sourceLabel;
  if (record.relativePath) return record.relativePath.replaceAll("\\", "/").split("/").at(-1) ?? record.relativePath;
  if (record.source.id) return record.source.id;
  return record.source.type ?? "—";
}

export function LocalContentCard({
  record,
  copy,
  locating,
  locateDisabled,
  onPreview,
  onLocate,
  onChoose,
}: LocalContentCardProps) {
  const Icon = kindIcon(record.kind);
  const source = displaySource(record);
  const related = record.relations.find((relation) => relation.title);

  return (
    <Card className="flex min-w-0 flex-col">
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="size-4" aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 text-sm font-semibold leading-snug">{record.title}</h3>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Badge tone="neutral">{copy.kinds[record.kind]}</Badge>
              <Badge tone={record.original.available ? "success" : "warning"}>{record.original.available ? copy.available : copy.unavailable}</Badge>
              {record.indexStatus === "metadata_only" ? <Badge tone="neutral">{copy.metadataOnly}</Badge> : null}
              {record.indexStatus === "partial" ? <Badge tone="warning">{copy.partial}</Badge> : null}
              {record.indexStatus === "missing" ? <Badge tone="warning">{copy.missing}</Badge> : null}
              {record.sameContent ? <Badge tone="neutral">{copy.sameOriginal.replace("{{count}}", String(record.sameContent.appearances))}</Badge> : null}
            </div>
          </div>
        </div>
        {(record.matchSnippet || record.summary) ? <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">{record.matchSnippet || record.summary}</p> : null}
        <p className="mt-auto truncate text-xs text-muted-foreground" title={source}>{copy.source}: {source}</p>
        {related ? <p className="truncate text-xs text-muted-foreground">{copy.related}: {related.title}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={!record.original.available} title={!record.original.available ? copy.originalMissing : undefined} onClick={onPreview}><Eye aria-hidden />{copy.preview}</Button>
          <Button size="sm" variant="ghost" disabled={!record.original.available || record.storageMode === "state_record" || locateDisabled} title={!record.original.available ? copy.originalMissing : undefined} onClick={onLocate}><FolderOpen aria-hidden />{locating ? copy.locating : copy.locate}</Button>
          <Button size="sm" variant="secondary" disabled={!record.original.available} title={!record.original.available ? copy.originalMissing : undefined} onClick={onChoose}>{copy.addToTask}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
