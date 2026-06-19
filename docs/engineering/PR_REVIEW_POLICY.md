# Pull Request Review Policy

This document defines how AI review and human review should work together.

## Review Goals

PR review should protect:

- User trust.
- Local machine safety.
- Data ownership and privacy.
- Billing correctness.
- State machine integrity.
- Cross-platform behavior.
- Non-professional-user clarity.

## AI Self-Review

Before asking for human review, AI should check:

- Does the PR satisfy the linked issue acceptance criteria?
- Are tests present and relevant?
- Are failure paths handled?
- Does the change alter local execution, permissions, cancellation, billing, or
  data retention?
- Are user-facing strings understandable without expert knowledge?
- Are docs updated when behavior changes?
- Are deferred risks recorded?

## Human Review Required

Human review is required for:

- Architecture decisions.
- Security-sensitive changes.
- Billing, quota, settlement, or chargeback changes.
- Desktop Bridge local execution behavior.
- Agent installation, enable, disable, update, or uninstall behavior.
- Data retention or deletion behavior.
- Production deployment.
- Public extension distribution.

## Review Checklist

Every reviewer should check:

- Scope matches the issue.
- Acceptance criteria are covered.
- Tests or verification are credible.
- New risks are filed.
- The implementation does not silently broaden M0.
- Project fields and labels are accurate.

## High-Risk PR Checklist

Use this for security, billing, desktop, and local execution changes:

- What could happen if the operation is repeated?
- What could happen if the bridge disconnects?
- What could happen if cancellation fails?
- What local resources are accessed?
- What user data leaves the device?
- What costs can be incurred?
- What audit evidence is recorded?
- What is the rollback path?

## Product And Design Checklist

Use this for Web Console, onboarding, task flow, and demo experience changes:

- Is the first screen a usable task workspace rather than a landing page?
- Can a non-professional user tell what will happen before running the task?
- Are device, agent, safety, data, cost, cancellation, and audit visible in
  plain language?
- Are expert details available without dominating the primary flow?
- Does the change follow
  [MYAGENTTOOL_DESIGN.md](../design/MYAGENTTOOL_DESIGN.md)?
- Was PM/design framing recorded through
  [PM_DESIGN_SKILLS.md](PM_DESIGN_SKILLS.md) or an issue linked to it?
- Is visual QA evidence attached when layout or copy changed?

## AI Review Output Format

AI review should lead with findings.

Recommended format:

```text
Findings
- [severity] file:line - issue

Open Questions
- ...

Verification
- ...
```

If there are no findings, say so clearly and list remaining test gaps or
residual risk.

## Merge Rule

Do not merge when:

- Acceptance criteria are not met.
- Required tests are missing.
- High-risk behavior lacks audit or rollback notes.
- Billing or data handling is ambiguous.
- The linked issue or source doc contradicts the implementation.
