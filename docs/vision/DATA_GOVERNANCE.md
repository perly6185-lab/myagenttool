# Data Governance

myagenttool's default data principle is:

```text
User data belongs to the user.
```

For teams, data belongs to the team or organization that owns the workspace,
subject to its membership, role, retention, and deletion policies.

The product should make data location, retention, export, deletion, and device
unlinking behavior explicit.

## Data Categories

### Account and Team Data

- Users.
- Teams.
- Memberships.
- Roles.
- Policy bindings.

### Device Data

- Device identity.
- Bridge version.
- Platform metadata.
- Online/offline state.
- Last seen time.
- Device-bound credentials.

### Agent Data

- Agent registration metadata.
- Adapter configuration.
- Capabilities.
- Lifecycle state.
- Health check results.
- Integration artifacts.

### Invocation Data

- Invocation request metadata.
- Inputs and options.
- Status.
- Delivery state.
- Logs.
- Trace and span records.
- Final output.
- Artifacts.
- Cancellation events.

### AI Usage Data

- Provider.
- Model.
- Provider mode.
- Usage counts.
- Estimated cost.
- Quota decisions.
- Prompt and response retention decision.

### Audit Data

- Who requested an action.
- What resource was affected.
- Where it ran.
- Permission decisions.
- State transitions.
- Approval decisions.
- Final status.

## Ownership

Personal workspace:

- The user owns account, device, agent, invocation, artifact, AI usage, and audit
  data created in that workspace.

Team workspace:

- The team owns workspace data.
- Members access data according to role and policy.
- Ownership transfer should be possible for team continuity.

Private deployment:

- The customer owns all data in its deployment.

Self-hosted deployment:

- The operator owns infrastructure and data storage responsibilities.

## Data Location

The product should clearly show where data lives:

- Local bridge storage.
- SaaS control plane.
- Self-hosted control plane.
- Private deployment.
- External AI provider.
- Object/artifact storage.

Local credentials should stay local whenever possible.

## Retention Policy

Retention should be configurable by data category.

Recommended defaults:

- Keep account, team, device, agent, and policy metadata while the workspace is
  active.
- Keep audit records longer than operational logs.
- Keep raw logs, prompts, responses, and artifacts for shorter periods unless
  explicitly retained.
- Allow users to disable raw prompt and response retention.
- Allow users to configure artifact upload and retention.

## Export

Users and teams should be able to export their data.

Export targets:

- Agent registry.
- Invocation history.
- Trace and span records.
- Audit records.
- Integration artifacts.
- AI usage records.
- Artifact metadata.

Large binary artifacts may be exported separately or by signed download links.

## Deletion

Deletion should distinguish between:

- Soft deletion: hidden from normal views but recoverable for a limited time.
- Hard deletion: permanently removed where technically possible.
- Legal or compliance hold: retained according to policy.
- Immutable audit retention: retained for integrity and accountability.

The UI should explain which category applies before deleting.

## Device Unlinking

When a user unlinks a device, the product should ask how to handle related data.

Supported choices:

```text
keep_history
archive_history
delete_operational_data
delete_all_possible
```

### keep_history

Keep device metadata, invocation history, traces, logs, artifacts, and audit
records. Mark the device as unlinked and prevent future dispatch.

### archive_history

Keep audit records and summarized invocation history. Archive or hide detailed
operational logs and artifacts from normal views.

### delete_operational_data

Delete or redact logs, artifacts, raw prompts, raw outputs, temporary files, and
delivery queue data related to the device. Keep minimum audit records.

### delete_all_possible

Delete all non-required data related to the device where technically and legally
possible. Keep only required immutable audit, billing, or compliance records.

## Local Bridge Data After Unlink

The local bridge should revoke device credentials after unlinking.

The user should be able to choose whether the local bridge:

- Keeps local agent configs for later relinking.
- Clears local agent configs.
- Clears local caches and temporary artifacts.
- Clears local credentials managed by myagenttool.

Local third-party agent credentials not managed by myagenttool should not be
deleted silently.

## Queued Invocation Data

If a device is unlinked:

- Pending queued invocations for that device should be cancelled.
- Running invocations should receive cancellation when the bridge is reachable.
- Future dispatch to that device must be blocked.
- Audit should record the unlink decision and queue cleanup result.

## AI Data

AI usage data should follow the same ownership model as the invocation or
platform feature that caused it.

Prompts and responses should be retained only when explicitly enabled or when
required by workspace policy.

For BYOK mode, users may also need to manage provider-side retention directly
with the provider.

## Milestone Boundary

M0 should support:

- Clear data ownership statement.
- Device unlinking blocks future dispatch.
- Pending queued invocations are cancelled on unlink.
- Basic audit records are retained.

M1 should support:

- Device unlink options.
- Basic export for invocation and audit records.
- Local bridge cache cleanup option.

M2 should support:

- Retention settings for logs, artifacts, prompts, and responses.
- Export for traces, AI usage, and integration artifacts.

M3 should support:

- Private deployment data governance controls.
- Audit export.
- Immutable audit storage options.
- Compliance hold support.
