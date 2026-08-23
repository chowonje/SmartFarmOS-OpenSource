import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AlarmInstanceSchema,
  AuditEventSchema,
  CropCycleDetailSchema,
  DeviceSchema,
  FarmSchema,
  GrowingAreaSchema,
} from "@smartfarm-os/contracts";
import { AlarmCenterView } from "./alarm-center-view";

const farm = FarmSchema.parse({
  schemaVersion: "smartfarm.farm.v1",
  id: "farm:demo",
  name: "대회 데모 농장",
  timezone: "Asia/Seoul",
  createdAt: "2026-08-09T00:00:00.000Z",
});

const devices = [
  DeviceSchema.parse({
    schemaVersion: "smartfarm.device.v1",
    id: "device:bed-1",
    farmId: "farm:demo",
    name: "베드 1 컨트롤러",
    kind: "hybrid",
    capabilities: ["temperature", "humidity", "illuminance", "water_level", "pump"],
    status: "online",
    lastSeenAt: "2026-08-09T00:00:00.000Z",
  }),
];

const areas = [
  GrowingAreaSchema.parse({
    schemaVersion: "smartfarm.growing-area.v1",
    id: "area:greenhouse-a",
    farmId: "farm:demo",
    name: "온실 A",
    kind: "greenhouse",
    primaryDeviceId: "device:bed-1",
    status: "active",
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:05:00.000Z",
  }),
];

const cropCycles = [
  CropCycleDetailSchema.parse({
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
  }),
];

const alarms = [
  AlarmInstanceSchema.parse({
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
  }),
  AlarmInstanceSchema.parse({
    schemaVersion: "smartfarm.alarm-instance.v1",
    id: "alarm:bed-1-humidity",
    farmId: "farm:demo",
    ruleId: "alarm-rule:bed-1-humidity",
    cycleId: "cycle:basil-2026-08",
    areaId: "area:greenhouse-a",
    deviceId: "device:bed-1",
    ruleName: "온실 A 습도 하한",
    metric: "humidity",
    comparison: "below",
    threshold: 45,
    severity: "warning",
    state: "cleared",
    triggerTelemetryId: "telemetry:bed-1-000021",
    lastTelemetryId: "telemetry:bed-1-000022",
    openedAt: "2026-08-09T00:20:00.000Z",
    lastObservedAt: "2026-08-09T00:24:00.000Z",
    lastValue: 52,
    clearedAt: "2026-08-09T00:24:00.000Z",
    acknowledgement: {
      actorId: "user:demo",
      acknowledgedAt: "2026-08-09T00:25:00.000Z",
    },
    updatedAt: "2026-08-09T00:25:00.000Z",
  }),
];

const auditEvents = [
  AuditEventSchema.parse({
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
  }),
  AuditEventSchema.parse({
    schemaVersion: "smartfarm.audit-event.v2",
    id: "audit:direct-command-completed-0001",
    farmId: "farm:demo",
    cycleId: null,
    actor: { type: "user", id: "user:demo" },
    action: "command.completed",
    targetType: "command",
    targetId: "command:pump-000001",
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
  }),
];

describe("AlarmCenterView", () => {
  it("renders active alarms, cleared history, and audit rows with stable selectors", () => {
    const html = renderToStaticMarkup(
      <AlarmCenterView
        farm={farm}
        devices={devices}
        areas={areas}
        cropCycles={cropCycles}
        alarms={alarms}
        alarmsLoading={false}
        alarmsRefreshing={false}
        alarmsError={null}
        auditEvents={auditEvents}
        auditLoading={false}
        auditRefreshing={false}
        auditError={null}
        acknowledgingAlarmId={null}
        acknowledgeError={null}
        acknowledgeNotice={null}
        onRefresh={() => {}}
        onAcknowledgeAlarm={() => {}}
      />,
    );

    expect(html).toContain('data-testid="alarm-active-card"');
    expect(html).toContain('data-testid="alarm-cleared-card"');
    expect(html).toContain('data-testid="alarm-state">활성<');
    expect(html).toContain('data-testid="alarm-state">해제<');
    expect(html).toContain('data-testid="alarm-ack-status">미확인<');
    expect(html).toContain('data-testid="alarm-ack-status">확인됨<');
    expect(html).toContain('data-testid="alarm-acknowledge"');
    expect(html).toContain('data-testid="audit-event"');
    expect(html).toContain("31.4 °C");
    expect(html).toContain("알람 확인");
    expect(html).toContain("수동 제어 완료");
    expect(html).toContain("농장 공통 제어");
    expect(html).toContain("적용 범위");
    expect(html).toContain("수동 펌프 끄기");
  });
});
