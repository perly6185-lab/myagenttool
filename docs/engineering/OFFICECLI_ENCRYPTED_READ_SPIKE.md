# OfficeCLI encrypted Office read spike (#1476)

Date: 2026-07-22  
Decision: **No-go for in-app password unlocking with OfficeCLI**  
Verified version: `@officecli/officecli` / binary `1.0.139`

## Decision

Do not add a password prompt or an OfficeCLI password execution path. Keep
password-encrypted Word, Excel, and PowerPoint documents on the contained
system-application path introduced by #1475.

OfficeCLI 1.0.139 exposes no password-to-open option on `open`, `view`, `get`,
or the global command surface. Its documented stdin support belongs to the
`batch` command JSON input, not to document unlocking. Sending a password to
stdin does not change encrypted-file behavior.

## Reproducible verification

`tools/dev/verify-officecli-encrypted-read.mjs`:

1. requires the exact OfficeCLI version above;
2. creates normal DOCX, XLSX, and PPTX files with OfficeCLI;
3. encrypts them as OOXML Agile Encryption using `msoffcrypto-tool` in an
   isolated Python environment;
4. probes empty, incorrect, and correct password values through stdin only;
5. reports result codes and leakage booleans without printing either password;
6. deletes its private temporary directory after the probe.

The Python environment is intentionally not a product dependency. To rerun:

```sh
python3 -m venv /tmp/myagenttool-officecli-password-probe
/tmp/myagenttool-officecli-password-probe/bin/pip install msoffcrypto-tool==6.0.0
MSOFFCRYPTO_PYTHON=/tmp/myagenttool-officecli-password-probe/bin/python node tools/dev/verify-officecli-encrypted-read.mjs
```

The environment variable contains only the Python executable path. Passwords
are generated in process memory and sent to child stdin; they never enter argv,
environment variables, URLs, repository state, or probe output.

## Results

| Format | Empty stdin | Incorrect password | Correct password | Password in output | New files |
| --- | --- | --- | --- | --- | --- |
| DOCX | `corrupt_file` | `corrupt_file` | `corrupt_file` | No | None |
| XLSX | `corrupt_file` | `corrupt_file` | `corrupt_file` | No | None |
| PPTX | `corrupt_file` | `corrupt_file` | `corrupt_file` | No | None |

The encrypted source files were not modified. The identical result for every
stdin value demonstrates that OfficeCLI is not consuming a password-to-open
secret. `corrupt_file` also cannot implement the required distinctions between
password required, incorrect password, cancellation, and unsupported encryption.

## Security conclusions

- There is no verified secure stdin or local IPC unlock contract to integrate.
- An argv or environment-variable fallback remains prohibited.
- Mapping OfficeCLI `corrupt_file` to `office_password_required` would be
  incorrect; encryption must be detected before OfficeCLI, as designed in #1475.
- No production password UI should be shown when no component can consume the
  secret.
- Editing, plaintext temporary files, and re-encryption remain out of scope.

## Revisit gate

Reopen application-internal unlocking only when a pinned OfficeCLI release
documents a password-to-open protocol that:

- accepts a one-shot secret over stdin or narrowly scoped local IPC;
- returns deterministic required/incorrect/cancel/unsupported errors;
- documents temporary plaintext behavior and crash cleanup;
- proves passwords are absent from logs, diagnostics, telemetry, and process
  metadata.

Until all four conditions pass on DOCX, XLSX, and PPTX, the product must offer
only the safe system-application fallback.
