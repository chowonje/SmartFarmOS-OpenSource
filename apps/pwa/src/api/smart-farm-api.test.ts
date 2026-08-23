import { describe, expect, it, vi } from "vitest";
import { SmartFarmApi, SmartFarmApiError, type FetchImplementation } from "./smart-farm-api";

const telemetryBody = {
  schemaVersion: "smartfarm.latest-telemetry.v1",
  telemetry: {
    schemaVersion: "smartfarm.telemetry.v1",
    id: "telemetry:bed-1-000001",
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    metric: "temperature",
    value: 24.5,
    unit: "celsius",
    sequence: 1,
    observedAt: "2026-07-17T00:00:00.000Z",
  },
};

const humidityTelemetryBody = {
  ...telemetryBody,
  telemetry: {
    ...telemetryBody.telemetry,
    id: "telemetry:bed-1-000002",
    metric: "humidity",
    value: 61.2,
    unit: "percent",
    sequence: 2,
  },
};

const telemetryHistoryBody = {
  schemaVersion: "smartfarm.telemetry-history.v1",
  telemetry: [
    telemetryBody.telemetry,
    {
      ...telemetryBody.telemetry,
      id: "telemetry:bed-1-000003",
      value: 25.2,
      sequence: 2,
      observedAt: "2026-07-17T00:05:00.000Z",
    },
  ],
};

const weatherBody = {
  schemaVersion: "smartfarm.current-weather.v1",
  source: {
    kind: "fixture",
    provider: "smartfarm-fixture-v1",
    observedAt: "2026-08-10T01:00:00.000Z",
    fetchedAt: "2026-08-10T01:00:00.000Z",
  },
  location: {
    name: "Seoul",
    countryCode: "KR",
    latitude: 37.5665,
    longitude: 126.978,
    timezoneOffsetSeconds: 32_400,
  },
  conditions: {
    summary: "Clear (fixture)",
    temperatureCelsius: 24.5,
    feelsLikeCelsius: 24.1,
    humidityPercent: 61,
    cloudCoverPercent: 12,
    windSpeedMetersPerSecond: 2.4,
    precipitationMillimetersLastHour: null,
  },
  cache: {
    status: "miss",
    cachedAt: "2026-08-10T01:00:00.000Z",
    expiresAt: "2026-08-10T01:05:00.000Z",
  },
  warning: null,
};

const farmsBody = {
  schemaVersion: "smartfarm.farm-list.v1",
  farms: [
    {
      schemaVersion: "smartfarm.farm.v1",
      id: "farm:demo",
      name: "대회 데모 농장",
      timezone: "Asia/Seoul",
      createdAt: "2026-07-17T00:00:00.000Z",
    },
  ],
};

const devicesBody = {
  schemaVersion: "smartfarm.device-list.v1",
  devices: [
    {
      schemaVersion: "smartfarm.device.v1",
      id: "device:bed-1",
      farmId: "farm:demo",
      name: "베드 1 컨트롤러",
      kind: "hybrid",
      capabilities: ["temperature", "pump"],
      status: "online",
      lastSeenAt: "2026-07-17T00:00:00.000Z",
    },
  ],
};

const areasBody = {
  schemaVersion: "smartfarm.growing-area-list.v1",
  areas: [
    {
      schemaVersion: "smartfarm.growing-area.v1",
      id: "area:greenhouse-a",
      farmId: "farm:demo",
      name: "온실 A",
      kind: "greenhouse",
      primaryDeviceId: "device:bed-1",
      status: "active",
      createdAt: "2026-08-09T00:00:00.000Z",
      updatedAt: "2026-08-09T00:05:00.000Z",
    },
  ],
};

const irrigationStrategy = {
  schemaVersion: "smartfarm.irrigation-strategy.v1",
  id: "strategy:basil-recovery",
  version: 1,
  farmId: "farm:demo",
  cycleId: "cycle:basil-2026-08",
  name: "저수위 회복 급수 시작",
  description: "로컬 데모에서 선택한 베드의 펌프를 켭니다. 자동 종료는 하지 않습니다.",
  pumpState: "on",
  status: "approved",
  createdAt: "2026-08-09T00:00:00.000Z",
  approvedAt: "2026-08-09T00:00:00.000Z",
};

const strategyApplication = {
  schemaVersion: "smartfarm.strategy-application.v1",
  id: "strategy-application:apply-000001",
  farmId: "farm:demo",
  cycleId: "cycle:basil-2026-08",
  strategyId: irrigationStrategy.id,
  strategyVersion: irrigationStrategy.version,
  strategyName: irrigationStrategy.name,
  pumpState: "on",
  actor: { type: "user", id: "user:demo" },
  idempotencyKey: "pwa-strategy-000001",
  targets: [{
    schemaVersion: "smartfarm.strategy-application-target.v1",
    areaId: "area:greenhouse-a",
    deviceId: "device:bed-1",
    commandId: "command:strategy-000001",
    status: "pending",
    reasonCode: null,
    resultingPumpState: null,
    updatedAt: "2026-08-09T00:05:00.000Z",
  }],
  status: "pending",
  createdAt: "2026-08-09T00:05:00.000Z",
  updatedAt: "2026-08-09T00:05:00.000Z",
};

const irrigationStrategyListBody = {
  schemaVersion: "smartfarm.irrigation-strategy-list.v1",
  irrigationStrategies: [irrigationStrategy],
};

const strategyApplicationBody = {
  schemaVersion: "smartfarm.strategy-application-response.v1",
  strategyApplication,
};

const cropCycleDetailBody = {
  schemaVersion: "smartfarm.crop-cycle-detail.v1",
  cycle: {
    schemaVersion: "smartfarm.crop-cycle.v1",
    id: "cycle:basil-2026-08",
    farmId: "farm:demo",
    name: "8월 바질",
    cropName: "바질",
    variety: "스위트 바질",
    status: "active",
    startedAt: "2026-08-01T00:00:00.000Z",
    plannedEndAt: "2026-08-31T00:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-09T00:05:00.000Z",
  },
  areaIds: ["area:greenhouse-a"],
} as const;

const cropCycleListBody = {
  schemaVersion: "smartfarm.crop-cycle-list.v1",
  cropCycles: [cropCycleDetailBody],
};

const cropCycleBody = {
  schemaVersion: "smartfarm.crop-cycle-response.v1",
  cropCycle: cropCycleDetailBody,
};

const cropBody = {
  schemaVersion: "smartfarm.crop-response.v1",
  crop: {
    schemaVersion: "smartfarm.crop.v1",
    id: "crop:basil-bed-1",
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    name: "바질 1베드",
    healthStatus: "good",
    managerName: "홍길동",
    notes: "급수량 조정 완료",
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:05:00.000Z",
  },
};

const cropListBody = {
  schemaVersion: "smartfarm.crop-list.v1",
  crops: [cropBody.crop],
};

const alarmBody = {
  schemaVersion: "smartfarm.alarm-instance.v1",
  id: "alarm:bed-1-temperature",
  farmId: "farm:demo",
  ruleId: "alarm-rule:bed-1-temperature",
  cycleId: "cycle:basil-2026-08",
  areaId: "area:greenhouse-a",
  deviceId: "device:bed-1",
  ruleName: "온실 A 온도 상한",
  metric: "temperature",
  comparison: "above",
  threshold: 28,
  severity: "critical",
  state: "active",
  triggerTelemetryId: "telemetry:bed-1-000011",
  lastTelemetryId: "telemetry:bed-1-000013",
  openedAt: "2026-08-09T00:10:00.000Z",
  lastObservedAt: "2026-08-09T00:15:00.000Z",
  lastValue: 31.4,
  clearedAt: null,
  acknowledgement: null,
  updatedAt: "2026-08-09T00:15:00.000Z",
};

const clearedAlarmBody = {
  ...alarmBody,
  id: "alarm:bed-1-humidity",
  ruleId: "alarm-rule:bed-1-humidity",
  metric: "humidity",
  comparison: "below",
  threshold: 45,
  severity: "warning",
  state: "cleared",
  lastValue: 52,
  clearedAt: "2026-08-09T00:24:00.000Z",
  acknowledgement: {
    actorId: "user:demo",
    acknowledgedAt: "2026-08-09T00:25:00.000Z",
  },
  updatedAt: "2026-08-09T00:25:00.000Z",
};

const alarmListBody = {
  schemaVersion: "smartfarm.alarm-list.v1",
  alarms: [alarmBody, clearedAlarmBody],
};

const alarmResponseBody = {
  schemaVersion: "smartfarm.alarm-response.v1",
  alarm: {
    ...alarmBody,
    acknowledgement: {
      actorId: "user:demo",
      acknowledgedAt: "2026-08-09T00:26:00.000Z",
    },
    updatedAt: "2026-08-09T00:26:00.000Z",
  },
};

const auditEventListBody = {
  schemaVersion: "smartfarm.audit-event-list.v1",
  auditEvents: [
    {
      schemaVersion: "smartfarm.audit-event.v1",
      id: "audit:alarm-ack-0001",
      farmId: "farm:demo",
      cycleId: "cycle:basil-2026-08",
      actor: { type: "user", id: "user:demo" },
      action: "alarm.acknowledged",
      targetType: "alarm",
      targetId: "alarm:bed-1-temperature",
      result: "success",
      occurredAt: "2026-08-09T00:26:00.000Z",
      details: { actorId: "user:demo" },
    },
  ],
};

const auditEventListWithUnscopedBody = {
  schemaVersion: "smartfarm.audit-event-list.v1",
  auditEvents: [
    ...auditEventListBody.auditEvents,
    {
      schemaVersion: "smartfarm.audit-event.v2",
      id: "audit:direct-command-completed-0001",
      farmId: "farm:demo",
      cycleId: null,
      actor: { type: "user", id: "user:demo" },
      action: "command.completed",
      targetType: "command",
      targetId: "command:pump-000002",
      result: "success",
      occurredAt: "2026-08-09T00:27:00.000Z",
      details: {
        source: "direct",
        deviceId: "device:bed-1",
        requestedAction: "set_pump_state",
        requestedPumpState: "off",
        status: "acknowledged",
        reasonCode: null,
        resultingPumpState: "off",
      },
    },
  ],
};

const commandProjectionBody = {
  schemaVersion: "smartfarm.command-projection.v1",
  command: {
    schemaVersion: "smartfarm.command.v1",
    id: "command:pump-000001",
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    payload: { action: "set_pump_state", state: "on" },
    actor: { type: "user", id: "user:demo" },
    idempotencyKey: "pwa-pump-000001",
    issuedAt: "2026-08-09T00:00:00.000Z",
    expiresAt: "2026-08-09T00:01:00.000Z",
  },
  status: "acknowledged",
  ack: {
    schemaVersion: "smartfarm.command-ack.v1",
    commandId: "command:pump-000001",
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    status: "acknowledged",
    reasonCode: null,
    result: { pumpState: "on" },
    processedAt: "2026-08-09T00:00:10.000Z",
  },
  updatedAt: "2026-08-09T00:00:10.000Z",
};

const commandListBody = {
  schemaVersion: "smartfarm.command-list.v1",
  commands: [commandProjectionBody],
};

const farmControlProfileBody = {
  schemaVersion: "smartfarm.farm-control-profile-response.v1",
  controlProfile: {
    schemaVersion: "smartfarm.farm-control-profile.v1",
    farmId: "farm:demo",
    revision: 1,
    widgets: [{
      schemaVersion: "smartfarm.farm-control-widget.v1",
      kind: "pump_control",
      deviceId: "device:bed-1",
      label: "동쪽 베드 급수",
      showStart: true,
    }],
    updatedAt: "2026-08-10T00:00:00.000Z",
  },
};

describe("SmartFarmApi", () => {
  it("reads normalized weather by city or coordinates without client credentials", async () => {
    const fetchImplementation = vi.fn<FetchImplementation>()
      .mockResolvedValueOnce(jsonResponse(weatherBody))
      .mockResolvedValueOnce(jsonResponse({
        ...weatherBody,
        location: { ...weatherBody.location, name: "농장 좌표" },
        cache: { ...weatherBody.cache, status: "hit" },
      }));
    const api = new SmartFarmApi({ baseUrl: "/api", fetchImplementation });

    const byCity = await api.currentWeather("farm:demo", { city: " Seoul " });
    const byCoordinates = await api.currentWeather("farm:demo", {
      latitude: 37.5665,
      longitude: 126.978,
    });

    expect(byCity.source.kind).toBe("fixture");
    expect(byCoordinates.cache.status).toBe("hit");
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe(
      "/api/v1/farms/farm%3Ademo/weather/current?city=Seoul",
    );
    expect(fetchImplementation.mock.calls[1]?.[0]).toBe(
      "/api/v1/farms/farm%3Ademo/weather/current?latitude=37.5665&longitude=126.978",
    );
    const headers = new Headers(fetchImplementation.mock.calls[0]?.[1]?.headers);
    expect(headers.get("x-smartfarm-demo-key")).toBeNull();
  });

  it("rejects ambiguous weather locators before making a request", async () => {
    const fetchImplementation = vi.fn<FetchImplementation>();
    const api = new SmartFarmApi({ baseUrl: "/api", fetchImplementation });

    await expect(api.currentWeather("farm:demo", {
      city: "Seoul",
      latitude: 37.5665,
      longitude: 126.978,
    })).rejects.toBeDefined();
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("reads and validates latest temperature without adding demo credentials", async () => {
    const fetchImplementation = vi.fn<FetchImplementation>().mockResolvedValue(jsonResponse(telemetryBody));
    const api = new SmartFarmApi({ baseUrl: "/api", fetchImplementation });

    const latest = await api.latestTemperature("farm:demo", "device:bed-1");

    expect(latest.telemetry.value).toBe(24.5);
    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [url, init] = fetchImplementation.mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/farms/farm%3Ademo/devices/device%3Abed-1/telemetry/latest?metric=temperature");
    const headers = new Headers(init?.headers);
    expect(headers.get("x-smartfarm-demo-key")).toBeNull();
  });

  it("reads any supported telemetry metric through the shared latest endpoint", async () => {
    const fetchImplementation = vi.fn<FetchImplementation>().mockResolvedValue(jsonResponse(humidityTelemetryBody));
    const api = new SmartFarmApi({ baseUrl: "/api", fetchImplementation });

    const latest = await api.latestTelemetry("farm:demo", "device:bed-1", "humidity");

    expect(latest.telemetry.metric).toBe("humidity");
    expect(latest.telemetry.value).toBe(61.2);
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe(
      "/api/v1/farms/farm%3Ademo/devices/device%3Abed-1/telemetry/latest?metric=humidity",
    );
  });

  it("reads bounded telemetry history through the shared history endpoint", async () => {
    const fetchImplementation = vi.fn<FetchImplementation>()
      .mockResolvedValue(jsonResponse(telemetryHistoryBody));
    const api = new SmartFarmApi({ baseUrl: "/api", fetchImplementation });

    const history = await api.telemetryHistory("farm:demo", "device:bed-1", "temperature", 2);

    expect(history.telemetry.map((reading) => reading.sequence)).toEqual([1, 2]);
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe(
      "/api/v1/farms/farm%3Ademo/devices/device%3Abed-1/telemetry/history?metric=temperature&limit=2",
    );
  });

  it("lists farms and devices through the new discovery endpoints", async () => {
    const fetchImplementation = vi.fn<FetchImplementation>()
      .mockResolvedValueOnce(jsonResponse(farmsBody))
      .mockResolvedValueOnce(jsonResponse(devicesBody));
    const api = new SmartFarmApi({ baseUrl: "/api", fetchImplementation });

    const farms = await api.listFarms();
    const devices = await api.listDevices("farm:demo");

    expect(farms[0]?.id).toBe("farm:demo");
    expect(devices[0]?.id).toBe("device:bed-1");
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe("/api/v1/farms");
    expect(fetchImplementation.mock.calls[1]?.[0]).toBe("/api/v1/farms/farm%3Ademo/devices");
  });

  it("lists areas and crop cycles for the operations page", async () => {
    const fetchImplementation = vi.fn<FetchImplementation>()
      .mockResolvedValueOnce(jsonResponse(areasBody))
      .mockResolvedValueOnce(jsonResponse(cropCycleListBody));
    const api = new SmartFarmApi({ baseUrl: "/api", fetchImplementation });

    const areas = await api.listAreas("farm:demo");
    const cropCycles = await api.listCropCycles("farm:demo");

    expect(areas[0]?.name).toBe("온실 A");
    expect(areas[0]?.primaryDeviceId).toBe("device:bed-1");
    expect(cropCycles[0]?.cycle.name).toBe("8월 바질");
    expect(cropCycles[0]?.areaIds).toEqual(["area:greenhouse-a"]);
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe("/api/v1/farms/farm%3Ademo/areas");
    expect(fetchImplementation.mock.calls[1]?.[0]).toBe("/api/v1/farms/farm%3Ademo/crop-cycles");
  });

  it("lists alarms, acknowledges an alarm, and reads audit events with shared contracts", async () => {
    const fetchImplementation = vi.fn<FetchImplementation>()
      .mockResolvedValueOnce(jsonResponse(alarmListBody))
      .mockResolvedValueOnce(jsonResponse(alarmResponseBody, 202))
      .mockResolvedValueOnce(jsonResponse(auditEventListBody));
    const api = new SmartFarmApi({ baseUrl: "/api", fetchImplementation });

    const alarms = await api.listAlarms("farm:demo", {
      cycleId: "cycle:basil-2026-08",
      limit: 20,
    });
    const acknowledged = await api.acknowledgeAlarm(
      "farm:demo",
      "alarm:bed-1-temperature",
      "pwa-alarm-000001",
    );
    const auditEvents = await api.listAuditEvents("farm:demo", {
      cycleId: "cycle:basil-2026-08",
      limit: 10,
    });

    expect(alarms).toHaveLength(2);
    expect(acknowledged.acknowledgement?.actorId).toBe("user:demo");
    expect(auditEvents[0]?.action).toBe("alarm.acknowledged");
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe(
      "/api/v1/farms/farm%3Ademo/alarms?cycleId=cycle%3Abasil-2026-08&limit=20",
    );
    expect(fetchImplementation.mock.calls[1]?.[0]).toBe(
      "/api/v1/farms/farm%3Ademo/alarms/alarm%3Abed-1-temperature/acknowledgements",
    );
    expect(fetchImplementation.mock.calls[2]?.[0]).toBe(
      "/api/v1/farms/farm%3Ademo/audit-events?cycleId=cycle%3Abasil-2026-08&limit=10",
    );

    const [, acknowledgeInit] = fetchImplementation.mock.calls[1] ?? [];
    expect(acknowledgeInit?.method).toBe("POST");
    expect(JSON.parse(String(acknowledgeInit?.body))).toEqual({
      idempotencyKey: "pwa-alarm-000001",
    });
  });

  it("adds includeUnscoped=true only when requested for audit events", async () => {
    const fetchImplementation = vi.fn<FetchImplementation>()
      .mockResolvedValueOnce(jsonResponse(auditEventListBody))
      .mockResolvedValueOnce(jsonResponse(auditEventListWithUnscopedBody));
    const api = new SmartFarmApi({ baseUrl: "/api", fetchImplementation });

    await api.listAuditEvents("farm:demo", {
      cycleId: "cycle:basil-2026-08",
      limit: 10,
    });
    const auditEvents = await api.listAuditEvents("farm:demo", {
      cycleId: "cycle:basil-2026-08",
      includeUnscoped: true,
      limit: 10,
    });

    expect(fetchImplementation.mock.calls[0]?.[0]).toBe(
      "/api/v1/farms/farm%3Ademo/audit-events?cycleId=cycle%3Abasil-2026-08&limit=10",
    );
    expect(fetchImplementation.mock.calls[1]?.[0]).toBe(
      "/api/v1/farms/farm%3Ademo/audit-events?cycleId=cycle%3Abasil-2026-08&includeUnscoped=true&limit=10",
    );
    expect(auditEvents[1]?.schemaVersion).toBe("smartfarm.audit-event.v2");
    expect(auditEvents[1]?.cycleId).toBeNull();
  });

  it("lists recent commands with optional device filtering", async () => {
    const fetchImplementation = vi.fn<FetchImplementation>()
      .mockResolvedValueOnce(jsonResponse(commandListBody))
      .mockResolvedValueOnce(jsonResponse(commandListBody));
    const api = new SmartFarmApi({ baseUrl: "/api", fetchImplementation });

    const commands = await api.listCommands("farm:demo", { limit: 50 });
    const filtered = await api.listCommands("farm:demo", {
      deviceId: "device:bed-1",
      limit: 10,
    });

    expect(commands[0]?.command.id).toBe("command:pump-000001");
    expect(filtered[0]?.status).toBe("acknowledged");
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe(
      "/api/v1/farms/farm%3Ademo/commands?limit=50",
    );
    expect(fetchImplementation.mock.calls[1]?.[0]).toBe(
      "/api/v1/farms/farm%3Ademo/commands?deviceId=device%3Abed-1&limit=10",
    );
  });

  it("reads and updates a strict farm-scoped control profile", async () => {
    const fetchImplementation = vi.fn<FetchImplementation>()
      .mockResolvedValueOnce(jsonResponse(farmControlProfileBody))
      .mockResolvedValueOnce(jsonResponse({
        ...farmControlProfileBody,
        controlProfile: {
          ...farmControlProfileBody.controlProfile,
          revision: 2,
          widgets: [{
            ...farmControlProfileBody.controlProfile.widgets[0],
            label: "육묘동 급수",
            showStart: false,
          }],
        },
      }));
    const api = new SmartFarmApi({ baseUrl: "/api", fetchImplementation });

    const profile = await api.farmControlProfile("farm:demo");
    const updated = await api.updateFarmControlProfile("farm:demo", {
      expectedRevision: profile.revision,
      widgets: [{
        ...profile.widgets[0]!,
        label: "육묘동 급수",
        showStart: false,
      }],
    });

    expect(profile.widgets[0]?.label).toBe("동쪽 베드 급수");
    expect(updated.revision).toBe(2);
    expect(updated.widgets[0]?.showStart).toBe(false);
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe(
      "/api/v1/farms/farm%3Ademo/control-profile",
    );
    expect(fetchImplementation.mock.calls[1]?.[0]).toBe(
      "/api/v1/farms/farm%3Ademo/control-profile",
    );
    const [, updateInit] = fetchImplementation.mock.calls[1] ?? [];
    expect(updateInit?.method).toBe("PUT");
    expect(JSON.parse(String(updateInit?.body))).toEqual({
      expectedRevision: 1,
      widgets: [{
        schemaVersion: "smartfarm.farm-control-widget.v1",
        kind: "pump_control",
        deviceId: "device:bed-1",
        label: "육묘동 급수",
        showStart: false,
      }],
    });
  });

  it("lists, applies, and follows a selected-cycle irrigation strategy", async () => {
    const fetchImplementation = vi.fn<FetchImplementation>()
      .mockResolvedValueOnce(jsonResponse(irrigationStrategyListBody))
      .mockResolvedValueOnce(jsonResponse(strategyApplicationBody, 202))
      .mockResolvedValueOnce(jsonResponse(strategyApplicationBody));
    const api = new SmartFarmApi({ baseUrl: "/api", fetchImplementation });

    const strategies = await api.listIrrigationStrategies(
      "farm:demo",
      "cycle:basil-2026-08",
    );
    const applied = await api.applyIrrigationStrategy(
      "farm:demo",
      "strategy:basil-recovery",
      {
        cycleId: "cycle:basil-2026-08",
        strategyVersion: 1,
        areaIds: ["area:greenhouse-a"],
        idempotencyKey: "pwa-strategy-000001",
      },
    );
    const followed = await api.strategyApplication(
      "farm:demo",
      "strategy-application:apply-000001",
    );

    expect(strategies[0]?.status).toBe("approved");
    expect(applied.status).toBe("pending");
    expect(followed.targets[0]?.areaId).toBe("area:greenhouse-a");
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe(
      "/api/v1/farms/farm%3Ademo/irrigation-strategies?cycleId=cycle%3Abasil-2026-08",
    );
    expect(fetchImplementation.mock.calls[1]?.[0]).toBe(
      "/api/v1/farms/farm%3Ademo/irrigation-strategies/strategy%3Abasil-recovery/applications",
    );
    expect(fetchImplementation.mock.calls[2]?.[0]).toBe(
      "/api/v1/farms/farm%3Ademo/strategy-applications/strategy-application%3Aapply-000001",
    );
    const [, applyInit] = fetchImplementation.mock.calls[1] ?? [];
    expect(applyInit?.method).toBe("POST");
    expect(JSON.parse(String(applyInit?.body))).toEqual({
      cycleId: "cycle:basil-2026-08",
      strategyVersion: 1,
      areaIds: ["area:greenhouse-a"],
      idempotencyKey: "pwa-strategy-000001",
    });
  });

  it("creates and updates crop cycles with shared contracts", async () => {
    const fetchImplementation = vi.fn<FetchImplementation>()
      .mockResolvedValueOnce(jsonResponse(cropCycleBody, 201))
      .mockResolvedValueOnce(jsonResponse({
        ...cropCycleBody,
        cropCycle: {
          ...cropCycleBody.cropCycle,
          cycle: {
            ...cropCycleBody.cropCycle.cycle,
            status: "completed",
            plannedEndAt: null,
          },
        },
      }));
    const api = new SmartFarmApi({ baseUrl: "/api", fetchImplementation });

    const created = await api.createCropCycle("farm:demo", {
      name: "8월 바질",
      cropName: "바질",
      variety: "스위트 바질",
      status: "active",
      startedAt: "2026-08-01T00:00:00.000Z",
      plannedEndAt: "2026-08-31T00:00:00.000Z",
      areaIds: ["area:greenhouse-a"],
    });
    const updated = await api.updateCropCycle("farm:demo", "cycle:basil-2026-08", {
      status: "completed",
      plannedEndAt: null,
    });

    expect(created.areaIds).toEqual(["area:greenhouse-a"]);
    expect(updated.cycle.status).toBe("completed");

    const [, createInit] = fetchImplementation.mock.calls[0] ?? [];
    expect(createInit?.method).toBe("POST");
    expect(JSON.parse(String(createInit?.body))).toMatchObject({
      status: "active",
      areaIds: ["area:greenhouse-a"],
    });

    const [, updateInit] = fetchImplementation.mock.calls[1] ?? [];
    expect(updateInit?.method).toBe("PATCH");
    expect(JSON.parse(String(updateInit?.body))).toEqual({
      status: "completed",
      plannedEndAt: null,
    });
  });

  it("lists, creates, updates, and deletes crops with strict request bodies", async () => {
    const fetchImplementation = vi.fn<FetchImplementation>()
      .mockResolvedValueOnce(jsonResponse(cropListBody))
      .mockResolvedValueOnce(jsonResponse(cropBody, 201))
      .mockResolvedValueOnce(jsonResponse({
        ...cropBody,
        crop: { ...cropBody.crop, healthStatus: "fair", updatedAt: "2026-07-17T00:10:00.000Z" },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const api = new SmartFarmApi({ baseUrl: "/api", fetchImplementation });

    const crops = await api.listCrops("farm:demo");
    const created = await api.createCrop("farm:demo", {
      deviceId: "device:bed-1",
      name: "바질 1베드",
      healthStatus: "good",
      managerName: "홍길동",
      notes: "급수량 조정 완료",
    });
    const updated = await api.updateCrop("farm:demo", "crop:basil-bed-1", {
      healthStatus: "fair",
      notes: "점검 필요",
    });
    const deleted = await api.deleteCrop("farm:demo", "crop:basil-bed-1");

    expect(crops).toHaveLength(1);
    expect(created.id).toBe("crop:basil-bed-1");
    expect(updated.healthStatus).toBe("fair");
    expect(deleted).toBeNull();

    const [, createInit] = fetchImplementation.mock.calls[1] ?? [];
    expect(createInit?.method).toBe("POST");
    expect(JSON.parse(String(createInit?.body))).toMatchObject({
      deviceId: "device:bed-1",
      healthStatus: "good",
    });

    const [, updateInit] = fetchImplementation.mock.calls[2] ?? [];
    expect(updateInit?.method).toBe("PATCH");
    expect(JSON.parse(String(updateInit?.body))).toEqual({
      healthStatus: "fair",
      notes: "점검 필요",
    });

    const [, deleteInit] = fetchImplementation.mock.calls[3] ?? [];
    expect(deleteInit?.method).toBe("DELETE");
  });

  it("validates a created command projection", async () => {
    const projection = {
      schemaVersion: "smartfarm.command-projection.v1",
      command: {
        schemaVersion: "smartfarm.command.v1",
        id: "command:pump-000001",
        farmId: "farm:demo",
        deviceId: "device:bed-1",
        payload: { action: "set_pump_state", state: "on" },
        actor: { type: "user", id: "user:demo" },
        idempotencyKey: "pwa-pump-000001",
        issuedAt: "2026-07-17T00:00:00.000Z",
        expiresAt: "2026-07-17T00:01:00.000Z",
      },
      status: "pending",
      ack: null,
      updatedAt: "2026-07-17T00:00:00.000Z",
    };
    const fetchImplementation = vi.fn<FetchImplementation>().mockResolvedValue(jsonResponse(projection, 202));
    const api = new SmartFarmApi({ baseUrl: "https://example.test/api", fetchImplementation });

    const created = await api.createPumpCommand({
      farmId: "farm:demo",
      deviceId: "device:bed-1",
      state: "on",
      idempotencyKey: "pwa-pump-000001",
    });

    expect(created.status).toBe("pending");
    const [, init] = fetchImplementation.mock.calls[0] ?? [];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({ state: "on", ttlSeconds: 60 });
  });

  it("maps contract error responses without echoing response details into configuration", async () => {
    const fetchImplementation = vi.fn<FetchImplementation>().mockResolvedValue(jsonResponse({
      schemaVersion: "smartfarm.error.v1",
      code: "unauthorized",
      message: "Authentication is required",
    }, 401));
    const api = new SmartFarmApi({ baseUrl: "/api", fetchImplementation });

    await expect(api.health()).rejects.toMatchObject({
      kind: "http",
      statusCode: 401,
      apiCode: "unauthorized",
    } satisfies Partial<SmartFarmApiError>);
  });

  it("rejects malformed success responses", async () => {
    const api = new SmartFarmApi({
      baseUrl: "/api",
      fetchImplementation: vi.fn<FetchImplementation>().mockResolvedValue(jsonResponse({ value: 24.5 })),
    });

    await expect(api.latestTemperature("farm:demo", "device:bed-1")).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
