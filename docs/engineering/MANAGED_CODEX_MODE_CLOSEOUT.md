# Managed Codex Mode Closeout

Managed Codex Mode uses a platform-managed launch path as the compliance
source of truth. The primary evidence chain is:

```text
managed launcher -> session registry -> JSONL evidence -> hook bridge
-> approval broker -> audit records
```

Imported Codex evidence is explicitly after the fact. It can support debugging
or voluntary review, but it must stay labeled `imported_after_the_fact` and
must not be promoted to a managed session unless MyAgentTool controlled the
launch path.

## Current Demo Boundary

- MyAgentTool registers managed Codex sessions for platform-launched Codex
  invocations.
- Codex JSONL summaries are stored as redacted evidence records.
- Hook bridge events are recorded with summary-only retention.
- PermissionRequest hook events create approval broker requests that can be
  approved or denied from the Web Console.
- Imported evidence records require an explicit summary and are stored with a
  preview-confirmed redaction marker.

## Enterprise Hardening Follow-Up

- Package real Codex hooks through managed config, system config, MDM, or
  `requirements.toml` where available.
- Report effective sandbox, approval, network, hook, MCP, and requirements
  settings from the managed launcher.
- Fail closed when required hooks or policy profiles are unavailable.
- Keep Codex authentication owned by the user or enterprise Codex setup.
  MyAgentTool must not read, copy, or request `~/.codex/auth.json`.
- Treat private session import as an investigation workflow, not a compliance
  path.
