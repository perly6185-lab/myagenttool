# Model-driven Delivery

This document defines the first real model-driven layer for MyAgentTool's
full-flow AI delivery system.

The goal is to let a user express an idea, then have a controlled model workflow
produce PM, implementation, and review evidence without hiding risk or bypassing
human approval.

## Capabilities

### PM Agent

Command:

```text
pnpm ai:pm -- --idea "..." --provider openai|command|mock
pnpm ai:issue-tree -- --idea "..." --provider openai|command|mock
```

The PM agent turns plain language into:

- A non-professional user outcome.
- A small milestone-aligned delivery slice.
- Suggested Project fields and labels.
- Acceptance criteria.
- Risk flags for security, data, cost, local execution, and release.
- Source docs that should be checked before implementation.

### Issue Tree Agent

Command:

```text
pnpm ai:issue-tree -- --idea "..." --provider openai|command|mock
pnpm ai:issue-tree -- --brief-file .myagenttool/runs/brief.json --repo OWNER/REPO --apply
```

The issue tree command turns a PM brief into one or more governed GitHub issue
specs. It is dry-run by default and prints the exact issue body, labels,
milestone, acceptance criteria, and Project field metadata that would be used.

Apply mode requires:

- `--apply`.
- `--repo` or `GITHUB_REPOSITORY`.
- Non-empty acceptance criteria.
- Required governance label groups.
- A milestone and source doc.

After apply, run:

```text
pnpm github:check:issues
node tools/github/src/index.mjs sync-project-fields --owner perly6185-lab --project 1
```

The Project sync command remains dry-run unless `--apply` is explicit.

### Code Planning Agent

Command:

```text
pnpm ai:code-plan -- --issue 123 --provider openai|command|mock
```

The code planning agent reads the issue, repository snapshot, and engineering
docs, then returns:

- Branch name.
- Implementation steps.
- Proposed files.
- Verification commands.
- Risk review.
- Scope guards.
- Follow-up issue candidates.

This command does not edit files. It produces an auditable plan for a coding
agent or human engineer.

### Review Agent

Command:

```text
pnpm ai:review -- --pr 123 --provider openai|command|mock
```

The review agent reads the PR metadata and patch, then produces findings-first
review output:

- Blocking findings if any.
- Missing tests.
- Security/data/cost/local execution/release risk notes.
- A review decision: approve, comment, or request changes.

Use `--comment` only when the review should be posted to GitHub.

### Work Runner

Command:

```text
pnpm ai:work-runner -- --issue 123 --provider openai|command|mock
```

The work runner connects an issue to a branch and evidence directory. It is
dry-run by default. With `--apply`, it can:

- Create the issue branch.
- Write model plan and run manifest under `.myagenttool/runs`.
- Write the trusted coding adapter contract for the run.
- Pass context to a configured coding adapter through
  `MYAGENTTOOL_WORK_CONTEXT`.
- Run standard verification unless `--skip-verify` is explicit.
- Open a PR with `--open-pr`.

The runner never executes shell commands proposed by the model. A configured
coding command is a separate trusted adapter and must obey repository policy.

### Trusted Coding Adapter

Command:

```text
pnpm ai:work-runner -- --issue 123 --provider openai|command|mock --apply --coding-adapter codex
pnpm ai:work-runner -- --issue 123 --provider mock --apply --coding-adapter mock
pnpm ai:manifest -- --issue 123 --pr 456
node tools/ai/src/index.mjs coding-adapter-contract --adapter codex
```

Supported adapter slots are `mock`, `codex`, `claude`, `qwen-code`,
`openclaw`, `qclaw`, and `command`. The named CLI adapters are contract slots;
each production adapter must be configured through a trusted wrapper command,
not raw model output.

Command-backed adapters are configured as JSON argv arrays, for example:

```text
MYAGENTTOOL_CODEX_COMMAND_JSON='["codex","exec"]'
```

or:

```text
pnpm ai:work-runner -- --issue 123 --provider mock --apply \
  --coding-adapter command \
  --adapter-command-json '["node","tools/internal-coding-wrapper.mjs"]'
```

The runner executes adapter commands without a shell. The adapter receives:

- `MYAGENTTOOL_WORK_CONTEXT`
- `MYAGENTTOOL_WORK_PLAN_FILE`
- `MYAGENTTOOL_WORK_MANIFEST_FILE`
- `MYAGENTTOOL_WORK_EVIDENCE_DIR`
- `MYAGENTTOOL_WORK_BRANCH`
- `MYAGENTTOOL_WORK_ISSUE`

The adapter must write `adapter-result.json` in
`MYAGENTTOOL_WORK_EVIDENCE_DIR` with:

- `status`
- `summary`
- `changedFiles`
- `commandsRun`
- `risks`

It may also write stdout/stderr logs. Evidence must not include secrets or broad
local file dumps.

## Providers

### OpenAI Provider

Use:

```text
OPENAI_API_KEY=...
OPENAI_MODEL=...
pnpm ai:pm -- --idea "..." --provider openai
```

The OpenAI provider uses the Responses API with strict JSON schema output. The
model name is explicit by environment variable so the choice is visible in logs
and can later be connected to the economic ledger.

### Command Provider

Use:

```text
MYAGENTTOOL_AI_COMMAND="your-agent-command"
pnpm ai:code-plan -- --issue 123 --provider command
```

The command provider sends a JSON payload on stdin and expects JSON on stdout.
This is the adapter path for Codex, Claude, Qwen Code, OpenClaw/QClaw-style CLI
agents, or an internal model gateway.

### Mock Provider

Use:

```text
pnpm ai:review -- --pr 123 --provider mock
```

The mock provider is deterministic and exists for repository checks, demos, and
workflow validation. It must not be represented as a real model decision.

## Safety Rules

- No provider is selected implicitly. Use `--provider` or
  `MYAGENTTOOL_AI_PROVIDER` so provider choice is visible in logs and review.
- No production deploy, merge, billing change, or desktop distribution happens
  without a human gate.
- Model output is treated as a proposal until verification evidence exists.
- Secrets and broad local file content are not sent by default.
- Model-proposed shell commands are never executed directly.
- Coding adapters are registry-selected and command-backed adapters use JSON
  argv arrays instead of shell strings.
- Work runner apply mode refuses dirty worktrees before any adapter runs.
- High-risk work should create or link a risk issue.

## Acceptance

The model-driven layer is acceptable when:

- `pnpm ai:check` passes.
- `pnpm ai:pm -- --provider mock` returns a structured PM brief.
- `pnpm ai:issue-tree -- --provider mock` returns a governed issue draft.
- `pnpm ai:code-plan -- --provider mock` returns a scoped implementation plan.
- `pnpm ai:review -- --provider mock` returns findings-first review output.
- GitHub AI Review workflow can run on PRs.
- Work runner dry-run and apply modes are visibly separate.
- `coding-adapter-contract` documents the adapter input, output, and evidence
  contract.
- The mock coding adapter can create deterministic run evidence.
