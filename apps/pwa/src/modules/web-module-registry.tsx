import type {
  AlarmInstance,
  AuditEvent,
  CreateCropRequestInput,
  CropCycleDetail,
  CropRecord,
  Device,
  Farm,
  FarmControlWidget,
  GrowingArea,
  PatchCropRequestInput,
  PumpState,
} from "@smartfarm-os/contracts";
import {
  createStaticModuleRegistry,
  type ModuleRegistryConfigurationV1,
  type StaticModuleRegistry,
} from "@smartfarm-os/module-sdk";
import {
  ALARM_CENTER_MODULE_MANIFEST,
  CROP_OPERATIONS_MODULE_MANIFEST,
  CROP_JOURNAL_MODULE_MANIFEST,
  DEFAULT_BUILT_IN_MODULE_CONFIGURATION,
  FARM_CONTROL_MODULE_MANIFEST,
  FARM_ENVIRONMENT_MODULE_MANIFEST,
  WEATHER_LOCATION_MODULE_MANIFEST,
} from "@smartfarm-os/module-sdk/builtins";
import type { ReactNode } from "react";
import { AlarmCenterView } from "../components/alarm-center-view";
import { ControlView } from "../components/control-view";
import { CropManagementView } from "../components/crop-management-view";
import { CropOperationsView } from "../components/crop-operations-view";
import { EnvironmentView } from "../components/environment-view";
import type {
  AreaTelemetryComparisonState,
  CommandViewState,
  CommandHistoryViewState,
  FarmControlProfileViewState,
  IrrigationStrategyViewState,
  TelemetryHistoryViewState,
  TelemetryViewState,
} from "../components/page-state";
import { WeatherShellView } from "../components/weather-shell-view";

export type AppRoute = string;

export type WebModuleRenderContext = {
  readonly devices: readonly Device[];
  readonly areas: readonly GrowingArea[];
  readonly cropCycles: readonly CropCycleDetail[];
  readonly alarms: readonly AlarmInstance[];
  readonly alarmsLoading: boolean;
  readonly alarmsRefreshing: boolean;
  readonly alarmsError: string | null;
  readonly acknowledgingAlarmId: string | null;
  readonly acknowledgeAlarmError: string | null;
  readonly acknowledgeAlarmNotice: string | null;
  readonly auditEvents: readonly AuditEvent[];
  readonly auditLoading: boolean;
  readonly auditRefreshing: boolean;
  readonly auditError: string | null;
  readonly operationsLoading: boolean;
  readonly operationsRefreshing: boolean;
  readonly operationsError: string | null;
  readonly areaComparison: AreaTelemetryComparisonState;
  readonly irrigation: IrrigationStrategyViewState;
  readonly commandHistory: CommandHistoryViewState;
  readonly crops: readonly CropRecord[];
  readonly cropsLoading: boolean;
  readonly cropsRefreshing: boolean;
  readonly cropsError: string | null;
  readonly cropsSubmitBusy: boolean;
  readonly cropsSubmitError: string | null;
  readonly selectedFarm: Farm | null;
  readonly selectedDevice: Device | null;
  readonly selectedCycleId: string | null;
  readonly selectedCropId: string | null;
  readonly lastCreatedCropId: string | null;
  readonly online: boolean;
  readonly nowMs: number;
  readonly telemetry: TelemetryViewState;
  readonly telemetryHistory: TelemetryHistoryViewState;
  readonly command: CommandViewState;
  readonly controlProfile: FarmControlProfileViewState;
  readonly onSelectCycle: (cycleId: string | null) => void;
  readonly onSelectIrrigationStrategy: (
    id: IrrigationStrategyViewState["selectedStrategyId"],
    version: number | null,
  ) => void;
  readonly onToggleIrrigationArea: (areaId: GrowingArea["id"], selected: boolean) => void;
  readonly onConfirmIrrigationApplication: (confirmed: boolean) => void;
  readonly onApplyIrrigationStrategy: () => void;
  readonly onSelectCrop: (cropId: string | null) => void;
  readonly onAcknowledgeAlarm: (alarmId: string) => void;
  readonly onRefreshAlarmCenter: () => void;
  readonly onRefreshOperations: () => void;
  readonly onRefreshTelemetry: () => void;
  readonly onSelectDevice: (deviceId: string) => void;
  readonly onRequestPumpState: (state: PumpState) => void;
  readonly onRefreshControlProfile: () => void;
  readonly onSaveControlProfile: (
    widgets: readonly FarmControlWidget[],
  ) => Promise<boolean>;
  readonly onRefreshCrops: () => void;
  readonly onCreateCrop: (input: CreateCropRequestInput) => Promise<CropRecord | null>;
  readonly onUpdateCrop: (
    cropId: string,
    input: PatchCropRequestInput,
  ) => Promise<CropRecord | null>;
  readonly onDeleteCrop: (cropId: string) => Promise<boolean>;
};

type WebModuleImplementation = {
  readonly render: (context: WebModuleRenderContext) => ReactNode;
};

export const DEFAULT_MODULE_CONFIGURATION: ModuleRegistryConfigurationV1 =
  DEFAULT_BUILT_IN_MODULE_CONFIGURATION;

const WEB_MODULE_CONTRIBUTIONS = [
  {
    manifest: CROP_OPERATIONS_MODULE_MANIFEST,
    requiredPermissions: [
      "farm.read",
      "device.read",
      "area.read",
      "cycle.read",
      "cycle.write",
      "telemetry.read",
      "device.command",
      "strategy.read",
      "strategy.apply",
    ],
    implementation: {
      render: (context: WebModuleRenderContext) => (
        <CropOperationsView
          farm={context.selectedFarm}
          devices={context.devices}
          areas={context.areas}
          cropCycles={context.cropCycles}
          activeAlarms={context.alarms}
          areaComparison={context.areaComparison}
          irrigation={context.irrigation}
          commandHistory={context.commandHistory}
          alarmsLoading={context.alarmsLoading}
          alarmsRefreshing={context.alarmsRefreshing}
          alarmsError={context.alarmsError}
          loading={context.operationsLoading}
          refreshing={context.operationsRefreshing}
          error={context.operationsError}
          online={context.online}
          nowMs={context.nowMs}
          selectedCycleId={context.selectedCycleId}
          onSelectCycle={context.onSelectCycle}
          onSelectIrrigationStrategy={context.onSelectIrrigationStrategy}
          onToggleIrrigationArea={context.onToggleIrrigationArea}
          onConfirmIrrigationApplication={context.onConfirmIrrigationApplication}
          onApplyIrrigationStrategy={context.onApplyIrrigationStrategy}
          onRefresh={context.onRefreshOperations}
        />
      ),
    },
  },
  {
    manifest: ALARM_CENTER_MODULE_MANIFEST,
    requiredPermissions: ["farm.read", "device.read", "area.read", "cycle.read", "alarm.read", "alarm.acknowledge", "audit.read"],
    implementation: {
      render: (context: WebModuleRenderContext) => (
        <AlarmCenterView
          farm={context.selectedFarm}
          devices={context.devices}
          areas={context.areas}
          cropCycles={context.cropCycles}
          alarms={context.alarms}
          alarmsLoading={context.alarmsLoading}
          alarmsRefreshing={context.alarmsRefreshing}
          alarmsError={context.alarmsError}
          auditEvents={context.auditEvents}
          auditLoading={context.auditLoading}
          auditRefreshing={context.auditRefreshing}
          auditError={context.auditError}
          acknowledgingAlarmId={context.acknowledgingAlarmId}
          acknowledgeError={context.acknowledgeAlarmError}
          acknowledgeNotice={context.acknowledgeAlarmNotice}
          onRefresh={context.onRefreshAlarmCenter}
          onAcknowledgeAlarm={context.onAcknowledgeAlarm}
        />
      ),
    },
  },
  {
    manifest: CROP_JOURNAL_MODULE_MANIFEST,
    requiredPermissions: ["farm.read", "device.read", "crop.read", "crop.write"],
    implementation: {
      render: (context: WebModuleRenderContext) => (
        <CropManagementView
          farm={context.selectedFarm}
          devices={context.devices}
          crops={context.crops}
          loading={context.cropsLoading}
          refreshing={context.cropsRefreshing}
          error={context.cropsError}
          submitBusy={context.cropsSubmitBusy}
          submitError={context.cropsSubmitError}
          selectedCropId={context.selectedCropId}
          lastCreatedCropId={context.lastCreatedCropId}
          onSelectCrop={context.onSelectCrop}
          onRefresh={context.onRefreshCrops}
          onCreateCrop={context.onCreateCrop}
          onUpdateCrop={context.onUpdateCrop}
          onDeleteCrop={context.onDeleteCrop}
        />
      ),
    },
  },
  {
    manifest: FARM_CONTROL_MODULE_MANIFEST,
    requiredPermissions: ["farm.read", "device.read", "device.command", "layout.write"],
    implementation: {
      render: (context: WebModuleRenderContext) => (
        <ControlView
          farm={context.selectedFarm}
          device={context.selectedDevice}
          devices={context.devices}
          online={context.online}
          command={context.command}
          controlProfile={context.controlProfile}
          onSelectDevice={context.onSelectDevice}
          onRequestPumpState={context.onRequestPumpState}
          onRefreshControlProfile={context.onRefreshControlProfile}
          onSaveControlProfile={context.onSaveControlProfile}
        />
      ),
    },
  },
  {
    manifest: WEATHER_LOCATION_MODULE_MANIFEST,
    requiredPermissions: ["farm.read", "weather.read", "location.read"],
    implementation: {
      render: (context: WebModuleRenderContext) => (
        <WeatherShellView farm={context.selectedFarm} />
      ),
    },
  },
  {
    manifest: FARM_ENVIRONMENT_MODULE_MANIFEST,
    requiredPermissions: ["farm.read", "device.read", "telemetry.read"],
    implementation: {
      render: (context: WebModuleRenderContext) => (
        <EnvironmentView
          farm={context.selectedFarm}
          device={context.selectedDevice}
          telemetry={context.telemetry}
          telemetryHistory={context.telemetryHistory}
          onRefreshTelemetry={context.onRefreshTelemetry}
        />
      ),
    },
  },
] as const;

export function createWebModuleRegistry(
  configuration: ModuleRegistryConfigurationV1 = DEFAULT_MODULE_CONFIGURATION,
): StaticModuleRegistry<WebModuleImplementation> {
  return createStaticModuleRegistry(WEB_MODULE_CONTRIBUTIONS, configuration);
}

export function createWebModuleSurface(
  configuration: ModuleRegistryConfigurationV1 = DEFAULT_MODULE_CONFIGURATION,
) {
  const registry = createWebModuleRegistry(configuration);
  const navigation = Object.freeze([
    { route: "overview", label: "개요", testId: undefined },
    ...registry.pages.map((page) => ({
      route: page.route,
      label: page.label,
      testId: page.testId,
    })),
    { route: "settings", label: "설정", testId: "nav-settings" },
  ]);

  return Object.freeze({
    registry,
    navigation,
    homeCards: registry.homeCards,
    routes: Object.freeze(navigation.map((item) => item.route)),
  });
}

export const WEB_MODULE_SURFACE = createWebModuleSurface();
export const WEB_MODULE_REGISTRY = WEB_MODULE_SURFACE.registry;
export const APP_NAV_ITEMS = WEB_MODULE_SURFACE.navigation;
export const APP_HOME_CARDS = WEB_MODULE_SURFACE.homeCards;
export const APP_ROUTES = WEB_MODULE_SURFACE.routes;

export function renderWebModuleRoute(
  route: string,
  context: WebModuleRenderContext,
): ReactNode | null {
  return WEB_MODULE_REGISTRY.findByRoute(route)?.implementation.render(context) ?? null;
}
