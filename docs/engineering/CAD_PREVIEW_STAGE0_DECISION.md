# CAD preview stage-0 decision (#1470)

Date: 2026-07-22  
Decision: **Go for DXF; conditional Go for DWG**

## Decision

Proceed with the read-only DXF inspection and SVG preview pipeline using a
pinned minimal Python runtime:

- Python 3.12;
- `ezdxf==1.4.4`;
- `Pillow==12.3.0` for the drawing frontend;
- ezdxf's native `SVGBackend`, not the general `ezdxf draw` command.

Do not bundle, download, install, or silently invoke ODA File Converter. DWG
preview is enabled only when an operator has installed an approved converter,
confirmed that their ODA terms permit the intended use, and passed a fixed
local readiness probe. DXF remains usable when ODA is absent.

## Evidence and constraints

### ezdxf

The verified ezdxf 1.4.4 package is MIT-licensed, requires Python 3.10 or newer,
and supports ASCII and binary DXF. Its drawing add-on exposes `RenderContext`,
`Frontend`, layout selection, and `SVGBackend`.

The basic ezdxf install was insufficient for rendering because the drawing
frontend imports Pillow. The official `draw` extra also selects PySide6,
Matplotlib, and PyMuPDF, which are unnecessary for the selected SVG backend.
The product runtime therefore pins the smaller explicit dependency set rather
than installing `ezdxf[draw]`.

`tools/dev/verify-ezdxf-cad-runtime.py` creates an isolated deterministic DXF,
recovers/audits it, extracts layouts/layers/entities/text, and renders bounded
SVG. The verified result contains Model and paper-space layouts, three layers,
LINE/TEXT counts, extracted annotations, a valid SVG root, no script element,
and no external href.

The probe does not make SVG trusted. Production output still requires an
element/attribute allowlist, URL rejection, node/path/byte limits, and a
restrictive CSP.

### ODA File Converter

ODA states that non-members may use the free ODA File Converter only for
non-commercial applications. ODA also publishes only the latest converter to
non-members. This prevents MyAgentTool from treating the public download as a
redistributable, checksum-pinned managed runtime without a separate commercial
license review.

The converter accepts source and target **directories**, a file filter, output
version/type, recursive flag, and audit flag. It processes every matching file
in the source directory. Production invocation must therefore create a private
per-request input directory containing exactly one copied/link-safe source,
select one fixed filename filter, disable recursion, and use a separate private
output directory. It must never point ODA at a project or worktree directory.

The current official distribution targets Linux x64, macOS 13+ arm64/x64, and
Windows 10+ x64. ezdxf's ODA integration documentation warns that external
executable selection is a security boundary and reports that GUI suppression
is platform-dependent: Windows is supported, Linux may require Xvfb, and no
suppression solution is documented for macOS. Consequently, presence of an
executable is not enough for readiness; each supported host must complete a
bounded conversion probe without UI interaction.

No ODA executable is installed on the development host, so stage 0 does not
claim a verified DWG conversion command, exact converter build, checksum, or
headless macOS behavior.

## Runtime contract for the next phase

### DXF readiness

The fixed probe must verify:

1. Python is 3.12.x from the managed runtime;
2. ezdxf is exactly 1.4.4;
3. Pillow is exactly 12.3.0;
4. the repository-owned probe completes within a fixed timeout;
5. audit, metadata extraction, text extraction, and SVG generation all succeed;
6. the probe leaves no temporary artifacts.

### DWG readiness

DWG readiness is `unavailable` until all of these are true:

1. an operator provides an approved absolute executable identity;
2. the configured file is a regular executable and resolves outside project
   and worktree content;
3. the operator records license confirmation without storing license secrets;
4. a fixed single-file DWG-to-R2018-DXF probe succeeds headlessly;
5. the output passes the same ezdxf audit and bounds as direct DXF;
6. all probe directories are removed after success, failure, cancellation, and
   timeout.

Do not use `ezdxf.addons.odafc` directly in production. It supports configurable
executable paths and fallback PATH lookup, while this application requires one
server-owned executable identity and an independent fixed argument allowlist.

## Phase-1 implementation limits

- Read-only `.dxf` and conditionally available `.dwg` preview only.
- No source repair, save, export, batch conversion, or editable geometry.
- No ODA auto-install plan until redistribution rights and immutable artifacts
  are approved.
- No STEP, IGES, BREP, ACIS 3D, or FreeCADCmd work in #1470.
- Metadata and SVG are transient and bounded; CAD bytes and full render output
  never enter public state, audit snapshots, or logs.

## Managed DXF runtime

Run `pnpm cad:runtime:setup` from the repository root to create the ignored
`.runtime/cad-preview-a` or `cad-preview-b` Python 3.12 virtual environment.
The setup uses the version- and SHA-256-locked
`tools/dev/cad-runtime-requirements.txt`, runs the fixed readiness probe, and
atomically switches `cad-preview-active.json` only when the probe succeeds.
The previous slot remains available when installation or verification fails. An
operator may instead set `MYAGENTTOOL_CAD_PYTHON` to an absolute, separately
managed compatible virtual-environment launcher.

Production preview never searches `PATH`. Every request rechecks the Python,
ezdxf, and Pillow version contract inside the worker. The source is copied from
an `O_NOFOLLOW` file descriptor into a private mode-0600 snapshot, parsed only
from that snapshot, and deleted on every outcome. A timed-out worker receives
`SIGTERM`, then `SIGKILL` after the fixed grace period if it has not exited.
The server removes abandoned `myagenttool-cad-preview-*` request directories at
startup. `/api/cad-preview/readiness` exposes the bounded local probe used by
the Documents retry-detection control. The `CAD runtime matrix` workflow runs
installation and a real fixture render on Windows, macOS, and Linux.

## Follow-up gate

The next PR may implement ezdxf Application readiness and the confined DXF
pipeline. ODA readiness may be scaffolded as operator-installed/unavailable,
but DWG execution must remain disabled until a real converter build passes the
platform-specific headless conversion matrix and license approval is recorded.
