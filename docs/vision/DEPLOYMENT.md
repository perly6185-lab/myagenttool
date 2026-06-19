# Deployment Models

myagenttool should support three deployment models:

```text
SaaS control plane
Self-hosted control plane
Private deployment
```

The Desktop Local Agent Bridge stays local in all models. The main difference
is who operates the control plane, where data is stored, how upgrades happen,
and how commercial responsibilities are handled.

## Common Architecture

All deployment models share the same core shape:

```text
Web Console / API Client
        |
        v
Control Plane
        |
        v
Outbound realtime connection
        |
        v
Desktop Local Agent Bridge
        |
        v
External Agents
```

The cloud or server may request work. The local bridge owns local execution.

## SaaS Control Plane

The myagenttool service operates the control plane.

Best for:

- Individual users.
- Small teams that want the fastest setup.
- Users who do not want to operate backend infrastructure.

Responsibilities:

- myagenttool operates the server, web console, auth, storage, and upgrades.
- Users operate their local desktop bridges and local agents.
- Users decide which local agents, directories, credentials, and model providers
  are connected.

Commercial boundary:

- SaaS subscription, usage-based billing, or hybrid pricing can apply.
- BYOK can allow users to pay model providers directly.
- Platform-managed AI usage can be billed by myagenttool in later milestones.

Data boundary:

- Control-plane metadata, invocation records, traces, and audit records are
  stored in the SaaS control plane.
- Users own their workspace data and should be able to configure retention,
  export, deletion, and device unlink handling.
- Local credentials should stay local when possible.
- Raw prompts, outputs, logs, and artifacts should follow configurable retention
  and redaction policies.

## Self-Hosted Control Plane

Users run the control plane themselves.

Best for:

- Developers who want local-first or homelab operation.
- Small teams that want full data control.
- Organizations evaluating the platform before private deployment.

Responsibilities:

- The user or team operates server, web console, database, queue, object storage,
  and upgrades.
- The desktop bridge still connects outward to the self-hosted server.
- Users manage backups, retention, monitoring, and network access.

Commercial boundary:

- Open-core, license key, support subscription, or paid enterprise features can
  apply later.
- Model provider billing usually remains BYOK.

Data boundary:

- Control-plane data stays in the self-hosted environment.
- Users own backups, deletion, migration, and compliance posture.
- Users own workspace data and choose retention and device unlink behavior.

## Private Deployment

myagenttool is deployed into a customer-controlled environment with stronger
operational and governance requirements.

Best for:

- Teams with sensitive agents or data.
- Enterprises with strict security, compliance, or network controls.
- Environments that require SSO, audit export, private networking, and custom
  retention.

Responsibilities:

- The customer controls infrastructure and data location.
- myagenttool may provide deployment artifacts, upgrade support, and enterprise
  features.
- Customer security teams define identity, network, retention, approval, and
  audit export policies.

Commercial boundary:

- Enterprise license, support contract, or private deployment subscription.
- Platform-managed AI may be disabled, routed through customer-approved
  providers, or connected to private model gateways.

Data boundary:

- Data remains in the customer's environment.
- The customer owns workspace data and defines retention, deletion, export, and
  device unlink policies.
- Audit logs may need immutable storage or export to customer SIEM.
- Secrets should integrate with customer secret managers when available.

## Commercial Editions and Entitlements

The deployment model should be separate from the commercial edition. The product
can support local development, self-hosted use, SaaS, and private deployment
without changing the local bridge trust boundary.

This matrix is a product boundary, not a final pricing plan.

| Capability | Local Developer | Self-hosted | SaaS | Private Deployment |
| --- | --- | --- | --- | --- |
| Control plane hosting | User-run | User/team-run | myagenttool-run | Customer-run or jointly operated |
| Target users | One developer | Individuals and small teams | Individuals and teams | Enterprise or regulated teams |
| Desktop Bridge | Included | Included | Included | Included |
| Manual agent registration | Included | Included | Included | Included |
| Remote invocation and audit | Developer-grade | Included | Included | Included |
| Offline queue and cancellation | Included when implemented | Included | Included | Included |
| Local discovery and health | Included when implemented | Included | Included | Included |
| Install/update/uninstall recipes | Optional/local | Optional | Plan-gated | Enterprise policy-gated |
| BYOK AI provider mode | Included | Included | Included | Included |
| Platform-managed AI | Usually disabled | Optional | Plan-gated | Customer-approved or disabled |
| Agent economic metadata | Included | Included | Included | Included |
| Billing, invoices, credits | Not required | Optional/plugin | Plan-gated | Contract-specific |
| Chargeback export | Not required | Optional | Higher-tier | Included |
| Private extension catalog | Not required | Optional | Higher-tier | Included |
| Signed extension bundles | Optional | Optional | Higher-tier | Included |
| SSO and enterprise identity | Not required | Optional | Higher-tier | Included |
| SIEM and audit export | Local files | Optional | Higher-tier | Included |
| Support and SLA | None or community | Community/support plan | Plan-based | Contract/SLA |

## Entitlement Enforcement

Entitlements should be enforced by the control plane. The Desktop Bridge should
not delete or disable third-party agents just because a license, subscription,
or entitlement changes.

Allowed entitlement effects:

- Hide or disable paid control-plane features.
- Block new platform-managed AI calls when credits or plan access are missing.
- Block new SaaS-hosted invocations if the hosted plan is inactive.
- Restrict enterprise-only export, SIEM, SSO, or private catalog features.
- Mark commercial lifecycle operations as unavailable.

Disallowed entitlement effects:

- Silently delete user data.
- Silently remove local third-party software.
- Silently revoke user-owned BYOK credentials from the local machine.
- Prevent the user from exporting data that belongs to them.
- Prevent device unlinking or credential revocation.

## Expiration and Graceful Degradation

If a commercial entitlement expires, the product should degrade predictably:

- Keep login, data export, audit inspection, and device unlink available for a
  grace period.
- Stop creating new paid hosted work before deleting or hiding existing records.
- Preserve finalized billing, ledger, chargeback, and audit records.
- Keep local bridge state recoverable by relinking when possible.
- Show clear status in the Web Console and API.

Private deployments may use contract-specific grace periods, offline license
files, or customer-controlled entitlement services.

## Deployment-Aware Product Requirements

The product should avoid hard-coding assumptions about deployment mode.

Required abstractions:

- Auth provider.
- Database.
- Realtime transport.
- Object/artifact storage.
- Secret storage.
- AI provider gateway.
- Audit sink.
- Billing mode.
- Notification sink.

## Upgrade and Migration

Each deployment model needs an upgrade story:

- SaaS: platform-managed rolling upgrades.
- Self-hosted: documented versioned migrations.
- Private deployment: controlled upgrade windows and rollback guidance.

Schema migrations must be explicit and reversible when possible.

## Backup and Recovery

Backup requirements depend on deployment mode.

Important data:

- Users and teams.
- Devices.
- Agents.
- Policies.
- Invocations.
- Traces and spans.
- Audit records.
- Integration artifacts.
- AI usage and billing records.

Local bridge state should be recoverable by re-linking the device when possible.
Device unlinking should follow the user's or owning team's selected data
handling policy.

## Milestone Boundary

M0 should support one simple deployment path:

- Local or developer-run server.
- One web console.
- One desktop bridge.
- One user-owned device.

M1 should make self-hosted operation clearer:

- Documented environment variables.
- Database migration path.
- Basic backup guidance.

M2 should prepare SaaS operation:

- Multi-user and team readiness.
- Usage reporting.
- Quota controls.

M3 should support commercial deployment options:

- SaaS billing.
- Private deployment packaging.
- Audit export.
- Enterprise identity integration.
