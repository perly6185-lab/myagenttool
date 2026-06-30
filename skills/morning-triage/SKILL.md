# Morning Triage Skill

Use this skill when a loop routine summarizes repository activity and turns
findings into follow-up loop runs.

## Acceptance Criteria

- Findings include concrete source evidence before a child run is created.
- Follow-up runs stay local unless an explicit operator approval is supplied.
- GitHub inputs are treated as read-only unless a later command declares a write.
- Failed checks and failed loop runs are prioritized above labeling cleanups.

## Checks

- Confirm `.myagenttool/state/triage.md` or the configured summary output was written.
- Confirm each fanout child run records the source routine run and finding id.
- Confirm fanout worker execution does not push, create PRs, or merge PRs.
