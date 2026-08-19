import { createHash } from "node:crypto";

import { makeRunTx } from "../runtime/store/run-tx.mjs";
import {
  MAIL_CLASSIFIER_VERSION,
  classifyMailHeader,
  mailClassificationViewMatches,
  mailHeaderFingerprint,
  mailMessageKey,
  publicMailClassification,
  validateMailClassificationPatch,
} from "./mail-header-classifier.mjs";
import { buildMailClassificationQuality } from "./mail-classification-quality.mjs";

const MAX_CLASSIFICATIONS_PER_TEAM = 20_000;
const MAX_JOBS_PER_TEAM = 200;
const MAX_CORRECTIONS_PER_TEAM = 2_000;
const MAX_RULES_PER_TEAM = 200;
const RULE_SAMPLE_LIMIT = 5;
const VALID_RULE_ACTIONS = new Set(["pause", "resume", "revoke"]);
const VALID_VIEWS = new Set(["all", "needs_attention", "important", "notifications", "subscriptions", "other"]);
const MAX_SEMANTIC_MESSAGES = 50;
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_OPEN_MS = 30_000;
const TERMINAL_JOB_STATUSES = new Set(["succeeded", "degraded", "cancelled", "interrupted"]);

export function createMailClassificationService({
  state,
  now,
  nextId,
  appendEvent,
  persistStateSoon = () => {},
  store,
  semanticAdapter = null,
  clockMs = () => Date.now(),
} = {}) {
  const runTx = makeRunTx({ store, persistStateSoon });
  state.mailClassifications ??= [];
  state.mailClassificationJobs ??= [];
  state.mailClassificationCorrections ??= [];
  state.mailClassificationRules ??= [];
  let classificationIndex = buildClassificationIndex(state.mailClassifications);
  const activeSemanticControllers = new Map();
  let semanticFailures = 0;
  let semanticCircuitOpenUntil = 0;

  function teamIdOf(actor) {
    return actor?.teamId ?? "team_local";
  }

  function recordFor(message, actor) {
    const teamId = teamIdOf(actor);
    const key = mailMessageKey(message);
    return classificationIndex.get(classificationIndexKey(teamId, key)) ?? null;
  }

  function candidateFor(message, actor, { force = false } = {}) {
    const existing = recordFor(message, actor);
    const fingerprint = mailHeaderFingerprint(message);
    if (existing && !force && existing.inputFingerprint === fingerprint && existing.classifierVersion === MAIL_CLASSIFIER_VERSION) return existing;
    const result = classifyMailHeader(message);
    return {
      id: existing?.id ?? null,
      ownerTeamId: teamIdOf(actor),
      accountId: String(message.applicationId ?? "mail").slice(0, 160),
      folderId: String(message.folderId ?? "inbox").slice(0, 100),
      messageId: String(message.messageId ?? "").slice(0, 998),
      messageKey: mailMessageKey(message),
      inputFingerprint: fingerprint,
      classifierVersion: MAIL_CLASSIFIER_VERSION,
      stage: "header",
      analysisState: "ready",
      semanticFingerprint: null,
      ...result,
      headerClassification: {
        attention: result.attention,
        mailType: result.mailType,
        suggestedAction: result.suggestedAction,
        confidence: result.confidence,
        explanation: result.explanation,
        reasonCodes: result.reasonCodes,
      },
      confirmationState: existing?.confirmationState ?? "proposed",
      manualOverride: existing?.manualOverride ?? null,
      provider: "deterministic",
      model: null,
      revision: existing?.revision ?? 0,
      createdAt: existing?.createdAt ?? null,
      updatedAt: existing?.updatedAt ?? null,
      confirmedAt: existing?.confirmedAt ?? null,
      confirmedBy: existing?.confirmedBy ?? null,
    };
  }

  function presentationFor(message, actor) {
    const candidate = candidateFor(message, actor);
    if (candidate.manualOverride) return candidate;
    const rule = activeRuleFor(message, actor);
    return rule ? { ...candidate, ruleOverride: rule.target, appliedRuleId: rule.id } : candidate;
  }

  function publicFor(message, actor) {
    return publicMailClassification(presentationFor(message, actor));
  }

  function matchesView(message, actor, view = "all") {
    return mailClassificationViewMatches(presentationFor(message, actor), VALID_VIEWS.has(view) ? view : "all");
  }

  function activeRuleFor(message, actor) {
    const identity = senderIdentity(message?.from);
    if (!identity.email) return null;
    const accountId = mailAccountId(message);
    return state.mailClassificationRules
      .filter((rule) => rule.ownerTeamId === teamIdOf(actor) && rule.accountId === accountId && rule.status === "active" && ruleMatchesIdentity(rule, identity))
      .sort((left, right) => {
        const kindPriority = Number(right.matchKind === "sender") - Number(left.matchKind === "sender");
        return kindPriority || String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? ""));
      })[0] ?? null;
  }

  function summary(messages, actor) {
    const counts = { all: messages.length, needs_attention: 0, important: 0, notifications: 0, subscriptions: 0, other: 0 };
    for (const message of messages) {
      for (const view of ["needs_attention", "important", "notifications", "subscriptions", "other"]) {
        if (matchesView(message, actor, view)) counts[view] += 1;
      }
    }
    const persisted = messages.filter((message) => recordFor(message, actor)).length;
    return { counts, classified: persisted, pending: Math.max(0, messages.length - persisted), classifierVersion: MAIL_CLASSIFIER_VERSION };
  }

  function qualitySummary(messages, actor) {
    return buildMailClassificationQuality({ state, messages, actor, now });
  }

  function persistCandidate(message, actor, { batch = false, batchRows = null, force = false, withinTransaction = false } = {}) {
    const candidate = candidateFor(message, actor, { force });
    const existing = recordFor(message, actor);
    const timestamp = now();
    if (existing && !force && existing.inputFingerprint === candidate.inputFingerprint && existing.classifierVersion === MAIL_CLASSIFIER_VERSION) {
      return { record: existing, replayed: true };
    }
    const mutate = () => {
      if (existing) {
        Object.assign(existing, candidate, {
          id: existing.id,
          revision: existing.revision + 1,
          createdAt: existing.createdAt,
          updatedAt: timestamp,
        });
      } else {
        const created = {
          ...candidate,
          id: nextId("mailcls"),
          revision: 1,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        if (batch && Array.isArray(batchRows)) batchRows.push(created);
        else if (batch) state.mailClassifications.push(created);
        else state.mailClassifications.unshift(created);
        classificationIndex.set(classificationIndexKey(created.ownerTeamId, created.messageKey), created);
      }
      if (!batch) {
        capTeamRows(state.mailClassifications, teamIdOf(actor), MAX_CLASSIFICATIONS_PER_TEAM);
        classificationIndex = buildClassificationIndex(state.mailClassifications);
      }
    };
    if (withinTransaction) mutate();
    else runTx(mutate);
    return { record: recordFor(message, actor), replayed: false };
  }

  function startJob({ messages = [], scope = "new_mail", actor = null } = {}) {
    const allowedScope = ["new_mail", "rebuild"].includes(scope) ? scope : null;
    if (!allowedScope) return { status: 400, body: { error: "mail_classification_scope_invalid" } };
    const teamId = teamIdOf(actor);
    const timestamp = now();
    const candidates = allowedScope === "new_mail"
      ? messages.filter((message) => {
        const existing = recordFor(message, actor);
        return !existing
          || existing.inputFingerprint !== mailHeaderFingerprint(message)
          || existing.classifierVersion !== MAIL_CLASSIFIER_VERSION;
      })
      : messages;
    const job = {
      id: nextId("mailclsjob"), ownerTeamId: teamId, accountId: null, scope: allowedScope, mode: "header",
      status: "running", total: candidates.length, processed: 0, classified: 0, unknown: 0, replayed: 0,
      failed: 0, failures: [], classifierVersion: MAIL_CLASSIFIER_VERSION, createdAt: timestamp, updatedAt: timestamp, completedAt: null,
    };
    const newRows = [];
    runTx(() => {
      state.mailClassificationJobs.unshift(job);
      capTeamRows(state.mailClassificationJobs, teamId, MAX_JOBS_PER_TEAM);
      for (const message of candidates) {
        try {
          const result = persistCandidate(message, actor, {
            batch: true,
            batchRows: newRows,
            force: allowedScope === "rebuild",
            withinTransaction: true,
          });
          job.processed += 1;
          if (result.replayed) job.replayed += 1;
          else job.classified += 1;
          if ((result.record?.manualOverride ?? result.record)?.attention === "unknown") job.unknown += 1;
        } catch {
          job.processed += 1;
          job.failed += 1;
          if (job.failures.length < 100) job.failures.push({ messageKey: mailMessageKey(message), error: "mail_classification_failed" });
        }
      }
      if (newRows.length) state.mailClassifications.unshift(...newRows);
      capTeamRows(state.mailClassifications, teamId, MAX_CLASSIFICATIONS_PER_TEAM);
      classificationIndex = buildClassificationIndex(state.mailClassifications);
      job.status = job.failed ? "degraded" : "succeeded";
      job.updatedAt = now();
      job.completedAt = job.updatedAt;
      appendEvent?.({
        invocationId: null,
        type: "mail_classification_completed",
        level: job.failed ? "warning" : "info",
        message: job.failed ? "Mail classification completed with some failures." : "Mail classification completed.",
        data: { actorTeamId: teamId, jobId: job.id, processed: job.processed, classified: job.classified, replayed: job.replayed, failed: job.failed },
      });
    });
    return { status: 200, body: { job: publicJob(job), summary: summary(messages, actor) } };
  }

  function getJob({ jobId, actor = null } = {}) {
    const job = (state.mailClassificationJobs ?? []).find((row) => row.id === jobId && row.ownerTeamId === teamIdOf(actor));
    return job ? { status: 200, body: { job: publicJob(job) } } : { status: 404, body: { error: "mail_classification_job_not_found" } };
  }

  function semanticPreview({ messages = [], limit = 20, actor = null } = {}) {
    const boundedLimit = boundedSemanticLimit(limit);
    const eligible = semanticEligibleMessages(messages).slice(0, boundedLimit);
    const pending = eligible.filter((message) => {
      const record = recordFor(message, actor);
      return record?.semanticFingerprint !== mailSemanticFingerprint(message, semanticAdapter);
    });
    const circuitRemainingMs = Math.max(0, semanticCircuitOpenUntil - clockMs());
    return {
      status: 200,
      body: {
        preview: {
          available: Boolean(semanticAdapter) && circuitRemainingMs === 0,
          reason: !semanticAdapter ? "not_configured" : circuitRemainingMs > 0 ? "circuit_open" : null,
          eligible: eligible.length,
          pending: pending.length,
          limit: boundedLimit,
          newestDate: pending[0]?.date ?? null,
          oldestDate: pending.at(-1)?.date ?? null,
          readsUnopenedBodies: false,
          externalModel: false,
          provider: semanticAdapter?.providerId ?? null,
          model: semanticAdapter?.model ?? null,
          circuitRemainingMs,
        },
      },
    };
  }

  function startSemanticJob({ messages = [], limit = 20, confirmed = false, actor = null } = {}) {
    if (confirmed !== true) return { status: 400, body: { error: "mail_semantic_confirmation_required" } };
    if (!semanticAdapter) return { status: 503, body: { error: "mail_semantic_unavailable", reason: "not_configured" } };
    if (semanticCircuitOpenUntil > clockMs()) {
      return { status: 503, body: { error: "mail_semantic_unavailable", reason: "circuit_open", retryAfterMs: semanticCircuitOpenUntil - clockMs() } };
    }
    const teamId = teamIdOf(actor);
    const activeJob = state.mailClassificationJobs.find((job) => job.mode === "semantic" && ["queued", "running", "cancelling"].includes(job.status));
    if (activeJob) {
      return activeJob.ownerTeamId === teamId
        ? { status: 200, body: { job: publicJob(activeJob), reused: true } }
        : { status: 429, body: { error: "mail_semantic_busy" } };
    }
    const boundedLimit = boundedSemanticLimit(limit);
    const candidates = semanticEligibleMessages(messages)
      .slice(0, boundedLimit)
      .filter((message) => recordFor(message, actor)?.semanticFingerprint !== mailSemanticFingerprint(message, semanticAdapter));
    const timestamp = now();
    const job = {
      id: nextId("mailclsjob"), ownerTeamId: teamId, accountId: null, scope: "recent", mode: "semantic",
      status: candidates.length ? "queued" : "succeeded", total: candidates.length, processed: 0, classified: 0, unknown: 0, replayed: 0,
      failed: 0, cancelled: 0, failures: [], classifierVersion: MAIL_CLASSIFIER_VERSION,
      provider: semanticAdapter.providerId, model: semanticAdapter.modelVersion ?? semanticAdapter.model,
      cancelRequested: false, createdAt: timestamp, updatedAt: timestamp, completedAt: candidates.length ? null : timestamp,
    };
    runTx(() => {
      state.mailClassificationJobs.unshift(job);
      capTeamRows(state.mailClassificationJobs, teamId, MAX_JOBS_PER_TEAM);
    });
    if (candidates.length) queueMicrotask(() => { void runSemanticJob(job, candidates, actor); });
    return { status: candidates.length ? 202 : 200, body: { job: publicJob(job) } };
  }

  async function runSemanticJob(job, messages, actor) {
    const controllers = new Set();
    activeSemanticControllers.set(job.id, controllers);
    runTx(() => {
      job.status = job.cancelRequested ? "cancelling" : "running";
      job.updatedAt = now();
    });
    let cursor = 0;
    let circuitOpened = false;
    const concurrency = Math.min(2, Math.max(1, Number(semanticAdapter?.maxConcurrency) || 2));
    const worker = async () => {
      while (!job.cancelRequested && !circuitOpened) {
        const index = cursor;
        cursor += 1;
        if (index >= messages.length) return;
        const message = messages[index];
        const controller = new AbortController();
        controllers.add(controller);
        try {
          const header = persistCandidate(message, actor).record;
          const semantic = await semanticAdapter.analyze({
            message,
            headerClassification: header.manualOverride ?? header,
            signal: controller.signal,
          });
          if (job.cancelRequested) {
            job.cancelled += 1;
          } else {
            persistSemanticResult(message, semantic, actor);
            job.classified += 1;
            if (semantic.attention === "unknown") job.unknown += 1;
            semanticFailures = 0;
          }
        } catch (error) {
          if (job.cancelRequested || error?.name === "AbortError") {
            job.cancelled += 1;
          } else {
            job.failed += 1;
            semanticFailures += 1;
            if (job.failures.length < 100) job.failures.push({ messageKey: mailMessageKey(message), error: "mail_semantic_classification_failed" });
            if (semanticFailures >= CIRCUIT_FAILURE_THRESHOLD) {
              semanticCircuitOpenUntil = clockMs() + CIRCUIT_OPEN_MS;
              circuitOpened = true;
              for (const active of controllers) active.abort();
            }
          }
        } finally {
          controllers.delete(controller);
          job.processed += 1;
          job.updatedAt = now();
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(concurrency, messages.length) }, () => worker()));
    } finally {
      activeSemanticControllers.delete(job.id);
      runTx(() => {
        job.status = job.cancelRequested ? "cancelled" : job.failed || circuitOpened ? "degraded" : "succeeded";
        job.updatedAt = now();
        job.completedAt = job.updatedAt;
        appendEvent?.({
          invocationId: null,
          type: "mail_semantic_classification_completed",
          level: job.status === "succeeded" ? "info" : "warning",
          message: "Mail semantic classification completed.",
          data: {
            actorTeamId: teamIdOf(actor), jobId: job.id, status: job.status,
            processed: job.processed, classified: job.classified, failed: job.failed, cancelled: job.cancelled,
          },
        });
      });
    }
  }

  function persistSemanticResult(message, semantic, actor) {
    const record = persistCandidate(message, actor).record;
    const merged = mergeSemanticClassification(record, semantic);
    const timestamp = now();
    runTx(() => {
      Object.assign(record, merged, {
        stage: "semantic",
        analysisState: "ready",
        semanticFingerprint: mailSemanticFingerprint(message, semanticAdapter),
        reasonCodes: merged === semantic ? ["semantic_local_model"] : [...(record.reasonCodes ?? []), "semantic_guarded_by_header"].slice(0, 8),
        provider: semanticAdapter.providerId,
        model: semanticAdapter.modelVersion ?? semanticAdapter.model,
        revision: record.revision + 1,
        updatedAt: timestamp,
      });
    });
    return record;
  }

  function cancelJob({ jobId, actor = null } = {}) {
    const job = state.mailClassificationJobs.find((row) => row.id === jobId && row.ownerTeamId === teamIdOf(actor));
    if (!job) return { status: 404, body: { error: "mail_classification_job_not_found" } };
    if (TERMINAL_JOB_STATUSES.has(job.status)) return { status: 409, body: { error: "mail_classification_job_not_cancellable", job: publicJob(job) } };
    runTx(() => {
      job.cancelRequested = true;
      job.status = "cancelling";
      job.updatedAt = now();
    });
    for (const controller of activeSemanticControllers.get(job.id) ?? []) controller.abort();
    return { status: 202, body: { job: publicJob(job) } };
  }

  function correct({ message, expectedRevision, attention, mailType, suggestedAction, actor = null } = {}) {
    if (!message) return { status: 404, body: { error: "mail_message_not_found" } };
    const patch = validateMailClassificationPatch({ attention, mailType, suggestedAction });
    if (!patch || !Number.isInteger(expectedRevision) || expectedRevision < 0) {
      return { status: 400, body: { error: "mail_classification_correction_invalid" } };
    }
    const existing = recordFor(message, actor);
    if ((existing && existing.revision !== expectedRevision) || (!existing && expectedRevision !== 0)) {
      return { status: 409, body: { error: "mail_classification_revision_conflict", currentRevision: existing?.revision ?? 0 } };
    }
    const { record } = persistCandidate(message, actor);
    const timestamp = now();
    runTx(() => {
      record.manualOverride = patch;
      record.confirmationState = "corrected";
      record.confirmedAt = timestamp;
      record.confirmedBy = actor?.userId ?? "usr_local";
      record.revision += 1;
      record.updatedAt = timestamp;
      const identity = senderIdentity(message.from);
      if (identity.email) {
        const correction = state.mailClassificationCorrections.find((row) =>
          row.ownerTeamId === teamIdOf(actor) && row.messageKey === record.messageKey,
        );
        if (correction) {
          Object.assign(correction, { accountId: record.accountId, senderEmail: identity.email, senderDomain: identity.domain, target: patch, updatedAt: timestamp });
        } else {
          state.mailClassificationCorrections.unshift({
            id: nextId("mailclscorrection"), ownerTeamId: teamIdOf(actor), messageKey: record.messageKey,
            accountId: record.accountId, messageId: record.messageId, senderEmail: identity.email, senderDomain: identity.domain,
            target: patch, createdAt: timestamp, updatedAt: timestamp,
          });
        }
        capTeamRows(state.mailClassificationCorrections, teamIdOf(actor), MAX_CORRECTIONS_PER_TEAM);
      }
      appendEvent?.({
        invocationId: null,
        type: "mail_classification_corrected",
        level: "info",
        message: "Mail classification was corrected by the user.",
        data: { actorTeamId: teamIdOf(actor), classificationId: record.id, messageKey: record.messageKey },
      });
    });
    return { status: 200, body: { classification: publicMailClassification(record) } };
  }

  function ruleCatalog({ messages = [], actor = null } = {}) {
    const teamId = teamIdOf(actor);
    const rules = state.mailClassificationRules
      .filter((rule) => rule.ownerTeamId === teamId)
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      .map(publicRule);
    return { status: 200, body: { rules, suggestions: buildRuleSuggestions(messages, actor) } };
  }

  function createRule({ messages = [], suggestionId, confirmed = false, actor = null } = {}) {
    if (confirmed !== true || typeof suggestionId !== "string") {
      return { status: 400, body: { error: "mail_classification_rule_confirmation_required" } };
    }
    const suggestion = buildRuleSuggestions(messages, actor).find((item) => item.id === suggestionId);
    if (!suggestion) return { status: 404, body: { error: "mail_classification_rule_suggestion_not_found" } };
    const teamId = teamIdOf(actor);
    const duplicate = state.mailClassificationRules.find((rule) =>
      rule.ownerTeamId === teamId && rule.accountId === suggestion.accountId
      && rule.matchKind === suggestion.matchKind && rule.matchValue === suggestion.matchValue,
    );
    if (duplicate) return { status: 409, body: { error: "mail_classification_rule_exists", rule: publicRule(duplicate) } };
    const timestamp = now();
    const rule = {
      id: nextId("mailclsrule"), ownerTeamId: teamId, status: "active",
      accountId: suggestion.accountId,
      matchKind: suggestion.matchKind, matchValue: suggestion.matchValue, target: suggestion.target,
      sourceSuggestionId: suggestion.id, revision: 1, createdAt: timestamp, updatedAt: timestamp,
    };
    runTx(() => {
      state.mailClassificationRules.unshift(rule);
      capTeamRows(state.mailClassificationRules, teamId, MAX_RULES_PER_TEAM);
      appendEvent?.({
        invocationId: null, type: "mail_classification_rule_enabled", level: "info",
        message: "A personal mail classification rule was enabled.",
        data: { actorTeamId: teamId, ruleId: rule.id, matchKind: rule.matchKind },
      });
    });
    return { status: 201, body: { rule: publicRule(rule) } };
  }

  function updateRule({ ruleId, expectedRevision, action = null, attention, mailType, suggestedAction, actor = null } = {}) {
    const rule = state.mailClassificationRules.find((row) => row.id === ruleId && row.ownerTeamId === teamIdOf(actor));
    if (!rule) return { status: 404, body: { error: "mail_classification_rule_not_found" } };
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      return { status: 400, body: { error: "mail_classification_rule_revision_invalid" } };
    }
    if (rule.revision !== expectedRevision) {
      return { status: 409, body: { error: "mail_classification_rule_revision_conflict", currentRevision: rule.revision } };
    }
    const hasTarget = attention !== undefined || mailType !== undefined || suggestedAction !== undefined;
    const target = hasTarget ? validateMailClassificationPatch({ attention, mailType, suggestedAction }) : null;
    if ((!action && !hasTarget) || (action && !VALID_RULE_ACTIONS.has(action)) || (hasTarget && !target)) {
      return { status: 400, body: { error: "mail_classification_rule_update_invalid" } };
    }
    const nextStatus = action === "pause" ? "paused" : action === "resume" ? "active" : action === "revoke" ? "revoked" : rule.status;
    const timestamp = now();
    runTx(() => {
      rule.status = nextStatus;
      if (target) rule.target = target;
      rule.revision += 1;
      rule.updatedAt = timestamp;
      appendEvent?.({
        invocationId: null, type: "mail_classification_rule_updated", level: "info",
        message: "A personal mail classification rule was updated.",
        data: { actorTeamId: teamIdOf(actor), ruleId: rule.id, status: rule.status, targetChanged: Boolean(target) },
      });
    });
    return { status: 200, body: { rule: publicRule(rule) } };
  }

  function buildRuleSuggestions(messages, actor) {
    const teamId = teamIdOf(actor);
    const corrections = state.mailClassificationCorrections.filter((row) => row.ownerTeamId === teamId && row.senderEmail);
    const existing = new Set(state.mailClassificationRules
      .filter((rule) => rule.ownerTeamId === teamId)
      .map((rule) => `${rule.accountId}\0${rule.matchKind}\0${rule.matchValue}`));
    const candidates = [
      ...consistentCorrectionGroups(corrections, "senderEmail", { minimum: 2, distinctSenders: 1 }).map((group) => ({ ...group, matchKind: "sender" })),
      ...consistentCorrectionGroups(corrections, "senderDomain", { minimum: 3, distinctSenders: 2 }).map((group) => ({ ...group, matchKind: "domain" })),
    ];
    return candidates
      .filter((candidate) => !existing.has(`${candidate.accountId}\0${candidate.matchKind}\0${candidate.matchValue}`))
      .map((candidate) => {
        const affected = messages.filter((message) => {
          const identity = senderIdentity(message.from);
          return candidate.accountId === mailAccountId(message) && ruleMatchesIdentity(candidate, identity) && !recordFor(message, actor)?.manualOverride;
        });
        return {
          id: ruleSuggestionId(teamId, candidate.accountId, candidate.matchKind, candidate.matchValue, candidate.target),
          accountId: candidate.accountId, matchKind: candidate.matchKind, matchValue: candidate.matchValue, target: candidate.target,
          evidenceCount: candidate.evidenceCount, affectedCount: affected.length,
          samples: affected.slice(0, RULE_SAMPLE_LIMIT).map(publicRuleSample),
        };
      })
      .sort((left, right) => right.evidenceCount - left.evidenceCount || left.matchValue.localeCompare(right.matchValue));
  }

  reconcileInterruptedSemanticJobs();

  function reconcileInterruptedSemanticJobs() {
    const interrupted = state.mailClassificationJobs.filter((job) => job.mode === "semantic" && ["queued", "running", "cancelling"].includes(job.status));
    if (!interrupted.length) return;
    runTx(() => {
      for (const job of interrupted) {
        job.status = "interrupted";
        job.updatedAt = now();
        job.completedAt = job.updatedAt;
        job.cancelRequested = false;
      }
    });
  }

  return {
    publicFor, matchesView, summary, qualitySummary, startJob, getJob, correct,
    semanticPreview, startSemanticJob, cancelJob,
    ruleCatalog, createRule, updateRule,
  };
}

function capTeamRows(rows, teamId, max) {
  const own = rows
    .filter((row) => row.ownerTeamId === teamId)
    .sort((left, right) => String(right.updatedAt ?? right.createdAt ?? "").localeCompare(String(left.updatedAt ?? left.createdAt ?? "")))
    .slice(0, max);
  const other = rows.filter((row) => row.ownerTeamId !== teamId);
  rows.splice(0, rows.length, ...own, ...other);
}

function classificationIndexKey(teamId, messageKey) {
  return `${teamId}\0${messageKey}`;
}

function buildClassificationIndex(rows) {
  return new Map((rows ?? []).map((row) => [classificationIndexKey(row.ownerTeamId ?? "team_local", row.messageKey), row]));
}

function publicJob(job) {
  const { ownerTeamId: _ownerTeamId, ...value } = job;
  return value;
}

function publicRule(rule) {
  const { ownerTeamId: _ownerTeamId, sourceSuggestionId: _sourceSuggestionId, ...value } = rule;
  return value;
}

function publicRuleSample(message) {
  return {
    messageId: String(message.messageId ?? "").slice(0, 998),
    from: String(message.from ?? "").slice(0, 998),
    subject: String(message.subject ?? "").slice(0, 400),
    date: message.date ?? null,
  };
}

function senderIdentity(value) {
  const input = String(value ?? "").trim().toLowerCase();
  const angle = input.match(/<([^<>\s]+@[^<>\s]+)>/);
  const plain = input.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  const email = String(angle?.[1] ?? plain?.[0] ?? "").replace(/[>,;]+$/g, "").slice(0, 320);
  const separator = email.lastIndexOf("@");
  const domain = separator > 0 ? email.slice(separator + 1) : "";
  return { email, domain };
}

function ruleMatchesIdentity(rule, identity) {
  return rule.matchKind === "sender"
    ? Boolean(identity.email) && identity.email === rule.matchValue
    : rule.matchKind === "domain" && Boolean(identity.domain) && identity.domain === rule.matchValue;
}

function consistentCorrectionGroups(corrections, field, { minimum, distinctSenders }) {
  const groups = new Map();
  for (const correction of corrections) {
    const value = correction[field];
    if (!value) continue;
    const key = `${correction.accountId ?? "mail"}\0${value}`;
    const rows = groups.get(key) ?? [];
    rows.push(correction);
    groups.set(key, rows);
  }
  const consistent = [];
  for (const [key, rows] of groups) {
    const [accountId, matchValue] = key.split("\0", 2);
    const targets = new Map(rows.map((row) => [classificationPatchKey(row.target), row.target]));
    const senders = new Set(rows.map((row) => row.senderEmail));
    if (rows.length >= minimum && senders.size >= distinctSenders && targets.size === 1) {
      consistent.push({ accountId, matchValue, target: targets.values().next().value, evidenceCount: rows.length });
    }
  }
  return consistent;
}

function classificationPatchKey(patch) {
  return `${patch?.attention ?? ""}\0${patch?.mailType ?? ""}\0${patch?.suggestedAction ?? ""}`;
}

function ruleSuggestionId(teamId, accountId, matchKind, matchValue, target) {
  return `mailrulesug_${createHash("sha256")
    .update(`${teamId}\0${accountId}\0${matchKind}\0${matchValue}\0${classificationPatchKey(target)}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function mailAccountId(message) {
  return String(message?.applicationId ?? "mail").slice(0, 160);
}

function semanticEligibleMessages(messages) {
  return (messages ?? [])
    .filter((message) => message?.fetched === true && typeof message.body === "string" && message.body.trim())
    .sort((left, right) => String(right.date ?? "").localeCompare(String(left.date ?? "")));
}

function boundedSemanticLimit(value) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.min(MAX_SEMANTIC_MESSAGES, Math.max(1, number)) : 20;
}

function mailSemanticFingerprint(message, adapter) {
  return createHash("sha256")
    .update(mailHeaderFingerprint(message))
    .update("\0")
    .update(String(message?.body ?? "").slice(0, 8_000))
    .update("\0")
    .update(String(adapter?.modelVersion ?? adapter?.model ?? "unknown").slice(0, 200))
    .digest("hex");
}

function mergeSemanticClassification(header, semantic) {
  const deterministic = header?.headerClassification ?? header;
  const protectedHeaderSignal = (deterministic?.confidence >= 0.9 && (deterministic.reasonCodes ?? []).some((reason) => [
    "account_security_language",
    "calendar_language",
    "mailing_list_header",
  ].includes(reason))) || (deterministic?.confidence >= 0.85 && ["action_required", "reply_expected"].includes(deterministic.attention));
  if (protectedHeaderSignal || semantic.confidence < 0.6) {
    return {
      attention: deterministic.attention,
      mailType: deterministic.mailType,
      suggestedAction: deterministic.suggestedAction,
      confidence: deterministic.confidence,
      explanation: deterministic.explanation,
    };
  }
  return semantic;
}
