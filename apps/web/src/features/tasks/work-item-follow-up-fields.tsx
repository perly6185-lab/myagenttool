import { useId } from "react";
import { Field } from "@/components/common/field";
import { Input, Select } from "@/components/ui/input";
import { useAppTranslation } from "@/lib/i18n/use-app-translation";
import { installWorkItemFollowUpTranslations } from "@/lib/i18n/work-item-follow-up-resources";
import type {
  LocalWorkItem,
  WorkItemIntakeChannel,
  WorkItemRequesterRelation,
  WorkItemWaitingOn,
} from "./task-view-types";

installWorkItemFollowUpTranslations();

export type WorkItemFollowUpDraft = {
  requesterRelation: WorkItemRequesterRelation;
  requesterName: string;
  requesterOrganization: string;
  requesterUserId: string;
  intakeChannel: WorkItemIntakeChannel;
  externalReference: string;
  waitingOn: WorkItemWaitingOn;
  commitmentDate: string;
  nextFollowUpAt: string;
};

export type WorkItemFollowUpUser = {
  id: string;
  name?: string;
  role?: string;
};

export const DEFAULT_WORK_ITEM_FOLLOW_UP_DRAFT: WorkItemFollowUpDraft = {
  requesterRelation: "self",
  requesterName: "",
  requesterOrganization: "",
  requesterUserId: "",
  intakeChannel: "manual",
  externalReference: "",
  waitingOn: "me",
  commitmentDate: "",
  nextFollowUpAt: "",
};

export function followUpDraftFromWorkItem(item: LocalWorkItem): WorkItemFollowUpDraft {
  return {
    requesterRelation: item.requesterRelation ?? "unknown",
    requesterName: item.requesterName ?? "",
    requesterOrganization: item.requesterOrganization ?? "",
    requesterUserId: item.requesterUserId ?? "",
    intakeChannel: item.intakeChannel ?? "unknown",
    externalReference: item.externalReference ?? "",
    waitingOn: item.waitingOn ?? "none",
    commitmentDate: isoToLocalDateTimeInput(item.commitmentDate),
    nextFollowUpAt: isoToLocalDateTimeInput(item.nextFollowUpAt),
  };
}

export function followUpDraftEquals(left: WorkItemFollowUpDraft, right: WorkItemFollowUpDraft) {
  return (Object.keys(left) as (keyof WorkItemFollowUpDraft)[])
    .every((key) => left[key] === right[key]);
}

export function followUpPayload(draft: WorkItemFollowUpDraft) {
  const hidesIdentity = draft.requesterRelation === "self" || draft.requesterRelation === "unknown";
  const isCustomer = draft.requesterRelation === "customer";
  return {
    requesterRelation: draft.requesterRelation,
    requesterName: hidesIdentity ? null : draft.requesterName.trim() || null,
    requesterOrganization: hidesIdentity ? null : draft.requesterOrganization.trim() || null,
    requesterUserId: hidesIdentity || isCustomer ? null : draft.requesterUserId || null,
    intakeChannel: draft.intakeChannel,
    externalReference: draft.externalReference.trim() || null,
    waitingOn: draft.waitingOn,
    commitmentDate: localDateTimeInputToIso(draft.commitmentDate),
    nextFollowUpAt: localDateTimeInputToIso(draft.nextFollowUpAt),
  };
}

export type WorkItemFollowUpValidationError = "requesterRequired" | "requesterWaitInvalid" | "followUpPast";

export function validateFollowUpDraft(
  draft: WorkItemFollowUpDraft,
  now = Date.now(),
): WorkItemFollowUpValidationError | null {
  if (draft.requesterRelation === "customer" && !draft.requesterName.trim()) return "requesterRequired";
  if (["self", "unknown"].includes(draft.requesterRelation) && draft.waitingOn === "requester") {
    return "requesterWaitInvalid";
  }
  if (draft.nextFollowUpAt) {
    const next = new Date(draft.nextFollowUpAt).getTime();
    if (!Number.isFinite(next) || next <= now) return "followUpPast";
  }
  return null;
}

export function isoToLocalDateTimeInput(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function localDateTimeInputToIso(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function WorkItemFollowUpFields({
  value,
  onChange,
  users = [],
  assigneeIds = [],
  onAssigneeIdsChange,
  disabled = false,
}: {
  value: WorkItemFollowUpDraft;
  onChange: (value: WorkItemFollowUpDraft) => void;
  users?: WorkItemFollowUpUser[];
  assigneeIds?: string[];
  onAssigneeIdsChange?: (value: string[]) => void;
  disabled?: boolean;
}) {
  const { t: typedT } = useAppTranslation();
  const t = typedT as unknown as (key: string) => string;
  const headingId = useId();
  const validationError = validateFollowUpDraft(value);
  const showIdentity = !["self", "unknown"].includes(value.requesterRelation);
  const showInternalMember = ["boss", "manager", "colleague"].includes(value.requesterRelation);
  const set = <Key extends keyof WorkItemFollowUpDraft>(key: Key, next: WorkItemFollowUpDraft[Key]) => {
    onChange({ ...value, [key]: next });
  };
  const setRelation = (requesterRelation: WorkItemRequesterRelation) => {
    const next = { ...value, requesterRelation };
    if (requesterRelation === "self") {
      Object.assign(next, {
        requesterName: "", requesterOrganization: "", requesterUserId: "", waitingOn: "me" as const,
      });
    } else if (requesterRelation === "unknown") {
      Object.assign(next, {
        requesterName: "", requesterOrganization: "", requesterUserId: "", waitingOn: "none" as const,
      });
    } else if (requesterRelation === "customer") {
      next.requesterUserId = "";
    }
    onChange(next);
  };

  return (
    <section className="space-y-3 rounded-md border border-border bg-muted/20 p-3" aria-labelledby={headingId}>
      <div>
        <h3 id={headingId} className="text-sm font-semibold">{t("taskFollowUp.title")}</h3>
        <p className="text-xs text-muted-foreground">{t("taskFollowUp.description")}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("taskFollowUp.requesterRelation")}>
          <Select
            value={value.requesterRelation}
            disabled={disabled}
            onChange={(event) => setRelation(event.target.value as WorkItemRequesterRelation)}
          >
            {(["self", "boss", "manager", "customer", "colleague", "unknown"] as const).map((relation) => (
              <option key={relation} value={relation}>{t(`taskFollowUp.relation.${relation}`)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("taskFollowUp.intakeChannel")}>
          <Select
            value={value.intakeChannel}
            disabled={disabled}
            onChange={(event) => set("intakeChannel", event.target.value as WorkItemIntakeChannel)}
          >
            {(["manual", "meeting", "email", "chat", "phone", "github", "import", "other", "unknown"] as const).map((channel) => (
              <option key={channel} value={channel}>{t(`taskFollowUp.channel.${channel}`)}</option>
            ))}
          </Select>
        </Field>
        {showInternalMember ? (
          <Field label={t("taskFollowUp.internalRequester")}>
            <Select
              value={value.requesterUserId}
              disabled={disabled}
              onChange={(event) => {
                const requesterUserId = event.target.value;
                const user = users.find((candidate) => candidate.id === requesterUserId);
                onChange({
                  ...value,
                  requesterUserId,
                  requesterName: user?.name ?? value.requesterName,
                });
              }}
            >
              <option value="">{t("taskFollowUp.noInternalRequester")}</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name ?? user.id}{user.role ? ` · ${user.role}` : ""}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {showIdentity ? (
          <Field label={t("taskFollowUp.requesterName")}>
            <Input
              value={value.requesterName}
              disabled={disabled}
              aria-invalid={validationError === "requesterRequired"}
              onChange={(event) => set("requesterName", event.target.value)}
            />
          </Field>
        ) : null}
        {showIdentity ? (
          <Field label={t("taskFollowUp.requesterOrganization")}>
            <Input value={value.requesterOrganization} disabled={disabled} onChange={(event) => set("requesterOrganization", event.target.value)} />
          </Field>
        ) : null}
        <Field label={t("taskFollowUp.waitingOn")}>
          <Select value={value.waitingOn} disabled={disabled} onChange={(event) => set("waitingOn", event.target.value as WorkItemWaitingOn)}>
            {(["me", "requester", "internal", "ai", "none"] as const)
              .filter((waitingOn) => waitingOn !== "requester" || !["self", "unknown"].includes(value.requesterRelation))
              .map((waitingOn) => <option key={waitingOn} value={waitingOn}>{t(`taskFollowUp.waiting.${waitingOn}`)}</option>)}
          </Select>
        </Field>
        {onAssigneeIdsChange ? (
          <Field label={t("taskFollowUp.assignee")}>
            <div className="min-h-9 space-y-1 rounded-md border border-border bg-input/40 px-3 py-2">
              {users.length ? users.map((user) => (
                <label key={user.id} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={assigneeIds.includes(user.id)}
                    disabled={disabled}
                    onChange={(event) => onAssigneeIdsChange(event.target.checked
                      ? [...assigneeIds, user.id]
                      : assigneeIds.filter((id) => id !== user.id))}
                  />
                  <span>{user.name ?? user.id}{user.role ? ` · ${user.role}` : ""}</span>
                </label>
              )) : <span className="text-xs text-muted-foreground">{t("taskFollowUp.noMembers")}</span>}
            </div>
          </Field>
        ) : null}
        <Field label={t("taskFollowUp.commitmentDate")}>
          <Input type="datetime-local" value={value.commitmentDate} disabled={disabled} onChange={(event) => set("commitmentDate", event.target.value)} />
        </Field>
        <Field label={t("taskFollowUp.nextFollowUpAt")}>
          <Input
            type="datetime-local"
            value={value.nextFollowUpAt}
            disabled={disabled}
            aria-invalid={validationError === "followUpPast"}
            onChange={(event) => set("nextFollowUpAt", event.target.value)}
          />
        </Field>
        <Field label={t("taskFollowUp.externalReference")} className="sm:col-span-2">
          <Input value={value.externalReference} disabled={disabled} onChange={(event) => set("externalReference", event.target.value)} />
        </Field>
      </div>
      {validationError ? <p className="text-xs text-destructive" role="alert">{t(`taskFollowUp.validation.${validationError}`)}</p> : null}
      <p className="text-xs text-muted-foreground">{t("taskFollowUp.assigneeHint")}</p>
    </section>
  );
}

export function WorkItemFollowUpSummary({
  item,
  users = [],
}: {
  item: LocalWorkItem;
  users?: WorkItemFollowUpUser[];
}) {
  const { t: typedT, i18n } = useAppTranslation();
  const t = typedT as unknown as (key: string) => string;
  const requester = item.requesterRelation === "self"
    ? t("taskFollowUp.relation.self")
    : item.requesterName
      ?? users.find((user) => user.id === item.requesterUserId)?.name
      ?? t("taskFollowUp.unlabeledRequester");
  const assignees = item.assigneeIds
    .map((id) => users.find((user) => user.id === id)?.name ?? id)
    .join(", ") || t("taskFollowUp.unassigned");
  const locale = i18n.language.startsWith("zh") ? "zh-CN" : "en-US";
  const date = (value: string | null | undefined) => value ? new Date(value).toLocaleString(locale) : "—";

  return (
    <section className="mt-3 rounded-md border border-border bg-background p-3">
      <div className="mb-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t("taskFollowUp.deliveryContext")}</p>
        <h3 className="text-sm font-semibold">
          {t(`taskFollowUp.relation.${item.requesterRelation ?? "unknown"}`)} · {requester}
        </h3>
        {item.requesterRelation === "unknown" ? <p className="text-xs text-amber-700 dark:text-amber-300">{t("taskFollowUp.unlabeledHint")}</p> : null}
      </div>
      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
        <SummaryFact label={t("taskFollowUp.requesterOrganization")} value={item.requesterOrganization || "—"} />
        <SummaryFact label={t("taskFollowUp.intakeChannel")} value={t(`taskFollowUp.channel.${item.intakeChannel ?? "unknown"}`)} />
        <SummaryFact label={t("taskFollowUp.assignee")} value={assignees} />
        <SummaryFact label={t("taskFollowUp.waitingOn")} value={t(`taskFollowUp.waiting.${item.waitingOn ?? "none"}`)} />
        <SummaryFact label={t("taskFollowUp.commitmentDate")} value={date(item.commitmentDate)} />
        <SummaryFact label={t("taskFollowUp.nextFollowUpAt")} value={date(item.nextFollowUpAt)} />
      </dl>
      <div className="mt-3 rounded bg-muted p-2 text-xs">
        <strong>{t("taskFollowUp.lastProgress")}{item.lastProgressAt ? ` · ${date(item.lastProgressAt)}` : ""}</strong>
        <p className="mt-1 text-muted-foreground">{item.lastProgressSummary || t("taskFollowUp.noProgress")}</p>
      </div>
    </section>
  );
}

function SummaryFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-muted p-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}
