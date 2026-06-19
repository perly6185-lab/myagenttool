# Platform Support

myagenttool should support macOS, Windows, and Linux desktop terminals from the
first architecture pass.

The cloud control plane should stay platform-neutral. Platform-specific behavior
belongs in the Desktop Local Agent Bridge.

## Supported Platforms

```text
macOS
Windows
Linux
```

## Bridge Responsibilities

The bridge must provide a common interface for:

- Device registration.
- Agent discovery.
- CLI command probing.
- HTTP endpoint probing.
- MCP server config discovery.
- Process execution.
- Process cancellation.
- Environment variable handling.
- Working directory validation.
- Local credential storage.
- Local approval prompts.
- Lifecycle operations.
- Log capture and upload.

## Platform Abstraction Points

### Process Execution

The bridge should execute commands as structured argv values, not shell strings.

Platform differences to isolate:

- Executable lookup.
- File extensions such as `.exe`, `.cmd`, and `.ps1` on Windows.
- Signal and process tree cancellation.
- PTY support when an agent requires terminal semantics.
- Exit code mapping.

### Paths

The protocol should not assume one path format.

Platform differences to isolate:

- Windows drive paths.
- UNC paths.
- POSIX paths.
- Case sensitivity.
- User home directory resolution.
- Config and cache directory locations.

### Environment

Environment handling must be explicit.

Platform differences to isolate:

- Case-insensitive environment keys on Windows.
- Shell initialization files on macOS and Linux.
- Login shell versus non-login process behavior.
- Path separator differences.

### Credentials

Local secrets should stay local when possible.

Recommended storage:

- macOS: Keychain.
- Windows: Credential Manager or DPAPI-backed storage.
- Linux: Secret Service when available, with a documented fallback.

### Notifications and Approval

High-risk invocations and lifecycle operations may require local approval.

The bridge should support native prompts or tray notifications on each platform.

### Service and Autostart

The bridge should support starting with the user session.

Platform-specific options:

- macOS: LaunchAgent.
- Windows: Startup entry, scheduled task, or service depending on privilege.
- Linux: systemd user service, desktop autostart, or package-specific service.

## Installation Recipes

Agent installation recipes must declare supported platforms.

Example:

```json
{
  "id": "recipe_codex_cli",
  "agentName": "Codex CLI",
  "platforms": ["macos", "windows", "linux"],
  "install": {
    "macos": ["npm", "install", "-g", "@openai/codex"],
    "windows": ["npm", "install", "-g", "@openai/codex"],
    "linux": ["npm", "install", "-g", "@openai/codex"]
  },
  "probe": {
    "command": "codex",
    "args": ["--version"]
  }
}
```

Recipes should be reviewed and allowlisted before use.

## Milestone Boundary

M0 should support all three platforms at the protocol and bridge design level,
but platform feature depth can be incremental.

M0 target:

- Manual registration on macOS, Windows, and Linux.
- Conservative CLI discovery on macOS, Windows, and Linux.
- HTTP adapter support on macOS, Windows, and Linux.
- Local process invocation with structured argv.

M1 target:

- Enable and disable in the registry across all platforms.

Deferred:

- Native installers for every platform.
- Full system service management.
- Deep package manager integration.
- Complete PTY compatibility for interactive agents.
