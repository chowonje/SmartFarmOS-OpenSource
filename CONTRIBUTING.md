# Contributing to SmartFarmOS

Thank you for helping improve SmartFarmOS. The project values small,
reviewable changes that preserve farm/device scope, deterministic tests, and
honest safety claims.

> [!IMPORTANT]
> Project-owned SmartFarmOS source is licensed under Apache License 2.0. Prior
> work and simulator-only safety boundaries are documented in this repository.
> Discuss substantial contributions with the maintainers before investing
> significant work.

## Before opening a change

1. Search existing issues before creating a duplicate.
2. Use a feature request for new behavior, integrations, dependencies, or
   architecture changes.
3. Keep physical-device, MQTT, identity, cloud, and safety claims separate from
   the simulator-backed local demo.
4. Never include credentials, customer data, private farm details, local
   databases, or generated browser profiles.
5. Submit only work you have the right to contribute, and identify any reused
   or adapted source. Apache-2.0 does not grant rights to third-party material.

Security vulnerabilities follow [SECURITY.md](SECURITY.md), not the public bug
template.

## Development setup

```bash
git clone https://github.com/chowonje/SmartFarmOS-OpenSource.git
cd SmartFarmOS-OpenSource
```

Then run the same three-command local setup used by the README:

```bash
nvm use
npm ci
npm run demo:local
```

See [Getting started](docs/getting-started.md) for ports and troubleshooting.

## Repository map

| Path | Responsibility |
| --- | --- |
| `apps/pwa/` | Installable desktop/mobile user product |
| `apps/admin/` | Separately authorized operations UI boundary |
| `services/api/` | Browser-facing data and control authority |
| `services/edge/` | Device connectivity and safe command execution boundary |
| `packages/contracts/` | Runtime-validated shared contracts |
| `packages/module-sdk/` | Reviewed static module manifests and permissions |
| `tools/device-simulator/` | Hardware-independent deterministic device |
| `docs/` | Architecture, contracts, decisions, gates, and provenance |

Read `AGENTS.md` for the complete repository constraints.

## Change workflow

1. Create a focused branch from the current default branch.
2. Add or update tests when behavior changes.
3. Update contracts and documentation in the same change when public behavior
   changes.
4. Run the narrowest relevant checks during development.
5. Run the complete gate before requesting review:

   ```bash
   npm run verify
   ```

6. Complete the pull request checklist and explain anything that could not be
   verified.

Do not reformat, rename, or restructure unrelated files. Do not add production
dependencies, cloud services, or credential providers without an accepted need
and an explicit review of maintenance, privacy, and licensing cost.

Useful focused checks are:

```bash
npm run build
npm run typecheck
npm run test
npm run smoke:pwa:browser
```

The exact check depends on the changed boundary, but `npm run verify` remains
the required complete repository gate. Do not report a skipped browser or
manual hardware check as passed.

## Contract and safety rules

- Browser applications call the central API and never own database, device, or
  provider credentials.
- Commands remain farm-scoped, device-scoped, authenticated, idempotent,
  expiring, and observable.
- Edge identities are authorized to exact farm/device pairs.
- Imported configuration is data only; it cannot add executable entrypoints,
  raw commands, routes, permissions, or credentials.
- The Edge path fails safe when connectivity, identity, or validation fails.
- Simulator behavior must not be described as physical interlock, emergency
  stop, real-device, MQTT, production-authentication, or closed-loop evidence.

## Field and Raspberry Pi testing

Start with the [field-test checklist](docs/testing/field-test-checklist.md), then
use the [usability protocol](docs/usability/field-test-protocol.md) for external
participant sessions. Internal rehearsals and automated checks are useful but
do not count as participant evidence. Store only the anonymous, bounded fields
defined by the protocol.

Use the [Raspberry Pi Edge guide](docs/deployment/raspberry-pi-edge.md) for the
current manual device-side boundary. Record the board model, OS version,
transport or adapter under test, exact commands, sanitized results, and every
unverified physical behavior. Never record enrollment tokens, Edge keys,
passwords, private hostnames, or full local configuration files.

## Pull request expectations

A useful pull request includes:

- the problem and intended behavior;
- a focused implementation;
- tests and documentation proportional to the change;
- verification commands and results;
- known risks, migrations, and unverified hardware or external behavior;
- no secrets, personal data, local artifacts, or unsupported claims.

Follow [Support](SUPPORT.md) when collecting diagnostics. Security findings use
the private process in [SECURITY.md](SECURITY.md), not a public pull request or
issue.

Participation in the project is governed by the
[Code of Conduct](CODE_OF_CONDUCT.md).
