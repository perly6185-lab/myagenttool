# M0 Governance Closeout

This document records how M0 delivery is governed when GitHub branch protection
or required checks are unavailable under the current repository entitlement.

## Chosen Enforcement Path

M0 uses CI and governance checks as a mandatory manual merge gate.

If branch protection or repository rulesets become available, enable required
checks for:

- `Docs / markdown-basic`
- `CI / verify`
- `CI / desktop-smoke (ubuntu-latest)`
- `CI / desktop-smoke (macos-latest)`
- `CI / desktop-smoke (windows-latest)`
- `Governance / pull-request-governance`

Until then, a PR should not be merged unless those checks are passing or the PR
explicitly documents why a check is unavailable and how the risk was reviewed.

## Local Governance Commands

```text
pnpm github:check
pnpm github:check:issues
pnpm github:check:pr
pnpm github:check:branch
pnpm github:sync-project -- --repo perly6185-lab/myagenttool --owner perly6185-lab --project 1 --milestone M0
```

Default behavior is read-only. Project sync mutates only with `--apply`.

## Required GitHub CLI Access

Read-only checks need authenticated `gh` access that can read:

- Repository issues.
- Pull requests.
- Actions status.
- Project items when running project sync dry-run.

`github:sync-project -- --apply` requires issue and Project write access and
should be run only after reviewing the dry-run output.

## Issue Closure Rule

Before closing M0 issues:

- Acceptance criteria must be satisfied by merged PR evidence.
- The issue should be linked by `Closes #...` from the PR, or closed with a
  comment explaining the evidence.
- Any production hardening that remains outside M0 must be documented as a
  boundary or follow-up.

## Branch Protection Risk

Issue #32 tracks the entitlement limitation. The current mitigation is:

- Keep required checks documented.
- Wait for PR checks to pass before merge.
- Use `pnpm github:check:branch` to detect when technical enforcement becomes
  available.
- Avoid merging AI-generated work on manual confidence alone.
