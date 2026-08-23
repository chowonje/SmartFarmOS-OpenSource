import {
  WeatherProviderReadingSchema,
  type WeatherLocationQuery,
  type WeatherProviderReading,
} from "@smartfarm-os/contracts";
import {
  WeatherProviderError,
  type WeatherProvider,
  type WeatherProviderRequestContext,
} from "./weather-provider.js";

const DEFAULT_BASE_URL = "https://api.openweathermap.org/data/2.5/weather";
const MAX_UPSTREAM_RESPONSE_BYTES = 64 * 1_024;

export type WeatherFetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type OpenWeatherCompatibleProviderOptions = {
  readonly providerKey: string;
  readonly fetchImplementation?: WeatherFetchImplementation;
};

export function createOpenWeatherCompatibleProvider(
  options: OpenWeatherCompatibleProviderOptions,
): WeatherProvider {
  const providerKey = normalizeProviderKey(options.providerKey);
  const baseUrl = new URL(DEFAULT_BASE_URL);
  const fetchImplementation = options.fetchImplementation
    ?? ((input, init) => globalThis.fetch(input, init));

  return {
    id: "openweather-compatible",
    kind: "live",
    async getCurrent(location, context) {
      const url = createRequestUrl(baseUrl, providerKey, location);
      let response: Response;

      try {
        response = await fetchImplementation(url, {
          headers: { accept: "application/json" },
          redirect: "error",
          signal: context.signal,
        });
      } catch {
        if (context.signal.aborted) {
          throw new WeatherProviderError("timeout", "Weather provider request timed out");
        }
        throw new WeatherProviderError("unavailable", "Weather provider request failed");
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        if (response.status === 404) {
          throw new WeatherProviderError("location_not_found", "Weather location was not found");
        }
        throw new WeatherProviderError("unavailable", "Weather provider was unavailable");
      }

      const payload = await readBoundedJson(response);
      return normalizeOpenWeatherPayload(payload, context);
    },
  };
}

function createRequestUrl(
  baseUrl: URL,
  providerKey: string,
  location: WeatherLocationQuery,
): URL {
  const url = new URL(baseUrl);
  url.searchParams.set("appid", providerKey);
  url.searchParams.set("units", "metric");

  if (location.city !== undefined) {
    url.searchParams.set("q", location.city);
  } else {
    if (location.latitude === undefined || location.longitude === undefined) {
      throw new WeatherProviderError("invalid_configuration", "Weather coordinates are missing");
    }
    url.searchParams.set("lat", String(location.latitude));
    url.searchParams.set("lon", String(location.longitude));
  }
  return url;
}

function normalizeOpenWeatherPayload(
  payload: unknown,
  _context: WeatherProviderRequestContext,
): WeatherProviderReading {
  try {
    const root = asRecord(payload);
    const coordinates = asRecord(root.coord);
    const main = asRecord(root.main);
    const wind = asRecord(root.wind);
    const clouds = asRecord(root.clouds);
    const system = asRecord(root.sys);
    const weatherItems = root.weather;
    if (!Array.isArray(weatherItems) || weatherItems.length === 0) throw new Error("weather");
    const primaryCondition = asRecord(weatherItems[0]);
    const observedUnixSeconds = readFiniteNumber(root, "dt");
    const observedAt = new Date(observedUnixSeconds * 1_000).toISOString();
    const rain = readOptionalLastHour(root.rain);
    const snow = readOptionalLastHour(root.snow);
    const precipitation = rain === null && snow === null ? null : (rain ?? 0) + (snow ?? 0);

    return WeatherProviderReadingSchema.parse({
      schemaVersion: "smartfarm.weather-provider-reading.v1",
      source: {
        kind: "live",
        provider: "openweather-compatible",
        observedAt,
      },
      location: {
        name: readString(root, "name"),
        countryCode: readNullableCountryCode(system.country),
        latitude: readFiniteNumber(coordinates, "lat"),
        longitude: readFiniteNumber(coordinates, "lon"),
        timezoneOffsetSeconds: readFiniteNumber(root, "timezone"),
      },
      conditions: {
        summary: readString(primaryCondition, "description"),
        temperatureCelsius: readFiniteNumber(main, "temp"),
        feelsLikeCelsius: readFiniteNumber(main, "feels_like"),
        humidityPercent: readFiniteNumber(main, "humidity"),
        cloudCoverPercent: readFiniteNumber(clouds, "all"),
        windSpeedMetersPerSecond: readFiniteNumber(wind, "speed"),
        precipitationMillimetersLastHour: precipitation,
      },
    });
  } catch (error) {
    if (error instanceof WeatherProviderError) throw error;
    throw new WeatherProviderError("invalid_response", "Weather provider returned invalid data");
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_UPSTREAM_RESPONSE_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      throw new WeatherProviderError("invalid_response", "Weather provider response was too large");
    }
  }

  if (response.body === null) {
    throw new WeatherProviderError("invalid_response", "Weather provider returned an empty response");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > MAX_UPSTREAM_RESPONSE_BYTES) {
        await reader.cancel();
        throw new WeatherProviderError("invalid_response", "Weather provider response was too large");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new WeatherProviderError("invalid_response", "Weather provider returned invalid JSON");
  }
}

function normalizeProviderKey(value: string): string {
  const providerKey = value.trim();
  if (providerKey.length === 0 || providerKey.length > 512) {
    throw new WeatherProviderError("invalid_configuration", "Weather API key is invalid");
  }
  return providerKey;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("record");
  return value as Record<string, unknown>;
}

function readFiniteNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(key);
  return value;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") throw new Error(key);
  return value;
}

function readNullableCountryCode(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z]{2}$/.test(value)
    ? value.toUpperCase()
    : null;
}

function readOptionalLastHour(value: unknown): number | null {
  if (value === undefined) return null;
  const record = asRecord(value);
  const lastHour = record["1h"];
  if (lastHour === undefined) return null;
  if (typeof lastHour !== "number" || !Number.isFinite(lastHour)) throw new Error("1h");
  return lastHour;
}
