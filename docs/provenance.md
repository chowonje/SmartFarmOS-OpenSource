# Prior Work and Provenance Register

## Disclosure Principle

SmartFarmOS develops an earlier government-funded training project. The project
owner confirmed sole authorship of both the earlier code and the current
SmartFarmOS code on 2026-08-24. The contest entry must still distinguish reused
work from new contest-period work instead of presenting the full codebase as
newly created.

## Legacy Components

| Component | Prior purpose | Known source | Rights/evidence needed | Contest-period treatment |
| --- | --- | --- | --- | --- |
| User mobile app | Smart-farm monitoring/control | `../MyApp` | Sole author confirmed; course period and contractual reuse restrictions still need records | Use as UX parity reference; migrate selected behavior |
| User and admin web | Smart-farm web experience | `../api/client`, `../api/admin` | Sole author confirmed; templates/assets and external API terms still need review | User web becomes the PWA reference; admin remains separated |
| Central backend | REST, authentication, farm/device/sensor features | `../api/server` | Sole author confirmed; external service/data terms still need review | Rebuild behind shared contracts and secure tenancy |
| Raspberry Pi bridge/UI | MQTT and Socket.IO device control | `../resberrypi` | Sole author confirmed; hardware/firmware origin and broker terms still need review | Reframe as Edge Gateway; use simulator until hardware is proved |

## Human Confirmation Required

- [ ] Training institution and government-support program name
- [ ] Original project dates
- [x] Code authorship and contribution scope — project owner confirmed sole authorship on 2026-08-24
- [ ] Written or contractual reuse/publication restrictions
- [ ] Third-party templates, images, datasets, and sample code licenses
- [x] Duplicate public benefit — project owner confirmed none on 2026-08-24
- [x] Project license — Apache-2.0 selected by the project owner on 2026-08-24
- [ ] Which commits/features are newly created during the 2026 contest period

## Automated Dependency Declaration Evidence

`npm run submission:license-audit` reads only the canonical package-lock v3 and
requires every external package entry to declare a bounded license expression.
The 2026-08-21 inventory contains 155 external entries: 0BSD 1, Apache-2.0 23,
BSD-3-Clause 5, ISC 5, MIT 109, and MPL-2.0 12. Seven license-less lock entries
are verified local `@smartfarm-os/*` workspace links, not external packages.

This proves declaration completeness only. The project owner selected
Apache-2.0, but this audit does not determine compatibility, inventory legacy
templates/images/datasets/sample code, or override any training-program contract.
Those separate confirmation items above remain open.

## Contest Submission Table

Before submission, replace the placeholders below with reviewed facts.

| Category | Scope | Evidence |
| --- | --- | --- |
| Reused prior work | Sole-authored earlier training project; institution, dates, contract terms, and exact reused range pending | Owner confirmation, original repository history, and course records |
| New architecture | PWA + central API + Edge Gateway boundaries | Decision records and contract history |
| New module kernel | Runtime-validated manifests and reviewed PWA/API registries | Decision 0009, SDK tests, and M1 browser regression |
| New implementation | Strict contracts, module kernel, TypeScript API/Edge, SQLite migrations from schemas 1–7 to schema 8, two-device simulator, installable PWA, alarm/audit and approved strategy flow | Current canonical source, decision records, tests, browser rehearsal; final contest-period commit still pending |
| Removed/replaced legacy behavior | Legacy runtime/configuration was not copied; selected UX behavior was rebuilt behind the new API/Edge boundaries | Baseline, parity map, migration decisions, secret-path gate, and regression tests |
| Project licensing | Project-owned SmartFarmOS source: Apache-2.0; third-party materials retain their own terms | Root `LICENSE`, dependency inventory, and third-party review |
| Duplicate public benefit | None, confirmed by the project owner on 2026-08-24 | Owner confirmation; no duplicate-benefit form unless facts change |
| AI-assisted work | Architecture, implementation, tests, documentation, research, review, and rehearsal used AI coding assistance | [AI-use disclosure draft](./submission/ai-use-disclosure.md), local verification, owner final review pending |
