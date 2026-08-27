import { createHash } from "node:crypto";

import { makeRunTx } from "../runtime/store/run-tx.mjs";

const MAX_SELECTED_CONTENT = 20;
const MAX_GOAL_CHARACTERS = 4_000;
const MAX_MESSAGE_CHARACTERS = 8_000;
const MAX_MESSAGES_PER_SESSION = 200;
const MAX_CITATIONS_PER_MESSAGE = 50;
const MAX_SESSIONS_PER_USER = 1_000;
const SESSION_STATUSES = new Set(["draft", "running", "completed", "awaiting_user", "failed", "cancelled"]);
const SOURCE_KINDS = new Set(["api", "channel", "local_library"]);

/**
 * Durable contract for a bounded, read-only material conversation.
 *
 * M1 PR 1 intentionally does not invoke a model. It freezes the selected
 * content identities, records user messages, enforces ownership/revisions, and
 * provides an injectable deterministic responder for state-machine tests. The
 * production runtime leaves generation disabled until the retrieval/citation
 * layer is composed in the next slice.
 */
export function createMaterialWorkSessionService({
  state,
  now = () => new Date().toISOString(),
  nextId = (prefix) => `${prefix}_${Date.now().toString(36)}`,
  persistStateSoon = () => {},
  appendEvent = () => {},
  store,
  getLocalContent,
  deterministicResponder = null,
} = {}) {
  const runTx = makeRunTx({ store, persistStateSoon });
  state.materialWorkSessions ??= [];
  state.materialWorkMessages ??= [];
  state.materialWorkCitations ??= [];

  async function createSession(input = {}, actor = null) {
    const identity = actorIdentity(actor);
    if (!identity.ok) return identity.result;
    const userGoal = boundedText(input.userGoal, MAX_GOAL_CHARACTERS);
    if (!userGoal) return invalid("material_work_goal_required");
    if (input.scope?.mode !== "selected") return invalid("material_work_scope_mode_unsupported");
    const idempotencyKey = normalizedIdempotencyKey(input.idempotencyKey);
    if (input.idempotencyKey != null && !idempotencyKey) return invalid("material_work_idempotency_key_invalid");
    const requestedContentIds = normalizeContentIds(input.scope?.contentIds ?? input.contentIds);
    if (!requestedContentIds.ok) return requestedContentIds.result;
    const sourceContext = normalizeSourceContext(input.sourceContext ?? { kind: input.entryPoint ?? "api" });
    if (!sourceContext.ok) return sourceContext.result;
    const requestDigest = digest({
      userGoal,
      contentIds: requestedContentIds.value,
      sourceContext: sourceContext.value,
    });
    const existing = idempotencyKey
      ? state.materialWorkSessions.find((session) => session.ownerTeamId === identity.teamId
        && session.createdBy === identity.userId
        && session.createIdempotencyKey === idempotencyKey)
      : null;
    if (existing) {
      if (existing.createRequestDigest !== requestDigest) {
        return conflict("material_work_idempotency_conflict", existing.revision);
      }
      return { status: 200, body: sessionView(existing, { deduplicated: true }) };
    }
    const ownedCount = state.materialWorkSessions.filter((session) =>
      session.ownerTeamId === identity.teamId && session.createdBy === identity.userId).length;
    if (ownedCount >= MAX_SESSIONS_PER_USER) {
      return { status: 429, body: { error: "material_work_session_limit_reached" } };
    }
    const frozenScope = await freezeSelectedScope(requestedContentIds.value, actor);
    if (!frozenScope.ok) return frozenScope.result;

    const timestamp = now();
    const session = {
      id: nextId("material_work_session"),
      schemaVersion: 1,
      ownerTeamId: identity.teamId,
      createdBy: identity.userId,
      userGoal,
      status: "draft",
      revision: 1,
      scope: frozenScope.value,
      sourceContext: sourceContext.value,
      messageCount: 1,
      citationCount: 0,
      generationMode: typeof deterministicResponder === "function" ? "deterministic_fixture" : "not_enabled",
      createIdempotencyKey: idempotencyKey,
      createRequestDigest: requestDigest,
      cancellation: null,
      failure: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastMessageAt: timestamp,
      completedAt: null,
      cancelledAt: null,
    };
    const goalMessage = {
      id: nextId("material_work_message"),
      sessionId: session.id,
      ownerTeamId: identity.teamId,
      createdBy: identity.userId,
      role: "user",
      kind: "goal",
      content: userGoal,
      sequence: 1,
      retrievalRevision: 1,
      idempotencyKey: idempotencyKey ? `${idempotencyKey}:goal` : null,
      requestDigest: digest({ content: userGoal, kind: "goal" }),
      citationIds: [],
      createdAt: timestamp,
    };
    runTx(() => {
      state.materialWorkSessions.push(session);
      state.materialWorkMessages.push(goalMessage);
    });
    record("material_work_session_created", session, {
      scopeMode: session.scope.mode,
      selectedCount: session.scope.items.length,
      sourceKind: session.sourceContext.kind,
    });
    return { status: 201, body: sessionView(session) };
  }

  async function createFromChannel({ userGoal, references = [], channelId, conversationId, eventId, idempotencyKey } = {}, actor = null) {
    const contentIds = [...new Set((Array.isArray(references) ? references : [])
      .map((reference) => reference?.contentId)
      .filter(Boolean))];
    return createSession({
      userGoal,
      scope: { mode: "selected", contentIds },
      sourceContext: { kind: "channel", channelId, conversationId, eventId },
      idempotencyKey: idempotencyKey ?? (eventId ? `channel-material-work:${eventId}` : null),
    }, actor);
  }

  function getSession({ sessionId } = {}, actor = null) {
    const resolved = ownedSession(sessionId, actor);
    if (!resolved.ok) return resolved.result;
    return { status: 200, body: sessionView(resolved.session) };
  }

  async function addMessage({ sessionId, content, expectedRevision, idempotencyKey } = {}, actor = null) {
    const resolved = ownedSession(sessionId, actor);
    if (!resolved.ok) return resolved.result;
    const session = resolved.session;
    if (session.status === "cancelled") return conflict("material_work_session_cancelled", session.revision);
    if (!SESSION_STATUSES.has(session.status)) return conflict("material_work_session_state_invalid", session.revision);
    if (!Number.isInteger(expectedRevision)) return invalid("material_work_expected_revision_required");
    const normalizedContent = boundedText(content, MAX_MESSAGE_CHARACTERS);
    if (!normalizedContent) return invalid("material_work_message_required");
    const key = normalizedIdempotencyKey(idempotencyKey);
    if (idempotencyKey != null && !key) return invalid("material_work_idempotency_key_invalid");
    const requestDigest = digest({ content: normalizedContent });
    const existing = key
      ? state.materialWorkMessages.find((message) => message.sessionId === session.id
        && message.role === "user" && message.idempotencyKey === key)
      : null;
    if (existing) {
      if (existing.requestDigest !== requestDigest) return conflict("material_work_idempotency_conflict", session.revision);
      return { status: 200, body: sessionView(session, { deduplicated: true }) };
    }
    if (expectedRevision !== session.revision) return conflict("material_work_revision_conflict", session.revision);
    if (session.messageCount >= MAX_MESSAGES_PER_SESSION) {
      return { status: 429, body: { error: "material_work_message_limit_reached" } };
    }

    const timestamp = now();
    const userMessage = {
      id: nextId("material_work_message"),
      sessionId: session.id,
      ownerTeamId: session.ownerTeamId,
      createdBy: resolved.identity.userId,
      role: "user",
      kind: "follow_up",
      content: normalizedContent,
      sequence: session.messageCount + 1,
      retrievalRevision: session.revision + 1,
      idempotencyKey: key,
      requestDigest,
      citationIds: [],
      createdAt: timestamp,
    };
    const responderEnabled = typeof deterministicResponder === "function";
    runTx(() => {
      state.materialWorkMessages.push(userMessage);
      session.messageCount += 1;
      session.status = responderEnabled ? "running" : "draft";
      session.failure = null;
      session.revision += 1;
      session.lastMessageAt = timestamp;
      session.updatedAt = timestamp;
    });
    record("material_work_message_recorded", session, {
      messageId: userMessage.id,
      generationEnabled: responderEnabled,
    });
    if (!responderEnabled) {
      return {
        status: 202,
        body: sessionView(session, {
          generation: { state: "not_started", reason: "material_work_generation_not_enabled" },
        }),
      };
    }

    const runningRevision = session.revision;
    try {
      const response = await deterministicResponder({
        session: sessionView(session).session,
        message: publicMessage(userMessage),
        scope: session.scope,
      });
      if (session.status === "cancelled" || session.revision !== runningRevision) {
        return conflict("material_work_response_superseded", session.revision);
      }
      return completeDeterministicResponse(session, response, resolved.identity.userId);
    } catch (error) {
      if (session.status === "cancelled" || session.revision !== runningRevision) {
        return conflict("material_work_response_superseded", session.revision);
      }
      const code = boundedCode(error?.code ?? error?.message) ?? "material_work_fixture_failed";
      runTx(() => {
        session.status = "failed";
        session.failure = { code, at: now() };
        session.revision += 1;
        session.updatedAt = now();
      });
      record("material_work_session_failed", session, { reason: code });
      return { status: 500, body: { error: code, currentRevision: session.revision } };
    }
  }

  function cancelSession({ sessionId, expectedRevision, idempotencyKey } = {}, actor = null) {
    const resolved = ownedSession(sessionId, actor);
    if (!resolved.ok) return resolved.result;
    const session = resolved.session;
    if (session.status === "cancelled") return { status: 200, body: sessionView(session, { deduplicated: true }) };
    if (!Number.isInteger(expectedRevision)) return invalid("material_work_expected_revision_required");
    if (expectedRevision !== session.revision) return conflict("material_work_revision_conflict", session.revision);
    const key = normalizedIdempotencyKey(idempotencyKey);
    if (idempotencyKey != null && !key) return invalid("material_work_idempotency_key_invalid");
    const timestamp = now();
    runTx(() => {
      session.status = "cancelled";
      session.cancellation = { requestedBy: resolved.identity.userId, idempotencyKey: key, at: timestamp };
      session.cancelledAt = timestamp;
      session.revision += 1;
      session.updatedAt = timestamp;
    });
    record("material_work_session_cancelled", session, {});
    return { status: 200, body: sessionView(session) };
  }

  async function freezeSelectedScope(contentIds, actor) {
    if (typeof getLocalContent !== "function") {
      return { ok: false, result: { status: 503, body: { error: "material_work_content_catalog_unavailable" } } };
    }
    const items = [];
    for (const selectedId of contentIds) {
      const result = await getLocalContent({ contentId: selectedId }, actor);
      if (result?.status !== 200 || !result.body?.content) {
        return { ok: false, result: { status: 404, body: { error: "material_work_content_not_found" } } };
      }
      const content = result.body.content;
      if (content.id !== selectedId) {
        return { ok: false, result: { status: 404, body: { error: "material_work_content_not_found" } } };
      }
      const selectedVersion = boundedText(
        content.metadata?.sha256 ?? content.metadata?.fingerprint ?? content.modifiedAt ?? content.importedAt,
        200,
      );
      if (!selectedVersion) {
        return { ok: false, result: { status: 409, body: { error: "material_work_content_version_unavailable" } } };
      }
      items.push({
        contentId: content.id,
        title: boundedText(content.title, 500) || "未命名资料",
        kind: boundedCode(content.kind) ?? "material",
        projectId: boundedIdentifier(content.projectId),
        workItemId: boundedIdentifier(content.workItemId),
        mimeType: boundedText(content.mimeType, 160),
        sourceType: boundedCode(content.source?.type),
        sourceLabel: boundedText(content.sourceLabel, 300),
        available: content.original?.available === true,
        availabilityReason: boundedCode(content.original?.reason),
        indexStatus: boundedCode(content.indexStatus),
        selectedVersion,
      });
    }
    const frozenAt = now();
    return {
      ok: true,
      value: {
        mode: "selected",
        immutable: true,
        items,
        fingerprint: `sha256:${digest(items.map((item) => ({ contentId: item.contentId, selectedVersion: item.selectedVersion })))}`,
        frozenAt,
      },
    };
  }

  function completeDeterministicResponse(session, response, createdBy) {
    const answer = boundedText(response?.answer, MAX_MESSAGE_CHARACTERS);
    if (!answer) throw Object.assign(new Error("material_work_fixture_answer_required"), { code: "material_work_fixture_answer_required" });
    const selectedById = new Map(session.scope.items.map((item) => [item.contentId, item]));
    const requestedCitations = Array.isArray(response?.citations) ? response.citations.slice(0, MAX_CITATIONS_PER_MESSAGE) : [];
    for (const citation of requestedCitations) {
      const selected = selectedById.get(citation?.contentId);
      if (!selected) {
        throw Object.assign(new Error("material_work_fixture_citation_out_of_scope"), { code: "material_work_fixture_citation_out_of_scope" });
      }
      const suppliedFingerprint = boundedText(citation.sourceFingerprint, 200);
      if (suppliedFingerprint && suppliedFingerprint !== selected.selectedVersion) {
        throw Object.assign(new Error("material_work_fixture_citation_version_mismatch"), { code: "material_work_fixture_citation_version_mismatch" });
      }
      if (!boundedText(citation.excerpt, 1_000)) {
        throw Object.assign(new Error("material_work_fixture_citation_excerpt_required"), { code: "material_work_fixture_citation_excerpt_required" });
      }
    }
    const timestamp = now();
    const assistantMessageId = nextId("material_work_message");
    const citations = requestedCitations.map((citation, index) => ({
      id: nextId("material_work_citation"),
      sessionId: session.id,
      messageId: assistantMessageId,
      ownerTeamId: session.ownerTeamId,
      contentId: citation.contentId,
      ordinal: index + 1,
      sourceFingerprint: selectedById.get(citation.contentId).selectedVersion,
      plainTextOffset: Math.max(0, Number.parseInt(citation.plainTextOffset, 10) || 0),
      excerpt: boundedText(citation.excerpt, 1_000),
      createdAt: timestamp,
    }));
    const assistantMessage = {
      id: assistantMessageId,
      sessionId: session.id,
      ownerTeamId: session.ownerTeamId,
      createdBy,
      role: "assistant",
      kind: "answer",
      content: answer,
      sequence: session.messageCount + 1,
      retrievalRevision: session.revision,
      idempotencyKey: null,
      requestDigest: null,
      citationIds: citations.map((citation) => citation.id),
      createdAt: timestamp,
    };
    runTx(() => {
      state.materialWorkCitations.push(...citations);
      state.materialWorkMessages.push(assistantMessage);
      session.messageCount += 1;
      session.citationCount += citations.length;
      session.status = "completed";
      session.failure = null;
      session.completedAt = timestamp;
      session.revision += 1;
      session.updatedAt = timestamp;
    });
    record("material_work_session_completed", session, {
      messageId: assistantMessage.id,
      citationCount: citations.length,
      deterministicFixture: true,
    });
    return { status: 200, body: sessionView(session) };
  }

  function ownedSession(sessionId, actor) {
    const identity = actorIdentity(actor);
    if (!identity.ok) return { ok: false, result: identity.result };
    const normalizedId = String(sessionId ?? "").trim();
    const session = state.materialWorkSessions.find((candidate) => candidate.id === normalizedId
      && candidate.ownerTeamId === identity.teamId
      && candidate.createdBy === identity.userId) ?? null;
    return session
      ? { ok: true, session, identity }
      : { ok: false, result: { status: 404, body: { error: "material_work_session_not_found" } } };
  }

  function sessionView(session, extra = {}) {
    const messages = state.materialWorkMessages
      .filter((message) => message.sessionId === session.id && message.ownerTeamId === session.ownerTeamId)
      .sort((left, right) => Number(left.sequence) - Number(right.sequence))
      .map(publicMessage);
    const citations = state.materialWorkCitations
      .filter((citation) => citation.sessionId === session.id && citation.ownerTeamId === session.ownerTeamId)
      .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)) || Number(left.ordinal) - Number(right.ordinal))
      .map(publicCitation);
    return {
      session: {
        id: session.id,
        schemaVersion: session.schemaVersion,
        userGoal: session.userGoal,
        status: session.status,
        revision: session.revision,
        scope: session.scope,
        sourceContext: session.sourceContext,
        messageCount: session.messageCount,
        citationCount: session.citationCount,
        generation: {
          available: session.generationMode !== "not_enabled",
          mode: session.generationMode,
        },
        failure: session.failure,
        cancellation: session.cancellation ? { at: session.cancellation.at } : null,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        lastMessageAt: session.lastMessageAt,
        completedAt: session.completedAt,
        cancelledAt: session.cancelledAt,
      },
      messages,
      citations,
      ...extra,
    };
  }

  function record(type, session, data) {
    appendEvent({
      invocationId: null,
      type,
      level: type.endsWith("failed") ? "warn" : "info",
      message: `Material work session ${session.id}: ${type}.`,
      data: {
        sessionId: session.id,
        ownerTeamId: session.ownerTeamId,
        createdBy: session.createdBy,
        revision: session.revision,
        ...data,
      },
    });
  }

  return { createSession, createFromChannel, getSession, addMessage, cancelSession };
}

function actorIdentity(actor) {
  const userId = boundedIdentifier(actor?.userId);
  const teamId = boundedIdentifier(actor?.teamId);
  return userId && teamId
    ? { ok: true, userId, teamId }
    : { ok: false, result: { status: 401, body: { error: "material_work_authentication_required" } } };
}

function normalizeContentIds(input) {
  if (!Array.isArray(input)) return { ok: false, result: invalid("material_work_selected_content_required") };
  const contentIds = [...new Set(input.map((value) => String(value ?? "").trim()).filter(Boolean))];
  if (!contentIds.length) return { ok: false, result: invalid("material_work_selected_content_required") };
  if (contentIds.length > MAX_SELECTED_CONTENT) return { ok: false, result: invalid("material_work_selected_content_limit_exceeded") };
  if (contentIds.some((contentId) => !/^lc_[a-f0-9]{32}$/.test(contentId))) {
    return { ok: false, result: invalid("material_work_content_id_invalid") };
  }
  return { ok: true, value: contentIds };
}

function normalizeSourceContext(input) {
  const kind = String(input?.kind ?? "api").trim().toLowerCase();
  if (!SOURCE_KINDS.has(kind)) return { ok: false, result: invalid("material_work_source_context_invalid") };
  const channelId = kind === "channel" ? boundedIdentifier(input.channelId) : null;
  const conversationId = kind === "channel" ? boundedIdentifier(input.conversationId) : null;
  const eventId = kind === "channel" ? boundedIdentifier(input.eventId) : null;
  if (kind === "channel" && (!channelId || !conversationId || !eventId)) {
    return { ok: false, result: invalid("material_work_channel_context_required") };
  }
  return {
    ok: true,
    value: {
      kind,
      channelId,
      conversationId,
      eventId,
    },
  };
}

function normalizedIdempotencyKey(value) {
  if (value == null || value === "") return null;
  const key = String(value).trim();
  return /^[a-zA-Z0-9_.:-]{1,200}$/.test(key) ? key : null;
}

function publicMessage(message) {
  return {
    id: message.id,
    role: message.role,
    kind: message.kind,
    content: message.content,
    sequence: message.sequence,
    retrievalRevision: message.retrievalRevision,
    citationIds: [...(message.citationIds ?? [])],
    createdAt: message.createdAt,
  };
}

function publicCitation(citation) {
  return {
    id: citation.id,
    messageId: citation.messageId,
    contentId: citation.contentId,
    ordinal: citation.ordinal,
    sourceFingerprint: citation.sourceFingerprint,
    plainTextOffset: citation.plainTextOffset,
    excerpt: citation.excerpt,
    createdAt: citation.createdAt,
  };
}

function boundedText(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function boundedIdentifier(value) {
  const text = String(value ?? "").trim();
  return /^[a-zA-Z0-9_.:-]{1,200}$/.test(text) ? text : null;
}

function boundedCode(value) {
  const text = String(value ?? "").trim().toLowerCase();
  return /^[a-z0-9_.:-]{1,120}$/.test(text) ? text : null;
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function invalid(error) {
  return { status: 400, body: { error } };
}

function conflict(error, currentRevision) {
  return { status: 409, body: { error, currentRevision } };
}

export const MATERIAL_WORK_SESSION_LIMITS = Object.freeze({
  maxSelectedContent: MAX_SELECTED_CONTENT,
  maxGoalCharacters: MAX_GOAL_CHARACTERS,
  maxMessageCharacters: MAX_MESSAGE_CHARACTERS,
  maxMessagesPerSession: MAX_MESSAGES_PER_SESSION,
});
