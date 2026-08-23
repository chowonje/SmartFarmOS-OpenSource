# ADR 0007: One User PWA With Full Legacy Parity Except ChatGPT

- Status: accepted
- Date: 2026-07-17

## Context

The earlier project split user behavior across a web client, a mobile app, a
Raspberry Pi control client, REST routes, and browser-direct Socket.IO/MQTT
flows. The first SmartFarmOS slice intentionally proved only one temperature
reading and one pump command.

The product owner now requires the installable PWA to contain login and
registration, crop and device management, alerts, finance, news, weather, map,
market prices, LED/motor/timer/speed control, multiple beds, water-tank data,
and camera access. ChatGPT is the only named exclusion.

Several legacy surfaces cannot be copied safely:

- login compares plaintext passwords and the JWT middleware expects a different
  payload from the login route;
- profit pages contain hardcoded totals and do not persist entries;
- device commands are unscoped, fire-and-forget socket strings;
- timers execute only while a browser page is awake;
- camera URLs and a browser map key are hardcoded;
- external-provider responses lack a shared cache/error/attribution contract.

## Decision

SmartFarmOS will expose one responsive, installable user PWA for desktop and
mobile. All in-scope behavior crosses the TypeScript central API. Device and
camera behavior also crosses the Edge boundary. The legacy clients remain
preserved references until each capability reaches its explicit parity gate.

Migration is contract-first and incremental:

1. define strict SmartFarmOS-owned runtime contracts;
2. implement authoritative persistence or Edge execution;
3. expose the user flow in the PWA;
4. test API scope, restart behavior, and failures;
5. verify the primary path in a real browser.

Fixture adapters are the default for news, weather, place search, and market
prices so the complete demo remains reproducible without provider keys. Live
adapters are optional deployment choices and receive only newly issued,
server-side credentials. Intentionally public browser configuration must be
classified and origin-restricted.

ChatGPT is excluded from the PWA, API, provider configuration, dependencies,
and contest-critical path. This decision does not merely hide the legacy tab;
the OpenAI route and configuration are not migrated.

## Consequences

- The PWA grows by verified vertical slices instead of a bulk UI port.
- Legacy labels and useful interactions can be retained, but legacy endpoints
  and payloads are compatibility evidence rather than the new public contract.
- Login and finance require new implementations because copying the legacy
  behavior would preserve security and correctness defects.
- Schedules belong to the API/Edge lifecycle and keep working when the PWA is
  closed.
- Physical control and camera parity remain unclaimed until simulator tests and
  real-device evidence both exist.
- Provider attribution, caching, rate limits, and source timestamps become part
  of the feature acceptance criteria.
- `docs/feature-parity.md` is the canonical feature status and retirement gate.
