# External API and Service Inventory

## Owner Direction

On 2026-07-17, the project owner confirmed that every legacy provider account and
credential is under their control. All environment values are disposable and
will be reissued before an integration is enabled in a shared deployment.

This inventory records provider names, purposes, and configuration labels only.
It must never contain an API key, token, password, private key, service-account
JSON, or replacement value. Development continues with contracts, injected
adapters, fixtures, and the device simulator; credential reissue is a deployment
and public-release gate, not a blocker for local product code.

## Product-Critical Boundaries

| Boundary | Purpose | Target configuration | Current status |
| --- | --- | --- | --- |
| Central API HTTP V1 | Browser and Edge authority for telemetry and commands | `PUBLIC_API_BASE_URL`, server-side identity configuration | Implemented locally; production identity pending |
| Realtime channel | PWA telemetry and command-status updates | `PUBLIC_REALTIME_URL` | Planned |
| MQTT broker | Edge-to-device telemetry and command transport | `MQTT_BROKER_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `EDGE_GATEWAY_ID` | Planned; Edge HTTP slice uses the simulator |
| Device-local transport | Sensor, pump, camera, or simulator adapter | Device-specific Edge configuration | Simulator verified; physical adapter pending |

Browsers must never receive MQTT credentials, privileged database credentials,
service-account credentials, or server-side API keys.

## Legacy External Integrations

| Provider or service | Legacy purpose | Legacy configuration labels | Target treatment |
| --- | --- | --- | --- |
| OpenAI API | Legacy chat or crop-assistance route | `OPENAI_API_KEY` | Excluded by product-owner direction; do not add the route, adapter, configuration, or dependency |
| NewsAPI | Agriculture/news feed | `NEWS_API_KEY` | Optional server adapter; local fixture required for a reproducible demo |
| OpenWeatherMap | Weather lookup | legacy `WEATHER_API_KEY`; target `SMARTFARM_OPENWEATHER_API_KEY` | Normalized server adapter and deterministic fixture implemented; live mode uses only a newly issued server-side key and the fixed official endpoint after provider-term/quota review |
| Kakao Local/Maps | Location search and browser map rendering | `MAP_API_KEY`, `REACT_APP_KAKAO_MAP_API_KEY` | Split server REST key from intentionally public browser key; restrict origins and quota |
| KAMIS | Agricultural price information | `KAMIS_CERT_ID`, `KAMIS_CERT_KEY` | Optional server adapter; disclose provider terms if retained |
| Firebase Admin and FCM | Push notification and messaging | Legacy service-account JSON and client Firebase configuration | Alerts are in scope, but push remains an optional adapter; never migrate the legacy key |
| Supabase | Legacy data/auth configuration | `REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_ANON_KEY` | Reassess after central persistence; no service-role credential may enter a browser bundle |
| Legacy REST servers | Separate user/admin/server origins | `REACT_APP_ADMIN_API_URL`, `REACT_APP_FRONT_API_URL`, `REACT_APP_SERVER_API_URL` | Replace with the single central API boundary |
| Legacy WebSocket/MQTT URL | Browser-direct device connection | `REACT_APP_WEBSOCKET_MQTT_URL` | Retire from the PWA; device transport belongs to the Edge Gateway |

## Reissue Policy

For each integration that is deliberately enabled:

1. Issue a new credential from the provider account.
2. Store it outside Git in the local environment or deployment secret store.
3. Apply the narrowest available origin, IP, role, and quota restrictions.
4. Record provider, owner, issue/rotation date, status, and verification result in
   `docs/credential-rotation.md` without recording the value.
5. Verify that browser bundles contain only configuration explicitly classified
   as public.
6. Rerun the canonical repository privacy gate before sharing or deployment.

Legacy environment files and Git history are evidence inputs only and are never
copied into the canonical repository.
