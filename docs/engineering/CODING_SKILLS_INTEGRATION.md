# Coding Skills Integration

This document defines how MyAgentTool should use external coding skill
libraries to improve implementation quality.

## Purpose

PM and design skills help define what should be built. Coding skills help make
the implementation safer, better tested, easier to review, and more aligned
with the repository workflow.

## Reference

Use [sickn33/antigravity-awesome-skills](https://github.com/sickn33/antigravity-awesome-skills)
as a reference catalog for coding, QA, security, agent, and open-source
maintenance skills.

Do not install or vendor the full catalog into MyAgentTool during M0. The
catalog is large and should be treated as an external method library until each
skill is reviewed.

## Approved M0 Skill Areas

The approved M0 areas are:

| Area | Use |
| --- | --- |
| Web App Builder | Improve the Web Console implementation quality |
| QA & Test Automation | Add smoke, E2E, visual, and regression checks |
| Secure App Builder | Review local execution, data, audit, and auth-sensitive code |
| Agent & MCP Builder | Guide future CLI, HTTP, MCP, and A2A adapter work |
| OSS Maintainer | Improve issue, PR, release, and contribution workflows |

## Usage Rules

- Use skills as guidance for Codex or external agents, not as runtime
  dependencies.
- Prefer a small reviewed skill set over broad installation.
- Record which skill family influenced a PR when it changes implementation,
  tests, security, or release behavior.
- Keep repository checks, issue hygiene, and PR governance as the source of
  truth.
- Do not let external skill recommendations bypass security, billing, data, or
  local execution approval.

## M0 Coding Workflow

For non-trivial implementation work:

1. Read the linked issue and source docs.
2. Choose the relevant skill family from the approved M0 list.
3. Implement the smallest milestone-aligned change.
4. Add or update tests based on risk.
5. Generate a deterministic Testing skills plan.
6. Run local checks.
7. Attach verification evidence to the PR.

Use:

```text
pnpm ai:testing-plan -- --change web --risk high
pnpm ai:scope-check -- --plan-file .myagenttool/runs/<run>/code-plan.json --base main
```

`ai:testing-plan` records which Testing skills guidance applies. `ai:scope-check`
records whether the diff stayed inside the code plan. `ai:work-runner --apply`
generates both artifacts automatically in `.myagenttool/runs/<run>`.

Suggested command sequence:

```text
pnpm docs:check
pnpm repo:check
pnpm github:check
pnpm ai:scope-check -- --base main
pnpm ai:testing-plan -- --change docs --risk medium
pnpm typecheck
pnpm test
pnpm github:check:pr
```

For UI work, also follow [PM_DESIGN_SKILLS.md](PM_DESIGN_SKILLS.md) and
[MYAGENTTOOL_DESIGN.md](../design/MYAGENTTOOL_DESIGN.md).

For coding-agent work, use the trusted adapter contract in
[MODEL_DRIVEN_DELIVERY.md](MODEL_DRIVEN_DELIVERY.md). Production wrappers must
accept JSON argv configuration, receive `MYAGENTTOOL_WORK_CONTEXT`, write
`adapter-result.json`, and never execute model-proposed shell commands directly.

## Review Questions

When a coding skill influences a change, reviewers should ask:

- Did the change improve the linked acceptance criteria?
- Did it add enough tests for the risk?
- Did it introduce dependencies that should be avoided in M0?
- Did it affect local execution, data handling, billing, or audit behavior?
- Did it leave clear evidence for another AI or human to review?

## Non-Goals

- Do not become a mirror of the external skill catalog.
- Do not auto-install all skills.
- Do not make skill selection invisible.
- Do not rely on external skill output as trusted code without review.
