# M2 Acceptance Closeout

M2 delivers a review-first Integration Builder path for unsupported CLI and
HTTP agents.

## Delivered Stages

### Stage 1: Discovery UX And Intent Intake

- Web Console accepts user-provided CLI command/path entries and HTTP endpoint
  entries for conservative discovery.
- Desktop Bridge returns user-provided CLI and HTTP candidates without broad
  filesystem or network scanning.
- Explicit Codex-like CLI input can appear as a discovered candidate and is
  marked high risk.
- Web Console captures unsupported-agent intent and structured hints.
- Server records integration plan artifacts in `draft` state.

Acceptance evidence:

- `pnpm --filter @myagenttool/server test`
- `pnpm --filter @myagenttool/web test`
- `pnpm --filter @myagenttool/desktop test`
- `pnpm smoke:local`

### Stage 2: Reviewable Adapter Config

- Integration plan drafts generate reviewable adapter config, health check,
  schema, redaction policy, and test case artifacts.
- Generated artifacts include `generatedByAi` metadata.
- Adapter artifacts can move through review, approval, rejection, archive, and
  back-to-review states.
- Approved artifacts do not automatically register or enable agents.

Acceptance evidence:

- Server self-check covers draft creation, AI-generated artifacts, review
  state transitions, and no automatic enablement.
- Local smoke covers generated artifact set and approval.

### Stage 3: Local Probe And Safety Artifacts

- Approved adapter config artifacts can run an explicit probe.
- CLI probes are queued to Desktop Bridge and do not run install scripts.
- HTTP probes use the reviewed health endpoint.
- Passing probe marks adapter config artifacts `tested`.
- Registration from a tested artifact is explicit and creates a disabled agent.

Acceptance evidence:

- Desktop Bridge probe queue is covered by `pnpm smoke:local`.
- Server self-check verifies tested state and disabled registration.

### Stage 4: Governance, Economics, And Closeout

- Integration artifacts include economics prompts, cost owner, unknown-cost
  visibility, quota decision records, and retention settings.
- Retention settings for integration data can be updated.
- Integration Builder platform agent drafts plans through the normal invocation
  and audit path.
- Platform agent suggestions are advisory and cannot approve, probe, register,
  or enable integrations.

Acceptance evidence:

- Local smoke covers Integration Builder platform-agent draft, audit evidence,
  quota decision records, and retention settings.

## Safety Boundaries Preserved

- No full-system OS scan.
- No network scan.
- No automatic registration from discovery.
- No automatic enablement from generated artifacts.
- No generated code execution.
- No install, update, uninstall, or shell install script execution.
- Codex or other coding CLIs are discovered only when explicitly supplied by the
  user and remain high-risk disabled candidates until reviewed.

## Verification Baseline

```text
pnpm docs:check
pnpm repo:check
pnpm typecheck
pnpm test
pnpm smoke:local
git diff --check
```

## Residual Follow-Up

- Persistent storage should replace demo in-memory artifacts before production
  use.
- Real provider-backed generation should preserve the same review, probe, and
  disabled-registration gates.
- Enterprise quota enforcement remains a later milestone; M2 records decisions
  only.
