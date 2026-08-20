import { Eye, FileText, FolderOpen, ImageIcon, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { MarkdownBlock } from "@/components/ui/markdown-block";
import { api } from "@/data/use-console-actions";
import { localContentApi } from "@/features/local-content/local-content-api";
import type { WorkItemOutcomeFile } from "./task-view-types";
import {
  imageMime,
  markdownImageCount,
  markdownImageReferences,
  parseMarkdownDocument,
  resolveDeliveryAssetPath,
} from "./work-item-delivery-preview-model";

export const MARKDOWN_DELIVERY_EXTENSIONS = new Set([".md", ".mdx"]);
export const IMAGE_DELIVERY_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"]);

export function deliverableFileKey(file: WorkItemOutcomeFile) {
  return file.contentId
    ? `local-content:${file.contentId}`
    : `${file.projectId ?? "project"}:${file.worktreeId ?? "base"}:${file.path ?? file.name}`;
}

type DeliverableFileCopy = {
  noDeliverableFiles: string;
  browseDeliverableFile: string;
  deliverableFileOpening: string;
  deliverableFileOpenHint: string;
  deliverableFileUnsupported: string;
  openDeliverableFolder: string;
  deliverableFolderUnavailable: string;
};

type MarkdownDocumentCopy = {
  deliverablePreviewSource: string;
  deliverablePreviewAuthor: string;
  deliverablePreviewPublished: string;
  deliverablePreviewImages: string;
  deliverablePreviewShowFirstImage: string;
  deliverablePreviewImageUnavailable: string;
};

export function DeliveryMarkdownDocument({
  file,
  text,
  copy,
}: {
  file: WorkItemOutcomeFile;
  text: string;
  copy: MarkdownDocumentCopy;
}) {
  const document = useMemo(() => parseMarkdownDocument(text), [text]);
  const articleRef = useRef<HTMLElement>(null);
  const imageCount = useMemo(() => markdownImageCount(document.body), [document.body]);
  const [imageSources, setImageSources] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!file.contentId && (!file.projectId || !file.path)) return undefined;
    let cancelled = false;
    const objectUrls: string[] = [];
    const references = markdownImageReferences(document.body);
    if (!references.length) return undefined;
    void Promise.all(references.map(async (reference) => {
      const assetPath = resolveDeliveryAssetPath(file.path ?? "article.md", reference);
      if (!assetPath) return null;
      try {
        const bytes = file.contentId
          ? await localContentApi.previewAssetBytes(file.contentId, assetPath)
          : await api.projectAssetPreviewBytes(file.projectId!, assetPath, file.worktreeId ?? undefined);
        const source = URL.createObjectURL(new Blob([bytes], { type: imageMime(assetPath) }));
        objectUrls.push(source);
        return [reference, source] as const;
      } catch {
        return null;
      }
    })).then((entries) => {
      if (cancelled) {
        for (const source of objectUrls) URL.revokeObjectURL(source);
        return;
      }
      setImageSources(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry))));
    });
    return () => {
      cancelled = true;
      for (const source of objectUrls) URL.revokeObjectURL(source);
    };
  }, [document.body, file.contentId, file.path, file.projectId, file.worktreeId]);

  const metadata = [
    document.metadata.author ? `${copy.deliverablePreviewAuthor}: ${document.metadata.author}` : null,
    document.metadata.published_at ? `${copy.deliverablePreviewPublished}: ${document.metadata.published_at}` : null,
    document.metadata.source_provider ? `${copy.deliverablePreviewSource}: ${document.metadata.source_provider}` : null,
  ].filter(Boolean);
  const showFirstImage = () => {
    articleRef.current?.querySelector<HTMLElement>("img, [role='img']")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  return (
    <article ref={articleRef} className="mx-auto max-w-4xl px-1 pb-6 sm:px-5">
      {metadata.length ? <p className="mb-5 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground">{metadata.join(" · ")}</p> : null}
      {imageCount ? (
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-primary/25 bg-primary/[0.045] px-3 py-2 text-sm" role="status">
          <ImageIcon className="size-4 text-primary" aria-hidden />
          <span className="mr-auto">{copy.deliverablePreviewImages.replace("{count}", String(imageCount))}</span>
          <Button type="button" size="sm" variant="secondary" onClick={showFirstImage}>{copy.deliverablePreviewShowFirstImage}</Button>
        </div>
      ) : null}
      <MarkdownBlock
        text={document.body}
        variant="document"
        imageUnavailableLabel={copy.deliverablePreviewImageUnavailable}
        resolveImageSrc={(src) => /^(?:https?:|data:|blob:)/i.test(src) ? src : imageSources[src] ?? null}
      />
    </article>
  );
}

export function DeliverableFileList({
  entries,
  copy,
  openingKey,
  error,
  limit,
  onOpen,
}: {
  entries: WorkItemOutcomeFile[];
  copy: DeliverableFileCopy;
  openingKey: string | null;
  error: string | null;
  limit?: number;
  onOpen: (file: WorkItemOutcomeFile) => void;
}) {
  const [revealingKey, setRevealingKey] = useState<string | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);
  const revealBridge = window.myagenttoolDesktop?.revealContainedAsset;
  const visible = typeof limit === "number" ? entries.slice(0, limit) : entries;
  if (!visible.length) return <p className="mt-1.5 text-sm text-muted-foreground">{copy.noDeliverableFiles}</p>;
  return (
    <>
      <ul className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
        {visible.map((file) => {
          const key = deliverableFileKey(file);
          const opening = openingKey === key;
          const canOpen = file.status === "available"
            && (Boolean(file.contentId)
              || (Boolean(file.projectId && file.path) && (file.preview === "document" || Boolean(file.worktreeId))));
          const canReveal = file.status === "available" && Boolean(file.contentId || (file.projectId && file.path));
          const revealing = revealingKey === key;
          const reveal = async () => {
            setRevealError(null);
            setRevealingKey(key);
            try {
              if (file.contentId) {
                await localContentApi.reveal(file.contentId);
              } else if (file.projectId && file.path && revealBridge) {
                await revealBridge({
                  projectId: file.projectId,
                  relativePath: file.path,
                  ...(file.worktreeId ? { worktreeId: file.worktreeId } : {}),
                });
              } else if (file.projectId && file.path) {
                await api.revealProjectAsset(file.projectId, file.path, file.worktreeId ?? undefined);
              } else {
                throw new Error("deliverable_file_unavailable");
              }
            } catch {
              setRevealError(copy.deliverableFolderUnavailable);
            } finally {
              setRevealingKey(null);
            }
          };
          const content = (
            <>
              {opening
                ? <RefreshCw className="size-3.5 shrink-0 animate-spin text-primary" aria-hidden />
                : canOpen
                  ? <FileText className="size-3.5 shrink-0 text-primary" aria-hidden />
                  : <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-xs">{file.name}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {opening ? copy.deliverableFileOpening : canOpen ? copy.deliverableFileOpenHint : copy.deliverableFileUnsupported}
                </span>
              </span>
              {canOpen ? <Eye className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : null}
            </>
          );
          return (
            <li key={key} title={file.path ?? file.name} className="min-w-0">
              <div className="flex overflow-hidden rounded-lg bg-background/70">
                {canOpen ? (
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait"
                    aria-label={`${copy.browseDeliverableFile}: ${file.name}`}
                    disabled={Boolean(openingKey)}
                    onClick={() => onOpen(file)}
                  >
                    {content}
                  </button>
                ) : <div className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 opacity-75" aria-disabled="true">{content}</div>}
                {canReveal ? (
                  <button
                    type="button"
                    className="grid w-11 shrink-0 place-items-center border-l border-border/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait"
                    aria-label={`${copy.openDeliverableFolder}: ${file.name}`}
                    title={copy.openDeliverableFolder}
                    disabled={Boolean(revealingKey)}
                    onClick={() => void reveal()}
                  >
                    {revealing ? <RefreshCw className="size-4 animate-spin" aria-hidden /> : <FolderOpen className="size-4" aria-hidden />}
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {error ? <p className="mt-2 rounded-md border border-warning/40 bg-warning/[0.07] px-3 py-2 text-sm" role="alert">{error}</p> : null}
      {revealError ? <p className="mt-2 rounded-md border border-warning/40 bg-warning/[0.07] px-3 py-2 text-sm" role="alert">{revealError}</p> : null}
    </>
  );
}
