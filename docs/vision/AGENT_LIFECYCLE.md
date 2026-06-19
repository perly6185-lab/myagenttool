# Agent Lifecycle

myagenttool can manage the lifecycle of approved local agents through the
Desktop Local Agent Bridge.

Lifecycle management is separate from invocation. Calling an agent answers "run
this task now"; lifecycle management answers "is this agent present, configured,
enabled, healthy, or removable?"

## Supported Lifecycle Actions

```text
discover
install
configure
enable
disable
update
uninstall
health_check
```

## Discovery

Discovery finds candidate agents on the local machine.

Initial discovery should be conservative:

- Known CLI commands from a configured allowlist.
- User-provided command paths.
- Known local HTTP endpoints.
- User-provided MCP server configs.
- Existing bridge-managed agent config files.
- Platform-specific config locations for macOS, Windows, and Linux.

Discovery should not scan the entire operating system aggressively in early
milestones.
It should report candidates and let the user decide what to register.

## Installation

Installation is allowed only for approved agent packages or recipes.

An install recipe describes:

- Agent name and source.
- Supported platforms: macOS, Windows, Linux, or a subset.
- Install command or package manager command.
- Expected binary, endpoint, or MCP config after install.
- Required permissions.
- Health check.
- Uninstall command when available.

The desktop bridge executes installation locally. The cloud records the request,
policy result, logs, and final state.

## Enable and Disable

Disabling an agent should block new invocations without necessarily uninstalling
the underlying software.

Disable may mean one of these depending on adapter type:

- Mark the agent disabled in the registry.
- Stop a bridge-managed local process.
- Stop routing invocations to the agent.
- Revoke or pause the agent's local credential access.

Enable reverses the managed disabled state after policy checks and optional
health checks.

## Update

Updates should be recipe-driven and version-aware.

The bridge should record:

- Current version.
- Target version.
- Update command.
- Logs.
- Health check result.
- Rollback availability, when supported by the agent.

## Uninstall

Uninstall is high risk and should require explicit local approval by default.

For M3, uninstall can be limited to bridge-managed agents. For manually
registered agents, myagenttool may remove the registry entry without deleting
the underlying software.

## Lifecycle States

```text
discovered
installing
installed
enabled
disabled
updating
uninstalling
uninstalled
failed
unknown
```

## Lifecycle Flow

```text
1. User opens Web Console.
2. User selects a device.
3. Web Console requests agent discovery.
4. Server sends discovery request to Desktop Bridge.
5. Bridge discovers candidate agents and returns results.
6. User registers or installs an agent.
7. Bridge performs local action after local policy checks.
8. Server records lifecycle events and updates registry state.
9. Web Console shows the agent as available, disabled, failed, or unknown.
```

## Milestone Boundary

M0 should support:

- Manual registration.

M1 should support:

- Conservative discovery.
- Enable and disable.
- Health check.

M3 should support:

- Install only from explicit recipes.

Deferred until M3 or later:

- Full-system auto-discovery.
- Silent installation.
- Silent uninstall.
- Background auto-update.
- Complex rollback.
- Package-manager support across every ecosystem.
