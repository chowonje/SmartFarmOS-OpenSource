import {
  WeatherProviderReadingSchema,
  type WeatherLocationQuery,
  type WeatherProviderReading,
} from "@smartfarm-os/contracts";
import { createOpenWeatherCompatibleProvider } from "./openweather-provider.js";

export type WeatherProviderRequestContext = {
  readonly now: Date;
  readonly signal: AbortSignal;
};

export type WeatherProvider = {
  readonly id: string;
  readonly kind: "fixture" | "live";
  getCurrent(
    location: WeatherLocationQuery,
    context: WeatherProviderRequestContext,
  ): Promise<WeatherProviderReading>;
};

export type WeatherProviderErrorKind =
  | "invalid_configuration"
  | "invalid_response"
  | "location_not_found"
  | "timeout"
  | "unavailable";

export class WeatherProviderError extends Error {
  override readonly name = "WeatherProviderError";

  constructor(readonly kind: WeatherProviderErrorKind, message: string) {
    super(message);
  }
}

export function createFixtureWeatherProvider(): WeatherProvider {
  return {
    id: "smartfarm-fixture-v1",
    kind: "fixture",
    async getCurrent(location, context) {
      if (context.signal.aborted) {
        throw new WeatherProviderError("timeout", "Weather provider request timed out");
      }

      const resolvedLocation = resolveFixtureLocation(location);
      return WeatherProviderReadingSchema.parse({
        schemaVersion: "smartfarm.weather-provider-reading.v1",
        source: {
          kind: "fixture",
          provider: "smartfarm-fixture-v1",
          observedAt: context.now.toISOString(),
        },
        location: resolvedLocation,
        conditions: {
          summary: "맑음 (시범 데이터)",
          temperatureCelsius: 24.5,
          feelsLikeCelsius: 24.1,
          humidityPercent: 61,
          cloudCoverPercent: 12,
          windSpeedMetersPerSecond: 2.4,
          precipitationMillimetersLastHour: null,
        },
      });
    },
  };
}

export function createWeatherProviderFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): WeatherProvider {
  const providerKey = environment.SMARTFARM_OPENWEATHER_API_KEY?.trim() ?? "";
  if (providerKey === "") return createFixtureWeatherProvider();

  return createOpenWeatherCompatibleProvider({
    providerKey,
  });
}

function resolveFixtureLocation(location: WeatherLocationQuery) {
  if (location.city !== undefined) {
    const normalizedCity = location.city.toLocaleLowerCase("en-US");
    const isSeoul = normalizedCity === "seoul" || normalizedCity === "서울";
    return {
      name: location.city,
      countryCode: isSeoul ? "KR" as const : null,
      latitude: isSeoul ? 37.5665 : 36.5,
      longitude: isSeoul ? 126.978 : 127.8,
      timezoneOffsetSeconds: 32_400,
    };
  }

  if (location.latitude === undefined || location.longitude === undefined) {
    throw new WeatherProviderError("invalid_configuration", "Weather coordinates are missing");
  }

  return {
    name: `위도 ${location.latitude.toFixed(4)}, 경도 ${location.longitude.toFixed(4)}`,
    countryCode: null,
    latitude: location.latitude,
    longitude: location.longitude,
    timezoneOffsetSeconds: 32_400,
  };
}
