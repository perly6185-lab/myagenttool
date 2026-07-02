export const HELP = `MyAgentTool AI delivery helpers

Usage:
  node tools/ai/src/index.mjs --check
  node tools/ai/src/index.mjs intake-brief --idea "..." [--out path]
  node tools/ai/src/index.mjs pm-brief|pm-agent --idea "..." --provider openai|command|mock [--out path] [--json]
  node tools/ai/src/index.mjs issue-tree --idea "..." --provider openai|command|mock [--brief-file path] [--repo OWNER/REPO] [--out path] [--apply] [--human-approved "reason"]
  node tools/ai/src/index.mjs branch-plan --issue NUMBER --title "..."
  node tools/ai/src/index.mjs code-plan|code-agent --issue NUMBER [--repo OWNER/REPO] --provider openai|command|mock [--out path] [--json]
  node tools/ai/src/index.mjs scope-check [--plan-file path] [--base REF] [--out path] [--json] [--allow-drift "reason"]
  node tools/ai/src/index.mjs testing-plan [--change docs|web|server|desktop|protocol|security|release|adapter] [--changes docs,security,release] [--risk low|medium|high|critical] [--out path] [--json]
  node tools/ai/src/index.mjs run-work|work-runner --issue NUMBER [--repo OWNER/REPO] --provider openai|command|mock [--apply] [--coding-adapter NAME] [--adapter-command-json JSON] [--verify] [--skip-verify] [--open-pr] [--allow-drift "reason"]
  node tools/ai/src/index.mjs loop-list [--json]
  node tools/ai/src/index.mjs loop-show --run RUN_ID [--json]
  node tools/ai/src/index.mjs loop-cancel --run RUN_ID [--reason "..."] [--force]
  node tools/ai/src/index.mjs loop-resume --run RUN_ID [--reason "..."]
  node tools/ai/src/index.mjs loop-retry --run RUN_ID [--apply] [--open-pr] [--skip-verify]
  node tools/ai/src/index.mjs loop-gate-request --run RUN_ID --reason "..." --scope "..." --requested-action "..." [--risk low|medium|high|critical] [--by NAME] [--expires-at ISO]
  node tools/ai/src/index.mjs loop-gate-approve --run RUN_ID --by NAME [--evidence "..."] [--expires-at ISO]
  node tools/ai/src/index.mjs loop-gate-reject --run RUN_ID --by NAME --reason "..."
  node tools/ai/src/index.mjs loop-enqueue --run RUN_ID [--priority normal|high|low|p0|p1|p2|p3] [--timeout-ms N] [--json]
  node tools/ai/src/index.mjs loop-claim --worker WORKER_ID [--run RUN_ID] [--lease-ms N] [--json]
  node tools/ai/src/index.mjs loop-heartbeat --run RUN_ID --worker WORKER_ID [--lease-ms N] [--json]
  node tools/ai/src/index.mjs loop-release --run RUN_ID --worker WORKER_ID [--to queued|planned] [--reason "..."] [--json]
  node tools/ai/src/index.mjs loop-timeout-check [--json]
  node tools/ai/src/index.mjs loop-worker-once --worker WORKER_ID [--run RUN_ID] [--lease-ms N] [--mode mock|child-run] [--child-provider mock] [--child-apply] [--approval "..."] [--isolate-worktree] [--base-ref REF] [--child-skip-verify] [--fail] [--json]
  node tools/ai/src/index.mjs loop-worktree-list [--json]
  node tools/ai/src/index.mjs loop-worktree-show --run RUN_ID [--json]
  node tools/ai/src/index.mjs loop-worktree-cleanup --run RUN_ID --approval "..." [--json]
  node tools/ai/src/index.mjs loop-worktree-diff --run RUN_ID [--patch] [--json]
  node tools/ai/src/index.mjs loop-worktree-review --run RUN_ID [--json]
  node tools/ai/src/index.mjs loop-worktree-promote --run RUN_ID --approval "..." [--json]
  node tools/ai/src/index.mjs loop-worktree-promotion-apply --run RUN_ID --approval "..." [--json]
  node tools/ai/src/index.mjs loop-worktree-promotion-verify --run RUN_ID --approval "..." [--command ID] [--json]
  node tools/ai/src/index.mjs loop-worktree-promotion-pr-prep --run RUN_ID --approval "..." [--json]
  node tools/ai/src/index.mjs loop-worktree-promotion-commit --run RUN_ID --approval "..." [--message "..."] [--json]
  node tools/ai/src/index.mjs loop-worktree-promotion-push-plan --run RUN_ID --approval "..." [--remote origin] [--json]
  node tools/ai/src/index.mjs loop-worktree-promotion-push-preflight --run RUN_ID --approval "..." [--dry-run] [--json]
  node tools/ai/src/index.mjs loop-worktree-promotion-push-execute --run RUN_ID --approval "..." --confirm-commit SHA [--json]
  node tools/ai/src/index.mjs loop-worktree-promotion-pr-create-prep --run RUN_ID --approval "..." [--base main] [--json]
  node tools/ai/src/index.mjs loop-worktree-promotion-pr-create-execute --run RUN_ID --approval "..." --confirm-head BRANCH [--json]
  node tools/ai/src/index.mjs loop-worktree-promotion-pr-merge-prep --run RUN_ID --approval "..." --confirm-pr NUMBER [--allow-no-checks] [--json]
  node tools/ai/src/index.mjs loop-worktree-promotion-pr-merge-execute --run RUN_ID --approval "..." --confirm-pr NUMBER --confirm-commit SHA --merge-method squash|merge|rebase [--json]
  node tools/ai/src/index.mjs loop-routine-check --file path [--json]
  node tools/ai/src/index.mjs loop-routine-plan --file path [--json]
  node tools/ai/src/index.mjs loop-routine-run --file path [--dry-run] [--json]
  node tools/ai/src/index.mjs loop-routine-list [--routine ID] [--status completed|failed|running|unknown] [--limit N] [--json]
  node tools/ai/src/index.mjs loop-routine-latest --routine ID [--json]
  node tools/ai/src/index.mjs loop-routine-show --routine-run RUN_ID [--json]
  node tools/ai/src/index.mjs loop-routine-findings --routine-run RUN_ID [--severity low|medium|high] [--with-suggested-run] [--json]
  node tools/ai/src/index.mjs loop-routine-index-rebuild [--json]
  node tools/ai/src/index.mjs loop-routine-schedule-plan [--no-examples] [--json]
  node tools/ai/src/index.mjs loop-routine-schedule-run [--no-examples] [--dry-run] [--limit N] [--json]
  node tools/ai/src/index.mjs loop-routine-fanout-plan --routine-run RUN_ID [--json]
  node tools/ai/src/index.mjs loop-routine-fanout-execute --routine-run RUN_ID --approval "..." [--enqueue] [--priority normal|high|low|p0|p1|p2|p3] [--timeout-ms N] [--run-worker --worker WORKER_ID --child-provider mock --isolate-worktree] [--child-apply] [--child-skip-verify] [--json]
  node tools/ai/src/index.mjs loop-registry-check [--json]
  node tools/ai/src/index.mjs loop-registry-rebuild [--json]
  node tools/ai/src/index.mjs review-pr|review-agent --pr NUMBER [--repo OWNER/REPO] --provider openai|command|mock [--out path] [--json] [--comment]
  node tools/ai/src/index.mjs work-manifest [--issue NUMBER] [--pr NUMBER] [--out path]
  node tools/ai/src/index.mjs coding-adapter-contract [--adapter NAME] [--out path]
  node tools/ai/src/index.mjs feedback-convert --feedback "..." --target bug|risk|roadmap|documentation [--issue-tree] [--json] [--out path]
  node tools/ai/src/index.mjs eval-heldout [--set DIR] [--resolver mock|command] [--resolver-command-json JSON] [--min-pass-rate 0..1] [--json] [--out path]
  node tools/ai/src/index.mjs feedback-triage [--apply] [--human-approved "reason"] [--report]
  node tools/ai/src/index.mjs eval-subcap [--set DIR] [--provider mock|openai|command] [--min-pass-rate 0..1] [--json] [--out path]

Providers:
  openai   Uses OPENAI_API_KEY and the Responses API.
  command  Runs MYAGENTTOOL_AI_COMMAND or --provider-command with a JSON request on stdin.
  mock     Deterministic local provider for tests and demos.

Notes:
  Model-backed commands require a provider. Use --provider mock only for deterministic validation.
  run-work is dry-run by default. It creates branches, runs trusted coding adapters, verifies, or opens PRs only with --apply.
`;
