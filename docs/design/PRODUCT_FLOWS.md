# MyAgentTool Product Flows

This file defines role-based product flows for MyAgentTool UI prototype and
AI-assisted implementation work. Use it before changing Web Console IA,
navigation, interaction states, or role-specific workflows.

When exact user research is unavailable, define a role-scenario matrix instead
of optimizing for a single imagined user. The system must consider ordinary
developers, advanced developers, team administrators, and auditors without
putting every capability on the first screen.

## Role Matrix

| Role | Goal | Frequency | Fear | Success Signal | Primary Surface |
| --- | --- | --- | --- | --- | --- |
| Ordinary developer | Run an agent task and understand the result | High | Not knowing where to click; accidentally changing code | Finds the task path quickly and understands next step | Home task workspace |
| Advanced developer | Control Codex session, workspace, diff, and continuation | Medium | Losing context; adopting unreviewed changes | Can inspect session, review diff, and continue safely | Codex supervision |
| Team administrator | Connect agents, approve risky actions, manage policy | Low but critical | Opaque permissions; approving the wrong action | Can judge approve/deny consequences and see audit | Connect Agent and Needs attention |
| Auditor | Trace what happened and prove evidence source | Low but critical | Evidence is incomplete or managed/imported is blurred | Can trace managed evidence and export a summary | Evidence Center |

## Product Principles

- The homepage is for the ordinary developer's high-frequency task flow.
- Advanced and governance workflows must have clear entry points, not compete
  with the task composer.
- Each role can complete its own job without learning every other role's tools.
- Managed evidence and imported-after-the-fact evidence must stay visibly
  separate.
- Local access, enterprise identity, message Channels, and Application
  credentials must remain visibly separate security boundaries.
- A feature is not accepted until role-specific task tests pass.

## Low-Fidelity IA

Use this structure before visual styling:

```text
Left column:  current task intent
  - task input
  - computer and agent selector
  - Codex-only task controls when Codex is selected
  - run/cancel and pre-run review

Middle column: current task execution
  - status
  - approval prompt when the current run needs action
  - activity timeline
  - result summary
  - troubleshooting when failed

Right rail: context, history, and governance
  - selected computer and agent context
  - current session summary
  - Codex supervision
  - Needs attention
  - Evidence Center
  - Import evidence
  - Connect Agent
```

Do not place Evidence Center, Connect Agent, imported evidence, full session
history, hook details, JSONL, or integration builders in the left task column.

## Flow 0: Developer Chooses Local Or Enterprise Identity

Primary user: ordinary developer or team administrator

Frequency: first launch and session renewal

User job: choose local access or a familiar enterprise sign-in path while
understanding which team and computer will be linked.

Entry point: identity entry; the signed-in state and logout live in Me.

Happy paths:

```text
Open identity entry
-> server policy permits local access
-> choose "在这台电脑上使用"
-> server creates a local-team session
-> open Home
```

```text
Open identity entry
-> choose "登录团队"
-> choose an enabled identity provider
-> confirm the origin, computer, comparison code, and requested team on phone
-> choose one verified team when more than one is available
-> server maps the identity to an active membership and role
-> open Home
```

Expiry and rejection:

```text
Login code expires
-> old challenge becomes terminal
-> show that no login occurred
-> refresh the login code or choose another method

User/provider rejects confirmation or membership is unavailable
-> create no session and reveal no unverified team
-> choose another method or contact a team administrator
```

Recovery:

```text
Choose account/password
-> enter tenant-aware account and password
-> generic failure with rate limiting
-> if recovery is needed, request administrator help
-> consume a short-lived one-time recovery grant
-> revoke old sessions and sign in again
```

Logout:

```text
Open Me
-> review active team, role, and current computer
-> choose current-device or all-device logout
-> confirm scope
-> server revokes the selected MyAgentTool sessions
-> return to a freshly policy-derived identity entry
```

Acceptance signals:

- Local mode and team sign-in are separate choices and appear only when enabled
  by server policy.
- The user can identify the origin, computer, team, and consequence before
  confirming.
- Expiry, rejection, recovery, and logout each have one clear next action.
- Tenant and role come from verified identity plus server membership, never
  from an unverified display claim.
- The shared-screen state reveals no personal or team details before
  confirmation.
- No client secret, raw OAuth payload, provider token, message-channel
  credential, Application credential, or nonfunctional QR is shown.

Design contract:

- [ADR 0021](../engineering/ADR_0021_PROVIDER_NEUTRAL_ENTERPRISE_IDENTITY.md)
- [Identity entry prototype](prototypes/china-identity-entry.html)

## Flow 1: Ordinary Developer Runs A Task

Primary user: ordinary developer

Frequency: high

User job: ask the local computer to run an agent, then understand the result.

Entry point: home task workspace.

Happy path:

```text
Open home
-> type plain-language task
-> choose computer and agent
-> review safety/data/cost/cancellation
-> run
-> watch status
-> read result
-> if changes exist, open diff review from session/result context
```

Failure path:

```text
Run fails
-> see plain-language failure
-> inspect troubleshooting
-> retry or switch agent
```

Advanced path:

```text
Need proof or history
-> open Codex supervision or Evidence Center from right rail
```

What not to show:

- Raw JSONL.
- Hook event names.
- Full evidence registry.
- Integration builder controls.
- Imported evidence workflow.

Prototype states:

- empty
- ready to run
- running
- approval needed
- succeeded
- failed
- result has file changes
- mobile one-column layout

Usability test tasks:

- Use Codex to run a repository task.
- Explain what will run and where before clicking run.
- Cancel a running task.
- Find the result after the task succeeds.

Acceptance signals:

- Finds the task input and run action without explanation.
- Can describe the current state and next step.
- Understands whether a task may change files.
- Can reach diff review without seeing raw governance internals first.

## Flow 1A: Workspace Owner Reviews A Discovered Daily Work Type

Primary user: workspace owner during occasional setup

Frequency: low; repeated only when historical work changes

User job: confirm “this is how I work” before the system exposes a reusable
business task button.

Happy path:

```text
Open Delivery memory
-> choose an authorized source
-> review the discovered daily work and its confirmed examples
-> inspect always/conditional steps and plain-language evidence
-> create an editable review draft
-> adjust trigger, order, references, outputs, ledgers, conditions, and approvals
-> save the review
-> explicitly confirm and enable the immutable version
```

Version and recovery:

```text
Need to change an enabled work type
-> create a new draft version
-> edit and explicitly enable it
-> old version remains pinned to existing local Issues

Evidence changed or source access was revoked
-> enabling is blocked with one recovery action
-> refresh and reconfirm affected cases
-> create a fresh draft
```

Acceptance signals:

- The owner sees a business label such as “Commercial inquiry and quotation,”
  not schema names or execution controls.
- Enabling is impossible until the explicit review checkbox is selected.
- Published versions cannot be edited in place.
- Disabling stops new task creation without erasing history.
- Keyboard and screen-reader users can identify every editable step and action.

## Flow 1B: Business Operator Processes An Inquiry

Primary user: ordinary business operator

Frequency: high

User job: turn a newly recognized inquiry into the same governed outputs and
ledgers used in prior successful work, without learning execution internals.

Happy path:

```text
Open the local Issue created for the inquiry
-> verify business number, source evidence, and fixed daily-work version
-> choose "Process inquiry"
-> watch independent reading/reference steps run within computer capacity
-> preview the exact inquiry-ledger row and changed cells
-> explicitly approve the governed ledger write
-> run the allowlisted local quotation step
-> resolve missing or conflicting price, currency, tax, and delivery facts
-> confirm one supported, current local Markdown template and preview the output path
-> generate and inspect the versioned draft, field provenance, and source summary
-> review and approve the quotation when asked
-> preview and approve the quotation-ledger change
-> record that no confirmed order has arrived
-> finish without an order follow-up Issue
```

Conditional order path:

```text
Reach "Was an order received?"
-> select a currently confirmed order document
-> confirm the condition
-> create exactly one linked order-processing child Issue
-> review the order-ledger change
-> continue the remaining visible steps
```

Failure and recovery:

```text
A step fails or the app restarts while it is running
-> preserve completed work
-> show the interrupted or failed step
-> retry that step

The ledger changed after preview
-> do not overwrite the concurrent edit
-> refresh the target and create a new row-level preview

The app stopped after replacing the ledger but before saving the receipt
-> recognize the previewed after-hash on retry
-> restore the audit receipt without adding the row again

User cancels
-> stop all unfinished steps
-> keep evidence and progress visible
-> do not silently restart the cancelled run
```

What not to show:

- Raw Routine schema, Prompt, action receipt, idempotency key, or absolute path.
- Generic worktree and Auto Run primary actions competing with “Process inquiry.”
- An order child task before a current confirmed order document is selected.

Acceptance signals:

- A first-time operator can find the single primary action without instruction.
- Required, conditional, waiting, completed, failed, and skipped steps are distinguishable.
- Approval and order decisions explain their consequence before proceeding.
- Duplicate clicks, rescans, retries, and restarts do not duplicate the parent or order child Issue.
- Unknown or conflicting evidence remains reviewable instead of being guessed.

## Flow 2: Advanced Developer Manages Codex Session

Primary user: advanced developer

Frequency: medium

User job: inspect and continue managed Codex work without losing context.

Entry point: Codex supervision.

Happy path:

```text
Open Codex supervision
-> select managed session
-> inspect session mode, repo, workspace, branch, dirty state
-> review evidence counts and approval state
-> inspect file changes
-> approve, reject, or send feedback
-> continue last session from task composer when needed
```

Failure path:

```text
Session failed or was cancelled
-> inspect timeline and session detail
-> check approvals, warnings, and workspace state
-> decide whether to retry, continue, or abandon
```

Advanced path:

```text
Need comparison
-> use advanced compare option
-> inspect each child invocation with independent workspace/evidence
```

What not to show:

- Private Codex auth files.
- Private Codex session files as primary evidence.
- Imported evidence as managed proof.
- Integration setup controls inside session detail.

Prototype states:

- no managed session
- running session
- completed session
- needs approval
- failed session
- diff review
- feedback submitted
- continuation guidance

Usability test tasks:

- Find the previous Codex session.
- Explain whether it was new or continued.
- Review what files changed.
- Send feedback tied to a specific diff.
- Continue the latest managed Codex session.

Acceptance signals:

- Can find session history without using raw logs.
- Can tell managed session from imported evidence.
- Can decide whether to adopt or reject changes.
- Can continue work without losing repo/workspace context.

## Flow 3: Team Administrator Handles Risk And Integration

Primary user: team administrator

Frequency: low but critical

User job: approve risky actions, connect agents, and keep policy visible.

Entry point: Needs attention, Connect Agent, and advanced management rail.

Happy path:

```text
Open Needs attention
-> inspect pending approval
-> review tool, risk, timeout, task, repo/session context
-> approve or deny
-> confirm audit record
```

Agent connection path:

```text
Open Connect Agent
-> run conservative discovery
-> inspect candidate risk and health
-> create reviewable integration artifact
-> approve/test/register explicitly
```

Failure path:

```text
Approval times out or is denied
-> invocation stops before execution
-> audit records timeout/deny
-> user can explain why it stopped
```

What not to show:

- Approval inbox inside the task composer.
- Auto-enabled discovered agents.
- Unreviewed generated integrations as runnable agents.
- Unclear "allow" actions without consequence text.

Prototype states:

- no pending approvals
- approval pending
- approval approved
- approval denied
- approval timed out
- discovery empty
- candidate found
- integration artifact needs review

Usability test tasks:

- Reject a high-risk request.
- Approve a pending Codex permission request.
- Explain what happens if the approval times out.
- Register a discovered CLI only after review/test.

Acceptance signals:

- Can tell what tool/action is being approved.
- Can judge consequences before approving.
- Timeout/deny behavior is deterministic and visible.
- Generated integrations remain disabled until explicitly registered.

## Flow 4: Auditor Traces Evidence

Primary user: auditor

Frequency: low but critical

User job: prove what happened, where evidence came from, and whether it was
managed or imported.

Entry point: Evidence Center.

Happy path:

```text
Open Evidence Center
-> filter by session, invocation, agent, repo/workspace, type, source, redaction
-> inspect evidence detail
-> confirm marker is managed or imported_after_the_fact
-> export summary
```

Failure path:

```text
Evidence is incomplete
-> identify missing managed chain segment
-> distinguish missing evidence from imported supplement
-> create follow-up issue
```

Advanced path:

```text
Need context
-> jump from evidence to session/invocation
-> compare JSONL, hook, approval, warning, and change review records
```

What not to show:

- Imported evidence promoted as managed proof.
- Unredacted secrets.
- Private Codex auth/session file reads.
- Raw event floods before filters and summaries.

Prototype states:

- no evidence
- managed JSONL evidence
- hook evidence
- approval evidence
- runtime warning
- file change
- change review
- imported evidence
- export summary

Usability test tasks:

- Prove a run was launched through MyAgentTool.
- Filter evidence by repo and session.
- Distinguish managed evidence from imported evidence.
- Export a summary for a completed session.

Acceptance signals:

- Can trace the evidence chain without reading raw logs first.
- Can identify evidence source and redaction state.
- Can tell managed proof from after-the-fact import.
- Can produce a concise audit summary.

## Flow: Ordinary User Captures, Asks, And Acts On Personal Material

Primary user: ordinary local user

Frequency: high

User job: state what they want to accomplish, let AI use the right personal
material, verify the result, and continue into a saved outcome or controlled
work without learning retrieval technology.

Entry point: first-level `My files` / `我的资料` destination.

Goal-first happy path:

```text
Open My files
-> state a goal such as “compare the two proposals and recommend the next step”
-> see which material AI intends to use
-> add or remove candidates when the scope is ambiguous
-> read a result that leads with the requested outcome
-> open a cited source in safe preview
-> continue asking, save the result, or create a scoped task
```

Material-first happy path:

```text
Open one item or select several items
-> choose Ask, Summarize, Compare, Extract, Create, or Plan next steps
-> edit the prefilled natural-language goal when needed
-> read and verify the result
-> keep the result or continue into controlled work
```

Add-and-use path:

```text
Add a file, folder, text, image, or supported link
-> see whether the authoritative original remains in place
-> receive three relevant suggestions for what AI can do with it
-> start one suggestion or return to My files
```

Existing-material path:

```text
Open My files
-> ask a question over already indexed articles, mail, tasks, inputs, and outputs
-> deterministic search finds a bounded candidate set
-> the answer distinguishes direct support, inference, conflict, and insufficient evidence
-> create a task only after reviewing the references that will enter its scope
```

Recovery:

```text
Original moved, changed, or cannot be parsed
-> preserve the last valid index and answer history
-> explain which citation is affected
-> locate or select the original again, refresh the record, or remove it from the question

Model, network, OCR, or semantic ranking unavailable
-> keep lexical search, safe preview, original location, and add-to-task available
-> never present general model knowledge as an answer from My files
```

What not to show:

- FTS, embedding, RAG, chunk, vector score, or model prompt details.
- Absolute paths, root IDs, source fingerprints, or unrestricted candidate lists.
- MCP, provider-adapter, parser, or index-version terminology.
- Material outside the explicit question scope.
- A destructive action implied by deleting a collection, answer, or index.
- A catalog dashboard that makes index counts and health the primary value.
- SSH commands, uploads, publication, or deletion executed directly from a
  material conversation without the existing preview and approval flow.

Usability test tasks:

- Explain three useful things AI can do here without being told about search or RAG.
- Start with “prepare next steps from recent customer feedback” and confirm the material used.
- Add one local file and explain whether it was copied or left in place.
- Ask a fuzzy question and open the exact source supporting the answer.
- Ask across conflicting material and identify the disagreement.
- Compare two selected items and save the result as a new versioned outcome.
- Turn the answer into a task that contains only the confirmed references.
- Complete the same flow at 390 px without opening technical settings.

Acceptance signals:

- Can describe useful outcomes before learning how material is indexed.
- Finds `Add material`, the goal input, and `Ask these materials` without explanation.
- Can describe the scope before asking and the source after answering.
- Can distinguish cited facts from AI inference or insufficient evidence.
- Can create a task without granting access to the whole library.
- Understands that host, site, send, and delete actions require a separate confirmation.
- Search and preview remain useful while every model-backed enhancement is off.

Design contract:

- [“我的资料”意图驱动的 AI 工作入口需求与开发规划](LOCAL_PERSONAL_BRAIN_REQUIREMENTS.md)
- [Local Content and Local AI Integration Design](../engineering/LOCAL_CONTENT_AI_INTEGRATION_DESIGN.md)
- [Task Resource Bundle and Hidden Data Capabilities](TASK_RESOURCE_BUNDLE_REQUIREMENTS.md)

## Flow: Channel Routes Material Without Polluting Tasks

Primary user: ordinary user sending a message, link, or attachment from a
connected Channel

User job: save, understand, or act on shared material without deciding whether
the system needs a content record, AI invocation, or work item.

```text
Receive a Channel message
-> identify save, understand, or act intent
-> save: create material and capture progress only
-> understand: run a bounded read-only consultation and return the answer
-> act: preview a task with only confirmed messages and material
-> confirm: create the task and retain Channel provenance
-> report task progress and result back to the originating Channel
```

Design rules:

- Saving material never creates a work item or occupies the task queue.
- A bare file, image, or voice attachment is copied into managed local material,
  deduplicated by content hash, and indexed independently of tasks.
- An immediate follow-up such as `整理刚才的文件` may reference only the latest
  attachment batch; unrelated older Channel history is excluded.
- A read-only consultation never mutates the current task.
- `Add to current task` adds explicit material references only.
- `Create new task` requires a goal and confirmation before execution.
- A Channel identity never expands the bound user's material visibility.
- Old capture work items remain historical; restart recovery does not backfill
  new work items for material-only operations.

Usability test tasks:

- Send a link and confirm it appears in My files but not My tasks.
- Send a file without instructions and confirm it appears as `Material` in My
  files while task count and focus remain unchanged.
- Send the same file again and confirm the existing managed original is reused.
- Ask for a summary and confirm no task was created.
- Add the material to one selected active task and inspect its exact references.
- Create a new task and confirm unrelated Channel history is absent.
- Receive completion in the originating Channel and explicitly save the result.

Acceptance signals:

- The user can predict whether a task will be created from the reply wording.
- Material capture does not change task counts, focus, or queue position.
- Analysis does not gain write tools or silently attach to an active task.
- Task creation preserves Channel provenance and a bounded material scope.

## Cross-Role Prototype Checklist

Before coding a non-trivial UI workflow, produce a low-fidelity prototype or
fixture-state sketch that covers:

- empty
- running
- approval needed
- succeeded
- failed
- cancelled
- timeout
- diff review
- evidence center
- imported evidence
- mobile viewport

For each state, list:

- primary role
- user question being answered
- left/middle/right ownership
- action available
- action consequence
- what must stay hidden

For UI work that starts from an ASCII sketch, route the sketch through Prototype
Canvas before implementation:

```text
Product Flow -> ASCII sketch -> Prototype Canvas -> HTML prototype -> Visual QA
```

Prototype Canvas must preserve the Product Flow metadata for each region. A
canvas preview is not accepted if the task composer gains low-frequency
configuration, raw evidence, hook names, imported evidence, integration
builders, or full session detail.

## Four Acceptance Signals

Use these signals instead of subjective "do you like it?" feedback:

- Findable: the user can locate the entry point without explanation.
- Understandable: the user can describe current state and next step.
- Actionable: the user knows the consequence of run, cancel, approve, deny, or
  export.
- Traceable: advanced users can find history, evidence, and audit.

If one of these fails for the intended role, the UI is not ready even if the
feature exists and automated checks pass.

## AI Implementation Gate

Before AI writes production UI code, it must produce or reference:

- role matrix row
- primary scenario
- user task flow
- low-fidelity IA
- prototype states
- usability test tasks
- "what not to show" list
- acceptance signals

If the implementation touches multiple roles, it must cover each role
explicitly rather than choosing only one.
