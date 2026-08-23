# Weather Provider Setup

SmartFarmOS always exposes one normalized farm-scoped weather API and never
returns a provider's raw payload or credential to the browser.

## Reproducible fixture mode

When `SMARTFARM_OPENWEATHER_API_KEY` is absent or blank, the server returns
deterministic fixture data. The PWA labels it `시범 데이터` and states that it is
not a real observation. This is the default for tests, local demos, and offline
contest rehearsal.

## Optional live mode

Set `SMARTFARM_OPENWEATHER_API_KEY` only in the server or deployment secret
environment. The adapter calls the fixed official OpenWeather current-weather
endpoint; no configurable upstream URL is accepted. Do not use a legacy key.

Before enabling live mode:

1. issue a new provider key and apply the narrowest available quota and source
   restrictions;
2. confirm the provider's display, attribution, storage, cache, and
   redistribution terms for the pilot;
3. keep the value out of Git, browser variables, screenshots, and logs;
4. verify the PWA source badge says `라이브`, the observation/server times are
   plausible, and provider failure is shown as stale cache or a bounded error;
5. record rotation status without the value in `docs/credential-rotation.md`.

The live adapter has automated mock-response coverage for normalization,
timeout, response-size bounds, raw-field exclusion, caching, and fallback. A
real provider call still requires the newly issued credential and owner review.
