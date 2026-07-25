# Multi-terminal production acceptance

Scope: one user operating independent single-terminal instances through a
separate composition console. There is no global queue, migration, pooled
capacity, or cross-terminal failover.

| Gate | Automated evidence | Result |
| --- | --- | --- |
| Deployment security | loopback default, explicit TLS proxy gate, expiring admin session, signed webhook replay window | Pass |
| Recovery | restart, network, timeout, disk, failed-upgrade, and rollback owner-local drill | Pass |
| Ordinary UX | first-run pairing guidance, diagnostics-first remediation, desktop/mobile/keyboard browser journey | Pass |
| Trace | terminal, task, Application, Channel, asset, operation, and evidence searchable projection | Pass |
| Alerts | severity, deduplication, acknowledgement, silence, recovery notification, allowlisted retry only | Pass |
| Release | SHA-256 install metadata, persistent backup/restore, upgrade/rollback, 10/50/100-terminal baseline | Pass |

Production use remains restricted to a trusted single-user host or an
authenticated TLS reverse proxy. Secrets belong in host credential management.
Safe automatic recovery is disabled by default and cannot select another
terminal.
