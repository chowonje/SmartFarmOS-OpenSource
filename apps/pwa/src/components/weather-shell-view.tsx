import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { CurrentWeatherResponse, Farm } from "@smartfarm-os/contracts";
import { SmartFarmApi } from "../api/smart-farm-api";
import { formatDateTime, userFacingError } from "../dashboard-model";

const DEFAULT_CITY = "Seoul";
const defaultWeatherApi = new SmartFarmApi({
  baseUrl: import.meta.env.PUBLIC_API_BASE_URL?.trim() || "/api",
});

type WeatherClient = Pick<SmartFarmApi, "currentWeather">;

export type WeatherViewState = {
  readonly weather: CurrentWeatherResponse | null;
  readonly loading: boolean;
  readonly refreshing: boolean;
  readonly error: string | null;
};

type WeatherShellViewProps = {
  readonly farm: Farm | null;
  readonly client?: WeatherClient;
};

export function WeatherShellView({ farm, client = defaultWeatherApi }: WeatherShellViewProps) {
  const [city, setCity] = useState(DEFAULT_CITY);
  const [state, setState] = useState<WeatherViewState>(createEmptyWeatherState);
  const requestSequence = useRef(0);

  const loadWeather = useCallback(async (farmId: string, cityInput: string) => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    setState((current) => ({
      ...current,
      loading: current.weather === null,
      refreshing: current.weather !== null,
      error: null,
    }));

    try {
      const weather = await client.currentWeather(farmId, { city: cityInput });
      if (requestSequence.current !== sequence) return;
      setState({ weather, loading: false, refreshing: false, error: null });
    } catch (error) {
      if (requestSequence.current !== sequence) return;
      const message = userFacingError(error, navigator.onLine, {
        notFoundMessage: "입력한 도시의 날씨 위치를 찾지 못했습니다.",
        defaultMessage: "날씨 정보를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      });
      setState((current) => preserveWeatherOnFailure(current, message));
    }
  }, [client]);

  useEffect(() => {
    requestSequence.current += 1;
    setCity(DEFAULT_CITY);
    setState(createEmptyWeatherState());
    if (farm === null) {
      return;
    }
    void loadWeather(farm.id, DEFAULT_CITY);
    return () => {
      requestSequence.current += 1;
    };
  }, [farm?.id, loadWeather]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (farm === null) return;
    void loadWeather(farm.id, city);
  };

  return (
    <WeatherShellContent
      farm={farm}
      city={city}
      state={state}
      onCityChange={setCity}
      onSubmit={submit}
    />
  );
}

export function WeatherShellContent({
  farm,
  city,
  state,
  onCityChange,
  onSubmit,
}: {
  readonly farm: Farm | null;
  readonly city: string;
  readonly state: WeatherViewState;
  readonly onCityChange: (city: string) => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const weather = state.weather;
  const sourceLabel = weather === null
    ? state.loading ? "확인 중" : state.error === null ? "선택 대기" : "오류"
    : weather.source.kind === "fixture" ? "시범 데이터" : "라이브";
  const cacheLabel = weather === null ? "대기" : getCacheLabel(weather.cache.status);

  return (
    <section className="page-shell" aria-labelledby="weather-title">
      <header className="page-header">
        <div>
          <p className="section-label">날씨·위치</p>
          <h1 id="weather-title">농장 외부 날씨</h1>
          <p className="page-copy">
            선택한 농장 범위에서 도시 또는 좌표로 정규화된 현재 날씨를 확인합니다.
          </p>
        </div>
      </header>

      <section className="panel-block" aria-labelledby="weather-search-title">
        <div className="panel-row">
          <div>
            <p className="section-label">기준 위치</p>
            <h2 id="weather-search-title">{farm?.name ?? "농장 선택 대기"}</h2>
            <p className="muted-copy">도시명은 서버에서 검증하며 공급자 자격증명은 브라우저로 전송하지 않습니다.</p>
          </div>
        </div>
        <form className="form-grid" aria-label="날씨 도시 검색" onSubmit={onSubmit}>
          <label className="field-stack">
            도시명
            <input
              data-testid="weather-city-input"
              type="text"
              value={city}
              maxLength={80}
              required
              disabled={farm === null || state.loading || state.refreshing}
              onChange={(event) => onCityChange(event.currentTarget.value)}
            />
          </label>
          <div className="form-actions">
            <button
              className="primary-control"
              data-testid="weather-search-submit"
              type="submit"
              disabled={farm === null || state.loading || state.refreshing || city.trim() === ""}
            >
              {state.loading || state.refreshing ? "확인 중" : "날씨 확인"}
            </button>
          </div>
        </form>
      </section>

      {state.error !== null && (
        <p className="inline-error" data-testid="weather-error" role="alert">{state.error}</p>
      )}

      <div className="panel-grid two-column" aria-busy={state.loading || state.refreshing}>
        <section className="panel-block" aria-labelledby="weather-status-title">
          <div className="panel-row">
            <div>
              <p className="section-label">날씨 정보</p>
              <h2 id="weather-status-title">{weather?.conditions.summary ?? "확인 대기"}</h2>
            </div>
            <span className="status-chip" data-testid="weather-source-kind">{sourceLabel}</span>
          </div>
          {state.loading && weather === null ? (
            <div className="loading-state" role="status">날씨 정보를 불러오는 중입니다.</div>
          ) : (
            <div className="placeholder-list">
              <WeatherRow label="기온" value={weather === null ? "--" : `${formatWeatherNumber(weather.conditions.temperatureCelsius)} °C`} testId="weather-temperature" />
              <WeatherRow label="체감 온도" value={weather === null ? "--" : `${formatWeatherNumber(weather.conditions.feelsLikeCelsius)} °C`} />
              <WeatherRow label="습도" value={weather === null ? "--" : `${formatWeatherNumber(weather.conditions.humidityPercent)} %`} />
              <WeatherRow label="풍속" value={weather === null ? "--" : `${formatWeatherNumber(weather.conditions.windSpeedMetersPerSecond)} m/s`} />
              <WeatherRow label="최근 1시간 강수" value={weather === null ? "--" : formatPrecipitation(weather.conditions.precipitationMillimetersLastHour)} />
            </div>
          )}
          {weather?.source.kind === "fixture" && (
            <p className="notice" data-testid="weather-fixture-notice" role="status">
              실제 관측값이 아닌 결정적 시범 데이터입니다. 서버에 라이브 공급자 키가 없을 때만 사용합니다.
            </p>
          )}
        </section>

        <section className="panel-block" aria-labelledby="location-status-title">
          <div className="panel-row">
            <div>
              <p className="section-label">위치·출처</p>
              <h2 id="location-status-title" data-testid="weather-location">{weather?.location.name ?? "확인 대기"}</h2>
            </div>
            <span className="status-chip" data-testid="weather-cache-status">{cacheLabel}</span>
          </div>
          <dl className="fact-list">
            <WeatherFact label="위치" value={weather === null ? "--" : formatCoordinates(weather)} />
            <WeatherFact label="공급 방식" value={weather === null ? "--" : weather.source.kind === "fixture" ? "시범 fixture" : "OpenWeather 호환 라이브"} />
            <WeatherFact label="관측 시각" value={weather === null ? "--" : formatDateTime(weather.source.observedAt)} />
            <WeatherFact label="서버 조회" value={weather === null ? "--" : formatDateTime(weather.source.fetchedAt)} />
          </dl>
          {weather?.warning !== null && weather?.warning !== undefined && (
            <p className="notice" data-testid="weather-stale-warning" role="status">
              공급자에 연결할 수 없어 이전에 저장한 날씨를 표시합니다.
            </p>
          )}
        </section>
      </div>
    </section>
  );
}

function WeatherRow({
  label,
  value,
  testId,
}: {
  readonly label: string;
  readonly value: string;
  readonly testId?: string;
}) {
  return (
    <div className="placeholder-row">
      <span>{label}</span>
      <strong {...(testId === undefined ? {} : { "data-testid": testId })}>{value}</strong>
    </div>
  );
}

function WeatherFact({ label, value }: { readonly label: string; readonly value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function getCacheLabel(status: CurrentWeatherResponse["cache"]["status"]): string {
  switch (status) {
    case "miss": return "새로 조회";
    case "hit": return "캐시 사용";
    case "stale": return "오래된 캐시";
  }
}

function formatWeatherNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatPrecipitation(value: number | null): string {
  return value === null ? "관측 없음" : `${formatWeatherNumber(value)} mm`;
}

function formatCoordinates(weather: CurrentWeatherResponse): string {
  return `${weather.location.latitude.toFixed(4)}, ${weather.location.longitude.toFixed(4)}`;
}

export function preserveWeatherOnFailure(
  current: WeatherViewState,
  error: string,
): WeatherViewState {
  return {
    ...current,
    loading: false,
    refreshing: false,
    error,
  };
}

export function createEmptyWeatherState(): WeatherViewState {
  return {
    weather: null,
    loading: false,
    refreshing: false,
    error: null,
  };
}
