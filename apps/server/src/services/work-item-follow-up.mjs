export const WORK_ITEM_FOLLOW_UP_SCHEMA_VERSION = 1;

export const WORK_ITEM_REQUESTER_RELATIONS = new Set([
  "boss",
  "manager",
  "customer",
  "colleague",
  "self",
  "unknown",
]);

export const WORK_ITEM_INTAKE_CHANNELS = new Set([
  "manual",
  "meeting",
  "email",
  "chat",
  "phone",
  "github",
  "import",
  "other",
  "unknown",
]);

export const WORK_ITEM_WAITING_ON = new Set([
  "me",
  "requester",
  "internal",
  "ai",
  "none",
]);

export const WORK_ITEM_FOLLOW_UP_FIELDS = [
  "followUpSchemaVersion",
  "requesterRelation",
  "requesterName",
  "requesterOrganization",
  "requesterUserId",
  "intakeChannel",
  "externalReference",
  "waitingOn",
  "commitmentDate",
  "nextFollowUpAt",
  "lastProgressAt",
  "lastProgressSummary",
];

export const WORK_ITEM_FOLLOW_UP_SERVER_FIELDS = [
  "followUpSchemaVersion",
  "lastProgressAt",
  "lastProgressSummary",
];

export const WORK_ITEM_FOLLOW_UP_MUTABLE_FIELDS = WORK_ITEM_FOLLOW_UP_FIELDS
  .filter((field) => !WORK_ITEM_FOLLOW_UP_SERVER_FIELDS.includes(field));

const DEFAULT_CONTEXT = Object.freeze({
  followUpSchemaVersion: WORK_ITEM_FOLLOW_UP_SCHEMA_VERSION,
  requesterRelation: "unknown",
  requesterName: null,
  requesterOrganization: null,
  requesterUserId: null,
  intakeChannel: "unknown",
  externalReference: null,
  waitingOn: "none",
  commitmentDate: null,
  nextFollowUpAt: null,
  lastProgressAt: null,
  lastProgressSummary: null,
});

export function defaultWorkItemFollowUpContext() {
  return { ...DEFAULT_CONTEXT };
}

export function workItemFollowUpContextView(item = {}) {
  return Object.fromEntries(WORK_ITEM_FOLLOW_UP_FIELDS.map((field) => [
    field,
    Object.hasOwn(item, field) && item[field] !== undefined ? item[field] : DEFAULT_CONTEXT[field],
  ]));
}

export function backfillWorkItemFollowUpContext(state) {
  let changed = 0;
  for (const item of state.workItems ?? []) {
    if (!item || typeof item !== "object") continue;
    let itemChanged = false;
    for (const field of WORK_ITEM_FOLLOW_UP_FIELDS) {
      if (Object.hasOwn(item, field) && item[field] !== undefined) continue;
      item[field] = DEFAULT_CONTEXT[field];
      itemChanged = true;
    }
    if (itemChanged) changed += 1;
  }
  return changed;
}

export function normalizeWorkItemFollowUpInput(input = {}, { partial = false } = {}) {
  const value = {};
  for (const [field, allowed, fallback] of [
    ["requesterRelation", WORK_ITEM_REQUESTER_RELATIONS, "unknown"],
    ["intakeChannel", WORK_ITEM_INTAKE_CHANNELS, "unknown"],
    ["waitingOn", WORK_ITEM_WAITING_ON, "none"],
  ]) {
    if (partial && !Object.hasOwn(input, field)) continue;
    const candidate = String(input[field] ?? fallback);
    if (!allowed.has(candidate)) {
      return { error: `invalid_work_item_${snakeCase(field)}` };
    }
    value[field] = candidate;
  }

  for (const [field, maxLength] of [
    ["requesterName", 200],
    ["requesterOrganization", 300],
    ["requesterUserId", 200],
    ["externalReference", 1_000],
  ]) {
    if (partial && !Object.hasOwn(input, field)) continue;
    const normalized = nullableText(input[field], maxLength);
    if (!normalized.ok) return { error: `invalid_work_item_${snakeCase(field)}` };
    value[field] = normalized.value;
  }

  for (const field of ["commitmentDate", "nextFollowUpAt"]) {
    if (partial && !Object.hasOwn(input, field)) continue;
    const normalized = nullableIsoDateTime(input[field]);
    if (!normalized.ok) return { error: `invalid_work_item_${snakeCase(field)}` };
    value[field] = normalized.value;
  }

  if (!partial) value.followUpSchemaVersion = WORK_ITEM_FOLLOW_UP_SCHEMA_VERSION;
  return { value };
}

function nullableText(input, maxLength) {
  if (input == null || input === "") return { ok: true, value: null };
  if (typeof input !== "string") return { ok: false };
  const value = input.trim();
  if (!value) return { ok: true, value: null };
  if (value.length > maxLength || /[\r\n\t]/.test(value)) return { ok: false };
  return { ok: true, value };
}

function nullableIsoDateTime(input) {
  if (input == null || input === "") return { ok: true, value: null };
  if (typeof input !== "string" || input.length > 50) return { ok: false };
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(input);
  if (!match) return { ok: false };
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = "0", , , , offsetHourText = "0", offsetMinuteText = "0"] = match;
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] = [
    yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText,
  ].map(Number);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(0, 0, 0, 0);
  if (year < 1 || calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1
    || calendar.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59
    || offsetHour > 23 || offsetMinute > 59) {
    return { ok: false };
  }
  const timestamp = Date.parse(input);
  if (!Number.isFinite(timestamp)) return { ok: false };
  return { ok: true, value: new Date(timestamp).toISOString() };
}

function snakeCase(value) {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
