import type { Device, Farm, Telemetry } from "@smartfarm-os/contracts";
import { formatDateTime } from "../dashboard-model";
import type {
  EnvironmentTelemetryMetric,
  MetricTelemetryHistoryViewState,
  MetricTelemetryViewState,
  TelemetryHistoryViewState,
  TelemetryViewState,
} from "./page-state";

type EnvironmentViewProps = {
  readonly farm: Farm | null;
  readonly device: Device | null;
  readonly telemetry: TelemetryViewState;
  readonly telemetryHistory: TelemetryHistoryViewState;
  readonly onRefreshTelemetry: () => void;
};

const SENSOR_ROWS = [
  { metric: "humidity", label: "습도", unit: "%" },
  { metric: "illuminance", label: "조도", unit: "lux" },
  { metric: "water_level", label: "수위", unit: "%" },
] as const satisfies readonly {
  readonly metric: EnvironmentTelemetryMetric;
  readonly label: string;
  readonly unit: string;
}[];

const TREND_ROWS = [
  { metric: "temperature", label: "온도", unit: "°C" },
  ...SENSOR_ROWS,
] as const satisfies readonly {
  readonly metric: EnvironmentTelemetryMetric;
  readonly label: string;
  readonly unit: string;
}[];

export function EnvironmentView({
  farm,
  device,
  telemetry,
  telemetryHistory,
  onRefreshTelemetry,
}: EnvironmentViewProps) {
  const temperature = telemetry.temperature;
  const observedAt = temperature.latest?.telemetry.observedAt ?? null;

  return (
    <section className="page-shell" aria-labelledby="environment-title">
      <header className="page-header">
        <div>
          <p className="section-label">농장 환경</p>
          <h1 id="environment-title">실시간 센서 상태</h1>
          <p className="page-copy">
            선택한 장치의 온도, 습도, 조도, 수위를 같은 범위 기준으로 나눠서 확인합니다.
          </p>
        </div>
        <button
          className="text-button"
          type="button"
          onClick={onRefreshTelemetry}
          disabled={isAnyTelemetryRefreshing(telemetry) || farm === null || device === null}
        >
          {isAnyTelemetryRefreshing(telemetry) ? "확인 중" : "새로고침"}
        </button>
      </header>

      <div className="panel-grid two-column">
        <section className="panel-block" aria-labelledby="temperature-title">
          <div className="panel-row">
            <div>
              <p className="section-label">현재 온도</p>
              <h2 id="temperature-title">{device?.name ?? "장치 선택 대기"}</h2>
              <p className="muted-copy">{farm?.name ?? "농장을 먼저 선택하세요."}</p>
            </div>
          </div>

          {temperature.loading ? (
            <div className="temperature-skeleton" aria-label="온도 불러오는 중" />
          ) : (
            <div
              className="temperature-reading"
              aria-live="polite"
              data-testid="environment-metric-temperature"
            >
              <span className="temperature-number">
                {temperature.unsupported || temperature.latest === null
                  ? "--"
                  : temperature.latest.telemetry.value.toFixed(1)}
              </span>
              <span className="temperature-unit">°C</span>
            </div>
          )}

          <div className="reading-meta">
            <span>
              {temperature.unsupported
                ? "연동 전"
                : observedAt === null
                  ? "아직 수집된 값이 없습니다"
                  : formatDateTime(observedAt)}
            </span>
            {temperature.cached && <span className="cached-label">저장된 값</span>}
          </div>
          {temperature.error !== null && <p className="inline-error" role="alert">{temperature.error}</p>}
        </section>

        <section className="panel-block" aria-labelledby="sensor-status-title">
          <div className="panel-row">
            <div>
              <p className="section-label">센서 상태</p>
              <h2 id="sensor-status-title">환경 지표</h2>
            </div>
          </div>
          <div className="sensor-list">
            {SENSOR_ROWS.map((sensor) => (
              <MetricSensorRow
                key={sensor.metric}
                metric={sensor.metric}
                label={sensor.label}
                unit={sensor.unit}
                state={telemetry[sensor.metric]}
              />
            ))}

            <div className="sensor-row">
              <div>
                <strong>수온</strong>
                <span>연동 전</span>
              </div>
              <div className="sensor-value">
                <span>--</span>
              </div>
            </div>
          </div>
        </section>
      </div>

      <section className="panel-block trend-panel" aria-labelledby="telemetry-history-title">
        <div className="panel-row">
          <div>
            <p className="section-label">운영 기록</p>
            <h2 id="telemetry-history-title">최근 환경 추세</h2>
            <p className="muted-copy">
              선택한 장치에서 수집한 최신 24개 측정값을 시간 순서로 보여줍니다.
            </p>
          </div>
          <span className="count-pill">최대 24개</span>
        </div>
        <div className="trend-grid">
          {TREND_ROWS.map((trend) => (
            <TelemetryTrendCard
              key={trend.metric}
              metric={trend.metric}
              label={trend.label}
              unit={trend.unit}
              state={telemetryHistory[trend.metric]}
            />
          ))}
        </div>
      </section>
    </section>
  );
}

function TelemetryTrendCard({
  metric,
  label,
  unit,
  state,
}: {
  readonly metric: EnvironmentTelemetryMetric;
  readonly label: string;
  readonly unit: string;
  readonly state: MetricTelemetryHistoryViewState;
}) {
  const points = state.points;
  const latest = points[points.length - 1] ?? null;
  const values = points.map((point) => point.value);
  const minimum = values.length > 0 ? Math.min(...values) : null;
  const maximum = values.length > 0 ? Math.max(...values) : null;

  return (
    <article
      className="trend-card"
      data-testid={`telemetry-history-${metric}`}
      aria-busy={state.loading}
    >
      <header className="trend-card-header">
        <div>
          <h3>{label}</h3>
          <span>{latest === null ? "측정값 없음" : `최근 ${formatMetricValue(latest.value)} ${unit}`}</span>
        </div>
        {latest !== null && <time dateTime={latest.observedAt}>{formatDateTime(latest.observedAt)}</time>}
      </header>

      {state.loading ? (
        <div className="trend-empty" role="status">추세 불러오는 중</div>
      ) : state.error !== null ? (
        <p className="inline-error" role="alert">{state.error}</p>
      ) : points.length === 0 ? (
        <div className="trend-empty">아직 수집된 이력이 없습니다.</div>
      ) : (
        <>
          <svg
            className="telemetry-chart"
            viewBox="0 0 320 120"
            role="img"
            aria-label={`${label} 최근 추세 차트`}
          >
            <line className="trend-axis" x1="12" y1="108" x2="308" y2="108" />
            <polyline className="trend-line" points={createChartPoints(points)} />
          </svg>
          <div className="trend-stats" aria-label={`${label} 요약`}>
            <span>최저 <strong>{formatMetricValue(minimum ?? 0)} {unit}</strong></span>
            <span>최고 <strong>{formatMetricValue(maximum ?? 0)} {unit}</strong></span>
            <span>{points.length}개 기록</span>
          </div>
          <details className="trend-table">
            <summary>측정값 표 보기</summary>
            <div className="table-scroll">
              <table>
                <caption>{label} 최근 측정값</caption>
                <thead>
                  <tr>
                    <th scope="col">시각</th>
                    <th scope="col">값</th>
                  </tr>
                </thead>
                <tbody>
                  {points.map((point) => (
                    <tr key={`${point.id}-${point.sequence}`}>
                      <td>{formatDateTime(point.observedAt)}</td>
                      <td>{formatMetricValue(point.value)} {unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </article>
  );
}

function MetricSensorRow({
  metric,
  label,
  unit,
  state,
}: {
  readonly metric: EnvironmentTelemetryMetric;
  readonly label: string;
  readonly unit: string;
  readonly state: MetricTelemetryViewState;
}) {
  const reading = state.latest?.telemetry ?? null;
  const status = state.unsupported
    ? "연동 전"
    : state.loading
      ? "확인 중"
      : reading === null
        ? "수집 대기"
        : state.cached
          ? "저장된 값"
          : "실시간";

  return (
    <div className="sensor-row">
      <div>
        <strong>{label}</strong>
        <span>{status}</span>
        {state.error !== null && <p className="inline-error" role="alert">{state.error}</p>}
      </div>
      <div className="sensor-value">
        <span data-testid={`environment-metric-${metric}`}>
          {reading === null || state.unsupported ? "--" : `${reading.value.toFixed(1)} ${unit}`}
        </span>
        <span>
          {state.unsupported
            ? "연동 전"
            : reading === null
              ? "아직 수집된 값이 없습니다"
              : formatDateTime(reading.observedAt)}
        </span>
        {state.cached && <span className="cached-label">저장된 값</span>}
      </div>
    </div>
  );
}

function isAnyTelemetryRefreshing(telemetry: TelemetryViewState): boolean {
  return Object.values(telemetry).some((entry) => entry.refreshing);
}

function createChartPoints(points: readonly Telemetry[]): string {
  if (points.length === 0) return "";
  const values = points.map((point) => point.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum;
  const width = 296;
  const height = 96;

  return points.map((point, index) => {
    const x = points.length === 1 ? 160 : 12 + (index * width) / (points.length - 1);
    const normalized = range === 0 ? 0.5 : (point.value - minimum) / range;
    const y = 108 - normalized * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function formatMetricValue(value: number): string {
  return value.toFixed(1);
}
