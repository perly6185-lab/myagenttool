/*
 * #1147 (#979, ADR 0014): the mail send GATE — the exfiltration boundary made
 * executable, on exactly the ADR 0011 rule-4 terms. One reviewed click sends
 * ONE review-confirmed draft; nothing else can go out.
 *
 * Ordered gates, all before dispatch (each refusal is a coded, precise answer):
 *   1. feature flag        — MYAGENTTOOL_MAIL_SEND_ENABLED, default OFF
 *   2. draft binding       — the draftbox row exists (tenancy-scoped), is
 *                            status "draft" (single-use: sent/sending/
 *                            send_unconfirmed rows refuse), fields present
 *   3. application + agent — one provider-matched send Application registered
 *                            + credential authorized, and its agent allowlisting
 *                            mail_send (resolved BEFORE the grant burns)
 *   4. approval            — a single-use grant bound to (mail.send, draftId)
 *
 * The outbound payload is resolved from the draft row only — to/subject/
 * threading/body. The caller supplies a draft id and a grant; free-form
 * outbound content is structurally impossible (the apply gate's stored-artifact
 * rule, applied to mail).
 *
 * Crash model: a dispatch that dies after the grant burned resolves the draft
 * to "send_unconfirmed" — LOUD, terminal-pending-human (mail may or may not
 * have left; only the mailbox knows). Never silently sent, never silently lost,
 * and no automatic path back to sendable.
 */

import { makeRunTx } from "../runtime/store/run-tx.mjs";
import { mailSendApprovalTarget } from "./mailbox.mjs";

export const MAIL_SEND_ACTION = "mail.send";

export function isMailSendEnabled() {
  return process.env.MYAGENTTOOL_MAIL_SEND_ENABLED === "1";
}

export function createMailSendService({
  state,
  now,
  nextId = (prefix) => `${prefix}_${Date.now()}`,
  appendEvent,
  persistStateSoon = () => {},
  store,
  validateApprovalToken = null,
  createInvocation = null,
  startInvocationIfAllowed = null,
  findAgent = null,
  findApplication = null,
}) {
  const runTx = makeRunTx({ store, persistStateSoon });

  function findDraft(draftId, actor) {
    const draft = (state.mailDrafts ?? []).find((item) => item.id === String(draftId ?? "")) ?? null;
    if (!draft) return null;
    if (actor?.teamId && draft.ownerTeamId && draft.ownerTeamId !== actor.teamId) return null;
    return draft;
  }

  function sendConfirmedDraft({ draftId, approvalToken, actor = null } = {}) {
    if (!isMailSendEnabled()) {
      return { ok: false, status: 403, body: { error: "mail_send_disabled", message: "Mail send is disabled. Set MYAGENTTOOL_MAIL_SEND_ENABLED=1 to enable it (ADR 0014 invariant 4)." } };
    }
    const draft = findDraft(draftId, actor);
    if (!draft) {
      return { ok: false, status: 404, body: { error: "mail_draft_not_found", draftId: String(draftId ?? "") } };
    }
    if (draft.status !== "draft") {
      // Single-use by state: "sent" and "sending" refuse; "send_unconfirmed"
      // refuses too — only a human who checked the mailbox may decide what next,
      // and no automated path exists to flip it back.
      return { ok: false, status: 409, body: { error: "mail_draft_not_sendable", status: draft.status, draftId: draft.id } };
    }
    if (!draft.to || !draft.body) {
      return { ok: false, status: 409, body: { error: "mail_draft_incomplete", draftId: draft.id } };
    }
    const application = findSendApplication(state.applications ?? [], draft, findApplication);
    if (!application || !["registered", "active"].includes(application.status)) {
      return { ok: false, status: 409, body: { error: "send_application_not_available", message: "No active send application is available for this mailbox." } };
    }
    // Credential readiness (ADR 0010): fail closed — send authority must be
    // explicitly authorized on the device before anything can go out.
    const credentialStatus = application.credentialReadiness?.status ?? null;
    if (credentialStatus !== "authorized") {
      return { ok: false, status: 409, body: { error: "send_credential_not_ready", status: credentialStatus ?? "unreported", message: "The gmail.send credential is not authorized on the device." } };
    }
    const facade = (application.capabilityFacades ?? []).find((item) => item.id === "send" && item.agentId) ?? null;
    const agent = facade && typeof findAgent === "function" ? findAgent(facade.agentId) : null;
    if (!facade || !agent || agent.status === "disabled") {
      // Resolve the runner BEFORE the grant burns (the apply gate's rule): a
      // grant that cannot be executed must not be consumed.
      return { ok: false, status: 409, body: { error: "agent_not_available", message: "The mail send agent is not available." } };
    }
    const allowedTools = Array.isArray(agent.adapter?.allowedTools) ? agent.adapter.allowedTools : [];
    const toolName = facade.agentToolName ?? "mail_send";
    if (allowedTools.length > 0 && !allowedTools.includes(toolName)) {
      return { ok: false, status: 409, body: { error: "agent_tool_not_allowlisted", agentId: agent.id, toolName } };
    }
    if (typeof validateApprovalToken !== "function") {
      // Fail closed, like the apply gate: a missing validator must never
      // authorize the exfiltration boundary.
      return { ok: false, status: 409, body: { error: "approval_required", reason: "approval_validator_unavailable" } };
    }
    // allowLegacy: false — the phase-1 migration fallback (any non-empty string
    // passes as legacy_token) must never open the exfiltration boundary. Send
    // takes a REAL single-use grant or nothing.
    // User-authored drafts are editable, so their grant binds to the current
    // revision. A draft changed after review cannot reuse the old grant. Legacy
    // reviewed-reply drafts have no revision and retain the historical id target.
    const approvalTarget = mailSendApprovalTarget(draft);
    const approval = validateApprovalToken(approvalToken, { action: MAIL_SEND_ACTION, targetId: approvalTarget, actor, allowLegacy: false });
    if (!approval.approved) {
      return { ok: false, status: 409, body: { error: "approval_required", reason: approval.reason ?? "grant_required" } };
    }
    if (typeof createInvocation !== "function") {
      return { ok: false, status: 409, body: { error: "send_dispatch_unavailable", message: "The send dispatch path is not wired." } };
    }
    // The outbound payload: draft fields ONLY. Nothing here came from this call.
    const toolArguments = {
      to: draft.to,
      subject: draft.subject ?? "(no subject)",
      inReplyTo: draft.inReplyTo ?? null,
      references: Array.isArray(draft.references) ? draft.references : [],
      body: draft.body,
      attachments: Array.isArray(draft.attachments)
        ? draft.attachments.map(({ ref, name, contentType, size }) => ({ ref, name, contentType, size }))
        : [],
    };
    const invocation = createInvocation(`Send confirmed mail draft ${draft.id} to ${draft.to}.`, agent, {
      actor,
      requestedBy: actor?.userId,
      toolName,
      toolArguments,
      metadata: {
        capability: `app.${application.id}.${facade.id}`,
        providerType: "application",
        applicationId: application.id,
        applicationAction: `agent:${agent.id}:${toolName}`,
        mailSendDraftId: draft.id,
      },
      timeoutSeconds: 120,
    });
    return runTx(() => {
      // Admission gates can reject the dispatch synchronously (audit find,
      // 2026-07-16): a rejected run never completes, so resolve the draft NOW.
      if (invocation.status === "rejected" || ["failed", "cancelled", "timed_out"].includes(invocation.status)) {
        draft.status = "send_unconfirmed";
        draft.sendError = `send dispatch was ${invocation.status} at creation (${invocation.result?.errorCode ?? "admission gate"})`;
        draft.sendInvocationId = invocation.id;
        recordPackageSendOutcome(draft, "send_unconfirmed", { invocationId: invocation.id, error: draft.sendError, at: now() });
        appendEvent({
          invocationId: invocation.id,
          type: "mail_send_unconfirmed",
          level: "warn",
          message: `Send dispatch for draft ${draft.id} was ${invocation.status} at creation; the grant is burned and the draft needs a human decision.`,
          data: { draftId: draft.id, grantId: approval.grantId ?? null },
        });
        return { ok: false, status: 409, body: { error: "send_dispatch_rejected", draftId: draft.id, status: draft.status } };
      }
      draft.status = "sending";
      draft.sendInvocationId = invocation.id;
      draft.sendGrantId = approval.grantId ?? null;
      draft.sendRequestedAt = now();
      draft.send = { available: false, inFlight: true };
      appendEvent({
        invocationId: invocation.id,
        type: "mail_send_dispatched",
        level: "info",
        message: `Dispatched confirmed draft ${draft.id} to ${draft.to} (grant ${approval.grantId ?? "legacy"}); awaiting the provider receipt.`,
        data: { draftId: draft.id, to: draft.to, issueNumber: draft.provenance?.issueNumber ?? null, grantId: approval.grantId ?? null },
      });
      if (typeof startInvocationIfAllowed === "function") {
        startInvocationIfAllowed(invocation, agent);
      }
      return { ok: true, status: 202, body: { status: "sending", draftId: draft.id, sendInvocationId: invocation.id } };
    });
  }

  // Completion fold: the provider receipt (or its absence) resolves the draft.
  // Runs for every terminal status — a result-less terminal reads
  // send_unconfirmed, never sent.
  function recordMailSendResult({ invocation, result }) {
    const draftId = invocation?.options?.metadata?.mailSendDraftId ?? null;
    if (!draftId) return null;
    const draft = (state.mailDrafts ?? []).find((item) => item.id === draftId) ?? null;
    if (!draft || draft.status !== "sending") return null;
    return runTx(() => {
      const output = result?.output ?? null;
      const receiptId = stringOrNull(output?.sentMessageId ?? output?.messageId ?? output?.id);
      if (invocation.status === "succeeded" && receiptId) {
        draft.status = "sent";
        draft.sentAt = now();
        draft.sendError = null;
        draft.receipt = { providerMessageId: receiptId, at: draft.sentAt };
        draft.send = { available: false, executed: true };
        recordPackageSendOutcome(draft, "sent", { providerMessageId: receiptId, invocationId: invocation.id, at: draft.sentAt });
        appendEvent({
          invocationId: invocation.id,
          type: "mail_send_completed",
          level: "info",
          message: `Draft ${draft.id} sent; provider receipt ${receiptId}.`,
          data: { draftId: draft.id, providerMessageId: receiptId, issueNumber: draft.provenance?.issueNumber ?? null },
        });
      } else if (invocation.status === "succeeded" || invocation.status === "failed") {
        // A run that ANSWERED but produced no receipt (or answered failure):
        // the provider refused before anything left. The draft returns to
        // sendable — a retry needs a fresh grant.
        const refused = invocation.status === "failed" || output?.sent === false;
        if (refused && !receiptId) {
          draft.status = "draft";
          draft.sendError = stringOrNull(output?.error ?? result?.summary) ?? "the send agent reported failure";
          draft.send = { available: false, requires: ["approval (single-use grant per attempt)"] };
          recordPackageSendOutcome(draft, "send_failed", { invocationId: invocation.id, error: draft.sendError, at: now() });
          appendEvent({
            invocationId: invocation.id,
            type: "mail_send_failed",
            level: "warn",
            message: `Sending draft ${draft.id} failed before the wire (${draft.sendError}); the draft is sendable again with a fresh grant.`,
            data: { draftId: draft.id },
          });
        } else {
          // Succeeded but the receipt shape is unrecognizable — the mailbox is
          // the only truth. Loud, no automatic retry.
          markSendUnconfirmed(draft, invocation, "the send run completed without a recognizable receipt");
        }
      } else {
        // timed_out / cancelled / anything result-less after the grant burned.
        markSendUnconfirmed(draft, invocation, `the send run ${invocation.status ?? "terminated"} without a receipt`);
      }
      return draft;
    });
  }

  // Deny bypasses completion (same as the apply gate) — reconcile here.
  function reconcileMailSendTermination(invocation) {
    const draftId = invocation?.options?.metadata?.mailSendDraftId ?? null;
    if (!draftId) return null;
    const draft = (state.mailDrafts ?? []).find((item) => item.id === draftId) ?? null;
    if (!draft || draft.status !== "sending") return null;
    return runTx(() => {
      markSendUnconfirmed(draft, invocation, `the send run was ${invocation?.status ?? "terminated"} before completion`);
      return draft;
    });
  }

  function markSendUnconfirmed(draft, invocation, reason) {
    draft.status = "send_unconfirmed";
    draft.sendError = reason;
    recordPackageSendOutcome(draft, "send_unconfirmed", { invocationId: invocation?.id ?? null, error: reason, at: now() });
    appendEvent({
      invocationId: invocation?.id ?? null,
      type: "mail_send_unconfirmed",
      level: "warn",
      message: `Draft ${draft.id} is UNCONFIRMED (${reason}); check the mailbox before deciding — mail may or may not have left. No automatic retry exists.`,
      data: { draftId: draft.id },
    });
  }

  function recordPackageSendOutcome(draft, status, receipt) {
    const packageId = draft?.provenance?.packageId ?? null;
    if (!packageId) return;
    const responsePackage = (state.mailResponsePackages ?? []).find((item) => item.id === packageId) ?? null;
    if (!responsePackage || responsePackage.workItemId !== draft.provenance?.workItemId) return;
    responsePackage.status = status;
    responsePackage.sendReceipt = receipt;
    responsePackage.revision = Number(responsePackage.revision ?? 0) + 1;
    responsePackage.updatedAt = receipt.at;
    (state.workItemActivities ??= []).unshift({
      id: nextId("wia"), workItemId: responsePackage.workItemId, ownerTeamId: responsePackage.ownerTeamId,
      projectId: (state.workItems ?? []).find((item) => item.id === responsePackage.workItemId)?.projectId ?? null,
      action: `mail_${status}`, actorId: draft.createdBy ?? null, createdAt: receipt.at,
      details: { packageId, draftId: draft.id, receipt },
    });
  }

  return { sendConfirmedDraft, recordMailSendResult, reconcileMailSendTermination };
}

function findSendApplication(applications, draft, findApplication) {
  const provider = String(draft?.provider ?? "").toLowerCase();
  const candidates = applications
    .filter((application) => !application.successorApplicationId && ["registered", "active"].includes(application.status))
    .filter((application) => (application.capabilityFacades ?? []).some((facade) => facade.id === "send" && (facade.agentToolName ?? facade.toolName) === "mail_send"))
    .filter((application) => !provider || String(application.source?.credential?.provider ?? "").toLowerCase() === provider);
  const selected = candidates.length === 1 ? candidates[0] : candidates.find((application) => application.id === "app_gmail_send") ?? null;
  return selected && typeof findApplication === "function" ? findApplication(selected.id) : selected;
}

function stringOrNull(value) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}
