import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DeviceSchema,
  FarmSchema,
  LatestTelemetryResponseSchema,
  TelemetrySchema,
} from "@smartfarm-os/contracts";
import { EnvironmentView } from "./environment-view";
import {
  createEmptyTelemetryViewState,
  type TelemetryHistoryViewState,
  type TelemetryViewState,
} from "./page-state";

const farm = FarmSchema.parse({
  schemaVersion: "smartfarm.farm.v1",
  id: "farm:demo",
  name: "대회 데모 농장",
  timezone: "Asia/Seoul",
  createdAt: "2026-07-17T00:00:00.000Z",
});

const device = DeviceSchema.parse({
  schemaVersion: "smartfarm.device.v1",
  id: "device:bed-1",
  farmId: "farm:demo",
  name: "베드 1 컨트롤러",
  kind: "hybrid",
  capabilities: ["temperature", "humidity", "illuminance", "water_level"],
  status: "online",
  lastSeenAt: "2026-07-17T00:00:00.000Z",
});

describe("EnvironmentView", () => {
  it("renders stable metric selectors and keeps unsupported sensors explicit", () => {
    const telemetry = createTelemetryState({
      temperature: createMetric("temperature", 24.5, "celsius"),
      humidity: createMetric("humidity", 61.2, "percent"),
      illuminance: createMetric("illuminance", 820, "lux"),
      water_level: createMetric("water_level", 72, "percent"),
    });

    const html = renderToStaticMarkup(
      <EnvironmentView
        farm={farm}
        device={device}
        telemetry={telemetry}
        telemetryHistory={createHistoryState()}
        onRefreshTelemetry={() => {}}
      />,
    );

    expect(html).toContain('data-testid="environment-metric-temperature"');
    expect(html).toContain('data-testid="environment-metric-humidity"');
    expect(html).toContain('data-testid="environment-metric-illuminance"');
    expect(html).toContain('data-testid="environment-metric-water_level"');
    expect(html).toContain("24.5");
    expect(html).toContain("61.2 %");
    expect(html).toContain("820.0 lux");
    expect(html).toContain("72.0 %");
    expect(html).toContain("수온");
    expect(html).toContain("연동 전");
    expect(html).toContain('data-testid="telemetry-history-temperature"');
    expect(html).toContain("측정값 표 보기");
  });
});

function createTelemetryState(overrides: Partial<TelemetryViewState>): TelemetryViewState {
  return {
    ...createEmptyTelemetryViewState(),
    ...overrides,
  };
}

function createMetric(
  metric: "temperature" | "humidity" | "illuminance" | "water_level",
  value: number,
  unit: "celsius" | "percent" | "lux",
) {
  const metricSlug = metric.replaceAll("_", "-");
  const latest = LatestTelemetryResponseSchema.parse({
    schemaVersion: "smartfarm.latest-telemetry.v1",
    telemetry: {
      schemaVersion: "smartfarm.telemetry.v1",
      id: `telemetry:${metricSlug}-1`,
      farmId: "farm:demo",
      deviceId: "device:bed-1",
      metric,
      value,
      unit,
      sequence: 1,
      observedAt: "2026-07-17T00:00:00.000Z",
    },
  });

  return {
    latest,
    loading: false,
    refreshing: false,
    cached: false,
    unsupported: false,
    error: null,
  };
}

function createHistoryState(): TelemetryHistoryViewState {
  return {
    temperature: createHistory("temperature", [24, 24.5], "celsius"),
    humidity: createHistory("humidity", [60, 61.2], "percent"),
    illuminance: createHistory("illuminance", [800, 820], "lux"),
    water_level: createHistory("water_level", [70, 72], "percent"),
  };
}

function createHistory(
  metric: "temperature" | "humidity" | "illuminance" | "water_level",
  values: readonly number[],
  unit: "celsius" | "percent" | "lux",
) {
  const metricSlug = metric.replaceAll("_", "-");
  return {
    points: values.map((value, index) => TelemetrySchema.parse({
      schemaVersion: "smartfarm.telemetry.v1",
      id: `telemetry:${metricSlug}-${index + 1}`,
      farmId: "farm:demo",
      deviceId: "device:bed-1",
      metric,
      value,
      unit,
      sequence: index + 1,
      observedAt: `2026-07-17T00:${String(index * 5).padStart(2, "0")}:00.000Z`,
    })),
    loading: false,
    error: null,
  };
}
