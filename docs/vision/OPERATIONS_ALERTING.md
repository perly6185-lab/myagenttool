# Operations and Alerting

myagenttool should make operational problems visible before users have to dig
through logs.

## Alert Types

```text
device_offline
bridge_reconnect_loop
invocation_failed
invocation_stuck
cancel_failed
queue_backlog
quota_threshold
budget_threshold
agent_health_failed
policy_denied_spike
suspicious_invocation
artifact_upload_failed
integration_test_failed
```

## Notification Channels

```text
web_console
email
webhook
desktop_notification
chatops
siem_export
```

## Operational Metrics

Useful metrics include:

- Device online/offline duration.
- Queue depth by device.
- Invocation success rate.
- Invocation latency.
- Cancellation success rate.
- Agent health check status.
- Bridge reconnect count.
- AI usage and cost.
- Policy denial count.
- Artifact upload failures.

## Alert Policy

Alerts should be configurable by:

- User.
- Team.
- Device.
- Agent.
- Severity.
- Notification channel.
- Quiet hours.

## Milestone Boundary

M0 should show status in the Web Console:

- Device online/offline.
- Invocation status.
- Invocation failure reason.
- Cancel failure reason.

M1 should support:

- Basic health alerts.
- Device offline alert.
- Failed invocation alert.

M2 should support:

- Quota and usage alerts.
- Webhooks.
- Integration test failure alerts.

M3 should support:

- Private deployment alert sinks.
- SIEM export.
- Suspicious invocation alerts.
