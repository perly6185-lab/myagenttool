# Application Installation Release Evidence

## Release Candidate

- Scope: Issue #956, the P4 hardening slice for governed Application setup.
- Plan schema: `application-install-plan/v1`.
- Recipe version: `2026-07-14.2`.
- Approval: single-use `application.install` grant bound to the exact plan id.
- Plan validity: ten minutes from issuance, checked by server and Desktop Bridge.

## Supply Chain

| Application | Platforms | Provider | Version policy | Source policy |
| --- | --- | --- | --- | --- |
| ccusage | Windows, macOS, Linux | npm | exact `20.0.14` | canonical npm registry |
| Claude Code | Windows, macOS, Linux | npm | exact `2.1.206` | canonical npm registry |
| Git | Windows | winget | provider-managed stable | explicit `winget` source and exact package id |
| Git | macOS | Homebrew | provider-managed stable | explicit `homebrew/core` formula |

Linux Git installation is intentionally unavailable. `apt-get` requires an
elevation model that the Desktop Bridge does not implement, so P4 fails closed
instead of implying or attempting privilege escalation.

## Security Gates

- Caller-controlled command, argv, package, provider, version, identity, and
  fingerprint fields are rejected.
- Modified, expired, wrong-platform, unsupported, and elevated plans are
  rejected before spawn.
- Approval grants are single-use and replay is rejected.
- Application install runs are team- and device-bound.
- Desktop Bridge uses fixed executable plus discrete argv with `shell = false`.
- Progress summaries redact credential-like assignments and user-home paths.
- Bridge completion accepts only allowlisted status/classification pairs.
- stdout, stderr, environment, credentials, and raw spawn errors are not stored.

## Cancellation And Rollback

- Queued work can be cancelled before dispatch.
- Running install and probe processes poll cancellation and request local
  termination.
- Install and readiness probe use separate approved timeouts.
- Automatic rollback is disabled.
- Automatic uninstall is disabled.
- Every failed, cancelled, timed-out, or refused run records
  `operator_review_required` because the package manager may have modified or
  reused pre-existing state.
- Release rollback is a code rollback to the preceding recipe version; it does
  not silently uninstall software already present on operator devices.

## Platform Evidence

The `application-install-contract` CI job runs the server plan and Desktop
Bridge allowlist suites on:

- `ubuntu-latest`
- `macos-latest`
- `windows-latest`

The suite validates each supported Application/platform pair without invoking a
real package manager. Real package-manager installation remains an explicit
operator-approved local action and is not performed by CI.

## Verification Commands

```text
node --test apps/server/test/application-install-plans.test.mjs
node --test apps/server/test/application-install-plan-routes.test.mjs
node --test apps/server/test/application-install-execution.test.mjs
node --test apps/desktop/test/application-installer.test.mjs
pnpm --filter @myagenttool/web typecheck
pnpm --filter @myagenttool/web test:unit
pnpm --filter @myagenttool/desktop typecheck
pnpm --filter @myagenttool/desktop test:unit
```

## Follow-ups

- #994 tracks the reviewed Linux Git elevation broker and distro-aware package
  policy.
- #995 tracks explicit winget and Homebrew Git version promotion or artifact
  verification.
- Additional package providers must add an immutable server recipe, independent
  Bridge allowlist, cancellation behavior, readiness probe, rollback boundary,
  and three-platform contract evidence before release.
