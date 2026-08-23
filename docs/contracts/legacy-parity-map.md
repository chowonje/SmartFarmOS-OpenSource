# Legacy-to-SmartFarmOS Contract Map

This is a compatibility report, not a promise that SmartFarmOS will expose the
legacy paths. Legacy source remains in `../api`, `../MyApp`, and
`../resberrypi`; new consumers use versioned SmartFarmOS contracts only.

| Legacy surface | SmartFarmOS target | Current status | Intentional breaking changes |
| --- | --- | --- | --- |
| `POST /api/auth/login`, `POST /api/auth/register` | production identity adapter and versioned session endpoints | pending | No plaintext password comparison; one consistent token/session contract; farm membership is authoritative |
| `GET /api/crops/logs` | `GET /v1/farms/:farmId/crops` | implemented and browser-verified locally | Farm/role scope, `{ schemaVersion, crops }` envelope, normalized fields, strict validation |
| `GET /api/crops/logs/:id` | `GET /v1/farms/:farmId/crops/:cropId` | implemented | Typed `crop:<slug>` ID and farm-scoped lookup |
| `POST /api/crops/logs` | `POST /v1/farms/:farmId/crops` | implemented and browser-verified locally | Weather is not fetched by an internal HTTP self-call; request accepts only crop intent and an optional registered device |
| `PUT /api/crops/logs/:id` | `PATCH /v1/farms/:farmId/crops/:cropId` | implemented and browser-verified locally | Partial normalized patch; empty/unknown fields rejected; update time is server-owned |
| no reliable legacy crop delete | `DELETE /v1/farms/:farmId/crops/:cropId` | implemented and browser-verified locally | `204` success and farm-scoped `404` |
| implicit single farm | `GET /v1/farms` | implemented and browser-verified locally | Returns only farms in the authenticated principal's membership |
| `GET /api/device/devices` | `GET /v1/farms/:farmId/devices` | discovery implemented locally | Farm scope, normalized `Device V1`, versioned response; inventory mutations remain pending |
| legacy device create/update/delete routes | farm-scoped inventory mutation routes | pending | Operational device identity and user-entered inventory metadata will be separated |
| `/api/alerts*` | `GET /v1/farms/:farmId/alarms`, alarm acknowledgement, and audit-event reads | threshold trigger/history/acknowledgement/audit implemented and browser-verified locally; unread/delete/push pending | Farm/cycle scope, separate rule/instance/ack state, strict envelopes, and idempotent audit replace the legacy shape; unread counts and notification providers remain separate |
| profit UI and empty revenue route | persistent finance entry/totals API | pending new implementation | No hardcoded totals; monetary unit, date, entry type, and deterministic net calculation required |
| `/api/news` | normalized news-provider port plus fixture | pending | No upstream payload passthrough; cache, source time, attribution, and explicit errors |
| `/api/weather`, `/api/weather/location` | `GET /v1/farms/:farmId/weather/current` with normalized city/coordinate input | fixture path implemented and browser-verified; fixed-endpoint live adapter implemented but external credential/terms gate remains | Fixes the legacy lat/lon-to-city-route mismatch, removes crop-route self-fetching, enforces farm auth, and never passes through raw provider data |
| `/api/map` | normalized place-search port plus fixture | pending | No copied hardcoded browser key; public configuration and attribution are explicit |
| `/api/price` | normalized market-price port plus fixture | pending | HTTPS/provider policy review, normalized items, cache/source date, and attribution |
| bare Socket.IO LED/motor events | farm/device-scoped expiring commands and ACKs | manual V1 pump with unscoped terminal audit and approved selected-area five-second device-local timed V2 strategy fan-out are implemented and browser-verified locally; LED/general motor pending | Auth, IDs, idempotency, expiry, final-off terminal ACK, direct/aggregate strategy audit, safe failure; no physical interlock or real-hardware claim |
| browser-local timers | API-owned schedules that create commands | pending | Survives closed/sleeping clients; timezone, audit, and duplicate-run protection |
| fixed bed/tank socket event names | discovered device telemetry | selected-device and two-bed selected-cycle temperature/humidity/illuminance/water-level latest/history are implemented and browser-verified locally; generalized bed/tank mapping remains pending | Typed metrics, units, sequence, freshness, and farm/device/area/cycle identity |
| hardcoded camera `<img>` URLs | authorized camera metadata/stream boundary | pending | No private literal URL in PWA source; explicit offline/privacy behavior |
| `/api/chatgpt/ask` and ChatGPT tab | no replacement | excluded | Route, navigation, provider adapter, dependency, and configuration are deliberately absent |

## Safe rollout rule

A legacy producer or client is retired only after its new contract, authoritative
implementation, failure tests, restart behavior where relevant, and real-browser
path all pass. A matching label or screenshot is not compatibility evidence.
