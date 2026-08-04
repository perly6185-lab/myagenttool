export const WORK_ITEM_FOLLOW_UP_REMINDER_SCHEMA_VERSION = 1;

const SYSTEM_USER_ID = "usr_follow_up_reminder";

function scheduleRevision(item) {
  if (Number.isInteger(item.followUpScheduleRevision) && item.followUpScheduleRevision >= 0) {
    return item.followUpScheduleRevision;
  }
  return item.nextFollowUpAt ? 1 : 0;
}

function reminderKey(itemId, revision) {
  return `${itemId}:${revision}`;
}

function isDue(value, timestamp) {
  const dueAt = Date.parse(value ?? "");
  return Number.isFinite(dueAt) && dueAt <= Date.parse(timestamp);
}

function isComplete(item) {
  return item.state === "closed" || item.status === "done" || Boolean(item.archivedAt);
}

export function backfillWorkItemFollowUpReminderState(state) {
  let changed = 0;
  if (!Array.isArray(state.workItemFollowUpReminders)) {
    state.workItemFollowUpReminders = [];
    changed += 1;
  }
  for (const item of state.workItems ?? []) {
    if (Number.isInteger(item.followUpScheduleRevision) && item.followUpScheduleRevision >= 0) continue;
    item.followUpScheduleRevision = item.nextFollowUpAt ? 1 : 0;
    changed += 1;
  }
  return changed;
}

export function createWorkItemFollowUpReminderService({
  state,
  now,
  nextId,
  runTx,
  recordActivity,
  appendEvent,
  actorTeam,
  actorUser,
}) {
  const rows = () => (state.workItemFollowUpReminders ??= []);
  const systemActor = (item) => ({ userId: SYSTEM_USER_ID, teamId: item.ownerTeamId, role: "system" });

  function createRow(item, { status = "due", timestamp = now() } = {}) {
    const revision = scheduleRevision(item);
    return {
      id: nextId("wfr"),
      schemaVersion: WORK_ITEM_FOLLOW_UP_REMINDER_SCHEMA_VERSION,
      dedupeKey: reminderKey(item.id, revision),
      workItemId: item.id,
      ownerTeamId: item.ownerTeamId,
      projectId: item.projectId ?? null,
      scheduleRevision: revision,
      sourceRevision: item.revision,
      scheduledFor: item.nextFollowUpAt,
      status,
      createdAt: timestamp,
      createdBy: status === "due" ? SYSTEM_USER_ID : null,
      resolvedAt: null,
      resolvedBy: null,
      resolution: null,
    };
  }

  function recordDue(row, item, actor) {
    recordActivity(item, actor, "follow_up_reminder_due", {
      reminderId: row.id,
      scheduleRevision: row.scheduleRevision,
      sourceRevision: row.sourceRevision,
      scheduledFor: row.scheduledFor,
    });
    appendEvent({
      invocationId: null,
      type: "work_item_follow_up_reminder_due",
      level: "info",
      message: `${item.localRef} follow-up reminder is due.`,
      data: {
        reminderId: row.id,
        workItemId: item.id,
        scheduleRevision: row.scheduleRevision,
        sourceRevision: row.sourceRevision,
        actorTeamId: item.ownerTeamId,
      },
    });
  }

  function resolveRow(row, item, actor, reason, timestamp = now()) {
    if (row.status !== "due") return false;
    row.status = "resolved";
    row.resolvedAt = timestamp;
    row.resolvedBy = actorUser(actor);
    row.resolution = reason;
    recordActivity(item, actor, "follow_up_reminder_resolved", {
      reminderId: row.id,
      scheduleRevision: row.scheduleRevision,
      scheduledFor: row.scheduledFor,
      resolution: reason,
    });
    appendEvent({
      invocationId: null,
      type: "work_item_follow_up_reminder_resolved",
      level: "info",
      message: `${item.localRef} follow-up reminder resolved by ${reason}.`,
      data: {
        reminderId: row.id,
        workItemId: item.id,
        scheduleRevision: row.scheduleRevision,
        resolution: reason,
        actorTeamId: item.ownerTeamId,
      },
    });
    return true;
  }

  function currentRow(item, revision = scheduleRevision(item)) {
    const key = reminderKey(item.id, revision);
    return rows().find((row) => row.ownerTeamId === item.ownerTeamId && row.dedupeKey === key) ?? null;
  }

  function resolveCurrentDue(item, actor, reason) {
    if (!item.nextFollowUpAt || !isDue(item.nextFollowUpAt, now())) return false;
    let row = currentRow(item);
    if (!row) {
      row = createRow(item, { status: "resolved" });
      rows().unshift(row);
      row.status = "due";
    }
    return resolveRow(row, item, actor, reason);
  }

  function scheduleChanged(item, actor, { reason = "rescheduled" } = {}) {
    resolveCurrentDue(item, actor, reason);
    item.followUpScheduleRevision = scheduleRevision(item) + 1;
  }

  function resolveAllDue(item, actor, reason) {
    let resolved = 0;
    for (const row of rows().filter((candidate) =>
      candidate.workItemId === item.id
      && candidate.ownerTeamId === item.ownerTeamId
      && candidate.status === "due")) {
      if (resolveRow(row, item, actor, reason)) resolved += 1;
    }
    return resolved;
  }

  function sweep() {
    const timestamp = now();
    const items = state.workItems ?? [];
    const itemsById = new Map(items.map((item) => [item.id, item]));
    const resolutions = [];
    for (const row of rows().filter((candidate) => candidate.status === "due")) {
      const item = itemsById.get(row.workItemId);
      if (!item || item.ownerTeamId !== row.ownerTeamId) continue;
      if (isComplete(item)) resolutions.push({ row, item, reason: item.archivedAt ? "archived" : "completed" });
      else if (row.scheduleRevision !== scheduleRevision(item) || row.scheduledFor !== item.nextFollowUpAt) {
        resolutions.push({ row, item, reason: "rescheduled" });
      }
    }

    const creations = [];
    for (const item of items) {
      if (isComplete(item) || !item.nextFollowUpAt || !isDue(item.nextFollowUpAt, timestamp)) continue;
      if (!currentRow(item)) creations.push({ item, row: createRow(item, { timestamp }) });
    }
    if (!resolutions.length && !creations.length) return { created: 0, resolved: 0 };

    let resolved = 0;
    runTx(() => {
      for (const { row, item, reason } of resolutions) {
        if (resolveRow(row, item, systemActor(item), reason, timestamp)) resolved += 1;
      }
      for (const { item, row } of creations) {
        rows().unshift(row);
        recordDue(row, item, systemActor(item));
      }
    });
    return { created: creations.length, resolved };
  }

  function list(actor, { status = null } = {}) {
    const teamId = actorTeam(actor);
    return rows()
      .filter((row) => row.ownerTeamId === teamId && (!status || row.status === status))
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  }

  return {
    list,
    resolveAllDue,
    resolveCurrentDue,
    scheduleChanged,
    sweep,
  };
}
