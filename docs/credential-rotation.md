# Credential Rotation and Release Checklist

This document records labels and actions only. Never paste current or replacement credential values here.

## Owner Direction

- Confirmed 2026-07-17: all legacy provider accounts and credentials are controlled by the project owner.
- Confirmed 2026-08-24: the project owner did not intentionally add API key values to SmartFarmOS; this statement is verified separately by scoped source and history scans.
- All environment values will be reissued before their integrations are enabled in a shared deployment.
- Local product development continues with contracts, injected adapters, fixtures, and the simulator.
- This direction does not permit secrets in Git. Deployment and public release remain blocked until the selected credentials are reissued and verified.
- The provider and configuration-label inventory is maintained in `docs/external-services.md`.

## Confirmed Credential Classes

| Credential class | Legacy location | Required action | Status |
| --- | --- | --- | --- |
| JWT signing secret | `../api/.env` and related server configuration | Replace before shared deployment; invalidate old sessions | Owner confirmed; reissue pending |
| OpenAI API key | `../api/.env` | Revoke/replace if ever active; remove from the contest-critical path | Owner confirmed; optional integration |
| Firebase service-account private key | `../api/server/firebase/serviceAccountKey.json` | Revoke the old key in Firebase/GCP and issue only a server-side replacement if still needed | Owner confirmed; reissue pending |
| News/weather/map/agriculture API keys | Legacy environment files | Rotate if exposed; add provider origin/IP/quota restrictions | Owner confirmed; optional integrations |
| Supabase configuration | Legacy API/admin environment files | Verify RLS; keep any service-role credential server-only | Owner confirmed; architecture review pending |
| Kakao map browser key | Legacy user clients | Restrict allowed origins and document that it is public client configuration | Owner confirmed; optional integration |

## Git Evidence

- The current `../api` ignore rules exclude environment and Firebase service-account files.
- Git history contains commits touching those sensitive paths. Deleting local files is therefore not sufficient proof that old credentials are safe.
- `../MyApp/.env` is currently untracked but was not covered by its original ignore rule at baseline time.

## Owner Actions

- [x] Identify the provider account owner for every credential class — project owner confirmed on 2026-07-17.
- [ ] Revoke or rotate credentials that may ever have been committed, shared, or used outside a private machine.
- [ ] Record only provider, rotation date, responsible person, and verification result; never record replacement values.
- [ ] Configure production/development secrets outside Git.
- [x] Verify the current browser bundle contains no privileged demo credential —
  `npm run verify` passed `verify-pwa-build.mjs` and the canonical credential-path
  checks on 2026-08-09. Recheck after any final configuration change.
- [x] Rerun the scoped privacy scan on the full 2026-08-24 publication candidate:
  271 files considered, 268 text files scanned, and 3 PNG icons inspected for
  metadata chunks. The deterministic scanner still reports 12
  `credential_assignment` BLOCK candidates, all manually reviewed as gateway
  credential types/issuance/transport code or test fixtures rather than embedded
  values. A separate high-confidence source and one-commit history scan found no
  private key, AWS, GitHub, OpenAI, Google, Slack, Stripe, SendGrid, Supabase, or
  password-bearing production URL signature. The raw report remains BLOCK and
  `opf` remains unavailable, so this is not a formal zero-warning privacy PASS.
- [ ] Review remaining WARN findings manually, including Korean text and numeric false positives.
