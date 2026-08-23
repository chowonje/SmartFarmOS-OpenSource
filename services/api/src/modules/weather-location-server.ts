import {
  CurrentWeatherResponseSchema,
  FarmPathParamsSchema,
  WeatherLocationQuerySchema,
  WeatherProviderReadingSchema,
  type CurrentWeatherResponse,
  type WeatherLocationQuery,
  type WeatherProviderReading,
} from "@smartfarm-os/contracts";
import {
  requireFarm,
  requirePrincipal,
  requireRole,
  requireStoredFarm,
  sendError,
  sendValidationError,
} from "../http-boundary.js";
import type { ApiModuleContext } from "../module-context.js";
import {
  WeatherProviderError,
  type WeatherProvider,
} from "../weather-provider.js";

const WEATHER_CACHE_TTL_MS = 5 * 60 * 1_000;
const MAX_WEATHER_CACHE_ENTRIES = 100;

type WeatherCacheEntry = {
  readonly reading: WeatherProviderReading;
  readonly fetchedAt: string;
  readonly cachedAt: string;
  readonly expiresAt: string;
};

export function registerWeatherLocationModule(context: ApiModuleContext): void {
  const { app, authenticate, now, store, weatherProvider, weatherRequestTimeoutMs } = context;
  const cache = new Map<string, WeatherCacheEntry>();

  app.get("/v1/farms/:farmId/weather/current", async (request, reply) => {
    const principal = await requirePrincipal(authenticate, request, reply);
    if (principal === null) return reply;
    if (!requireRole(principal, ["user", "admin"], reply)) return reply;

    const params = FarmPathParamsSchema.safeParse(request.params);
    if (!params.success) return sendValidationError(reply, params.error.issues);
    if (!requireFarm(principal, params.data.farmId, reply)) return reply;
    if (!requireStoredFarm(store, params.data.farmId, reply)) return reply;

    const query = WeatherLocationQuerySchema.safeParse(request.query);
    if (!query.success) return sendValidationError(reply, query.error.issues);

    const requestedAt = now();
    const cacheKey = createWeatherCacheKey(weatherProvider, query.data);
    const cached = cache.get(cacheKey) ?? null;
    if (cached !== null && requestedAt.getTime() < Date.parse(cached.expiresAt)) {
      return createWeatherResponse(cached, "hit", null);
    }

    try {
      const reading = WeatherProviderReadingSchema.parse(await loadWeatherWithTimeout(
        weatherProvider,
        query.data,
        requestedAt,
        weatherRequestTimeoutMs,
      ));
      const timestamp = requestedAt.toISOString();
      const entry: WeatherCacheEntry = {
        reading,
        fetchedAt: timestamp,
        cachedAt: timestamp,
        expiresAt: new Date(requestedAt.getTime() + WEATHER_CACHE_TTL_MS).toISOString(),
      };
      setBoundedCacheEntry(cache, cacheKey, entry);
      return createWeatherResponse(entry, "miss", null);
    } catch (error) {
      if (error instanceof WeatherProviderError && error.kind === "location_not_found") {
        return sendError(reply, 404, "not_found", "Weather location was not found");
      }
      if (cached !== null) {
        return createWeatherResponse(cached, "stale", {
          code: "provider_unavailable",
          message: "Cached weather is shown because the provider is temporarily unavailable",
        });
      }
      return sendError(
        reply,
        502,
        "upstream_unavailable",
        "Weather data is temporarily unavailable",
      );
    }
  });
}

async function loadWeatherWithTimeout(
  provider: WeatherProvider,
  location: WeatherLocationQuery,
  now: Date,
  timeoutMs: number,
): Promise<WeatherProviderReading> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new WeatherProviderError("timeout", "Weather provider request timed out"));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      provider.getCurrent(location, { now, signal: controller.signal }),
      timedOut,
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function createWeatherResponse(
  entry: WeatherCacheEntry,
  cacheStatus: "miss" | "hit" | "stale",
  warning: CurrentWeatherResponse["warning"],
): CurrentWeatherResponse {
  return CurrentWeatherResponseSchema.parse({
    schemaVersion: "smartfarm.current-weather.v1",
    source: {
      ...entry.reading.source,
      fetchedAt: entry.fetchedAt,
    },
    location: entry.reading.location,
    conditions: entry.reading.conditions,
    cache: {
      status: cacheStatus,
      cachedAt: entry.cachedAt,
      expiresAt: entry.expiresAt,
    },
    warning,
  });
}

function createWeatherCacheKey(
  provider: WeatherProvider,
  location: WeatherLocationQuery,
): string {
  if (location.city !== undefined) {
    return `${provider.id}:city:${location.city.toLocaleLowerCase("en-US")}`;
  }
  if (location.latitude === undefined || location.longitude === undefined) {
    throw new WeatherProviderError("invalid_configuration", "Weather coordinates are missing");
  }
  return `${provider.id}:coordinates:${location.latitude.toFixed(6)}:${location.longitude.toFixed(6)}`;
}

function setBoundedCacheEntry(
  cache: Map<string, WeatherCacheEntry>,
  key: string,
  entry: WeatherCacheEntry,
): void {
  if (!cache.has(key) && cache.size >= MAX_WEATHER_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, entry);
}
