# PWA Feature Parity Plan

## Scope decision

The new installable PWA is the single user product for desktop and mobile. It
will contain every user-facing legacy capability listed below **except
ChatGPT**. The legacy `../api`, `../MyApp`, and `../resberrypi` folders remain
preserved migration evidence; a preserved screen or route is not evidence that
the capability has been implemented in SmartFarmOS.

ChatGPT is excluded by product-owner direction. SmartFarmOS must not add a
ChatGPT navigation item, `/chatgpt` API route, OpenAI client, or
`OPENAI_API_KEY` configuration for this scope.

## Status vocabulary

| Status | Meaning |
| --- | --- |
| `preserved` | Legacy source and behavior were identified without copying secrets or generated files. |
| `contracted` | A SmartFarmOS-owned, runtime-validated API/device contract exists. |
| `implemented` | The PWA and its authoritative API/Edge path perform the behavior. |
| `browser-verified` | A real browser smoke proves the primary user path. |
| `external-gate` | New provider credentials, provider terms, or physical hardware evidence are still required. |
| `excluded` | Deliberately outside the product scope. |

Only `browser-verified` is treated as completed PWA parity. A fixture-backed
provider can be browser-verified as a reproducible demo while its live adapter
remains under `external-gate`.

## Canonical parity matrix

| Capability | Legacy evidence | Current SmartFarmOS state | Completion evidence |
| --- | --- | --- | --- |
| Login and registration | `../api/server/routes/auth.js`, `../api/client/src/pages/Auth` | `preserved`; production identity is not implemented | Passwords are never stored in plaintext; register, login, logout, session restoration, farm membership, and failure states are API- and browser-tested |
| Farm selection | Implicit/single-site legacy scope | `contracted`, `implemented`, and `browser-verified` in the local guarded demo | Authenticated `GET /v1/farms`; selection survives reload; unauthorized farms are rejected |
| Crop management | `../api/server/routes/cropRoutes.js`, `../api/client/src/pages/dashboard/Crop` | Farm-scoped list/create/edit/delete is `contracted`, persisted, and `browser-verified` locally | Farm-scoped list, create, edit, detail, and delete persist across API restart and are browser-tested |
| Device management | `../api/server/routes/deviceRoutes.js`, legacy dashboard Device pages | Discovery is `contracted` and implemented locally; inventory mutations remain `preserved` only | Farm-scoped inventory, filter, detail, create, edit, and retirement; operational identity remains distinct from inventory metadata |
| Alerts | `../api/server/routes/alertRoutes.js`, legacy Alerts page | Farm/cycle-scoped threshold rules, active/history state, idempotent acknowledgement, and audit are `contracted`, persisted, implemented, and `browser-verified` in the guarded demo; unread/delete and notification delivery remain pending | Rules-generated alarm trigger/update/clear, acknowledgement, audit, farm isolation, restart, and browser flow; optional push is a separate adapter |
| Revenue and cost | Legacy profit pages and `calculateRevenueRoutes.js` | `preserved`, but legacy behavior is a stub with hardcoded values | Persistent income/expense entries, deterministic totals/net profit, validation, edit/delete, and browser tests |
| News | `../api/server/routes/news.js`, legacy News tab | `preserved`; provider inventory recorded | Normalized server DTO, fixture adapter, cache/error/attribution UI, then optional NewsAPI live adapter |
| Weather | `../api/server/routes/weather.js`, legacy Weather tab | Normalized city/coordinate contract, farm-scoped API, deterministic fixture, bounded cache/error/source-time UI, and real-browser fixture flow are `browser-verified`; the fixed-endpoint OpenWeather live adapter is implemented but remains an `external-gate` until a newly issued server key and provider terms are reviewed | Fixture and live source labels, query validation, cache miss/hit/stale, timeout/size bounds, raw-payload exclusion, farm authorization, and browser evidence |
| Map/place search | `../api/server/routes/map.js`, legacy Map tab | Shares the dedicated weather/location page shell; search/map data remains `preserved` only | Place-search adapter plus accessible location result/map surface, explicit public-key classification, provider attribution, and browser test |
| Agricultural prices | `../api/server/routes/price.js`, legacy Price tab | `preserved` | Normalized market-price DTO, fixture adapter, filter/search/source date UI, then optional KAMIS adapter |
| Multi-bed environment | Legacy Environment pages and MQTT topics for beds 1-4 | Two discovered simulator beds, their growing areas, active crop-cycle assignment, side-by-side temperature/humidity/illuminance/water-level latest/history, and selected-area approved irrigation application are `contracted`, `implemented`, and `browser-verified`, including freshness, target water/alarm evidence, explicit target/safety confirmation, transient apply-status failure recovery, post-completion repeat lock, and same-session offline preservation; gas telemetry and generalized bed/tank mapping remain pending | Beds are discovered devices, not hardcoded tabs; temperature, humidity, light, water level, and available gas data render with freshness/error states |
| Water tank | Legacy water-tank topics and UI | `preserved`; legacy socket path was incomplete | Tank device reports temperature, pH, and level through validated telemetry; history/latest views are browser-tested |
| LED control | Legacy `led1_control`/status events | `preserved`; no new command yet | Scoped, expiring, idempotent switch command, Edge ACK, safe fallback, state restoration, browser test |
| Motor control | Legacy motor on/off events | Dedicated control page owns the `browser-verified` V1 pump command and its unscoped terminal AuditEvent V2. A farm-scoped data-only profile can add/remove reviewed pump cards, rename them, and hide start while keeping software stop mandatory. The default approved V2 strategy fans out a five-second device-local timed command only to `timed_pump` devices and waits for final-off ACK, aggregate result, and cycle-scoped audit. A V1 `off` has an independent Edge software-stop lane: it interrupts an active timed simulator run, records causal ACK V2 `manual_stop`, and persists a stop fence that rejects older queued activations after restart. The Edge also persists completed ACKs before upload; an ambiguous `executing` record remains blocked for reconciliation. Physical emergency stops/interlocks, in-progress physical-device recovery, real firmware proof, and general motor mapping remain unimplemented | Explicit actuator identity, scoped command, ACK/result state, direct audit, profile revision/persistence test, timed interruption/fence test, ACK-outbox restart test, ambiguous execution no-replay test, safe fallback, browser test |
| Direction and speed | Legacy DC motor direction and raw `0..255` speed events | `preserved` | One atomic motor-drive command with `left/right/stop` and normalized `0..100%` speed, ACK, validation, browser test |
| Timers/schedules | Browser-local legacy timers | `preserved`; unsafe legacy execution is rejected | API-owned schedules with timezone, enable/disable, next run, audit trail, idempotent command creation, and restart tests |
| Camera | Four hardcoded legacy image-stream URLs | `preserved`; no secure stream contract exists | Camera device metadata, authenticated/signed stream or snapshot boundary, offline/privacy states, no hardcoded private URL, browser test |
| ChatGPT | Legacy tab and `/api/chatgpt` route | `excluded` | No navigation, API route, provider adapter, package, config label, or secret in the canonical product |

## Migration order

1. Dynamic farm/device discovery and crop management through the injected local
   identity boundary. **Completed and browser-verified locally.**
2. Production identity, device inventory, remaining notification delivery, and real revenue/cost persistence.
3. Two simulator beds, crop-cycle area assignment, and side-by-side telemetry
   comparison are implemented and browser-verified locally; extend the same
   discovered-device path to the water tank.
4. Approved pump strategy fan-out is completed locally; add LED, general motor,
   direction/speed, and server-owned schedules through the same Edge command/ACK lifecycle.
5. Weather fixture and its optional live adapter are implemented; add news,
   place search, and market prices through normalized fixture adapters, and
   enable every live provider only with newly issued credentials.
6. Camera through an authenticated Edge/API boundary.
7. Run the complete desktop, mobile, offline, access-control, and restart parity
   gate before considering any legacy client for retirement.

## Contract corrections required during migration

- Never preserve the legacy plaintext password comparison or its incompatible
  JWT payload/middleware assumptions.
- Do not preserve raw upstream provider payloads. The PWA consumes
  SmartFarmOS-owned DTOs only.
- Do not let the browser talk directly to MQTT, store device credentials, or
  execute schedules from a one-second page timer.
- Do not preserve the legacy weather bug in which lat/lon was sent to the city
  endpoint instead of the location endpoint.
- Treat profit as a new persistent capability, not as a migration of the legacy
  hardcoded totals.
- Treat each bed, water tank, actuator, and camera as a farm-scoped device.
- A camera URL is configuration metadata delivered through an authorized
  boundary, never a literal copied from a legacy component.

## External and physical gates

Local fixtures and the device simulator are the reproducible contest-demo
baseline. Live weather code exists but remains credential/terms-gated; live
news, map, price, push, MQTT, and camera integrations require newly issued
credentials or physical-device evidence. Their absence
must not make internal crop/device/alert/finance behavior unavailable, and a
fixture-backed demo must be visibly labelled as demo data.
