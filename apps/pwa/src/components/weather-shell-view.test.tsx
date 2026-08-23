import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CurrentWeatherResponseSchema,
  FarmSchema,
  type CurrentWeatherResponse,
} from "@smartfarm-os/contracts";
import {
  WeatherShellContent,
  createEmptyWeatherState,
  preserveWeatherOnFailure,
  type WeatherViewState,
} from "./weather-shell-view";

const farm = FarmSchema.parse({
  schemaVersion: "smartfarm.farm.v1",
  id: "farm:demo",
  name: "대회 데모 농장",
  timezone: "Asia/Seoul",
  createdAt: "2026-08-10T00:00:00.000Z",
});

describe("WeatherShellContent", () => {
  it("labels fixture data as non-live while preserving stable weather hooks", () => {
    const html = renderWeather(weatherResponse("fixture", "miss"));

    expect(html).toContain('id="weather-title"');
    expect(html).toContain("농장 외부 날씨");
    expect(html).toContain('data-testid="weather-source-kind">시범 데이터<');
    expect(html).toContain('data-testid="weather-cache-status">새로 조회<');
    expect(html).toContain('data-testid="weather-temperature">24.5 °C<');
    expect(html).toContain('data-testid="weather-fixture-notice"');
    expect(html).toContain("실제 관측값이 아닌");
    expect((html.match(/class="status-chip"/g) ?? [])).toHaveLength(2);
  });

  it("labels live provider data and omits the fixture disclaimer", () => {
    const html = renderWeather(weatherResponse("live", "hit"));

    expect(html).toContain('data-testid="weather-source-kind">라이브<');
    expect(html).toContain('data-testid="weather-cache-status">캐시 사용<');
    expect(html).toContain("OpenWeather 호환 라이브");
    expect(html).not.toContain('data-testid="weather-fixture-notice"');
  });

  it("makes stale cache and request errors explicit", () => {
    const staleHtml = renderWeather(weatherResponse("live", "stale"));
    const errorHtml = renderWeather(null, "날씨 정보를 가져오지 못했습니다.");

    expect(staleHtml).toContain('data-testid="weather-cache-status">오래된 캐시<');
    expect(staleHtml).toContain('data-testid="weather-stale-warning"');
    expect(errorHtml).toContain('data-testid="weather-error"');
    expect(errorHtml).toContain('role="alert"');
  });

  it("preserves the last good reading when a refresh fails", () => {
    const weather = weatherResponse("live", "hit");
    const failed = preserveWeatherOnFailure({
      weather,
      loading: false,
      refreshing: true,
      error: null,
    }, "새 날씨를 불러오지 못했습니다.");

    expect(failed.weather).toBe(weather);
    expect(failed.refreshing).toBe(false);
    expect(failed.error).toBe("새 날씨를 불러오지 못했습니다.");
  });

  it("clears prior-scope weather before a different farm loads", () => {
    expect(createEmptyWeatherState()).toEqual({
      weather: null,
      loading: false,
      refreshing: false,
      error: null,
    });
  });
});

function renderWeather(
  weather: CurrentWeatherResponse | null,
  error: string | null = null,
): string {
  const state: WeatherViewState = {
    weather,
    loading: false,
    refreshing: false,
    error,
  };
  return renderToStaticMarkup(
    <WeatherShellContent
      farm={farm}
      city="Seoul"
      state={state}
      onCityChange={() => {}}
      onSubmit={() => {}}
    />,
  );
}

function weatherResponse(
  kind: "fixture" | "live",
  cacheStatus: "miss" | "hit" | "stale",
): CurrentWeatherResponse {
  return CurrentWeatherResponseSchema.parse({
    schemaVersion: "smartfarm.current-weather.v1",
    source: {
      kind,
      provider: kind === "fixture" ? "smartfarm-fixture-v1" : "openweather-compatible",
      observedAt: "2026-08-10T01:00:00.000Z",
      fetchedAt: "2026-08-10T01:00:05.000Z",
    },
    location: {
      name: "Seoul",
      countryCode: "KR",
      latitude: 37.5665,
      longitude: 126.978,
      timezoneOffsetSeconds: 32_400,
    },
    conditions: {
      summary: kind === "fixture" ? "맑음 (시범 데이터)" : "맑음",
      temperatureCelsius: 24.5,
      feelsLikeCelsius: 24.1,
      humidityPercent: 61,
      cloudCoverPercent: 12,
      windSpeedMetersPerSecond: 2.4,
      precipitationMillimetersLastHour: null,
    },
    cache: {
      status: cacheStatus,
      cachedAt: "2026-08-10T01:00:05.000Z",
      expiresAt: "2026-08-10T01:05:05.000Z",
    },
    warning: cacheStatus === "stale"
      ? {
        code: "provider_unavailable",
        message: "Cached weather is shown because the provider is unavailable",
      }
      : null,
  });
}
