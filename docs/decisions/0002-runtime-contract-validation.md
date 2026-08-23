# Decision 0002: Runtime-Validated Shared Contracts

- Status: accepted for the first vertical slice
- Date: 2026-07-17

## Context

The legacy web, mobile, API, and Raspberry Pi components exchange implicit JavaScript objects with inconsistent endpoint and realtime behavior. TypeScript types alone disappear at runtime and cannot reject malformed network or device input.

## Decision

Use one private npm workspace package, `@smartfarm-os/contracts`, to define Zod 4 runtime schemas and inferred TypeScript types for:

- `Farm`
- `Device`
- `Telemetry`
- `Command`
- `CommandAck`

The PWA, central API, Edge Gateway, and device simulator must import these schemas rather than redefining message shapes.

## Compatibility Policy

- Version 1 objects carry a literal `schemaVersion`.
- Adding an optional field with unchanged meaning is backward-compatible.
- Removing or renaming fields, adding required fields, narrowing accepted values, changing units, or changing command semantics requires a new schema version and an explicit adapter.
- Legacy objects are not silently accepted as version 1. They require named adapters with fixtures and tests.

## Consequences

- Untrusted runtime input is validated at every process boundary.
- Consumers share exact identifiers, units, command expiry, acknowledgement, and error semantics.
- Zod becomes one production dependency of the contract package.
- Package build output and contract tests become prerequisites for API, Edge, simulator, and PWA verification.

