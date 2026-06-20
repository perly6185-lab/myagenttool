# PM And Design Skills Integration

This document defines how MyAgentTool should use external PM and design skill
systems during AI-assisted development.

## Purpose

M0 proved that the local invocation loop can work, but a working loop is not the
same as a usable product. The next step is to make the demo understandable for
non-professional users while preserving enough depth for professional users.

The project should use PM and design skills as upstream collaborators:

- PM skills turn user intent into problem framing, user stories, acceptance
  criteria, risks, and launch/readiness checks.
- Open design tools turn product framing into prototypes, design system
  guidance, and reviewable visual artifacts.
- Codex turns approved specs and prototypes into repository changes.
- Visual QA checks whether the implemented UI remains clear across viewports.

## External References

### phuryn/pm-skills

Use [phuryn/pm-skills](https://github.com/phuryn/pm-skills) as the reference
method library for product discovery, execution, AI shipping review, and
go-to-market thinking.

Relevant skill areas:

- Product discovery: assumptions, prioritization, interviews, metrics.
- Execution: PRD, user stories, test scenarios, launch notes.
- AI shipping: intended-versus-implemented checks, test derivation, review
  evidence, safety and performance review.

Do not vendor the whole repository into MyAgentTool during M0. Treat it as a
source of reusable PM operating patterns and convert only the workflows we
actually need into local project docs or future Codex skills.

### nexu-io/open-design

Use [nexu-io/open-design](https://github.com/nexu-io/open-design) as the
reference for local-first design agent workflow and prototype generation.

Relevant capabilities:

- Create product prototypes for web, desktop, and mobile surfaces.
- Use a `DESIGN.md` style design contract to guide generation.
- Work as an external design agent through CLI/MCP rather than a runtime
  dependency of MyAgentTool.
- Produce visual artifacts that Codex can then implement in `apps/web`.

Do not make open-design a production dependency in M0. Register it conceptually
as an external design agent to dogfood the future Agent Registry model.

## M0 Workflow

For M0 UI or product experience changes, use this sequence:

1. PM framing:
   - Who is the user?
   - What job are they trying to finish?
   - What terms must be hidden or explained?
   - What would make the user trust the action before running it?

2. Product acceptance:
   - Plain-language user story.
   - Success criteria.
   - Safety, cost, data, and audit expectations.
   - Non-goals for the current milestone.
   - Convert approved PM output into governed backlog with
     `pnpm ai:issue-tree`.

3. Design contract:
   - Update `docs/design/MYAGENTTOOL_DESIGN.md`.
   - Define layout, information hierarchy, states, and copy rules.
   - Include desktop and mobile expectations.

4. Prototype:
- Use open-design or another design agent to create a reviewable prototype.
- Keep generated artifacts outside runtime code until reviewed.
- Convert only approved patterns into `apps/web`.
- Follow [OPEN_DESIGN_WORKFLOW.md](OPEN_DESIGN_WORKFLOW.md) for prototype
  inputs, review rules, and the Codex implementation path.

5. Implementation:
   - Codex implements the approved experience in the web console.
   - Keep the first screen as the usable task workspace, not a landing page.
   - Preserve the local invocation smoke path.

6. Visual QA:
   - Capture desktop and mobile screenshots.
   - Check layout overflow, unclear hierarchy, hidden actions, and confusing
     jargon.
   - Record verification evidence in the PR.

## Skill Roles

| Role | Responsibility | Output |
| --- | --- | --- |
| PM Skill | Problem framing and acceptance | PRD slice, user stories, risks |
| Design Skill | Prototype and design system | Design contract, layout, states |
| Codex | Repository implementation | Code, docs, tests, PR |
| Visual QA Skill | Experience verification | Screenshots, issues, residual risks |

## M0 Non-Goals

- Do not build a full design marketplace.
- Do not install arbitrary external agents without explicit approval.
- Do not make design generation part of production runtime.
- Do not let visual polish hide safety, cost, or audit information.

## Acceptance For Integration

- New M0 UI work links to this document or the design contract.
- UX issues include non-professional-user acceptance criteria.
- PM output can be converted into issue-tree dry-run evidence before apply.
- Applied issues include labels, milestone, acceptance criteria, and
  `## Project Fields` metadata for Project sync.
- Visual changes include screenshot or manual visual QA evidence.
- External design agent output is treated as source material, not as trusted
  production code.
