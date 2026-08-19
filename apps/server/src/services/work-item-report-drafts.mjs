import { createHash } from "node:crypto";
import { WORK_ITEM_REQUESTER_RELATIONS } from "./work-item-follow-up.mjs";
import { chunkContent } from "./report-schedule.mjs";
import { LOCAL_TEAM_ID } from "../runtime/auth.mjs";

const REPORT_TONES = new Set(["concise", "formal", "warm"]);
const REPORT_LOCALES = new Set(["en-US", "zh-CN"]);
const MAX_CONTENT = 20_000;
const REPORT_DRAFT_SCHEMA_VERSION = 1;
const REPORT_DELIVERY_SCHEMA_VERSION = 1;
export const WORK_ITEM_REPORT_DELIVERY_ACTION = "work_item.report.deliver";

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function nullableText(input, maxLength) {
  if (input == null || input === "") return { ok: true, value: null };
  if (typeof input !== "string") return { ok: false };
  const value = input.trim();
  if (!value) return { ok: true, value: null };
  if (value.length > maxLength || /[\r\n\t]/.test(value)) return { ok: false };
  return { ok: true, value };
}

function normalizeAudience(input, item) {
  const source = input == null ? {} : input;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return { error: "invalid_work_item_report_audience" };
  }
  const relation = String(source.relation ?? item.requesterRelation ?? "unknown");
  if (!WORK_ITEM_REQUESTER_RELATIONS.has(relation)) {
    return { error: "invalid_work_item_report_audience_relation" };
  }
  const name = nullableText(
    Object.hasOwn(source, "name") ? source.name : item.requesterName,
    200,
  );
  const organization = nullableText(
    Object.hasOwn(source, "organization") ? source.organization : item.requesterOrganization,
    300,
  );
  const userId = nullableText(
    Object.hasOwn(source, "userId") ? source.userId : item.requesterUserId,
    200,
  );
  if (!name.ok || !organization.ok || !userId.ok) {
    return { error: "invalid_work_item_report_audience" };
  }
  return {
    value: {
      relation,
      name: relation === "self" ? null : name.value,
      organization: relation === "self" ? null : organization.value,
      userId: relation === "self" ? null : userId.value,
    },
  };
}

function progressSources(state, item) {
  return (state.workItemActivities ?? [])
    .filter((activity) => activity.workItemId === item.id
      && activity.ownerTeamId === item.ownerTeamId
      && activity.action === "progress_recorded")
    .slice(0, 5)
    .map((activity) => ({
      activityId: activity.id,
      summary: String(activity.details?.summary ?? "").trim().slice(0, 2_000),
      createdAt: activity.createdAt,
    }))
    .filter((entry) => entry.summary);
}

function executionSourceProjectId(source) {
  return source?.projectId
    ?? source?.options?.metadata?.projectId
    ?? source?.input?.metadata?.projectId
    ?? null;
}

function executionSourceBelongsToItem(state, source, item) {
  const projectId = executionSourceProjectId(source);
  if (!projectId || projectId !== item.projectId) return false;
  const project = (state.projects ?? []).find((candidate) => candidate.id === projectId);
  if (!project || project.ownerTeamId !== item.ownerTeamId) return false;
  const stampedTeamIds = [
    source?.ownerTeamId,
    source?.teamId,
    source?.options?.metadata?.teamId,
  ].filter((teamId) => teamId != null);
  return stampedTeamIds.every((teamId) => teamId === item.ownerTeamId);
}

function executionSources(state, item) {
  const rows = [];
  for (const binding of [...(item.executionBindings ?? [])].reverse()) {
    if (rows.length >= 3) break;
    const autoRunBinding = binding.kind === "auto_run";
    const invocationBinding = binding.kind === "application_invocation";
    if (!autoRunBinding && !invocationBinding) continue;
    const id = String(autoRunBinding ? binding.targetId ?? binding.id ?? "" : binding.id ?? binding.targetId ?? "");
    if (!id) continue;
    const source = autoRunBinding
      ? (state.autoRuns ?? []).find((candidate) => candidate.id === id)
      : (state.invocations ?? []).find((candidate) => candidate.id === id);
    if (!source || !executionSourceBelongsToItem(state, source, item)) continue;
    const summary = String(
      source?.resultSummary
      ?? source?.reportSummary
      ?? source?.result?.summary
      ?? source?.summary
      ?? "",
    ).trim().slice(0, 2_000);
    if (!summary) continue;
    rows.push({
      kind: autoRunBinding ? "auto_run" : "invocation",
      id,
      status: String(source.status ?? "unknown").slice(0, 100),
      summary,
      updatedAt: source.updatedAt ?? source.completedAt ?? null,
    });
  }
  return rows;
}

function waitingLabel(waitingOn, locale) {
  const labels = locale === "zh-CN"
    ? {
        me: "我方下一步行动",
        requester: "提出者回复",
        internal: "内部协作者",
        ai: "AI 执行",
        none: "无外部依赖",
      }
    : {
        me: "our next action",
        requester: "the requester",
        internal: "an internal collaborator",
        ai: "AI execution",
        none: "no external dependency",
      };
  return labels[waitingOn] ?? labels.none;
}

function audienceLabel(audience, locale) {
  return audience.name
    ?? (locale === "zh-CN"
      ? ({ boss: "负责人", manager: "上级", customer: "客户", child: "小孩学习", colleague: "同事", self: "个人" }[audience.relation])
      : ({ boss: "Boss", manager: "Manager", customer: "Customer", child: "Child learning", colleague: "Colleague", self: "Personal" }[audience.relation]))
    ?? (locale === "zh-CN" ? "关系人" : "Stakeholder");
}

function generateContent({ item, audience, tone, progress, executions, locale }) {
  if (locale === "zh-CN") {
    const latest = progress[0]?.summary
      ?? executions[0]?.summary
      ?? item.lastProgressSummary
      ?? "工作已准备进入下一次复核节点。";
    const lines = [
      `${audienceLabel(audience, locale)}进展更新 — ${item.title}`,
      "",
      `当前进展：${latest}`,
      `当前等待：${waitingLabel(item.waitingOn, locale)}。`,
    ];
    if (item.commitmentDate) lines.push(`承诺时间：${item.commitmentDate}。`);
    if (item.nextFollowUpAt) lines.push(`下次跟进：${item.nextFollowUpAt}。`);
    if (progress.length > 1) {
      lines.push("", "近期检查点：", ...progress.slice(1, 4).map((entry) => `- ${entry.summary}`));
    }
    if (tone === "formal") lines.push("", "如需调整优先级或范围，请审阅并告知。");
    if (tone === "warm") lines.push("", "谢谢，我会在下一个检查点继续同步进展。");
    return lines.join("\n").trim().slice(0, MAX_CONTENT);
  }
  const latest = progress[0]?.summary
    ?? executions[0]?.summary
    ?? item.lastProgressSummary
    ?? "Work is prepared for the next review checkpoint.";
  const lines = [
    `${audienceLabel(audience, locale)} update — ${item.title}`,
    "",
    `Current progress: ${latest}`,
    `Waiting on: ${waitingLabel(item.waitingOn, locale)}.`,
  ];
  if (item.commitmentDate) lines.push(`Commitment: ${item.commitmentDate}.`);
  if (item.nextFollowUpAt) lines.push(`Next follow-up: ${item.nextFollowUpAt}.`);
  if (progress.length > 1) {
    lines.push("", "Recent checkpoints:", ...progress.slice(1, 4).map((entry) => `- ${entry.summary}`));
  }
  if (tone === "formal") lines.push("", "Please review and advise if priorities or scope should change.");
  if (tone === "warm") lines.push("", "Thank you — I’ll keep you posted at the next checkpoint.");
  return lines.join("\n").slice(0, MAX_CONTENT);
}

function commandKey(value) {
  const key = typeof value === "string" ? value.trim() : "";
  return key && key.length <= 200 ? key : null;
}

export function createWorkItemReportDraftService({
  state,
  now,
  nextId,
  runTx,
  findOwn,
  recordActivity,
  appendEvent,
  actorTeam,
  actorUser,
  enqueueChannelDeliveryBatch = null,
  validateApprovalToken = null,
}) {
  const notFound = () => ({ ok: false, status: 404, body: { error: "work_item_report_draft_not_found" } });
  const rows = () => (state.workItemReportDrafts ??= []);
  const deliveryRows = () => (state.workItemReportDeliveries ??= []);

  function findDraft(workItemId, draftId, actor) {
    return rows().find((row) => row.id === String(draftId)
      && row.workItemId === String(workItemId)
      && row.ownerTeamId === actorTeam(actor)) ?? null;
  }

  function isStale(row, item) {
    return row.source.workItemRevision !== item.revision;
  }

  function findDelivery(workItemId, draftId, deliveryId, actor) {
    return deliveryRows().find((row) => row.id === String(deliveryId)
      && row.workItemId === String(workItemId)
      && row.reportDraftId === String(draftId)
      && row.ownerTeamId === actorTeam(actor)) ?? null;
  }

  function targetFor(channelId, conversationId, actor) {
    const teamId = actorTeam(actor);
    const channel = (state.channels ?? []).find((row) => row.id === String(channelId)
      && (row.ownerTeamId ?? LOCAL_TEAM_ID) === teamId) ?? null;
    const conversation = channel ? (state.channelConversations ?? []).find((row) =>
      row.id === String(conversationId) && row.channelId === channel.id) ?? null : null;
    return channel && conversation ? { channel, conversation } : null;
  }

  function deliveryView(row) {
    const children = (state.channelDeliveries ?? []).filter((candidate) =>
      row.channelDeliveryIds.includes(candidate.id) && candidate.ownerTeamId === row.ownerTeamId);
    const submitted = row.status === "submitted";
    const failed = children.some((child) => child.status === "failed_terminal");
    const delivered = children.length === row.chunkCount && children.every((child) => child.status === "delivered");
    const status = !submitted ? "preview" : failed ? "failed" : delivered ? "delivered" : "queued";
    const { command: _command, sendCommand: _sendCommand, ...publicRow } = row;
    return {
      ...publicRow,
      status,
      canSend: status === "preview",
      receipt: submitted ? {
        status,
        channelDeliveryIds: [...row.channelDeliveryIds],
        deliveredChunks: children.filter((child) => child.status === "delivered").length,
        failedChunks: children.filter((child) => child.status === "failed_terminal").length,
        attempts: children.reduce((total, child) => total + Number(child.attempts ?? 0), 0),
        providerReceiptIds: children.map((child) => child.providerReceiptId).filter(Boolean),
        lastErrorCodes: [...new Set(children.map((child) => child.lastErrorCode).filter(Boolean))],
        updatedAt: children.map((child) => child.updatedAt).filter(Boolean).sort().at(-1) ?? row.sentAt,
      } : null,
    };
  }

  function view(row, item) {
    const { command: _command, confirmationCommand: _confirmationCommand, discardCommand: _discardCommand, ...publicRow } = row;
    const stale = isStale(row, item);
    return {
      ...publicRow,
      stale,
      canEdit: row.status === "draft" && !stale,
      canConfirm: row.status === "draft" && !stale,
    };
  }

  function list({ workItemId } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    const reportDrafts = rows()
      .filter((row) => row.workItemId === item.id && row.ownerTeamId === actorTeam(actor))
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .map((row) => view(row, item));
    return { ok: true, status: 200, body: { reportDrafts, count: reportDrafts.length } };
  }

  function get({ workItemId, draftId } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    const row = item ? findDraft(item.id, draftId, actor) : null;
    return row ? { ok: true, status: 200, body: { reportDraft: view(row, item) } } : notFound();
  }

  function generate(input = {}, actor = null) {
    const localeProvided = Object.hasOwn(input, "locale");
    const {
      workItemId,
      expectedWorkItemRevision,
      idempotencyKey,
      audience: audienceInput,
      tone = "concise",
      locale = "en-US",
    } = input;
    const allowedFields = new Set(["workItemId", "expectedWorkItemRevision", "idempotencyKey", "audience", "tone", "locale"]);
    if (Object.keys(input).some((field) => !allowedFields.has(field))) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_report_generate_fields" } };
    }
    const item = findOwn(workItemId, actor);
    if (!item) return notFound();
    const key = commandKey(idempotencyKey);
    if (!key) return { ok: false, status: 400, body: { error: "work_item_report_idempotency_key_required" } };
    if (!REPORT_TONES.has(tone)) return { ok: false, status: 400, body: { error: "invalid_work_item_report_tone" } };
    if (!REPORT_LOCALES.has(locale)) return { ok: false, status: 400, body: { error: "invalid_work_item_report_locale" } };
    const audience = normalizeAudience(audienceInput, item);
    if (audience.error) return { ok: false, status: 400, body: { error: audience.error } };
    const normalizedInput = {
      audience: audience.value,
      tone,
      ...(localeProvided ? { locale } : {}),
    };
    const inputDigest = digest(normalizedInput);
    const replay = rows().find((row) => row.workItemId === item.id
      && row.ownerTeamId === actorTeam(actor)
      && row.createdBy === actorUser(actor)
      && row.command?.idempotencyKey === key);
    if (replay) {
      if (replay.command.inputDigest !== inputDigest) {
        return { ok: false, status: 409, body: { error: "work_item_report_idempotency_conflict" } };
      }
      return { ok: true, status: 200, body: { reportDraft: view(replay, item), replayed: true } };
    }
    if (item.state === "closed" || item.status === "done" || item.archivedAt) {
      return { ok: false, status: 409, body: { error: "work_item_not_open_for_report" } };
    }
    if (!Number.isInteger(expectedWorkItemRevision)) {
      return { ok: false, status: 400, body: { error: "expected_work_item_revision_required" } };
    }
    if (expectedWorkItemRevision !== item.revision) {
      return { ok: false, status: 409, body: { error: "work_item_revision_conflict", currentRevision: item.revision } };
    }
    const progress = progressSources(state, item);
    const executions = executionSources(state, item);
    const timestamp = now();
    const source = {
      workItemRevision: item.revision,
      progressActivities: progress,
      executionResults: executions,
      capturedAt: timestamp,
      contextDigest: digest({
        title: item.title,
        waitingOn: item.waitingOn,
        commitmentDate: item.commitmentDate,
        nextFollowUpAt: item.nextFollowUpAt,
        progress,
        executions,
      }),
    };
    const row = {
      id: nextId("wrd"),
      schemaVersion: REPORT_DRAFT_SCHEMA_VERSION,
      workItemId: item.id,
      ownerTeamId: item.ownerTeamId,
      projectId: item.projectId,
      status: "draft",
      revision: 1,
      audience: audience.value,
      tone,
      content: generateContent({ item, audience: audience.value, tone, progress, executions, locale }),
      source,
      generation: {
        generator: "structured",
        policyVersion: "work-item-report-v1",
        modelVersion: null,
        locale,
        inputDigest,
      },
      command: { idempotencyKey: key, inputDigest },
      createdBy: actorUser(actor),
      updatedBy: actorUser(actor),
      createdAt: timestamp,
      updatedAt: timestamp,
      confirmedAt: null,
      confirmedBy: null,
      confirmedSnapshot: null,
    };
    runTx(() => {
      for (const prior of rows().filter((candidate) => candidate.workItemId === item.id && candidate.status === "draft")) {
        prior.status = "superseded";
        prior.revision += 1;
        prior.updatedAt = timestamp;
        prior.updatedBy = actorUser(actor);
        recordActivity(item, actor, "report_draft_superseded", { reportDraftId: prior.id, replacementId: row.id });
      }
      rows().unshift(row);
      recordActivity(item, actor, "report_draft_generated", {
        reportDraftId: row.id,
        reportDraftRevision: row.revision,
        sourceRevision: source.workItemRevision,
        contentDigest: digest(row.content),
      });
    });
    return { ok: true, status: 201, body: { reportDraft: view(row, item), replayed: false } };
  }

  function update(input = {}, actor = null) {
    const { workItemId, draftId, expectedRevision, content, audience: audienceInput, tone } = input;
    const allowedFields = new Set(["workItemId", "draftId", "expectedRevision", "content", "audience", "tone"]);
    if (Object.keys(input).some((field) => !allowedFields.has(field))) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_report_update_fields" } };
    }
    const item = findOwn(workItemId, actor);
    const row = item ? findDraft(item.id, draftId, actor) : null;
    if (!row) return notFound();
    if (row.status !== "draft") return { ok: false, status: 409, body: { error: "work_item_report_draft_not_editable", draftStatus: row.status } };
    if (isStale(row, item)) return { ok: false, status: 409, body: { error: "work_item_report_source_stale" } };
    if (!Number.isInteger(expectedRevision)) return { ok: false, status: 400, body: { error: "expected_report_draft_revision_required" } };
    if (expectedRevision !== row.revision) {
      return { ok: false, status: 409, body: { error: "work_item_report_draft_revision_conflict", currentRevision: row.revision } };
    }
    const next = {};
    if (Object.hasOwn(input, "content")) {
      const value = typeof content === "string" ? content.trim() : "";
      if (!value || value.length > MAX_CONTENT) return { ok: false, status: 400, body: { error: "invalid_work_item_report_content" } };
      next.content = value;
    }
    if (Object.hasOwn(input, "audience")) {
      const audience = normalizeAudience(audienceInput, item);
      if (audience.error) return { ok: false, status: 400, body: { error: audience.error } };
      next.audience = audience.value;
    }
    if (Object.hasOwn(input, "tone")) {
      if (!REPORT_TONES.has(tone)) return { ok: false, status: 400, body: { error: "invalid_work_item_report_tone" } };
      next.tone = tone;
    }
    if (!Object.keys(next).length) return { ok: false, status: 400, body: { error: "work_item_report_update_required" } };
    const timestamp = now();
    runTx(() => {
      Object.assign(row, next, { revision: row.revision + 1, updatedAt: timestamp, updatedBy: actorUser(actor) });
      recordActivity(item, actor, "report_draft_updated", {
        reportDraftId: row.id,
        reportDraftRevision: row.revision,
        changedFields: Object.keys(next),
        contentDigest: digest(row.content),
      });
    });
    return { ok: true, status: 200, body: { reportDraft: view(row, item) } };
  }

  function confirm(input = {}, actor = null) {
    const { workItemId, draftId, expectedRevision, idempotencyKey } = input;
    const allowedFields = new Set(["workItemId", "draftId", "expectedRevision", "idempotencyKey"]);
    if (Object.keys(input).some((field) => !allowedFields.has(field))) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_report_confirm_fields" } };
    }
    const item = findOwn(workItemId, actor);
    const row = item ? findDraft(item.id, draftId, actor) : null;
    if (!row) return notFound();
    const key = commandKey(idempotencyKey);
    if (!key) return { ok: false, status: 400, body: { error: "work_item_report_idempotency_key_required" } };
    if (row.confirmationCommand?.idempotencyKey === key) {
      return { ok: true, status: 200, body: { reportDraft: view(row, item), replayed: true } };
    }
    if (row.status !== "draft") return { ok: false, status: 409, body: { error: "work_item_report_draft_not_confirmable", draftStatus: row.status } };
    if (isStale(row, item)) return { ok: false, status: 409, body: { error: "work_item_report_source_stale" } };
    if (!Number.isInteger(expectedRevision)) return { ok: false, status: 400, body: { error: "expected_report_draft_revision_required" } };
    if (expectedRevision !== row.revision) {
      return { ok: false, status: 409, body: { error: "work_item_report_draft_revision_conflict", currentRevision: row.revision } };
    }
    const timestamp = now();
    runTx(() => {
      row.status = "confirmed";
      row.revision += 1;
      row.updatedAt = timestamp;
      row.updatedBy = actorUser(actor);
      row.confirmedAt = timestamp;
      row.confirmedBy = actorUser(actor);
      row.confirmationCommand = { idempotencyKey: key };
      row.confirmedSnapshot = {
        revision: row.revision,
        audience: structuredClone(row.audience),
        tone: row.tone,
        content: row.content,
        source: structuredClone(row.source),
        contentDigest: digest(row.content),
        confirmedAt: timestamp,
        confirmedBy: actorUser(actor),
      };
      recordActivity(item, actor, "report_draft_confirmed", {
        reportDraftId: row.id,
        reportDraftRevision: row.revision,
        sourceRevision: row.source.workItemRevision,
        contentDigest: row.confirmedSnapshot.contentDigest,
      });
    });
    return { ok: true, status: 200, body: { reportDraft: view(row, item), replayed: false } };
  }

  function discard(input = {}, actor = null) {
    const { workItemId, draftId, expectedRevision, idempotencyKey } = input;
    const allowedFields = new Set(["workItemId", "draftId", "expectedRevision", "idempotencyKey"]);
    if (Object.keys(input).some((field) => !allowedFields.has(field))) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_report_discard_fields" } };
    }
    const item = findOwn(workItemId, actor);
    const row = item ? findDraft(item.id, draftId, actor) : null;
    if (!row) return notFound();
    const key = commandKey(idempotencyKey);
    if (!key) return { ok: false, status: 400, body: { error: "work_item_report_idempotency_key_required" } };
    if (row.discardCommand?.idempotencyKey === key) {
      return { ok: true, status: 200, body: { reportDraft: view(row, item), replayed: true } };
    }
    if (row.status !== "draft") return { ok: false, status: 409, body: { error: "work_item_report_draft_not_discardable", draftStatus: row.status } };
    if (!Number.isInteger(expectedRevision)) return { ok: false, status: 400, body: { error: "expected_report_draft_revision_required" } };
    if (expectedRevision !== row.revision) {
      return { ok: false, status: 409, body: { error: "work_item_report_draft_revision_conflict", currentRevision: row.revision } };
    }
    const timestamp = now();
    runTx(() => {
      row.status = "discarded";
      row.revision += 1;
      row.updatedAt = timestamp;
      row.updatedBy = actorUser(actor);
      row.discardCommand = { idempotencyKey: key };
      recordActivity(item, actor, "report_draft_discarded", {
        reportDraftId: row.id,
        reportDraftRevision: row.revision,
        contentDigest: digest(row.content),
      });
    });
    return { ok: true, status: 200, body: { reportDraft: view(row, item), replayed: false } };
  }

  function listDeliveries({ workItemId, draftId } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    const draft = item ? findDraft(item.id, draftId, actor) : null;
    if (!draft) return notFound();
    const reportDeliveries = deliveryRows()
      .filter((row) => row.workItemId === item.id
        && row.reportDraftId === draft.id
        && row.ownerTeamId === actorTeam(actor))
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
      .map(deliveryView);
    return { ok: true, status: 200, body: { reportDeliveries, count: reportDeliveries.length } };
  }

  function getDelivery({ workItemId, draftId, deliveryId } = {}, actor = null) {
    const item = findOwn(workItemId, actor);
    const draft = item ? findDraft(item.id, draftId, actor) : null;
    const row = draft ? findDelivery(item.id, draft.id, deliveryId, actor) : null;
    return row
      ? { ok: true, status: 200, body: { reportDelivery: deliveryView(row) } }
      : notFound();
  }

  function previewDelivery(input = {}, actor = null) {
    const { workItemId, draftId, channelId, conversationId, idempotencyKey } = input;
    const allowedFields = new Set(["workItemId", "draftId", "channelId", "conversationId", "idempotencyKey"]);
    if (Object.keys(input).some((field) => !allowedFields.has(field))) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_report_delivery_preview_fields" } };
    }
    const item = findOwn(workItemId, actor);
    const draft = item ? findDraft(item.id, draftId, actor) : null;
    if (!draft) return notFound();
    if (draft.status !== "confirmed" || !draft.confirmedSnapshot) {
      return { ok: false, status: 409, body: { error: "work_item_report_not_confirmed" } };
    }
    const target = targetFor(channelId, conversationId, actor);
    if (!target) return { ok: false, status: 404, body: { error: "work_item_report_delivery_target_not_found" } };
    if (target.channel.status !== "enabled") {
      return { ok: false, status: 409, body: { error: "work_item_report_delivery_channel_disabled" } };
    }
    const key = commandKey(idempotencyKey);
    if (!key) return { ok: false, status: 400, body: { error: "work_item_report_idempotency_key_required" } };
    const inputDigest = digest({
      reportDraftId: draft.id,
      reportRevision: draft.confirmedSnapshot.revision,
      contentDigest: draft.confirmedSnapshot.contentDigest,
      channelId: target.channel.id,
      conversationId: target.conversation.id,
    });
    const replay = deliveryRows().find((row) => row.workItemId === item.id
      && row.ownerTeamId === actorTeam(actor)
      && row.createdBy === actorUser(actor)
      && row.command?.idempotencyKey === key);
    if (replay) {
      if (replay.command.inputDigest !== inputDigest) {
        return { ok: false, status: 409, body: { error: "work_item_report_idempotency_conflict" } };
      }
      return { ok: true, status: 200, body: { reportDelivery: deliveryView(replay), replayed: true } };
    }
    const chunks = chunkContent(draft.confirmedSnapshot.content);
    const timestamp = now();
    const row = {
      id: nextId("wrdl"),
      schemaVersion: REPORT_DELIVERY_SCHEMA_VERSION,
      workItemId: item.id,
      reportDraftId: draft.id,
      ownerTeamId: item.ownerTeamId,
      projectId: item.projectId,
      status: "preview",
      revision: 1,
      confirmedReportRevision: draft.confirmedSnapshot.revision,
      content: draft.confirmedSnapshot.content,
      contentDigest: draft.confirmedSnapshot.contentDigest,
      chunkCount: chunks.length,
      chunkDigests: chunks.map(digest),
      target: {
        channelId: target.channel.id,
        channelName: target.channel.name,
        provider: target.channel.provider,
        conversationId: target.conversation.id,
        recipientId: target.conversation.externalUserId,
      },
      command: { idempotencyKey: key, inputDigest },
      sendCommand: null,
      channelDeliveryIds: [],
      createdBy: actorUser(actor),
      createdAt: timestamp,
      sentBy: null,
      sentAt: null,
    };
    runTx(() => {
      deliveryRows().unshift(row);
      recordActivity(item, actor, "report_delivery_previewed", {
        reportDraftId: draft.id,
        reportDeliveryId: row.id,
        channelId: row.target.channelId,
        conversationId: row.target.conversationId,
        contentDigest: row.contentDigest,
        chunkCount: row.chunkCount,
      });
    });
    return { ok: true, status: 201, body: { reportDelivery: deliveryView(row), replayed: false } };
  }

  function sendDelivery(input = {}, actor = null) {
    const { workItemId, draftId, deliveryId, expectedRevision, idempotencyKey, approvalToken } = input;
    const allowedFields = new Set([
      "workItemId", "draftId", "deliveryId", "expectedRevision", "idempotencyKey", "approvalToken",
    ]);
    if (Object.keys(input).some((field) => !allowedFields.has(field))) {
      return { ok: false, status: 400, body: { error: "invalid_work_item_report_delivery_send_fields" } };
    }
    const item = findOwn(workItemId, actor);
    const draft = item ? findDraft(item.id, draftId, actor) : null;
    const row = draft ? findDelivery(item.id, draft.id, deliveryId, actor) : null;
    if (!row) return notFound();
    const key = commandKey(idempotencyKey);
    if (!key) return { ok: false, status: 400, body: { error: "work_item_report_idempotency_key_required" } };
    if (row.sendCommand?.idempotencyKey === key) {
      return { ok: true, status: 200, body: { reportDelivery: deliveryView(row), replayed: true } };
    }
    if (row.status !== "preview") {
      return { ok: false, status: 409, body: { error: "work_item_report_delivery_already_sent" } };
    }
    if (!Number.isInteger(expectedRevision)) {
      return { ok: false, status: 400, body: { error: "expected_report_delivery_revision_required" } };
    }
    if (expectedRevision !== row.revision) {
      return { ok: false, status: 409, body: { error: "work_item_report_delivery_revision_conflict", currentRevision: row.revision } };
    }
    const target = targetFor(row.target.channelId, row.target.conversationId, actor);
    if (!target
      || target.channel.name !== row.target.channelName
      || target.channel.provider !== row.target.provider
      || target.conversation.externalUserId !== row.target.recipientId) {
      return { ok: false, status: 409, body: { error: "work_item_report_delivery_target_changed" } };
    }
    if (target.channel.status !== "enabled") {
      return { ok: false, status: 409, body: { error: "work_item_report_delivery_channel_disabled" } };
    }
    const approval = typeof validateApprovalToken === "function"
      ? validateApprovalToken(approvalToken, {
        action: WORK_ITEM_REPORT_DELIVERY_ACTION,
        targetId: row.id,
        actor,
        allowLegacy: false,
      })
      : { approved: false, reason: "approval_validator_unavailable" };
    if (!approval.approved) {
      return {
        ok: false,
        status: 409,
        body: {
          error: "approval_required",
          reason: approval.reason,
          action: WORK_ITEM_REPORT_DELIVERY_ACTION,
          targetId: row.id,
        },
      };
    }
    const chunks = chunkContent(row.content);
    if (chunks.length !== row.chunkCount
      || chunks.some((content, index) => digest(content) !== row.chunkDigests[index])) {
      return { ok: false, status: 409, body: { error: "work_item_report_delivery_preview_changed" } };
    }
    const queued = typeof enqueueChannelDeliveryBatch === "function"
      ? enqueueChannelDeliveryBatch({
        channelId: row.target.channelId,
        conversationId: row.target.conversationId,
        contents: chunks,
        taskContext: {
          channelId: row.target.channelId,
          conversationId: row.target.conversationId,
          projectId: item.projectId,
          workItemId: item.id,
        },
        sourceContext: {
          kind: "work_item_report",
          workItemId: item.id,
          reportDraftId: draft.id,
          reportDeliveryId: row.id,
          contentDigest: row.contentDigest,
        },
      })
      : { ok: false, reason: "delivery_unavailable" };
    if (!queued.ok) {
      return { ok: false, status: 503, body: { error: "work_item_report_delivery_enqueue_failed", reason: queued.reason } };
    }
    const timestamp = now();
    runTx(() => {
      row.status = "submitted";
      row.revision += 1;
      row.sendCommand = { idempotencyKey: key, approvalGrantId: approval.grantId ?? null };
      row.channelDeliveryIds = queued.deliveryIds;
      row.sentBy = actorUser(actor);
      row.sentAt = timestamp;
      recordActivity(item, actor, "report_delivery_sent", {
        reportDraftId: draft.id,
        reportDeliveryId: row.id,
        channelId: row.target.channelId,
        conversationId: row.target.conversationId,
        channelDeliveryIds: queued.deliveryIds,
        contentDigest: row.contentDigest,
      });
      appendEvent?.({
        invocationId: null,
        type: "work_item_report_delivery_queued",
        level: "info",
        message: `${item.localRef} confirmed report queued for ${row.target.provider} delivery.`,
        data: {
          workItemId: item.id,
          reportDraftId: draft.id,
          reportDeliveryId: row.id,
          channelId: row.target.channelId,
          conversationId: row.target.conversationId,
          channelDeliveryIds: queued.deliveryIds,
          actorTeamId: item.ownerTeamId,
        },
      });
    });
    return { ok: true, status: 202, body: { reportDelivery: deliveryView(row), replayed: false } };
  }

  return {
    list,
    get,
    generate,
    update,
    confirm,
    discard,
    listDeliveries,
    getDelivery,
    previewDelivery,
    sendDelivery,
  };
}
