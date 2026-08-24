# Credential Rotation and Release Checklist

This document records labels and actions only. Never paste current or replacement credential values here.

## Owner Direction

- Confirmed 2026-07-17: all legacy provider accounts and credentials are controlled by the project owner.
- Confirmed 2026-08-24: the project owner did not intentionally add API key values to SmartFarmOS; this statement is verified separately by scoped source and history scans.
- All environment values will be reissued before their integrations are enabled in a shared deployment.
- Local product development continues with contracts, injected adapters, fixtures, and the simulator.
- This direction does not permit secrets in Git. Legacy provider integrations
  remain disabled and blocked from shared deployment until their credentials
  are reissued and verified. They are not part of the public source boundary.
- The provider and configuration-label inventory is maintained in `docs/external-services.md`.

## Confirmed Credential Classes

| Credential class | Legacy location | Required action | Status |
| --- | --- | --- | --- |
| JWT signing secret | `../api/.env` and related server configuration | Replace before shared deployment; invalidate old sessions | Excluded; legacy integration disabled |
| OpenAI API key | `../api/.env` | Revoke/replace if ever active; remove from the contest-critical path | Excluded; integration disabled |
| Firebase service-account private key | `../api/server/firebase/serviceAccountKey.json` | Revoke the old key in Firebase/GCP and issue only a server-side replacement if still needed | Excluded; integration disabled |
| News/weather/map/agriculture API keys | Legacy environment files | Rotate if exposed; add provider origin/IP/quota restrictions | Legacy keys excluded; live OpenWeather path requires a newly issued server-side key and is otherwise fixture-only |
| Supabase configuration | Legacy API/admin environment files | Verify RLS; keep any service-role credential server-only | Excluded; integration disabled |
| Kakao map browser key | Legacy user clients | Restrict allowed origins and document that it is public client configuration | Excluded; integration disabled |

## Git Evidence

- The current `../api` ignore rules exclude environment and Firebase service-account files.
- Git history contains commits touching those sensitive paths. Deleting local files is therefore not sufficient proof that old credentials are safe.
- `../MyApp/.env` is currently untracked but was not covered by its original ignore rule at baseline time.
- The independent public history has no common ancestor with the legacy private
  `main` history and contains none of those paths or values.

## Owner Actions

- [x] Identify the provider account owner for every credential class — project owner confirmed on 2026-07-17.
- [ ] Before enabling any legacy provider integration, revoke or rotate credentials that may ever have been committed, shared, or used outside a private machine.
- [ ] For any future rotation, record only provider, rotation date, responsible person, and verification result; never record replacement values.
- [x] Keep the current public demo and development secrets outside Git. Public
  templates contain labels only, and the deployed values remain server-side.
- [x] Verify the current browser bundle contains no privileged demo credential —
  `npm run verify` passed `verify-pwa-build.mjs` and the canonical credential-path
  checks on 2026-08-09. Recheck after any final configuration change.
- [x] Rerun the scoped privacy scan on the full 2026-08-24 publication candidate:
  273 files considered, 270 text files scanned, and 3 PNG icons inspected for
  metadata chunks. The deterministic scanner still reports 12
  `credential_assignment` BLOCK candidates, all manually reviewed as gateway
  credential types/issuance/transport code or test fixtures rather than embedded
  values. A separate high-confidence source and complete public-history scan found no
  private key, AWS, GitHub, OpenAI, Google, Slack, Stripe, SendGrid, Supabase, or
  password-bearing production URL signature. The raw report remains BLOCK and
  `opf` remains unavailable, so this is not a formal zero-warning privacy PASS.
- [x] Classify and sample the remaining WARN findings. Four email candidates and
  one token-like URL are public documentation or deterministic test fixtures;
  the other findings are numeric test/CSS/SVG/research-document matches. No
  user contact record or private URL was found. Missing `opf` remains a WARN.

## Public Release Decision

- Boundary: the independent `SmartFarmOS-OpenSource` Git history only.
- High-confidence secret and private-key signatures: 0 across the complete
  independent public history at the release tip.
- Generic scanner: raw BLOCK because twelve legitimate credential-handling
  code/test lines match a context-free assignment heuristic; all twelve were
  reviewed as false positives, not embedded values.
- Automated decision: **BLOCK** because the generic scanner has no contextual
  allowlist. The separate owner publication decision is **WARN** after exact-line
  review and explicit 2026-08-24 acceptance. Neither decision is a privacy PASS.
- Legacy credential rotation remains mandatory before those optional provider
  integrations are enabled, but excluded legacy files and histories are not
  published by this release.
