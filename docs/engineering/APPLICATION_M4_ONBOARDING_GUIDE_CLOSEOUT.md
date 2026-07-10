# Application M4.2 Onboarding Guide Closeout

Status: delivered as the first guided-intake product slice.

Date: 2026-07-10

## Objective

M4.2 starts turning Application registration from a collection of advanced
fields into a guided operator flow. The first slice is intentionally thin:
show the operator what is ready, what is missing, and what evidence will exist
after registration.

The target flow is:

```text
choose source -> capture brief -> review descriptors -> plan smoke path
```

## Delivered Scope

- Added a reusable `applicationOnboardingGuide` model for registration
  readiness. It summarizes source, integration brief, descriptor draft, and
  smoke path state as four operator-facing steps.
- The Register Application modal now renders an `Onboarding guide` panel with
  status badges and short next-step details.
- The guide updates live as the operator selects a source, fills the Codex
  integration brief, applies the doocs/md preset, or attaches descriptor JSON.
- Registration can now apply generated descriptor drafts before the Application
  exists. When an integration brief and source are present, the modal previews
  available MCP, npm wrapper, or manual manifest drafts and fills the advanced
  descriptor JSON on demand.
- Generated npm wrapper commands remain `draft` and `requiresApproval: true`,
  preserving the review-before-execution boundary.
- Registration now shows descriptor risk preview before save for MCP, npm
  wrapper, and manual manifest JSON. Operators can see projected capabilities,
  draft/candidate count, approval requirements, policy-consent needs, and high
  risk descriptors before submitting the Application.
- The Application detail page now carries the same guide forward after
  registration. The `Onboarding continuity` panel summarizes source, brief,
  descriptor, and smoke readiness beside generated descriptor drafts and
  post-save next actions.
- Existing registration behavior is unchanged: the guide does not block
  registration, does not save anything by itself, and does not approve draft
  descriptors.
- The M4 readiness gate now includes descriptor-utils, draft-generator,
  onboarding-guide, register-modal, and inspector continuity tests.

## What This Improves

### Can integrate

The source step makes the required package/path/repository/URI state explicit
before registration.

### Can use

The brief step tells operators whether Codex draft inputs will be attached to
the registration payload.

### Can operate

The smoke step makes probe/smoke evidence planning visible before the
Application is created. The doocs/md preset also shows that auto-probe will run
after registration. After save, the detail page keeps probe, orchestration, and
smoke evidence work visible as post-save next actions.

### Can review

The descriptor step separates "draft JSON attached for review" from "approved
execution." This keeps M4.2 aligned with the Application governance boundary.

## Verification

Focused check:

```powershell
pnpm --filter @myagenttool/web test -- application-onboarding-guide application-draft-generator descriptor-utils register-application-modal
pnpm --filter @myagenttool/web test -- applications-inspector
```

Aggregate gate:

```powershell
pnpm smoke:application-m4-readiness
```

## Remaining M4.2 Work

This slice is not the final wizard. Remaining guided-intake work:

- turn the panel into a stepper when registration complexity grows beyond one
  modal
- add stronger action routing from the continuity panel if operators need
  one-click jumps into descriptor editing, probe, or smoke evidence capture
