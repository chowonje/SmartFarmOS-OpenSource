# Decision 0001: Clean Canonical Integration Repository

- Status: adopted; private canonical remote connected
- Date: 2026-07-17

## Context

The extracted project parent contains three legacy components. `MyApp` and `api` have separate Git histories and dirty working trees, while `resberrypi` has no Git history. Initializing the parent as one repository would create nested-repository ambiguity and make accidental credential or generated-file inclusion more likely.

## Decision

Use `SmartFarmOS/` as the clean canonical integration repository. Preserve `../MyApp`, `../api`, and `../resberrypi` as read-only migration inputs until each selected behavior is copied through an explicit, reviewed migration step.

Do not:

- remove nested `.git` directories;
- flatten or rewrite legacy histories;
- add the legacy directories as embedded repositories or submodules;
- copy local environment, service-account, dependency, or generated files;
- invent or change a GitHub owner/repository binding without verifying the actual remote.

## Consequences

- New architecture and security contracts start clean.
- Legacy work remains recoverable and attributable.
- Migration requires deliberate file-level selection instead of a bulk merge.
- The original canonical integration repository uses a private remote whose
  identity is intentionally not published by the public release.
- Public distribution uses a separate history and remote so private commits and
  repository metadata are not made reachable.
