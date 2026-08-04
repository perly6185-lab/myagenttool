import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ReceiptText, Send, ShieldCheck } from "lucide-react";
import { ConfirmModal } from "@/components/common/confirm-modal";
import { Field } from "@/components/common/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { useVisibleInterval } from "@/hooks/use-visible-interval";
import { api } from "@/lib/api-client";
import type { ChannelConversation, ChannelOperations } from "@/lib/console-state";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import {
  WORK_ITEM_REPORT_DELIVERY_ACTION,
  workItemReportApi,
} from "./work-item-report-api";
import type { WorkItemReportDelivery, WorkItemReportDraft } from "./work-item-report-types";

function operationKey(prefix: string) {
  return globalThis.crypto?.randomUUID?.()
    ?? `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function deliveryTone(status: WorkItemReportDelivery["status"]) {
  if (status === "delivered") return "success" as const;
  if (status === "failed") return "danger" as const;
  if (status === "queued") return "running" as const;
  return "neutral" as const;
}

export function WorkItemReportDeliveryPanel({
  itemId,
  draft,
  channels,
  conversations,
  onSent,
}: {
  itemId: string;
  draft: WorkItemReportDraft;
  channels: ChannelOperations[];
  conversations: ChannelConversation[];
  onSent?: () => void | Promise<void>;
}) {
  const { t: typedT } = useAppTranslation();
  const t = typedT as unknown as (key: string, options?: Record<string, unknown>) => string;
  const enabledChannels = useMemo(
    () => channels.filter((channel) => channel.status === "enabled" && channel.ready !== false),
    [channels],
  );
  const [channelId, setChannelId] = useState("");
  const recipientOptions = useMemo(
    () => conversations.filter((conversation) => conversation.channelId === channelId),
    [channelId, conversations],
  );
  const [conversationId, setConversationId] = useState("");
  const [deliveries, setDeliveries] = useState<WorkItemReportDelivery[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<"preview" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const previewKey = useRef(operationKey("report-delivery-preview"));
  const sendKeys = useRef<Record<string, string>>({});
  const selected = useMemo(
    () => deliveries.find((delivery) => delivery.id === selectedId) ?? null,
    [deliveries, selectedId],
  );

  const refresh = useCallback(async (preferredId?: string | null) => {
    setLoading(true);
    try {
      const result = await workItemReportApi.listDeliveries(itemId, draft.id);
      setDeliveries(result.reportDeliveries);
      setSelectedId((current) => {
        const requested = preferredId ?? current;
        return requested && result.reportDeliveries.some((delivery) => delivery.id === requested)
          ? requested
          : result.reportDeliveries[0]?.id ?? null;
      });
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("taskReport.deliveryLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [draft.id, itemId, t]);

  useEffect(() => {
    const initialChannel = enabledChannels[0]?.id ?? "";
    setChannelId(initialChannel);
    setConversationId(conversations.find((conversation) => conversation.channelId === initialChannel)?.id ?? "");
    setDeliveries([]);
    setSelectedId(null);
    setError(null);
    setNotice(null);
    previewKey.current = operationKey("report-delivery-preview");
    void refresh(null);
  }, [draft.id, enabledChannels, conversations, refresh]);

  useEffect(() => {
    if (recipientOptions.some((conversation) => conversation.id === conversationId)) return;
    setConversationId(recipientOptions[0]?.id ?? "");
  }, [conversationId, recipientOptions]);

  useVisibleInterval(() => {
    if (selected?.status === "queued") void refresh(selected.id);
  }, 3_000);

  const preview = async () => {
    if (pending || !channelId || !conversationId) return;
    setPending("preview");
    setError(null);
    setNotice(null);
    try {
      const result = await workItemReportApi.previewDelivery(itemId, draft.id, {
        channelId,
        conversationId,
        idempotencyKey: previewKey.current,
      });
      previewKey.current = operationKey("report-delivery-preview");
      await refresh(result.reportDelivery.id);
      setNotice(t("taskReport.deliveryPreviewReady"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("taskReport.deliveryActionFailed"));
    } finally {
      setPending(null);
    }
  };

  const send = async () => {
    if (!selected?.canSend || pending) return;
    setPending("send");
    setError(null);
    try {
      const key = sendKeys.current[selected.id] ??= operationKey("report-delivery-send");
      const grant = await api.issueApprovalGrant(WORK_ITEM_REPORT_DELIVERY_ACTION, selected.id);
      const result = await workItemReportApi.sendDelivery(itemId, draft.id, selected.id, {
        expectedRevision: selected.revision,
        idempotencyKey: key,
        approvalToken: grant.token,
      });
      delete sendKeys.current[selected.id];
      setSendOpen(false);
      await refresh(result.reportDelivery.id);
      setNotice(t("taskReport.deliveryQueued"));
      await onSent?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("taskReport.deliveryActionFailed"));
    } finally {
      setPending(null);
    }
  };

  if (draft.status !== "confirmed") return null;

  return (
    <section className="space-y-3 rounded-md border border-border p-3" aria-labelledby={`report-delivery-title-${draft.id}`}>
      <div className="flex gap-2">
        <Send className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div>
          <h4 id={`report-delivery-title-${draft.id}`} className="text-sm font-semibold">{t("taskReport.deliveryTitle")}</h4>
          <p className="mt-1 text-xs text-muted-foreground">{t("taskReport.deliveryDescription")}</p>
        </div>
      </div>

      {enabledChannels.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("taskReport.deliveryChannel")}>
            <Select value={channelId} disabled={Boolean(pending)} onChange={(event) => {
              setChannelId(event.target.value);
              previewKey.current = operationKey("report-delivery-preview");
            }}>
              {enabledChannels.map((channel) => (
                <option key={channel.id} value={channel.id}>{channel.name} · {channel.provider}</option>
              ))}
            </Select>
          </Field>
          <Field label={t("taskReport.deliveryRecipient")}>
            <Select value={conversationId} disabled={Boolean(pending) || !recipientOptions.length} onChange={(event) => {
              setConversationId(event.target.value);
              previewKey.current = operationKey("report-delivery-preview");
            }}>
              {!recipientOptions.length ? <option value="">{t("taskReport.deliveryNoRecipients")}</option> : null}
              {recipientOptions.map((conversation) => (
                <option key={conversation.id} value={conversation.id}>{conversation.externalUserId}</option>
              ))}
            </Select>
          </Field>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t("taskReport.deliveryNoChannels")}</p>
      )}

      <div className="flex justify-end">
        <Button variant="secondary" size="sm" disabled={Boolean(pending) || !channelId || !conversationId} onClick={() => void preview()}>
          {pending === "preview" ? t("taskReport.deliveryPreviewing") : t("taskReport.deliveryPreview")}
        </Button>
      </div>

      {loading && !deliveries.length ? <p className="text-xs text-muted-foreground" role="status">{t("taskReport.deliveryLoading")}</p> : null}
      {selected ? (
        <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3" data-testid="report-delivery-preview">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="text-xs">
              <p className="font-medium">{selected.target.channelName} · {selected.target.provider}</p>
              <p className="mt-1 text-muted-foreground">{t("taskReport.deliveryRecipientValue", { recipient: selected.target.recipientId })}</p>
            </div>
            <Badge tone={deliveryTone(selected.status)}>{t(`taskReport.deliveryStatus.${selected.status}`)}</Badge>
          </div>
          <div className="max-h-52 overflow-y-auto whitespace-pre-wrap rounded border border-border bg-background p-3 text-xs">
            {selected.content}
          </div>
          <div className="flex gap-2 rounded-md border border-warning/30 bg-warning/10 p-2 text-xs">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <p>{t("taskReport.deliveryBoundary")}</p>
          </div>
          {selected.receipt ? (
            <div className="space-y-1 rounded-md border border-border p-2 text-xs" data-testid="report-delivery-receipt">
              <p className="flex items-center gap-2 font-medium">
                {selected.status === "delivered" ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <ReceiptText className="size-4" aria-hidden />}
                {t("taskReport.deliveryReceipt")}
              </p>
              <p className="text-muted-foreground">
                {t("taskReport.deliveryReceiptChunks", {
                  delivered: selected.receipt.deliveredChunks,
                  total: selected.chunkCount,
                  attempts: selected.receipt.attempts,
                })}
              </p>
              {selected.receipt.providerReceiptIds.length ? (
                <p className="break-all text-muted-foreground">{t("taskReport.deliveryProviderReceipts", { ids: selected.receipt.providerReceiptIds.join(", ") })}</p>
              ) : null}
              {selected.receipt.lastErrorCodes.length ? (
                <p className="break-all text-destructive">{t("taskReport.deliveryErrors", { codes: selected.receipt.lastErrorCodes.join(", ") })}</p>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            {selected.receipt ? <Button variant="ghost" size="sm" disabled={Boolean(pending)} onClick={() => void refresh(selected.id)}>{t("taskReport.deliveryRefreshReceipt")}</Button> : null}
            {selected.canSend ? <Button size="sm" disabled={Boolean(pending)} onClick={() => setSendOpen(true)}>{t("taskReport.deliverySend")}</Button> : null}
          </div>
        </div>
      ) : null}

      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      {notice ? <p className="text-sm text-success" role="status">{notice}</p> : null}

      {selected ? (
        <ConfirmModal
          open={sendOpen}
          title={t("taskReport.deliveryConfirmTitle")}
          description={t("taskReport.deliveryConfirmDescription", {
            channel: selected.target.channelName,
            recipient: selected.target.recipientId,
          })}
          confirmLabel={t("taskReport.deliverySend")}
          pending={pending === "send"}
          error={sendOpen ? error : null}
          onClose={() => setSendOpen(false)}
          onConfirm={() => void send()}
        />
      ) : null}
    </section>
  );
}
