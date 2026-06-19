# Deployment Pipeline

This document defines the first deploy and release pipeline for MyAgentTool.

The current product is not ready for unattended production release. The pipeline
therefore focuses on repeatable preflight checks, release evidence, environment
approval, and a deploy adapter boundary.

## Environments

### Preview

Preview is used for PR or branch validation.

Required:

- CI passes.
- Governance checks pass.
- Release/deploy tooling checks pass when deployment behavior changes.

### Staging

Staging is used before production or desktop distribution.

Required:

- Release draft exists.
- Deployment plan exists.
- Rollback notes exist.
- Owner approval is recorded.

### Production

Production is the public or customer-facing release path.

Required:

- GitHub environment approval.
- Human release owner approval.
- Required checks passed.
- Rollback plan is explicit.
- Security, data, cost, local execution, and billing impact are reviewed.

## Deployment Adapter

Command:

```text
pnpm deploy:publish -- --target web --environment staging --apply
```

`deploy:publish` is dry-run by default. Real deployment requires:

- `--apply`.
- `MYAGENTTOOL_DEPLOY_COMMAND` configured.
- Passing preflight checks.

The adapter command receives `MYAGENTTOOL_DEPLOY_CONTEXT`, a JSON file with:

- Target.
- Environment.
- Version.
- Branch.
- Head commit.
- Repository.
- Created timestamp.

This keeps the core repo independent of one cloud vendor while still allowing a
real deployment command to be plugged in later.

## Required Evidence

Every release/deploy path should preserve:

- Release note draft.
- Deployment plan.
- Preflight check output.
- GitHub workflow run URL.
- Rollback notes.
- Human approval record.
- Known limitations.

The release workflow uploads release and deployment plan artifacts. The deploy
workflow runs preflight before any adapter publish step.

## Rollback

Rollback expectations differ by target:

- Docs: revert the publishing commit or redeploy the previous artifact.
- Server: redeploy previous version and confirm queued invocation compatibility.
- Web: redeploy previous artifact and verify account/task/device flows.
- Desktop: keep previous signed installers and define downgrade compatibility.
- Protocol: preserve backward compatibility notes and server/bridge matrix.

## Commands

```text
pnpm deploy:check
pnpm deploy:plan -- --target docs --environment preview
pnpm deploy:preflight -- --target server --environment staging
pnpm deploy:publish -- --target web --environment production
pnpm deploy:publish -- --target web --environment production --apply
```

## GitHub Workflows

- `Release`: manual workflow that creates release notes and deployment plan
  artifacts from a merged PR.
- `Deploy`: manual workflow that runs preflight and optionally calls the real
  deployment adapter.

Production deployments should use GitHub environment protection rules when the
repository entitlement allows it. Until branch/environment protection is fully
enforced, the manual approval requirement remains a documented operating rule.
