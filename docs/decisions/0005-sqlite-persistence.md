# 0005: SQLite persistence behind the central store contract

- Status: accepted for the Stage 2 single-instance slice
- Date: 2026-07-17
- Amended by: ADR 0008 (schema 2 catalog and crop persistence)

## Context

The verified HTTP V1 application defaults to an in-memory store. Telemetry,
pending commands, and terminal acknowledgements therefore disappear when the
process restarts. The PWA should not be attached to a server whose visible state
cannot survive a restart, but selecting a hosted multi-instance database is not
required to prove the first local contest path.

## Decision

Define `SmartFarmStore` as the central API persistence port and keep the existing
in-memory implementation for fast tests. Add `SqliteSmartFarmStore` as a
file-backed implementation using the Node.js `node:sqlite` module.

SQLite schema V1 stores:

- validated telemetry envelopes with a farm/device/metric latest-value index;
- validated command projections with farm/actor idempotency uniqueness;
- pending-command ordering by issue time and command ID;
- terminal acknowledgement state in the same command projection.

All writes that read before writing run inside `BEGIN IMMEDIATE` transactions.
Prepared statements bind every runtime value. JSON read from storage is parsed
through the same V1 runtime contracts before it can reach an HTTP response.

## Migration and rollback

- The V0 to V1 migration is create-only, has no backfill, and commits as one
  transaction.
- `PRAGMA user_version` records the schema version. A newer or unknown version is
  rejected without attempting a downgrade.
- Before a future migration, stop writers and back up the database together with
  any active WAL state using an approved SQLite backup procedure.
- V1 has no destructive automated rollback. The previous application can be
  restored against an unchanged V1 database; a schema downgrade requires a
  reviewed export/restore plan.

## Consequences

- Existing HTTP V1 paths, request fields, response fields, and status codes do
  not change.
- The repository adds no external production dependency for this slice.
- File-backed persistence and restart behavior can be tested locally without a
  cloud account or credential.
- The locally bundled Node 24.14 runtime still labels `node:sqlite` experimental.
  This adapter is therefore a contest-oriented single-instance boundary, not a
  claim of production database scale or long-term engine lock-in.
- Multi-instance coordination, backup automation, retention, encryption at rest,
  and a production server composition remain future decisions.
