import assert from "node:assert/strict";
import test from "node:test";
import {
  CurrentWeatherResponseSchema,
  WeatherLocationQuerySchema,
} from "./weather.js";

const fetchedAt = "2026-08-10T01:00:00.000Z";

test("accepts exactly one validated weather locator", () => {
  assert.deepEqual(WeatherLocationQuerySchema.parse({ city: "  서울  " }), {
    city: "서울",
  });
  assert.deepEqual(
    WeatherLocationQuerySchema.parse({ latitude: "37.5665", longitude: "126.978" }),
    { latitude: 37.5665, longitude: 126.978 },
  );

  assert.equal(WeatherLocationQuerySchema.safeParse({}).success, false);
  assert.equal(
    WeatherLocationQuerySchema.safeParse({ city: "서울", latitude: 37, longitude: 127 }).success,
    false,
  );
  assert.equal(
    WeatherLocationQuerySchema.safeParse({ latitude: 91, longitude: 127 }).success,
    false,
  );
  assert.equal(
    WeatherLocationQuerySchema.safeParse({ latitude: "", longitude: "127" }).success,
    false,
  );
});

test("keeps normalized weather strict and makes stale warnings explicit", () => {
  const input = {
    schemaVersion: "smartfarm.current-weather.v1",
    source: {
      kind: "fixture",
      provider: "smartfarm-fixture-v1",
      observedAt: fetchedAt,
      fetchedAt,
    },
    location: {
      name: "서울",
      countryCode: "KR",
      latitude: 37.5665,
      longitude: 126.978,
      timezoneOffsetSeconds: 32_400,
    },
    conditions: {
      summary: "맑음 (시범 데이터)",
      temperatureCelsius: 24.5,
      feelsLikeCelsius: 24.1,
      humidityPercent: 61,
      cloudCoverPercent: 12,
      windSpeedMetersPerSecond: 2.4,
      precipitationMillimetersLastHour: null,
    },
    cache: {
      status: "miss",
      cachedAt: fetchedAt,
      expiresAt: "2026-08-10T01:05:00.000Z",
    },
    warning: null,
  } as const;

  assert.equal(CurrentWeatherResponseSchema.parse(input).source.kind, "fixture");
  assert.equal(
    CurrentWeatherResponseSchema.safeParse({ ...input, upstreamPayload: { secret: true } }).success,
    false,
  );
  assert.equal(
    CurrentWeatherResponseSchema.safeParse({
      ...input,
      cache: { ...input.cache, status: "stale" },
    }).success,
    false,
  );
  assert.equal(
    CurrentWeatherResponseSchema.safeParse({
      ...input,
      cache: { ...input.cache, status: "stale" },
      warning: {
        code: "provider_unavailable",
        message: "Cached weather is shown because the provider is unavailable",
      },
    }).success,
    true,
  );
});
