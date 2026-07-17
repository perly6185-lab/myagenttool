// #1147 (#979, ADR 0014): app_gmail_send — the write-credential Application that
// holds send authority. A SEPARATE registration beside app_gmail (ADR 0014
// invariant 3): two credentials, two consents, two lifecycle rows — revoking
// send never degrades read intake.
//
// The single `send` facade is gate-only (`directInvocation: false`): execution
// happens exclusively through the mail-send server gate, which resolves every
// outbound field from a review-confirmed draftbox row. There is no path on
// which caller-supplied text reaches the wire.

export const GMAIL_SEND_APPLICATION_ID = "app_gmail_send";
export const GMAIL_SEND_SCOPE = "gmail.send";

export function createGmailSendApplicationRegistration({ agentId, autoOnline = false, projectId = null } = {}) {
  if (!agentId) {
    throw new Error("A Gmail send Application registration requires the id of the registered mail send agent.");
  }
  return {
    id: GMAIL_SEND_APPLICATION_ID,
    name: "Gmail (send)",
    kind: "external",
    autoOnline,
    projectId,
    source: {
      type: "manual",
      // ADR 0014 invariant 1: the write class is explicit and justified.
      credential: {
        provider: "google",
        scope: GMAIL_SEND_SCOPE,
        write: true,
        justification: "Outbound mail is the #979 exfiltration boundary (ADR 0011 rule 4): a reviewed reply, sent in the owner's name, needs send authority that must never share a credential with read intake.",
      },
      manifest: {
        description: "Sends a review-confirmed reply draft through the mail agent. Gate-only: the server resolves every outbound field from the draftbox.",
      },
    },
    capabilityFacades: [
      {
        id: "send",
        agentId,
        agentToolName: "mail_send",
        displayName: "Send confirmed reply draft",
        description: "Send ONE review-confirmed draftbox draft. Input is a draft id; recipient, subject, threading headers, and body are resolved server-side from the confirmed draft — never from the caller.",
        riskLevel: "high",
        // ADR 0014 invariant 2: approval is the floor for write authority.
        requiresApproval: true,
        // ADR 0014: gate-only. Direct capability invocation refuses; the
        // mail-send gate (POST /api/mail/drafts/:id/send) is the only path.
        directInvocation: false,
        riskTags: ["external_send", "write_credential", "local_agent"],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["draftId"],
          properties: { draftId: { type: "string" } },
        },
        outputCollection: "invocations",
      },
    ],
  };
}
