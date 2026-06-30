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
- Does Testing skills evidence match the change type and risk?
- Does scope drift evidence show the diff stayed inside the code plan, or is
  an override justified?
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
- Testing evidence is proportional to risk:
  - Web changes include visual QA evidence.
  - Desktop/local execution changes include cross-platform execution and
    cancellation evidence or a recorded gap.
  - Protocol changes include state-machine or schema compatibility evidence.
  - Adapter changes include success, failure, cancellation, and redaction
    evidence.
  - Release changes include release, deploy preflight, and rollback evidence.
- New risks are filed.
- The implementation does not silently broaden M0.
- Project fields and labels are accurate.

## Automated Risk Routing

Pull request governance enforces the baseline requirements that a PR links or
closes an issue and lists verification evidence. Risk-specific routes are
advisory warnings until a later issue promotes them to required checks.

Current advisory routes:

- Web UI files should mention visual QA screenshot evidence.
- Desktop Bridge or local execution files should mention cross-platform
  execution and cancellation evidence.
- Protocol or state-machine files should mention schema or compatibility
  evidence.
- Adapter files should mention success, failure, cancellation, or redaction
  evidence.
- Security, data, billing, credential, cost, or audit files should mention the
  relevant review evidence.
- Release or deploy files should mention release, rollback, deploy preflight,
  and human approval evidence.

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

- Does the PR cite
  [PRODUCT_FLOWS.md](../design/PRODUCT_FLOWS.md)?
- Which role flow applies: ordinary developer, advanced developer, team
  administrator, auditor, or an explicit multi-role combination?
- Does the change preserve the separation between high-frequency tasks,
  low-frequency configuration, governance evidence, and advanced controls?
- Are the relevant usability task and four acceptance signals covered?
- Is the role-specific "what not to show" list respected?
- Is partial acceptance or follow-up work stated when a role/state is not yet
  covered?
- Is the first screen a usable task workspace rather than a landing page?
- Can a non-professional user tell what will happen before running the task?
- Are device, agent, safety, data, cost, cancellation, and audit visible in
  plain language?
- Are expert details available without dominating the primary flow?
- Does the change follow
  [MYAGENTTOOL_DESIGN.md](../design/MYAGENTTOOL_DESIGN.md)?
- Was PM/design framing recorded through
  [PM_DESIGN_SKILLS.md](PM_DESIGN_SKILLS.md) or an issue linked to it?
- Is visual QA evidence attached when layout or copy changed, following
  [VISUAL_QA.md](VISUAL_QA.md)?

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
- Testing skills evidence or scope drift evidence is missing for AI-generated
  or agent-written work.
- High-risk behavior lacks audit or rollback notes.
- Billing or data handling is ambiguous.
- The linked issue or source doc contradicts the implementation.

`pnpm github:check:pr` runs PR risk gates in advisory mode by default. For
high-risk branches or CI jobs that should block on missing evidence, run:

```text
pnpm github:check:pr -- --fail-on-risk-warnings
```

The same fail mode can be enabled with `MYAGENTTOOL_PR_RISK_GATE_FAIL=true`.
Evidence must name the relevant route and artifact or review result; generic
words such as `artifact`, `data`, or `release` are not enough for high-risk
visual, security/data/billing, or release/deploy routes.
