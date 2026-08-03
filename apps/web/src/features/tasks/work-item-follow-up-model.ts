import type {
  LocalWorkItem,
  WorkItemIntakeChannel,
  WorkItemRequesterRelation,
  WorkItemWaitingOn,
} from "./task-view-types";

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
