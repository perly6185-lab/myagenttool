# B1b — Execution sandbox / permission scoping (review doc)

Status: **reviewed 2026-07-07 → Tier 1 IMPLEMENTED (opt-in).** This is the
analysis that decided B1b (AUTORUN_OPERATIONS_PLAN O4). It maps the coding
agent's current execution privileges, the threat model for unattended runs, and
tiered hardening options with the trade-offs and the decisions.

**Review outcome (joint, 2026-07-07):** verified against code — the coding agent
does inherit the bridge's full env (`buildEnv` `inherit_safe`); the MCP path was
already minimized (`buildMcpChildEnv` + `SAFE_MCP_ENV_KEYS`), so **Tier 1 mirrors
that proven pattern**. Confirmed both claude and codex authenticate via the LOCAL
machine login state (keychain / ~/.claude / ~/.codex via HOME), NOT env secrets,
so env minimization does not break auth. **Tier 1 landed opt-in** (policy
`agent_minimal`, flag `MYAGENTTOOL_BRIDGE_MINIMIZE_AGENT_ENV`, default OFF; to be
soak-validated before the default flips). **Tier 2** (FS confinement, macOS
seatbelt first, per-project opt-in), **Tier 3** (egress) and run-as-restricted-user
remain follow-ups.

## Current posture (what the coding agent can actually do today)

A develop run spawns the coding agent (claude `--permission-mode acceptEdits`,
or codex) via the desktop bridge:

- **cwd = the worktree** (`spawnPlan.cwd` from `metadata.worktreePath`). But cwd
  only sets the *starting* directory — it does **not confine** the process.
- **`sandbox: null`** on the claude adapter; **no OS-level sandbox** is applied.
  `acceptEdits` auto-accepts file edits without a per-edit human check, and the
  agent can run shell commands.
- **Environment (`buildEnv`, policy `inherit_safe`)**: for claude (non-codex) it
  returns `{ ...process.env, ...explicitEnv }` — i.e. the agent **inherits the
  bridge process's entire environment**, including any secrets present there.
  (codex additionally gets `sanitizeCodexChildEnv`, which strips only codex
  runtime keys — not general secrets.)
- **Network egress is unrestricted.**

Net: an unattended coding run has roughly the **full privileges of the bridge
user** — it can read files anywhere the user can (`~/.aws`, `~/.ssh`, other
repos, `.env` files), read secrets from the inherited env, make arbitrary
network calls, and write outside the worktree.

**What holds the line today:** the **human approval gate** (a person approves a
develop run before the agent runs) and **B1a** (the untrusted issue body is
isolated in the prompt + a suspicious body is never auto-approved). Both are
real, but both **weaken as we move to unattended volume** (auto-approve /
auto-trigger) — which is exactly what the operations plan is heading toward.

## Threat model (unattended run)

Actor: a malicious or injected GitHub issue (attacker-controlled body/title).
Goal: get the coding agent to act beyond implementing the issue.

| # | Attack | Enabled by | Today's mitigation |
|---|--------|-----------|--------------------|
| T1 | Read secrets from the inherited env | `inherit_safe` = full `process.env` | none (env not minimized) |
| T2 | Read secret files (`~/.aws`, `.env`, other repos) | no FS confinement | none (cwd ≠ confinement) |
| T3 | Exfiltrate over the network | unrestricted egress | none |
| T4 | Write / persist outside the worktree | no FS confinement | none |
| T5 | Prompt injection steers the agent | issue body → prompt | **B1a** (isolate + never-auto-approve-suspicious) + human approval |

B1a addresses T5's *vector*; T1–T4 are about *what a steered (or malicious) run
can reach* once it runs. That is the B1b scope.

## Hardening options (tiered)

### Tier 1 — Env minimization (recommended first; mostly code, high value)
Stop the coding agent inheriting the bridge's full env. Pass a **minimal
allowlist**: `PATH`, `HOME`, locale, and **only** the agent's own auth (the
claude login session / codex `CODEX_HOME` / the API key the agent needs), plus
operator-declared `explicit_env`. Strip everything else.

- **Value:** closes T1 outright; the single biggest, cheapest win.
- **Risk:** getting the allowlist wrong either (a) breaks the agent's auth
  (too aggressive) or (b) leaves a secret in (too permissive). **This is the
  main thing to review together** — exactly which keys claude/codex need.
- **Shape:** a new `environmentPolicy: "agent_minimal"` (or tighten
  `inherit_safe`) in `buildEnv`, defaulting coding agents to it.

### Tier 2 — Filesystem confinement (platform-specific; moderate)
Run the agent under an OS sandbox that restricts reads/writes to the worktree +
the agent's own config dir: macOS `sandbox-exec` (seatbelt profile), Linux
`bubblewrap`/`firejail`. Confines T2/T4.

- **Value:** high (blocks reading `~/.ssh`, writing outside the worktree).
- **Risk/cost:** platform-specific profiles; can break tooling that legitimately
  needs paths outside the worktree (package caches, toolchains). Needs testing
  per platform. Opt-in per project at first.

### Tier 3 — Network egress control (hard)
Restrict the agent's outbound to an allowlist (the model API + `gh`), via a
proxy or per-process firewall. Confines T3.

- **Value:** high (blocks exfiltration).
- **Risk/cost:** highest; needs a proxy/namespace; easy to break legit fetches
  (dependency installs). Likely last / optional.

### Cross-cutting (cheap, no OS work)
- **Run as a restricted user** (a dedicated low-privilege account owning only the
  worktrees) — a big blast-radius reduction without per-platform sandbox code.
- **Keep auto-approve off for develop** (already the case) + require human
  approval for runs whose diff/paths touch sensitive files.

## Recommendation

Do **Tier 1 (env minimization)** first — highest value, mostly code, and it is
the finding most clearly wrong today (full env inheritance). Then **Tier 2**
per-project opt-in. **Tier 3** and run-as-restricted-user as follow-ups. Nothing
here weakens the human approval gate or auto-merge guardrail.

## Decisions needed to build (the review)

1. **Tier 1 allowlist:** confirm the exact env keys claude and codex each need
   to authenticate + run (so minimization doesn't break auth or leak a secret).
2. **Tier 2 scope:** which platform(s) to target first (macOS seatbelt?), and
   whether to make it opt-in per project.
3. **Run-as-restricted-user:** in scope now, or later?
4. **Rollout:** default the coding agents to the hardened env immediately, or
   ship it opt-in and flip the default after a soak?
