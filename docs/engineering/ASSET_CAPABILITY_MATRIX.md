# Local asset capability matrix

Assets are part of the existing task lifecycle. They do not create a second
workflow and they never move a task to another terminal. The owning terminal
discovers, reads, previews, mutates, exports, and records evidence. Other
terminals may receive bounded metadata and a deep link only.

The executable source of truth is
`apps/server/src/services/asset-capabilities.mjs`. Unsupported verbs are absent
from the descriptor.

| Family | Preview | Inspect | Create/edit | Render/compare | External/evidence | Readiness notes |
| --- | --- | --- | --- | --- | --- | --- |
| Canvas | yes | yes | governed | yes | yes | built in |
| Word | yes | yes | governed | compare | yes | local Application |
| Excel | yes | yes | governed | compare | yes | local Application |
| PowerPoint | yes | yes | governed | yes | yes | local Application |
| Markdown | yes | yes | native | yes | yes | built in |
| PDF | yes | yes | no | no | yes | bounded/range read |
| DXF | yes | yes | no | render | yes | read-only native path |
| DWG | when ready | when ready | no | when ready | yes | approved ODA runtime required |
| Image | yes | yes | no | compare | yes | transforms require a later capability |
| Video | safe playback | metadata | no | no | yes | range streaming; no editing/transcoding |
| Unknown | no | metadata | no | no | external only | never guess an editor |

## Descriptor and safety

`AssetDescriptor` carries a stable identity, project/worktree association,
immutable `terminalId`, project-relative path, family/MIME, byte size,
SHA-256/version, explicit capabilities, readiness, sensitivity, and bounded
preview policy. Resolution checks both lexical and real filesystem containment,
including symlink targets. Full binary content is never returned in the
descriptor or persisted in task/control-plane state.

SVG, Office HTML, CAD render output, images, and media are untrusted. Preview
implementations must prohibit script execution, remote resources, host paths,
forms, and object embedding. Video uses byte ranges rather than control-plane
copies.

## Task, queue, and trace contract

A task may carry `inputAssets`, `requiredCapabilities`, and `outputAssets`.
Every reference retains its path, family, terminal, hash/version, capabilities,
and readiness summary. Queue preflight returns:

- `ready` when the owning terminal satisfies every required verb;
- `waiting_capability` when its local Application/runtime is absent;
- `refused` for a terminal mismatch.

Missing capability must never invoke cross-terminal routing. Governed mutation,
destructive overwrite, lossy conversion, and publication continue through the
existing approval and audit paths.

The trace sequence is:

`input asset/hash → capability invocation → output asset/hash/version → preview
or comparison → verification → approval (when required) → evidence`

All records retain one work-item identity, trace identity, and immutable
terminal identity. A multi-terminal UI may show family, bounded size/version,
readiness, task association, safe thumbnail reference, and an owning-terminal
deep link; it may not download, edit, transform, or relocate the asset.
