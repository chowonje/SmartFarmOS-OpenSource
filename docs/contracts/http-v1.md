# Central API HTTP V1

## Authority Boundary

The Fastify application factory cannot be constructed without an `authenticate` function. Except for health, every route rejects an absent principal before body validation.

Roles:

- `edge`: writes telemetry and command acknowledgements and pulls commands only
  for exact authenticated `(farmId, deviceId)` scopes.
- `user`: reads telemetry/alarms/audit, acknowledges alarms, and creates/reads
  individual commands and bounded command history for an allowed farm.
- `admin`: has the operator rights of a user plus gateway enrollment status,
  one-time token issue, and Edge credential revocation for an allowed farm.
  Production deployments must derive this role from a separate administrator
  identity boundary; request headers are not authority.

Every authenticated principal carries an explicit list of allowed `FarmId`
values. An Edge principal also carries a non-empty list of exact farm/device
pairs derived by the trusted authentication adapter. Route, principal, body,
stored command, acknowledgement, and Edge device scope must agree.

## Endpoint Contract

| Method and path | Role | Success | Idempotent replay | Main failures |
| --- | --- | --- | --- | --- |
| `GET /health` | public | `200 HealthResponse` | n/a | — |
| `GET /v1/farms` | user/admin | `200 FarmListResponse` | n/a | `401`, `403` |
| `GET /v1/farms/:farmId/devices` | user/admin | `200 DeviceListResponse` | n/a | `400`, `401`, `403`, `404` |
| `POST /v1/admin/farms/:farmId/devices/:deviceId/gateway-enrollments` | admin | `201 IssueGatewayEnrollmentResponse` | n/a | `400`, `401`, `403`, `404` |
| `POST /v1/admin/farms/:farmId/devices/:deviceId/gateway-enrollments/:enrollmentId/revocations` | admin | `200 RevokeGatewayEnrollmentResponse` | `200` with the revoked record | `400`, `401`, `403`, `404`, `409` |
| `GET /v1/admin/farms/:farmId/devices/:deviceId/gateway-access?limit=...` | admin | `200 GatewayAccessListResponse` (max 100) | n/a | `400`, `401`, `403`, `404` |
| `POST /v1/admin/farms/:farmId/devices/:deviceId/edge-credentials/:credentialId/revocations` | admin | `200 RevokeEdgeCredentialResponse` | `200` with the revoked record | `400`, `401`, `403`, `404` |
| `POST /v1/gateway-enrollments/exchange` | enrollment bearer | `201 GatewayEnrollmentExchangeResponse` | rejected; single use | `400`, `401` |
| `GET /v1/farms/:farmId/areas` | user/admin | `200 GrowingAreaListResponse` | n/a | `400`, `401`, `403`, `404` |
| `GET /v1/farms/:farmId/crop-cycles` | user/admin | `200 CropCycleListResponse` | n/a | `400`, `401`, `403`, `404` |
| `POST /v1/farms/:farmId/crop-cycles` | user/admin | `201 CropCycleResponse` | n/a | `400`, `401`, `403`, `404`, `409` |
| `PATCH /v1/farms/:farmId/crop-cycles/:cycleId` | user/admin | `200 CropCycleResponse` | n/a | `400`, `401`, `403`, `404`, `409` |
| `GET /v1/farms/:farmId/crops` | user/admin | `200 CropListResponse` | n/a | `400`, `401`, `403`, `404` |
| `GET /v1/farms/:farmId/crops/:cropId` | user/admin | `200 CropResponse` | n/a | `400`, `401`, `403`, `404` |
| `POST /v1/farms/:farmId/crops` | user/admin | `201 CropResponse` | n/a | `400`, `401`, `403`, `404`, `409` |
| `PATCH /v1/farms/:farmId/crops/:cropId` | user/admin | `200 CropResponse` | n/a | `400`, `401`, `403`, `404` |
| `DELETE /v1/farms/:farmId/crops/:cropId` | user/admin | `204` | n/a | `400`, `401`, `403`, `404` |
| `POST /v1/farms/:farmId/telemetry` | edge | `202 TelemetryReceipt(accepted)` | `200 TelemetryReceipt(replayed)` | `400`, `401`, `403`, `404`, `409` |
| `GET /v1/farms/:farmId/devices/:deviceId/telemetry/latest?metric=...` | user/admin | `200 LatestTelemetryResponse` | n/a | `400`, `401`, `403`, `404` |
| `GET /v1/farms/:farmId/devices/:deviceId/telemetry/history?metric=...&limit=...` | user/admin | `200 TelemetryHistoryResponse` (oldest-to-newest, max 100) | n/a | `400`, `401`, `403`, `404` |
| `GET /v1/farms/:farmId/alarms?state=...&cycleId=...&limit=...` | user/admin | `200 AlarmListResponse` (max 100) | n/a | `400`, `401`, `403`, `404` |
| `POST /v1/farms/:farmId/alarms/:alarmId/acknowledgements` | user/admin | `200 AlarmResponse` | `200` with the original acknowledgement | `400`, `401`, `403`, `404`, `409` |
| `GET /v1/farms/:farmId/audit-events?cycleId=...&includeUnscoped=...&limit=...` | user/admin | `200 AuditEventListResponse` (max 100) | n/a | `400`, `401`, `403`, `404` |
| `GET /v1/farms/:farmId/irrigation-strategies?cycleId=...` | user/admin | `200 IrrigationStrategyListResponse` (approved only, max 100) | n/a | `400`, `401`, `403`, `404` |
| `POST /v1/farms/:farmId/irrigation-strategies/:strategyId/applications` | user/admin | `202 StrategyApplicationResponse(pending)` | `200` with the original/current application | `400`, `401`, `403`, `404`, `409` |
| `GET /v1/farms/:farmId/strategy-applications/:applicationId` | user/admin | `200 StrategyApplicationResponse` | n/a | `400`, `401`, `403`, `404` |
| `GET /v1/farms/:farmId/control-profile` | user/admin | `200 FarmControlProfileResponse` | n/a | `400`, `401`, `403`, `404` |
| `PUT /v1/farms/:farmId/control-profile` | user/admin | `200 FarmControlProfileResponse` | n/a | `400`, `401`, `403`, `404`, `409` |
| `POST /v1/farms/:farmId/commands` | user/admin | `202 CommandProjection(pending)` | `200` with the original projection | `400`, `401`, `403`, `404`, `409` |
| `GET /v1/farms/:farmId/commands?deviceId=...&limit=...` | user/admin | `200 CommandListResponse` (max 100) | n/a | `400`, `401`, `403`, `404` |
| `GET /v1/farms/:farmId/commands/:commandId` | user/admin | `200 CommandProjection` | n/a | `400`, `401`, `403`, `404` |
| `GET /v1/farms/:farmId/edge/commands/next?deviceId=...` | edge | `200 PendingCommandResponse` or `204` | repeated `200` until ACK | `400`, `401`, `403` |
| `GET /v1/farms/:farmId/edge/commands/next-stop?deviceId=...` | edge | `200 PendingCommandResponse` containing V1 pump `off`, or `204` | repeated `200` until ACK | `400`, `401`, `403` |
| `POST /v1/farms/:farmId/command-acks` | edge | `200 terminal CommandProjection` | `200` with the original projection | `400`, `401`, `403`, `404`, `409` |

All error responses use `smartfarm.error.v1`. Validation issues expose only bounded paths and messages, not submitted values.

## Gateway Enrollment Rules

- An enrollment is bound to one stored farm/device pair, expires after ten
  minutes, can be cancelled by an administrator before exchange, and can be
  exchanged exactly once. The bearer enrollment token is
  the only authority for the public exchange route; its request body is empty.
- Enrollment tokens and Edge keys use `publicId.secret` with 32 random bytes of
  base64url secret material. The API stores only domain-separated SHA-256
  digests and compares candidate digests in constant time.
- The issue response returns `enrollmentToken` once. The exchange response
  returns `edgeKey` once. Both responses set `Cache-Control: no-store`.
- Status/list/revoke responses contain records only. They never return raw
  secrets or digests.
- Cancelling a pending or expired unexchanged enrollment is idempotent; an
  already-exchanged enrollment returns `409`. A cancelled token fails exchange.
- A valid Edge key resolves server-side to exactly one `(farmId, deviceId)`
  principal. Revocation is idempotent and later requests with that key fail
  authentication.
- The API has no Linux/SSH password route. OS account password changes happen
  only on the Raspberry Pi.

## Catalog and Crop Rules

- Farm discovery returns the intersection of stored farms and the authenticated
  principal's `farmIds`.
- Device and crop collection routes require both principal membership and a
  stored farm.
- Growing-area and crop-cycle routes require the same farm membership and
  stored-farm checks; `edge` principals cannot use these operator routes.
- A growing area's representative device, when present, must be registered in
  that same farm.
- Crop-cycle assignments contain one or more unique, same-farm growing areas.
  An area can belong to at most one `active` crop cycle at a time.
- Crop-cycle IDs, farm scope, and timestamps are API-owned. Patch requests are
  merged with the stored record and the complete result is validated again, so
  partial date updates cannot bypass the start/end ordering rule.
- A crop can be associated only with a device stored in the same farm.
- Telemetry ingestion/readback and command creation require a device registered
  in the same farm. A syntactically valid but unknown device returns `404`.
- Edge telemetry ingestion requires the exact authenticated farm/device pair
  before device existence or store mutation is checked. An out-of-scope pair
  returns `403` without revealing whether that device is registered.
- Device identity is the `(farmId, deviceId)` pair; matching device slugs in two
  farms remain separate records.
- Crop IDs, farm scope, and timestamps are API-owned. Clients submit normalized
  name, health state, optional device, manager, and notes.
- Empty patches and unknown fields are rejected. Delete succeeds with `204`.
- Device command creation rejects an unregistered device.

## Farm Control Profile Rules

- A missing stored profile is returned as a deterministic revision-zero view of
  at most 16 same-farm devices that advertise the `pump` capability. A read does
  not create database state.
- A write supplies the last observed `expectedRevision`; the server increments
  it once or returns `409` when another writer has already changed the profile.
- Widgets are strict data-only `pump_control` records. Device IDs must be unique,
  registered in the route farm, and pump-capable. Labels are trimmed and bounded.
- `showStart` may hide normal activation. Software stop is part of the reviewed
  UI and execution path and is not configurable by the profile.
- A profile cannot add routes, permissions, credentials, code, arbitrary
  command payloads, or device transports. Executing a card still creates the
  canonical expiring and idempotent pump command.
- The optional command-history `deviceId` filter must reference a registered
  device in the route farm. An unknown or other-farm device returns `404`.

## Central Command Creation

The browser submits only:

- target `deviceId`;
- requested pump state;
- user-scoped idempotency key;
- optional TTL from 1 to 300 seconds.

The API owns the command ID, authenticated actor, issue time, and expiry time. Clients cannot choose or overwrite those authority fields.
Every V1 pump `off` keeps this request shape but is also exposed to the Edge's
independent software-stop lane. It is not a physical emergency-stop contract.

## Irrigation Strategy Application

- Strategy listing requires a stored crop cycle and returns approved versions
  only for the route farm and requested cycle.
- Apply accepts one approved strategy version, the same active cycle, one to 20
  unique assigned area IDs, and an actor-scoped idempotency key.
- Every target area must be active, have a registered representative device,
  and that device must declare `pump`. Multiple areas cannot resolve to the same
  device in one application.
- A strategy without `runDurationSeconds` translates to the existing V1
  `set_pump_state` command. A timed strategy additionally requires the device
  to declare `timed_pump` and translates to V2 `run_pump_for`.
- The command's 60-second expiry remains an execution-start deadline, not its
  run duration. Derived command idempotency keys are fixed-length
  hashes of the application key and device, avoiding long-key fan-out collisions.
- Application creation and every ACK-driven projection/application/audit update
  are transactional. Aggregate status is `pending`, `succeeded`, `partial`, or
  `failed`.
- Timed duration and final-off acknowledgement are expressed, but closed-loop
  sensor control, physical safety interlocks, and real-hardware proof are not.

## Store Rules

- Exact telemetry retries are accepted without a second write.
- Reusing a telemetry ID with different content is a conflict.
- A metric sequence must increase and its observation time cannot move backwards.
- Accepted telemetry rows remain available for metric history. History reads are
  bounded by `limit` (default 24, maximum 100) and return the selected farm and
  device's rows in oldest-to-newest order.
- Command idempotency is scoped by farm and authenticated actor.
- An acknowledgement must match the stored command's farm, device, and issue time.
- A terminal acknowledgement cannot be replaced by a different terminal state.
- Pending command pull is deterministic by issue time and command ID. It remains visible until a terminal ACK is accepted.
- Normal pull, stop pull, and ACK submission require the exact target pair in
  the Edge principal. Independent farm and device lists are not accepted because
  they would authorize a cross-product in multi-farm adapters.
- Pending stop pull uses the same deterministic order but returns only V1
  `set_pump_state: off`. The normal and stop routes may expose the same stop;
  the Edge execution journal deduplicates it before device execution.
- The Edge stores a terminal ACK before posting it and drains that outbox before
  pulling new work. An exact HTTP replay sends the stored ACK unchanged. This is
  an Edge-internal durability rule and does not change the V1 wire response.
- A journal record left at `executing` is not automatically redelivered because
  the current device boundary cannot prove whether actuation already occurred.
- A locally acknowledged V1 `off` is a durable device stop fence. A V1 `on` or
  timed V2 activation issued no later than that stop is rejected without device
  execution using ACK V2 `manual_stop`; a later activation remains eligible.
- ACK V2 `manual_stop` must reference an existing same-farm/same-device V1
  `off` through `causedByCommandId`, and that stop projection must already carry
  an acknowledged final-`off` ACK. The cause cannot predate the activation or
  be issued after the ACK. Exact replay returns the original projection.
- Operator command history is bounded by `limit` (default 50, maximum 100), may
  be filtered by device, and is ordered by projection `updatedAt` descending,
  then command `issuedAt` descending and command ID ascending. In-memory and
  SQLite stores apply the same ordering.
- Farm, device, growing-area, crop-cycle, and crop catalog rows are
  deterministically listed and validated again when read from SQLite.
- Only accepted telemetry evaluates rules for the same farm, device, and
  metric. A rule can open/update only when enabled and attached to an active
  crop cycle. Replays and conflicts do not open, update, or clear alarms.
- The next matching accepted reading clears an existing active alarm whose
  rule was disabled or whose crop cycle is no longer active.
- A farm/rule has at most one active alarm. Repeated breached readings update
  that instance; the first normal reading clears it without removing its
  acknowledgement.
- Alarm acknowledgement and `alarm.acknowledged` audit insertion share one
  transaction. Exact actor/key retries return the original result; a different
  acknowledgement conflicts.
- Strategy application idempotency is scoped by farm and authenticated actor.
  Exact retries return the current stored application and different intent
  conflicts without creating commands.
- Each applied strategy command ACK emits one deterministic `command.completed`
  audit. The first transition from pending to a terminal aggregate emits one
  deterministic `strategy.applied` audit; ACK replay emits neither again.
- A terminal ACK for a command outside a strategy application emits one
  deterministic AuditEvent V2 with `cycleId: null`. Its typed details snapshot
  the direct source, device, requested action, terminal state/reason, resulting
  pump state, and manual-stop cause when present. Projection update and audit
  insertion share one SQLite transaction; exact replay and conflicts emit no
  additional event.
- `includeUnscoped` defaults to `false`, so existing/default readers receive
  only cycle-scoped V1 rows. With `true`, an optional cycle filter returns that
  cycle's V1 rows plus farm-level V2 rows; without a cycle filter it returns all
  farm rows. This opt-in prevents old strict clients from receiving V2 by
  accident.

## Compatibility Report

The M1 module-kernel refactor preserves every original endpoint, role, status
code, and payload. The crop-operations, alarm, comparison/history, and irrigation slices
add only the area/cycle, alarm/audit, strategy-application, and command-list routes listed above
behind reviewed server module registrars.
Health and farm/device discovery remain platform core. The optional
`buildApi.moduleConfiguration` composition input is additive; deliberately
disabling a module removes only that module's routes.

The public HTTP V1 request and response wires are unchanged by exact Edge
credential binding. The injected authentication boundary is intentionally
stricter: every adapter that returns an `edge` principal must now derive and
provide non-empty exact `(farmId, deviceId)` `deviceScopes`. An adapter that
still returns only farm membership fails closed, so adapter rollout must happen
before deploying this API revision even though no client payload migration is
required.

The new HTTP V1 routes are not drop-in replacements for legacy `/sensor`,
`/api/crops`, `/api/device`, Socket.IO, or MQTT payloads. Path scope,
authentication, status codes, envelopes, IDs, timestamps, field names, and
acknowledgement semantics are intentionally stricter. The endpoint-by-endpoint
report is `docs/contracts/legacy-parity-map.md`.

Safe rollout:

1. Keep legacy routes unchanged while a single Edge adapter is introduced.
2. Translate one sanitized legacy telemetry fixture to `Telemetry V1`.
3. Move the simulator through the Edge adapter and HTTP V1.
4. Move the PWA read and command paths.
5. Retire a legacy route only after its migrated consumer and producer tests pass.

## Current Limitations

- The application factory still defaults to the in-memory store; an injected
  SQLite schema-6 adapter persists telemetry, commands, catalogs, growing-area
  assignments, crop cycles, crops, alarms, irrigation applications,
  acknowledgements, and audit events,
  but no production composition selects it yet.
- No production authentication adapter or production listening server exists yet. A loopback-only local demo composition now injects fixed demo principals behind an explicit mode guard.
- Realtime delivery to the PWA is not implemented.
- History retention policy, downsampling, freshness targets, and server-pushed
  trend updates are not implemented; the PWA refreshes the bounded history on
  the same polling cycle as live telemetry.
- Rate limiting, production backup/retention, and multi-instance coordination
  remain pending. Direct/manual command completions now add an unscoped AuditEvent
  V2; immutable command history, final-off stop ACK, and causal ACK V2 remain
  the command-level evidence, while strategy-linked stops also add
  `manualStopCommandId` to the existing crop-cycle audit details.
- Pending command pull assumes one effective gateway per device. The local Edge
  journal recovers completed ACK delivery for that owner, but multi-gateway
  claiming, telemetry buffering, and in-progress device reconciliation remain
  pending.
