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

## Release Checklist

Before release:

- Linked issues are closed or clearly deferred.
- Acceptance criteria are verified.
- Tests pass.
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
```

The command prints a draft from the current branch PR when GitHub access is
available. It does not publish a release.

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
