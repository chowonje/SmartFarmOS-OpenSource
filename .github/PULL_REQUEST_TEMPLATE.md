## Problem

Describe the user or platform problem and the intended behavior.

## Changes

- 

## Verification

List each exact command and its result. Mark skipped or manual checks
explicitly; delete the examples you did not run.

```text
npm run <focused-check> — PASS | FAIL | NOT RUN: reason
npm run verify — PASS | FAIL | NOT RUN: reason
```

## Evidence boundaries and risks

State migrations, compatibility impact, external-provider behavior, and any
field, hardware, Raspberry Pi, or production behavior that was not verified.
Simulator and internal QA evidence must be labelled as such.

## Checklist

- [ ] The change is focused and does not reformat or restructure unrelated files.
- [ ] Behavior changes include tests and documentation.
- [ ] Public contracts remain compatible or the migration is documented.
- [ ] Farm/device scope, expiry, idempotency, and audit behavior remain explicit.
- [ ] No secret, personal data, private farm data, local database, or generated artifact is included.
- [ ] I have the right to contribute every added or adapted source, and its provenance is documented.
- [ ] Simulator evidence is not described as physical-device or safety evidence.
- [ ] I ran the relevant checks and reported anything that could not be verified.
