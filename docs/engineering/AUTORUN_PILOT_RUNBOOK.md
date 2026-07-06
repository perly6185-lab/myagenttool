# Auto-run field pilot — operator runbook

How to activate the autonomous issue→worktree→agent→PR loop against a real
repository with a real coding agent, as exercised by the 2026-07 field pilot
(sandbox: `perly6185-lab/devdemo`). Every autonomous surface is opt-in; this
runbook is the explicit opt-in.

## Prerequisites

- `gh` authenticated with write access to the target repository.
- The coding agent CLI on PATH (the pilot used `claude`; `codex` also works).
- A local clone of the target repository (worktrees are created as siblings).
- Labels in the target repo: `auto`, `status/backlog`, `status/ready`,
  `status/in-progress`, `status/review`.

## 1. The decision agent command

Any script that reads `{ link, issueBody }` as JSON on stdin and prints the
decision contract as JSON on stdout. The pilot's wrapper (cheap/fast model,
prose-wrapped JSON is tolerated):

```js
// decider.mjs — pilot decision agent wrapping the claude CLI
import { execFileSync } from "node:child_process";
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  const { link, issueBody } = JSON.parse(raw);
  const prompt = [
    "You are an issue triage agent. Decide the execution path for this GitHub issue.",
    "Paths: develop (a concrete, scoped change), design (open solution space; produce a design first),",
    "prototype (deep uncertainty; a runnable spike beats analysis),",
    "clarify (under-specified; specific questions must be answered first).",
    "",
    `Issue #${link.number}: ${link.title}`,
    "",
    issueBody ? `Description:\n${String(issueBody).slice(0, 4000)}` : "(no description)",
    "",
    'Respond with ONLY a JSON object, no prose, no code fences:',
    '{"path":"develop|design|prototype|clarify","spawnChildIssues":boolean,"confidence":0..1,"rationale":"one sentence","clarifyingQuestions":["only when clarify"]}',
    "spawnChildIssues should be true only for design/prototype where a follow-up implementation issue makes sense.",
  ].join("\n");
  process.stdout.write(execFileSync("claude", ["-p", prompt, "--model", "haiku"], { encoding: "utf8", timeout: 110_000, maxBuffer: 1024 * 1024 }));
});
```

Any failure (timeout, junk output, missing binary) falls back to the title
heuristic; the run never fails on the decider.

## 2. Server environment

```bash
SERVER_PORT=5101 \
MYAGENTTOOL_STATE_PATH=/path/to/pilot-state.json \
MYAGENTTOOL_PROJECT_PATH=/path/to/target-repo-clone \
MYAGENTTOOL_AUTOTRIGGER_ENABLED=1 \
MYAGENTTOOL_AUTOTRIGGER_LABEL=auto \
MYAGENTTOOL_AUTOTRIGGER_MAX_CONCURRENT=1 \
MYAGENTTOOL_AUTORUN_DECIDER_COMMAND_JSON='["node","/path/to/decider.mjs"]' \
MYAGENTTOOL_AUTORUN_DECIDER_TIMEOUT_MS=120000 \
MYAGENTTOOL_AUTORUN_STATUS_WRITEBACK=1 \
MYAGENTTOOL_AUTORUN_SPAWN_ISSUES=1 \
node apps/server/src/index.mjs
```

Optional: `MYAGENTTOOL_AUTORUN_VERIFY_COMMAND_JSON` (e.g. `'["mvn","-q","test"]'`)
— when the toolchain is unavailable locally, leave it unset and PRs open
honestly labelled *unverified* rather than faking a pass.

Optional: `MYAGENTTOOL_AUTORUN_JUDGE_COMMAND_JSON` — the acceptance judge
(Phase B): a one-shot command reading `{ link, issueBody, diff }` on stdin and
printing `{"solved":bool,"confidence":0..1,"summary":"...","gaps":[...]}`. A
negative verdict BLOCKS the PR with the gaps; a broken judge never blocks (the
PR opens labelled "judge errored"). `MYAGENTTOOL_AUTORUN_JUDGE_TIMEOUT_MS`
defaults to 120s.

## 3. Bridge

```bash
BRIDGE_SERVER_URL=http://127.0.0.1:5101 \
MYAGENTTOOL_BRIDGE_TOKEN_PATH=/path/to/bridge-token.json \
node apps/desktop/src/index.mjs
```

## 4. Agent + project configuration (one-time, via API)

```bash
# The coding agent: claude in acceptEdits mode with a real-work timeout.
curl -X POST :5101/api/agents -H 'Content-Type: application/json' \
  -d '{"type":"cli","command":"claude","permissionMode":"acceptEdits","timeoutSeconds":600}'

# Point the project at it — auto-trigger uses the project's defaultAgentId.
curl -X PATCH :5101/api/projects/<projectId> -H 'Content-Type: application/json' \
  -d '{"defaultAgentId":"agt_claude_acceptEdits"}'
```

## 5. Running

1. Create/label an issue `auto`. Its body must carry `## Project Fields`
   (the trigger's governance gate) — and a good description: the body reaches
   both the decision agent and the coding agent's prompt.
2. Within a scan tick (60s) the decision agent routes it; the run parks at
   **awaiting approval** (a real coding agent is high-risk). Approve it:
   `POST :5101/api/approvals/<id>/approve` or the console's approval card.
3. Watch the console's **Auto-runs** section (or `GET :5101/api/auto-runs`):
   develop → PR opens; design/prototype → findings post back to the issue and a
   pending-decision child issue appears; clarify → questions park for a human.
4. For a spawned child: review the design, label it `auto` — implementation
   starts only then.

## Operational cautions (learned in the pilot)

- **Timeouts**: the bridge kills a run at `adapter.timeoutSeconds` (register the
  agent with ≥600 for real work); the decider needs `DECIDER_TIMEOUT_MS` ≥ the
  CLI's cold-start + inference time.
- **Server restart / bridge pairing**: the bridge credential hash persists with
  the device. If the bridge's saved token is lost, registration is refused
  (`invalid_bridge_credentials`) — recovery: stop the server, null out
  `device.bridgeCredential` in the state file, restart both. Do NOT delete the
  bridge token file while the server keeps the paired hash.
- **Agent health**: verdicts recorded while the bridge was offline used to
  block dispatch forever; since the pilot fix, an `unhealthy` CLI agent is
  re-probed on bridge registration.
- **Status lag**: an approved run's auto-run card stays `awaiting_approval`
  until a terminal state (known observability gap).

## Acceptance judge (Phase B) — field-validated sample

The judge wrapper the pilot validated with the real `claude` CLI (haiku): both
directions verified live — a README-only diff against issue #3 judged
`solved:false` (0.99) with four precise gaps (would block the PR); the pilot's
real implementation diff judged `solved:true` (0.98).

```js
// judge.mjs — pilot acceptance judge wrapping the claude CLI
import { execFileSync } from "node:child_process";
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  const { link, issueBody, diff } = JSON.parse(raw);
  const prompt = [
    "You are an acceptance judge. Decide whether this code diff actually solves this GitHub issue —",
    "not whether the code is pretty, but whether the issue's request and acceptance criteria are met.",
    "",
    `Issue #${link.number}: ${link.title}`,
    "",
    issueBody ? `Issue description:\n${issueBody}` : "(no description)",
    "",
    "The diff:",
    "```diff",
    diff || "(empty diff)",
    "```",
    "",
    'Respond with ONLY a JSON object, no prose, no code fences:',
    '{"solved":boolean,"confidence":0..1,"summary":"one sentence","gaps":["unmet acceptance points, only when solved is false"]}',
  ].join("\n");
  process.stdout.write(execFileSync("claude", ["-p", prompt, "--model", "haiku"], { encoding: "utf8", timeout: 110_000, maxBuffer: 1024 * 1024 }));
});
```

Wire it with `MYAGENTTOOL_AUTORUN_JUDGE_COMMAND_JSON='["node","/path/to/judge.mjs"]'`.

Correction to an earlier caution: bridge polling errors are NOT silent — they
are logged throttled (one line per 5s). The pilot's "silent stall" was the
stale-unhealthy health verdict (fixed: re-probe on registration). The one real
credential UX gap — a raw-stack crash when registration is refused — now prints
the recovery steps instead.
