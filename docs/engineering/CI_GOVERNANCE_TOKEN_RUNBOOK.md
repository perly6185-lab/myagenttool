# CI Governance Token Runbook

Status: runbook. How to resolve the `pr-governance` merge gate when it blocks
every PR because its token cannot read GitHub Projects. Tracked by #390.

## Symptom

Branch protection on `main` requires the `pr-governance` status check
(`.github/workflows/governance.yml`, which runs `pnpm github:check:pr`). Every
PR fails it with:

```text
Pull request governance failed
  - PR #NNN must link at least one work issue with Project Fields metadata
Pull request governance warnings:
  - could not verify linked work issue Project item from this token; run github:sync-project before merge
```

…even when the PR links a work issue and carries all required evidence.

## Root cause

The check verifies the linked issue's **GitHub ProjectsV2** Fields, but the
token it runs under cannot read Projects:

- `pr-governance` runs with `GH_TOKEN: ${{ github.token }}` — the default
  `GITHUB_TOKEN`, which **cannot access org/user ProjectsV2**.
- The job's `permissions:` are `contents: read` + `issues: read` — no Projects
  scope (and the default token cannot be granted org-Projects read regardless).
- The job's own header comment describes it as **advisory**, but it was added to
  the required status checks (via `ci:activate --require-governance`), so it now
  hard-blocks merges.
- Reproduced locally: `gh api graphql -f query='{ viewer { projectsV2(first:1){ nodes { number } } } }'`
  returns `Resource not accessible by personal access token`.

Net effect: **no PR can satisfy the gate**; merges only land via the
`enforce_admins` override. This is also a prime suspect for the L3
evidence-coverage reading (see [MATURITY_CALIBRATION.md](MATURITY_CALIBRATION.md))
sitting below target.

## Fix — pick one

### Option 1 (recommended): restore `pr-governance` to advisory

It was designed advisory. Demote it out of the required checks (keep `verify`
and `eval-gates` required). The activation tool does exactly this when run
**without** `--require-governance`:

```bash
# re-applies branch protection with required contexts = [verify, eval-gates]
pnpm ci:activate --apply
```

Requires an admin token (the step calls `gh api PUT .../branches/main/protection`).
Re-promote `pr-governance` to required later, once a Projects-scoped token is
wired and `github:sync-project` runs on a cadence — the check's phase-2 intent.

### Option 2: make the gate satisfiable (Projects-scoped token + sync)

1. Create a token with Projects read — a classic PAT with the `project` scope,
   **or** a fine-grained PAT with **Projects: Read** on this owner. Store it as a
   repo secret, e.g. `GOVERNANCE_PROJECTS_TOKEN`.
2. In `governance.yml`, set `GH_TOKEN: ${{ secrets.GOVERNANCE_PROJECTS_TOKEN }}`
   for the `pr-governance` (and `local-governance`) steps.
3. Sync work issues into the Project so linked issues carry Fields:

   ```bash
   pnpm github:sync-project --project <PROJECT_NUMBER> --owner perly6185-lab
   ```

   Find `<PROJECT_NUMBER>` with `gh project list --owner perly6185-lab` using the
   scoped token.

For local `check-pr` to verify too, grant the same Projects scope to your local
`gh` token.

## Verify the fix

```bash
# Option 1: confirm pr-governance is no longer a required context
gh api repos/perly6185-lab/myagenttool/branches/main/protection \
  --jq '.required_status_checks.contexts'
# expect: ["verify","eval-gates"]

# Option 2: confirm the linked issue is now a Project item, then re-check a PR
gh issue view <ISSUE> --json projectItems --jq '.projectItems | length'   # expect: >= 1
node tools/github/src/index.mjs check-pr --repo perly6185-lab/myagenttool --pr <PR>
```

## Acceptance

- A PR that links a tracked work issue and carries the required evidence passes
  the merge gate **without** an `enforce_admins` override.
- The choice (advisory vs Projects-scoped token) is recorded, and
  `governance.yml` + branch-protection contexts reflect it.
