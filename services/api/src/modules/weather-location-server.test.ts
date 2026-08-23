import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiErrorSchema,
  CurrentWeatherResponseSchema,
  FarmIdSchema,
  WeatherProviderReadingSchema,
  type WeatherProviderReading,
} from "@smartfarm-os/contracts";
import { DEFAULT_BUILT_IN_MODULE_CONFIGURATION } from "@smartfarm-os/module-sdk/builtins";
import type { FastifyRequest } from "fastify";
import { buildApi } from "../app.js";
import type { AuthPrincipal } from "../auth.js";
import { InMemorySmartFarmStore } from "../store.js";
import {
  WeatherProviderError,
  type WeatherProvider,
} from "../weather-provider.js";

const farmId = FarmIdSchema.parse("farm:demo");
const firstNow = new Date("2026-08-10T01:00:00.000Z");

test("serves normalized fixture weather and reuses a fresh bounded cache entry", async (t) => {
  let calls = 0;
  const provider: WeatherProvider = {
    id: "test-fixture",
    kind: "fixture",
    async getCurrent(location, context) {
      calls += 1;
      assert.equal(location.city, "Seoul");
      return weatherReading(context.now.toISOString(), "fixture");
    },
  };
  const app = buildWeatherApi(provider, () => firstNow);
  t.after(() => app.close());

  const anonymous = await app.inject({
    method: "GET",
    url: `/v1/farms/${encodeURIComponent(farmId)}/weather/current?city=Seoul`,
  });
  const first = await app.inject({
    method: "GET",
    url: `/v1/farms/${encodeURIComponent(farmId)}/weather/current?city=Seoul`,
    headers: { "x-test-principal": "user" },
  });
  const second = await app.inject({
    method: "GET",
    url: `/v1/farms/${encodeURIComponent(farmId)}/weather/current?city=Seoul`,
    headers: { "x-test-principal": "user" },
  });

  assert.equal(anonymous.statusCode, 401);
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(CurrentWeatherResponseSchema.parse(first.json()).cache.status, "miss");
  assert.equal(CurrentWeatherResponseSchema.parse(second.json()).cache.status, "hit");
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(first.json()).includes("upstream"), false);
});

test("validates city and coordinate queries before calling the provider", async (t) => {
  let calls = 0;
  const provider: WeatherProvider = {
    id: "unused",
    kind: "fixture",
    async getCurrent(_location, context) {
      calls += 1;
      return weatherReading(context.now.toISOString(), "fixture");
    },
  };
  const app = buildWeatherApi(provider, () => firstNow);
  t.after(() => app.close());

  const mixed = await app.inject({
    method: "GET",
    url: `/v1/farms/${encodeURIComponent(farmId)}/weather/current?city=Seoul&latitude=37.5&longitude=127`,
    headers: { "x-test-principal": "user" },
  });
  const incomplete = await app.inject({
    method: "GET",
    url: `/v1/farms/${encodeURIComponent(farmId)}/weather/current?latitude=37.5`,
    headers: { "x-test-principal": "user" },
  });
  const outOfRange = await app.inject({
    method: "GET",
    url: `/v1/farms/${encodeURIComponent(farmId)}/weather/current?latitude=91&longitude=127`,
    headers: { "x-test-principal": "user" },
  });

  assert.equal(mixed.statusCode, 400);
  assert.equal(incomplete.statusCode, 400);
  assert.equal(outOfRange.statusCode, 400);
  assert.equal(ApiErrorSchema.parse(mixed.json()).code, "invalid_request");
  assert.equal(calls, 0);
});

test("falls back to explicitly stale cache data when a live refresh fails", async (t) => {
  let currentNow = firstNow;
  let shouldFail = false;
  const provider: WeatherProvider = {
    id: "flaky-live",
    kind: "live",
    async getCurrent(_location, context) {
      if (shouldFail) throw new WeatherProviderError("unavailable", "raw upstream detail");
      return weatherReading(context.now.toISOString(), "live");
    },
  };
  const app = buildWeatherApi(provider, () => currentNow);
  t.after(() => app.close());

  const url = `/v1/farms/${encodeURIComponent(farmId)}/weather/current?latitude=37.5665&longitude=126.978`;
  const first = await app.inject({
    method: "GET",
    url,
    headers: { "x-test-principal": "user" },
  });
  currentNow = new Date(firstNow.getTime() + 6 * 60 * 1_000);
  shouldFail = true;
  const stale = await app.inject({
    method: "GET",
    url,
    headers: { "x-test-principal": "user" },
  });

  const firstBody = CurrentWeatherResponseSchema.parse(first.json());
  const staleBody = CurrentWeatherResponseSchema.parse(stale.json());
  assert.equal(stale.statusCode, 200);
  assert.equal(staleBody.cache.status, "stale");
  assert.equal(staleBody.warning?.code, "provider_unavailable");
  assert.equal(staleBody.source.fetchedAt, firstBody.source.fetchedAt);
  assert.equal(JSON.stringify(staleBody).includes("raw upstream detail"), false);
});

test("bounds provider time and returns a normalized upstream error without cached data", async (t) => {
  let aborted = false;
  const provider: WeatherProvider = {
    id: "slow-live",
    kind: "live",
    getCurrent(_location, context) {
      return new Promise<WeatherProviderReading>((_resolve, reject) => {
        context.signal.addEventListener("abort", () => {
          aborted = true;
          reject(new WeatherProviderError("timeout", "provider timeout detail"));
        }, { once: true });
      });
    },
  };
  const app = buildWeatherApi(provider, () => firstNow, 5);
  t.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: `/v1/farms/${encodeURIComponent(farmId)}/weather/current?city=Seoul`,
    headers: { "x-test-principal": "user" },
  });

  assert.equal(response.statusCode, 502);
  assert.equal(ApiErrorSchema.parse(response.json()).code, "upstream_unavailable");
  assert.equal(JSON.stringify(response.json()).includes("provider timeout detail"), false);
  assert.equal(aborted, true);
});

test("removes the weather route when the reviewed module is disabled", async (t) => {
  const app = buildApi({
    authenticate,
    now: () => firstNow,
    store: seededStore(),
    weatherProvider: {
      id: "unused",
      kind: "fixture",
      async getCurrent(_location, context) {
        return weatherReading(context.now.toISOString(), "fixture");
      },
    },
    moduleConfiguration: {
      ...DEFAULT_BUILT_IN_MODULE_CONFIGURATION,
      modules: DEFAULT_BUILT_IN_MODULE_CONFIGURATION.modules.map((module) => (
        module.moduleId === "smartfarm.weather-location"
          ? { ...module, enabled: false }
          : module
      )),
    },
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: `/v1/farms/${encodeURIComponent(farmId)}/weather/current?city=Seoul`,
    headers: { "x-test-principal": "user" },
  });

  assert.equal(response.statusCode, 404);
});

function buildWeatherApi(
  provider: WeatherProvider,
  now: () => Date,
  weatherRequestTimeoutMs = 100,
) {
  return buildApi({
    authenticate,
    now,
    store: seededStore(),
    weatherProvider: provider,
    weatherRequestTimeoutMs,
  });
}

function authenticate(request: FastifyRequest): AuthPrincipal | null {
  return request.headers["x-test-principal"] === "user"
    ? { id: "user:demo", role: "user", farmIds: [farmId] }
    : null;
}

function seededStore(): InMemorySmartFarmStore {
  const store = new InMemorySmartFarmStore();
  store.upsertFarm({
    schemaVersion: "smartfarm.farm.v1",
    id: farmId,
    name: "Demo Farm",
    timezone: "Asia/Seoul",
    createdAt: firstNow.toISOString(),
  });
  return store;
}

function weatherReading(
  observedAt: string,
  kind: "fixture" | "live",
): WeatherProviderReading {
  return WeatherProviderReadingSchema.parse({
    schemaVersion: "smartfarm.weather-provider-reading.v1",
    source: {
      kind,
      provider: kind === "fixture" ? "test-fixture" : "test-live",
      observedAt,
    },
    location: {
      name: "Seoul",
      countryCode: "KR",
      latitude: 37.5665,
      longitude: 126.978,
      timezoneOffsetSeconds: 32_400,
    },
    conditions: {
      summary: kind === "fixture" ? "Clear (fixture)" : "Clear",
      temperatureCelsius: 24.5,
      feelsLikeCelsius: 24.1,
      humidityPercent: 61,
      cloudCoverPercent: 12,
      windSpeedMetersPerSecond: 2.4,
      precipitationMillimetersLastHour: null,
    },
  });
}
