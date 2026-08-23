# ADR 0008: Persist Farm/Device Discovery and Crop Management

- Status: accepted
- Date: 2026-07-17
- Amends: ADR 0005 and ADR 0006

## Context

The first PWA hardcoded `farm:demo` and `device:bed-1`. The legacy crop diary
stored unscoped rows with provider-enriched fields, while the new product needs
farm authorization, strict runtime validation, deterministic local evidence,
and persistence that survives an API restart.

## Decision

- Add authenticated `GET /v1/farms` and farm-scoped device discovery.
- Add a normalized `CropRecord V1` with farm scope, optional device association,
  health state, manager, notes, and creation/update timestamps.
- Add farm-scoped crop list, read, create, patch, and delete routes.
- Reject crop/device associations that do not exist in the same stored farm.
- Require a registered device before creating a device command.
- Treat device identity as `(farmId, deviceId)`, allowing the same device slug
  to exist independently in different farms.
- Require telemetry ingestion and latest-value reads to reference a registered
  device in the route farm.
- Extend both `SmartFarmStore` implementations with catalog/crop operations.
- Migrate SQLite schema 1 to schema 2 transactionally by adding `farms`,
  farm/device-composite `devices`, and `crops`; preserve the existing telemetry
  and command tables.
- Seed the loopback demo only when catalog rows are absent, so restarts never
  overwrite user-created or user-edited records.
- Keep production authentication outside this slice. The local demo continues
  to inject its guarded principal through the loopback proxy.

## Consequences

- The PWA no longer owns the demo farm/device list and can retain a selected
  scope across reloads.
- Crop CRUD is a real persisted feature rather than a copied legacy screen.
- The new API is intentionally breaking relative to legacy `/api/crops/logs`:
  it adds farm scope, versioned envelopes, normalized fields, strict validation,
  role checks, and different status/error contracts.
- SQLite schema 2 is still a single-instance local/contest boundary. Production
  scale, backup automation, and multi-instance coordination remain undecided.
- Production identity, device-inventory mutations, alerts, finance, broader
  telemetry/control, external providers, and camera remain later slices.

Contest Slice B subsequently implemented the guarded local alarm
trigger/history/acknowledgement/audit path. Production identity,
device-inventory mutation, external notification delivery, and the other
listed capabilities remain later work.
