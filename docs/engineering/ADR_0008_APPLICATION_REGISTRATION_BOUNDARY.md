# ADR 0008: Executable Applications are platform-shipped, not user-registered

Status: accepted · 2026-07-13

Date: 2026-07-13

Related issue: [#803](https://github.com/perly6185-lab/myagenttool/issues/803)

## Context

An Application can carry an installed wrapper that projects **executable**
capabilities — a `binary` source (git, ccusage) whose wrapper commands spawn a
real local program on the device that owns the invocation's project. The registry
API accepts a `registerApplication` body from any authenticated actor. This ADR
settles whether a **user** may register such an executable Application, or only
the platform.

Two facts frame the decision:

1. **The device allowlist is the real boundary, and it is a closed table.** The
   Desktop Bridge (`apps/desktop/src/local-execution-policy.mjs`) keeps its own,
   independent allowlist and will only dispatch a wrapper spawn whose
   `execCommand` matches a known binary (`git`, `ccusage`) **and** whose
   capability name starts with a known prefix (`app.app_git.`,
   `app.app_ccusage.`). A capability under any other application id is refused by
   default — so a user-registered binary Application is **inert**: it can be
   registered, but nothing on any device will run it.
2. **Registration was recently hardened (#873).** A `binary` source's wrapper
   command must invoke exactly its declared bare binary (`command === source.binary`);
   it can no longer masquerade as `/bin/sh`. The server will not *plan* a foreign
   command even before the device refuses it.

Given (1), letting users register executable Applications adds registry rows that
can never execute — surface area (and an audit/UX trap: a green "registered" app
that silently never runs) with no capability. Letting them execute would require
**loosening the device prefix/binary allowlist**, which the git-Application audit
(2026-07-13) found to be the load-bearing control.

## Decision

**Executable (binary-source) Applications are platform-shipped only.** The
canonical set (`git`, `ccusage`) is seeded through a trusted path
(`createGitApplicationRegistration` / `createCcusageApplicationRegistration`,
invoked by the `*:register-app` tooling). A user may register **non-executable**
Applications (metadata / manual / discovery-only sources), but not one that
projects an executable wrapper capability.

The device's two-part allowlist (bare `execCommand` ∈ {git, ccusage} **and**
capability prefix ∈ {`app.app_git.`, `app.app_ccusage.`}) remains the single hard
boundary and is **not** widened by user input. Adding a third executable
Application is a deliberate platform change: a new seeded registration **plus** a
new device-allowlist entry, shipped together and reviewed as a security change —
never a runtime registry write.

## Consequences

- The registry stays honest: every executable capability shown is one a device
  will actually run. No inert "registered but unrunnable" binary apps.
- Extensibility for executable Applications is a platform release, not a
  self-service action. Accepted: the set of local binaries we let agents drive is
  small and security-sensitive by nature.
- The server-side `binary`-source registration path is retained (the seed uses
  it) with the #873 `command === source.binary` guard; it is simply not a
  user-facing capability for *executable* apps.
- If self-service executable registration is ever wanted, ADR revision would add
  a **per-binary, human-gated device-allowlist review** (issue #803 option B) —
  explicitly not the free-form path.

## Alternatives considered

- **Per-binary allowlist review (option B):** users register a binary app, each
  new binary gated by an explicit privileged device-allowlist entry. Deferred —
  more machinery (allowlist-management + approval flow) than the current need,
  and the device gate stays the control either way.
- **Free registration gated only by the device (option C):** rejected. It only
  becomes non-inert by loosening the device prefix check — the exact boundary the
  audit found load-bearing.
