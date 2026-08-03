import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORK_ITEM_FOLLOW_UP_DRAFT,
  followUpPayload,
  isoToLocalDateTimeInput,
  localDateTimeInputToIso,
  validateFollowUpDraft,
} from "./work-item-follow-up-fields";

describe("work item follow-up fields", () => {
  it("uses visible self/manual/me defaults for newly created work", () => {
    expect(followUpPayload(DEFAULT_WORK_ITEM_FOLLOW_UP_DRAFT)).toEqual(expect.objectContaining({
      requesterRelation: "self",
      requesterName: null,
      requesterUserId: null,
      intakeChannel: "manual",
      waitingOn: "me",
    }));
  });

  it("requires a customer name", () => {
    expect(validateFollowUpDraft({
      ...DEFAULT_WORK_ITEM_FOLLOW_UP_DRAFT,
      requesterRelation: "customer",
    })).toBe("requesterRequired");
  });

  it("rejects a past next follow-up time", () => {
    expect(validateFollowUpDraft({
      ...DEFAULT_WORK_ITEM_FOLLOW_UP_DRAFT,
      nextFollowUpAt: "2026-08-02T10:00",
    }, new Date("2026-08-03T00:00:00Z").getTime())).toBe("followUpPast");
  });

  it("round-trips ISO timestamps through datetime-local form values", () => {
    const original = "2099-08-05T02:30:00.000Z";
    expect(localDateTimeInputToIso(isoToLocalDateTimeInput(original))).toBe(original);
  });
});
