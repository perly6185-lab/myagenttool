# ADR 0028: Mail semantic classification is an explicit local, read-only analysis boundary

- Status: Accepted
- Date: 2026-08-17
- Extends: [ADR 0011](ADR_0011_MAIL_UNTRUSTED_INPUT.md), [ADR 0027](ADR_0027_MANAGED_MAIL_ARCHIVE.md)
- Source plan: [Mail classifier plan](MAIL_CLASSIFIER_PLAN.md)

## Context

Header-only rules are fast and safe but cannot reliably distinguish a direct request from an informational conversation when the subject is vague. A semantic classifier can improve that result only by reading attacker-controlled mail bodies. That creates a prompt-injection and privacy boundary even though classification itself has no intended side effect.

ADR 0011 already establishes that mail is data, never instruction, and that sending is the exfiltration boundary. This decision defines the narrower conditions under which an optional classifier may inspect a body without acquiring authority over mail or the rest of the system.

## Decision

### 1. Deep organization is explicit and local-only

Semantic classification is disabled unless a user configures a loopback HTTP model and explicitly confirms a deep-organization run. The adapter accepts only `http://127.0.0.1`, `http://localhost`, or `http://[::1]`, rejects credentials in URLs and redirects, and sends no authorization secret.

External model endpoints are not supported by this decision. Adding one requires a new data-boundary decision and consent UI that names the provider, fields sent, retention position, and expected cost.

### 2. Only already-opened cached bodies are eligible

The server may submit only bounded text already present in the mailbox read model after an explicit user fetch. Deep organization must not fetch unread or unopened mail, MIME originals, remote images, attachments, or attachment names. The confirmation view shows the exact eligible count and makes this boundary clear.

### 3. The model has one fixed, tool-free task

The request envelope names `mail_semantic_classification_v1` and labels the body as untrusted data. It contains bounded sender, subject, and plain text plus the deterministic header result. It contains no system credentials, local paths, archive references, HTML, attachment metadata, or arbitrary tool definitions.

The adapter has no tool interface. Its output is parsed through closed enums and bounded scalar fields; unknown keys have no effect. Model prose can explain a classification but can never become an instruction, draft, task, provider mutation, or capability invocation.

### 4. Header results are the mandatory fallback

Timeout, malformed output, cancellation, unavailable configuration, budget refusal, or circuit opening leaves the deterministic header classification usable. Completed semantic results may be kept when a later item fails. Three consecutive provider failures open a 30-second in-memory circuit; retry is explicit.

Manual corrections always outrank both classifiers and are never overwritten. A semantic result changes only classification fields and audit metadata.

### 5. Jobs are bounded, visible, cancellable, and tenant-scoped

One run processes at most 50 eligible messages with concurrency at most two. Jobs expose counts and terminal state without subjects, senders, bodies, model output, or tenant identifiers. Cancellation aborts active requests and preserves completed classifications. Persisted non-terminal jobs are marked interrupted after restart and may be retried explicitly.

Metrics and events contain only counts, durations, provider/model identifiers, and stable opaque message keys. They never contain mail content.

## Consequences

- Users can improve vague classifications without bulk-downloading the mailbox or sending data off-device.
- A local model must expose the fixed JSON contract; when absent, the ordinary mailbox and header classifier remain complete.
- Classification quality is limited to previously opened messages and bounded plain text. This is deliberate.
- External providers, attachment analysis, automatic rules, and every mail side effect remain out of scope.

## Rejected alternatives

- **Automatically analyze every new body:** rejected because it silently expands header sync into hostile-content download and model processing.
- **Allow any HTTPS model URL:** rejected because “HTTPS” does not establish user consent, retention, jurisdiction, or cost boundaries.
- **Give the classifier mail tools:** rejected because classification needs no authority and model output must not create a side-effect path.
- **Treat prompt injection as a hard failure:** rejected because an attacker could then suppress classification; the fixed output parser and absence of tools contain the risk without making the marker a denial-of-service primitive.
