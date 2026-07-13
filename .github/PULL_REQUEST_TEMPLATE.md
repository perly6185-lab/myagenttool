<!-- Tip: run `pnpm pr:evidence` (optionally `--body-file this.md`) to see exactly
     which evidence sections your diff requires before you push. -->

## Summary

- 

## Type

- [ ] docs
- [ ] feature
- [ ] bug fix
- [ ] refactor
- [ ] security
- [ ] architecture decision

## Milestone / Area

- Milestone:
- Area:
- Source issue:

<!-- If this PR remediates a failure from a prior merge, record it so DORA can
     measure change failure rate + recovery time:  Change-failure: #<culprit> -->


## Acceptance

- [ ] Acceptance criteria are defined or linked.
- [ ] User-facing behavior is described in plain language.
- [ ] Security, data, cost, or lifecycle impact was considered.
- [ ] Docs were updated when behavior or scope changed.

## Product Flow

- Role flow: <!-- ordinary developer / advanced developer / team administrator / auditor / not applicable -->
- Scenario:
- Frequency: <!-- high / medium / low but critical / not applicable -->
- Owner surface:
- Usability task:
- What not to show:
- Partial acceptance or follow-up:

## Verification

- [ ] Not run, documentation-only change.
- [ ] Manual verification:
- [ ] Automated checks:

## Risk Gates

- [ ] Visual QA evidence for web UI changes, or not applicable.
- [ ] Cross-platform execution/cancellation evidence for desktop or local execution changes, or not applicable.
- [ ] Security, data, billing, credential, and audit impact reviewed, or not applicable.
- [ ] Release, deploy preflight, rollback, and human approval evidence, or not applicable.

## Security Review

<!-- REQUIRED when this PR touches a governed registry / execution surface:
applications/capabilities/tools services or routes, agent wrappers, or the
Desktop Bridge. Each field must be a specific statement — not "N/A". -->

- Tenancy: <!-- how team/project ownership is enforced; who can/can't act -->
- Filesystem: <!-- any path/write; how it's confined; traversal considered -->
- Approval: <!-- which side-effecting actions are gated and how -->
- Injection: <!-- process spawn / argv / command injection; argv leakage -->
