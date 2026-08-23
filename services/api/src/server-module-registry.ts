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
import type { ApiModuleContext, ApiModuleRegistrar } from "./module-context.js";
import { registerAlarmCenterModule } from "./modules/alarm-center-server.js";
import { registerCropOperationsModule } from "./modules/crop-operations-server.js";
import { registerCropJournalModule } from "./modules/crop-journal-server.js";
import { registerFarmControlModule } from "./modules/farm-control-server.js";
import { registerFarmEnvironmentModule } from "./modules/farm-environment-server.js";
import { registerWeatherLocationModule } from "./modules/weather-location-server.js";

const API_MODULE_CONTRIBUTIONS = [
  {
    manifest: ALARM_CENTER_MODULE_MANIFEST,
    requiredPermissions: ["farm.read", "alarm.read", "alarm.acknowledge", "audit.read"],
    implementation: registerAlarmCenterModule,
  },
  {
    manifest: CROP_OPERATIONS_MODULE_MANIFEST,
    requiredPermissions: [
      "farm.read",
      "device.read",
      "area.read",
      "cycle.read",
      "cycle.write",
      "strategy.read",
      "strategy.apply",
    ],
    implementation: registerCropOperationsModule,
  },
  {
    manifest: CROP_JOURNAL_MODULE_MANIFEST,
    requiredPermissions: ["farm.read", "device.read", "crop.read", "crop.write"],
    implementation: registerCropJournalModule,
  },
  {
    manifest: FARM_CONTROL_MODULE_MANIFEST,
    requiredPermissions: ["farm.read", "device.read", "device.command", "layout.write"],
    implementation: registerFarmControlModule,
  },
  {
    manifest: WEATHER_LOCATION_MODULE_MANIFEST,
    requiredPermissions: ["farm.read", "weather.read", "location.read"],
    implementation: registerWeatherLocationModule,
  },
  {
    manifest: FARM_ENVIRONMENT_MODULE_MANIFEST,
    requiredPermissions: ["farm.read", "device.read", "telemetry.read"],
    implementation: registerFarmEnvironmentModule,
  },
] as const;

export function createApiModuleRegistry(
  configuration: ModuleRegistryConfigurationV1 = DEFAULT_BUILT_IN_MODULE_CONFIGURATION,
): StaticModuleRegistry<ApiModuleRegistrar> {
  return createStaticModuleRegistry(API_MODULE_CONTRIBUTIONS, configuration);
}

export function registerApiModules(
  context: ApiModuleContext,
  configuration?: ModuleRegistryConfigurationV1,
): StaticModuleRegistry<ApiModuleRegistrar> {
  const registry = createApiModuleRegistry(configuration);
  for (const module of registry.modules) module.implementation(context);
  return registry;
}
