import assert from "node:assert/strict";
import test from "node:test";
import { WeatherLocationQuerySchema } from "@smartfarm-os/contracts";
import { createOpenWeatherCompatibleProvider } from "./openweather-provider.js";
import {
  WeatherProviderError,
  createWeatherProviderFromEnvironment,
} from "./weather-provider.js";

const fixedNow = new Date("2026-08-10T01:00:00.000Z");

test("uses deterministic fixture weather when no server credential exists", async () => {
  const provider = createWeatherProviderFromEnvironment({});
  const location = WeatherLocationQuerySchema.parse({ city: "서울" });
  const first = await provider.getCurrent(location, {
    now: fixedNow,
    signal: new AbortController().signal,
  });
  const second = await provider.getCurrent(location, {
    now: fixedNow,
    signal: new AbortController().signal,
  });

  assert.equal(provider.kind, "fixture");
  assert.deepEqual(first, second);
  assert.equal(first.conditions.temperatureCelsius, 24.5);
  assert.match(first.conditions.summary, /시범 데이터/);
});

test("normalizes an OpenWeather-compatible response without returning raw fields", async () => {
  const requestedUrls: URL[] = [];
  const provider = createOpenWeatherCompatibleProvider({
    providerKey: "fixture-provider-key",
    fetchImplementation: async (input, init) => {
      requestedUrls.push(new URL(String(input)));
      assert.equal(init?.redirect, "error");
      assert.ok(init?.signal instanceof AbortSignal);
      return jsonResponse({
        coord: { lon: 126.978, lat: 37.5665 },
        weather: [{ id: 800, description: "clear sky", rawIcon: "must-not-cross" }],
        main: { temp: 23.7, feels_like: 23.1, humidity: 58, pressure: 1_010 },
        wind: { speed: 2.8, deg: 270 },
        clouds: { all: 5 },
        rain: { "1h": 0.4 },
        dt: 1_786_327_200,
        timezone: 32_400,
        name: "Seoul",
        sys: { country: "kr" },
        upstreamSecret: "must-not-cross",
      });
    },
  });

  const reading = await provider.getCurrent(
    WeatherLocationQuerySchema.parse({ city: "Seoul" }),
    { now: fixedNow, signal: new AbortController().signal },
  );

  const requestedUrl = requestedUrls[0];
  assert.ok(requestedUrl);
  assert.equal(requestedUrl.origin, "https://api.openweathermap.org");
  assert.equal(requestedUrl.pathname, "/data/2.5/weather");
  assert.equal(requestedUrl.searchParams.get("q"), "Seoul");
  assert.equal(requestedUrl.searchParams.get("units"), "metric");
  assert.equal(requestedUrl.searchParams.get("appid"), "fixture-provider-key");
  assert.equal(reading.source.kind, "live");
  assert.equal(reading.location.countryCode, "KR");
  assert.equal(reading.conditions.precipitationMillimetersLastHour, 0.4);
  assert.equal(JSON.stringify(reading).includes("must-not-cross"), false);
  assert.equal(JSON.stringify(reading).includes("pressure"), false);
});

test("rejects oversized upstream responses before exposing their body", async () => {
  const provider = createOpenWeatherCompatibleProvider({
    providerKey: "fixture-provider-key",
    fetchImplementation: async () => new Response("{}", {
      status: 200,
      headers: {
        "content-length": String(64 * 1_024 + 1),
        "content-type": "application/json",
      },
    }),
  });

  await assert.rejects(
    provider.getCurrent(
      WeatherLocationQuerySchema.parse({ latitude: 37.5, longitude: 127 }),
      { now: fixedNow, signal: new AbortController().signal },
    ),
    (error: unknown) => error instanceof WeatherProviderError
      && error.kind === "invalid_response",
  );
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
