# Central API

Current slice: a Fastify/TypeScript application factory with injected
authentication and storage boundaries. Tests use the in-memory store by
default; SQLite schema 8 preserves telemetry, command lifecycle, farm/device
and area/cycle catalogs, crop records, alarms, acknowledgements, and audit
events plus irrigation strategies, applications, and farm control profiles
across restarts.

The strategy path preserves V1 immediate pump-state commands and accepts an
optional `runDurationSeconds` snapshot. A timed strategy is applied only to a
device that advertises both `pump` and `timed_pump`; it creates a V2
device-local run and stays pending until a compatible final-`off`
acknowledgement arrives. SQLite persists the pending command/application and
terminal evidence, but it does not prove an in-flight physical timer survived
a device restart.

Implemented routes:

- `GET /health`
- `GET /v1/farms`
- `GET /v1/farms/:farmId/devices`
- `POST /v1/admin/farms/:farmId/devices/:deviceId/gateway-enrollments`
- `POST /v1/admin/farms/:farmId/devices/:deviceId/gateway-enrollments/:enrollmentId/revocations`
- `GET /v1/admin/farms/:farmId/devices/:deviceId/gateway-access?limit=50`
- `POST /v1/admin/farms/:farmId/devices/:deviceId/edge-credentials/:credentialId/revocations`
- `POST /v1/gateway-enrollments/exchange`
- `GET /v1/farms/:farmId/areas`
- `GET|POST /v1/farms/:farmId/crop-cycles`
- `PATCH /v1/farms/:farmId/crop-cycles/:cycleId`
- `GET /v1/farms/:farmId/crops`
- `GET /v1/farms/:farmId/crops/:cropId`
- `POST /v1/farms/:farmId/crops`
- `PATCH /v1/farms/:farmId/crops/:cropId`
- `DELETE /v1/farms/:farmId/crops/:cropId`
- `POST /v1/farms/:farmId/telemetry`
- `GET /v1/farms/:farmId/devices/:deviceId/telemetry/latest?metric=temperature`
- `GET /v1/farms/:farmId/devices/:deviceId/telemetry/history?metric=temperature&limit=24`
- `GET /v1/farms/:farmId/alarms?state=active&cycleId=...&limit=100`
- `POST /v1/farms/:farmId/alarms/:alarmId/acknowledgements`
- `GET /v1/farms/:farmId/audit-events?cycleId=...&includeUnscoped=true&limit=50`
- `GET /v1/farms/:farmId/irrigation-strategies?cycleId=...`
- `POST /v1/farms/:farmId/irrigation-strategies/:strategyId/applications`
- `GET /v1/farms/:farmId/strategy-applications/:applicationId`
- `GET|PUT /v1/farms/:farmId/control-profile`
- `POST /v1/farms/:farmId/commands`
- `GET /v1/farms/:farmId/commands?deviceId=...&limit=50`
- `GET /v1/farms/:farmId/commands/:commandId`
- `GET /v1/farms/:farmId/edge/commands/next?deviceId=...`
- `GET /v1/farms/:farmId/edge/commands/next-stop?deviceId=...`
- `POST /v1/farms/:farmId/command-acks`

The app factory requires an authentication function. There is intentionally no unauthenticated production server entrypoint.
An Edge principal additionally carries non-empty exact `(farmId, deviceId)`
scopes. Telemetry, normal/stop command pull, and ACK handlers require the target
pair before accessing the store; malformed adapter context fails closed.
The local demo additionally recognizes dynamically enrolled Edge bearer keys,
derives their exact farm/device scope from SQLite, and rejects them immediately
after administrator revocation. Token/key responses are one-time and
`no-store`; only digests are persisted.

`SqliteSmartFarmStore` is a single-instance contest adapter. The store emits
one deterministic, unscoped AuditEvent V2 when a direct command
receives its first terminal ACK. Strategy commands retain their existing
cycle-scoped V1 audit. Default audit queries exclude V2; reviewed clients must
request `includeUnscoped=true`.

Its transactional migrations from schemas 1 through 5 preserve existing rows while adding
catalog/crop, alarm/audit, and strategy-application storage. The v4→v5 step
rebuilds the alarm-only audit table inside the migration transaction so it can
store command and strategy actions without losing carried alarm records. The
v5→v6 step rebuilds only the audit table so `cycle_id` can be null for honest
farm-wide direct control while retaining foreign-key checks for scoped rows.
The additive v6→v7 step creates the farm-scoped, revisioned data-only control
profile table. The additive v7→v8 step creates gateway enrollment and Edge
credential records without storing their raw secrets.
Production startup,
backup policy, retention, and multi-instance storage are not yet implemented.
It is exported separately as `@smartfarm-os/api/sqlite-store`, so importing the
default API package does not load the optional SQLite runtime.

Legacy reference: `../../api/server/server.js` and `../../api/server/app.js`.
