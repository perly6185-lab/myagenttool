# Enabling risk-based auto-merge — one-page operator checklist

Turn on "auto-merge low-risk PRs, human for the rest". Everything here is
**opt-in, default-off**; the merge guardrail only relaxes for PRs that clear the
STRICT bar. Companion to [AUTORUN_PILOT_RUNBOOK.md](AUTORUN_PILOT_RUNBOOK.md).

## Prerequisites (the loop must already open PRs)
- The auto-run stack is up (server + bridge + coding agent + decider + judge) per the runbook.
- A **verify command** the project can actually run (e.g. `mvn test`, `npm test`) — wired via `MYAGENTTOOL_AUTORUN_VERIFY_COMMAND_JSON` or a per-project named command. Without a passing verify, a PR never reaches LOW risk.
- The repo has **CI that the token can read** (public repo, or a token with Checks:read; the loop also falls back to the GitHub Actions API). Without green CI, a PR never reaches LOW risk.

## Step 1 — configure the AI diff-review command (required for the strict bar)
The review judges **blast radius** (reversibility / subsystems / scope), not size. A `fail` never blocks the PR — it just routes it to a human. Without a review command, nothing auto-merges.

```js
// review.mjs — blast-radius-aware auto-merge review (claude haiku)
import { execFileSync } from "node:child_process";
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  const { link, issueBody, diff } = JSON.parse(raw);
  const prompt = [
    "You decide whether this diff is SAFE TO MERGE WITH NO HUMAN REVIEW.",
    "Judge blast radius, not size: reversibility, subsystems touched, whether it could break",
    "auth/data/CI/deploys, and whether it stays within the issue's scope.",
    "risk:low ONLY if a competent reviewer would rubber-stamp it. When unsure, say medium/high.",
    "",
    `Issue #${link.number}: ${link.title}`,
    issueBody ? `\nDescription:\n${String(issueBody).slice(0, 4000)}` : "",
    "\nThe diff:\n```diff", diff || "(empty diff)", "```",
    "",
    'Respond with ONLY JSON, no prose/fences:',
    '{"risk":"low|medium|high","approve":boolean,"summary":"one sentence","issues":["risks; empty when low"]}',
  ].join("\n");
  process.stdout.write(execFileSync("claude", ["-p", prompt, "--model", "haiku"], { encoding: "utf8", timeout: 110_000, maxBuffer: 1048576 }));
});
```

Wire it (server env), then restart the server:
```
MYAGENTTOOL_AUTORUN_REVIEW_COMMAND_JSON='["node","/path/to/review.mjs"]'
MYAGENTTOOL_AUTORUN_REVIEW_TIMEOUT_MS=120000   # optional, default 120s
```

## Step 2 — UI switches (console → Auto-runs → Configuration → "Quality & merge")
| Control | What it does | Suggested |
|---|---|---|
| **Auto-merge low-risk PRs** | The master switch. Off = today's all-human merge. | On (when ready) |
| **Auto-merge max diff lines** | A PR whose diff exceeds this is never auto-merged (falls to a human). | `400` |
| **Sensitive paths** (one glob per line) | A diff touching any of these is never auto-merged, whatever its size. Empty = the default set. | keep default, add your own |

Default **sensitive paths** (used when the box is empty): `.github/workflows/**`, `**/migrations/**`, `**/package.json`, `**/*.lock`, `**/auth/**`, `**/*.tf`, `infra/**`, `**/Dockerfile`, `**/.env*`.

The card shows a warning if auto-merge is on but no review command is configured (the strict bar could never be met).

## The STRICT bar — a PR auto-merges only when ALL hold
1. **Verification passed** (the verify command ran and exited 0)
2. **Acceptance judge** said `solved` (≥ its confidence floor)
3. **PR CI checks all green**
4. **No prompt-injection** flag on the issue
5. **AI diff review passed** (`risk: low`)
6. **Diff ≤ max diff lines** and **touches no sensitive path**

Anything short of all six → **medium/high** → stays in the human merge dialog (with the posture checklist + inline diff preview). The console shows a `risk: low/medium/high` badge on every open-PR card.

## Guardrails (always on)
- **Kill switch** (Autonomy section) halts all autonomy immediately, including auto-merge.
- **Circuit breaker** — consecutive failures pause dispatch + auto-merge.
- Every auto-merge emits an audit event (`auto_run_auto_merged`) + a best-effort alert (set the alert webhook to be told).
- The sweep re-fetches **fresh** CI checks before merging (never trusts a stale poll).

## Verify it's working
1. Open a small, non-sensitive `auto` issue; approve the coding-agent dispatch.
2. Watch the run reach `pr_open`, CI go green, then within ~60s the sweep auto-merges it.
3. Confirm: PR shows MERGED, the issue auto-closed, an `auto_run_auto_merged` event is in the log.
4. To pause instantly at any time: flip the **kill switch** (or turn off Auto-merge low-risk).
