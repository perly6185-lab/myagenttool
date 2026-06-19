# Extension Distribution

myagenttool should support safe distribution of adapters, recipes, platform
agents, and generated integration artifacts.

The goal is to make extension possible without allowing silent execution of
untrusted code.

## Extension Types

```text
adapter_config
adapter_plugin
install_recipe
health_check
schema
redaction_policy
permission_policy
platform_agent
test_case
```

## Distribution Channels

```text
local_file
workspace_catalog
private_catalog
public_marketplace
generated_artifact
```

## Trust Requirements

Extensions should include:

- Name.
- Version.
- Author.
- Source.
- Supported platforms.
- Required permissions.
- Capability risk tags.
- Checksum.
- Signature when distributed beyond local use.
- Compatibility range.
- Review state.

## Signing and Verification

M3 and later should support signed extension bundles.

Verification should happen before:

- Installing an agent.
- Enabling an adapter plugin.
- Running generated code.
- Publishing to a shared catalog.

## Versioning and Rollback

Extensions should be versioned.

The platform should track:

- Installed version.
- Enabled version.
- Previous version.
- Rollback availability.
- Migration notes.

## Milestone Boundary

M0 should avoid extension distribution.

M1 should allow local declarative configs.

M2 should store generated artifacts with version history and review state.

M3 should support:

- Private catalog.
- Signed bundles.
- Compatibility checks.
- Rollback metadata.

M4 or later can consider:

- Public marketplace.
- Automated publishing workflow.
