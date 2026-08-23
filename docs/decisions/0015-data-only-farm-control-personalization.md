# Decision 0015: Data-only farm control personalization

- Status: implemented locally
- Date: 2026-08-10

## Context

Each farm has a different device inventory and different operator vocabulary.
The fixed pump panel was safe, but it could not express that one farm calls a
controller `육묘동 급수` while another farm does not want to expose a start
action for the same class of device.

Allowing uploaded JavaScript, shell commands, raw device payloads, or arbitrary
HTTP actions would bypass the reviewed module registry and weaken the existing
farm/device scope, expiry, idempotency, acknowledgement, stop-fence, and audit
boundaries.

## Decision

- The farm-control module exposes one farm-scoped `FarmControlProfile` through
  `GET` and `PUT /v1/farms/:farmId/control-profile`.
- A profile is data only. V1 accepts at most 16 reviewed `pump_control` widgets.
  Each widget selects one same-farm pump-capable device, a bounded display
  label, and whether the normal start action is shown.
- The software-stop action is implicit and always visible for every configured
  widget. A profile cannot hide it or redefine its execution semantics.
- Missing profiles are returned as deterministic revision-zero defaults derived
  from the farm's pump-capable device inventory. Reads do not write state.
- Writes use optimistic `expectedRevision` checks. SQLite schema 7 stores the
  validated profile under a farm foreign key and keeps it across restarts.
- Only authenticated user or administrator principals with exact farm access
  may read or write the profile.
- Selecting and executing a personalized card still uses the existing canonical
  pump command endpoint. The profile cannot add a command type, route,
  permission, credential, or executable entrypoint.

## Consequences

- Farmers can add or remove device cards, apply familiar labels, and hide the
  start action without changing reviewed application code.
- Personalization is shared at farm scope in V1; it is not yet a per-user view.
- V1 supports pump cards only. Timed presets, fan/lighting templates, grouped
  actions, automation, and third-party connectors require separately reviewed
  action contracts.
- A software stop still does not replace a physical emergency stop, interlock,
  or hardware fail-safe.
- Profile-change audit events are not yet added. Every executed command remains
  observable through the existing command and direct-control audit path.

## Verification

- Contract tests reject unknown fields, duplicate devices, and out-of-bounds
  profile values.
- API tests cover deterministic defaults, farm authorization, device capability
  validation, revision conflicts, and strict request parsing.
- SQLite tests cover restart persistence and the schema 6 to 7 migration.
- PWA and browser checks cover editing a label, hiding start, preserving stop,
  saving, and reloading the persisted farm profile.
