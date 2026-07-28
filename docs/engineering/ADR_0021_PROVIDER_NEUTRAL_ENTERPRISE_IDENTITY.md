# ADR 0021: Local access and enterprise sign-in share one server-enforced identity boundary

Status: proposed · implementation security review conditionally passed for the I1–I7 foundation · 2026-07-27

Date: 2026-07-27

Related issue: [#1536](https://github.com/perly6185-lab/myagenttool/issues/1536) (Epic [#1534](https://github.com/perly6185-lab/myagenttool/issues/1534))

## Context

MyAgentTool currently seeds a local owner, optionally requires authentication,
accepts a user ID and password, and issues a 30-day bearer token. The API
already resolves every request to a user, team, and role and hides foreign
resources with tenant-scoped checks. This is a useful enforcement base, but it
is not an enterprise identity product:

- local access is implicit rather than an explicit server policy choice;
- the browser holds a bearer token;
- there is no provider-neutral callback or tenant-selection contract;
- account recovery and QR confirmation are undefined;
- identity sign-in can be confused with Application login or message Channel
  registration.

China-based users expect a clear local path and familiar enterprise identity
providers. WeCom, Feishu, and DingTalk differ in authorization endpoints,
application types, tenant identifiers, embedded-QR support, and token response
shapes. Those differences must not change MyAgentTool's user/team/role model.

This ADR designs the boundary. It does not add a provider, render a fake QR
code, or make the current password endpoint production-ready.

## Decision

### 1. The server publishes available identity modes

The unauthenticated client obtains a minimal, non-secret bootstrap document:

```text
GET /api/identity/options

{
  protocolVersion: 1,
  localMode: true,
  passwordMode: true,
  providers: [
    { provider: "feishu", label: "飞书", authorization: "redirect" }
  ]
}
```

The response contains no client secret, tenant secret, callback token, provider
access token, or configured-but-disabled provider. Local mode is shown only
when server policy allows it. Disabling team mode does not silently enable
local mode.

The first screen presents two separate choices:

- **在这台电脑上使用** — local single-user identity, with the local team and
  owner role assigned only by server policy.
- **登录团队** — provider-neutral enterprise sign-in, followed by verified
  team selection where needed.

### 2. One normalized provider contract owns all federation differences

Each provider adapter implements server-only operations:

```text
beginAuthorization(context) -> AuthorizationChallenge
consumeCallback(callback) -> ExternalIdentity
listVerifiedTenants(externalIdentity) -> TenantCandidate[]
refreshOrReverify(link) -> ExternalIdentity
revokeProviderGrant(link) -> best-effort result
```

Normalized values are:

```text
AuthorizationChallenge {
  challengeId, provider, authorizationUri, displayCode,
  expiresAt, pollAfterMs, entry
}

ExternalIdentity {
  provider, issuer, subjectExternalId,
  tenantClaims[], displayName, assurance, authenticatedAt
}

TenantCandidate {
  tenantExternalId, displayName, membershipExternalId, verified
}
```

Adapters may not assign a MyAgentTool role or team. The identity core links the
tuple `(provider, issuer, tenantExternalId, subjectExternalId)` to an existing
membership. A verified upstream tenant claim is still not authorization:
server-side membership and role records remain authoritative.

Provider access and refresh tokens stay encrypted in server-side provider
credential storage when they are required at all. They are never returned to
the browser, copied into a Channel record, or reused as an Application
credential.

### 3. QR entry is an expiring, browser-bound authorization transaction

The browser asks the server to begin a transaction. The server creates at
least 256 bits of random entropy, stores only a hash of the secret portion, and
binds the transaction to:

- provider and exact registered redirect URI;
- pre-authentication browser session;
- installation/device context shown to the user;
- PKCE verifier where the provider supports it;
- creation time, expiry, and single terminal state.

The default MyAgentTool QR challenge lifetime is **120 seconds**. A provider's
shorter lifetime wins. The security-core challenge state machine is:

```text
pending -> authorized -> consumed
        -> expired | rejected | cancelled | failed
```

Provider adapters may report display, scan, confirmation, and tenant-selection
progress as non-authoritative presentation metadata; those labels cannot widen
the core state machine. Every core transition is compare-and-set. `consumed`,
`expired`, `rejected`, `cancelled`, and `failed` are terminal. Replaying either
a callback code or a challenge
returns a generic failure, revokes any session accidentally minted from the
same transaction, and emits a security audit event.

The browser never constructs a QR from a provider URL. It displays only a
server-issued authorization artifact after Content Security Policy and
provider allow-list checks. Until that endpoint exists, production UI shows a
normal redirect action; the design prototype deliberately contains no
scannable QR.

For cross-device confirmation, both screens show the same short comparison
code plus the MyAgentTool origin and computer label. The provider-side
confirmation must state the requested team and action. The desktop reveals no
person or team details on a shared screen until confirmation succeeds.

### 4. Tenant selection is explicit and fail-closed

If exactly one verified tenant maps to one active membership, the server may
continue after showing the team in the confirmation step. Multiple memberships
always require explicit selection. A tenant is never inferred from email
domain, display name, the first provider result, message-channel membership, or
an unverified callback field.

Selecting a tenant rotates the pre-authentication session and mints a new
MyAgentTool session bound to one user, one team, one role snapshot, and one
device context. Switching teams rotates the session again; a session cannot
carry multiple active tenant scopes.

Unknown or disabled memberships fail with a generic Chinese message and a
request-to-admin path. They never auto-provision an owner. Just-in-time
provisioning, if later allowed, is a separate reviewed policy and defaults to
the least-privileged role.

### 5. Team sessions move to server-managed cookies

Enterprise and password sessions use opaque random identifiers stored hashed
at rest and delivered in `Secure`, `HttpOnly`, `SameSite=Lax` cookies. Login,
tenant switch, recovery, privilege change, and password change rotate the
session identifier. State-changing requests retain server-side authorization
and add CSRF protection.

Initial policy:

- 30-minute idle timeout and 12-hour absolute lifetime for team sessions;
- optional trusted-device renewal is a separate opt-in policy;
- current-device logout revokes that session immediately;
- “退出所有设备” increments a user session epoch and revokes every session;
- disabling a membership or changing a role invalidates or re-evaluates live
  sessions before the next protected action.

Local desktop deployments may use the same cookie contract over loopback. No
unauthenticated request receives the local owner's authority when
authentication is required.

### 6. Password fallback and recovery are separate, rate-limited paths

Account/password is a configured fallback, not a provider impersonation path.
The login identifier is tenant-aware and errors are generic. Server policy sets
rate limits, progressive delay, lockout alerting, password requirements, and
optional second-factor requirements.

Recovery behavior:

- team users request help from a verified team administrator;
- administrators issue a hashed, single-use, purpose-bound recovery token with
  a 15-minute lifetime;
- completing recovery rotates the password credential and revokes all sessions;
- local owners recover through a local administrative command requiring host
  access, never through a web “magic owner” route;
- neither password nor recovery secrets appear in URLs, logs, analytics, audit
  details, or client storage.

### 7. Logout is a MyAgentTool security action

“退出登录” revokes the current MyAgentTool session before clearing the UI.
“退出所有设备” is separately confirmed. Provider-global logout is not implied:
MyAgentTool may best-effort revoke its provider grant but does not claim to sign
the person out of WeCom, Feishu, or DingTalk.

The logged-out screen states which computer was disconnected from the account
and offers local or team entry only according to fresh server policy.

### 8. Identity, messaging, and application authorization remain separate

Three credential classes have distinct storage, scopes, APIs, audit event
families, and settings:

| Boundary | Purpose | May identify a console actor? |
| --- | --- | --- |
| Identity provider | Sign a person into a MyAgentTool team | Yes, after membership verification |
| Message Channel | Receive/send governed conversation messages | No |
| Application credential | Authorize a runtime or external capability | No |

A WeCom/Feishu/DingTalk Channel registration cannot create a login, and an
identity provider token cannot send messages. Codex, GitHub, and other
Application credentials never satisfy console identity.

## Threat model and required mitigations

| Threat | Required mitigation and user-visible behavior |
| --- | --- |
| QR replay | Hashed high-entropy challenge, 120-second maximum, single terminal transition, one-time callback code, session rotation, replay audit. |
| Login CSRF / code injection | Browser-bound one-time `state`; PKCE S256 when available; exact callback URI; issuer/provider check; callback consumed once. |
| Provider mix-up | Provider fixed at challenge creation; distinct callback routing or validated issuer; token endpoint chosen only from server configuration. |
| Phishing QR | QR/redirect artifact comes only from server allow-listed provider configuration; desktop and phone show origin, computer, comparison code, requested team, and explicit confirm/deny. |
| Wrong tenant binding | Accept only verified tenant identifiers; map through active server membership; explicit choice for multiple teams; never trust display name or email suffix. |
| Expired code | Stop polling, mark terminal, clear the artifact, explain that no login occurred, and offer “刷新登录码”. |
| Shared screen disclosure | Before confirmation show no avatar, legal name, email, phone, or team list; after completion show only the selected team and display name. |
| Stolen browser session | HttpOnly Secure cookie, idle/absolute expiry, rotation after authentication and tenant switch, revocation, CSRF protection. |
| Brute-force password/recovery | Generic responses, rate limits, progressive delay, admin alerts, hashed single-use recovery tokens. |
| Role or membership drift | Server remains authoritative on every request; invalidate or re-evaluate sessions on role/team changes. |

Security event names are stable and metadata-only:

```text
identity.challenge.created
identity.challenge.expired
identity.challenge.replayed
identity.provider.rejected
identity.tenant.selected
identity.session.created
identity.session.revoked
identity.recovery.requested
identity.recovery.completed
```

Audit metadata may include internal user/team/provider/challenge IDs, device
context, result, and reason code. It must not include QR payloads, authorization
codes, access/refresh tokens, passwords, recovery tokens, or raw OAuth payloads.

## Provider capability isolation

| Provider | Candidate entry | Adapter-owned differences | Shared core must receive |
| --- | --- | --- | --- |
| WeCom | QR or redirect, depending on enterprise/application type | Corp/application identifiers, member vs administrator flow, identity and enterprise lookup | issuer, subject, verified enterprise ID, membership |
| Feishu | OAuth redirect; embedded QR only when the current official flow supports it | authorization host, app type, user token exchange, tenant/open identifiers | issuer, subject, verified tenant ID, membership |
| DingTalk | QR or redirect according to current application type | login widget/authorization endpoint, temporary code exchange, organization identifiers | issuer, subject, verified organization ID, membership |

No provider is enabled merely because its name appears in this table.
Implementation must verify the current official contract, application type,
Mainland endpoints, callback-domain rules, code lifetime, and token storage
requirements during that provider's security review.

## Simplified Chinese flow contract

The executable design prototype is
[china-identity-entry.html](../design/prototypes/china-identity-entry.html).
It covers:

1. choose “在这台电脑上使用” or “登录团队”;
2. wait for phone confirmation without exposing a fake QR;
3. choose a verified team;
4. recover an expired code with “刷新登录码”;
5. recover provider rejection with “换一种方式” or password fallback;
6. request administrator-assisted account recovery;
7. review the active team/device in “我的”;
8. confirm current-device or all-device logout.

## Rollout gates

Provider implementation is blocked until:

- this ADR is accepted by security and product owners;
- session-cookie, CSRF, challenge-store, and audit schemas pass threat review;
- local-mode policy no longer depends on an implicit fallback actor;
- provider conformance tests use vendor sandboxes and real callbacks;
- red-team tests cover replay, mix-up, wrong tenant, shared screen, expiration,
  rejection, and logout;
- staged rollout can disable each provider independently without enabling local
  mode or password fallback.

The I7 shared callback core and synthetic conformance harness now exercise
state, PKCE S256, nonce, issuer/redirect binding, one-time code use, tenant
claims, timeout, sanitized failure, authorization-origin allow-listing, and
independent provider kill switches. These fixtures are offline and contain no
production secret or real personal data. They do not satisfy the gate above:
I8–I10 must still verify each current vendor contract with its official
sandbox and real callback behavior.

The review-ready dependency tree is in
[CHINA_IDENTITY_IMPLEMENTATION_TREE.md](../design/CHINA_IDENTITY_IMPLEMENTATION_TREE.md).
The implementation security review and remaining release blockers are in
[ADR_0021_SECURITY_REVIEW.md](../security/ADR_0021_SECURITY_REVIEW.md).

## Consequences

- The familiar login entry does not weaken the existing team/role boundary.
- Provider work becomes additive behind one contract.
- Team sign-in requires migration away from browser-held bearer tokens.
- Real QR support ships later and only with a server challenge endpoint and a
  reviewed provider adapter.
- Local development remains possible, but local owner authority becomes an
  explicit deployment policy rather than an authentication fallback.

## Alternatives considered

- **Add three provider buttons directly to the existing password popover.**
  Rejected: it would expose provider differences in the UI and leave tenant,
  replay, session, and recovery behavior undefined.
- **Reuse message Channel identities.** Rejected: inbound messaging proves a
  channel sender under a different credential and threat boundary; it does not
  establish a console session or role.
- **Render a decorative QR while backend work follows.** Rejected: users may
  scan or trust a nonfunctional artifact, and it bypasses the transaction
  binding this ADR requires.
- **Keep 30-day bearer tokens in browser storage for enterprise mode.**
  Rejected: long-lived script-readable credentials enlarge the impact of XSS
  and do not provide the required session rotation and server revocation model.

## References

- [RFC 9700: OAuth 2.0 Security Best Current Practice](https://www.rfc-editor.org/rfc/rfc9700.html)
- [RFC 8628: OAuth 2.0 Device Authorization Grant](https://www.rfc-editor.org/rfc/rfc8628.html)
- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0-18.html)
- [Feishu browser web authorization guide](https://open.feishu.cn/document/sso/web-application-end-user-consent/guide)
- [DingTalk official login tutorials](https://open.dingtalk.com/tutorial/)
- [WeCom developer documentation](https://developer.work.weixin.qq.com/document/)
