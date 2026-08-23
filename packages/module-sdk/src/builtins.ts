import {
  defineModuleManifest,
  defineModuleRegistryConfiguration,
  type ModuleConfigurationSchemaV1,
  type ModuleManifestV1,
  type ModuleRegistryConfigurationV1,
} from "./index.js";

const emptyConfigSchema: ModuleConfigurationSchemaV1 = {
  schemaVersion: "smartfarm.module-configuration-schema.v1",
  fields: [],
};

export const CROP_OPERATIONS_MODULE_MANIFEST = defineModuleManifest({
  schemaVersion: "smartfarm.module-manifest.v1",
  id: "smartfarm.crop-operations",
  version: "0.1.0",
  platformApiVersion: "1",
  name: "작물 운영",
  description: "재배 구역을 비교하고 검토된 관수 프리셋을 안전한 제어 경로로 적용하는 모듈입니다.",
  permissions: ["farm.read", "device.read", "area.read", "cycle.read", "cycle.write", "strategy.read", "strategy.apply", "telemetry.read", "device.command"],
  pages: [{ route: "operations", label: "작물 운영", order: 10, testId: "nav-operations" }],
  homeCards: [{
    id: "crop-operations.quick-link",
    label: "작물 운영",
    description: "재배 구역을 비교하고 검토된 관수 프리셋을 적용합니다.",
    route: "operations",
    order: 10,
  }],
  configSchema: emptyConfigSchema,
  subscriptions: [],
});

export const ALARM_CENTER_MODULE_MANIFEST = defineModuleManifest({
  schemaVersion: "smartfarm.module-manifest.v1",
  id: "smartfarm.alarm-center",
  version: "0.1.0",
  platformApiVersion: "1",
  name: "알람 센터",
  description: "활성 알람과 해제 이력, 확인 여부, 운영 감사 이력을 함께 확인하는 모듈입니다.",
  permissions: ["farm.read", "device.read", "area.read", "cycle.read", "alarm.read", "alarm.acknowledge", "audit.read"],
  pages: [{ route: "alarms", label: "알람 센터", order: 20, testId: "nav-alarms" }],
  homeCards: [{
    id: "alarm-center.quick-link",
    label: "알람 센터",
    description: "활성 알람과 최근 운영 이력을 확인합니다.",
    route: "alarms",
    order: 20,
  }],
  configSchema: emptyConfigSchema,
  subscriptions: ["alarm.acknowledged"],
});

export const CROP_JOURNAL_MODULE_MANIFEST = defineModuleManifest({
  schemaVersion: "smartfarm.module-manifest.v1",
  id: "smartfarm.crop-journal",
  version: "0.1.0",
  platformApiVersion: "1",
  name: "작물일지",
  description: "작물 기록을 조회하고 생성·수정·삭제하는 농장 기록 모듈입니다.",
  permissions: ["farm.read", "device.read", "crop.read", "crop.write"],
  pages: [{ route: "crops", label: "작물일지", order: 30, testId: "nav-crops" }],
  homeCards: [{
    id: "crop-journal.quick-link",
    label: "작물일지",
    description: "작물 기록을 확인하고 저장합니다.",
    route: "crops",
    order: 30,
  }],
  configSchema: emptyConfigSchema,
  subscriptions: [],
});

export const FARM_CONTROL_MODULE_MANIFEST = defineModuleManifest({
  schemaVersion: "smartfarm.module-manifest.v1",
  id: "smartfarm.farm-control",
  version: "0.1.0",
  platformApiVersion: "1",
  name: "농장 컨트롤",
  description: "장치에 만료 가능한 제어 명령을 보내고 ACK 상태를 확인하는 모듈입니다.",
  permissions: ["farm.read", "device.read", "device.command", "layout.write"],
  pages: [{ route: "control", label: "농장 컨트롤", order: 40, testId: "nav-control" }],
  homeCards: [{
    id: "farm-control.quick-link",
    label: "농장 컨트롤",
    description: "선택한 장치의 급수 펌프를 제어합니다.",
    route: "control",
    order: 40,
  }],
  configSchema: emptyConfigSchema,
  subscriptions: ["command.acknowledged"],
});

export const WEATHER_LOCATION_MODULE_MANIFEST = defineModuleManifest({
  schemaVersion: "smartfarm.module-manifest.v1",
  id: "smartfarm.weather-location",
  version: "0.1.0",
  platformApiVersion: "1",
  name: "날씨·위치",
  description: "정규화된 날씨와 위치 공급자 연동을 위한 사용자 화면 모듈입니다.",
  permissions: ["farm.read", "weather.read", "location.read"],
  pages: [{ route: "weather", label: "날씨·위치", order: 50, testId: "nav-weather" }],
  homeCards: [{
    id: "weather-location.quick-link",
    label: "날씨·위치",
    description: "외부 연동 준비 상태를 확인합니다.",
    route: "weather",
    order: 50,
  }],
  configSchema: emptyConfigSchema,
  subscriptions: [],
});

export const FARM_ENVIRONMENT_MODULE_MANIFEST = defineModuleManifest({
  schemaVersion: "smartfarm.module-manifest.v1",
  id: "smartfarm.farm-environment",
  version: "0.1.0",
  platformApiVersion: "1",
  name: "농장 환경",
  description: "장치별 온도·습도·조도·수위와 데이터 신선도를 확인하는 모듈입니다.",
  permissions: ["farm.read", "device.read", "telemetry.read"],
  pages: [{ route: "environment", label: "농장 환경", order: 60, testId: "nav-environment" }],
  homeCards: [{
    id: "farm-environment.quick-link",
    label: "농장 환경",
    description: "선택한 장치의 환경 센서와 연결 상태를 봅니다.",
    route: "environment",
    order: 60,
  }],
  configSchema: emptyConfigSchema,
  subscriptions: ["telemetry.received"],
});

export const BUILT_IN_MODULE_MANIFESTS: readonly ModuleManifestV1[] = Object.freeze([
  CROP_OPERATIONS_MODULE_MANIFEST,
  ALARM_CENTER_MODULE_MANIFEST,
  CROP_JOURNAL_MODULE_MANIFEST,
  FARM_CONTROL_MODULE_MANIFEST,
  WEATHER_LOCATION_MODULE_MANIFEST,
  FARM_ENVIRONMENT_MODULE_MANIFEST,
]);

export const DEFAULT_BUILT_IN_MODULE_CONFIGURATION: ModuleRegistryConfigurationV1 = defineModuleRegistryConfiguration({
  schemaVersion: "smartfarm.module-registry-configuration.v1",
  modules: [
    { moduleId: CROP_OPERATIONS_MODULE_MANIFEST.id, enabled: true, order: 10 },
    { moduleId: ALARM_CENTER_MODULE_MANIFEST.id, enabled: true, order: 20 },
    { moduleId: CROP_JOURNAL_MODULE_MANIFEST.id, enabled: true, order: 30 },
    { moduleId: FARM_CONTROL_MODULE_MANIFEST.id, enabled: true, order: 40 },
    { moduleId: WEATHER_LOCATION_MODULE_MANIFEST.id, enabled: true, order: 50 },
    { moduleId: FARM_ENVIRONMENT_MODULE_MANIFEST.id, enabled: true, order: 60 },
  ],
});
