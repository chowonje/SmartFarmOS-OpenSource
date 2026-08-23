import { describe, expect, it } from "vitest";
import {
  APP_HOME_CARDS,
  APP_NAV_ITEMS,
  APP_ROUTES,
  createWebModuleSurface,
  DEFAULT_MODULE_CONFIGURATION,
} from "./web-module-registry";

describe("web module registry", () => {
  it("derives routes, navigation, and overview cards from built-in manifests", () => {
    expect(APP_ROUTES).toEqual([
      "overview",
      "operations",
      "alarms",
      "crops",
      "control",
      "weather",
      "environment",
      "settings",
    ]);
    expect(APP_NAV_ITEMS.map((item) => item.label)).toEqual([
      "개요",
      "작물 운영",
      "알람 센터",
      "작물일지",
      "농장 컨트롤",
      "날씨·위치",
      "농장 환경",
      "설정",
    ]);
    expect(APP_HOME_CARDS.map((card) => card.route)).toEqual([
      "operations",
      "alarms",
      "crops",
      "control",
      "weather",
      "environment",
    ]);
  });

  it("supports reviewed disable and ordering configuration without route switches", () => {
    const surface = createWebModuleSurface({
      ...DEFAULT_MODULE_CONFIGURATION,
      modules: [
        { moduleId: "smartfarm.crop-operations", enabled: true, order: 10 },
        { moduleId: "smartfarm.alarm-center", enabled: true, order: 15 },
        { moduleId: "smartfarm.crop-journal", enabled: false, order: 20 },
        { moduleId: "smartfarm.farm-control", enabled: true, order: 40 },
        { moduleId: "smartfarm.weather-location", enabled: true, order: 30 },
        { moduleId: "smartfarm.farm-environment", enabled: true, order: 20 },
      ],
    });

    expect(surface.routes).toEqual([
      "overview",
      "operations",
      "alarms",
      "environment",
      "weather",
      "control",
      "settings",
    ]);
    expect(surface.navigation.map((item) => item.route)).toEqual(surface.routes);
    expect(surface.homeCards.map((card) => card.route)).toEqual([
      "operations",
      "alarms",
      "environment",
      "weather",
      "control",
    ]);
    expect(surface.registry.findByRoute("crops")).toBeNull();
  });
});
