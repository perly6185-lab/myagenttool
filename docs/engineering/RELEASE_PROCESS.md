# Release Process

This document defines the target release process.

The release process should make it clear what shipped, what changed, what risks
remain, and how to roll back.

## Release Types

### Documentation Release

Changes only docs, issue templates, workflows, or project management artifacts.

Required:

- Markdown checks pass.
- Links are valid.

### Server Release

Changes API, auth, registry, gateway, queue, audit, billing, or project
automation.

Required:

- Server tests pass.
- Migration notes exist if schema changes.
- Rollback notes exist if deployment behavior changes.

### Web Release

Changes account, device, agent, invocation, audit, billing, or UX flows.

Required:

- UI checks pass.
- E2E smoke path passes when available.
- User-facing copy remains understandable.

### Desktop Bridge Release

Changes local execution, device linking, discovery, adapters, credentials,
process handling, or cancellation.

Required:

- Cross-platform test evidence.
- Security review.
- Local execution permission review.
- Rollback or downgrade path.

Desktop artifact targets, credential names, manual distribution authority, and
platform rollback evidence are defined in
[`DESKTOP_RELEASE_CONTRACT.md`](DESKTOP_RELEASE_CONTRACT.md). Passing its
credential preflight does not authorize signing, notarization, upload, or
publication.

### Protocol Release

Changes shared schemas, invocation messages, events, or state transitions.

Required:

- Compatibility notes.
- Contract tests.
- Migration plan for older Desktop Bridge versions.

## Versioning

Use semantic versioning once application code exists:

```text
MAJOR.MINOR.PATCH
```

Recommended interpretation:

- MAJOR: incompatible protocol or deployment changes.
- MINOR: new capabilities.
- PATCH: fixes and safe internal changes.

Desktop Bridge and server compatibility should be tracked explicitly.

Until packaged application artifacts exist, documentation previews may use a
PR number, branch name, or date-based identifier. Production, staging, server,
web, desktop, and protocol releases must use an explicit `--version` so rollback
evidence can point to the previous artifact.

### Applied policy (since v0.1.0, #256)

- The **root `package.json` version is the product version**; workspace
  packages stay `0.0.0`/private (internal, released only as part of the
  product).
- Pre-1.0 interpretation: **MINOR** marks a completed capability line (e.g.
  0.1.0 = the measured-and-enforced delivery-OS line), **PATCH** marks fixes.
  MAJOR stays 0 until the control plane serves users beyond its own
  development.
- Every release gets a git tag `vX.Y.Z`, a notes file under `docs/releases/`
  (release notes AND rollback notes in one place, merged through the PR gate
  before tagging), and a GitHub Release pointing at the tag.

## Release Checklist

Before release:

- Linked issues are closed or clearly deferred.
- Acceptance criteria are verified.
- Tests pass.
- `pnpm release:candidate` passes on Windows, macOS, and Linux and each runner
  uploads its `.myagenttool/release-candidate/*.json` evidence manifest.
- Candidate evidence covers descriptor compatibility, allowlist-only binary
  readiness, strict approvals and bounded recovery, versioned economics,
  reconnect/liveness, quota refusal, and explicit missing-binary refusal.
- A missing, stale, or failed platform manifest blocks release; do not replace a
  failed platform with a local-only assertion.
- Known limitations are listed.
- Security, data, billing, and audit impact is reviewed.
- Rollback notes exist.
- Release notes are drafted.

## Release Notes

Release notes should include:

- Summary.
- Shipped issues.
- User-visible changes.
- Security or data changes.
- Billing or cost changes.
- Breaking changes.
- Known limitations.
- Rollback notes.

Use the local draft command before human review:

```text
pnpm release:draft
pnpm release:retrospective -- --pr 123
pnpm release:draft -- --pr 123 --evidence-file .myagenttool/runs/release-evidence.json
```

The command prints a draft from the current branch PR when GitHub access is
available. It does not publish a release.

Release notes should reference retrospective evidence when feedback, demo notes,
support signals, or rollback decisions influenced the release.

Release evidence can be supplied as JSON or Markdown. JSON manifests may use:

```json
{
  "pr": ["https://github.com/OWNER/REPO/pull/123"],
  "deploy": [".myagenttool/deploy-runs/...evidence.json"],
  "feedback": [".myagenttool/runs/demo-feedback.md"],
  "retrospective": [".myagenttool/runs/release-retrospective.md"]
}
```

When evidence is missing, release draft and retrospective output must say so
explicitly rather than hiding the gap behind TODO-only text.

For deployment planning, use:

```text
pnpm deploy:plan -- --target docs --environment preview
pnpm deploy:preflight -- --target web --environment staging
pnpm deploy:publish -- --target web --environment production
```

`deploy:publish` is dry-run by default. Real deployment requires `--apply`,
environment approval, and either the built-in `docs/preview` adapter or a
configured `MYAGENTTOOL_DEPLOY_COMMAND_JSON` adapter.

Production also requires `MYAGENTTOOL_DEPLOY_APPROVED=true`. In GitHub Actions
this should come from an explicit environment secret, not from the workflow
input alone.

## Retrospective

After a release, preview, or product demo, record:

- What shipped.
- What failed checks, confused users, or created support risk.
- Feedback source and evidence.
- Rollback needs.
- Follow-up issues or risks.
- Telemetry/support signals used.

Use:

```text
pnpm release:retrospective -- --pr 123 --feedback-file feedback.md
pnpm release:retrospective -- --pr 123 --evidence-dir .myagenttool/deploy-runs
pnpm ai:feedback -- --feedback "..." --target bug --issue-tree
pnpm ai:issue-tree -- --brief-file .myagenttool/runs/feedback-brief.json --repo OWNER/REPO
```

`ai:feedback --issue-tree` creates a governed PM brief JSON that can feed
`ai:issue-tree` dry-run/apply. Apply still requires explicit approval and normal
issue governance.

## Telemetry And Support Signals

Allowed before product launch:

- Manual demo notes.
- Issue comments and PR review notes.
- Release and deploy workflow logs.
- Local smoke output.
- User-supplied screenshots or log excerpts with sensitive data removed.

Not allowed before product launch:

- Silent product telemetry.
- Unapproved personal data collection.
- Broad local log uploads.
- Production monitoring or support automation claims without source-doc review.
- Billing, quota, chargeback, or support escalation automation without explicit
  issue and human approval.

## Rollback

Every release should answer:

- Can the server be rolled back?
- Can database migrations be reversed or tolerated?
- Can the Desktop Bridge downgrade?
- Are queued invocations compatible?
- Are protocol messages backward compatible?
- What happens to running local work?

## Human Approval Required

Human approval is required for:

- Production deployment.
- Desktop Bridge distribution.
- Billing behavior changes.
- Data retention changes.
- Local execution permission changes.
- Public extension release.

## AI Role

AI may:

- Generate release notes.
- Generate release note drafts with `pnpm release:draft`.
- Summarize merged PRs.
- Identify missing rollback notes.
- Check issue and Project status.
- Propose a release checklist.

AI must not:

- Release production without approval.
- Hide failed checks.
- Mark risky behavior as resolved without evidence.
