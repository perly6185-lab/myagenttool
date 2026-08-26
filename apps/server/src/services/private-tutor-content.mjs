import { createHash } from "node:crypto";

const CONTEXTS = new Set(["diagnostic", "practice", "tutoring", "review"]);
const KNOWLEDGE_IDS = new Set(["integer", "equation-meaning", "balance", "word-problem"]);
const KINDS = new Set(["numeric", "choice"]);
const REVIEW_DECISIONS = new Set(["approved", "rejected"]);
const QUESTION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,99}$/;
const REQUIRED_APPROVALS = 2;

export function createPrivateTutorQuestionRevision(state, input, { actorId, now, nextId }) {
  const content = normalizeQuestionContent(input);
  if (!content) return { ok: false, status: 400, error: "invalid_private_tutor_question_revision" };
  const versions = state.privateTutorQuestionRevisions
    .filter((row) => row.questionId === content.questionId)
    .map((row) => Number(row.version) || 0);
  const version = Math.max(0, ...versions) + 1;
  const createdAt = now();
  const revision = {
    id: nextId("ptqr"),
    questionId: content.questionId,
    version,
    ...content,
    contentChecksum: checksum(content),
    createdBy: actorId,
    createdAt,
  };
  state.privateTutorQuestionRevisions.unshift(revision);
  recordContentEvent(state, { revision, type: "created", actorId, reason: null, at: createdAt, nextId });
  return { ok: true, revision: privateTutorQuestionRevisionView(state, revision) };
}

export function submitPrivateTutorQuestionRevision(state, revisionId, { actorId, now, nextId }) {
  const revision = findRevision(state, revisionId);
  if (!revision) return notFound();
  const status = revisionStatus(state, revision);
  if (status !== "draft") return conflict("private_tutor_question_revision_not_draft");
  const at = now();
  recordContentEvent(state, { revision, type: "submitted", actorId, reason: null, at, nextId });
  return { ok: true, revision: privateTutorQuestionRevisionView(state, revision) };
}

export function reviewPrivateTutorQuestionRevision(state, revisionId, input, { actorId, now, nextId }) {
  const revision = findRevision(state, revisionId);
  if (!revision) return notFound();
  const decision = String(input?.decision ?? "").trim();
  const evidence = String(input?.evidence ?? "").trim().slice(0, 500);
  if (!REVIEW_DECISIONS.has(decision) || !evidence) {
    return { ok: false, status: 400, error: "invalid_private_tutor_question_review" };
  }
  const status = revisionStatus(state, revision);
  if (!["in_review", "approved"].includes(status)) {
    return conflict("private_tutor_question_revision_not_reviewable");
  }
  if (revision.createdBy === actorId) return conflict("private_tutor_question_self_review_forbidden");
  if (state.privateTutorQuestionReviews.some((row) => row.revisionId === revision.id && row.reviewerId === actorId)) {
    return conflict("private_tutor_question_duplicate_review");
  }
  const review = {
    id: nextId("ptqv"),
    revisionId: revision.id,
    questionId: revision.questionId,
    reviewerId: actorId,
    decision,
    evidence,
    reviewedAt: now(),
  };
  state.privateTutorQuestionReviews.unshift(review);
  recordContentEvent(state, {
    revision,
    type: decision === "approved" ? "review_approved" : "review_rejected",
    actorId,
    reason: evidence,
    at: review.reviewedAt,
    nextId,
  });
  return { ok: true, review: { ...review }, revision: privateTutorQuestionRevisionView(state, revision) };
}

export function publishPrivateTutorQuestionRevision(state, revisionId, { actorId, now, nextId }) {
  const revision = findRevision(state, revisionId);
  if (!revision) return notFound();
  if (revisionStatus(state, revision) !== "approved") {
    return conflict("private_tutor_question_revision_not_approved");
  }
  const at = now();
  recordContentEvent(state, { revision, type: "published", actorId, reason: null, at, nextId });
  return { ok: true, revision: privateTutorQuestionRevisionView(state, revision), activeRevisionId: revision.id };
}

export function disablePrivateTutorQuestionRevision(state, revisionId, input, { actorId, now, nextId }) {
  const revision = findRevision(state, revisionId);
  if (!revision) return notFound();
  const reason = String(input?.reason ?? "").trim().slice(0, 500);
  if (!reason) return { ok: false, status: 400, error: "invalid_private_tutor_question_disable_reason" };
  if (!wasReleased(state, revision.id) || isDisabled(state, revision.id)) {
    return conflict("private_tutor_question_revision_not_disableable");
  }
  recordContentEvent(state, { revision, type: "disabled", actorId, reason, at: now(), nextId });
  return { ok: true, revision: privateTutorQuestionRevisionView(state, revision), activeRevisionId: activePrivateTutorQuestionRevision(state, revision.questionId)?.id ?? null };
}

export function rollbackPrivateTutorQuestion(state, questionId, input, { actorId, now, nextId }) {
  const target = findRevision(state, String(input?.revisionId ?? ""));
  const reason = String(input?.reason ?? "").trim().slice(0, 500);
  if (!target || target.questionId !== questionId) return notFound();
  if (!reason) return { ok: false, status: 400, error: "invalid_private_tutor_question_rollback_reason" };
  if (!wasReleased(state, target.id) || isDisabled(state, target.id)) {
    return conflict("private_tutor_question_revision_not_rollbackable");
  }
  const current = activePrivateTutorQuestionRevision(state, questionId);
  if (current?.id === target.id) return conflict("private_tutor_question_revision_already_active");
  recordContentEvent(state, { revision: target, type: "rolled_back", actorId, reason, at: now(), nextId });
  return { ok: true, revision: privateTutorQuestionRevisionView(state, target), activeRevisionId: target.id };
}

export function activePrivateTutorQuestionRevision(state, questionId) {
  const release = state.privateTutorContentEvents.find((row) =>
    row.questionId === questionId && ["published", "rolled_back"].includes(row.type));
  if (!release) return null;
  const revision = findRevision(state, release.revisionId);
  return revision && !isDisabled(state, revision.id) ? revision : null;
}

export function isPrivateTutorQuestionRevisionUsable(state, revisionId) {
  return wasReleased(state, revisionId) && !isDisabled(state, revisionId);
}

export function listPrivateTutorQuestionRevisions(state) {
  return state.privateTutorQuestionRevisions
    .slice()
    .sort((left, right) => left.questionId.localeCompare(right.questionId) || right.version - left.version)
    .map((revision) => privateTutorQuestionRevisionView(state, revision));
}

export function privateTutorQuestionRevisionView(state, revision) {
  const reviews = state.privateTutorQuestionReviews
    .filter((row) => row.revisionId === revision.id)
    .map((row) => ({ ...row }));
  const active = activePrivateTutorQuestionRevision(state, revision.questionId);
  return {
    ...revision,
    status: revisionStatus(state, revision),
    active: active?.id === revision.id,
    approvals: reviews.filter((row) => row.decision === "approved").length,
    requiredApprovals: REQUIRED_APPROVALS,
    reviews,
  };
}

export function seedPrivateTutorQuestionContent(state, revisions, at) {
  if (state.privateTutorQuestionRevisions.length || state.privateTutorContentEvents.length) return false;
  for (const revision of revisions) {
    state.privateTutorQuestionRevisions.push({ ...revision });
    state.privateTutorContentEvents.push({
      id: `ptqe_seed_${revision.id}`,
      revisionId: revision.id,
      questionId: revision.questionId,
      type: "published",
      actorId: "system_seed",
      reason: "migrated_demo_question",
      at,
    });
  }
  return true;
}

function revisionStatus(state, revision) {
  if (isDisabled(state, revision.id)) return "disabled";
  const active = activePrivateTutorQuestionRevision(state, revision.questionId);
  if (active?.id === revision.id) return "published";
  if (wasReleased(state, revision.id)) return "superseded";
  const reviews = state.privateTutorQuestionReviews.filter((row) => row.revisionId === revision.id);
  if (reviews.some((row) => row.decision === "rejected")) return "rejected";
  if (reviews.filter((row) => row.decision === "approved").length >= REQUIRED_APPROVALS) return "approved";
  if (state.privateTutorContentEvents.some((row) => row.revisionId === revision.id && row.type === "submitted")) return "in_review";
  return "draft";
}

function normalizeQuestionContent(input) {
  const questionId = String(input?.questionId ?? "").trim();
  const context = String(input?.context ?? "").trim();
  const knowledgeId = String(input?.knowledgeId ?? "").trim();
  const kind = String(input?.kind ?? "").trim();
  const prompt = String(input?.prompt ?? "").trim();
  const difficulty = Number(input?.difficulty);
  if (!QUESTION_ID_PATTERN.test(questionId) || !CONTEXTS.has(context) || !KNOWLEDGE_IDS.has(knowledgeId)
    || !KINDS.has(kind) || !prompt || prompt.length > 500 || !Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) return null;
  const base = { questionId, context, knowledgeId, difficulty, kind, prompt, allowVariableAssignment: input?.allowVariableAssignment === true };
  if (kind === "numeric") {
    const expectedAnswer = String(input?.expectedAnswer ?? "").trim();
    if (!expectedAnswer || expectedAnswer.length > 100) return null;
    return { ...base, options: null, expectedChoice: null, expectedAnswer };
  }
  const options = Array.isArray(input?.options)
    ? input.options.map((row) => ({ id: String(row?.id ?? "").trim().toLowerCase(), label: String(row?.label ?? "").trim() }))
    : [];
  const expectedChoice = String(input?.expectedChoice ?? "").trim().toLowerCase();
  if (options.length < 2 || options.length > 6 || options.some((row) => !/^[a-z0-9]{1,12}$/.test(row.id) || !row.label || row.label.length > 200)
    || new Set(options.map((row) => row.id)).size !== options.length || !options.some((row) => row.id === expectedChoice)) return null;
  return { ...base, options, expectedChoice, expectedAnswer: null };
}

function recordContentEvent(state, { revision, type, actorId, reason, at, nextId }) {
  state.privateTutorContentEvents.unshift({
    id: nextId("ptqe"),
    revisionId: revision.id,
    questionId: revision.questionId,
    type,
    actorId,
    reason,
    at,
  });
}

function findRevision(state, revisionId) {
  return state.privateTutorQuestionRevisions.find((row) => row.id === revisionId) ?? null;
}

function wasReleased(state, revisionId) {
  return state.privateTutorContentEvents.some((row) => row.revisionId === revisionId && ["published", "rolled_back"].includes(row.type));
}

function isDisabled(state, revisionId) {
  return state.privateTutorContentEvents.some((row) => row.revisionId === revisionId && row.type === "disabled");
}

function checksum(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function notFound() {
  return { ok: false, status: 404, error: "private_tutor_question_revision_not_found" };
}

function conflict(error) {
  return { ok: false, status: 409, error };
}
