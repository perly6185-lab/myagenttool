# Issue Decision Agent — design and development plan

Successor to the intent heuristic in the auto-run line
([ISSUE_WORKTREE_AUTORUN_PLAN.md](ISSUE_WORKTREE_AUTORUN_PLAN.md)). Instead of a
title-keyword classifier deciding change/investigation/question, a **decision
agent** triages each issue into an execution **path** — prototype, detailed
design, or direct development — decides whether to spawn child issues, and a
**role-specialized run** (prototype / design / code) takes the issue from there.

The one-line thesis: **the model decides, the code routes, the human gates the
heavy paths.**

## Problem

Today's routing is weak and implicit:

- Intent is guessed from title keywords (`auto-run-intent.mjs`); it cannot read
  the issue body or the codebase, so ambiguity routes badly.
- One generic prompt drives every run ("do the next useful step"); prototype
  work, design work, and code work need different instructions, tools, and
  verification.
- The decision itself is invisible: nothing records *why* an issue went down a
  path, so mis-routing cannot be audited or evaluated.

## Non-goals

- No auto-merge, ever. All existing autonomy guardrails stay.
- No new agent implementations: roles are **skills + prompts + verification**
  over the existing bridge agent, not three agent stacks.
- No multi-level issue trees: child spawning is depth-1 only.
- Not replacing `ai:issue-tree` PM authoring — this consumes its validation.

## Architecture

```text
issue (labelled auto / one-click Auto)
   │
   ▼
[1] DECISION STEP            decideIssuePath({link, issueBody, projectContext})
   │  agent (or heuristic fallback) returns a structured decision — it does
   │  NOT execute anything
   ▼
[2] DETERMINISTIC ROUTER     plain code: validates the decision, applies
   │  config + confidence gates, records it on the autoRun
   ▼
[3] ROLE EXECUTION           one bridge agent + role skill + role prompt
   │        ┌────────────────┬─────────────────────┬───────────────────┐
   │     develop           design                prototype
   │     code skill        design skill          prototype skill
   │     change flow       produce design doc /  runnable spike in the
   │     → verify → PR     child issue(s)        worktree + findings
   │                        → pending_decision    → design → decision
   ▼
[4] HUMAN DECISION GATE     design/prototype outputs park as pending-decision
                            child issues; a human approves (labels `auto`) and
                            the child re-enters the loop as a develop run
```

### [1] Decision contract

The decision step is an **injectable async function** (the existing
`classifyAutoRunIntent` socket, widened). It returns:

```json
{
  "path": "develop | design | prototype | clarify",
  "spawnChildIssues": false,
  "confidence": 0.0,
  "rationale": "one paragraph: why this path",
  "clarifyingQuestions": ["only when path=clarify"]
}
```

- `develop` — the issue is a concrete, scoped change; go straight to the code
  role (today's change flow).
- `design` — the solution space is open; produce a detailed design (options,
  trade-offs, recommendation, acceptance criteria) for a human to decide.
- `prototype` — uncertainty is deep enough that a runnable spike is worth more
  than analysis; build a time-boxed prototype in the worktree, then design.
- `clarify` — the issue is under-specified; ask specific questions instead of
  guessing (subsumes today's `needs_input`, but with concrete questions).

Execution shapes for the decision function, in order of preference:

1. **Heuristic fallback** (always present): today's title heuristic mapped onto
   the contract with `confidence: 0.3`.
2. **LLM decision agent** (opt-in): a one-shot, cheap/fast-model invocation that
   reads title + body + labels + a small project context pack, and must emit the
   JSON contract. Runs as a platform/direct agent call — no worktree needed.
3. **Hybrid fast path** (default when the agent is enabled): obvious cases skip
   the LLM — e.g. `type/bug` + reproduction steps → `develop` directly; only
   ambiguous issues pay the decision-agent hop.

### [2] Deterministic router (code, not model)

The router is plain code and owns every side effect:

- Validates the decision against the contract (unknown path → heuristic result).
- Applies **confidence gates**: below a configured threshold, heavy paths
  (design/prototype, child spawning) degrade to `clarify` — uncertainty goes to
  a human, never into speculative work.
- Records the full decision on the autoRun record
  (`decision: {path, confidence, rationale, decidedBy: agent|heuristic}`) and in
  an `auto_run_decided` event — the decision becomes auditable evidence.
- Maps path → role skill + role prompt + role verification for the run.

### [3] Role execution = skill, not new agent

Roles reuse the existing pieces end to end:

- **Role skills** are agent-skills records (`design`, `prototype`, `code`)
  rendered into the worktree via the existing `renderAgentSkillsIntoWorktree`
  (`.claude/skills/<slug>/SKILL.md`). Same bridge agent; different instructions.
- **Role prompts** extend `worktreeAutoRunPrompt`: all roles finally receive the
  **issue body and acceptance criteria** (today the agent sees only title+url —
  closing that gap is part of this work, and it benefits every path).
- **Role verification** differs by path: code → the existing verification gate;
  design → the deliverable is a design doc/child issue (no diff required);
  prototype → the spike must run (its own smoke command), but is never published
  as a product PR.

### [4] Human decision gate + child issues

- Design/prototype outputs become **pending-decision child issues** created
  through the `ai:issue-tree` validation path (Project Fields, labels,
  milestone; high-risk classes require human-approved evidence). Never labelled
  `auto` at creation.
- The parent autoRun settles as `report_posted` with pointers to the children.
- A human reviews, picks/edits the design, labels the child `auto` → the child
  re-enters the loop as a `develop` run with a real design and acceptance
  criteria attached. **Depth is 1: child issues cannot spawn grandchildren.**
- Caps: at most N (default 3) children per parent; creation is gated by the
  GitHub-write opt-in plus its own `MYAGENTTOOL_AUTORUN_SPAWN_ISSUES` flag.

## Guardrails (unchanged principles, restated)

- Merge is never automated; heavy-path outputs always park for a human.
- Every new autonomous surface (decision agent, child spawning) is
  **off-by-default, opt-in via env config**; disabled means the heuristic and
  today's behavior.
- The decision agent proposes; it executes nothing. All side effects live in
  audited, deterministic code.
- Conservative bias: low confidence → `clarify`, not a speculative PR and not a
  design epic for a one-line fix.

## Development plan

Each slice lands independently, tests-first, through the normal governance flow
(tracking issue with Project Fields → PR → required checks → human merge).

### Slice 1 — decision step + router (replaces the intent classifier) — landed

- Widen the socket: `classifyAutoRunIntent` → `decideIssuePath` returning the
  contract; heuristic fallback maps today's intents onto it
  (change→develop, investigation→design, question→clarify).
- Deterministic router with contract validation + confidence gates; decision
  recorded on the autoRun + `auto_run_decided` event.
- Metrics: decisions by path / decidedBy / confidence buckets; observability
  view shows path + rationale per run.
- **Acceptance**: with no agent configured, behavior is byte-compatible with
  today's intent routing; with a fake injected agent, the decision is recorded,
  gated, and routed. Pure-logic tests throughout.

### Slice 2 — role prompts + issue context — landed

- Fetch the issue body (gh, read-only, best-effort) and thread it into both the
  decision (`decideIssuePath({link, issueBody})`) and the role prompt — the
  agent finally sees what the issue asks, not just its title.
- `roleAutoRunPrompt(link, {path, issueBody})`: develop implements and commits;
  design and clarify explicitly must NOT change product code (their deliverable
  is the final summary); prototype builds a throwaway, time-boxed spike.
- **Design note — role skills deferred.** Agent-skills render *every* enabled
  applicable skill into a worktree; there is no per-run selection, so seeding
  three role skills would put all three role instructions into every run.
  Role instructions therefore travel in the prompt; dedicated role skill
  records (and decision-aware skill selection) wait until roles need distinct
  tools or verification, alongside slice 4.
- **Acceptance**: a develop run's prompt contains the issue body; a
  design-decided run gets the design instructions and, with no diff, settles as
  `report_posted`; a failing body fetch degrades to a title-only prompt.

### Slice 3 — decision agent (LLM) + hybrid fast path — landed

- Default `decideIssuePath`: an **operator-configured one-shot command**
  (`MYAGENTTOOL_AUTORUN_DECIDER_COMMAND_JSON`, array argv, no shell, never
  agent-proposed — the same trust-boundary pattern as the gh/verify commands).
  It receives the issue context as JSON on stdin and must print the decision
  contract as JSON on stdout (prose-wrapped JSON is tolerated); any LLM CLI or
  script plugs in. Timeout (`MYAGENTTOOL_AUTORUN_DECIDER_TIMEOUT_MS`, 30s),
  non-zero exit, junk output, and missing binary all yield null → heuristic
  fallback; the run never fails on the decider.
- **Hybrid fast path** (`MYAGENTTOOL_AUTORUN_DECIDER_FAST_PATH`, on by
  default): question/investigation titles are strong lexical signals the
  heuristic reads reliably, so they skip the decider hop; only the weak
  "change-shaped" default — where the ambiguity actually lives — pays it.
- Decisions record `via` (heuristic | fast-path | agent | fallback) and
  `latencyMs` for the slice-5 evaluation; metrics aggregate `byVia`.
- **Acceptance**: met — a broken/hung/junk decider degrades to the heuristic
  without failing the run; agent decisions carry `decidedBy: "agent"` + latency.

### Slice 4 — governed child issues + human gate + stage chaining

- Design/prototype outputs → pending-decision child issues via the issue-tree
  validation path; parent ↔ child linkage on the autoRun; caps + depth-1.
- Human labels `auto` → the child enters as `develop` with the design attached.
- **Acceptance**: a design run yields a governed child issue and a parked
  parent; only after human labelling does any implementation run start.

### Slice 5 — routing evaluation

- Track per-path outcomes (PR merged as-is / reworked / rejected; design
  accepted / discarded) and feed a held-out eval: was the routing right?
- Use it to tune the fast path and confidence thresholds with data.

## Risks

- **Decision cost/latency** — mitigated by the hybrid fast path + cheap model.
- **Over-engineering bias** (small fixes routed to design) — conservative
  default, confidence gates, and Slice 5 evaluation to catch drift.
- **Handoff state** — parent/child linkage is autoRun-record state; keep it in
  the persisted snapshot like everything else, no new store.
- **Concurrent-merge churn** on this repo — keep slices small and rebase-fast.
