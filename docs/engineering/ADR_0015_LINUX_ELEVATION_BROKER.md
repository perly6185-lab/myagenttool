# ADR 0015: Linux install elevation is a per-action polkit broker, never an ambient privilege

Status: accepted · 2026-07-16

Date: 2026-07-16

Related issue: [#994](https://github.com/perly6185-lab/myagenttool/issues/994)

## Context

Governed Application installation (#950/#956) ships per-platform recipes for
Windows (winget) and macOS (Homebrew), both of which install without process
elevation. Linux Git has **no recipe on purpose**: every mainstream package
manager (`apt-get`, `dnf`, `pacman`) requires root, the Desktop Bridge has no
reviewed elevation model, and P4's decision was to fail closed rather than
dispatch `apt-get` with implicit privilege assumptions. The release evidence
doc records this hole; #994 is the reviewed way to close it.

The bridge's execution posture today: fixed executable + discrete argv,
`shell: false`, plan fingerprints mirrored independently on both sides
(anti-tamper), single-use approval bound to the exact plan, cancellation
polled, no automatic rollback. Elevation must not weaken any of that.

## Decision

**Elevation is brokered per action through polkit (`pkexec`), scoped to one
fixed argv from the bridge's own mirrored recipe table, and never cached.**
Five invariants:

1. **The broker elevates exactly one mirrored command.** The elevated argv
   comes from the bridge's OWN recipe table (the same anti-tamper mirror that
   validates plans today) — never from the plan payload, never from the server
   alone. A plan whose argv is not byte-identical to the mirror is refused
   before any privilege is involved (today's behavior, unchanged).
2. **polkit, not sudo.** `pkexec` runs the single command under a shipped
   polkit action/policy file naming the exact executable; there is no
   NOPASSWD sudoers entry, no shell, no environment inheritance
   (`pkexec` scrubs the environment by default — the recipe env, if any, is
   re-applied explicitly from the mirror). Rationale: polkit gives per-action
   authentication UI native to the desktop, auditable action ids, and no
   standing privilege file that outlives the product.
3. **Per-action, never ambient.** Every elevated install is its own polkit
   authentication — the broker never requests `auth_admin_keep`, so no
   elevation outlives its single command. The platform's single-use approval
   grant (server side) and the polkit authentication (device side) are two
   independent consents; both are required, neither substitutes for the other.
4. **Audited like every write.** The install run records that elevation was
   used, the polkit action id, the exact argv, and the exit/classification —
   in the same run lifecycle rows the unelevated path uses. Progress
   summaries keep the existing redaction rules.
5. **Fail closed on every distro we did not review.** The first slice ships
   `apt-get` only (Debian/Ubuntu — the fleet's actual Linux population), with
   the recipe pinned per #995's policy where the provider allows it
   (`apt-get install --yes git=<pinned>*` where feasible, else
   provider-managed recorded explicitly, mirroring the Homebrew exception).
   `dnf`/`pacman` remain fail-closed until each gets its own reviewed recipe —
   distro detection failure refuses, never guesses.

## Consequences

- The Desktop Bridge grows one new capability surface: `elevation:
  { available, mechanism: "polkit", actions: [...] }` in readiness reporting,
  so the console can explain "why can't I install Git here" precisely
  (polkit absent → `needs_setup` guidance, not an opaque spawn failure).
- The recipe schema gains `elevated: true` for the Linux Git recipe — already
  modeled (`recipe(..., { elevated })`) and currently asserted false
  everywhere; the desktop mirror's `plan.execution.elevated !== false` check
  flips to an exact match against the mirror per platform.
- Packaging: the polkit policy file ships with the bridge install and is part
  of the release evidence; removing the product removes the policy (no
  residue).
- Windows/macOS are untouched: winget/Homebrew stay unelevated.
- Out of scope: any elevation for wrapper/agent execution (installs only),
  sudo fallback paths, and distro package managers beyond apt-get in slice 1.

## Testable rules

- A plan carrying `elevated: true` for a platform whose mirror says unelevated
  is refused (and vice versa) — fingerprint + explicit field check.
- The broker refuses to elevate any argv not byte-identical to the mirror.
- A polkit-absent device reports `elevation.available: false` and the plan
  request fails closed with a coded reason (`elevation_unavailable`).
- Audit rows carry `elevated: true` + action id for every elevated run.
- Cancellation of an elevated run terminates the child exactly like the
  unelevated path (pkexec forwards signals to the single child).
