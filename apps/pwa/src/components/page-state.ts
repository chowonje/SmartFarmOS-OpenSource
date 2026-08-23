import type {
  CommandProjection,
  Device,
  FarmControlProfile,
  GrowingArea,
  IrrigationStrategy,
  LatestTelemetryResponse,
  PumpState,
  StrategyApplication,
  Telemetry,
  TelemetryMetric,
} from "@smartfarm-os/contracts";

export const ENVIRONMENT_TELEMETRY_METRICS = [
  "temperature",
  "humidity",
  "illuminance",
  "water_level",
] as const satisfies readonly TelemetryMetric[];

export type EnvironmentTelemetryMetric = (typeof ENVIRONMENT_TELEMETRY_METRICS)[number];

export type TelemetryByMetric = Partial<Record<EnvironmentTelemetryMetric, LatestTelemetryResponse>>;

export type MetricTelemetryViewState = {
  readonly latest: LatestTelemetryResponse | null;
  readonly loading: boolean;
  readonly refreshing: boolean;
  readonly cached: boolean;
  readonly unsupported: boolean;
  readonly error: string | null;
};

export type TelemetryViewState = Record<EnvironmentTelemetryMetric, MetricTelemetryViewState>;

export type MetricTelemetryHistoryViewState = {
  readonly points: readonly Telemetry[];
  readonly loading: boolean;
  readonly error: string | null;
};

export type AreaTelemetryMetricState = {
  readonly latest: LatestTelemetryResponse | null;
  readonly points: readonly Telemetry[];
  readonly loading: boolean;
  readonly refreshing: boolean;
  readonly cached: boolean;
  readonly error: string | null;
};

export type AreaTelemetryComparisonItem = {
  readonly areaId: GrowingArea["id"];
  readonly areaName: string;
  readonly areaKind: GrowingArea["kind"];
  readonly areaStatus: GrowingArea["status"];
  readonly deviceId: Device["id"];
  readonly deviceName: string;
  readonly deviceStatus: Device["status"];
  readonly metrics: Record<EnvironmentTelemetryMetric, AreaTelemetryMetricState>;
};

export type AreaTelemetryComparisonState = {
  readonly items: readonly AreaTelemetryComparisonItem[];
  readonly loading: boolean;
  readonly refreshing: boolean;
  readonly error: string | null;
};

export type CommandHistoryViewState = {
  readonly items: readonly CommandProjection[];
  readonly loading: boolean;
  readonly refreshing: boolean;
  readonly error: string | null;
};

export type IrrigationStrategyViewState = {
  readonly items: readonly IrrigationStrategy[];
  readonly loading: boolean;
  readonly refreshing: boolean;
  readonly error: string | null;
  readonly selectedStrategyId: IrrigationStrategy["id"] | null;
  readonly selectedStrategyVersion: number | null;
  readonly selectedAreaIds: readonly GrowingArea["id"][];
  readonly applicationConfirmed: boolean;
  readonly application: StrategyApplication | null;
  readonly applying: boolean;
  readonly applicationError: string | null;
};

export function isIrrigationTargetEligible(
  area: GrowingArea | null | undefined,
  device: Device | null | undefined,
): boolean {
  return area?.status === "active"
    && device !== null
    && device !== undefined
    && device.capabilities.includes("pump");
}

export type TelemetryHistoryViewState = Record<
  EnvironmentTelemetryMetric,
  MetricTelemetryHistoryViewState
>;

export type CommandViewState = {
  readonly projection: CommandProjection | null;
  readonly requestedState: PumpState | null;
  readonly busy: boolean;
  readonly error: string | null;
};

export type FarmControlProfileViewState = {
  readonly profile: FarmControlProfile | null;
  readonly loading: boolean;
  readonly refreshing: boolean;
  readonly saving: boolean;
  readonly error: string | null;
  readonly notice: string | null;
};

export function createEmptyMetricTelemetryViewState(): MetricTelemetryViewState {
  return {
    latest: null,
    loading: false,
    refreshing: false,
    cached: false,
    unsupported: false,
    error: null,
  };
}

export function createEmptyTelemetryViewState(): TelemetryViewState {
  return {
    temperature: createEmptyMetricTelemetryViewState(),
    humidity: createEmptyMetricTelemetryViewState(),
    illuminance: createEmptyMetricTelemetryViewState(),
    water_level: createEmptyMetricTelemetryViewState(),
  };
}

export function createEmptyFarmControlProfileViewState(): FarmControlProfileViewState {
  return {
    profile: null,
    loading: false,
    refreshing: false,
    saving: false,
    error: null,
    notice: null,
  };
}

export function createEmptyMetricTelemetryHistoryViewState(): MetricTelemetryHistoryViewState {
  return {
    points: [],
    loading: false,
    error: null,
  };
}

export function createEmptyAreaTelemetryComparisonState(): AreaTelemetryComparisonState {
  return {
    items: [],
    loading: false,
    refreshing: false,
    error: null,
  };
}

export function createEmptyIrrigationStrategyViewState(): IrrigationStrategyViewState {
  return {
    items: [],
    loading: false,
    refreshing: false,
    error: null,
    selectedStrategyId: null,
    selectedStrategyVersion: null,
    selectedAreaIds: [],
    applicationConfirmed: false,
    application: null,
    applying: false,
    applicationError: null,
  };
}

export function createEmptyTelemetryHistoryViewState(): TelemetryHistoryViewState {
  return {
    temperature: createEmptyMetricTelemetryHistoryViewState(),
    humidity: createEmptyMetricTelemetryHistoryViewState(),
    illuminance: createEmptyMetricTelemetryHistoryViewState(),
    water_level: createEmptyMetricTelemetryHistoryViewState(),
  };
}
