# Deployment Pipeline

This document defines the first deploy and release pipeline for MyAgentTool.

The current product is not ready for unattended production release. The pipeline
therefore focuses on repeatable preflight checks, release evidence, environment
approval, and a deploy adapter boundary.

## M0 Deploy Target

The first M0 deploy target is `docs/preview`.

This target uses the built-in `builtin-docs-preview` adapter. It creates a
reviewable documentation preview artifact and deployment evidence under
`.myagenttool/deploy-runs` without publishing to a public hosting provider. This
lets the release path exercise real preflight, evidence, rollback, and GitHub
environment gates before a cloud or desktop distribution target is selected.

`docs/preview` rollback is to revert the publishing commit or redeploy the
previous docs artifact.

Documentation previews may use a PR number, branch, or date-based identifier.
Staging and production releases for application targets must pass an explicit
`--version` so rollback evidence can identify the previous artifact.

## Environments

### Preview

Preview is used for PR or branch validation.

Required:

- CI passes.
- Governance checks pass.
- Release/deploy tooling checks pass when deployment behavior changes.
- GitHub environment named `preview` exists.

### Staging

Staging is used before production or desktop distribution.

Required:

- Release draft exists.
- Deployment plan exists.
- Rollback notes exist.
- Owner approval is recorded.
- GitHub environment named `staging` exists.

### Production

Production is the public or customer-facing release path.

Required:

- GitHub environment approval.
- Human release owner approval.
- Required checks passed.
- Rollback plan is explicit.
- Security, data, cost, local execution, and billing impact are reviewed.

As of 2026-06-19, production remains manually gated. Repository entitlement
limits required reviewers and wait timers; keep this tracked through issue #32
until technical enforcement is available.

## Deployment Adapter

Command:

```text
pnpm deploy:publish -- --target web --environment staging --apply
```

`deploy:publish` is dry-run by default. Real deployment requires:

- `--apply`.
- A built-in adapter for the selected target, or a command adapter configured
  with a JSON argv array.
- Passing preflight checks.

Dry-run publish also records preflight readiness. It does not execute an
adapter, but the generated evidence reports `readinessStatus: ready` or
`readinessStatus: would-fail-preflight` with the same approval, version, and
adapter configuration issues that would block apply mode.

Command adapters are configured by the most specific matching environment
variable:

1. `MYAGENTTOOL_DEPLOY_<TARGET>_<ENVIRONMENT>_COMMAND_JSON`
2. `MYAGENTTOOL_DEPLOY_<ENVIRONMENT>_COMMAND_JSON`
3. `MYAGENTTOOL_DEPLOY_<TARGET>_COMMAND_JSON`
4. `MYAGENTTOOL_DEPLOY_COMMAND_JSON`

For example:

```text
MYAGENTTOOL_DEPLOY_DOCS_PREVIEW_COMMAND_JSON='["node","tools/deploy-docs-preview.mjs"]'
```

GitHub environment secret responsibilities:

| Secret or env | Owner responsibility |
| --- | --- |
| `MYAGENTTOOL_DEPLOY_COMMAND_JSON` | Default deploy adapter command, reviewed by release owner |
| `MYAGENTTOOL_DEPLOY_<TARGET>_COMMAND_JSON` | Target-specific adapter command, reviewed by target owner |
| `MYAGENTTOOL_DEPLOY_<ENVIRONMENT>_COMMAND_JSON` | Environment adapter command, reviewed by environment owner |
| `MYAGENTTOOL_DEPLOY_<TARGET>_<ENVIRONMENT>_COMMAND_JSON` | Most specific adapter command, reviewed by target and environment owners |
| `MYAGENTTOOL_DEPLOY_PRODUCTION_APPROVED` | Production approval signal, set only by protected environment approval |

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

Adapter commands run without a shell. Production also requires
`MYAGENTTOOL_DEPLOY_APPROVED=true`, which should be set only by an approved
GitHub production environment job.

## Required Evidence

Every release/deploy path should preserve:

- Release note draft.
- Deployment plan.
- Preflight check output.
- GitHub workflow run URL.
- Deployment evidence JSON/Markdown from `.myagenttool/deploy-runs`.
- Rollback notes.
- Human approval record.
- Known limitations.
- Version policy or non-versioned preview justification.
- Deploy secret names and ownership responsibility.
- Entitlement limitation note when GitHub enforcement is unavailable.

The release workflow uploads release and deployment plan artifacts. The deploy
workflow runs preflight before any adapter publish step and uploads deploy
evidence artifacts for preview, staging, and production.

Deploy evidence JSON includes `policy.versionPolicy`,
`policy.deploySecretNames`, `policy.rollback`, `policy.humanApprovalRequired`,
and the issue #32 entitlement limitation note. Dry-run publish evidence also
includes `readinessStatus` and any preflight readiness failures so local
operators do not mistake a dry-run artifact for production readiness.

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

GitHub environments required for M0:

- `preview`: no production secrets; may run dry-run or docs preview adapter.
- `staging`: protected by release owner review before `--apply`.
- `production`: protected by release owner review and sets
  `MYAGENTTOOL_DEPLOY_APPROVED=true` only after approval.

Production deployments must use GitHub environment protection rules when the
repository entitlement allows it. Until branch/environment protection is fully
enforced, the manual approval requirement remains a documented operating rule
and the deploy CLI still refuses production unless
`MYAGENTTOOL_DEPLOY_APPROVED=true`.

As of 2026-06-19, the repository has `preview`, `staging`, and `production`
environments created, but required reviewers and wait timers are blocked by the
current repository entitlement. Track enforced protection through issue #32.
