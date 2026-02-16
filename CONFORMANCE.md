# Conformance

This package targets the XRPL adapter specification in `docs/SPEC.md`.

## Current status

- Core settlement verification invariants are covered in tests under `test/`.
- Replay/idempotency behavior is validated with mocked transaction fetches.
- Error code semantics include challenge, receipt, memo, and replay classes.

## Notes

- This document is included in the published package for downstream integrators.
- For normative behavior, treat `docs/SPEC.md` as the source of truth.
